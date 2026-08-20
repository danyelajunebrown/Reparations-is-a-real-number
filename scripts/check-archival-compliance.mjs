// check-archival-compliance.mjs — make the standing rules SELF-REPORTING instead of trusting anyone to
// remember them. Non-zero exit on violation, so project-health-monitor (RULE 0.7, free) surfaces it.
//
// WHY THIS EXISTS. Operator, 2026-08-20: "why do you keep ignoring rules?" Fair, and the honest diagnosis
// is structural: the rules are encoded in the SCRIPTS, not in the operator's head or mine. Reusing
// archive-amelia-freedmens-images.mjs gets you S3 + Wayback + sha256 for free; writing a one-off archiver
// inline rebuilds it from scratch and silently drops whatever the standard enforced. That is exactly how
// 23 artifacts reached S3 with no Wayback witness (20 of them from an earlier session, so it is a standing
// leak, not a lapse). A rule nothing checks is a preference.
//
// Checks (each maps to a written standard):
//   rule 8   — every S3-archived source has a Wayback witness + sha256
//   RULE 0.5 — every ingested lead class is embedded (unretrievable data is a silo)
//   RULE 0.6 — no canonical promoted without an image-backed document
//   audit 5  — no fabricated placeholder person rows loose in the population
//
// Usage: node scripts/check-archival-compliance.mjs [--json]
import 'dotenv/config';
import pg from 'pg';

const AS_JSON = process.argv.includes('--json');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const one = async (sql) => (await pool.query(sql)).rows[0];
const checks = [];

const a = await one(`SELECT count(*) FILTER (WHERE s3_key IS NOT NULL)::int s3,
                            count(*) FILTER (WHERE s3_key IS NOT NULL AND wayback_url IS NULL)::int no_wb,
                            count(*) FILTER (WHERE s3_key IS NOT NULL AND sha256 IS NULL)::int no_sha
                       FROM source_artifacts`);
checks.push({ rule: 'rule 8 — dual archive', ok: a.no_wb === 0 && a.no_sha === 0,
  detail: `${a.s3} in S3 · ${a.no_wb} missing Wayback · ${a.no_sha} missing sha256`,
  fix: 'node scripts/backfill-wayback-snapshots.mjs --apply' });

const b = await one(`SELECT count(*)::int loose FROM unconfirmed_persons
   WHERE person_type='enslaved' AND full_name ~* '^(unknown|unnamed)\\s*\\((male|female|m|f)\\b[^)]*\\)$'
     AND COALESCE(status,'') <> 'placeholder_aggregate'`);
checks.push({ rule: 'audit rule 5 — no fabricated people', ok: b.loose === 0,
  detail: `${b.loose} tally-mark placeholder rows loose in the person population`,
  fix: 'node scripts/quarantine-tally-mark-placeholders.mjs --apply  (and check the SOURCE is patched)' });

const c = await one(`SELECT count(*)::int unembedded FROM canonical_persons cp
   WHERE cp.created_at > now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='canonical_persons' AND e.subject_id=cp.id::text)
     AND NOT EXISTS (SELECT 1 FROM unconfirmed_persons u JOIN embeddings e2
                       ON e2.subject_table='unconfirmed_persons' AND e2.subject_id=u.lead_id::text
                      WHERE u.confirmed_individual_id = cp.id::text)`);
checks.push({ rule: 'RULE 0.5 — recent promotions embedded', ok: c.unembedded === 0,
  detail: `${c.unembedded} canonicals promoted in 30d with no embedding path`,
  fix: 'node scripts/embed-leads.mjs --id-system <sys>  /  scripts/embed-verbs.mjs' });

const d = await one(`SELECT count(*)::int n FROM canonical_persons cp
   WHERE cp.created_at > now() - interval '30 days' AND cp.person_type IN ('enslaver','enslaved')
     AND NOT EXISTS (SELECT 1 FROM person_documents pd WHERE pd.canonical_person_id=cp.id AND pd.s3_key IS NOT NULL)`);
checks.push({ rule: 'RULE 0.6 — promotions serve an image', ok: d.n === 0,
  detail: `${d.n} canonicals promoted in 30d with no image-backed document`, fix: 'attach scans, or reverse the promotion' });

if (AS_JSON) console.log(JSON.stringify(checks, null, 1));
else {
  console.log('\n════ ARCHIVAL / RETRIEVABILITY COMPLIANCE ════');
  for (const c2 of checks) {
    console.log(`  ${c2.ok ? 'PASS' : 'FAIL'}  ${c2.rule}`);
    console.log(`        ${c2.detail}`);
    if (!c2.ok) console.log(`        fix: ${c2.fix}`);
  }
}
await pool.end();
process.exit(checks.every((c3) => c3.ok) ? 0 : 1);
