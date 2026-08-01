// backfill-ny-county.mjs — retroactive companion to link-ny-probate-testators.mjs's #3 fix.
//
// The link script minted every NY-probate testator canonical with primary_state='New York' and a NULL
// primary_county — the province-wide "Albany" will-book mislabel (colonial NY prerogative wills merely FILED
// at Albany). The #3 fix now derives county from the testator's RESIDENCE phrase at NEW mint. This script
// applies that same derivation to the EXISTING image-backed rows that predate the fix.
//
// Target: canonical_persons linked by person_external_ids.id_system='ny_probate_testator'
// (created_by='link-ny-probate') with primary_state='New York' AND primary_county IS NULL. For each, read
// its linked person_documents.ocr_text and parse the residence county with the SAME parseResidenceCounty /
// NY_COUNTIES logic (copied verbatim from link-ny-probate-testators.mjs). County is validated against the
// real NY-county set — noisy OCR cannot invent a county. NULL stays NULL when no confident match: no
// regression, never guess.
//
// Idempotent (only touches primary_county IS NULL), batched, resumable (each batch narrows the remaining
// NULL set). Dry-run by default (reports would-set count + county distribution); --apply performs UPDATEs.
//
// Usage: node scripts/backfill-ny-county.mjs [--limit N] [--apply]

import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const li = A.indexOf('--limit'); const LIMIT = li > -1 ? +A[li + 1] : Infinity;
const APPLY = A.includes('--apply');
const BATCH = 500;

// ── copied VERBATIM from scripts/link-ny-probate-testators.mjs (do not diverge) ──────────────────────────
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
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });

  const total = (await pool.query(
    `SELECT count(*)::int n
       FROM canonical_persons cp
       JOIN person_external_ids e ON e.canonical_person_id = cp.id AND e.id_system = 'ny_probate_testator'
      WHERE cp.primary_state = 'New York' AND cp.primary_county IS NULL`)).rows[0].n;
  console.log(`NY-probate testator canonicals with NULL county: ${total}${APPLY ? '' : '  [DRY-RUN]'}`);

  let seen = 0, parsed = 0, updated = 0, batches = 0;
  const dist = {};                 // county -> count of would-set / did-set
  let cursor = 0;                  // id watermark for resumable paging (also skips no-match rows in dry-run)

  for (;;) {
    if (seen >= LIMIT) break;
    // Pull a batch of still-NULL targets past the cursor, each with its linked docs' OCR (ordered by doc id,
    // capped like the mint's left(ocr,3000)). Scanning all of a person's docs is a superset of the mint's
    // first-doc behavior — validated parse means extra text can only help, never write garbage.
    const { rows } = await pool.query(
      `SELECT cp.id,
              array_agg(left(d.ocr_text, 3000) ORDER BY d.id)
                FILTER (WHERE d.ocr_text IS NOT NULL AND length(d.ocr_text) > 0) AS ocrs
         FROM canonical_persons cp
         JOIN person_external_ids e ON e.canonical_person_id = cp.id AND e.id_system = 'ny_probate_testator'
         LEFT JOIN person_documents d ON d.canonical_person_id = cp.id
        WHERE cp.primary_state = 'New York' AND cp.primary_county IS NULL AND cp.id > $1
        GROUP BY cp.id
        ORDER BY cp.id
        LIMIT $2`, [cursor, BATCH]);
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    seen += rows.length;

    const ids = [], counties = [];
    for (const r of rows) {
      let county = null;
      for (const ocr of (r.ocrs || [])) { county = parseResidenceCounty(ocr); if (county) break; }
      if (!county) continue;
      parsed++;
      dist[county] = (dist[county] || 0) + 1;
      ids.push(r.id); counties.push(county);
    }

    if (APPLY && ids.length) {
      // Only overwrite rows that are STILL NULL — idempotent under concurrent/repeat runs. Guard state too.
      const upd = await pool.query(
        `UPDATE canonical_persons cp SET primary_county = m.county
           FROM unnest($1::int[], $2::text[]) AS m(id, county)
          WHERE cp.id = m.id AND cp.primary_state = 'New York' AND cp.primary_county IS NULL
          RETURNING cp.id`, [ids, counties]);
      updated += upd.rows.length;   // rowCount unreliable on HTTP driver — count RETURNING rows
    }
    batches++;
    process.stdout.write(`\r  scanned ${seen}/${total}, county-parsed ${parsed}${APPLY ? `, updated ${updated}` : ''}   `);
  }

  console.log(`\n\n=== ${APPLY ? 'APPLIED' : 'DRY-RUN'} ===`);
  console.log(`scanned:        ${seen}`);
  console.log(`would-set/set:  ${parsed}${APPLY ? `  (rows updated: ${updated})` : ''}`);
  console.log(`no-match (NULL): ${seen - parsed}`);
  console.log(`batches:        ${batches}`);
  const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  console.log(`\ncounty distribution (${sorted.length} distinct counties):`);
  for (const [c, n] of sorted) {
    const ok = NY_COUNTIES.has(c.toLowerCase());
    console.log(`  ${ok ? ' ' : '!!'} ${c.padEnd(16)} ${n}${ok ? '' : '   <-- NON-NY-COUNTY GARBAGE'}`);
  }
  const garbage = sorted.filter(([c]) => !NY_COUNTIES.has(c.toLowerCase()));
  console.log(`\nnon-NY-county values written: ${garbage.length === 0 ? 'NONE (all validated)' : garbage.map(g => g[0]).join(', ')}`);

  await pool.end();
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
