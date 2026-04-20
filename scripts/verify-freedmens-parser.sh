#!/bin/bash
# Freedmen's Bank parser verification sweep.
#
# Runs extract-freedmens-fields.js --random on one page per branch, so we
# can check: does the parser handle every branch's form template, does it
# gracefully skip paper-overlay pages, does it produce sensible data on
# tattered pages, etc.
#
# Usage:
#   bash scripts/verify-freedmens-parser.sh
#
# Output:
#   /tmp/freedmens-verify/<branch-slug>.log per branch
#   /tmp/freedmens-verify/SUMMARY.tsv aggregate results

set -uo pipefail

cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"

OUT=/tmp/freedmens-verify
mkdir -p "$OUT"
SUMMARY="$OUT/SUMMARY.tsv"
echo -e "branch\trecords\tlabels_found\tenslaver_fields\tdepositor_name\tsample_value" > "$SUMMARY"

# Branches with enslaver fields (per project_freedmens_form_inventory.md)
# plus every other branch — test parser behavior on both.
BRANCHES=(
    "Charleston, South Carolina — Roll 21"
    "Charleston, South Carolina — Roll 23"
    "Richmond, Virginia — Roll 26"
    "Richmond, Virginia — Roll 27"
    "Washington, D.C. — Roll 4"
    "Washington, D.C. — Roll 5"
    "Savannah, Georgia — Roll 8"
    "New York, New York"
    "Beaufort, South Carolina"
    "Huntsville, Alabama"
    "Augusta, Georgia"
    "Atlanta, Georgia"
    "Vicksburg, Mississippi"
    "Tallahassee, Florida"
    "Wilmington, North Carolina"
    "Nashville, Tennessee"
    "Memphis, Tennessee"
    "Lexington, Kentucky"
    "Little Rock, Arkansas"
    "Louisville, Kentucky"
    "Lynchburg, Virginia"
    "Mobile, Alabama"
    "Natchez, Mississippi"
    "New Bern, North Carolina"
    "New Orleans, Louisiana"
    "Norfolk, Virginia"
    "Philadelphia, Pennsylvania"
    "Shreveport, Louisiana"
    "St. Louis, Missouri"
    "Baltimore, Maryland"
    "Columbus, Mississippi"
)

TOTAL=${#BRANCHES[@]}
IDX=0
export NODE_OPTIONS="--max-old-space-size=1536"

for branch in "${BRANCHES[@]}"; do
    IDX=$((IDX + 1))
    SLUG=$(echo "$branch" | tr ' ,' '--' | tr -d '.—')
    LOGFILE="$OUT/$SLUG.log"
    echo ""
    echo "════════════════════════════════════════════════════"
    echo "  [$IDX/$TOTAL] $branch"
    echo "════════════════════════════════════════════════════"

    node scripts/extract-freedmens-fields.js \
        --branch "$branch" \
        --random \
        --limit 1 \
        --max-image 9999 \
        --dry-run \
        > "$LOGFILE" 2>&1

    # Parse summary metrics out of the log using Node (simpler than awk on
    # unicode box-drawing output).
    RESULT=$(node -e '
        const fs = require("fs");
        const log = fs.readFileSync(process.argv[1], "utf8");
        const records = (log.match(/Records parsed:\s+(\d+)/) || [0,0])[1];
        const matched = /✓ acct/.test(log);
        // Pull first parsed summary line (master/mistress etc)
        const summaryLine = (log.match(/master=.*?residence=.*?(?=\n)/) || [""])[0].slice(0,180);
        const enslaverMatch = log.match(/master="([^"]*)"[^\n]*mistress="([^"]*)"[^\n]*old_title="([^"]*)"/);
        const hasEnslaver = enslaverMatch ? (enslaverMatch[1] || enslaverMatch[2] || enslaverMatch[3]) : "";
        const depName = (log.match(/✓ acct \d+ \(([^,]+),/) || [0,""])[1];
        console.log(JSON.stringify({records, hasEnslaver, depName, sample: summaryLine.slice(0,120)}));
    ' "$LOGFILE" 2>/dev/null || echo '{"records":0,"hasEnslaver":"","depName":"","sample":"(parse error)"}')

    REC=$(echo "$RESULT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).records)')
    ENS=$(echo "$RESULT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).hasEnslaver)')
    DEP=$(echo "$RESULT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).depName)')
    SMP=$(echo "$RESULT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).sample)')

    echo -e "${branch}\t${REC}\t-\t${ENS}\t${DEP}\t${SMP}" >> "$SUMMARY"
    echo "  → records=$REC, enslaver=\"$ENS\", depositor=\"$DEP\""
done

echo ""
echo "════════════════════════════════════════════════════"
echo "  SWEEP COMPLETE"
echo "════════════════════════════════════════════════════"
echo "  Summary: $SUMMARY"
echo "  Per-branch logs: $OUT/"
cat "$SUMMARY"
