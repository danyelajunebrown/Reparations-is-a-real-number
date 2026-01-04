#!/bin/bash
# =============================================================================
# 1860 SLAVE SCHEDULE - FIRST HALF (Alabama through Maryland)
# =============================================================================
# Processes states 0-7: Alabama, Delaware, Florida, Georgia, Kentucky, Louisiana, Maryland
# Skips Arkansas (already done)
# =============================================================================

set -e

# Configuration
YEAR=1860
LOG_DIR="logs/1860-slave-schedules"
PROGRESS_FILE="$LOG_DIR/.master-progress-first-half"
MAX_CONSECUTIVE_FAILURES=5
DELAY_BETWEEN_RUNS=30
DELAY_BETWEEN_STATES=60

# First half states (Alabama through Maryland, skipping Arkansas)
STATES=(
    "Alabama"
    "Delaware"
    "Florida"
    "Georgia"
    "Kentucky"
    "Louisiana"
    "Maryland"
)

# Change to project directory
cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)

mkdir -p "$LOG_DIR"

if [ ! -f "$PROGRESS_FILE" ]; then
    echo "0" > "$PROGRESS_FILE"
fi

CURRENT_INDEX=$(cat "$PROGRESS_FILE")

echo "========================================================================"
echo "  1860 SLAVE SCHEDULE - FIRST HALF"
echo "========================================================================"
echo "  Started: $(date)"
echo "  Project: $PROJECT_DIR"
echo "  States:  Alabama → Maryland (7 states, Arkansas already done)"
echo "  Resume:  Starting from state #$((CURRENT_INDEX + 1)) (${STATES[$CURRENT_INDEX]})"
echo "========================================================================"
echo ""

process_state() {
    local state="$1"
    local state_log="$LOG_DIR/${state// /-}-$(date +%Y%m%d).log"
    local consecutive_failures=0
    local batch_num=0

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Processing: $state"
    echo "  Log file:   $state_log"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    while true; do
        batch_num=$((batch_num + 1))
        echo "" >> "$state_log"
        echo ">>> Batch $batch_num at $(date)" >> "$state_log"
        echo ">>> Batch $batch_num starting..."

        FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
            --state "$state" \
            --year $YEAR \
            >> "$state_log" 2>&1

        EXIT_CODE=$?

        if grep -q "Found 0 locations to process" "$state_log" 2>/dev/null; then
            echo "✅ $state FULLY completed at $(date)" >> "$state_log"
            echo "✅ $state FULLY completed (all locations scraped)"
            return 0
        fi

        if [ $EXIT_CODE -eq 0 ]; then
            consecutive_failures=0
            echo "   Batch $batch_num done. Waiting ${DELAY_BETWEEN_RUNS}s before next batch..."
            sleep $DELAY_BETWEEN_RUNS
        else
            consecutive_failures=$((consecutive_failures + 1))
            echo "⚠️ Batch $batch_num failed (exit $EXIT_CODE). Failure $consecutive_failures of $MAX_CONSECUTIVE_FAILURES"

            if [ $consecutive_failures -ge $MAX_CONSECUTIVE_FAILURES ]; then
                echo "❌ $state: Too many consecutive failures. Moving on." >> "$state_log"
                echo "❌ Too many failures for $state. Moving to next state."
                return 1
            fi

            echo "   Waiting ${DELAY_BETWEEN_RUNS}s before retry..."
            sleep $DELAY_BETWEEN_RUNS
        fi
    done
}

for i in "${!STATES[@]}"; do
    if [ $i -lt $CURRENT_INDEX ]; then
        echo "⏭️  Skipping ${STATES[$i]} (already completed)"
        continue
    fi

    state="${STATES[$i]}"
    process_state "$state"
    echo "$((i + 1))" > "$PROGRESS_FILE"

    if [ $i -lt $((${#STATES[@]} - 1)) ]; then
        echo ""
        echo "⏳ Waiting ${DELAY_BETWEEN_STATES}s before next state..."
        sleep $DELAY_BETWEEN_STATES
    fi
done

echo ""
echo "========================================================================"
echo "  FIRST HALF COMPLETE (Alabama through Maryland)"
echo "  Finished: $(date)"
echo "========================================================================"
