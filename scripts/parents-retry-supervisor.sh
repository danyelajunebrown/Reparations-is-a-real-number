#!/bin/bash
# Supervisor for the RETRY pass: re-scrape only the parents=0 cases (thorough wait,
# hardened login) to recover any false-negatives. Stops on all-done ("Nothing to
# do"), a re-login wall, or max attempts.
cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main" || exit 1
LOG=worksheets/parents-retry-run.log
SUPLOG=worksheets/parents-retry-supervisor.log
echo "=== RETRY SUPERVISOR START $(date +%H:%M:%S) ===" >> "$SUPLOG"
for attempt in $(seq 1 60); do
  DONE=$(node -e 'try{console.log(require("./worksheets/.parents-retry-progress.json").length)}catch(e){console.log(0)}')
  echo "[attempt $attempt] $(date +%H:%M:%S) retry-progress=$DONE" >> "$SUPLOG"
  echo "--- retry launch attempt $attempt $(date +%H:%M:%S) ---" >> "$LOG"
  HEADLESS=1 RETRY=1 LIMIT=0 node scripts/scrape-parents.js >> "$LOG" 2>&1
  if tail -25 "$LOG" | grep -qi "Login required but running headless"; then
    echo "NEED_RELOGIN at $(date +%H:%M:%S)" >> "$SUPLOG"; exit 3
  fi
  if tail -6 "$LOG" | grep -qi "Nothing to do"; then
    echo "DONE_RETRY at $(date +%H:%M:%S)" >> "$SUPLOG"; exit 0
  fi
  sleep 5
done
echo "MAX_ATTEMPTS_REACHED" >> "$SUPLOG"; exit 4
