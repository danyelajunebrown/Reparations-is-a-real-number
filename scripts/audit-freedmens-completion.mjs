// audit-freedmens-completion.mjs — READ-ONLY. The true completion state of the Freedmen's Bank corpus before
// any normalization/promotion. No writes. Answers: of the freedmens depositor leads, how many carry an
// enslaved_by (last_master) annotation, how many of those enslaver NAMES survive the mint gate (i.e. would
// become a real enslaver lead vs. get rejected as OCR junk/place-word), and how many depositors are embedded.
//
// Usage: node scripts/audit-freedmens-completion.mjs

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { isValidPersonName, isNameSuspect } = require('../src/utils/person-name-validator');

const FREED = "extraction_method IN ('freedmens_bank_index','freedmens_bank_ocr')";
const NAME_CAP = 250000;  // safety cap on names pulled into memory for the gate pass

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 300000 });
  const n = async (sql) => (await pool.query(sql)).rows[0].n;

  const total = await n(`SELECT count(*)::int n FROM unconfirmed_persons WHERE ${FREED}`);
  const withEnslaver = await n(`SELECT count(*)::int n FROM unconfirmed_persons WHERE ${FREED} AND relationships @> '[{"type":"enslaved_by"}]'`);
  const embedded = await n(`SELECT count(*)::int n FROM embeddings e JOIN unconfirmed_persons u ON u.lead_id::text=e.subject_id WHERE e.subject_table='unconfirmed_persons' AND u.${FREED}`);
  const alreadyEdged = await n(`SELECT count(*)::int n FROM enslaved_owner_relationships WHERE relationship_source ~* 'freedmen' OR created_by ~* 'freedmen'`);

  console.log(`\n=== FREEDMEN'S BANK COMPLETION AUDIT (read-only) ===`);
  console.log(`depositor leads TOTAL          : ${total.toLocaleString()}`);
  console.log(`  with enslaved_by annotation  : ${withEnslaver.toLocaleString()}  (${(100*withEnslaver/total).toFixed(1)}%)`);
  console.log(`  depositors embedded (RAG)    : ${embedded.toLocaleString()}  (${(100*embedded/total).toFixed(1)}%)`);
  console.log(`enslaved_owner edges (freedmens): ${alreadyEdged.toLocaleString()}`);

  // Pull the enslaver name (+ its self-reported quality) and run each through the REAL mint gate.
  console.log(`\nrunning mint gate over the enslaver names…`);
  const { rows } = await pool.query(
    `SELECT (jsonb_path_query_first(relationships, '$[*] ? (@.type == "enslaved_by")')->>'name') AS enslaver,
            (jsonb_path_query_first(relationships, '$[*] ? (@.type == "enslaved_by")')->>'name_quality') AS nq
       FROM unconfirmed_persons
      WHERE ${FREED} AND relationships @> '[{"type":"enslaved_by"}]'
      LIMIT ${NAME_CAP}`);

  let pass = 0, suspect = 0, invalid = 0, blank = 0;
  const nq = {}; const distinct = new Set(); const okS = [], badS = [];
  for (const r of rows) {
    const name = (r.enslaver || '').trim();
    nq[r.nq || '(none)'] = (nq[r.nq || '(none)'] || 0) + 1;
    if (!name) { blank++; continue; }
    if (!isValidPersonName(name)) { invalid++; if (badS.length < 10) badS.push(`✗inv "${name}"`); continue; }
    if (isNameSuspect(name)) { suspect++; if (badS.length < 10) badS.push(`✗sus "${name}"`); continue; }
    pass++; distinct.add(name.toLowerCase().replace(/\s+/g, ' '));
    if (okS.length < 10) okS.push(name);
  }
  const scanned = rows.length;
  console.log(`\nenslaver names scanned          : ${scanned.toLocaleString()}${scanned >= NAME_CAP ? ' (CAPPED — more exist)' : ''}`);
  console.log(`  PASS mint gate (real enslaver): ${pass.toLocaleString()}  (${(100*pass/Math.max(scanned,1)).toFixed(1)}%)  → ~${distinct.size.toLocaleString()} distinct names`);
  console.log(`  suspect (place/status word)   : ${suspect.toLocaleString()}`);
  console.log(`  invalid (OCR junk/empty)      : ${(invalid+blank).toLocaleString()}`);
  console.log(`  self-reported name_quality    : ${JSON.stringify(nq)}`);
  console.log(`\n  sample PASS enslavers: ${okS.map(s => `"${s}"`).join(', ')}`);
  console.log(`  sample REJECTED      : ${badS.join('  ')}`);
  console.log(`\n(read-only — no rows written)`);
  await pool.end();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
