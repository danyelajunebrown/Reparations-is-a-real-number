#!/usr/bin/env node
/**
 * Phase-1 retrieval-integrity harness (the deploy gate). Exercises the REAL frontend retrieval path
 * and records failures to retrieval_health_ledger (M106), so silent availability bugs — like the
 * FamilySearch-login-wall (a doc that exists in the DB but isn't deliverable) — surface automatically.
 *
 * Checks:
 *   GATE INTEGRITY (DB-only, fast, runs anywhere):
 *     - gate_assert_without_doc (CRITICAL): canonical is publicly assertable but has NO qualifying
 *       STORED (s3_key) doc → we'd assert slaveowner/enslaved with nothing retrievable behind it.
 *     - gate_stale_lift (LOW): has a qualifying stored doc but is NOT assertable (recompute drift).
 *     - person_no_blocking_keys (WARN): canonical with a name but 0 blocking keys → orphaned from the
 *       dedup/resolve pool (the silo class).
 *   DOCUMENT AVAILABILITY:
 *     - doc_unavailable_loginwall (HIGH, DB-only): no s3_key + FamilySearch/external source_url →
 *       not deliverable (renders as a link/login wall, not the document).
 *     - doc_dead (HIGH, DB-only): no s3_key and no source_url → no way to view at all.
 *     - doc_s3_unfetchable (CRITICAL, NETWORK): has s3_key but the S3 object HEAD != 200 → broken
 *       archived doc. Needs network (run on the Mini); degrades to 'skipped' where S3 is unreachable.
 *
 * Writes per-subject ledger rows for failures (capped per class), an aggregate summary, computes a
 * health SCORE, and exits non-zero if any CRITICAL failures exist (so a deploy can gate on it).
 *
 *   node scripts/retrieval-health-audit.mjs                 # DB checks + write ledger
 *   node scripts/retrieval-health-audit.mjs --s3 --s3-sample 500   # also HEAD-check S3 objects (Mini)
 *   node scripts/retrieval-health-audit.mjs --dry           # report only, no ledger write
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);
// Proposition→doc-type lists: prefer PersonService's (single source of truth) when present; fall back
// to an inline copy so this harness runs standalone on hosts with an older checkout (e.g. the Mini
// cron). Keep in sync with PersonService.DOC_PROP_* if those change.
let SO, EN;
try { const PS = require('../src/services/PersonService'); SO = PS.DOC_PROP_SLAVEOWNER; EN = PS.DOC_PROP_ENSLAVED; } catch { /* older checkout */ }
if (!SO || !EN) {
  SO = ['census_slave_schedule','slave_schedule','census','will','will_testament','estate_inventory','estate_account','guardian_account','compensated_emancipation_petition','compensation_petition','emancipation_petition','plantation_record','bill_of_sale','slave_manifest','tax_record','court_record','insurance_register','government_disclosure','corporate_disclosure','correspondence'];
  EN = ['will','will_testament','estate_inventory','estate_account','compensated_emancipation_petition','emancipation_petition','plantation_record','freedmens_bank','certificate_of_freedom','slave_narrative','freedman_narrative','narrative','evacuation_roll','enslaved_census_brazil','enslaved_census','probate_enslaved_records','bill_of_sale','slave_manifest','correspondence'];
}

const DRY = process.argv.includes('--dry');
const DO_S3 = process.argv.includes('--s3');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const S3_SAMPLE = parseInt(arg('--s3-sample', '300'), 10);
const CAP = 500;                              // max per-subject ledger rows per failure class
const RUN_ID = crypto.randomUUID();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const rows = [];   // ledger rows to insert
const summary = {};
const note = (subject_type, subject_id, check_name, status, severity, detail) =>
  rows.push({ subject_type, subject_id: String(subject_id), check_name, status, severity, detail });

async function dbCheck(name, severity, subjectType, sql, params = []) {
  const r = await pool.query(sql, params);
  const total = r.rowCount;
  summary[name] = { severity, count: total };
  r.rows.slice(0, CAP).forEach(row => note(subjectType, row.id, name, 'fail', severity, row.detail || null));
  if (total > CAP) summary[name].truncated = total - CAP;
  console.log(`  ${total === 0 ? 'OK  ' : 'FAIL'} ${name} (${severity}): ${total.toLocaleString()}`);
  return total;
}

(async () => {
  try {
    console.log(`=== retrieval-health-audit run ${RUN_ID} ${DRY ? '(DRY)' : ''} ===`);

    // ── GATE INTEGRITY ──────────────────────────────────────────────────────
    await dbCheck('gate_assert_without_doc', 'critical', 'canonical_person', `
      SELECT id, jsonb_build_object('assertable_slaveowner',assertable_slaveowner,'assertable_enslaved',assertable_enslaved) detail
      FROM canonical_persons cp
      WHERE (assertable_slaveowner AND NOT EXISTS (SELECT 1 FROM person_documents d WHERE d.canonical_person_id=cp.id AND d.s3_key IS NOT NULL AND d.document_type = ANY($1)))
         OR (assertable_enslaved   AND NOT EXISTS (SELECT 1 FROM person_documents d WHERE d.canonical_person_id=cp.id AND d.s3_key IS NOT NULL AND d.document_type = ANY($2)))`,
      [SO, EN]);

    await dbCheck('gate_stale_lift', 'low', 'canonical_person', `
      SELECT id FROM canonical_persons cp
      WHERE (NOT assertable_slaveowner AND EXISTS (SELECT 1 FROM person_documents d WHERE d.canonical_person_id=cp.id AND d.s3_key IS NOT NULL AND d.document_type = ANY($1)))
         OR (NOT assertable_enslaved   AND EXISTS (SELECT 1 FROM person_documents d WHERE d.canonical_person_id=cp.id AND d.s3_key IS NOT NULL AND d.document_type = ANY($2)))`,
      [SO, EN]);

    // Orphan from the dedup/resolve pool: a named canonical with zero blocking keys.
    await dbCheck('person_no_blocking_keys', 'warn', 'canonical_person', `
      SELECT cp.id FROM canonical_persons cp
      WHERE cp.canonical_name IS NOT NULL AND length(trim(cp.canonical_name)) > 1
        AND cp.person_type <> 'merged'
        AND NOT EXISTS (SELECT 1 FROM person_blocking_keys k WHERE k.subject_table='canonical_persons' AND k.subject_id=cp.id)
      LIMIT 5000`);

    // ── DOCUMENT AVAILABILITY (DB-only) ─────────────────────────────────────
    await dbCheck('doc_unavailable_loginwall', 'high', 'person_document', `
      SELECT id, jsonb_build_object('document_type',document_type,'source_url',left(source_url,80)) detail
      FROM person_documents
      WHERE (s3_key IS NULL OR s3_key='') AND source_url ILIKE '%familysearch%'
      LIMIT 5000`);

    await dbCheck('doc_dead', 'high', 'person_document', `
      SELECT id FROM person_documents
      WHERE (s3_key IS NULL OR s3_key='') AND (source_url IS NULL OR source_url='') AND (s3_url IS NULL OR s3_url='')
      LIMIT 5000`);

    // ── DOCUMENT S3 FETCHABILITY (network; sample) ──────────────────────────
    if (DO_S3) {
      const sample = (await pool.query(
        `SELECT id, s3_key FROM person_documents WHERE s3_key IS NOT NULL AND s3_key<>'' ORDER BY random() LIMIT $1`, [S3_SAMPLE])).rows;
      let checked = 0, broken = 0, skipped = 0;
      let S3; try { S3 = require('../src/services/storage/S3Service'); } catch { S3 = null; }
      if (S3 && typeof S3.init === 'function') { try { await S3.init(); } catch { /* noop */ } }
      // present(key): true | false | null(unknown). Prefer objectExists (direct HEAD); else presign+HEAD.
      const present = async (key) => {
        if (!S3) return null;
        try {
          if (typeof S3.objectExists === 'function') return await S3.objectExists(key);
          const getUrl = S3.getViewUrl || S3.getSignedUrl || S3.getPresignedUrl;
          if (getUrl) { const u = await getUrl.call(S3, key, 60); const r = await fetch(u, { method: 'HEAD' }); return r.ok; }
        } catch { return null; }
        return null;
      };
      for (const d of sample) {
        const ok = await present(d.s3_key);
        if (ok === null) { skipped++; continue; }
        checked++;
        if (!ok) { broken++; note('person_document', d.id, 'doc_s3_unfetchable', 'fail', 'critical', { s3_key: d.s3_key }); }
      }
      summary.doc_s3_unfetchable = { severity: 'critical', count: broken, checked, skipped, sampleOf: S3_SAMPLE };
      console.log(`  ${broken === 0 ? 'OK  ' : 'FAIL'} doc_s3_unfetchable (critical): ${broken} broken of ${checked} checked (${skipped} skipped/no-network)`);
    } else {
      console.log('  -- doc_s3_unfetchable: SKIPPED (pass --s3 on a networked host, e.g. the Mini)');
    }

    // ── score + persist ─────────────────────────────────────────────────────
    const critical = Object.values(summary).filter(s => s.severity === 'critical').reduce((a, s) => a + s.count, 0);
    const high = Object.values(summary).filter(s => s.severity === 'high').reduce((a, s) => a + s.count, 0);
    console.log('\n=== summary ===');
    Object.entries(summary).forEach(([k, v]) => console.log(`  ${k}: ${JSON.stringify(v)}`));
    console.log(`\nCRITICAL failures: ${critical.toLocaleString()} | HIGH: ${high.toLocaleString()}`);
    const deployOk = critical === 0;
    console.log(`DEPLOY GATE: ${deployOk ? 'PASS (no critical retrieval failures)' : 'BLOCK (critical retrieval failures present)'}`);

    // ntfy (self-contained) — alert when the continuous cron finds critical/high failures.
    const hook = process.env.OPS_NOTIFY_WEBHOOK;
    if (hook && (critical > 0 || high > 0)) {
      const detail = Object.entries(summary).filter(([, v]) => v.count > 0).map(([k, v]) => `${k}=${v.count}`).join(' ');
      const msg = `retrieval-health: ${critical} CRITICAL, ${high} high | gate=${deployOk ? 'PASS' : 'BLOCK'} | ${detail}`;
      try { await fetch(hook, { method: 'POST', body: msg.slice(0, 400) }); console.log('  (ntfy alert sent)'); } catch { /* noop */ }
    }

    if (!DRY) {
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);
        const vals = [], params = []; const C = 7;
        chunk.forEach((r, idx) => { const b = idx * C; vals.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7}::jsonb)`); params.push(RUN_ID, r.subject_type, r.subject_id, r.check_name, r.status, r.severity, r.detail ? JSON.stringify(r.detail) : null); });
        if (vals.length) await pool.query(`INSERT INTO retrieval_health_ledger (run_id, subject_type, subject_id, check_name, status, severity, detail) VALUES ${vals.join(',')}`, params);
      }
      console.log(`\nwrote ${rows.length.toLocaleString()} ledger rows (run ${RUN_ID}).`);
    }
    process.exitCode = deployOk ? 0 : 1;
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 2; }
  finally { await pool.end(); }
})();
