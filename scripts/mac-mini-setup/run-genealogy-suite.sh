#!/bin/bash
# =============================================================================
# MULTI-AGENT GENEALOGY SUITE RUNNER
# Runs multiple genealogy agents in parallel for continuous processing
# =============================================================================

PROJECT_DIR="$(dirname "$(dirname "$(dirname "$0")")")"
cd "$PROJECT_DIR"

# Source environment
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
source .env 2>/dev/null || true

LOGFILE="$PROJECT_DIR/logs/genealogy-suite-$(date +%Y%m%d).log"

echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOGFILE"
echo "   MULTI-SOURCE GENEALOGY SUITE - STARTING" | tee -a "$LOGFILE"
echo "   $(date)" | tee -a "$LOGFILE"
echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOGFILE"
echo "" | tee -a "$LOGFILE"

# Function to run an agent in a loop with auto-restart
run_agent() {
  local AGENT_NAME=$1
  local AGENT_SCRIPT=$2
  local RESTART_DELAY=$3
  
  while true; do
    echo "[$(date)] [${AGENT_NAME}] Starting..." >> "$LOGFILE"
    
    node "$AGENT_SCRIPT" >> "$LOGFILE" 2>&1
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
      echo "[$(date)] [${AGENT_NAME}] Completed normally, restarting in ${RESTART_DELAY}s..." >> "$LOGFILE"
    else
      echo "[$(date)] [${AGENT_NAME}] Exited with code $EXIT_CODE, restarting in ${RESTART_DELAY}s..." >> "$LOGFILE"
    fi
    
    sleep $RESTART_DELAY
  done
}

echo "Starting agents in parallel..." | tee -a "$LOGFILE"
echo "" | tee -a "$LOGFILE"

# Agent 1: WikiTree Genealogy (search profiles + extract descendants)
# Priority: Medium | Rate: ~3 seconds/request
run_agent "WikiTree" "$PROJECT_DIR/scripts/agents/wikitree-genealogy-agent.js" 180 &
WIKITREE_PID=$!
echo "  ✓ WikiTree Genealogy Agent (PID: $WIKITREE_PID)" | tee -a "$LOGFILE"

# Agent 2: Cross-Source Verification
# Priority: High | Rate: ~1 second/person (database only)
run_agent "CrossVerifier" "$PROJECT_DIR/scripts/agents/cross-verifier-agent.js" 120 &
VERIFIER_PID=$!
echo "  ✓ Cross-Verification Agent (PID: $VERIFIER_PID)" | tee -a "$LOGFILE"

# Agent 3: FamilySearch Census (existing script, wrapped)
# Priority: Medium | Rate: ~5 seconds/page (OCR)
(
  while true; do
    echo "[$(date)] [FamilySearch] Starting census extraction..." >> "$LOGFILE"
    
    FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js --year 1860 --limit 50 >> "$LOGFILE" 2>&1
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
      echo "[$(date)] [FamilySearch] Batch complete, restarting in 120s..." >> "$LOGFILE"
      sleep 120
    else
      echo "[$(date)] [FamilySearch] Error (code $EXIT_CODE), restarting in 180s..." >> "$LOGFILE"
      sleep 180
    fi
  done
) &
FAMILYSEARCH_PID=$!
echo "  ✓ FamilySearch Census Agent (PID: $FAMILYSEARCH_PID)" | tee -a "$LOGFILE"

echo "" | tee -a "$LOGFILE"
echo "All agents running. Press Ctrl+C to stop." | tee -a "$LOGFILE"
echo "" | tee -a "$LOGFILE"
echo "Monitor logs: tail -f $LOGFILE" | tee -a "$LOGFILE"
echo "" | tee -a "$LOGFILE"

# Store PIDs for cleanup
echo "$WIKITREE_PID" > "$PROJECT_DIR/logs/wikitree.pid"
echo "$VERIFIER_PID" > "$PROJECT_DIR/logs/verifier.pid"
echo "$FAMILYSEARCH_PID" > "$PROJECT_DIR/logs/familysearch.pid"

# Graceful shutdown handler
cleanup() {
  echo "" | tee -a "$LOGFILE"
  echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOGFILE"
  echo "   SHUTTING DOWN GENEALOGY SUITE" | tee -a "$LOGFILE"
  echo "   $(date)" | tee -a "$LOGFILE"
  echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOGFILE"
  
  echo "Stopping agents..." | tee -a "$LOGFILE"
  
  if [ -n "$WIKITREE_PID" ]; then
    kill $WIKITREE_PID 2>/dev/null
    echo "  ✓ Stopped WikiTree Agent" | tee -a "$LOGFILE"
  fi
  
  if [ -n "$VERIFIER_PID" ]; then
    kill $VERIFIER_PID 2>/dev/null
    echo "  ✓ Stopped Cross-Verifier Agent" | tee -a "$LOGFILE"
  fi
  
  if [ -n "$FAMILYSEARCH_PID" ]; then
    kill $FAMILYSEARCH_PID 2>/dev/null
    echo "  ✓ Stopped FamilySearch Agent" | tee -a "$LOGFILE"
  fi
  
  # Clean up PID files
  rm -f "$PROJECT_DIR/logs/"*.pid
  
  echo "" | tee -a "$LOGFILE"
  echo "Shutdown complete." | tee -a "$LOGFILE"
  exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for all background jobs
wait
