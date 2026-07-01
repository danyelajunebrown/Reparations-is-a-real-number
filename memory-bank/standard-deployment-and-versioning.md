# STANDARD — Deployment & versioning discipline

_From reckoning item B (Jul 1, 2026). The stale-cache misdiagnosis + the Mini's drifted checkout showed
we had no deploy/versioning discipline. This is the standard; follow it._

## Frontend (GitHub Pages `gh-pages-react`) — DONE (commit 8cb2f9ef9)
- Vite bakes the git SHA (`__BUILD_SHA__`) + emits `dist/version.json` at build (`vite.config.js`).
- `VersionGate.jsx` fetches `version.json` with `cache:'no-store'` (bypasses the cache GitHub Pages can't
  disable), and shows a Refresh banner when the deployed SHA ≠ the running bundle's SHA.
- Footer shows `build <sha>` — **always quote it when diagnosing a UI issue**, so "stale client" vs
  "backend bug" is decided in seconds, not an hour (the June 30 lesson).
- **Deploy:** `cd frontend && npm run deploy:gh-pages` (pushes to `gh-pages-react`, NOT legacy `gh-pages`).
- **NOTE:** the versioning becomes active only AFTER this build is deployed AND a client has loaded it once
  (existing stale clients need one manual hard-refresh to receive VersionGate; thereafter auto-detected).

## Backend (Render) — auto-deploys on push to `main`. No change needed.

## Mac Mini (scrapers/climber/embeddings) — DISCIPLINE + OPEN CLEANUP
**Rule: the Mini runs code FROM GIT, never from ad-hoc `scp`.** Deploy = `git pull` on a clean checkout.
`scp` was used this session only because the Mini's checkout is dirty and a pull aborts.
- **Current blocker (do NOT force-clean — it has real uncommitted work):** on branch `main` with ~46 dirty
  files — modified tracked (`package.json`, `package-lock.json`, `scripts/scrapers/georgia-probate-scraper.js`
  [actively iterated], `scripts/run-freedmens-resume.sh`) + untracked scripts that COLLIDE with tracked
  branch files (`scripts/embed-*.mjs`, `scripts/find-semantic-dup-candidates.mjs`, `scripts/RagService.js`,
  various `diagnose-*`, `ny-*`, `ingest-slavevoyages-past-api.mjs`).
- **Cleanup procedure (careful follow-up):** (1) on the Mini, review each dirty/untracked file; commit the
  genuine work (probate scraper edits, any new scripts worth keeping) to a branch and push; (2) remove the
  now-redundant untracked copies that duplicate tracked files; (3) `git checkout` the working branch clean;
  (4) thereafter deploy via `git fetch && git checkout <branch> && git pull`. Until then, `scp` of a single
  file is the stopgap — but always also commit that file to git so the two don't diverge.
- **Startup visibility (ties to item C):** running processes on the Mini (embed drip, scrapers) should log
  their resolved config at startup and surface health via the ops endpoint, so a crashed/misconfigured
  process (e.g. the `EMBED_SOURCE` silent-gemini fallback, or the broken PM2 worker) is not invisible.
