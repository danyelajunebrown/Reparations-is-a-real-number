#!/bin/bash
# Waits for freedmens-savannah to finish, then redoes the 4 failed branches:
#   Charleston R21 (Detached Frame), Memphis (Detached Frame),
#   Tallahassee (exit=1), Huntsville (heap OOM at 1.5GB → bumped to 4GB).
#
# 2026-04-25 fix: REMOVED `pkill -f 'Google Chrome for Testing'` and
# `pkill -f 'puppeteer'` between branches. The original script killed Chrome
# without relaunching it, which destroyed the FS-logged-in session on port
# 9222 and caused every branch to exit=1 at startup. Now the 180s between-
# branch sleep gives Chrome time to settle without dropping the auth state.
# extract-freedmens-fields.js connects to the existing Chrome on :9222 each
# branch and shares the same authenticated session.
set -uo pipefail
cd "$HOME/Desktop/Reparations-is-a-real-number"
set -a; [ -f .env ] && source .env; set +a

PM2=/usr/local/bin/pm2
OUT=/tmp/freedmens-redo-4
mkdir -p "$OUT"
RUN_LOG="$OUT/run.log"

notify() {
    local severity="${2:-info}"
    [ -n "${OPS_NOTIFY_WEBHOOK:-}" ] && curl -s -m 5 \
        -H "Title: $(hostname) freedmens-redo" \
        -H "Priority: $([ "$severity" = error ] && echo 5 || echo 3)" \
        -H "Tags: scraper,freedmens,redo,$severity" \
        -d "$1" "$OPS_NOTIFY_WEBHOOK" >/dev/null 2>&1 || true
}

# 1. Wait for Savannah to finish
echo "[$(date +%T)] Waiting for freedmens-savannah to finish..." | tee -a "$RUN_LOG"
while $PM2 list 2>/dev/null | grep -E 'freedmens-savannah' | grep -q online; do
    sleep 60
done
echo "[$(date +%T)] freedmens-savannah finished — beginning redo round" | tee -a "$RUN_LOG"

# 2. Settle period before first branch (no Chrome restart — see comment above).
sleep 90

notify "Redo round starting: Charleston R21, Memphis, Tallahassee, Huntsville"

# 3. Branch loop. Format: slug|branch|max_img|heap_mb
declare -a BRANCHES=(
  "charleston-r21|Charleston, South Carolina — Roll 21|324|2048"
  "memphis|Memphis, Tennessee||2048"
  "tallahassee|Tallahassee, Florida||2048"
  "huntsville|Huntsville, Alabama||4096"
)

for spec in "${BRANCHES[@]}"; do
    IFS='|' read -r slug branch max_img heap <<< "$spec"
    log="$OUT/${slug}.log"
    echo "[$(date +%T)] === $branch (max_img=${max_img:-all}, heap=${heap}MB) ===" | tee -a "$RUN_LOG"
    args=(--branch "$branch")
    [ -n "$max_img" ] && args+=(--max-image "$max_img")
    NODE_OPTIONS="--max-old-space-size=$heap" node scripts/extract-freedmens-fields.js "${args[@]}" > "$log" 2>&1
    rc=$?
    echo "[$(date +%T)] $branch exit=$rc" | tee -a "$RUN_LOG"
    summary=$(grep -E 'Records parsed|Depositors matched|DB updates|Errors|Pages OCRd' "$log" 2>/dev/null | tail -5 | tr '\n' '|')
    echo "$summary" | tee -a "$RUN_LOG"
    if [ $rc -eq 0 ]; then
        notify "✓ $branch done — $summary"
    else
        notify "✗ $branch exit=$rc — $summary" error
    fi
    # Settle period between branches (no pkill — see header comment).
    sleep 180
done

echo "[$(date +%T)] === REDO-4 COMPLETE ===" | tee -a "$RUN_LOG"
notify "Freedmens redo-4 complete — all 4 branches processed"
