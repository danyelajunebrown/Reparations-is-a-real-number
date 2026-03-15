#!/bin/bash
# Simple Sequential 1860 Scraper - NO ARRAYS, NO BACKGROUND PROCESSES
# This script is SIMPLE and RELIABLE

SCRIPT_DIR="/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"
LOG_DIR="/tmp/simple-1860"
MAIN_LOG="$LOG_DIR/sequential-scraper.log"
BATCH_SIZE=100  # Process 100 locations per batch

mkdir -p "$LOG_DIR"
cd "$SCRIPT_DIR"

# States in priority order (largest first)
STATES=(
    "Tennessee"
    "Missouri"
    "North Carolina"
    "Virginia"
    "Texas"
    "Louisiana"
    "Mississippi"
    "Maryland"
    "South Carolina"
    "Washington, District of Columbia"
)

echo "======================================================================" | tee -a "$MAIN_LOG"
echo "🎯 SIMPLE SEQUENTIAL 1860 SCRAPER" | tee -a "$MAIN_LOG"
echo "Started: $(date)" | tee -a "$MAIN_LOG"
echo "Batch size: $BATCH_SIZE locations per run" | tee -a "$MAIN_LOG"
echo "======================================================================" | tee -a "$MAIN_LOG"
echo "" | tee -a "$MAIN_LOG"

# Function to check remaining locations
check_remaining() {
    local state="$1"
    local remaining=$(node check-state-progress.js | grep "$state" | awk '{print $(NF-1)}')
    echo "$remaining"
}

# Function to process a state batch
process_batch() {
    local state="$1"
    local batch_num="$2"
    local state_slug=$(echo "$state" | tr ' ' '-' | tr ',' '' | tr '[:upper:]' '[:lower:]')
    local batch_log="$LOG_DIR/${state_slug}-batch-${batch_num}.log"
    
    echo "" | tee -a "$MAIN_LOG"
    echo "🚀 Processing: $state (Batch #$batch_num)" | tee -a "$MAIN_LOG"
    echo "   Time: $(date)" | tee -a "$MAIN_LOG"
    echo "   Log: $batch_log" | tee -a "$MAIN_LOG"
    
    # Run synchronously (wait for completion)
    env FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
        --state "$state" \
        --limit "$BATCH_SIZE" \
        > "$batch_log" 2>&1
    
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        echo "   ✅ Batch completed successfully" | tee -a "$MAIN_LOG"
        
        # Extract stats from log
        local stats=$(tail -20 "$batch_log" | grep -A 5 "EXTRACTION COMPLETE")
        if [ -n "$stats" ]; then
            echo "$stats" | grep "Locations processed\|Owners extracted\|Enslaved extracted\|Elapsed time" | sed 's/^/   /' | tee -a "$MAIN_LOG"
        fi
        return 0
    else
        echo "   ⚠️ Batch failed with exit code: $exit_code" | tee -a "$MAIN_LOG"
        return 1
    fi
}

# Main processing loop
batch_counter=0
total_batches_processed=0

for state in "${STATES[@]}"; do
    echo "" | tee -a "$MAIN_LOG"
    echo "======================================================================" | tee -a "$MAIN_LOG"
    echo "📍 STATE: $state" | tee -a "$MAIN_LOG"
    echo "======================================================================" | tee -a "$MAIN_LOG"
    
    while true; do
        # Check remaining locations
        remaining=$(check_remaining "$state")
        
        if [ -z "$remaining" ] || [ "$remaining" = "0" ]; then
            echo "✅ $state complete!" | tee -a "$MAIN_LOG"
            break
        fi
        
        echo "   Remaining: $remaining locations" | tee -a "$MAIN_LOG"
        
        # Process next batch
        batch_counter=$((batch_counter + 1))
        process_batch "$state" "$batch_counter"
        
        if [ $? -eq 0 ]; then
            total_batches_processed=$((total_batches_processed + 1))
            
            # Refresh cookies every 3 batches (~4-5 hours)
            if [ $((total_batches_processed % 3)) -eq 0 ]; then
                echo "" | tee -a "$MAIN_LOG"
                echo "🔄 Refreshing cookies (every 3 batches)..." | tee -a "$MAIN_LOG"
                sleep 30  # Short break for cookie refresh
            fi
        else
            echo "⚠️ Batch failed, waiting 60s before retry..." | tee -a "$MAIN_LOG"
            sleep 60
        fi
        
        # Small delay between batches
        sleep 10
    done
done

# Final status
echo "" | tee -a "$MAIN_LOG"
echo "======================================================================" | tee -a "$MAIN_LOG"
echo "📊 FINAL STATUS" | tee -a "$MAIN_LOG"
echo "======================================================================" | tee -a "$MAIN_LOG"

node check-state-progress.js | tee -a "$MAIN_LOG"

echo "" | tee -a "$MAIN_LOG"
echo "======================================================================" | tee -a "$MAIN_LOG"
echo "🎉 ALL STATES COMPLETE!" | tee -a "$MAIN_LOG"
echo "Total batches processed: $total_batches_processed" | tee -a "$MAIN_LOG"
echo "Completed: $(date)" | tee -a "$MAIN_LOG"
echo "======================================================================" | tee -a "$MAIN_LOG"
