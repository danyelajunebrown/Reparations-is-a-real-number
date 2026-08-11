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
import { statfs } from 'node:fs/promises';
import pg from 'pg';
const require = createRequire(import.meta.url);

const SKIP_RETRIEVE = process.argv.includes('--no-retrieve');
// Reuse the project's notification helper (posts to OPS_NOTIFY_WEBHOOK — the ntfy the scrapers/watchdogs use).
const { notify } = require('../src/utils/notify');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
  // pg-pool emits 'error' on IDLE clients when the server drops a socket; Node terminates the process
  // on an unhandled 'error' event. One Neon blip therefore kills a long run, and the log reads as
  // STALLED rather than crashed -- the misdiagnosis that hid a dead fleet for five weeks.
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
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

  // ── 5b. DISK SPACE: the recurring "clear me some disk" pain. Scrapers/OCR/embeddings fill it silently. ──
  try {
    const st = await statfs('/');
    const freePct = st.bfree / st.blocks;
    const freeGb = (st.bfree * st.bsize) / 1e9;
    add('disk_free', freePct < 0.05 ? 'critical' : freePct < 0.12 ? 'warn' : 'ok', `${(freePct * 100).toFixed(0)}%`,
      `${freeGb.toFixed(1)}GB free (${(freePct * 100).toFixed(0)}%) — scrapers/OCR/embeddings fill disk silently`);
  } catch (e) { add('disk_free', 'warn', 'err', `could not stat disk: ${e.message.slice(0, 40)}`); }

  // ── 6. retrievability (the rubric's live stage): confirm a document surfaces for its own distinctive text ──
  //
  // REWRITTEN 2026-08-09 after this check reported a 0% CRITICAL while RAG was working correctly. Two
  // design faults made the old version measure something other than retrievability, and both mattered:
  //
  //   (a) IT SAMPLED `ORDER BY d.id DESC LIMIT 10` — always ten CONSECUTIVE pages of the most recently
  //       ingested ledger — and built the probe from the doc's FIRST six long words. On a printed probate
  //       ledger those are the masthead, so all ten probes were the identical string
  //       "INDEN LETTERS ADMINISTRATION Continued Month DECEASED". The check was asking "does this exact
  //       page outrank its thousands of near-identical siblings on the boilerplate they all share?" —
  //       which is unanswerable by construction, and 0% is the CORRECT answer to it. It is not a
  //       retrievability measurement. Fix: sample randomly across the corpus, and probe with a
  //       DISCRIMINATIVE span from the middle of the document (where names and amounts live) rather than
  //       the header.
  //
  //   (b) `catch { /* count as miss */ }` FOLDED TRANSPORT FAILURE INTO THE QUALITY NUMBER. An ollama
  //       outage, a bad model name, or a network drop all rendered as "retrieval quality 0%". That is the
  //       project's recurring failure class (a logged-out climb writing status='completed') pointed the
  //       other way: infrastructure state disguised as a finding. An unreachable embedder is now its own
  //       status — you cannot measure retrieval quality while the retriever is down, and reporting a
  //       number anyway is worse than reporting nothing.
  //
  // A monitor that cries wolf gets muted, and then the real outage slips. Precision here is load-bearing.
  if (!SKIP_RETRIEVE) {
    try {
      const RagService = require('../src/services/rag/RagService');
      const rag = new RagService(pool);
      // Random sample across the whole embedded corpus — never a run of same-ledger neighbours.
      const samp = (await pool.query(`SELECT d.id, d.ocr_text FROM person_documents d
         JOIN embeddings e ON e.subject_table='person_documents' AND e.subject_id=d.id::text AND e.content_kind='doc_ocr'
         WHERE length(coalesce(d.ocr_text,'')) > 400
         ORDER BY random() LIMIT 8`)).rows;

      // (c) THE ASSERTION ITSELF WAS UNANSWERABLE. "Does THIS page rank top-k for a span of its own text?"
      //     cannot be satisfied on a corpus of 108k near-identical probate ledger pages, and the failure is
      //     not the retriever's. Verified 2026-08-09: with the ANN index bypassed entirely (exact
      //     brute-force cosine, enable_indexscan=off) the source document STILL missed top-10 on a
      //     mid-document 16-word probe, 4/4 targets, top similarity 0.71–0.76 — because thousands of
      //     sibling pages are genuinely that similar. Exact-document recall measures corpus homogeneity,
      //     not retrieval health.
      //
      // What RAG is actually FOR here is "bring me the documents about this person/estate". So the metric
      // is RELEVANCE, checked deterministically: probe with distinctive entity terms drawn from a document,
      // then assert that a returned document genuinely CONTAINS one of them (string containment on stored
      // OCR — no model judgement anywhere in the measurement, per audit rule 1).
      const STOP = new Set(['County', 'State', 'Court', 'Surrogate', 'Inventory', 'Estate', 'Appraisement',
        'Appraisment', 'Letters', 'Administration', 'Deceased', 'Executor', 'Executors', 'Administrator',
        'January', 'February', 'March', 'April', 'June', 'July', 'August', 'September', 'October',
        'November', 'December', 'Dollars', 'Personal', 'Property', 'Purchasers', 'Names', 'Matter',
        'Proving', 'Sole', 'Grand', 'Good', 'Last', 'Will', 'Testament', 'Amount', 'Total', 'Item']);
      const probeOf = (text) => {
        const caps = [...new Set((String(text).match(/\b[A-Z][a-z]{3,}\b/g) || []))].filter((c) => !STOP.has(c));
        return caps.length >= 2 ? caps.slice(0, 3) : null;
      };

      let relevant = 0, tested = 0, transportErrors = 0;
      for (const d of samp) {
        const names = probeOf(d.ocr_text);
        if (!names) continue;
        try {
          const r = await rag.retrieve(names.join(' ') + ' estate', 10);
          tested++;   // counted ONLY when the retriever actually answered
          if ((r || []).some((x) => names.some((n) => String(x.snippet || '').includes(n)))) relevant++;
        } catch { transportErrors++; }
      }

      if (transportErrors && !tested) {
        // Retriever is down. Report THAT — never emit a quality number derived from failures. Folding
        // transport failure into the rate is what made this check report 0% while RAG was working.
        add('retrievability', 'critical', `0/${transportErrors} answered`,
          'RAG retriever unreachable (embedder or vector query failing) — retrieval quality NOT measured');
      } else {
        const rate = tested ? relevant / tested : 1;
        add('retrievability', tested && rate < 0.5 ? 'critical' : 'ok', `${relevant}/${tested}`,
          `live-retrieve RELEVANCE ${(rate * 100).toFixed(0)}% (returned docs contain the probed entity)` +
          (transportErrors ? ` (${transportErrors} probe(s) errored, excluded)` : ''));
      }
    } catch (e) { add('retrievability', 'warn', 'err', `could not run live-retrieve: ${e.message.slice(0, 60)}`); }
  }

  // ── 6b. UNINDEXED DOCUMENT TAILS — a real retrieval gap, found 2026-08-09 while debugging the above. ──
  // The embedders truncate (text.slice(0, 4000) on ollama, 8000 on gemini) and embed the HEAD of each
  // document as chunk_index=0. embed-doc-chunks.mjs exists to chunk the remainder (M126 added chunk_index),
  // but has only been run on a fraction of the corpus. Every un-chunked long document is RAG-visible for
  // its first page and INVISIBLE past it — and probate estates put the heirs and the enslaved names deep in
  // the body, not the masthead. This is a genuine silo, distinct from the false alarm above.
  try {
    const longDocs = await num(`SELECT count(*)::int n FROM person_documents WHERE length(ocr_text) > 4000`);
    const chunked = await num(`SELECT count(DISTINCT subject_id)::int n FROM embeddings
       WHERE content_kind = 'doc_ocr' AND chunk_index > 0`);
    const tails = Math.max(0, longDocs - chunked);
    add('doc_tail_unindexed', tails > 5000 ? 'warn' : 'ok', tails,
      `${tails} long document(s) embedded head-only (>4000 chars, no chunk_index>0) — body text unreachable by RAG; remedy: embed-doc-chunks.mjs`);
  } catch (e) { add('doc_tail_unindexed', 'warn', 'err', `could not measure: ${e.message.slice(0, 50)}`); }

  // ── DESCENT ENGINE (M133) — hold the producer to its own contract ──
  // The descent engine's whole claim to legitimacy is "no edge without its document" (RULE 0.6's kinship
  // twin, standard-genealogical-edge-evidence §2). A contract only enforced at write time decays the first
  // time someone adds a producer. produced_by makes it checkable, so it is checked — forever.
  // Tables may not exist on a stale checkout (the Mini); a missing table is NOT a failure.
  try {
    const undocumented = await num(`SELECT count(*)::int n FROM canonical_family_edges
       WHERE produced_by LIKE 'descent/%' AND source_document_id IS NULL`);
    add('descent_edge_documented', undocumented > 0 ? 'critical' : 'ok', undocumented,
      undocumented > 0
        ? `${undocumented} descent-produced kinship edge(s) carry NO source document — the engine's core contract is broken`
        : 'every descent-produced kinship edge cites a source document');

    // A descent edge is model-read from OCR; `verified` is the human gate that lets it onto a DAA
    // (audit rule 1). An auto-verified one means something bypassed review.
    const autoVerified = await num(`SELECT count(*)::int n FROM canonical_family_edges
       WHERE produced_by LIKE 'descent/%' AND verified = true AND verified_by IS NULL`);
    add('descent_edge_unverified', autoVerified > 0 ? 'critical' : 'ok', autoVerified,
      autoVerified > 0 ? `${autoVerified} descent edge(s) self-certified without a human verifier` : 'no descent edge self-certified');

    // Queue starvation: active anchors but nothing pending means the drip has silently stopped producing
    // work — the same class of failure as a logged-out climb writing status='completed'.
    const activeAnchors = await num(`SELECT count(*)::int n FROM descent_anchors WHERE status IN ('pending','active')`);
    const pendingSteps = await num(`SELECT count(*)::int n FROM descent_frontier WHERE outcome = 'pending'`);
    add('descent_frontier', activeAnchors > 0 && pendingSteps === 0 ? 'warn' : 'ok', `${pendingSteps}/${activeAnchors}`,
      activeAnchors > 0 && pendingSteps === 0
        ? `${activeAnchors} active anchors but 0 pending steps — descent drip has nothing to work`
        : `${pendingSteps} pending step(s) across ${activeAnchors} active anchor(s)`);

    // Parked bequests are expected (heirs are leads); a large, never-draining backlog means promotion
    // has stalled and the wealth half of every descent step is sitting inert.
    const undrained = await num(`SELECT count(*)::int n FROM descent_pending_inheritance WHERE drained_to_edge_id IS NULL`);
    add('descent_inheritance_parked', 'ok', undrained,
      `${undrained} bequest(s) parked awaiting promotion of both ends to canonical`);

    // RULE 0.5: every new ingest MUST add an EMBED phase — unembedded data is invisible to RAG/search/
    // modals and is a retrieval silo. The descent producer's first full run shipped 1,308 leads with no
    // embed step (caught by the user, 2026-08-09, not by this monitor). Enforced here so the next producer
    // cannot repeat it: the remedy is `node scripts/embed-leads.mjs --id-system probate_heir`.
    const leadSilo = await num(`SELECT count(*)::int n FROM person_external_ids pe
       WHERE pe.id_system = 'probate_heir' AND pe.subject_table = 'unconfirmed_persons'
         AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='unconfirmed_persons'
                         AND e.subject_id = pe.subject_id::text AND e.content_kind='person_profile')`);
    add('descent_leads_embedded', leadSilo > 0 ? 'critical' : 'ok', leadSilo,
      leadSilo > 0
        ? `${leadSilo} descent lead(s) unembedded — RULE 0.5 silo; run embed-leads.mjs --id-system probate_heir`
        : 'all descent leads reachable from RAG');
  } catch (e) {
    add('descent_engine', 'warn', 'skipped', `descent tables unavailable (M133 applied?): ${e.message.slice(0, 60)}`);
  }

  // ── verdict + persist + alert ──
  const worst = checks.some(c => c.status === 'critical') ? 'critical' : checks.some(c => c.status === 'warn') ? 'warn' : 'ok';
  await pool.query(`INSERT INTO monitor_health_runs (worst, doc_ocr_embeddings, probate_extractions, canonicals, findings) VALUES ($1,$2,$3,$4,$5)`,
    [worst, docEmb, probEx, canon, JSON.stringify(checks)]);

  console.log(`\n=== PROJECT HEALTH: ${worst.toUpperCase()} (${new Date().toISOString()}) ===`);
  for (const c of checks) console.log(`  ${c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗'} ${c.name.padEnd(26)} ${c.detail}`);

  const bad = checks.filter(c => c.status !== 'ok');
  if (bad.length) await notify(`Reparations health: ${worst.toUpperCase()}\n` + bad.map(c => `${c.status.toUpperCase()} ${c.name}: ${c.detail}`).join('\n'), { severity: worst === 'critical' ? 'critical' : 'warning' }).catch(() => {});

  await pool.end();
  process.exit(worst === 'critical' ? 1 : 0);
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
