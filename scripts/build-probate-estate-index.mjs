#!/usr/bin/env node
/**
 * Build the probate estate index (migration 099) — the connective spine.
 *
 * Groups already-scraped probate pages into one row per (roll, decedent), turning
 * the 83%-orphan page pile into a queryable estate registry, NOW, without waiting
 * for the multi-month LLM forensic drip. Deterministic: uses the scraper's
 * carry-forward testator_name + the #67-corrected document_year. The LLM layer
 * (probate_estate_extractions) attaches later by (roll_group_id, decedent_key).
 *
 * Sanity columns make it a corroboration tool: slavery_era (NY-1827 gate),
 * year_plausible (catches OCR-noise dates), name_suspect (place-word / OCR-junk
 * decedents — FLAGGED for review, never dropped; Biscoe rule).
 *
 *   node scripts/build-probate-estate-index.mjs                 # dry run, region=new-york
 *   node scripts/build-probate-estate-index.mjs --apply
 *   node scripts/build-probate-estate-index.mjs --region georgia --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const REGION = arg('--region') || 'new-york';

// region → (state, collection_key prefix, founding-year floor for plausibility, slavery cutoff)
const REGIONS = {
  'new-york': { state: 'NY', prefix: 'new-york-probate-', floor: 1629, slaveryCutoff: 1828 },
  'georgia':  { state: 'GA', prefix: 'georgia-probate-', floor: 1733, slaveryCutoff: 1865 },
};
const CEILING = 1971;
const cfg = REGIONS[REGION];
if (!cfg) { console.error(`unknown --region ${REGION}; known: ${Object.keys(REGIONS).join(', ')}`); process.exit(1); }

const HONORIFIC_SUFFIX = /\b(deceased|dec'?d|decd|recorded|registered|the late|late|senior|sen'?r|sr|junior|jun'?r|jr|esq(?:uire)?|widow|admin(?:istrator|istratrix)?|exec(?:utor|utrix)?)\b/gi;
const LEADING_NOISE = /^(?:the\s+)?(?:estate|will|inventory|appraisement|account|administration|last\s+will\s+and\s+testament|law|in\s+the\s+matter)\s+of\s+/i;
// place-words & OCR-junk that recur as fake decedents in the NY corpus
const PLACE_WORDS = new Set(['schenectady','albany','newyork','york','county','state','city','town','manor','colony','province','court','surrogate','register']);

const cleanName = (raw) => String(raw || '')
  .replace(LEADING_NOISE, '')
  .replace(HONORIFIC_SUFFIX, ' ')
  .replace(/[^A-Za-z'.\s-]/g, ' ')      // strip digits/punctuation noise
  .replace(/\s+/g, ' ').trim();

const normKey = (name) => cleanName(name).toLowerCase().replace(/[.'-]/g, ' ').replace(/\s+/g, ' ').trim();

const isNameSuspect = (display, key) => {
  if (!key) return true;
  const toks = key.split(' ').filter(Boolean);
  if (toks.length < 2) return true;                                  // single token = fragment/place
  if (toks.every((t) => PLACE_WORDS.has(t))) return true;            // all place-words
  if (toks.length === 2 && PLACE_WORDS.has(toks.join('')) ) return true; // "new york"
  if (/\d/.test(display)) return true;                                // residual digits
  return false;
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log(`[estate-index] region=${REGION} (${cfg.state}) mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  // Raw groupable rows: one per scraped page that carries a testator_name.
  const rows = (await pool.query(`
    SELECT p.roll_group_id, p.testator_name, p.image_number, p.enslaved_count,
           pd.id AS doc_id, pd.collection_name, pd.document_year, pd.document_type, pd.canonical_person_id
    FROM probate_scrape_progress p
    JOIN person_documents pd ON pd.id = p.person_document_id
    WHERE p.state = $1 AND p.testator_name IS NOT NULL AND p.testator_name <> '' AND p.status = 'written'`,
    [cfg.state])).rows;

  // Fold pages → estates keyed by (roll, normKey(testator)).
  const estates = new Map();
  for (const r of rows) {
    const key = normKey(r.testator_name);
    if (!key) continue;
    const id = r.roll_group_id + '|' + key;
    let e = estates.get(id);
    if (!e) {
      const county = (r.collection_name || '').match(/^(.*?)\s+County\b/);
      const title = (r.collection_name || '').match(/—\s*(.+)$/);
      e = {
        roll_group_id: r.roll_group_id, decedent_key: key,
        decedent_name: cleanName(r.testator_name) || r.testator_name,
        county_name: county ? county[1].trim() : null,
        roll_title: title ? title[1].trim() : null,
        imgs: [], docs: [], years: [], enslaved: 0, canon: null,
        hasWill: false, hasInv: false,
      };
      estates.set(id, e);
    }
    e.imgs.push(r.image_number);
    e.docs.push(Number(r.doc_id));
    if (r.document_year != null) e.years.push(r.document_year);
    e.enslaved += (r.enslaved_count || 0);
    if (r.canonical_person_id && !e.canon) e.canon = Number(r.canonical_person_id);
    if (r.document_type === 'will') e.hasWill = true;
    if (r.document_type === 'estate_inventory') e.hasInv = true;
    // prefer the cleanest (longest) name variant as display
    const cand = cleanName(r.testator_name);
    if (cand && cand.length > e.decedent_name.length) e.decedent_name = cand;
  }

  const list = [...estates.values()].map((e) => {
    const ymin = e.years.length ? Math.min(...e.years) : null;
    const ymax = e.years.length ? Math.max(...e.years) : null;
    return {
      ...e,
      year_min: ymin, year_max: ymax,
      page_count: e.docs.length,
      img_min: Math.min(...e.imgs), img_max: Math.max(...e.imgs),
      slavery_era: ymin != null ? ymin < cfg.slaveryCutoff : null,
      year_plausible: ymin != null ? (ymin >= cfg.floor && ymax <= CEILING) : null,
      name_suspect: isNameSuspect(e.decedent_name, e.decedent_key),
    };
  });

  // Sanity summary
  const n = list.length;
  const ensEstates = list.filter((e) => e.enslaved > 0).length;
  const ensTotal = list.reduce((s, e) => s + e.enslaved, 0);
  const slavery = list.filter((e) => e.slavery_era).length;
  const suspect = list.filter((e) => e.name_suspect).length;
  const implausible = list.filter((e) => e.year_plausible === false).length;
  const linked = list.filter((e) => e.canon).length;
  const dated = list.filter((e) => e.year_min != null).length;
  console.log(`\n${n} estates  |  ${dated} dated  |  ${linked} linked to a canonical testator`);
  console.log(`enslaved: ${ensEstates} estates name enslaved people (${ensTotal} person-mentions)`);
  console.log(`slavery-era (year < ${cfg.slaveryCutoff}): ${slavery}`);
  console.log(`SANITY → name_suspect: ${suspect}  |  year_implausible (<${cfg.floor} or >${CEILING}): ${implausible}`);
  const byCounty = {};
  for (const e of list) byCounty[e.county_name || '?'] = (byCounty[e.county_name || '?'] || 0) + 1;
  console.log('by county:', Object.entries(byCounty).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join('  '));

  if (!APPLY) { console.log('\n(dry run — pass --apply to write the index)'); await pool.end(); return; }

  await pool.query(`DELETE FROM probate_estate_index WHERE region = $1`, [REGION]);
  let w = 0;
  for (const e of list) {
    await pool.query(`
      INSERT INTO probate_estate_index
        (region, state, county_name, roll_group_id, roll_title, decedent_name, decedent_key,
         canonical_person_id, page_count, image_number_min, image_number_max, page_doc_ids,
         year_min, year_max, enslaved_count_scrape, has_will, has_inventory,
         slavery_era, year_plausible, name_suspect)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (roll_group_id, decedent_key) DO UPDATE SET
        county_name=EXCLUDED.county_name, roll_title=EXCLUDED.roll_title,
        decedent_name=EXCLUDED.decedent_name, canonical_person_id=EXCLUDED.canonical_person_id,
        page_count=EXCLUDED.page_count, image_number_min=EXCLUDED.image_number_min,
        image_number_max=EXCLUDED.image_number_max, page_doc_ids=EXCLUDED.page_doc_ids,
        year_min=EXCLUDED.year_min, year_max=EXCLUDED.year_max,
        enslaved_count_scrape=EXCLUDED.enslaved_count_scrape, has_will=EXCLUDED.has_will,
        has_inventory=EXCLUDED.has_inventory, slavery_era=EXCLUDED.slavery_era,
        year_plausible=EXCLUDED.year_plausible, name_suspect=EXCLUDED.name_suspect,
        built_at=NOW()`,
      [REGION, cfg.state, e.county_name, e.roll_group_id, e.roll_title, e.decedent_name, e.decedent_key,
       e.canon, e.page_count, e.img_min, e.img_max, e.docs,
       e.year_min, e.year_max, e.enslaved, e.hasWill, e.hasInv,
       e.slavery_era, e.year_plausible, e.name_suspect]);
    if (++w % 2000 === 0) console.log(`  …${w}/${n}`);
  }

  // Attach the LLM forensic layer where it already exists (by roll + normalized decedent).
  const att = await pool.query(`
    UPDATE probate_estate_index i SET
      estate_extraction_id = x.id,
      enslaved_count_extracted = x.enslaved_count,
      total_appraised_usd = x.total_appraised_usd
    FROM probate_estate_extractions x
    WHERE i.region = $1 AND x.roll_group_id = i.roll_group_id
      AND regexp_replace(lower(x.decedent_name), '[^a-z ]', '', 'g') = i.decedent_key`,
    [REGION]);
  console.log(`\n✓ wrote ${w} estates; attached ${att.rowCount} LLM extractions.`);
  await pool.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
