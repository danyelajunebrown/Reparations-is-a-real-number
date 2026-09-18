// promote-marronnage-named.mjs — promote image-backed marronnage depositors from leads to canonical persons.
//
// WHY NOW: 4,113 self-liberating people sit in unconfirmed_persons. A lead does not serve a DAA — it is a
// staging row. 2,193 of them carry an S3-archived newspaper scan and all 4,113 are embedded, so they clear
// RULE 0.6 (discrete · serves an image · in RAG) today, with no browser and no new acquisition.
//
// GATES KEPT, NOT LOOSENED
//   · Biscoe: PersonService.promoteToCanonical refuses ambiguous matches -> needs_review. Same-name
//     collisions are SEVERE here (many Jean-Pierres, many Marie-Jeannes across seven colonies), so a
//     mononym is never auto-merged. Ambiguity landing in review is the CORRECT outcome, not a failure.
//   · Only image-backed leads are promoted. The 1,920 without a surviving scan stay leads — the source
//     itself has no image for them, and RULE 0.6 exists precisely so we cannot assert what we cannot show.
//   · person_type stays 'enslaved' as the SOURCE describes them; the self-liberation act is already carried
//     on the documents and harm_events, not inferred here.
//
// THE POINTER BUG IS FIXED UPSTREAM: promoteToCanonical now writes confirmed_individual_id, so these
// promotions will not join the 68,319 orphans that recorded a status without its link.
//
// Usage: node scripts/promote-marronnage-named.mjs [--limit N] [--apply]
import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const LIMIT = +val('--limit', 3000);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 600000, query_timeout: 600000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));
const svc = new PersonService(pool);

const rows = (await pool.query(`
  SELECT DISTINCT ON (u.lead_id)
         u.lead_id, u.full_name, u.locations,
         d.s3_key, d.source_url, d.document_date, d.name_as_appears, d.page_reference,
         x.external_id
    FROM unconfirmed_persons u
    JOIN person_external_ids x ON x.subject_table='unconfirmed_persons' AND x.subject_id=u.lead_id
                              AND x.id_system='marronnage_named'
    JOIN person_documents d ON d.unconfirmed_person_id=u.lead_id AND d.s3_key IS NOT NULL
   WHERE COALESCE(u.status,'') <> 'promoted'
   ORDER BY u.lead_id
   LIMIT $1`, [LIMIT])).rows;

console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} ${rows.length} image-backed marronnage leads`);
if (rows.length) console.log(`  sample: ${rows.slice(0, 6).map((r) => r.full_name).join(' · ')}`);

const st = { created: 0, linked: 0, needs_review: 0, rejected: 0, err: 0 };
for (const r of rows) {
  if (!APPLY) { st.created++; continue; }
  try {
    const out = await svc.promoteToCanonical(
      { subject_table: 'unconfirmed_persons', subject_id: r.lead_id },
      { personType: 'enslaved',
        externalId: r.external_id, idSystem: 'marronnage_named',
        sourceType: 'secondary', createdBy: 'promote-marronnage-named', confidence: 0.85,
        document: { s3Key: r.s3_key, sourceUrl: r.source_url,
          documentType: 'runaway_advertisement', evidenceStrength: 'primary',
          nameAsAppears: r.name_as_appears || r.full_name } },
      { dryRun: false });
    if (out.action === 'created') st.created++;
    else if (out.action === 'linked') st.linked++;
    else if (out.action === 'needs_review') st.needs_review++;
    else st.rejected++;
  } catch (e) { st.err++; if (st.err <= 5) console.error(`  ! ${r.full_name} (#${r.lead_id}): ${e.message.slice(0, 90)}`); }
  const n = st.created + st.linked + st.needs_review + st.rejected;
  if (n % 100 === 0) process.stdout.write(`\r  created ${st.created} · linked ${st.linked} · review ${st.needs_review} · rejected ${st.rejected} · err ${st.err}   `);
}
console.log(`\n=== ${JSON.stringify(st)} ===`);
if (APPLY) console.log('RULE 0.5 — canonical profiles: node scripts/embed-verbs.mjs --kind canonicals --apply (cron */25 also covers this)');
else console.log('(dry run — pass --apply)');
await pool.end();
