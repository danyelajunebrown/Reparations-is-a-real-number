// backfill-wayback-snapshots.mjs — rule 8 says every archived source is DUAL-archived: S3 (ours) plus an
// independent Wayback witness. Audit 2026-08-20: 218 artifacts in S3, 196 snapshotted, 23 with no witness.
// Only 2 were recent; 20 were the Jefferson Farm Book from an earlier session. So this is a STANDING leak,
// which is why the fix is a backfill plus a check, not a resolution to be more careful.
// Idempotent and safe to re-run; failures are logged, never swallowed.
import 'dotenv/config';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const rows = (await pool.query(
  `SELECT artifact_key, dataset_label, source_url FROM source_artifacts
    WHERE s3_key IS NOT NULL AND wayback_url IS NULL AND source_url IS NOT NULL
    ORDER BY dataset_label`)).rows;
console.log(`${rows.length} artifact(s) archived to S3 with no Wayback witness${APPLY ? '' : ' [DRY RUN]'}`);

let ok = 0, fail = 0;
for (const r of rows) {
  if (!APPLY) { console.log(`  would snapshot ${r.dataset_label}: ${r.source_url.slice(0, 70)}`); continue; }
  const wb = await ensureSnapshot(r.source_url).catch((e) => { console.error(`  ! ${r.artifact_key}: ${e.message}`); return null; });
  if (wb) { await pool.query(`UPDATE source_artifacts SET wayback_url=$1 WHERE artifact_key=$2`, [wb, r.artifact_key]); ok++; }
  else { fail++; console.log(`  ✗ no snapshot: ${r.dataset_label} (${r.source_url.slice(0, 60)})`); }
  await new Promise((s) => setTimeout(s, 3000));   // Save-Page-Now is rate limited; be a good citizen
}
if (APPLY) console.log(`\n✓ ${ok} snapshotted · ${fail} failed (re-run to retry)`);
await pool.end();
