#!/bin/bash
# Resume the three branches that did not complete in the redo-4 round:
#   - Huntsville (today: 5-min crash at net::ERR_ABORTED, 0 matches saved)
#   - Tallahassee (today: 5h 37m run before Puppeteer detached-frame crash,
#                  56 matches saved, halted at acct 263)
#   - Savannah R8 (yesterday: 6h+ run before Vision API 503 crash,
#                  123 matches saved, halted at image 43)
#
# Already-processed depositors are auto-skipped by extract-freedmens-fields.js
# via its `review_notes NOT LIKE '%ledger_extraction%'` filter, so re-running
# with the same params naturally only processes depositors that haven't been
# enriched yet. No --acct-min flag needed.
#
# IMPORTANT: max_img defaults to 324 in the script when --max-image is unset,
# which silently caps processing. We pass 99999 explicitly here so Huntsville
# and Tallahassee process all images, and 75 for Savannah R8 (the form-variant
# cutoff per the Apr 18 manual audit).
#
# Pings include elapsed minutes (resolves the ntfy ambiguity from the redo-4
# round where "✗ Tallahassee exit=1" looked the same after 5 hours as after
# 25 seconds).

set -uo pipefail
cd "$HOME/Desktop/Reparations-is-a-real-number"
set -a; [ -f .env ] && source .env; set +a

OUT=/tmp/freedmens-resume
mkdir -p "$OUT"
RUN_LOG="$OUT/run.log"

notify() {
    local severity="${2:-info}"
    [ -n "${OPS_NOTIFY_WEBHOOK:-}" ] && curl -s -m 5 \
        -H "Title: $(hostname) freedmens-resume" \
        -H "Priority: $([ "$severity" = error ] && echo 5 || echo 3)" \
        -H "Tags: scraper,freedmens,resume,$severity" \
        -d "$1" "$OPS_NOTIFY_WEBHOOK" >/dev/null 2>&1 || true
}

notify "Resume run starting: Huntsville fresh, Tallahassee resume, Savannah R8 resume"

declare -a BRANCHES=(
  "huntsville|Huntsville, Alabama|99999|4096"
  "tallahassee|Tallahassee, Florida|99999|2048"
  "savannah-r8|Savannah, Georgia — Roll 8|75|2048"
)

for spec in "${BRANCHES[@]}"; do
    IFS='|' read -r slug branch max_img heap <<< "$spec"
    log="$OUT/${slug}.log"
    started=$(date +%s)
    echo "[$(date +%T)] === $branch (max_img=$max_img, heap=${heap}MB) ===" | tee -a "$RUN_LOG"
    args=(--branch "$branch" --max-image "$max_img")
    NODE_OPTIONS="--max-old-space-size=$heap" node scripts/extract-freedmens-fields.js "${args[@]}" > "$log" 2>&1
    rc=$?
    elapsed=$(( $(date +%s) - started ))
    elapsed_min=$(( elapsed / 60 ))
    echo "[$(date +%T)] $branch exit=$rc (ran ${elapsed_min}m)" | tee -a "$RUN_LOG"
    summary=$(grep -E "Records parsed|Depositors matched|DB updates|Errors|Pages OCRd" "$log" 2>/dev/null | tail -5 | tr '\n' '|')
    echo "$summary" | tee -a "$RUN_LOG"
    if [ $rc -eq 0 ]; then
        notify "✓ $branch done after ${elapsed_min}m — $summary"
    else
        notify "✗ $branch exit=$rc after ${elapsed_min}m — $summary" error
    fi
    sleep 180
done

echo "[$(date +%T)] === RESUME COMPLETE ===" | tee -a "$RUN_LOG"
notify "Freedmens resume complete"
