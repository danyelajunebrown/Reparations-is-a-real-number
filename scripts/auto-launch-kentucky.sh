#!/bin/bash
# Auto-launch Kentucky after Georgia completes

SCRIPT_DIR="/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"
cd "$SCRIPT_DIR"

echo "⏳ Waiting for Georgia to complete..."
echo "Started: $(date)"

# Wait for Georgia process to finish
while ps aux | grep "extract-census-ocr.*Georgia" | grep -v grep > /dev/null; do
    sleep 60  # Check every minute
done

echo "✅ Georgia complete!"
echo "🚀 Launching Kentucky..."
echo "Kentucky started: $(date)"

# Launch Kentucky
FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js --state "Kentucky" --limit 200 > /tmp/kentucky.log 2>&1 &

echo "✅ Kentucky launched! PID: $!"
echo "Monitor with: tail -f /tmp/kentucky.log"
