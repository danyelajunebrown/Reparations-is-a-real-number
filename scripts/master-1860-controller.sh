#!/bin/bash
# Master Controller for 1860 Slave Schedule Scraping
# Features: Parallel processing, automatic cookie refresh, smart queue management

SCRIPT_DIR="/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"
LOG_DIR="/tmp/master-1860"
MASTER_LOG="$LOG_DIR/master-controller.log"
COOKIE_REFRESH_INTERVAL=7200  # 2 hours in seconds
MAX_PARALLEL_WORKERS=3
BATCH_SIZE=50  # Process 50 locations at a time per state

mkdir -p "$LOG_DIR"
cd "$SCRIPT_DIR"

# State queue (prioritized by size - largest first)
STATES=(
    "Tennessee:987"
    "Missouri:565"
    "North Carolina:494"
    "Virginia:298"
    "Texas:297"
    "Louisiana:274"
    "Mississippi:248"
    "Maryland:222"
    "South Carolina:128"
    "Washington, District of Columbia:15"
)

echo "======================================================================" | tee -a "$MASTER_LOG"
echo "🎯 MASTER 1860 CONTROLLER - PARALLEL PROCESSING" | tee -a "$MASTER_LOG"
echo "Started: $(date)" | tee -a "$MASTER_LOG"
echo "Max parallel workers: $MAX_PARALLEL_WORKERS" | tee -a "$MASTER_LOG"
echo "Cookie refresh interval: $((COOKIE_REFRESH_INTERVAL / 60)) minutes" | tee -a "$MASTER_LOG"
echo "======================================================================" | tee -a "$MASTER_LOG"
echo "" | tee -a "$MASTER_LOG"

# Function to check remaining locations for a state
check_remaining() {
    local state="$1"
    local remaining=$(node check-state-progress.js | grep "$state" | awk '{print $(NF-1)}')
    echo "$remaining"
}

# Function to refresh cookies
refresh_cookies() {
    echo "" | tee -a "$MASTER_LOG"
    echo "🔄 REFRESHING FAMILYSEARCH COOKIES..." | tee -a "$MASTER_LOG"
    echo "Time: $(date)" | tee -a "$MASTER_LOG"
    
    # Run a quick test to refresh cookies
    timeout 90 env FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
        --state "Tennessee" \
        --limit 1 \
        > "$LOG_DIR/cookie-refresh.log" 2>&1
    
    if [ $? -eq 0 ]; then
        echo "✅ Cookies refreshed successfully" | tee -a "$MASTER_LOG"
        return 0
    else
        echo "⚠️ Cookie refresh may have failed - continuing anyway" | tee -a "$MASTER_LOG"
        return 1
    fi
}

# Function to process a state
process_state() {
    local state="$1"
    local max_locations="$2"
    local worker_id="$3"
    local state_slug=$(echo "$state" | tr ' ' '-' | tr ',' '' | tr '[:upper:]' '[:lower:]')
    local state_log="$LOG_DIR/worker-${worker_id}-${state_slug}.log"
    
    echo "" | tee -a "$MASTER_LOG"
    echo "🚀 [Worker $worker_id] Starting: $state" | tee -a "$MASTER_LOG"
    echo "   Max locations: $max_locations" | tee -a "$MASTER_LOG"
    
    # Run in background and capture PID
    env FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
        --state "$state" \
        --limit "$max_locations" \
        > "$state_log" 2>&1 &
    
    local pid=$!
    echo "   PID: $pid" | tee -a "$MASTER_LOG"
    echo "   Log: $state_log" | tee -a "$MASTER_LOG"
    
    echo "$pid"
}

# Function to monitor and manage workers
run_parallel_workers() {
    local -A active_workers  # PID -> state name
    local -a pending_states=("${STATES[@]}")
    local last_cookie_refresh=$(date +%s)
    local initial_startup=true
    
    while true; do
        current_time=$(date +%s)
        
        # Check if we need to refresh cookies
        if [ $((current_time - last_cookie_refresh)) -ge $COOKIE_REFRESH_INTERVAL ]; then
            echo "" | tee -a "$MASTER_LOG"
            echo "⏰ Cookie refresh interval reached" | tee -a "$MASTER_LOG"
            
            # Wait for all workers to finish before refreshing
            if [ ${#active_workers[@]} -gt 0 ]; then
                echo "   Waiting for active workers to complete..." | tee -a "$MASTER_LOG"
                for pid in "${!active_workers[@]}"; do
                    wait "$pid" 2>/dev/null
                    echo "   ✅ Worker completed: ${active_workers[$pid]}" | tee -a "$MASTER_LOG"
                    unset active_workers[$pid]
                done
            fi
            
            # Refresh cookies
            refresh_cookies
            last_cookie_refresh=$(date +%s)
        fi
        
        # Clean up completed workers
        for pid in "${!active_workers[@]}"; do
            if ! kill -0 "$pid" 2>/dev/null; then
                echo "✅ [Worker completed] ${active_workers[$pid]}" | tee -a "$MASTER_LOG"
                unset active_workers[$pid]
            fi
        done
        
        # Start new workers if slots available
        while [ ${#active_workers[@]} -lt $MAX_PARALLEL_WORKERS ] && [ ${#pending_states[@]} -gt 0 ]; do
            # Get next state from queue
            state_info="${pending_states[0]}"
            pending_states=("${pending_states[@]:1}")
            
            state_name=$(echo "$state_info" | cut -d: -f1)
            max_locs=$(echo "$state_info" | cut -d: -f2)
            
            # Check if state actually needs work
            remaining=$(check_remaining "$state_name")
            
            if [ "$remaining" = "0" ] || [ -z "$remaining" ]; then
                echo "✅ $state_name already complete, skipping" | tee -a "$MASTER_LOG"
                continue
            fi
            
            # Calculate batch size (smaller of BATCH_SIZE or remaining)
            batch=$BATCH_SIZE
            if [ "$remaining" -lt "$batch" ]; then
                batch=$((remaining + 5))  # Add small buffer
            fi
            
            # Start worker
            worker_id=$((${#active_workers[@]} + 1))
            pid=$(process_state "$state_name" "$batch" "$worker_id")
            active_workers[$pid]="$state_name"
            
            sleep 5  # Stagger starts
        done
        
        # Give bash time to update array after starting workers
        sleep 2
        
        # On first iteration, skip exit check to let workers register
        if [ "$initial_startup" = true ]; then
            initial_startup=false
            echo "⏳ Initial startup - monitoring workers..." | tee -a "$MASTER_LOG"
        else
            # Check if all work is done
            if [ ${#active_workers[@]} -eq 0 ] && [ ${#pending_states[@]} -eq 0 ]; then
                echo "" | tee -a "$MASTER_LOG"
                echo "🎉 ALL WORK COMPLETE!" | tee -a "$MASTER_LOG"
                break
            fi
        fi
        
        # Show status
        if [ ${#active_workers[@]} -gt 0 ]; then
            echo "" | tee -a "$MASTER_LOG"
            echo "📊 Active workers: ${#active_workers[@]}/$MAX_PARALLEL_WORKERS" | tee -a "$MASTER_LOG"
            for pid in "${!active_workers[@]}"; do
                echo "   - PID $pid: ${active_workers[$pid]}" | tee -a "$MASTER_LOG"
            done
            echo "   Pending states: ${#pending_states[@]}" | tee -a "$MASTER_LOG"
        fi
        
        # Wait before next check
        sleep 60
    done
}

# Initial cookie refresh
refresh_cookies

# Start parallel processing
run_parallel_workers

# Final status
echo "" | tee -a "$MASTER_LOG"
echo "======================================================================" | tee -a "$MASTER_LOG"
echo "📊 FINAL STATUS" | tee -a "$MASTER_LOG"
echo "======================================================================" | tee -a "$MASTER_LOG"

node check-state-progress.js | tee -a "$MASTER_LOG"

echo "" | tee -a "$MASTER_LOG"
echo "======================================================================" | tee -a "$MASTER_LOG"
echo "🎉 MASTER CONTROLLER COMPLETE!" | tee -a "$MASTER_LOG"
echo "Completed: $(date)" | tee -a "$MASTER_LOG"
echo "======================================================================" | tee -a "$MASTER_LOG"
