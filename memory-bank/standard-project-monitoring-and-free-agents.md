# STANDARD — Project monitoring & FREE recurring agency (RULE 0.7)

_User directive 2026-08-07: this project is enormous and important invariant checks were being run
reactively (only when a human remembered) — which is how the Bard RULE 0.6 embed gap slipped. Recurring
monitoring / self-healing / issue-filing is now automated, and it must be **FREE**: deterministic scripts +
the Mini's local ollama + the GitHub REST API — **never a paid Claude-Code agent** for recurring work._

## The suite (all on the Mac Mini)

**Deterministic crons** (free, survive everything):
| Cron | Cadence | Purpose |
|---|---|---|
| `probate-drip.mjs` | 3h | acquisition→extraction, poison-pill-guarded |
| `project-health-monitor.mjs` | 4h | invariant health → ledger + ntfy + non-zero exit |
| `promote-probate-extractions.mjs` | 6h | de-silo LLM-extraction output → the person spine |
| `embed-documents.mjs` (sweep) | nightly | embed newly-OCR'd docs (RULE 0.5) |
| `auto-issue-monitor.mjs` | 8h | detect silent-failures/breakage/siloing → file GitHub issues |
| `reocr-holdings-monitor.mjs` | 30m (:00/:30) | (re-)OCR archived s3 images → fill ocr_text + embed (de-silo RULE 0.5) |
| `run-source-extraction.mjs` | 30m (:15/:45) | ocr_text → per-source-type typed structured rows (free DocAI analog) |
| `retrieval-health-audit.mjs` | 6h | (pre-existing) gate/doc-fetchability |

## `reocr-holdings-monitor.mjs` — re-OCR everything we hold, again and again (2026-08-08)
_User directive: "re-OCR-ing everything we have again and again is exactly the internal monitoring we need."_
236,421 of 341,790 s3-backed `person_documents` had NULL/short `ocr_text` — a retrieval silo (no ocr_text ⇒
not embedded ⇒ invisible to RAG/search/modals). The monitor drips through them: fetch the S3 image →
transcribe with the **existing** bakeoff-validated `vision-router` (REUSE, don't re-derive) → fill `ocr_text`
→ re-embed with **local nomic** (free). PDFs rasterized with `pdftoppm -r 150` (installed via `brew install
poppler` 2026-08-08), each page transcribed. Migration 131 adds `person_documents.ocr_model/ocr_ran_at` +
the `document_ocr_runs` ledger (append-only; `action=ocr_failed/ocr_empty` with a recent `ran_at` is the
poison-pill guard). Circuit-breaker: **5 consecutive empty OCRs ⇒ abort unpersisted** (a quota wall returns
`''`, indistinguishable from a blank page — persisting it would poison good docs for REVISIT_DAYS=14).
- **FREE default (RULE 0.7):** the cron runs `VISION_PROVIDERS=gemini` (Gemini free-tier). Proven live: rich
  fills (20k+ char records) + embeddings, all local-embed. Free-tier is **daily-capped**, so the 236K backlog
  drains slowly (months) — the circuit-breaker no-ops gracefully once the daily quota is spent.
- **COST/SPEED lever (operator's call):** unsetting `VISION_PROVIDERS` restores the router's PAID primary
  (OpenRouter Qwen2.5-VL-72B, **uncapped** → drains the backlog in days, but per-image cost). Left OFF by
  default to honour the FREE directive; the operator can enable it to burst.

## `run-source-extraction.mjs` — per-source-type structured extraction (the free DocAI analog, 2026-08-08)
_User: "doc ai is the way [but] no paid." DocAI is paid at every tier (OCR/Form Parser/Custom Extractor)._
Reproduces DocAI's DESIGN (a per-source-type schema + a model that pulls typed fields) with FREE execution:
`src/services/extraction/source-type-registry.js` maps `detectSourceType(s3_key, collection_key)` → a handler
with its own schema + system prompt, run over `ocr_text` by the EXISTING free multi-provider LLM router
(`probate-llm-extractor.callLLM`, now `system`-overridable). Handlers: **freedmens** (26-field depositor form),
**probate/will** (reuse `extractEstate` wholesale — bakeoff-validated on financials), **census_slave_schedule
+ generic** (named-person + enslaver/enslaved role). Output → `structured_extractions` (migration 132; unified
typed-fields ledger, idempotent on `(person_document_id, source_type)`). FREE providers proven live:
`meta-llama/llama-3.3-70b-instruct:free` (OpenRouter) → Groq → Gemini; the catch is per-minute **429 rate
limits**, so the driver has `GAP_MS` inter-doc pacing + a 5-in-a-row circuit-breaker and runs low-and-slow.

### Two follow-ons (NOT built yet — next session)
1. **Promotion `structured_extractions` → canonical_persons/edges.** The driver only produces typed ROWS.
   Turning them into persons (depositor=enslaved, last_master=enslaver, kin edges; probate decedent/enslaved)
   is a SEPARATE gated step — reuse the Biscoe-safe promoters (`promote-probate-extractions` pattern +
   PersonService). This is what finally makes the 236K de-siloed pages into DAA-usable persons/edges.
2. **Freedmen's docs aren't in `person_documents` by an s3_key `~ 'freedmen'`** — they were DocAI-field-
   extracted into a different store, so the freedmens handler won't fire until those images carry `ocr_text`.
   Verify where the freedmens depositor images live + backfill their `person_documents.s3_key`/`ocr_text`.

**PM2 watchdogs:** `probate-watchdog-ny` (restarts the scraper) + `probate-session-heal-ny` (FS session).

## `project-health-monitor.mjs` — the invariant battery
Checks (→ `monitor_health_runs` snapshot; ntfy via `OPS_NOTIFY_WEBHOOK`; exit 1 on CRITICAL so cron/deploy
can gate):
- **rule06_embed_recent** (CRITICAL) — canonicals promoted in the last 7d that serve an image but are NOT
  doc_ocr-embedded. *This is the check that would have caught the Bard miss.*
- rule06_embed_backlog, embed_backlog — image-backed / OCR'd docs awaiting embedding (backfill debt).
- gate_assert_without_image (CRITICAL) — assert slaveowner with no s3-backed doc.
- orphan_image_leads — image-backed leads never promoted.
- drip_liveness — did doc_ocr embeddings + probate extractions grow vs the last run.
- disk_free — the recurring "clear me disk" pain (scrapers/OCR/embeddings fill it silently).
- retrievability — live-retrieve a sample of recent docs via RagService (needs ollama).

## `auto-issue-monitor.mjs` — free detect-and-file
Detects the three classes that keep breaking silently, and auto-files **deduped** GitHub issues (label
`auto-monitor`) via the **REST API + a free PAT** (`GITHUB_TOKEN` — no `gh` install); falls back to a
`monitor_issues` table + ntfy when no token:
1. **Silent failures** — scans the Mini's `~/*.log` cron/drip logs for FATAL/ReferenceError/"does not exist"/
   "no unique or exclusion constraint"/MODULE_NOT_FOUND (a job failing while still "running").
2. **Haphazard-construction breakage** — migration drift (applied-but-untracked, dup-number collisions) + the
   SQL/column breakage that surfaces as those log errors (the dropped-column / bad-ON-CONFLICT class).
3. **Siloing** — image-backed leads unpromoted / edge-less canonicals, *growing* vs the last record.
4. **Pipeline adapter failure** (detector #4) — `autonomous-canonical-pipeline` logs EVERY outcome to
   `research_findings` (`searched_by='autonomous-canonical-pipeline'`), including `none`/`inaccessible`, not
   just the success `hit`. When failures dominate over hits in 7d, an issue is filed pointing at the real
   fix. *This is the platform flagging its own broken scrapers* — the QC-to-inception directive made concrete.
Dedup by a stable `fingerprint`; only a NEW fingerprint files an issue.

## FS-fullText adapter — the known wall (2026-08-07, GW Biscoe end-to-end test)
The autonomous pipeline was tested on the GW Biscoe fullText record. Conclusive finding, proven with two
widened Puppeteer captures: **FS renders the fullText transcription client-side onto the image (canvas/
overlay). The text is NOT in the DOM and NOT in any network response** — the only responses echoing the name
are Google ad-trackers; FS-host responses are JS bundles + the `sls/types/{record,field,event}` *indexing
schema*, not record content. So text-scraping a fullText ark cannot work.
**Correct architecture (not yet built):** the pipeline is image-first anyway (RULE 0.6 needs the S3 image), so
the text source should be **our own OCR of the archived image** — source-agnostic, works for any image record,
not just FS-fullText. FREE+local (RULE 0.7) ⇒ a **local vision model on the Mini's ollama** (none installed yet;
only nomic-embed + qwen2.5 text). Blockers stacked on this one record: (a) transcription unscrapable [solved-by-
pivot], (b) in-Chrome image download may hit FS restrictions (census needed a Safari fallback), (c) no local
vision model. Detector #4 will auto-file this as a tracked issue when the pipeline runs and yields no persons.

## What is NOT automated (by design)
- **Merges / deletes / large backfills** — Biscoe: detect-and-FLAG only, never auto-mutate identity.
- **Fixing flagged CRITICALs** (retrievability, marquee-enslaver docs) — needs judgment/sources.
- **Source ingests** (census/will pulls, new endpoints) — need the operator + documents.

## Known structural gaps (not solved by the suite)
- ~~The Mini runs a stale checkout — scripts `scp`'d one-by-one.~~ **RESOLVED 2026-08-07:** the Mini is on
  `feat/evidence-quality-parcel-spine` tracking origin, clean, 0/0. Deploy a fixed script with
  `ssh mac-mini-ts 'cd ~/Desktop/Reparations-is-a-real-number && git pull --ff-only'` after pushing — no more scp.
- The Mini is a **single point of failure** — the agents run ON it, so a Tailscale/Mini drop = no recovery.
  A Pi-side watchdog that pings the Mini would close this.
- Alerts need `OPS_NOTIFY_WEBHOOK` (set); auto-issue-filing needs a free `GITHUB_TOKEN` in the Mini `.env`.

## Adding a check
Add to the `checks` battery in `project-health-monitor.mjs` (deterministic, fast, DB/host only) or a new
detector + fingerprint in `auto-issue-monitor.mjs` (things that warrant a tracked issue). Keep every check
free — no paid API. For reasoning that genuinely needs an LLM, use the Mini's local ollama (qwen/nomic).
