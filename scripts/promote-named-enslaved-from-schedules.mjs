// promote-named-enslaved-from-schedules.mjs — promote the enslaved people a schedule enumerator ACTUALLY
// NAMED, which the existing RULE 0.6 promoter structurally cannot reach.
//
// WHY A SEPARATE SCRIPT INSTEAD OF REUSING promote-image-backed-leads.mjs
//   That promoter requires BOTH an external id and an image:
//       JOIN person_external_ids e ON ... AND e.id_system = $1
//   Measured 2026-08-19, for person_type='enslaved':
//       248,958 leads have an external id (almost all enslaved_org_qid) — and NO image
//       105,230 leads are image-backed                                   — and NO external id
//         0     have BOTH
//   The two sets are DISJOINT, so that promoter can never promote an enslaved person, however often it
//   runs. Enslavers do not have this problem: their id and their scan come from the same ingest. For the
//   enslaved, identity and image arrive from different ingests that never met.
//
//   The fix is NOT to relax that join. Of those 105,230 image-backed leads, 103,363 were FABRICATED
//   one-row-per-tally-mark placeholders ("Unknown (Female, age 4)") — relaxing the gate would have pushed
//   a hundred thousand invented people into canonical_persons looking like progress. Those are quarantined
//   by quarantine-tally-mark-placeholders.mjs. What remains here is the real minority: people whose names
//   an enumerator wrote down and OCR recovered — July, Henry, Jack, Sam, Daniel, Charles.
//
// IDENTITY WITHOUT AN EXTERNAL SYSTEM
//   These leads have no external registry id, so this mints a deterministic one:
//       id_system  = 'slave_schedule_named'
//       external_id= 'sched:<person_document_id>:<normalised name>'
//   Deterministic means re-runs resolve to the SAME lead instead of duplicating (the tier-1b path in
//   PersonService.resolve), which is the property the external id was carrying all along.
//
// GATES KEPT, NOT LOOSENED (RULE 0.6)
//   discrete (Biscoe — PersonService.promoteToCanonical refuses ambiguous → needs_review) ·
//   serves an image (s3_key required) · embedded afterwards (--embed prints the command; RULE 0.5).
//   A mononym is NOT auto-merged onto an existing canonical: same-name collisions here are severe
//   (three Dicks, three Joes on one Farm Book roll), and promoteToCanonical's ambiguity guard is the
//   protection. Anything ambiguous lands in needs_review for a human, which is the correct outcome.
//
// Usage: node scripts/promote-named-enslaved-from-schedules.mjs [--limit N] [--apply]

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const li = A.indexOf('--limit'); const LIMIT = li > -1 ? +A[li + 1] : 5000;
const ID_SYSTEM = 'slave_schedule_named';
const PLACEHOLDER_RE = `u.full_name ~* '^(unknown|unnamed)\\s*\\((male|female|m|f)[^)]*\\)$'`;

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, query_timeout: 300000 });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  const svc = new PersonService(pool);
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  const rows = (await pool.query(`
    SELECT DISTINCT ON (u.lead_id)
           u.lead_id, u.full_name, u.gender, u.birth_year, u.locations,
           d.id AS doc_id, d.s3_key, d.source_url, d.document_type, d.name_as_appears
      FROM unconfirmed_persons u
      JOIN person_documents d ON d.unconfirmed_person_id = u.lead_id AND d.s3_key IS NOT NULL
     WHERE u.person_type = 'enslaved'
       AND u.full_name IS NOT NULL
       AND COALESCE(u.status,'') NOT IN ('promoted','placeholder_aggregate','rejected')
       AND NOT (${PLACEHOLDER_RE})
     ORDER BY u.lead_id
     LIMIT $1`, [LIMIT])).rows;

  console.log(`named, image-backed enslaved leads to promote: ${rows.length}`);
  if (!rows.length) { await pool.end(); return; }
  console.log(`sample: ${rows.slice(0, 8).map((r) => r.full_name).join(' · ')}`);

  const st = { created: 0, linked: 0, needs_review: 0, rejected: 0, err: 0 };
  for (const r of rows) {
    const externalId = `sched:${r.doc_id}:${norm(r.full_name)}`;
    if (!APPLY) { st.created++; continue; }
    try {
      // Record the deterministic identity FIRST, so a re-run resolves to this lead (tier-1b) rather than
      // fuzzy-matching a mononym across 3.2M leads — the failure that married five Monticello children to
      // an enslaved woman in Louisiana earlier in this project.
      await pool.query(
        `INSERT INTO person_external_ids (subject_table, subject_id, id_system, external_id, external_url, confidence)
         VALUES ('unconfirmed_persons', $1, $2, $3, $4, 0.8) ON CONFLICT (id_system, external_id) DO NOTHING`,
        [r.lead_id, ID_SYSTEM, externalId, r.source_url]).catch((e) => console.error(`   ! extid ${r.lead_id}: ${e.message.slice(0, 70)}`));

      const out = await svc.promoteToCanonical(
        { subject_table: 'unconfirmed_persons', subject_id: r.lead_id },
        { personType: 'enslaved', externalId, idSystem: ID_SYSTEM, sourceType: 'secondary',
          createdBy: 'promote-named-enslaved-from-schedules', confidence: 0.8,
          document: { s3Key: r.s3_key, sourceUrl: r.source_url,
            documentType: r.document_type || 'slave_schedule', evidenceStrength: 'primary',
            nameAsAppears: r.name_as_appears || r.full_name } },
        { dryRun: false });
      if (out.action === 'created') st.created++;
      else if (out.action === 'linked') st.linked++;
      else if (out.action === 'needs_review') st.needs_review++;
      else st.rejected++;
    } catch (e) { st.err++; if (st.err <= 5) console.error(`   ! ${r.full_name} (#${r.lead_id}): ${e.message.slice(0, 90)}`); }
    if ((st.created + st.linked + st.needs_review + st.rejected) % 100 === 0) {
      process.stdout.write(`\r  created ${st.created}, linked ${st.linked}, review ${st.needs_review}, rejected ${st.rejected}, err ${st.err}   `);
    }
  }

  console.log(`\n=== ${JSON.stringify(st)} ===`);
  if (APPLY) console.log(`RULE 0.5 — now embed: node scripts/embed-leads.mjs --id-system ${ID_SYSTEM}`);
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
