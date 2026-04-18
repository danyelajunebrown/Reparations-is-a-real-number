#!/bin/bash
# Run remaining Freedmen's Bank branches that failed due to FS session expiry.
# PREREQUISITE: Log into FamilySearch in the debug Chrome window first.
cd "$(dirname "$0")/.."

BRANCHES=(
  "New Bern, North Carolina"
  "New Orleans, Louisiana"
  "Norfolk, Virginia"
  "Philadelphia, Pennsylvania"
  "Savannah, Georgia — Roll 8"
  "Savannah, Georgia — Roll 9"
  "Savannah, Georgia — Roll 10"
  "Shreveport, Louisiana"
  "St. Louis, Missouri"
  "Tallahassee, Florida"
  "Vicksburg, Mississippi"
  "Atlanta, Georgia"
  "Augusta, Georgia"
)

echo "═══════════════════════════════════════════════"
echo "  BATCH RUN: ${#BRANCHES[@]} branches"
echo "═══════════════════════════════════════════════"
echo ""

for branch in "${BRANCHES[@]}"; do
  echo "──── Starting: $branch ────"
  node scripts/scrape-freedmens-bank-indexed.js --branch "$branch"
  echo ""
done

echo "═══════════════════════════════════════════════"
echo "  ALL BRANCHES COMPLETE"
echo "═══════════════════════════════════════════════"
