/**
 * RagService — Phase-2b grounded retrieval over the pgvector document corpus (M107 embeddings).
 *
 * query(question) → embed the question (Gemini gemini-embedding-001, 768-dim, same space as the
 * doc_ocr corpus) → cosine-retrieve top-k person_documents → ground the free LLM router's answer
 * STRICTLY on the retrieved OCR text, returning structured {answer, citations:[document_id]} so
 * every claim traces to a row (the project's audit rule). The model never answers from its own
 * knowledge — only from retrieved, cited documents.
 */
const { callLLM } = require('../probate/probate-llm-extractor');

const EMBED_MODEL = 'gemini-embedding-001';

async function embedQuery(text, attempt = 0) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${key}`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: String(text).slice(0, 8000) }] }, outputDimensionality: 768 }) });
  if ((r.status === 429 || r.status === 503) && attempt < 6) {           // backoff (e.g. during bulk embed)
    await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
    return embedQuery(text, attempt + 1);
  }
  if (!r.ok) throw new Error('embed ' + r.status);
  const v = (await r.json())?.embedding?.values;
  if (!Array.isArray(v) || v.length !== 768) throw new Error('bad embedding');
  return v;
}

class RagService {
  constructor(db) { this.db = db; }

  /** Retrieve the top-k document chunks semantically nearest the question. */
  async retrieve(question, k = 6) {
    const q = '[' + (await embedQuery(question)).join(',') + ']';
    const { rows } = await this.db.query(
      `SELECT e.subject_id AS document_id,
              1 - (e.embedding <=> $1::vector) AS similarity,
              left(pd.ocr_text, 1200) AS snippet,
              pd.document_type, pd.source_url, pd.collection_name
         FROM embeddings e
         JOIN person_documents pd ON pd.id = e.subject_id::int
        WHERE e.content_kind = 'doc_ocr' AND e.model = $2
        ORDER BY e.embedding <=> $1::vector
        LIMIT $3`, [q, EMBED_MODEL, k]);
    return rows;
  }

  /** Grounded answer: retrieve → LLM answers ONLY from retrieved docs → {answer, citations}.
   *  Logs the retrieval to retrieval_log (Phase 2c) for the feedback loop. opts.log=false to skip. */
  async query(question, { k = 6, log = true } = {}) {
    const t0 = Date.now();
    const ctx = await this.retrieve(question, k);
    if (!ctx.length) {
      if (log) await this._log(question, k, [], [], null, Date.now() - t0).catch(() => {});
      return { answer: 'No documents are indexed yet for this query.', citations: [], retrieved: [] };
    }
    const corpus = ctx.map(c => `[doc ${c.document_id}] (${c.document_type || 'document'}; sim ${(+c.similarity).toFixed(2)})\n${c.snippet}`).join('\n\n');
    const prompt =
      `You answer questions about historical slavery records STRICTLY from the provided documents.\n` +
      `Use ONLY the documents below. If they do not contain the answer, say so. Cite the doc numbers you used.\n` +
      `Return JSON: {"answer": string, "citations": [doc_id_integer, ...]}.\n\n` +
      `QUESTION: ${question}\n\nDOCUMENTS:\n${corpus}`;
    const { json, provider } = await callLLM(prompt, { maxTokens: 1500 });
    const citeIds = Array.isArray(json?.citations) ? json.citations.map(String) : [];
    const citedCtx = ctx.filter(c => citeIds.includes(String(c.document_id)));
    const citations = (citedCtx.length ? citedCtx : ctx.slice(0, 3)).map(c => ({ document_id: c.document_id, source_url: c.source_url, document_type: c.document_type }));
    if (log) await this._log(question, k, ctx, citeIds, provider, Date.now() - t0).catch(() => {});
    return { answer: json?.answer || '(no answer)', citations, retrieved: ctx.map(c => ({ document_id: c.document_id, similarity: c.similarity })), provider };
  }

  async _log(question, k, ctx, citeIds, provider, latencyMs) {
    const topSim = ctx.length ? Math.max(...ctx.map(c => +c.similarity)) : null;
    await this.db.query(
      `INSERT INTO retrieval_log (query_text, k, retrieved, top_similarity, cited, cited_count, grounded, provider, latency_ms)
       VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8,$9)`,
      [String(question).slice(0, 1000), k,
       JSON.stringify(ctx.map(c => ({ document_id: c.document_id, similarity: +(+c.similarity).toFixed(4) }))),
       topSim, JSON.stringify(citeIds), citeIds.length, citeIds.length > 0, provider || null, latencyMs]);
  }
}

module.exports = RagService;
