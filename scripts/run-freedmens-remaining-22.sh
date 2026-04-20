#!/bin/bash
# Run the 22 branches that haven't been fully processed yet.
#
# Uses the proven no-Chrome-restart strategy from the 5-branch test:
#   • NO Chrome restart between branches (restarts were the rate-limit trigger)
#   • 75s politeness pause between branches (session-continuity signal)
#   • 25-min per-branch timeout via hand-rolled bash watchdog
#   • 200 depositor cap per branch
#   • LIVE DB writes enabled
#
# Already-processed branches (skipped here):
#   Charleston R21 (50), Richmond R26 (12), Savannah R8 (3) — original overnight
#   Charleston R23, DC R4, Huntsville AL, Baltimore MD, Louisville KY — 5-test
#   Philadelphia PA — organizational form, needs separate parser
#
# Output:
#   /tmp/freedmens-22/<slug>.log per branch
#   /tmp/freedmens-22/run.log overall

set -uo pipefail
cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"

OUT=/tmp/freedmens-22
mkdir -p "$OUT"
RUN_LOG="$OUT/run.log"

export NODE_OPTIONS="--max-old-space-size=1536"

BRANCHES=(
    "Richmond, Virginia — Roll 27"
    "Washington, D.C. — Roll 5"
    "New York, New York"
    "Beaufort, South Carolina"
    "Augusta, Georgia"
    "Atlanta, Georgia"
    "Vicksburg, Mississippi"
    "Tallahassee, Florida"
    "Wilmington, North Carolina"
    "Nashville, Tennessee"
    "Memphis, Tennessee"
    "Lexington, Kentucky"
    "Little Rock, Arkansas"
    "Lynchburg, Virginia"
    "Mobile, Alabama"
    "Natchez, Mississippi"
    "New Bern, North Carolina"
    "New Orleans, Louisiana"
    "Norfolk, Virginia"
    "Shreveport, Louisiana"
    "St. Louis, Missouri"
    "Columbus, Mississippi"
)

TOTAL=${#BRANCHES[@]}
COUNT=0

echo "════════════════════════════════════════════════════════" | tee "$RUN_LOG"
echo "  22-BRANCH PRODUCTION RUN — no Chrome restart, 75s pauses" | tee -a "$RUN_LOG"
echo "  Started: $(date)" | tee -a "$RUN_LOG"
echo "  Expected completion: $(date -v +10H)" | tee -a "$RUN_LOG"
echo "════════════════════════════════════════════════════════" | tee -a "$RUN_LOG"

# Pre-flight
if ! curl -sf http://localhost:9222/json/version >/dev/null 2>&1; then
    echo "❌ Chrome debug port 9222 not responding. Aborting." | tee -a "$RUN_LOG"
    exit 1
fi

for branch in "${BRANCHES[@]}"; do
    COUNT=$((COUNT + 1))
    SLUG=$(echo "$branch" | tr ' ,' '--' | tr -d '.—' | tr -s '-')
    LOGFILE="$OUT/$SLUG.log"

    echo "" | tee -a "$RUN_LOG"
    echo "──── [$COUNT/$TOTAL] $branch" | tee -a "$RUN_LOG"
    echo "     log: $LOGFILE" | tee -a "$RUN_LOG"
    echo "     started: $(date +%H:%M:%S)" | tee -a "$RUN_LOG"

    # Politeness pause between branches
    if [ "$COUNT" -gt 1 ]; then
        echo "     politeness pause 75s…" | tee -a "$RUN_LOG"
        sleep 75
    fi

    # Mid-run Chrome health check every 5 branches
    if [ $(( (COUNT - 1) % 5 )) -eq 0 ] && [ "$COUNT" -gt 1 ]; then
        if ! curl -sf http://localhost:9222/json/version >/dev/null 2>&1; then
            echo "⚠️  Chrome unresponsive after $((COUNT - 1)) branches — aborting" | tee -a "$RUN_LOG"
            exit 2
        fi
    fi

    TIMEOUT_SEC=1500
    node scripts/extract-freedmens-fields.js \
        --branch "$branch" \
        --limit 200 \
        --acct-max 99999 \
        --max-image 9999 \
        > "$LOGFILE" 2>&1 &
    BRANCH_PID=$!
    ( sleep "$TIMEOUT_SEC" && kill -TERM "$BRANCH_PID" 2>/dev/null ) &
    WATCHDOG_PID=$!
    wait "$BRANCH_PID" 2>/dev/null
    EXIT=$?
    kill -TERM "$WATCHDOG_PID" 2>/dev/null || true
    wait "$WATCHDOG_PID" 2>/dev/null || true

    # Post-branch DB audit
    METRICS=$(node --input-type=module -e "
        import 'dotenv/config';
        import pg from 'pg';
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        const loc = '${branch%% — *}';
        const roll = $([[ "$branch" == *" — "* ]] && echo "'${branch#* — }'" || echo 'null');
        const rollFilter = roll ? \`AND context_text LIKE '%\${roll}%'\` : '';
        const q = await pool.query(\`
            SELECT
                COUNT(*) FILTER (WHERE review_notes::text LIKE '%google_vision_spatial_parser_v2%')::int AS extracted,
                COUNT(*) FILTER (WHERE relationships::text LIKE '%google_vision_ledger%')::int AS with_enslaver,
                COUNT(*) FILTER (WHERE relationships::text LIKE '%enslaved_name%')::int AS with_old_title
            FROM unconfirmed_persons
            WHERE extraction_method='freedmens_bank_index' AND \$1 = ANY(locations) \${rollFilter}
        \`, [loc]);
        console.log(JSON.stringify(q.rows[0]));
        await pool.end();
    " 2>&1 | tail -1)
    echo "     finished (exit=$EXIT)  DB-state: $METRICS" | tee -a "$RUN_LOG"
done

echo "" | tee -a "$RUN_LOG"
echo "════════════════════════════════════════════════════════" | tee -a "$RUN_LOG"
echo "  22-BRANCH RUN COMPLETE  $(date)" | tee -a "$RUN_LOG"
echo "════════════════════════════════════════════════════════" | tee -a "$RUN_LOG"

# Final grand-total audit
node --input-type=module -e "
    import 'dotenv/config';
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const q = await pool.query(\`
        SELECT
            COUNT(*) FILTER (WHERE review_notes::text LIKE '%google_vision_spatial_parser_v2%')::int AS extracted,
            COUNT(*) FILTER (WHERE relationships::text LIKE '%google_vision_ledger%')::int AS with_enslaver,
            COUNT(*) FILTER (WHERE relationships::text LIKE '%enslaved_name%')::int AS with_old_title
        FROM unconfirmed_persons
        WHERE extraction_method='freedmens_bank_index'
    \`);
    console.log('GRAND TOTAL: ' + JSON.stringify(q.rows[0]));
    await pool.end();
" 2>&1 | tee -a "$RUN_LOG"
