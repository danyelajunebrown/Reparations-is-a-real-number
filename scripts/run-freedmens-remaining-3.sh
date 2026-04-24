#!/bin/bash
# Mini-only runner for the 3 branches left after MacBook handoff Apr 24:
#   Savannah R8 (max_img 75), DC R4 (max_img 232), New Orleans (max_img 101).
# Charleston R21, Baltimore, Huntsville, Louisville, Memphis, Tallahassee,
# Richmond R26 already attempted on MacBook (some completed, some exit=1).
# Run under PM2: pm2 start scripts/run-freedmens-remaining-3.sh

set -uo pipefail
cd "$HOME/Desktop/Reparations-is-a-real-number"
export NODE_OPTIONS="--max-old-space-size=1536"

# Load .env so notify() has OPS_NOTIFY_WEBHOOK
set -a; [ -f .env ] && source .env; set +a

OUT=/tmp/freedmens-remaining-3
mkdir -p "$OUT"
RUN_LOG="$OUT/run.log"

# Notification helper — fire-and-forget via curl to ntfy
notify() {
    local severity="${2:-info}"
    local title="$(hostname) freedmens"
    [ -n "${OPS_NOTIFY_WEBHOOK:-}" ] && curl -s -m 5 \
        -H "Title: $title" \
        -H "Priority: $([ "$severity" = "error" ] && echo 5 || echo 3)" \
        -H "Tags: scraper,freedmens,$severity" \
        -d "$1" "$OPS_NOTIFY_WEBHOOK" >/dev/null 2>&1 || true
}

notify "Freedmens remaining-3 runner starting: Savannah R8, DC R4, New Orleans"

declare -a BRANCHES=(
  "savannah-r8|Savannah, Georgia — Roll 8|75|"
  "dc-r4|Washington, D.C. — Roll 4|232|"
  "new-orleans|New Orleans, Louisiana|101|"
)

for spec in "${BRANCHES[@]}"; do
    IFS='|' read -r slug branch max_img acct_max <<< "$spec"
    log="$OUT/${slug}.log"
    echo "[$(date +%T)] === $branch (max_img=$max_img) ===" | tee -a "$RUN_LOG"

    args=(--branch "$branch")
    [ -n "$max_img" ] && [ "$max_img" != "99999" ] && args+=(--max-image "$max_img")
    [ -n "$acct_max" ] && args+=(--acct-max "$acct_max")

    node scripts/extract-freedmens-fields.js "${args[@]}" > "$log" 2>&1
    rc=$?
    echo "[$(date +%T)] $branch exit=$rc" | tee -a "$RUN_LOG"
    summary=$(grep -E "Records parsed|Depositors matched|DB updates|Errors|Pages OCRd" "$log" 2>/dev/null | tail -5 | tr '\n' '|')
    echo "$summary" | tee -a "$RUN_LOG"
    if [ $rc -eq 0 ]; then
        notify "✓ $branch done — $summary" "info"
    else
        notify "✗ $branch CRASHED exit=$rc — $summary" "error"
    fi
    sleep 75
done
echo "[$(date +%T)] === ALL 3 BRANCHES COMPLETE ===" | tee -a "$RUN_LOG"
notify "Freedmens remaining-3 complete — all branches processed"
