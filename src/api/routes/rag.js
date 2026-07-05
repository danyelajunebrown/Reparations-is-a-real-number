/**
 * /api/rag — grounded retrieval over the pgvector document corpus (M107/M108).
 *
 * Until now RagService (src/services/rag/RagService.js) was imported by ZERO live code — a validated
 * capability reachable only from a CLI (reckoning debt-registry #1). This mounts it as a real route so
 * the read/exploration side of the system can ground answers on cited documents instead of keyword ILIKE.
 *
 * AUDIT BOUNDARY: RAG is read/exploration ONLY. It NEVER feeds DAA computation or any aggregated number
 * — deterministic code + citations compute the instrument. This route answers questions and returns the
 * document ids it grounded on; it does not write, total, or value anything.
 *
 * Deployment: the embedding backend is nomic-embed-text via ollama (OLLAMA_URL). On Render (no local
 * ollama) set OLLAMA_URL to the Mini's Tailscale address, or EMBED_SOURCE=gemini. If the backend is
 * unreachable the route degrades gracefully (200 + degraded:true) rather than 500-ing the surface.
 */
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const RagService = require('../../services/rag/RagService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false,
});
const rag = new RagService(pool);

// POST /api/rag/query { question, k? }  |  GET /api/rag/query?q=...&k=...
async function handle(req, res) {
  const question = (req.body && req.body.question) || req.query.q || req.query.question;
  const k = Math.min(parseInt((req.body && req.body.k) || req.query.k || '6', 10) || 6, 12);
  if (!question || !String(question).trim()) {
    return res.status(400).json({ success: false, error: 'question required' });
  }
  try {
    const r = await rag.query(String(question), { k });
    return res.json({
      success: true,
      answer: r.answer,
      citations: r.citations,           // [{document_id, source_url, document_type}] — every claim traces to a row
      retrieved: r.retrieved,           // [{document_id, similarity}]
      provider: r.provider || null,
      grounded: (r.citations || []).length > 0,
    });
  } catch (e) {
    // Embedding backend or LLM router unreachable — degrade, don't break the surface.
    console.error('RAG route error:', e.message);
    return res.json({
      success: true, degraded: true, answer: null, citations: [], retrieved: [],
      error: `retrieval unavailable: ${e.message}`,
    });
  }
}

router.post('/query', handle);
router.get('/query', handle);
router.get('/health', async (_req, res) => {
  try { const n = await pool.query("SELECT count(*)::int c FROM embeddings WHERE content_kind='doc_ocr'");
    res.json({ ok: true, embedded_docs: n.rows[0].c }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
