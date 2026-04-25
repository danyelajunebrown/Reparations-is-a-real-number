#!/bin/bash
# Solo runner: Savannah R8 only (DC R4 + NO LA already done Apr 24).
# Previous attempts: MacBook ran out of time, Mini SIGTERM'd at exit=143.
# Per Session 33 (Apr 24), Savannah was zero-yield and was killed; this script
# is preserved but should only be re-run after the underlying issue is fixed.
set -uo pipefail
cd "$HOME/Desktop/Reparations-is-a-real-number"
export NODE_OPTIONS="--max-old-space-size=2048"
set -a; [ -f .env ] && source .env; set +a

OUT=/tmp/freedmens-savannah-r8
mkdir -p "$OUT"
RUN_LOG="$OUT/run.log"

notify() {
    local severity="${2:-info}"
    [ -n "${OPS_NOTIFY_WEBHOOK:-}" ] && curl -s -m 5 \
        -H "Title: $(hostname) freedmens-savannah" \
        -H "Priority: $([ "$severity" = error ] && echo 5 || echo 3)" \
        -H "Tags: scraper,freedmens,savannah,$severity" \
        -d "$1" "$OPS_NOTIFY_WEBHOOK" >/dev/null 2>&1 || true
}

notify "Savannah R8 solo run starting (max_img=75)"
log="$OUT/savannah-r8.log"
echo "[$(date +%T)] === Savannah, Georgia — Roll 8 (max_img=75) ===" | tee -a "$RUN_LOG"
node scripts/extract-freedmens-fields.js --branch "Savannah, Georgia — Roll 8" --max-image 75 > "$log" 2>&1
rc=$?
echo "[$(date +%T)] Savannah R8 exit=$rc" | tee -a "$RUN_LOG"
summary=$(grep -E "Records parsed|Depositors matched|DB updates|Errors|Pages OCRd" "$log" 2>/dev/null | tail -5 | tr '\n' '|')
echo "$summary" | tee -a "$RUN_LOG"
if [ $rc -eq 0 ]; then
    notify "✓ Savannah R8 done — $summary"
else
    notify "✗ Savannah R8 exit=$rc — $summary" error
fi
