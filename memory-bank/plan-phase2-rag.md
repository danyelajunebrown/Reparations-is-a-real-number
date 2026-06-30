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

## BLOCKER FOUND (Jun 30) — Gemini free-tier embedding cap = 1,000 req/DAY (hard)
The bulk embed is NOT speed-throttled — it hits a hard daily ceiling: HTTP 429
`embed_content_free_tier_requests, limit: 1000`. So at zero budget via Gemini:
doc_ocr 76,958 ÷ 1,000/day ≈ **11 weeks**; person_profile 678K ≈ **~2 years** (2d bulk infeasible this way).
Current: 929 doc_ocr + 3 person_profile embedded. Three zero-budget paths (USER DECISION):
1. **Gemini trickle** — leave the idempotent run; ~1,000 docs/day auto, zero-touch; architecture unchanged
   (RagService already uses gemini-embedding-001). Doc corpus full in ~11wk; person corpus never.
2. **Mini ollama `nomic-embed-text`** — free, NO daily cap, ~3/min (≈4,300/day) → docs ~18 days, and the
   ONLY path that can ever reach the 678K person corpus. Cost: different 768-dim space → switch RagService
   query-embed to nomic + re-embed the 929 (one model swap). Fits the plan's "free/self-hosted first" ethos.
3. **Lazy / demo-only** — stop bulk; RAG answers over the 929 already embedded; question-embed is 1 call/query
   (cheap). Corpus grows opportunistically. Lowest effort, thinnest coverage.
RECOMMEND (2) for the bulk foundation — sustainable + unbounded; keep Gemini for the low-volume query path
only if staying on path 1. **2d scripts are DONE + committed** (`embed-persons.mjs`, `find-semantic-dup-candidates.mjs`),
report-only/Biscoe-safe; they just need a filled person corpus to surface pairs.

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
- **2c — retrieval-feedback loop — DONE + verified (Jun 30).** M108 `retrieval_log`; `RagService.query`
  logs every retrieval (retrieved docs+sims, top_similarity, citations, grounded, provider, latency).
  `scripts/rag-metrics.cjs` aggregates: groundedness %, avg top-similarity, latency, and the WEAKEST
  retrievals (low top-sim = corpus gaps → what to ingest next). Verified: 3 queries → avg top-sim 0.69,
  67% grounded; surfaced "freedmens bank depositor" (0.63) as the thinnest coverage. This is the
  measurement that drives improvement (+ a future re-ranker reads these signals).
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
