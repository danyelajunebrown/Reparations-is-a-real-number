#!/bin/bash
# =============================================================================
# 1860 SLAVE SCHEDULE MASTER SCRAPER
# =============================================================================
# Processes all 15 slave states alphabetically
# Auto-restarts on crash, logs everything, tracks progress
#
# Usage: ./scripts/run-all-1860-slave-schedules.sh
# =============================================================================

set -e

# Configuration
YEAR=1860
LOG_DIR="logs/1860-slave-schedules"
PROGRESS_FILE="$LOG_DIR/.master-progress"
MAX_RETRIES_PER_STATE=5
DELAY_BETWEEN_STATES=60  # seconds
DELAY_BETWEEN_RETRIES=30 # seconds

# All 1860 slave states in alphabetical order
STATES=(
    "Alabama"
    "Arkansas"
    "Delaware"
    "Florida"
    "Georgia"
    "Kentucky"
    "Louisiana"
    "Maryland"
    "Mississippi"
    "Missouri"
    "North Carolina"
    "South Carolina"
    "Tennessee"
    "Texas"
    "Virginia"
)

# Change to project directory
cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)

# Create log directory
mkdir -p "$LOG_DIR"

# Initialize progress file if not exists
if [ ! -f "$PROGRESS_FILE" ]; then
    echo "0" > "$PROGRESS_FILE"
fi

# Read current progress
CURRENT_INDEX=$(cat "$PROGRESS_FILE")

echo "========================================================================"
echo "  1860 SLAVE SCHEDULE MASTER SCRAPER"
echo "========================================================================"
echo "  Started: $(date)"
echo "  Project: $PROJECT_DIR"
echo "  States:  ${#STATES[@]} total"
echo "  Resume:  Starting from state #$((CURRENT_INDEX + 1)) (${STATES[$CURRENT_INDEX]})"
echo "========================================================================"
echo ""

# Function to process a single state
process_state() {
    local state="$1"
    local state_log="$LOG_DIR/${state// /-}-$(date +%Y%m%d).log"
    local retry_count=0

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Processing: $state"
    echo "  Log file:   $state_log"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    while [ $retry_count -lt $MAX_RETRIES_PER_STATE ]; do
        echo "" >> "$state_log"
        echo ">>> Attempt $((retry_count + 1)) of $MAX_RETRIES_PER_STATE at $(date)" >> "$state_log"
        echo ">>> Attempt $((retry_count + 1)) of $MAX_RETRIES_PER_STATE"

        # Run the scraper
        FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
            --state "$state" \
            --year $YEAR \
            >> "$state_log" 2>&1

        EXIT_CODE=$?

        if [ $EXIT_CODE -eq 0 ]; then
            echo "✅ $state completed successfully at $(date)" >> "$state_log"
            echo "✅ $state completed successfully"
            return 0
        else
            retry_count=$((retry_count + 1))
            echo "⚠️ $state crashed with exit code $EXIT_CODE at $(date)" >> "$state_log"
            echo "⚠️ Crashed (exit code $EXIT_CODE), waiting ${DELAY_BETWEEN_RETRIES}s before retry..."

            if [ $retry_count -lt $MAX_RETRIES_PER_STATE ]; then
                sleep $DELAY_BETWEEN_RETRIES
            fi
        fi
    done

    echo "❌ $state: Max retries exceeded. Moving to next state." >> "$state_log"
    echo "❌ Max retries exceeded for $state. Moving on."
    return 1
}

# Main loop - process each state
for i in "${!STATES[@]}"; do
    # Skip already completed states
    if [ $i -lt $CURRENT_INDEX ]; then
        echo "⏭️  Skipping ${STATES[$i]} (already completed)"
        continue
    fi

    state="${STATES[$i]}"

    # Process this state
    process_state "$state"

    # Update progress
    echo "$((i + 1))" > "$PROGRESS_FILE"

    # Delay between states (except for last one)
    if [ $i -lt $((${#STATES[@]} - 1)) ]; then
        echo ""
        echo "⏳ Waiting ${DELAY_BETWEEN_STATES}s before next state..."
        sleep $DELAY_BETWEEN_STATES
    fi
done

echo ""
echo "========================================================================"
echo "  ALL STATES COMPLETE"
echo "  Finished: $(date)"
echo "========================================================================"

# Reset progress for future runs
echo "0" > "$PROGRESS_FILE"
