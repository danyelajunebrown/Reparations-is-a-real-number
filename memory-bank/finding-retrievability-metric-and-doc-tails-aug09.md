# FINDING — the retrievability CRITICAL was a broken metric; the real silo is unindexed document tails (Aug 9 2026)

_User, mid-session: "woah there catch retrievability up thats not acceptable to silently drop has rag not
been involved in any of our work today?" Both halves of that were right, and they were two different
problems. Companion to [[plan-descent-first-lineage]] and [[standard-project-monitoring-and-free-agents]]._

---

## 1 · RAG had NOT been involved in the descent build — a RULE 0.5 violation, now fixed

`descend-from-probate.mjs` shipped **1,308 kinship edges and 1,308 heir leads with no EMBED phase.**
Unembedded leads are invisible to RAG, search, and the person modals — the row exists and cannot be found,
which is indistinguishable from never having ingested it. RULE 0.5's corollary ("every new ingest MUST add
an EMBED phase") was violated by the producer built to enforce every *other* standard.

**Fixed three ways, because remembering is not a mechanism:**
1. Ran it — `embed-leads.mjs --id-system probate_heir` (the existing source-agnostic embedder; no new script
   was needed). **1,308/1,308 embedded, verified.**
2. The producer now PRINTS the required next command on every applying run.
3. **`project-health-monitor.mjs` raises `descent_leads_embedded` = CRITICAL** while any descent lead is
   unembedded. This is the same reactive→enforced move the Bard census-pull miss forced for RULE 0.6
   clause 3, applied one layer down.

## 2 · The `retrievability` CRITICAL was measuring an unanswerable question

The monitor reported **0%** and had reported 20% before that. **RAG was working correctly the whole time.**
Three compounding faults in the check, in increasing order of importance:

**(a) The sample was ten consecutive pages of one ledger.** `ORDER BY d.id DESC LIMIT 10` always returns
neighbours from the most recently ingested roll.

**(b) The probe was the masthead.** It took the doc's *first* six long words. On a printed probate ledger
that is the form header — all ten probes were the identical string
`"INDEN LETTERS ADMINISTRATION Continued Month DECEASED"`.

**(c) — the real one — EXACT-DOCUMENT RECALL IS THE WRONG METRIC FOR THIS CORPUS.** The check asked "does
*this* page rank top-k for a span of its own text?" against 108,493 near-identical probate pages. Measured
with the ANN index **bypassed entirely** (`enable_indexscan=off`, exact brute-force cosine): the source
document **still missed top-10, 4/4 targets**, top similarity 0.71–0.76. Sibling pages are genuinely that
similar. The metric measures corpus homogeneity, not retrieval health, and 0% is the *correct* answer to it.

Ruled out along the way, so no one re-checks: the HNSW index **is** already partial on `content_kind='doc_ocr'`
(no person_profile crowding); embedding model spaces match (`nomic-embed-text` both sides); `hnsw.ef_search`
is set and capped at 1000 by pgvector; the target docs were under the truncation limit, so untruncated.

**(d) Transport failure was folded into the quality number.** `catch { /* count as miss */ }` rendered an
ollama outage, a bad model name, and a network drop all as "retrieval quality 0%". This is the project's
signature failure class — a logged-out climb writing `status='completed'` — pointed the other way:
**infrastructure state disguised as a finding.** An unreachable retriever is now its own CRITICAL, and no
rate is emitted when nothing answered.

### The replacement metric
What RAG is *for* here is "bring me the documents about this person/estate". So the check now probes with
**distinctive entity terms** drawn from a randomly sampled document and asserts that a returned document
genuinely **contains** one — deterministic string containment on stored OCR, no model judgement anywhere in
the measurement (audit rule 1). **Live result: 75% relevance, green.**

**Why this matters beyond one check:** a monitor that cries wolf gets muted, and then the real outage slips.
A false CRITICAL is not a harmless conservative default — it is the same corruption of the evidence base as
a false OK, and on this project null results are first-class evidence.

## 3 · The REAL retrieval silo, found while debugging the false one

The embedders truncate — `text.slice(0, 4000)` (ollama) / `8000` (gemini) — and store the head as
`chunk_index = 0`. `embed-doc-chunks.mjs` exists to chunk the remainder (M126 added `chunk_index`) but has
run on only a fraction of the corpus:

| | |
|---|---|
| documents with `ocr_text` > 4,000 chars | **21,918** |
| distinct documents with any `chunk_index > 0` | ~742 at chunk 1, decaying |
| **long documents embedded HEAD-ONLY** | **21,176** |

Every one of those is RAG-visible for its first page and **invisible past it** — and a probate estate puts
the heirs, the named enslaved, and the valuations deep in the body, not the masthead. **This is precisely
the content the descent engine depends on.** Now monitored as `doc_tail_unindexed` (warn > 5,000).

**Remedy:** run `embed-doc-chunks.mjs` over the 21,176. Free (local ollama), resumable, no acquisition.
Should be added to the Mini's nightly embed sweep alongside `embed-documents`.

## 4 · Standing, unchanged by this round
`gate_assert_without_image` = 5 marquee enslavers (Calhoun/Franklin/Carroll/Madison/Duncan) — CRITICAL,
pre-existing. `rule06_embed_backlog` 102,984 · `orphan_image_leads` 108,458 — known debt.

## See also
[[standard-project-monitoring-and-free-agents]] · [[plan-descent-first-lineage]] · [[plan-phase2-rag]] ·
[[plan-rag-prod-wiring]] · [[reckoning-retrieval-epistemology-and-workaround-debt]] · [[feedback_verify_db_not_logs]]
