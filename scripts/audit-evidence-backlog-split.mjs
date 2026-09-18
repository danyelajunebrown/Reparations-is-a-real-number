// audit-evidence-backlog-split.mjs — is the evidence backlog UNDOCUMENTED, or merely UNLINKED?
//
// WHY THIS EXISTS (operator, 2026-08-21). audit-source-inference-review reports:
//     freedperson  82,565 rows —  0% public,  0% evidenced
//     enslaver    413,513 rows —  8% public, 10% evidenced
//     enslaved    233,602 rows — 31% public, 31% evidenced
// and retrieval-health-audit has been alerting gate_assert_without_doc = 68,336 CRITICAL every six hours.
//
// The obvious reading is "these people have no documents." That reading has been WRONG before, in this
// exact shape, at this exact scale:
//   · "no attached scan ⇒ not assertable" hid 243,209 enslaved people who were perfectly assertable.
//   · promoteToCanonical mints a canonical but writes NEITHER confirmed_individual_id back on the lead NOR
//     the external id across, so 9,601 recent promotions were orphaned from BOTH directions — embedded as
//     leads, invisible as canonicals. Same defect left 68,320 leads with status='promoted' and a null
//     pointer.
//   · Florida/Champlin was marked scraped with zero people; a completion nobody earned.
// Every one of those is a LINK that was never written being mistaken for a FACT about the archive.
//
// So this script REFUSES to summarise. It splits the backlog into buckets that imply different remedies:
//
//   A. DOC ON THE CANONICAL, NO S3            — we know the document, we never archived the image.
//                                               Remedy: fetch + dual-archive (rule 8). Cheap.
//   B. DOC ON THE ORIGIN LEAD, NOT CARRIED    — the evidence EXISTS and the promotion dropped it.
//                                               Remedy: relink. Free. This is pure bookkeeping debt.
//   C. LEAD REACHABLE ONLY VIA EXTERNAL ID    — confirmed_individual_id null, but person_external_ids
//                                               bridges canonical↔lead. Remedy: backfill the pointer.
//   D. NO DOCUMENT ANYWHERE                   — genuinely undocumented. Remedy: harvesting, not linking.
//                                               ONLY these belong in a "we need more sources" number.
//   E. EVIDENCED BUT GATE NOT LIFTED          — has an s3-backed doc yet assertable_* is false.
//                                               Remedy: re-run the gate. The people are already provable.
//
// A/B/C/E are OUR debt and cost nothing but code. D is the real archive gap. Reporting them as one number
// would put 100% of the weight on "go find more records" when much of it is "write the row you skipped".
//
// READ-ONLY. Writes nothing, changes nothing.
//
// Usage: node scripts/audit-evidence-backlog-split.mjs [--type freedperson] [--save]

import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const ONLY = val('--type', null);
const SAVE = A.includes('--save');
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

const TYPES = ONLY ? [ONLY] : ['freedperson', 'enslaver', 'enslaved', 'unknown'];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
    statement_timeout: 900000, query_timeout: 900000 });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));

  const out = [];
  for (const t of TYPES) {
    process.stdout.write(`\n  measuring ${t}…`);
    const r = (await pool.query(`
      WITH pop AS (
        SELECT cp.id, cp.assertable_slaveowner, cp.assertable_enslaved
          FROM canonical_persons cp
         WHERE cp.person_type = $1
      ),
      doc AS (
        -- carry the gate flags through; the outer query needs them for bucket E
        SELECT p.id, p.assertable_slaveowner, p.assertable_enslaved,
               EXISTS (SELECT 1 FROM person_documents d
                        WHERE d.canonical_person_id = p.id AND d.s3_key IS NOT NULL)       AS c_s3,
               EXISTS (SELECT 1 FROM person_documents d
                        WHERE d.canonical_person_id = p.id)                                 AS c_any,
               -- the origin lead, reached the way the promoter SHOULD have recorded it
               EXISTS (SELECT 1 FROM unconfirmed_persons u
                        JOIN person_documents d ON d.unconfirmed_person_id = u.lead_id
                       WHERE u.confirmed_individual_id = p.id::text
                         AND d.s3_key IS NOT NULL)                                          AS lead_s3,
               -- the lead reachable only by an external-id bridge (pointer never written)
               -- COLUMN TYPES, checked not guessed (two crashes taught me): person_external_ids.subject_id
               -- is INTEGER (not text), person_documents.unconfirmed_person_id is INTEGER, and
               -- unconfirmed_persons.confirmed_individual_id is VARCHAR — hence the one ::text cast above
               -- and none here.
               EXISTS (SELECT 1 FROM person_external_ids ec
                        JOIN person_external_ids el
                          ON el.id_system = ec.id_system AND el.external_id = ec.external_id
                         AND el.subject_table = 'unconfirmed_persons'
                        JOIN person_documents d ON d.unconfirmed_person_id = el.subject_id
                       WHERE ec.subject_table = 'canonical_persons' AND ec.subject_id = p.id
                         AND d.s3_key IS NOT NULL)                                          AS xid_s3
          FROM pop p
      )
      SELECT count(*)::int total,
             count(*) FILTER (WHERE c_s3)::int                                            AS a_evidenced,
             count(*) FILTER (WHERE NOT c_s3 AND c_any)::int                              AS a_doc_no_s3,
             count(*) FILTER (WHERE NOT c_s3 AND NOT c_any AND lead_s3)::int              AS b_lead_dropped,
             count(*) FILTER (WHERE NOT c_s3 AND NOT c_any AND NOT lead_s3 AND xid_s3)::int AS c_xid_only,
             count(*) FILTER (WHERE NOT c_s3 AND NOT c_any AND NOT lead_s3 AND NOT xid_s3)::int AS d_nothing,
             count(*) FILTER (WHERE c_s3 AND NOT (assertable_slaveowner OR assertable_enslaved))::int AS e_gate_unlifted
        FROM doc`, [t])).rows[0];
    out.push({ type: t, ...r });
    process.stdout.write(' done');
  }

  console.log('\n\n════ IS THE BACKLOG UNDOCUMENTED, OR MERELY UNLINKED? ════\n');
  for (const r of out) {
    console.log(`── ${r.type}  (${r.total.toLocaleString()} canonicals)`);
    const line = (label, n, note) =>
      console.log(`     ${String(n).padStart(8)}  ${String(pct(n, r.total) + '%').padStart(6)}  ${label.padEnd(34)} ${note}`);
    line('EVIDENCED (s3-backed doc)', r.a_evidenced, '✓ already provable');
    line('A. doc known, image not archived', r.a_doc_no_s3, '→ fetch + dual-archive (rule 8)');
    line('B. doc on origin lead, not carried', r.b_lead_dropped, '→ RELINK. free. our bug.');
    line('C. lead reachable only via ext id', r.c_xid_only, '→ backfill confirmed_individual_id');
    line('D. no document anywhere', r.d_nothing, '→ genuine archive gap: HARVEST');
    line('E. evidenced but gate not lifted', r.e_gate_unlifted, '→ re-run the gate; already provable');
    console.log('');
  }

  const T = out.reduce((a, r) => ({
    total: a.total + r.total, a_doc_no_s3: a.a_doc_no_s3 + r.a_doc_no_s3,
    b: a.b + r.b_lead_dropped, c: a.c + r.c_xid_only, d: a.d + r.d_nothing, e: a.e + r.e_gate_unlifted,
  }), { total: 0, a_doc_no_s3: 0, b: 0, c: 0, d: 0, e: 0 });
  const ours = T.a_doc_no_s3 + T.b + T.c + T.e;

  console.log('════ WHAT THIS MEANS ════');
  console.log(`  OUR debt (fixable in code, no new sources): ${ours.toLocaleString()}`);
  console.log(`  REAL archive gap (needs harvesting):        ${T.d.toLocaleString()}`);
  console.log(`  ratio: ${pct(ours, ours + T.d)}% of the "unevidenced" backlog is bookkeeping, not absence.`);
  console.log('\n  Only bucket D belongs in a sentence that begins "we do not have records for…".');

  if (SAVE) {
    await pool.query(
      `INSERT INTO research_findings (question, repository, index_searched, result, hit_count, evidence_note, searched_by)
       VALUES ($1,$2,$3,'hit',$4,$5,'audit-evidence-backlog-split')`,
      ['Of the canonicals with no evidence, how many are genuinely undocumented versus merely unlinked?',
       'internal — canonical_persons x person_documents x unconfirmed_persons x person_external_ids',
       'full population scan by person_type', T.total,
       `SPLIT ${JSON.stringify(out)} · OUR_DEBT ${ours} (doc-not-archived + dropped-at-promotion + ext-id-only + gate-unlifted) ` +
       `vs REAL_ARCHIVE_GAP ${T.d}. Measured because "no attached scan => not assertable" previously hid 243,209 ` +
       `assertable enslaved people, and promoteToCanonical orphaning left 9,601 promotions unreachable from both ` +
       `directions. A missing LINK is not a fact about the archive.`]);
    console.log('\n✓ split saved to research_findings');
  }
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
