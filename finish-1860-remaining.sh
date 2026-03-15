#!/bin/bash
# Simple sequential runner to finish all remaining 1860 states
# Each state runs to completion before moving to next

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
    
    FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
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
