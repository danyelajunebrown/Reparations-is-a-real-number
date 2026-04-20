#!/bin/bash
# Hardened 1860 Slave Schedule Scraper
# Dynamic queue, DB-verified progress, ntfy.sh notifications

LOG_DIR="/tmp/master-1860"
LOG_FILE="$LOG_DIR/resilient-final.log"
NTFY_TOPIC="reparations-scraper-$(whoami)"

mkdir -p "$LOG_DIR"
cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"

notify() {
    curl -d "$1" "ntfy.sh/$NTFY_TOPIC"
    echo "$(date): $1" >> "$LOG_FILE"
}

run_state() {
    local state="$1"
    notify "🚀 Starting: $state"
    
    # Run the scraper for the specific state
    # We rely on extract-census-ocr.js to handle location queue internally
    env FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
        --state "$state" \
        --year 1860 \
        >> "$LOG_FILE" 2>&1
    
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        notify "✅ Completed: $state"
    else
        notify "⚠️ Crashed on $state (Exit $exit_code). Halting for intervention."
        exit 1
    fi
}

notify "🎯 Starting 1860 Slave Schedule Final Sweep"

# Get remaining states dynamically
REMAINING_STATES=$(node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT state FROM familysearch_locations 
    WHERE collection_id = '3161105' 
    AND scraped_at IS NULL 
    GROUP BY state ORDER BY count(*) DESC\`.then(res => {
        console.log(res.map(r => r.state).join(' '));
    });
")

for state in $REMAINING_STATES; do
    run_state "$state"
    sleep 10
done

notify "🎉 ALL 1860 LOCATIONS COMPLETE!"
