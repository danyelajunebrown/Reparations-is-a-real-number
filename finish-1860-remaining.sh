#!/bin/bash
# Simple sequential runner to finish all remaining 1860 states
# Each state runs to completion before moving to next
#
# Prerequisites:
#   • fs-cookies.json must exist with valid FamilySearch session cookies.
#     Run any state once interactively (FAMILYSEARCH_INTERACTIVE=true) and log in
#     when the Chrome window opens — cookies are saved automatically.
#   • Each state launches its own Chrome window (FAMILYSEARCH_INTERACTIVE=true),
#     loads saved cookies, and proceeds. If cookies have expired, you'll see the
#     login window and can sign in manually.
#
# NOTE: CHROME_REMOTE_PORT is intentionally NOT used here because extract-census-ocr.js
# calls browser.close() at the end of each run, which kills Chrome — so port 9222 only
# works for the first state and breaks all subsequent ones.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env so OPS_NOTIFY_WEBHOOK is available (if set)
# shellcheck disable=SC2046
[ -f .env ] && export $(grep -E '^OPS_NOTIFY_WEBHOOK=' .env | xargs) 2>/dev/null || true

# Fire-and-forget ntfy notification — never blocks or fails the scrape
ntfy_post() {
    local msg="$1"
    local title="${2:-1860 Slave Schedule}"
    local priority="${3:-default}"
    if [ -n "${OPS_NOTIFY_WEBHOOK:-}" ]; then
        curl -s -o /dev/null \
            -H "Title: $title" \
            -H "Priority: $priority" \
            -d "$msg" \
            "$OPS_NOTIFY_WEBHOOK" &
    fi
}

echo "========================================"
echo "FINISHING 1860 SLAVE SCHEDULE"
echo "Started: $(date)"
echo "========================================"

ntfy_post "1860 scrape starting — $(date '+%H:%M') — states: DC GA SC MD MS LA TX VA" "1860 Slave Schedule" "default"

# States with remaining work (in order of size - smallest first for quick wins)
STATES=(
    "Washington, District of Columbia:20"
    "Georgia:20"
    "South Carolina:150"
    "Maryland:250"
    "Mississippi:270"
    "Louisiana:300"
    "Texas:320"
    "Virginia:320"
)

for state_info in "${STATES[@]}"; do
    state=$(echo "$state_info" | cut -d: -f1)
    limit=$(echo "$state_info" | cut -d: -f2)
    
    echo ""
    echo "========================================"
    echo "Processing: $state"
    echo "Limit: $limit locations"
    echo "Started: $(date)"
    echo "========================================"
    
    ntfy_post "Starting $state (limit $limit locations)" "1860 — $state" "default"

    FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
        --state "$state" \
        --limit "$limit"
    EXIT_CODE=$?

    echo ""
    if [ $EXIT_CODE -eq 0 ]; then
        echo "✅ $state complete"
        ntfy_post "$state done at $(date '+%H:%M')" "1860 — $state DONE" "default"
    else
        echo "⚠ $state exited with code $EXIT_CODE"
        ntfy_post "$state exited with code $EXIT_CODE at $(date '+%H:%M')" "1860 — $state ERROR" "high"
    fi
    echo "Finished: $(date)"
done

echo ""
echo "========================================"
echo "ALL STATES COMPLETE!"
echo "Finished: $(date)"
echo "========================================"

ntfy_post "All 1860 states finished at $(date '+%H:%M'). Running check-state-progress…" "1860 ALL DONE" "default"

# Show final status
node check-state-progress.js
