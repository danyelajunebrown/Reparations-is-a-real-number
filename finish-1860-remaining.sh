#!/bin/bash
# Simple sequential runner to finish all remaining 1860 states
# Each state runs to completion before moving to next
#
# ⚠️  CHROME MUST ALREADY BE RUNNING on port 9222, signed into FamilySearch:
#   open -na "Google Chrome" --args \
#     --remote-debugging-port=9222 \
#     --user-data-dir=/tmp/familysearch-ancestor-climber
# Then sign in manually, then run this script.
# Using CHROME_REMOTE_PORT connects to that existing session — no new login needed.
# (FAMILYSEARCH_INTERACTIVE=true launches a fresh Chrome that Google OAuth will block)

cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"

echo "========================================"
echo "FINISHING 1860 SLAVE SCHEDULE"
echo "Started: $(date)"
echo "========================================"

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
    
    CHROME_REMOTE_PORT=9222 node scripts/extract-census-ocr.js \
        --state "$state" \
        --limit "$limit"
    
    echo ""
    echo "✅ $state complete"
    echo "Finished: $(date)"
done

echo ""
echo "========================================"
echo "ALL STATES COMPLETE!"
echo "Finished: $(date)"
echo "========================================"

# Show final status
node check-state-progress.js
