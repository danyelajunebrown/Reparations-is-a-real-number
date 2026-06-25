# Architecture: three-machine role division

**Date:** Apr 24, 2026 — 10 days to premiere (May 4)
**Machines:** MacBook Air (laptop, nomadic), Mac Mini (always-on, LAN+tailnet), Raspberry Pi (always-on, LAN+tailnet), Render (public cloud)

---

## Role-matching principles

| Machine | What it's for | What it's NOT for |
|---|---|---|
| **Render** | Public web endpoints (intake webhook, /review UI). Stateless. HTTPS+domain. | Long-running scrapes (ephemeral filesystem). Heavy compute. |
| **Mini** | Heavy, memory-hungry, Puppeteer-driven work. 24/7. Full PostgreSQL-client access. | Public-facing HTTP (no HTTPS, not a great target for internet). |
| **Pi** | Light, 24/7, monitoring/watchdog, physical-world integrations (kiosk, LEDs), ambient daemons. ~5W power draw. | Any Puppeteer/Chrome-heavy work. Memory-hungry tasks. ML/AI workloads. |
| **MacBook** | Iteration, code writing, interactive debug. Not a production host. | Anything that needs to outlive "I closed my laptop." |

---

## Inventory of processes germane to the project

### Currently running somewhere

1. **Freedmens scrape runner** — MacBook (today, finishing); moving to **Mini** via PM2 next run.
2. **FamilySearch ancestor climber** — **Mini**; Chrome CDP on port 9222, climb jobs via `/api/ancestor-climb/start`.
3. **Express server (API + /review UI)** — **Mini** (LAN) + **Render** (public). Pi kiosk points to Mini.
4. **Intake webhook** — **Render** only (needs public HTTPS for Google Apps Script).
5. **Pi kiosk** — displays Mini's `kiosk.html` fullscreen Chromium.
6. **Document AI** — **Mini** (Google Cloud API calls; light compute locally).

### Exists but isn't scheduled / monitored

7. **Freedmens cross-reference batch** — matches depositors to descendants. Runs ad-hoc.
8. **CivilWarDC TEI re-ingest** — done as one-shot.
9. **Re-evaluate matches script** (`scripts/re-evaluate-matches.js`) — ran once, should run nightly.
10. **Canonical person merge** — ad-hoc, needs IdentityResolver automation.

### Missing but should exist

11. **Health watchdog** — is Mini up? Render up? Chrome CDP up? → Pi pings every 2 min, alerts on failure.
12. **Climber watchdog** — climbs hang; if no progress in 30 min, auto-restart via ops endpoint.
13. **Blockchain event listener** — subscribe to ReparationsEscrow on Base, log events to DB.
14. **DAA auto-generation on review-queue promote** — currently manual.
15. **Probate enrichment batch** — issue #37; for each `descendant` canonical row, query probate archives.
16. **Nightly scrape_runs digest** — summarize last 24h runs (success/fail/progress).
17. **Intake confirmation email** — Google Form submitter gets no acknowledgment.
18. **Data-integrity nightly report** — canonical_persons dupe count, orphan records, growth.
19. **S3 OCR queue worker** — new PDFs land in S3, auto-OCR them.
20. **Public status page** — `status.reparationsreal.com` showing health of all components.
21. **Primary source acquisition worker** — queued enslaver → fetches probate PDF → S3.
22. **Frontend rebuild** (React+Vite per memory) — unrelated to machines but blocked on design.

---

## Proposed division — which machine runs what

### Pi (new additions beyond kiosk)

All of these are light, 24/7, network-local, and benefit from the Pi being always-on regardless of Mini state:

- **Health watchdog** (#11) — every 2 min, curl Mini, Render, Chrome CDP. Write to `system_health` table. If failure > 10 min, post to a Discord/Slack webhook.
- **Climber watchdog** (#12) — every 10 min, query Mini ops endpoint for active climbs. If last_heartbeat > 30 min, call `/api/ops/restart` on climber PM2 app.
- **Blockchain event listener** (#13) — ethers.js WebSocket subscription to ReparationsEscrow. Logs events. Survives Mini crashes.
- **Public status page** (#20) — tiny Express + Cloudflare Tunnel on Pi. Exposes a sanitized `/status` page at a public URL without exposing Mini.
- **Kiosk** (existing, refactored to witness/retrieval mode for premiere).

**Why Pi and not Mini for these:** if Mini falls over (which it has — 13 PM2 restarts today), these need to *keep running* to detect and report the fall-over. Pi being a separate failure domain is the whole point.

### Mini (keeps everything heavy)

- Freedmens runner (PM2 app ready)
- Ancestor climber (Chrome CDP on :9222)
- Express API + /review UI (LAN)
- Document AI processing
- S3 OCR queue worker (#19)
- Primary source acquisition worker (#21)
- DAA auto-generation (#14)
- Re-evaluate matches nightly cron (#9)
- Probate enrichment batch (#15) — when built

### Render (keeps public web)

- Intake webhook (live, Adrian Lee Brown submitted today)
- /review UI behind auth
- Anything else needing public HTTPS

### MacBook

- Coding, iteration, ad-hoc debugging. Nothing that outlives a session.

---

## Cross-cutting — one missing piece

A **shared notification channel**. Right now failures happen silently (Freedmens crashed on Huntsville last night, Mini has 13 restarts, kiosk was dead for 4 weeks). Need one webhook — Discord or Slack — that every watchdog posts to. Simple: `OPS_NOTIFY_WEBHOOK` env var, a `notify()` helper, done.

---

## This-weekend priority stack (Apr 25–26)

Ordered by impact × achievability. Tiered so we know what to cut if time runs out.

### TIER 1 — must do

| # | Item | Why | Effort |
|---|---|---|---|
| 1 | **IdentityResolver + UNIQUE fingerprint backfill** (#41, issue #36) | Same person → 2-5 canonical rows fragments every DAA. Blocks everything downstream. | Full day. |
| 2 | **Freedmens scrape finishes** (on Mini via PM2 next run) | Need complete Baltimore/DC/Charleston/New Orleans ledger data for Adrian/Piper/Eli DAAs. | Runs itself; I move to Mini. |
| 3 | **Neon DB password rotation** (#17) | Credentials leaked. Premiere breach would be catastrophic. | 1 hour. |
| 4 | **Biscoe 1858 will PDF → S3 → attached to Adrian's DAA** (#42 partial) | User-flagged highest priority; proves PrimarySourceAcquirer concept. | 2 hours. |
| 5 | **Pollard 1749 will acquisition attempt** (#45) | FS Dorchester Co will book; if succeeds, huge Adrian DAA boost. | 2 hours, may be manual download. |
| 6 | **Climber Chrome CDP relaunch on Mini + test climb** | Needed for any NEW participant climbs before premiere. | 1 hour. |
| 7 | **Pi on Tailscale** | Architectural prerequisite for the watchdog work above. | 10 min once user runs `sudo tailscale up`. |
| 8 | **Pi health watchdog daemon** | Detect Mini/Render/Chrome failures before they hit the premiere. | 3 hours. |

### TIER 2 — should do

| # | Item | Why | Effort |
|---|---|---|---|
| 9 | **Adrian full DAA rehearsal** — generate, review, snapshot | Proof the whole chain works. Catches bugs. | 2 hours. |
| 10 | **BlockchainNotary stub** (#43) — at least write tx hash on one test DAA | Shows the on-chain promise is real, not vaporware. | Half day. |
| 11 | **Methodology: top 3 critical fixes** (#46) | DAA numbers need defensible citations. | Half day. |
| 12 | **OPS_NOTIFY_WEBHOOK + notify() helper** | So we *find out* when things break. | 1 hour. |

### TIER 3 — nice to have

- Kiosk refactor for premiere (witness/retrieval mode)
- Demo escrow funding flow (#44)
- Climber watchdog on Pi
- Blockchain event listener on Pi
- Public status page on Pi

### Explicitly NOT this weekend

- AncestorProbateEnricher full service (#37) — great post-premiere
- Multi-source climbing (WikiTree, Geni, IPUMS)
- Full kiosk redesign
- Frontend React rebuild
- Remaining 21 methodology audit issues

---

## Suggested weekend sequence

**Friday night (Apr 24):**
- Pi on Tailscale (waits on user's `sudo tailscale up` — 10 min)
- Rotate Neon password (#17 / TIER 1 #3)
- Relaunch Chrome CDP on Mini + test climb

**Saturday (Apr 25):**
- IdentityResolver design + implementation (full day)
- Biscoe will PDF → S3 → DAA attach
- Start Pollard will acquisition (may block on FS login)

**Sunday (Apr 26):**
- IdentityResolver backfill + merge existing duplicates
- Adrian full DAA rehearsal end-to-end
- Pi health watchdog daemon
- OPS_NOTIFY_WEBHOOK
- Status check: what's deferrable to weeknights Apr 27–May 3?
