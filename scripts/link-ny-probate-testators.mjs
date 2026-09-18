// link-ny-probate-testators.mjs — #3: resolve the ~78K ORPHANED NY-probate docs to persons by creating an
// assertable canonical per named decedent and linking their will/probate scans. The docs already serve an
// image (s3_key) and carry the testator name — the gap was person-linkage, not extraction.
//
// Per decedent (roll_group_id + testator_name, junk-screened): create a canonical (person_type='enslaver'
// when the estate names enslaved people, else 'unknown'), blocking keys, ext-id (id_system=
// 'ny_probate_testator'), then LINK all that decedent's unlinked docs → canonical_person_id, then gate
// (assertable_slaveowner when enslaved_count>0). Set-based/batched. Resumable (skips already-linked).
//
// Usage: node scripts/link-ny-probate-testators.mjs [--limit N] [--apply]

import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const li = A.indexOf('--limit'); const LIMIT = li > -1 ? +A[li + 1] : Infinity;
const APPLY = A.includes('--apply');
const BATCH = 500;
const JUNK = "'^(albany|new york|sole|deceased|late|the |image|estate|will |no |unknown|county|surrogate|liber|folio|page|ditto|do\\.?$)'";

const norm = (s) => (s == null ? '' : String(s)).toLowerCase().replace(/[^a-z0-9]/g, '');

// NY counties — used to VALIDATE a residence-phrase county so noisy OCR can't invent one.
const NY_COUNTIES = new Set(['albany','allegany','bronx','broome','cattaraugus','cayuga','chautauqua','chemung','chenango','clinton','columbia','cortland','delaware','dutchess','erie','essex','franklin','fulton','genesee','greene','hamilton','herkimer','jefferson','kings','lewis','livingston','madison','monroe','montgomery','nassau','niagara','oneida','onondaga','ontario','orange','orleans','oswego','otsego','putnam','queens','rensselaer','richmond','rockland','saratoga','schenectady','schoharie','schuyler','seneca','steuben','suffolk','sullivan','tioga','tompkins','ulster','warren','washington','wayne','westchester','wyoming','yates']);
// Parse the testator's residence COUNTY from the will/probate OCR ("of Fishkill in the County of Dutchess",
// "Dutchess County ss"). THE #3 FIX: link:54 minted every NY testator with primary_state='New York' and NO
// county — which is why the province-wide "Albany" will-book (colonial NY prerogative wills, merely FILED at
// Albany) mislabeled Dutchess/Ulster/Kings testators. County belongs to the RESIDENCE phrase, not the
// collection label. Validated against real NY counties; NULL when no confident match (no regression).
function parseResidenceCounty(ocr) {
  if (!ocr) return null;
  const t = String(ocr).replace(/\s+/g, ' ');
  const m = t.match(/county of ([A-Za-z][A-Za-z]+)/i) || t.match(/\b([A-Za-z][A-Za-z]+)\s+county\b/i);
  if (!m) return null;
  const key = m[1].toLowerCase().replace(/[^a-z]/g, '');
  return NY_COUNTIES.has(key) ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

function parseName(full) { const parts = String(full || '').trim().split(/[\s,]+/).filter(Boolean); if (!parts.length) return { first: '', last: '' }; if (String(full).includes(',')) return { first: parts[1] || '', last: parts[0] }; return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : '' }; }

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
  const total = (await pool.query(
    `SELECT count(*)::int n FROM (SELECT DISTINCT sp.roll_group_id, lower(trim(sp.testator_name)) tn
       FROM probate_scrape_progress sp JOIN person_documents d ON d.id=sp.person_document_id
      WHERE d.collection_key LIKE '%new-york-probate%' AND d.canonical_person_id IS NULL AND d.unconfirmed_person_id IS NULL
        AND sp.testator_name ~* '[a-z]{2,}[ ,].*[a-z]{2,}' AND sp.testator_name !~* ${JUNK}) x`)).rows[0].n;
  console.log(`NY probate decedents to link: ${total}${APPLY ? '' : ' [DRY-RUN]'}`);
  if (!APPLY) { await pool.end(); return; }

  let made = 0, docs = 0, batches = 0;
  for (;;) {
    if (made >= LIMIT) break;
    const { rows } = await pool.query(
      `SELECT sp.roll_group_id AS roll, sp.testator_name AS name, max(COALESCE(sp.enslaved_count,0))::int enslaved,
              (array_agg(left(d.ocr_text, 3000) ORDER BY d.id))[1] AS ocr
         FROM probate_scrape_progress sp JOIN person_documents d ON d.id=sp.person_document_id
        WHERE d.collection_key LIKE '%new-york-probate%' AND d.canonical_person_id IS NULL AND d.unconfirmed_person_id IS NULL
          AND sp.testator_name ~* '[a-z]{2,}[ ,].*[a-z]{2,}' AND sp.testator_name !~* ${JUNK}
        GROUP BY 1,2 LIMIT $1`, [BATCH]);
    if (!rows.length) break;
    const names = [], firsts = [], lasts = [], ptypes = [], rolls = [], keys = [], enslaved = [], counties = [];
    for (const r of rows) {
      const { first, last } = parseName(r.name);
      names.push(r.name); firsts.push(first || null); lasts.push(last || null);
      ptypes.push(r.enslaved > 0 ? 'enslaver' : 'unknown'); rolls.push(r.roll);
      keys.push('nyp:' + r.roll + ':' + norm(r.name)); enslaved.push(r.enslaved);
      counties.push(parseResidenceCounty(r.ocr));   // #3 fix: derive county from the residence phrase
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const ins = await c.query(
        `INSERT INTO canonical_persons (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone, person_type, primary_state, primary_county, confidence_score, verification_status, created_by)
         SELECT b.name, b.first, b.last, soundex(COALESCE(b.first,'')), soundex(COALESCE(b.last,'')), metaphone(COALESCE(b.last,''),8), b.ptype, 'New York', b.county, 0.85, 'promoted', 'pc:'||b.k
           FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[]) AS b(name,first,last,ptype,k,county)
         RETURNING id, created_by`, [names, firsts, lasts, ptypes, keys, counties]);
      const cid = {}, cidArr = [], keyArr = [], nameArr = [], enslArr = [];
      for (let i = 0; i < ins.rows.length; i++) { const k = ins.rows[i].created_by.slice(3); cid[k] = ins.rows[i].id; }
      // build parallel arrays keyed to canonical id for the doc-link + ext-id + keys
      for (let i = 0; i < keys.length; i++) { const id = cid[keys[i]]; if (!id) continue; cidArr.push(id); keyArr.push(keys[i]); nameArr.push(names[i]); enslArr.push(enslaved[i]); rolls[i] = rolls[i]; }
      // ext-ids
      await c.query(
        `INSERT INTO person_external_ids (canonical_person_id, subject_table, subject_id, id_system, external_id, confidence)
         SELECT m.cid, 'canonical_persons', m.cid, 'ny_probate_testator', m.k, 0.85 FROM unnest($1::int[],$2::text[]) AS m(cid,k)
         ON CONFLICT (id_system, external_id) DO NOTHING`, [cidArr, keyArr]);
      // blocking keys
      await c.query(
        `INSERT INTO person_blocking_keys (subject_table, subject_id, canonical_person_id, key_type, key_value)
         SELECT 'canonical_persons', m.cid, m.cid, k.key_type, k.key_value
           FROM unnest($1::int[],$2::text[]) AS m(cid,name) CROSS JOIN LATERAL derive_blocking_keys(m.name, NULL, NULL) k
         ON CONFLICT (subject_table, subject_id, key_value) DO NOTHING`, [cidArr, nameArr]);
      // LINK the orphaned docs → canonical (join via probate_scrape_progress roll+testator)
      const dm = await c.query(
        `UPDATE person_documents d SET canonical_person_id = m.cid
           FROM probate_scrape_progress sp, unnest($1::int[],$2::text[]) AS m(cid,k)
          WHERE d.id=sp.person_document_id AND d.canonical_person_id IS NULL AND d.unconfirmed_person_id IS NULL
            AND ('nyp:'||sp.roll_group_id||':'||regexp_replace(lower(sp.testator_name),'[^a-z0-9]','','g')) = m.k
          RETURNING 1`, [cidArr, keyArr]);
      // gate + clean created_by
      await c.query(
        `UPDATE canonical_persons SET created_by='link-ny-probate',
            assertable_slaveowner = (person_type='enslaver')
          WHERE id = ANY($1::int[])`, [cidArr]);
      await c.query('COMMIT');
      made += cidArr.length; docs += dm.rows.length; batches++;
    } catch (e) { await c.query('ROLLBACK'); console.error('\nbatch ROLLBACK:', e.message); break; }
    finally { c.release(); }
    process.stdout.write(`\r  decedents ${made}/${total}, docs linked ${docs}   `);
  }
  await pool.end();
  console.log(`\n=== done: ${made} decedent canonicals, ${docs} docs linked, ${batches} batches ===`);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
