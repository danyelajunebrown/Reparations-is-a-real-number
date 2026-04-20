#!/bin/bash
# Post-sweep recovery — re-runs any branch that the overnight run left empty.
#
# Meant to be launched AFTER the main runner exits. It inspects AUDIT.log,
# finds every branch whose extracted count is 0, and re-runs just those.
# Script is idempotent against already-extracted records (extract-freedmens-
# fields.js filters WHERE review_notes NOT LIKE '%ledger_extraction%').
#
# Usage:
#   bash scripts/recover-failed-branches.sh
#   # Typically chained: `wait $RUNNER_PID && bash .../recover-failed-branches.sh`

set -uo pipefail
cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"

AUDIT=/tmp/freedmens-field/AUDIT.log
OUT=/tmp/freedmens-field
RECOVERY_LOG="$OUT/RECOVERY.log"

if [ ! -f "$AUDIT" ]; then
    echo "No AUDIT.log found. Nothing to recover."
    exit 0
fi

# Parse AUDIT.log for branches with extracted:0. The audit format is:
#   ════════ AUDIT: <branch> ════════
#   METRICS {"total":...,"extracted":0,...}
FAILED_BRANCHES=()
current_branch=""
while IFS= read -r line; do
    if [[ "$line" =~ ^════════\ AUDIT:\ (.+)\ ════════ ]]; then
        current_branch="${BASH_REMATCH[1]}"
    elif [[ -n "$current_branch" && "$line" =~ METRICS.*\"extracted\":([0-9]+) ]]; then
        if [ "${BASH_REMATCH[1]}" = "0" ]; then
            FAILED_BRANCHES+=("$current_branch")
        fi
        current_branch=""
    fi
done < "$AUDIT"

echo "════════════════════════════════════════════════════" | tee -a "$RECOVERY_LOG"
echo "  RECOVERY SWEEP" | tee -a "$RECOVERY_LOG"
echo "  Started: $(date)" | tee -a "$RECOVERY_LOG"
echo "  Failed branches to retry: ${#FAILED_BRANCHES[@]}" | tee -a "$RECOVERY_LOG"
for b in "${FAILED_BRANCHES[@]}"; do echo "    • $b" | tee -a "$RECOVERY_LOG"; done
echo "════════════════════════════════════════════════════" | tee -a "$RECOVERY_LOG"

if [ ${#FAILED_BRANCHES[@]} -eq 0 ]; then
    echo "  Nothing to recover." | tee -a "$RECOVERY_LOG"
    exit 0
fi

export NODE_OPTIONS="--max-old-space-size=1536"
DEBUG_PORT=9222

# Verify Chrome is still usable (user may have fixed/refreshed it)
if ! curl -sf "http://localhost:$DEBUG_PORT/json/version" >/dev/null 2>&1; then
    echo "  ❌ Chrome not responding on $DEBUG_PORT — cannot recover. Relaunch Chrome first." | tee -a "$RECOVERY_LOG"
    exit 1
fi

for branch in "${FAILED_BRANCHES[@]}"; do
    SLUG=$(echo "$branch" | tr ' ,' '--' | tr -d '.—' | tr -s '-')
    LOGFILE="$OUT/${SLUG}-recovery.log"
    echo "" | tee -a "$RECOVERY_LOG"
    echo "──── retrying: $branch ────" | tee -a "$RECOVERY_LOG"
    # Politeness pause — 75s between branches reduces the "burst new session"
    # signature that triggered Incapsula's rate limit on Charleston R23 during
    # the main overnight run.
    echo "    waiting 75s for FS session to idle" | tee -a "$RECOVERY_LOG"
    sleep 75

    # Shorter limit on recovery runs (we only need to catch what was missed).
    # 30-min timeout still applies via the same hand-rolled watchdog.
    TIMEOUT_SEC=1800
    node scripts/extract-freedmens-fields.js \
        --branch "$branch" \
        --limit 300 \
        --acct-max 99999 \
        --max-image 9999 \
        > "$LOGFILE" 2>&1 &
    BRANCH_PID=$!
    ( sleep "$TIMEOUT_SEC" && kill -TERM "$BRANCH_PID" 2>/dev/null ) &
    WATCHDOG_PID=$!
    wait "$BRANCH_PID" 2>/dev/null
    EXIT=$?
    kill -TERM "$WATCHDOG_PID" 2>/dev/null || true

    REC_PARSED=$(grep -oE 'Records parsed:\s+[0-9]+' "$LOGFILE" | grep -oE '[0-9]+$' || echo 0)
    DB_UPDATES=$(grep -oE 'DB updates:\s+[0-9]+' "$LOGFILE" | grep -oE '[0-9]+$' || echo 0)
    echo "    → parsed=$REC_PARSED db=$DB_UPDATES (exit=$EXIT)" | tee -a "$RECOVERY_LOG"
done

echo "" | tee -a "$RECOVERY_LOG"
echo "════════════════════════════════════════════════════" | tee -a "$RECOVERY_LOG"
echo "  RECOVERY COMPLETE  $(date)" | tee -a "$RECOVERY_LOG"
echo "════════════════════════════════════════════════════" | tee -a "$RECOVERY_LOG"
