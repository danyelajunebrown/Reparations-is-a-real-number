#!/bin/bash
# Run full Liberty County probate roll — all 689 images
# Usage: bash scripts/run-liberty-full.sh
# Resumes from where it left off (skips already-written images).
# Clears stale sitemap so the roll is not marked "complete" from a prior --limit run.

set -e
cd "$(dirname "$0")/.."

echo "[run-liberty-full] Starting full Liberty County roll..."
nohup node scripts/scrapers/georgia-probate-scraper.js \
  --county Liberty \
  --roll-title 1790-1850 \
  --apply \
  --resume \
  --clear-sitemap \
  > ~/probate-liberty-roll1.log 2>&1 &

echo "[run-liberty-full] PID: $!"
echo "[run-liberty-full] Monitor: tail -f ~/probate-liberty-roll1.log"
