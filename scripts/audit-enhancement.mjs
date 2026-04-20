import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const q = await pool.query(`
  SELECT
    lead_id,
    full_name                                                     AS db_depositor_name,
    context_text,
    (review_notes::jsonb)->>'image_num'                           AS image_num,
    (review_notes::jsonb)->'ledger_extraction'->>'record_header_name'  AS extracted_header,
    (review_notes::jsonb)->'ledger_extraction'->>'last_master'         AS extracted_master,
    (review_notes::jsonb)->'ledger_extraction'->>'old_title'           AS extracted_old_title,
    locations[1]                                                  AS branch
  FROM unconfirmed_persons
  WHERE extraction_method='freedmens_bank_index'
    AND review_notes::text LIKE '%google_vision_spatial_parser_v2%'
  ORDER BY locations[1], lead_id
`);

console.log(`Total enhanced rows: ${q.rowCount}`);

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length >= 3);
const shareToken = (a, b) => {
  const ta = norm(a), tb = norm(b);
  if (!ta.length || !tb.length) return false;
  return ta.some(x => tb.some(y => x === y || (x.length >= 4 && (y.startsWith(x.slice(0,4)) || x.startsWith(y.slice(0,4))))));
};

let matched = 0, unmatched = 0, noHeader = 0;
const suspicious = [];
for (const r of q.rows) {
  if (!r.extracted_header) { noHeader++; continue; }
  if (shareToken(r.db_depositor_name, r.extracted_header)) {
    matched++;
  } else {
    unmatched++;
    if (suspicious.length < 20) suspicious.push(r);
  }
}

const total = matched + unmatched;
const pct = total > 0 ? ((matched / total) * 100).toFixed(1) : '0.0';
console.log();
console.log(`Header present:                            ${q.rowCount - noHeader}`);
console.log(`  DB-name ↔ extracted-header share token:  ${matched}  (${pct}% of header-present rows)`);
console.log(`  DO NOT share any token:                  ${unmatched}`);
console.log(`Header missing (matched by acct# only):    ${noHeader}`);
console.log();
console.log('SUSPICIOUS SAMPLE (DB name vs extracted header different):');
console.log('  branch                    db_depositor                → extracted_header                       master=');
for (const r of suspicious) {
  const br = (r.branch || '').slice(0, 25).padEnd(25);
  const dn = (r.db_depositor_name || '').slice(0, 28).padEnd(28);
  const eh = (r.extracted_header || '').slice(0, 35).padEnd(35);
  const mm = (r.extracted_master || '').slice(0, 30);
  console.log(`  ${br} "${dn}" → "${eh}"  master="${mm}"`);
}

// Also: for rows that have a master value, how often is the master a plausible name vs clearly OCR garbage?
const withMaster = q.rows.filter(r => r.extracted_master && r.extracted_master.trim());
let garbageMasters = 0, goodMasters = 0;
for (const r of withMaster) {
  const m = r.extracted_master.trim();
  // Heuristic: "good" master = contains at least one word >= 3 letters that isn't all-lowercase punctuation/numbers
  const tokens = m.split(/\s+/).filter(t => /[A-Za-z]{3,}/.test(t));
  if (tokens.length >= 1) goodMasters++;
  else garbageMasters++;
}
console.log();
console.log(`Enhanced rows with extracted master:       ${withMaster.length}`);
console.log(`  plausible (has 1+ word ≥3 letters):      ${goodMasters}`);
console.log(`  likely garbage (all short/punctuation):  ${garbageMasters}`);

await pool.end();
