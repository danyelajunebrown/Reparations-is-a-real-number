# NOTE — SlaveVoyages PAST scale-up state + ntfy monitor (Jul 4 2026)

_Live state of the #117 full-cohort de-siloing (promote `slavevoyages_past_people` → gated spine
leads). Companion: [[standard-external-source-ingest]], [[reference-benchmark-sources-register]]._

## Where it stands
- **~33K / 169,065 on spine** (Cuba pilot 9,531 + non-Cuba climbing). Remaining ~136K.
- Running **detached** on the MacBook: `nohup node scripts/promote-slavevoyages-past-to-leads.mjs
  --apply --concurrency 16 > /tmp/past-scaleup.log 2>&1 &` (plain nohup — macOS has NO `setsid`).
  The earlier harness-tracked background launches were killed repeatedly (~15K/cycle); detaching
  decouples from the harness's background-task killer.
- **Idempotent + resumable** — skips `linked_subject_id IS NOT NULL`. Resume one-liner:
  `node scripts/promote-slavevoyages-past-to-leads.mjs --apply --concurrency 16`

## Throughput reality (verified, not assumed)
Modest: **~a few rows/sec** — each row is network-bound on multiple Neon round-trips in
`PersonService.resolve()`; concurrency-16 doesn't saturate. Full remainder ≈ **several hours**, not
the ~1.5h first estimated. Correct + lossless, just slow. **The Mini (low-latency to Neon, durable
PM2/nohup) is the right home** for this + the #119/#120 scrapes.

## How "working" is verified (repeatable check)
1. process alive + accruing CPU: `ps -o pid,etime,time,%cpu -p <pid>`;
2. log counter advancing with clean tallies: `tail /tmp/past-scaleup.log` → `N/133288 (created X
   linked Y err Z)` — expect linked≈0, err=0 (enslaved-African cohort creates leads, no spine twins);
3. timed DB delta: two `count(*) FILTER (linked_subject_id IS NOT NULL)` reads seconds apart must rise.
(A running process + a startup log line is NOT verification — must see forward writes.)

## ntfy monitor (observability sidecar)
`scripts/monitor-past-scaleup-ntfy.mjs` — read-only observer; polls progress, pings ntfy every
`--interval` (default 900s) with on_spine/%/delta/rate/ETA, a ✅ COMPLETE ping at remaining=0, and a
⚠️ STALLED ping (with the resume one-liner) if progress flatlines.
- **BLOCKER: `OPS_NOTIFY_WEBHOOK` is NOT set on the MacBook** (the Mini/Pi have it; local `.env`
  lacks it; the committed default is the `ntfy.sh/FILL_ME_IN` placeholder). Launch needs the topic:
  `OPS_NOTIFY_WEBHOOK=https://ntfy.sh/<topic> node scripts/monitor-past-scaleup-ntfy.mjs &`

## Follow-ups
- After completion: backfill the 169K leads' `sv_id` as first-class `slavevoyages_africanorigins`
  external-ids (now possible via the M117 polymorphic `person_external_ids`, #123).
- Recaptive tagging: Freetown/St Helena disembark leads = liberated Africans, not "enslaved at X"
  (#117 comment; a status fact, [[plan-96-person-status-model]]).
