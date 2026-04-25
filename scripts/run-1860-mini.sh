#!/bin/bash
# 1860 Slave Schedule scraper — Mini-native, PM2-managed.
# Runs extract-census-ocr.js state-by-state against Chrome CDP on :9222.
# Priority order: largest-remaining states first (Virginia, Mississippi, etc).
# Fixes word-splitting bug from run-1860-resilient-final.sh (state names with spaces).
# Resumes from DB state — each invocation picks the largest unfinished state.
set -uo pipefail

cd "$HOME/Desktop/Reparations-is-a-real-number"
export NODE_OPTIONS="--max-old-space-size=2048"
export FAMILYSEARCH_INTERACTIVE=true
# Connect extract-census-ocr.js to the existing logged-in Chrome on :9222
# (without this, the script falls back to puppeteer.launch() and spawns a fresh
# unauthenticated Chrome window every cycle — see scripts/extract-census-ocr.js:194).
export CHROME_REMOTE_PORT=9222

set -a; [ -f .env ] && source .env; set +a

LOG_DIR=/tmp/master-1860
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/mini-run.log"

log() { echo "[$(date +'%F %T')] $*" | tee -a "$LOG_FILE"; }

notify() {
    local severity="${2:-info}"
    [ -n "${OPS_NOTIFY_WEBHOOK:-}" ] && curl -s -m 5 \
        -H "Title: $(hostname) 1860" \
        -H "Priority: $([ "$severity" = "error" ] && echo 5 || echo 3)" \
        -H "Tags: scraper,1860,$severity" \
        -d "$1" "$OPS_NOTIFY_WEBHOOK" >/dev/null 2>&1 || true
}

log "=== 1860 Mini runner starting ==="

while true; do
    # Pick the state with the most remaining locations. NUL-delimited so state
    # names with spaces survive (Washington, District of Columbia etc).
    NEXT_STATE=$(node -e "
        require('dotenv').config();
        const { neon } = require('@neondatabase/serverless');
        const sql = neon(process.env.DATABASE_URL);
        sql\`SELECT state, count(*) AS n FROM familysearch_locations
             WHERE scraped_at IS NULL
             GROUP BY state ORDER BY n DESC LIMIT 1\`.then(r => {
            if (r[0]) process.stdout.write(r[0].state);
        });
    ")

    if [ -z "$NEXT_STATE" ]; then
        log "🎉 No remaining 1860 states. Run complete."
        break
    fi

    log "=== Starting state: $NEXT_STATE ==="
    notify "Starting 1860 state: $NEXT_STATE"
    node scripts/extract-census-ocr.js --state "$NEXT_STATE" --year 1860 \
        >> "$LOG_DIR/$(echo "$NEXT_STATE" | tr ',' '_' | tr ' ' '-').log" 2>&1
    rc=$?
    log "=== $NEXT_STATE exit=$rc ==="

    if [ $rc -ne 0 ]; then
        log "⚠️ $NEXT_STATE crashed. Sleeping 5 min, then retrying same state."
        notify "✗ 1860 $NEXT_STATE CRASHED exit=$rc — retrying in 5 min" "error"
        sleep 300
    else
        notify "✓ 1860 $NEXT_STATE completed"
        # Brief breather before next state.
        sleep 30
    fi
done

log "=== 1860 Mini runner finished ==="
