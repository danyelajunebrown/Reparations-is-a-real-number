#!/bin/bash
# Supervisor for scrape-parents.js: resume through Chromium crashes until every
# visited ancestor has been scraped for parents. Stops on (a) all-done, or
# (b) a FamilySearch re-login wall (needs the human).
cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main" || exit 1
LOG=worksheets/parents-run.log
SUPLOG=worksheets/parents-supervisor.log
echo "=== PARENTS SUPERVISOR START $(date +%H:%M:%S) ===" >> "$SUPLOG"
VISITED=$(node -e '
  require("dotenv").config(); const {neon}=require("@neondatabase/serverless");
  const sql=neon(process.env.DATABASE_URL); const SID="f4a5b049-30dc-437f-8d55-fe5d68d42115";
  (async()=>{const r=await sql`SELECT coalesce(array_length(visited_set,1),0) n FROM ancestor_climb_sessions WHERE id=${SID}::uuid`;console.log(r[0].n);})().catch(e=>{console.error(e.message);process.exit(2)});' 2>>"$SUPLOG")
echo "visited target = $VISITED" >> "$SUPLOG"
for attempt in $(seq 1 60); do
  DONE=$(node -e 'try{console.log(require("./worksheets/.parents-progress.json").length)}catch(e){console.log(0)}')
  echo "[attempt $attempt] $(date +%H:%M:%S) progress=$DONE/$VISITED" >> "$SUPLOG"
  if [ -n "$VISITED" ] && [ "$DONE" -ge "$VISITED" ]; then
    echo "DONE_ALL_SCRAPED at $(date +%H:%M:%S)" >> "$SUPLOG"; exit 0
  fi
  echo "--- parents launch attempt $attempt $(date +%H:%M:%S) ---" >> "$LOG"
  HEADLESS=1 LIMIT=0 node scripts/scrape-parents.js >> "$LOG" 2>&1
  if tail -25 "$LOG" | grep -qi "Login required but running headless"; then
    echo "NEED_RELOGIN at $(date +%H:%M:%S)" >> "$SUPLOG"; exit 3
  fi
  # If the script said "Nothing to do" the worklist is exhausted.
  if tail -5 "$LOG" | grep -qi "Nothing to do"; then
    echo "DONE_NOTHING_TODO at $(date +%H:%M:%S)" >> "$SUPLOG"; exit 0
  fi
  sleep 5
done
echo "MAX_ATTEMPTS_REACHED" >> "$SUPLOG"; exit 4
