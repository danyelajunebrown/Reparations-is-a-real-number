#!/bin/bash
# =============================================================================
# DOUBLE-CLICK TO START SCRAPER
# =============================================================================
# This file can be double-clicked in Finder to start the scraper.
# It will resume from where it left off if interrupted.
# =============================================================================

cd "$(dirname "$0")"

echo ""
echo "========================================================================"
echo "  1860 SLAVE SCHEDULE SCRAPER"
echo "========================================================================"
echo "  Starting at: $(date)"
echo "  This will resume from where it left off."
echo ""
echo "  DO NOT CLOSE THIS WINDOW"
echo "  You can minimize it."
echo "========================================================================"
echo ""

# Prevent Mac from sleeping while running
caffeinate -i -w $$ &

# Run the master scraper
FAMILYSEARCH_INTERACTIVE=true ./scripts/run-all-1860-slave-schedules.sh

echo ""
echo "========================================================================"
echo "  SCRAPER STOPPED"
echo "  Stopped at: $(date)"
echo "  Run again tomorrow to continue."
echo "========================================================================"
echo ""
read -p "Press Enter to close..."
