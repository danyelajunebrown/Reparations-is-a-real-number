#!/bin/bash
# Resilient 1860 Slave Schedule Scraper
# Auto-restarts on crash, logs everything

STATES="Arkansas,Alabama"
YEAR=1860
LOG_FILE="/tmp/arkansas-alabama-1860.log"
MAX_RETRIES=10
RETRY_COUNT=0

cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"

echo "========================================" >> $LOG_FILE
echo "Starting resilient scraper at $(date)" >> $LOG_FILE
echo "States: $STATES" >> $LOG_FILE
echo "Max retries: $MAX_RETRIES" >> $LOG_FILE
echo "========================================" >> $LOG_FILE

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    echo "" >> $LOG_FILE
    echo ">>> Attempt $((RETRY_COUNT + 1)) of $MAX_RETRIES at $(date)" >> $LOG_FILE

    # Run the scraper
    FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
        --states "$STATES" \
        --year $YEAR \
        >> $LOG_FILE 2>&1

    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        echo "" >> $LOG_FILE
        echo "✅ Scraper completed successfully at $(date)" >> $LOG_FILE
        exit 0
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "" >> $LOG_FILE
        echo "⚠️ Scraper crashed with exit code $EXIT_CODE at $(date)" >> $LOG_FILE
        echo "   Waiting 30 seconds before retry..." >> $LOG_FILE
        sleep 30
    fi
done

echo "" >> $LOG_FILE
echo "❌ Max retries ($MAX_RETRIES) exceeded. Giving up at $(date)" >> $LOG_FILE
exit 1
