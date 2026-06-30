# PLAN — Phase 2: RAG / vector retrieval + retrieval-feedback ("automated epistemology")

_Follows Phase 1 (the retrieval-integrity harness, live on a 6h Mini cron). User goal: a RAG layer
that "ongoingly improves retrieval from every retrieval" — semantic search + grounding for the Q&A
surface, semantic dedup to complement blocking keys, and a feedback loop. Ground in the existing
infra; build incrementally; each sub-phase verified._

## What exists (grounded Jun 30)
- **pgvector 0.8.0 available on Neon** (PG 17), not yet installed.
- **No embeddings today.** The Q&A surface (`ResearchService.searchOwner/Enslaved/General`,
  `/api/research`, `/api/chat`) is keyword/SQL only.
- **Free LLM router** for generation: `src/services/probate/probate-llm-extractor.js`
  (OpenRouter/Gemini/Cerebras/Groq, OpenAI-compatible, 429-fallthrough) — reuse for grounded GEN.
- **Embedding sources:** (a) Mini **ollama** (already running: qwen2.5:7b/3b) → pull
  `nomic-embed-text` (768-dim, free, self-hosted, no rate limits, on the always-on box — fits the
  project ethos); (b) **Gemini** `text-embedding-004` (768-dim, free tier, via GEMINI_API_KEY).
  BOTH 768-dim → identical schema; can switch/re-embed without a migration.
- **Corpus:** 678,318 canonical persons · 75,479 person_documents with OCR text (>40 chars) ·
  497,697 person_facts.

## Schema (source-agnostic, M101-style polymorphic) — migration 107
`embeddings` table: `(subject_table, subject_id, content_kind, model, embedding vector(768),
content_hash, created_at)`, unique `(subject_table, subject_id, content_kind, model)`, HNSW cosine
index. `content_kind` ∈ {`doc_ocr`, `person_profile`, …}. `model` records which model produced it
(so a re-embed with a different model coexists). Polymorphic subject = embeds leads AND canonicals
in one space (semantic dedup across the unified pool).

## STATUS (Jun 30)
- **DECISIONS (user):** v1 corpus = **doc_ocr** (75,479). Embedding source: started Mini/ollama, but
  the **Mini is Intel (no GPU) → ollama ~3/min (17 days)** → switched bulk to **Gemini free tier
  `gemini-embedding-001` @ outputDimensionality 768** (~900/min, free; cosine is scale-invariant so no
  normalize). Zero-cost as long as the Gemini project has no billing attached (free tier rate-limits,
  never charges). EMBED_SOURCE=ollama retained for Apple-Silicon/offline.
- **2a IN PROGRESS:** M107 applied. `embed-documents.mjs` (gemini default: concurrent CONC=8 + 429
  backoff + bulk insert; idempotent) **full ~75K run detached on the Mini** (nohup; /tmp/embed-docs.log;
  monitor via `count(*) WHERE model='gemini-embedding-001'`). Cosine + HNSW verified. ~332 nomic
  embeddings are a separate (superseded) model-space; retrieval uses gemini-embedding-001.
- **2b DONE + verified:** `src/services/rag/RagService.js` (+ `scripts/rag-query.cjs`): embed question
  (gemini-embedding-001, same space) → cosine top-k person_documents → ground the free LLM router
  (`callLLM`, now exported; falls through non-Gemini providers so generation survives the bulk-embed
  rate-limit) → structured `{answer, citations:[document_id]}` (audit rule: every claim cites a row).
  Verified on the Mini: a slave-schedule query returned enslaved names grounded in retrieved docs.
  NEXT: wire a live `/api/rag/query` route (additive) + deploy; quality improves as the corpus fills.

## Sub-phases (incremental)
- **2a — foundation + first corpus.** pgvector extension + `embeddings` table (M107). Embedding
  pipeline (source-agnostic: `--source ollama|gemini`, batched, content_hash skip, idempotent).
  Embed the **v1 corpus** → semantic retrieval. DECISION below.
- **2b — RAG grounding.** Hybrid retrieve (keyword + vector top-k + simple rerank) → ground the
  free LLM router's answer for the Q&A surface; cite the retrieved rows (every claim traces to a
  row — the audit rule). Add groundedness to the existing answer path.
- **2c — retrieval-feedback loop ("improves from every retrieval").** Log every retrieval (query,
  top-k, scores, chosen, groundedness) to a `retrieval_log`; periodic metrics (recall proxy,
  groundedness, latency) → re-rank weights / flag weak queries. RAG-Ops hill-climb.
- **2d — semantic dedup.** person_profile embeddings → cosine-nearest pairs as dedup candidates
  (complement blocking keys; Biscoe — review, never auto-merge).

## OPEN DECISIONS (await user)
1. **Embedding source:** Mini/ollama `nomic-embed-text` (RECOMMENDED — free, self-hosted, no limits,
   on the always-on Mini) vs Gemini `text-embedding-004` (faster bulk, rate-limited). 768-dim either
   way → low lock-in.
2. **v1 corpus:** `doc_ocr` (75K — the literal RAG: semantic document search + Q&A grounding) vs
   `person_profile` (semantic dedup — the de-siloing theme) first. RECOMMEND doc_ocr first (the
   RAG ask), person_profile in 2d.

## Guardrails
Audit rule holds: grounded answers cite rows + methodology; the model orchestrates, deterministic
code + humans decide. Free/self-hosted first. Each sub-phase its own commit + memory-bank update.
