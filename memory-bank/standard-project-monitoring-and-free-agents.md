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
| `retrieval-health-audit.mjs` | 6h | (pre-existing) gate/doc-fetchability |

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
