#!/bin/bash
# Freedmen's Bank full enslaver-field extraction — overnight runner.
#
# Runs extract-freedmens-fields.js across all 28 branches (index-scraped),
# captures full field extraction (master/mistress/plantation + identity fields),
# writes to DB, and runs a garbage audit after each branch completes.
#
# Memory-safe: caps Node heap, restarts Chrome between branches, aborts if
# swap pressure spikes. Designed to run unattended on an 8GB laptop overnight.
#
# Prerequisites:
#   • Chrome running with --remote-debugging-port=9222, logged into FamilySearch
#     (see scripts/run-all-freedmens.sh header for launch command)
#   • .env with DATABASE_URL and GOOGLE_VISION_API_KEY set
#
# Usage:
#   bash scripts/run-freedmens-field-extraction.sh
#   PER_BRANCH_LIMIT=200 bash scripts/run-freedmens-field-extraction.sh
#   DRY_RUN=1 bash scripts/run-freedmens-field-extraction.sh
#
# Logs:
#   /tmp/freedmens-field/<branch-slug>.log per branch
#   /tmp/freedmens-field/AUDIT.log aggregate post-branch audits
#   /tmp/freedmens-field/SUMMARY.tsv tabular summary

set -uo pipefail

cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"

OUT=/tmp/freedmens-field
mkdir -p "$OUT"
SUMMARY="$OUT/SUMMARY.tsv"
AUDIT="$OUT/AUDIT.log"
: > "$AUDIT"
echo -e "branch\tdepositors_processed\tocr_calls\trecords_parsed\tenslaver_field_count\tdb_updates\telapsed_min" > "$SUMMARY"

# ── Runtime knobs ────────────────────────────────────────────────────────────
export NODE_OPTIONS="--max-old-space-size=1536"
PER_BRANCH_LIMIT="${PER_BRANCH_LIMIT:-300}"   # depositor cap per branch
DRY_RUN_FLAG=""
[ -n "${DRY_RUN:-}" ] && DRY_RUN_FLAG="--dry-run"
CHROME_RESTART_EVERY="${CHROME_RESTART_EVERY:-1}"
SWAP_ABORT_PCT="${SWAP_ABORT_PCT:-80}"
DEBUG_PORT=9222
PER_BRANCH_TIMEOUT="${PER_BRANCH_TIMEOUT:-30m}"

# ── Capture Chrome command so we can relaunch with the same profile ─────────
CHROME_CMD=$(ps -ax -o command= 2>/dev/null \
    | grep -E '/Google Chrome\.app/Contents/MacOS/Google Chrome .*--remote-debugging-port='"$DEBUG_PORT" \
    | grep -v grep | head -1 || true)
if [ -z "$CHROME_CMD" ]; then
    echo "❌ Chrome not running on debug port $DEBUG_PORT. Launch first:"
    echo '   open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/familysearch-freedmens'
    exit 1
fi
CHROME_ARGS=$(echo "$CHROME_CMD" | sed -E 's|^.*/Google Chrome[^ ]*||' | sed -E 's/^ +//')
echo "Detected Chrome args: $CHROME_ARGS"

# ── Helpers ──────────────────────────────────────────────────────────────────
swap_pct() {
    local usage total used
    usage=$(sysctl -n vm.swapusage 2>/dev/null || echo "")
    total=$(echo "$usage" | sed -E 's/.*total = ([0-9.]+)M.*/\1/')
    used=$(echo "$usage" | sed -E 's/.*used = ([0-9.]+)M.*/\1/')
    if [ -z "$total" ] || [ -z "$used" ] || [ "$total" = "0" ]; then echo 0; return; fi
    awk -v u="$used" -v t="$total" 'BEGIN{ printf "%d", (u/t)*100 }'
}
abort_if_swap_high() {
    local pct
    pct=$(swap_pct)
    echo "  swap: ${pct}%"
    if [ "$pct" -gt "$SWAP_ABORT_PCT" ]; then
        echo "  ⚠️  swap above ${SWAP_ABORT_PCT}% — aborting to prevent kernel panic"
        return 1
    fi
    return 0
}
relaunch_chrome() {
    echo "  ⟳ relaunching Chrome to release accumulated memory…"
    osascript -e 'tell application "Google Chrome" to quit' 2>/dev/null || true
    for i in $(seq 1 30); do
        if ! lsof -nP -iTCP:$DEBUG_PORT -sTCP:LISTEN >/dev/null 2>&1; then break; fi
        sleep 0.5
    done
    pkill -x "Google Chrome" 2>/dev/null || true
    pkill -f "Google Chrome Helper" 2>/dev/null || true
    sleep 2
    # shellcheck disable=SC2086
    open -na "Google Chrome" --args $CHROME_ARGS
    for i in $(seq 1 60); do
        if curl -sf "http://localhost:$DEBUG_PORT/json/version" >/dev/null 2>&1; then
            echo "  ✓ Chrome ready"
            sleep 4
            return 0
        fi
        sleep 1
    done
    echo "  ❌ Chrome failed to respond on port $DEBUG_PORT after 60s"
    return 1
}
ZERO_EXTRACT_STREAK=0
audit_branch() {
    local branch="$1"
    local branchLocation="${branch%% — *}"
    local rollLabel=""
    [[ "$branch" == *" — "* ]] && rollLabel="${branch#* — }"

    echo "" >> "$AUDIT"
    echo "════════ AUDIT: $branch ════════" >> "$AUDIT"
    local auditOut
    auditOut=$(node --input-type=module -e "
        import 'dotenv/config';
        import pg from 'pg';
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        const loc = \`$branchLocation\`;
        const roll = \`$rollLabel\`;
        const rollFilter = roll ? \`AND context_text LIKE '%\${roll}%'\` : '';
        const q = await pool.query(\`
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE review_notes::text LIKE '%ledger_extraction%')::int AS extracted,
                COUNT(*) FILTER (WHERE relationships::text LIKE '%google_vision_ledger%')::int AS with_enslaver,
                COUNT(*) FILTER (WHERE relationships::text LIKE '%enslaved_name%')::int AS with_old_title
            FROM unconfirmed_persons
            WHERE extraction_method='freedmens_bank_index' AND \$1 = ANY(locations) \${rollFilter}
        \`, [loc]);
        const g = await pool.query(\`
            SELECT COUNT(*)::int AS garbage_count
            FROM unconfirmed_persons, jsonb_array_elements(relationships) AS rel
            WHERE extraction_method='freedmens_bank_index' AND \$1 = ANY(locations) \${rollFilter}
              AND rel->>'match_source' LIKE '%vision_ledger%'
              AND rel->>'type' = 'enslaved_by'
              AND (length(rel->>'name') < 3 OR rel->>'name' ~ '^[\\d\\s.,;:\"\\\\-]*$')
        \`, [loc]);
        const r = q.rows[0];
        console.log('METRICS ' + JSON.stringify({
            total: r.total, extracted: r.extracted, with_enslaver: r.with_enslaver,
            with_old_title: r.with_old_title, garbage: g.rows[0].garbage_count
        }));
        await pool.end();
    " 2>&1)
    echo "$auditOut" | tee -a "$AUDIT"

    # Parse metrics and apply thresholds — ABORT on signs of systemic failure.
    local metrics extracted with_enslaver garbage ratio
    metrics=$(echo "$auditOut" | grep -oE 'METRICS .*$' | sed 's/^METRICS //' || echo '{}')
    extracted=$(echo "$metrics" | python3 -c "import json,sys;print(json.load(sys.stdin).get('extracted',0))" 2>/dev/null || echo 0)
    with_enslaver=$(echo "$metrics" | python3 -c "import json,sys;print(json.load(sys.stdin).get('with_enslaver',0))" 2>/dev/null || echo 0)
    garbage=$(echo "$metrics" | python3 -c "import json,sys;print(json.load(sys.stdin).get('garbage',0))" 2>/dev/null || echo 0)

    if [ "$with_enslaver" -gt 0 ]; then
        ratio=$(awk -v g="$garbage" -v e="$with_enslaver" 'BEGIN{ printf "%d", (g*100)/e }')
        echo "  garbage ratio: ${ratio}% (${garbage} of ${with_enslaver} enslaver-tagged)" | tee -a "$AUDIT"
        if [ "$ratio" -gt 30 ]; then
            echo "  ⚠️  garbage ratio over 30% — aborting run for human review" | tee -a "$AUDIT"
            exit 3
        fi
    fi
    if [ "$extracted" -eq 0 ]; then
        ZERO_EXTRACT_STREAK=$((ZERO_EXTRACT_STREAK + 1))
        echo "  zero-extract streak: $ZERO_EXTRACT_STREAK" | tee -a "$AUDIT"
        if [ "$ZERO_EXTRACT_STREAK" -ge 2 ]; then
            echo "  ⚠️  two consecutive branches with zero extractions — parser likely broken, aborting" | tee -a "$AUDIT"
            exit 4
        fi
    else
        ZERO_EXTRACT_STREAK=0
    fi
}

# ── Branches to run (all 28 index-scraped) ──────────────────────────────────
# Per memory-bank inventory: 11 have enslaver fields, 17 do not, but we run
# all for completeness — identity fields still get extracted on non-enslaver
# forms and the parser gracefully handles pages without the master field.
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
    "Shreveport, Louisiana"
    "St. Louis, Missouri"
    "Baltimore, Maryland"
    "Columbus, Mississippi"
)
# Philadelphia deliberately skipped — organizational ledger form, needs separate parser

TOTAL=${#BRANCHES[@]}
COUNT=0

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  FREEDMEN'S BANK FIELD EXTRACTION — FULL COLLECTION RUN"
echo "  Branches:   $TOTAL"
echo "  Per-branch limit: $PER_BRANCH_LIMIT depositors"
echo "  Per-branch timeout: $PER_BRANCH_TIMEOUT"
echo "  Heap cap:   $NODE_OPTIONS"
echo "  Mode:       ${DRY_RUN_FLAG:-LIVE (DB writes enabled)}"
echo "  Started:    $(date)"
echo "════════════════════════════════════════════════════════════"

for branch in "${BRANCHES[@]}"; do
    COUNT=$((COUNT + 1))
    SLUG=$(echo "$branch" | tr ' ,' '--' | tr -d '.—' | tr -s '-')
    LOGFILE="$OUT/$SLUG.log"
    START_EPOCH=$(date +%s)

    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "  [$COUNT/$TOTAL] $branch"
    echo "  Log: $LOGFILE"
    echo "  Started: $(date)"
    echo "════════════════════════════════════════════════════════════"

    if ! abort_if_swap_high; then
        echo "Aborting overnight run. Continue later with branches $COUNT-$TOTAL."
        exit 2
    fi

    if [ $(( (COUNT - 1) % CHROME_RESTART_EVERY )) -eq 0 ] && [ "$COUNT" -gt 1 ]; then
        relaunch_chrome || { echo "  Chrome relaunch failed; skipping"; continue; }
    fi

    # Run branch. Watchdog subshell kills it if it exceeds PER_BRANCH_TIMEOUT
    # (converted from e.g. "30m" to seconds) so one stuck branch can't eat
    # the whole night. macOS lacks gtimeout without coreutils, so use a
    # hand-rolled bash watchdog instead.
    TIMEOUT_SEC=$(echo "$PER_BRANCH_TIMEOUT" | sed -E 's/m$/*60/; s/h$/*3600/' | bc)
    node scripts/extract-freedmens-fields.js \
        --branch "$branch" \
        --limit "$PER_BRANCH_LIMIT" \
        --acct-max 99999 \
        --max-image 9999 \
        $DRY_RUN_FLAG \
        > "$LOGFILE" 2>&1 &
    BRANCH_PID=$!
    ( sleep "$TIMEOUT_SEC" && kill -TERM "$BRANCH_PID" 2>/dev/null ) &
    WATCHDOG_PID=$!
    wait "$BRANCH_PID" 2>/dev/null
    BRANCH_EXIT=$?
    kill -TERM "$WATCHDOG_PID" 2>/dev/null || true
    wait "$WATCHDOG_PID" 2>/dev/null || true
    [ $BRANCH_EXIT -ne 0 ] && echo "  (exit=$BRANCH_EXIT — branch errored or timed out at ${PER_BRANCH_TIMEOUT}, see log)"

    # Pull summary metrics from the log
    RUNTIME_MIN=$(( ($(date +%s) - START_EPOCH) / 60 ))
    DEP_COUNT=$(grep -oE '[0-9]+ depositors in scope' "$LOGFILE" | head -1 | grep -oE '^[0-9]+' || echo 0)
    OCR_CALLS=$(grep -oE 'Pages OCRd:\s+[0-9]+' "$LOGFILE" | grep -oE '[0-9]+$' || echo 0)
    REC_PARSED=$(grep -oE 'Records parsed:\s+[0-9]+' "$LOGFILE" | grep -oE '[0-9]+$' || echo 0)
    DB_UPDATES=$(grep -oE 'DB updates:\s+[0-9]+' "$LOGFILE" | grep -oE '[0-9]+$' || echo 0)

    echo -e "${branch}\t${DEP_COUNT}\t${OCR_CALLS}\t${REC_PARSED}\t-\t${DB_UPDATES}\t${RUNTIME_MIN}" >> "$SUMMARY"
    echo "  → deps=$DEP_COUNT ocr=$OCR_CALLS parsed=$REC_PARSED db=$DB_UPDATES (${RUNTIME_MIN}min)"

    # Post-branch DB audit
    audit_branch "$branch"
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  RUN COMPLETE"
echo "  Finished:   $(date)"
echo "════════════════════════════════════════════════════════════"
echo "  Summary:    $SUMMARY"
echo "  Audit log:  $AUDIT"
cat "$SUMMARY"
