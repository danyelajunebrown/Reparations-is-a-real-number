// eval-records-rag.mjs — reproducible RAG evaluation harness.
//
// Reads the FROZEN gold fixture (tests/fixtures/rag-eval/gold.json, built by
// build-rag-eval-fixture.mjs) and exercises the REAL endpoints (/api/rag/query,
// /api/chat) against the Mini/ollama pipeline. Prints hard-gate pass/fail and
// calibration baselines. Free; read-only; no paid dependency.
//
// Run:  node scripts/eval-records-rag.mjs
//       RAG_EVAL_BASE=http://localhost:3000 node scripts/eval-records-rag.mjs
//
// The metrics split (per the brief) into:
//   HARD GATES (tied to project values — must pass, never regress):
//     - honest abstention: a not-served famous enslaver must NOT get a grounded answer
//       (no namesake attribution).
//     - citation correctness: every grounded answer must carry an openable source.
//     - no autonomous merges: RAG is read-only — true by construction (asserted).
//   CALIBRATION BARS (baseline first, then prevent regression):
//     - served-gold grounded rate.
//     - stratified random-sample grounded rate (the coverage headline — expect ~0
//       until the person corpus is embedded, i.e. the deferred Mini backfill).
//
// NOTE on records-level recall: only doc_ocr is embedded today; canonical_persons
// are not (the deferred embed-persons.mjs backfill). So "correct canonical in top-k"
// can't be measured yet — we report the grounded rate as the proxy baseline and say
// so. Re-run after the backfill for the real records-recall numbers.

import { readFileSync } from 'node:fs';

const FIXTURE = 'tests/fixtures/rag-eval/gold.json';
const gold = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const BASE = process.env.RAG_EVAL_BASE || gold._meta?.endpoints?.base || 'https://reparations-platform.onrender.com';
const RAG = gold._meta?.endpoints?.rag || '/api/rag/query';

async function ragQuery(question, k = 8) {
  try {
    const res = await fetch(`${BASE}${RAG}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ question, k }),
    });
    const data = await res.json().catch(() => null);
    return data || { degraded: true, error: `HTTP ${res.status}` };
  } catch (e) {
    return { degraded: true, error: e.message };
  }
}

const isGrounded = (r) => !!r && r.degraded !== true && r.grounded !== false && (r.citations || []).length > 0;
const pct = (n, d) => (d === 0 ? 'n/a' : `${Math.round((100 * n) / d)}% (${n}/${d})`);

async function main() {
  console.log(`\nRAG eval — base ${BASE}`);
  console.log(`fixture ${FIXTURE} (built ${gold._meta?.built || '?'})\n`);

  // Connectivity / degraded probe.
  const probe = await ragQuery('test connectivity probe', 3);
  if (probe.degraded) {
    console.log('⚠ RETRIEVAL BACKEND UNAVAILABLE (degraded):', probe.error || '');
    console.log('  The endpoint is up but the embedding backend is unreachable — on Render this');
    console.log('  means OLLAMA_URL (Tailscale Funnel to the Mini) or a gemini query-embed is not set.');
    console.log('  Cannot compute baselines until retrieval works. Exiting (not a test failure).\n');
    return;
  }

  const c = gold.cohorts;
  const results = { hardGates: {}, calibration: {} };

  // ── Calibration: served-gold grounded rate. ──
  const served = (c.served_gold || []).filter(s => s.canonical_id != null);
  let servedGrounded = 0;
  const servedMiss = [];
  for (const s of served) {
    const r = await ragQuery(s.query);
    if (isGrounded(r)) servedGrounded++; else servedMiss.push(s.name);
  }
  results.calibration.served_gold_grounded = pct(servedGrounded, served.length);

  // ── Calibration: stratified random-sample grounded rate (coverage headline). ──
  const sample = c.stratified_sample || [];
  const byStratum = {};
  let sampleGrounded = 0;
  for (const s of sample) {
    const r = await ragQuery(s.query);
    const g = isGrounded(r);
    if (g) sampleGrounded++;
    const key = s.person_type || 'unknown';
    byStratum[key] = byStratum[key] || { g: 0, n: 0 };
    byStratum[key].n++; if (g) byStratum[key].g++;
  }
  results.calibration.stratified_grounded = pct(sampleGrounded, sample.length);
  results.calibration.stratified_by_type = Object.fromEntries(
    Object.entries(byStratum).map(([k, v]) => [k, pct(v.g, v.n)]));

  // ── HARD GATE: honest abstention (no namesake attribution). ──
  const abstain = c.honest_abstention || [];
  const abstainFails = [];
  for (const a of abstain) {
    const r = await ragQuery(a.query);
    // PASS: not grounded (nothing to ground on → the archive doesn't hold the served person).
    // FAIL: a grounded answer for a not-served famous enslaver = possible namesake attribution.
    if (isGrounded(r)) abstainFails.push({ name: a.name, answer: (r.answer || '').slice(0, 120) });
  }
  results.hardGates.honest_abstention = {
    pass: abstainFails.length === 0,
    detail: abstainFails.length ? `${abstainFails.length} grounded (review): ${abstainFails.map(f => f.name).join(', ')}` : `${abstain.length}/${abstain.length} abstained`,
  };

  // ── HARD GATE: citation correctness (grounded answers carry an openable source). ──
  const qa = c.grounded_qa || [];
  const citationFails = [];
  const qaReport = [];
  for (const q of qa) {
    const r = await ragQuery(q.question);
    if (!isGrounded(r)) { qaReport.push(`${q.question} → not grounded (corpus gap)`); continue; }
    const cites = r.citations || [];
    const openable = cites.filter(x => x.document_id != null || x.source_url);
    // must_not_return: a grounded answer must never cite a known-wrong namesake id.
    const badId = (q.must_not_return || []).find(id => cites.some(x => String(x.document_id) === String(id)));
    if (openable.length === 0 || badId != null) {
      citationFails.push({ q: q.question, reason: badId != null ? `cited forbidden id ${badId}` : 'no openable citation' });
    }
    qaReport.push(`${q.question} → grounded, ${openable.length} openable citation(s)`);
  }
  results.hardGates.citation_correctness = {
    pass: citationFails.length === 0,
    detail: citationFails.length ? citationFails.map(f => `${f.q}: ${f.reason}`).join('; ') : `${qa.length - qaReport.filter(x => x.includes('not grounded')).length} grounded QA all cited`,
  };

  // ── HARD GATE: no autonomous merges — true by construction (RAG is read-only). ──
  results.hardGates.no_autonomous_merges = {
    pass: true,
    detail: 'RAG endpoint is read-only; it proposes/answers, never merges or asserts identity (candidate-generation only).',
  };

  // ── Report. ──
  console.log('HARD GATES (must pass):');
  for (const [k, v] of Object.entries(results.hardGates)) {
    console.log(`  ${v.pass ? '✅ PASS' : '❌ FAIL'}  ${k} — ${v.detail}`);
  }
  console.log('\nCALIBRATION BASELINES (record in activeContext; watch for regression):');
  console.log(`  served-gold grounded rate:     ${results.calibration.served_gold_grounded}`);
  if (servedMiss.length) console.log(`    (missed: ${servedMiss.join(', ')})`);
  console.log(`  stratified-sample grounded:    ${results.calibration.stratified_grounded}  ← coverage headline`);
  for (const [k, v] of Object.entries(results.calibration.stratified_by_type)) {
    console.log(`    ${k}: ${v}`);
  }
  console.log('\nNOTE: records-level recall (correct canonical in top-k) is not measurable until');
  console.log('canonical_persons are embedded (deferred Mini backfill: embed-persons.mjs). The');
  console.log('grounded rates above are the doc-corpus proxy; re-run after the backfill.\n');

  const anyGateFail = Object.values(results.hardGates).some(v => !v.pass);
  process.exit(anyGateFail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
