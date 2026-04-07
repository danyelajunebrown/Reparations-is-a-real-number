#!/bin/bash
# =============================================================================
# FINISH 1860 SLAVE SCHEDULE GAPS
# =============================================================================
# Processes remaining unscraped locations for all gap states.
# Only processes locations where scraped_at IS NULL (no re-scraping).
# Loops until each state reports 0 locations remaining.
#
# Usage: ./scripts/finish-1860-gaps.sh
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)

LOG_DIR="logs/1860-finish"
mkdir -p "$LOG_DIR"

# States ordered by gap size (biggest first)
STATES=(
    "Virginia"
    "Mississippi"
    "Louisiana"
    "Kentucky"
    "Missouri"
    "Georgia"
    "Tennessee"
    "Arkansas"
    "Florida"
    "Alabama"
    "Delaware"
    "South Carolina"
    "Maryland"
    "Washington, District of Columbia"
    "Texas"
    "North Carolina"
)

BATCH_SIZE=50
DELAY_BETWEEN_BATCHES=15   # seconds between batches (let FS breathe)
DELAY_BETWEEN_STATES=30    # seconds between states
MAX_CONSECUTIVE_FAILURES=3

echo "========================================================================"
echo "  FINISH 1860 SLAVE SCHEDULE GAPS"
echo "========================================================================"
echo "  Started: $(date)"
echo "  Project: $PROJECT_DIR"
echo "  States:  ${#STATES[@]}"
echo "  Batch:   $BATCH_SIZE locations per run"
echo "========================================================================"

TOTAL_STATES_DONE=0
TOTAL_LOCATIONS_DONE=0

for STATE in "${STATES[@]}"; do
    echo ""
    echo "========================================"
    echo "  Processing: $STATE"
    echo "  Started: $(date)"
    echo "========================================"

    CONSECUTIVE_FAILURES=0
    STATE_BATCHES=0
    STATE_SLUG=$(echo "$STATE" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
    STATE_LOG="$LOG_DIR/${STATE_SLUG}-$(date +%Y%m%d-%H%M%S).log"

    while true; do
        STATE_BATCHES=$((STATE_BATCHES + 1))
        echo ""
        echo "--- $STATE batch #$STATE_BATCHES ($(date)) ---"

        # Run extraction
        if FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
            --state "$STATE" \
            --limit "$BATCH_SIZE" \
            2>&1 | tee -a "$STATE_LOG"; then

            # Check if the script found 0 locations (means state is done)
            if tail -20 "$STATE_LOG" | grep -q "No unscraped locations found"; then
                echo "✅ $STATE COMPLETE ($(date))"
                TOTAL_STATES_DONE=$((TOTAL_STATES_DONE + 1))
                break
            fi

            CONSECUTIVE_FAILURES=0
            TOTAL_LOCATIONS_DONE=$((TOTAL_LOCATIONS_DONE + BATCH_SIZE))
            echo "  Batch done. Waiting ${DELAY_BETWEEN_BATCHES}s..."
            sleep "$DELAY_BETWEEN_BATCHES"
        else
            CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
            echo "⚠️ Batch failed (failure #$CONSECUTIVE_FAILURES)"

            if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
                echo "❌ $STATE: $MAX_CONSECUTIVE_FAILURES consecutive failures. Moving to next state."
                break
            fi

            echo "  Retrying in 30s..."
            sleep 30
        fi
    done

    echo ""
    echo "  $STATE: $STATE_BATCHES batches processed"
    echo "  Waiting ${DELAY_BETWEEN_STATES}s before next state..."
    sleep "$DELAY_BETWEEN_STATES"
done

echo ""
echo "========================================================================"
echo "  ALL STATES PROCESSED"
echo "========================================================================"
echo "  Finished: $(date)"
echo "  States completed: $TOTAL_STATES_DONE / ${#STATES[@]}"
echo "  Approximate locations: $TOTAL_LOCATIONS_DONE"
echo "========================================================================"
