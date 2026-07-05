# NOTE — SlaveVoyages PAST scale-up: now on the MINI + ntfy live (Jul 4 2026)

_Live state of the #117 full-cohort de-siloing (promote `slavevoyages_past_people` → gated spine
leads). Companion: [[standard-external-source-ingest]], [[reference-benchmark-sources-register]]._

## STATUS — running durably on the Mini
- **~84,000 / 169,065 on spine (~50%)**, writing forward (verified live delta), **concurrency 8**,
  ~2.4 rows/s. Remaining ~82K → several hours.
- **Runs on the MAC MINI** now (both the promoter AND the ntfy monitor), detached, durable —
  survives MacBook sleep/service-loss. MacBook is cleared (no processes).
- **Idempotent + resumable** (skips `linked_subject_id IS NOT NULL`). Resume ON THE MINI:
  ```
  ssh mac-mini-ts 'cd ~/Desktop/Reparations-is-a-real-number && nohup /usr/local/bin/node \
    scripts/promote-slavevoyages-past-to-leads.mjs --apply --concurrency 8 \
    > /tmp/past-scaleup.log 2>&1 < /dev/null &'
  ```
  (Mini node is at `/usr/local/bin/node` v20.20.1; the non-login SSH shell has NO node in PATH.)

## How it got here (and the lessons)
1. **MacBook harness kills tracked background jobs** — the `run_in_background` launches were killed
   repeatedly (~15K/cycle). Fix: fully-detached `nohup` (macOS has NO `setsid`).
2. **Neon connection-drop HANG at high concurrency** — the detached MacBook run at **concurrency 16**
   hit `Connection terminated unexpectedly` (Neon dropped connections) and the workers HUNG (blocked
   on dead connections — only 2 logged errors but the count froze at 83,164). Killed, relaunched at
   **concurrency 6** → moving again. **Lesson: keep concurrency ≤ ~8; higher risks a Neon-drop hang.**
3. **Moved to the Mini** (durable + lower-latency, gentler on Neon): surgical `git fetch` +
   `git checkout origin/audit/probate-classifier-and-source-documents -- scripts/promote-…mjs
   scripts/monitor-…mjs` onto the Mini's `main` checkout (NO branch switch — its scrapers untouched).
   Main's `PersonService` already has `resolve` + `_writeBlockingKeys` (de-siloing merged to main).
   Launched from the repo dir so `dotenv` loads the Mini's `.env` (DATABASE_URL + OPS_NOTIFY_WEBHOOK).

## ntfy — LIVE + confirmed
- Monitor `scripts/monitor-past-scaleup-ntfy.mjs` (read-only observer) pings every `--interval`
  (running at 1800s) with on_spine/%/delta/rate/ETA, ✅ COMPLETE at remaining=0, ⚠️ STALLED (with
  the resume one-liner) on flatline.
- **Topic gotcha:** the user's local view of the topic was TRUNCATED by 6 chars
  (`ntfy.sh/reparations-ops-119d69` was incomplete; ntfy.sh silently accepts a POST to ANY topic, so
  a wrong topic "sends" but isn't received). Recovered the full `OPS_NOTIFY_WEBHOOK` from the Mini's
  `.env` via `ssh mac-mini-ts`. **Confirmed working** ("CONFIRM RECEIPT v2" received). The Mini
  monitor uses the Mini's own `.env` webhook — no need to pass it.

## Verifying "is it working" (repeatable — not just "a process exists")
1. proc alive + CPU: `ps -o pid,etime,time,%cpu` / `ps aux | grep promote-slavevoyages-past`;
2. log tally advancing cleanly: `tail /tmp/past-scaleup.log` → `N/… (created X linked Y err Z)`
   (expect linked≈0, err=0; a rising `err`/frozen count = Neon drop → restart lower concurrency);
3. timed DB delta: two `count(*) FILTER (linked_subject_id IS NOT NULL)` reads seconds apart must rise.

## Follow-ups (after completion)
- Backfill the 169K leads' `sv_id` as first-class `slavevoyages_africanorigins` external-ids (now
  possible via M117 polymorphic `person_external_ids`, #123).
- Recaptive tagging: Freetown/St Helena disembark leads = liberated Africans, not "enslaved at X"
  ([[plan-96-person-status-model]]; #117 comment).
