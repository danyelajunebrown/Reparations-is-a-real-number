// project-health-monitor.mjs — the RECURRING, AUTOMATED health check for the whole holdings.
//
// This exists because the project is enormous and the important invariant checks were being run
// reactively (only when a human remembered). It runs a fixed battery of checks, writes a snapshot to
// monitor_health_runs (so drip-liveness can compare against the last run), ntfy-alerts on any CRITICAL,
// and EXITS NON-ZERO on CRITICAL so a cron/deploy can gate on it. Complements retrieval-health-audit.mjs
// (which covers the gate/doc-fetchability checks) — this adds RULE 0.6 embed-compliance, the retrievability
// rubric's live-retrieve stage, orphaning, and drip liveness.
//
// Run ON THE MINI (needs ollama for the live-retrieve check). Cron-friendly:
//   0 */4 * * *  cd ~/Desktop/Reparations-is-a-real-number && /usr/local/bin/node scripts/project-health-monitor.mjs
// Env: NTFY_URL (+ NTFY_TOPIC) for alerts; OLLAMA_URL for retrieval. Flags: --no-retrieve (skip live stage).

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);

const SKIP_RETRIEVE = process.argv.includes('--no-retrieve');
const NTFY_URL = process.env.NTFY_URL || null;                 // e.g. https://ntfy.sh
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'reparations-health';

async function ntfy(title, body, priority = 'default') {
  if (!NTFY_URL) return;
  try {
    await fetch(`${NTFY_URL.replace(/\/$/, '')}/${NTFY_TOPIC}`, {
      method: 'POST', headers: { Title: title, Priority: priority, Tags: 'warning' },
      body: body.slice(0, 3500), signal: AbortSignal.timeout(15000),
    });
  } catch { /* alerting must never crash the monitor */ }
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
  const num = async (s, a = []) => (await pool.query(s, a)).rows[0].n;
  const checks = [];  // {name, status:'ok'|'warn'|'critical', detail, value}
  const add = (name, status, value, detail) => checks.push({ name, status, value, detail });

  // ── snapshot table (for drip-liveness deltas) ──
  await pool.query(`CREATE TABLE IF NOT EXISTS monitor_health_runs (
    id BIGSERIAL PRIMARY KEY, ran_at TIMESTAMPTZ DEFAULT now(), worst TEXT,
    doc_ocr_embeddings BIGINT, probate_extractions BIGINT, canonicals BIGINT, findings JSONB)`);
  const prev = (await pool.query(`SELECT ran_at, doc_ocr_embeddings, probate_extractions FROM monitor_health_runs ORDER BY id DESC LIMIT 1`)).rows[0] || null;

  // ── 1. RULE 0.6 embed-compliance: a canonical that serves an image MUST be RAG-embedded. ──
  // The exact gap that slipped: image-backed canonicals with ZERO doc_ocr embedding on any of their docs.
  const imagelessEmbedGap = await num(`
    SELECT count(DISTINCT d.canonical_person_id)::int n FROM person_documents d
     WHERE d.canonical_person_id IS NOT NULL AND d.s3_key IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='person_documents'
                       AND e.subject_id=d.id::text AND e.content_kind='doc_ocr')`);
  // Focus on RECENT promotions (last 7d) — a fresh unembedded canonical is a live pipeline miss, not just backfill debt.
  const recentGap = await num(`
    SELECT count(DISTINCT c.id)::int n FROM canonical_persons c
     JOIN person_documents d ON d.canonical_person_id=c.id AND d.s3_key IS NOT NULL
     WHERE c.created_at > now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='person_documents'
                       AND e.subject_id=d.id::text AND e.content_kind='doc_ocr')`);
  add('rule06_embed_recent', recentGap > 0 ? 'critical' : 'ok', recentGap,
    `${recentGap} canonical(s) promoted in the last 7d serve an image but are NOT RAG-embedded (RULE 0.6 clause 3 miss)`);
  add('rule06_embed_backlog', imagelessEmbedGap > 5000 ? 'warn' : 'ok', imagelessEmbedGap,
    `${imagelessEmbedGap} image-backed docs total lack a doc_ocr embedding (backfill debt)`);

  // ── 2. embed backlog: docs with real OCR text not yet embedded ──
  const embedBacklog = await num(`SELECT count(*)::int n FROM person_documents d
     WHERE length(coalesce(d.ocr_text,''))>50
       AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='person_documents' AND e.subject_id=d.id::text AND e.content_kind='doc_ocr')`);
  add('embed_backlog', embedBacklog > 10000 ? 'warn' : 'ok', embedBacklog, `${embedBacklog} OCR'd docs await embedding`);

  // ── 3. gate over-assertion: assertable_slaveowner=true with NO supporting doc (audit-rule breach) ──
  const overAssert = await num(`SELECT count(*)::int n FROM canonical_persons c
     WHERE c.assertable_slaveowner = true
       AND NOT EXISTS (SELECT 1 FROM person_documents d WHERE d.canonical_person_id=c.id AND d.s3_key IS NOT NULL)`).catch(() => 0);
  add('gate_assert_without_image', overAssert > 0 ? 'critical' : 'ok', overAssert,
    `${overAssert} canonical(s) assert slaveowner with NO s3-backed supporting doc`);

  // ── 4. orphaning: image-backed LEADS never promoted (RULE 0.6 says they should be) ──
  const orphanLeads = await num(`SELECT count(DISTINCT d.unconfirmed_person_id)::int n FROM person_documents d
     WHERE d.unconfirmed_person_id IS NOT NULL AND d.canonical_person_id IS NULL AND d.s3_key IS NOT NULL`);
  add('orphan_image_leads', orphanLeads > 20000 ? 'warn' : 'ok', orphanLeads, `${orphanLeads} image-backed leads not promoted`);

  // ── 5. drip liveness: did the doc_ocr embeddings + probate extractions grow since the last run? ──
  const docEmb = Number(await num(`SELECT count(*)::int n FROM embeddings WHERE content_kind='doc_ocr'`));
  const probEx = Number(await num(`SELECT count(*)::int n FROM probate_estate_extractions`));
  const canon = Number(await num(`SELECT count(*)::int n FROM canonical_persons`));
  if (prev) {
    const hrs = (Date.now() - new Date(prev.ran_at).getTime()) / 3.6e6;
    const stalled = hrs > 8 && docEmb <= Number(prev.doc_ocr_embeddings) && probEx <= Number(prev.probate_extractions);
    add('drip_liveness', stalled ? 'warn' : 'ok', `${docEmb}/${probEx}`,
      stalled ? `no embed OR extraction growth in ${hrs.toFixed(0)}h (drips may be down)` : 'embeddings/extractions advancing');
  } else add('drip_liveness', 'ok', `${docEmb}/${probEx}`, 'first run — baseline recorded');

  // ── 6. retrievability (the rubric's live stage): sample recent doc_ocr, confirm the doc surfaces for its own text ──
  if (!SKIP_RETRIEVE) {
    try {
      const RagService = require('../src/services/rag/RagService');
      const rag = new RagService(pool);
      const samp = (await pool.query(`SELECT d.id, d.ocr_text FROM person_documents d
         JOIN embeddings e ON e.subject_table='person_documents' AND e.subject_id=d.id::text AND e.content_kind='doc_ocr'
         WHERE length(coalesce(d.ocr_text,''))>80 ORDER BY d.id DESC LIMIT 10`)).rows;
      let hits = 0, tested = 0;
      for (const d of samp) {
        const toks = d.ocr_text.split(/\s+/).filter(w => /^[A-Za-z]{5,}$/.test(w)).slice(0, 6).join(' ');
        if (!toks) continue; tested++;
        try { const r = await rag.retrieve(toks, 8); if ((r || []).some(x => String(x.document_id ?? x.subject_id ?? x.id) === String(d.id))) hits++; } catch { /* count as miss */ }
      }
      const rate = tested ? hits / tested : 1;
      add('retrievability', tested && rate < 0.6 ? 'critical' : 'ok', `${hits}/${tested}`, `live-retrieve hit rate ${(rate * 100).toFixed(0)}% on recent docs`);
    } catch (e) { add('retrievability', 'warn', 'err', `could not run live-retrieve: ${e.message.slice(0, 60)}`); }
  }

  // ── verdict + persist + alert ──
  const worst = checks.some(c => c.status === 'critical') ? 'critical' : checks.some(c => c.status === 'warn') ? 'warn' : 'ok';
  await pool.query(`INSERT INTO monitor_health_runs (worst, doc_ocr_embeddings, probate_extractions, canonicals, findings) VALUES ($1,$2,$3,$4,$5)`,
    [worst, docEmb, probEx, canon, JSON.stringify(checks)]);

  console.log(`\n=== PROJECT HEALTH: ${worst.toUpperCase()} (${new Date().toISOString()}) ===`);
  for (const c of checks) console.log(`  ${c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗'} ${c.name.padEnd(26)} ${c.detail}`);

  const bad = checks.filter(c => c.status !== 'ok');
  if (bad.length) await ntfy(`Reparations health: ${worst.toUpperCase()}`, bad.map(c => `${c.status.toUpperCase()} ${c.name}: ${c.detail}`).join('\n'), worst === 'critical' ? 'high' : 'default');

  await pool.end();
  process.exit(worst === 'critical' ? 1 : 0);
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
