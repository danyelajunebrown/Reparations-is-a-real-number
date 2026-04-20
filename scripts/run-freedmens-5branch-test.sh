#!/bin/bash
# Focused 5-branch extraction test — rate-limit-friendly strategy.
#
# Strategy changes vs overnight runner:
#   • NO Chrome restart between branches (each restart looked like a new
#     session to Incapsula and re-triggered rate limiting).
#   • 75s politeness pause between branches (session-continuity signal).
#   • 5 enslaver-field branches spread across geography.
#   • Per-branch 25-min timeout (slightly tighter, since 75s of each 30-min
#     budget went to the pause).
#
# Output:
#   /tmp/freedmens-5branch/<slug>.log per branch
#   /tmp/freedmens-5branch/run.log overall

set -uo pipefail
cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"

OUT=/tmp/freedmens-5branch
mkdir -p "$OUT"
RUN_LOG="$OUT/run.log"

export NODE_OPTIONS="--max-old-space-size=1536"

BRANCHES=(
    "Charleston, South Carolina — Roll 23"
    "Washington, D.C. — Roll 4"
    "Huntsville, Alabama"
    "Baltimore, Maryland"
    "Louisville, Kentucky"
)

TOTAL=${#BRANCHES[@]}
COUNT=0

echo "════════════════════════════════════════════════════════" | tee "$RUN_LOG"
echo "  5-BRANCH RATE-LIMIT-SAFE TEST" | tee -a "$RUN_LOG"
echo "  Started: $(date)" | tee -a "$RUN_LOG"
echo "  No Chrome restart between branches" | tee -a "$RUN_LOG"
echo "  75s politeness pause between branches" | tee -a "$RUN_LOG"
echo "════════════════════════════════════════════════════════" | tee -a "$RUN_LOG"

# Verify Chrome is reachable before starting
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

    # Politeness pause before each branch (except the first)
    if [ "$COUNT" -gt 1 ]; then
        echo "     politeness pause 75s…" | tee -a "$RUN_LOG"
        sleep 75
    fi

    # 25-min (1500s) hard watchdog
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

    # Per-branch DB audit (read-only)
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
echo "  COMPLETE  $(date)" | tee -a "$RUN_LOG"
echo "════════════════════════════════════════════════════════" | tee -a "$RUN_LOG"
