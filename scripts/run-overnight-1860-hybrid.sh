#!/bin/bash
# Overnight 1860 Slave Schedule Scraper - Hybrid Approach
# Phase 1: Sequential Georgia + Kentucky
# Phase 2: Parallel Tennessee + Missouri + North Carolina

SCRIPT_DIR="/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"
LOG_DIR="/tmp/overnight-1860"
MASTER_LOG="$LOG_DIR/master.log"
BATCH_SIZE=10  # Small batches to avoid session timeouts
BATCHES_PER_COOKIE_REFRESH=5  # Refresh cookies every 50 locations

mkdir -p "$LOG_DIR"

cd "$SCRIPT_DIR"

echo "========================================" | tee -a "$MASTER_LOG"
echo "🌙 OVERNIGHT 1860 SCRAPER - HYBRID MODE" | tee -a "$MASTER_LOG"
echo "Started: $(date)" | tee -a "$MASTER_LOG"
echo "========================================" | tee -a "$MASTER_LOG"
echo "" | tee -a "$MASTER_LOG"

# Function to check remaining locations for a state
check_remaining() {
    local state="$1"
    # Get second-to-last field (the number before "left")
    local remaining=$(node check-state-progress.js | grep "$state" | awk '{print $(NF-1)}')
    echo "$remaining"
}

# Function to run a batch with cookie refresh
run_batch_with_refresh() {
    local state="$1"
    local batch_num="$2"
    local state_log="$LOG_DIR/${state,,}.log"
    
    echo "  [Batch $batch_num] Processing $BATCH_SIZE locations..." | tee -a "$MASTER_LOG"
    
    # Every 5 batches, do a quick cookie refresh test
    if [ $((batch_num % BATCHES_PER_COOKIE_REFRESH)) -eq 0 ]; then
        echo "  [Batch $batch_num] 🔄 Cookie refresh checkpoint..." | tee -a "$MASTER_LOG"
        timeout 60 env FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
            --state "$state" \
            --limit 1 \
            >> "$state_log" 2>&1 || true
        sleep 5
    fi
    
    # Run the actual batch
    timeout 600 env FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
        --state "$state" \
        --limit $BATCH_SIZE \
        >> "$state_log" 2>&1
    
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        echo "  [Batch $batch_num] ✅ Success" | tee -a "$MASTER_LOG"
        return 0
    elif [ $exit_code -eq 124 ]; then
        echo "  [Batch $batch_num] ⏱️ Timeout (continuing)" | tee -a "$MASTER_LOG"
        return 0
    else
        echo "  [Batch $batch_num] ⚠️ Error (continuing)" | tee -a "$MASTER_LOG"
        return 1
    fi
}

# Function to process a state completely
process_state() {
    local state="$1"
    local max_batches="$2"
    
    echo "" | tee -a "$MASTER_LOG"
    echo "========================================" | tee -a "$MASTER_LOG"
    echo "📍 PROCESSING: $state" | tee -a "$MASTER_LOG"
    echo "========================================" | tee -a "$MASTER_LOG"
    
    local batch_count=0
    
    while [ $batch_count -lt $max_batches ]; do
        batch_count=$((batch_count + 1))
        
        # Check remaining
        local remaining=$(check_remaining "$state")
        echo "" | tee -a "$MASTER_LOG"
        echo "📊 $state: $remaining locations remaining" | tee -a "$MASTER_LOG"
        
        if [ "$remaining" = "0" ] || [ -z "$remaining" ]; then
            echo "✅ $state COMPLETE!" | tee -a "$MASTER_LOG"
            break
        fi
        
        # Run batch
        run_batch_with_refresh "$state" "$batch_count"
        
        # Short delay between batches
        sleep 3
    done
}

# ============================================================================
# PHASE 1: SEQUENTIAL (Georgia + Kentucky)
# ============================================================================

echo "" | tee -a "$MASTER_LOG"
echo "🔷 PHASE 1: SEQUENTIAL PROCESSING" | tee -a "$MASTER_LOG"
echo "   Georgia (110 remaining) + Kentucky (196 remaining)" | tee -a "$MASTER_LOG"
echo "" | tee -a "$MASTER_LOG"

# Georgia first (should take ~2-3 hours with 110 locations)
process_state "Georgia" 15  # 15 batches max (150 locations)

# Kentucky second (should take ~3-4 hours with 196 locations)
process_state "Kentucky" 25  # 25 batches max (250 locations)

echo "" | tee -a "$MASTER_LOG"
echo "✅ PHASE 1 COMPLETE!" | tee -a "$MASTER_LOG"
echo "Phase 1 finished: $(date)" | tee -a "$MASTER_LOG"

# ============================================================================
# PHASE 2: PARALLEL (Tennessee + Missouri + North Carolina)
# ============================================================================

echo "" | tee -a "$MASTER_LOG"
echo "🔷 PHASE 2: PARALLEL PROCESSING" | tee -a "$MASTER_LOG"
echo "   Tennessee (987) + Missouri (565) + North Carolina (494)" | tee -a "$MASTER_LOG"
echo "" | tee -a "$MASTER_LOG"

# Launch 3 parallel scrapers with separate logs
echo "🚀 Launching 3 parallel scrapers..." | tee -a "$MASTER_LOG"

# Tennessee (largest - needs most batches)
(process_state "Tennessee" 120 >> "$LOG_DIR/tennessee-parallel.log" 2>&1) &
TENN_PID=$!

sleep 5  # Stagger starts

# Missouri
(process_state "Missouri" 70 >> "$LOG_DIR/missouri-parallel.log" 2>&1) &
MO_PID=$!

sleep 5  # Stagger starts

# North Carolina
(process_state "North Carolina" 60 >> "$LOG_DIR/nc-parallel.log" 2>&1) &
NC_PID=$!

echo "   Tennessee PID: $TENN_PID" | tee -a "$MASTER_LOG"
echo "   Missouri PID: $MO_PID" | tee -a "$MASTER_LOG"
echo "   North Carolina PID: $NC_PID" | tee -a "$MASTER_LOG"

# Wait for all parallel processes
echo "" | tee -a "$MASTER_LOG"
echo "⏳ Waiting for parallel processes to complete..." | tee -a "$MASTER_LOG"

wait $TENN_PID
echo "   ✅ Tennessee complete" | tee -a "$MASTER_LOG"

wait $MO_PID
echo "   ✅ Missouri complete" | tee -a "$MASTER_LOG"

wait $NC_PID
echo "   ✅ North Carolina complete" | tee -a "$MASTER_LOG"

echo "" | tee -a "$MASTER_LOG"
echo "✅ PHASE 2 COMPLETE!" | tee -a "$MASTER_LOG"
echo "Phase 2 finished: $(date)" | tee -a "$MASTER_LOG"

# ============================================================================
# FINAL STATUS
# ============================================================================

echo "" | tee -a "$MASTER_LOG"
echo "========================================" | tee -a "$MASTER_LOG"
echo "📊 FINAL STATUS" | tee -a "$MASTER_LOG"
echo "========================================" | tee -a "$MASTER_LOG"

node check-state-progress.js | tee -a "$MASTER_LOG"

echo "" | tee -a "$MASTER_LOG"
echo "========================================" | tee -a "$MASTER_LOG"
echo "🎉 OVERNIGHT SCRAPING COMPLETE!" | tee -a "$MASTER_LOG"
echo "Completed: $(date)" | tee -a "$MASTER_LOG"
echo "========================================" | tee -a "$MASTER_LOG"
