# PLAN — UCL LBS scraper: autonomous, Mac-Mini-resident, iterative

_Design grounded in [[finding-ucl-lbs-source-and-scraper-research]]. Requirement (user): completely
autonomous, runs unattended on the Mac Mini. Follows the FS-climber connection lifecycle (CLAUDE.md)
and [[standard-external-source-ingest]]._

## Architecture (mirror the FS climber — it already solves Cloudflare-grade browsing)
- **Browser:** `puppeteer.connect({ browserURL:'http://127.0.0.1:9222' })` to the Mini's real Chrome
  (`open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/ucl-lbs`).
  NEVER `puppeteer.launch()`. `waitUntil:'domcontentloaded'`. This real-browser fingerprint passes the
  Cloudflare managed challenge; `cf_clearance` cookie persists in the profile. **Own Chrome profile /
  own debug port** so it never contends with the FS climber (the one-scraper-per-FS-session rule is
  about FS login, not this — but keep separate profiles to avoid cookie/tab collisions).
- **Politeness (non-negotiable, CC-licensed charity site):** serial (concurrency 1), 1.5–3 s jittered
  delay, exponential backoff on 429/503/"Just a moment", descriptive UA identifying the project +
  contact, auto-pause window optional. If Cloudflare ever escalates to an interactive turnstile, ntfy
  the operator to solve once via VNC, then resume (same human-in-the-loop-once model as FS login).

## Persistence = a Postgres frontier (Mini-durable, resumable, DB-is-truth)
New migration `lbs_crawl_frontier`:
```
lbs_crawl_frontier(
  url_type text,        -- claim|estate|person|firm
  ext_id   text,        -- the /view/{id} (text: ids can be negative/huge)
  status   text,        -- queued|fetching|done|error|blocked
  discovered_from text, -- provenance of the edge
  s3_key   text,        -- archived raw HTML
  http_status int, attempts int, fetched_at timestamptz, error text,
  PRIMARY KEY (url_type, ext_id)
)
```
Plus `lbs_raw_records(url_type, ext_id, html_s3_key, parsed_jsonb, parsed_at)` staging (raw-first;
parse is a separate, re-runnable pass so we can re-parse without re-crawling — the standard-ingest
"stage raw, promote deliberately" pattern, twin of `slavevoyages_past_people`).

Seed: insert `claim 1..~46000`, `estate 1..~25000`, `firm 1..M` as `queued`. Crawl loop pops `queued`,
fetches, archives HTML→S3 + Wayback (`source_artifacts` M100), extracts links → upserts new frontier
rows (ON CONFLICT DO NOTHING = the visited set), marks `done`. Kill-safe: on restart, `fetching` rows
older than X min reset to `queued`.

## Two-stage pipeline (decouple crawl from ingest — re-parse cheaply)
1. **Crawl/archive** (`scripts/scrapers/ucl-lbs-crawler.mjs`): browser → raw HTML → S3 + frontier.
   Idempotent, resumable, the only network-bound stage.
2. **Parse/promote** (`scripts/ingest-ucl-lbs.mjs`): read staged HTML, extract per type, route through
   **`PersonService.findOrCreateLead`** (full attributes, rule #3), write dual-ledger claim rows +
   `slave_economy_benchmarks` aggregates + `canonical_family_edges` + `person_external_ids`
   (product-specific `id_system`). Per-stratum tripwire (rule #2): per-colony enslaved/£ control totals
   vs the published BPP totals; BLOCK a colony that diverges. Everything gated secondary until a stored
   proposition-specific doc (the archived page IS a stored doc → can lift the gate for owner-role
   assertions that the claim explicitly evidences).

## Parser: fixture-driven, iterate against live DOM
- Pull the first ~10 live pages of each type on the Mini, snapshot raw HTML to
  `tests/fixtures/ucl-lbs/{claim,person,estate,firm}-*.html`, write `test-ucl-lbs-parser.mjs` asserting
  extracted fields (Grenada 770 = £6212/206-enslaved/8 individuals is a known-good claim fixture;
  Thomas Barrett Lennard = known-good person). Iterate selectors until green, THEN unleash the crawl.
- Reuse, don't re-derive: the DocAI false-positive validator pattern for name sanity; the
  JSONB-unicode sanitizer (CLAUDE.md FS trap) before any DB write; SAVEPOINT-scoped risky casts.

## Autonomy on the Mini (unattended)
- **PM2** process `lbs-crawler` (like `reparations-server`), `--max-restarts` + `nohup`/detached so it
  survives PM2 restarts and MacBook close ([[project_three_machine_architecture]]).
- **Watchdog + cron drip** (mirror `probate-drip` / retrieval-health cron): a `*/N` cron that (a)
  ensures Chrome:9222 is up (re-`open` if dead, per sop-chrome-recovery), (b) ensures the crawler PM2
  proc is running, (c) resets stale `fetching` rows, (d) ntfy on `blocked`/repeated-403 (turnstile
  escalation) via `OPS_NOTIFY_WEBHOOK`.
- **Fail-loud config** (the C-item discipline): abort with a clear message if `DATABASE_URL`/S3/Chrome
  are absent; never silently no-op.
- **Progress = DB query**, not logs: `SELECT status,count(*) FROM lbs_crawl_frontier GROUP BY 1`.

## Build order (each step verified before the next — user's "iteratively test and improve")
1. Migration (`lbs_crawl_frontier` + `lbs_raw_records`) + seed script. **[MacBook-buildable]**
2. Crawler skeleton: connect:9222, fetch ONE claim + ONE person live on the Mini, archive to S3, verify
   Cloudflare passes with the real profile. **[Mini — first live proof; may need one VNC turnstile solve]**
3. Parser + fixtures + `test-ucl-lbs-parser.mjs` green on the 4 types. **[MacBook-buildable from saved HTML]**
4. Wire crawl→frontier link-expansion; run a bounded 500-page pilot; audit coverage + politeness (no
   429s), spot-check 10 records end-to-end (Biscoe-style manual verification). **[Mini]**
5. Ingest/promote stage with the per-colony control-total tripwire; dry-run vs BPP colony totals. **[MacBook/Mini]**
6. PM2 + watchdog cron + ntfy; unleash full crawl overnight; monitor via DB + retrieval-health. **[Mini]**

## Guardrails carried from the standards (do not re-litigate)
- Aggregate enslaved counts only; **no "Unnamed enslaved" placeholder persons** (AUDIT #5).
- Compensation £ = evidence of DEBT to descendants, never a credit (AUDIT #3).
- Gate: secondary until a stored doc; provenance reaches the LEAD (rule #5) — needs the polymorphic
  `person_external_ids` follow-up, else lead-origin LBS ids live in a context string.
- Namespace-strict external ids (rule #4); certified-field/per-stratum validation (rules #1,#2);
  as-transcribed discrepancies annotated not fudged (rule #7).
- CC BY-NC-SA attribution on any surfaced LBS-derived record.

## See also
[[finding-ucl-lbs-source-and-scraper-research]] · [[standard-external-source-ingest]] ·
[[standard-canonical-person-and-document-gate]] · [[project_three_machine_architecture]] ·
[[sop-chrome-recovery]] · [[plan-fs-image-archiving]]
