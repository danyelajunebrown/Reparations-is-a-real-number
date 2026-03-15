#!/bin/bash
# Resilient Georgia 1860 Slave Schedule Scraper
# Auto-restarts on crash, continues until all 184 locations are done

STATE="Georgia"
YEAR=1860
LOG_FILE="/tmp/georgia-1860.log"
MAX_ATTEMPTS=20
BATCH_SIZE=30

cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"

echo "========================================" >> $LOG_FILE
echo "Starting Georgia scraper at $(date)" >> $LOG_FILE
echo "State: $STATE" >> $LOG_FILE
echo "Batch size: $BATCH_SIZE locations per run" >> $LOG_FILE
echo "Max attempts: $MAX_ATTEMPTS" >> $LOG_FILE
echo "========================================" >> $LOG_FILE

for attempt in $(seq 1 $MAX_ATTEMPTS); do
    echo "" >> $LOG_FILE
    echo ">>> Attempt $attempt of $MAX_ATTEMPTS at $(date)" >> $LOG_FILE
    
    # Check remaining locations
    REMAINING=$(node check-state-progress.js | grep "Georgia" | awk '{print $4}' | cut -d'/' -f1)
    echo "   Locations remaining: $REMAINING" >> $LOG_FILE
    
    if [ "$REMAINING" = "616" ] || [ "$REMAINING" = "0" ]; then
        echo "✅ Georgia complete! Exiting." >> $LOG_FILE
        exit 0
    fi

    # Run the scraper with small batch
    FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
        --state "$STATE" \
        --year $YEAR \
        --limit $BATCH_SIZE \
        >> $LOG_FILE 2>&1

    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        echo "   Batch completed successfully" >> $LOG_FILE
    else
        echo "   ⚠️ Crashed with exit code $EXIT_CODE" >> $LOG_FILE
    fi
    
    # Wait 10 seconds before next batch (let FamilySearch session reset)
    echo "   Waiting 10 seconds before next batch..." >> $LOG_FILE
    sleep 10
done

echo "" >> $LOG_FILE
echo "❌ Max attempts ($MAX_ATTEMPTS) reached. Check progress manually." >> $LOG_FILE
exit 1
