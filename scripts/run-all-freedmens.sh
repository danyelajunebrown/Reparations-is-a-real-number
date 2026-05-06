#!/bin/bash
# Freedmen's Bank — scrape ALL branches sequentially, unattended.
#
# Memory-safe runner: caps Node heap, relaunches Chrome between branches to
# release accumulated memory (each FS image viewer session leaks ~50-200MB),
# and aborts if swap pressure gets dangerous. Designed for 8GB machines.
#
# Prerequisites:
#   • Chrome running with --remote-debugging-port=9222, logged into FamilySearch
#   • .env with DATABASE_URL set
#
# Usage:
#   bash scripts/run-all-freedmens.sh            # all remaining branches
#   CHROME_RESTART_EVERY=3 bash scripts/...      # restart Chrome every 3 branches instead of every 1
#   SKIP_CHROME_RESTART=1 bash scripts/...       # disable restart (for debugging)
#
# Logs: /tmp/freedmens-<branch>.log per branch

set -uo pipefail

# ── Memory guardrails ────────────────────────────────────────────────────────
# Cap Node heap at 1.5GB. Scraper's working set is ~300-600MB; anything past
# 1.5GB means a leak and should OOM the process instead of taking down the OS.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

CHROME_RESTART_EVERY="${CHROME_RESTART_EVERY:-1}"
SWAP_ABORT_PCT="${SWAP_ABORT_PCT:-80}"
DEBUG_PORT=9222

# ── Capture the Chrome command line so relaunches match the user's profile ──
CHROME_CMD=$(ps -ax -o command= 2>/dev/null \
    | grep -E '/Google Chrome\.app/Contents/MacOS/Google Chrome .*--remote-debugging-port='"$DEBUG_PORT" \
    | grep -v grep \
    | head -1 || true)

if [ -z "$CHROME_CMD" ]; then
    echo "❌ Chrome is not running with --remote-debugging-port=$DEBUG_PORT."
    echo ""
    echo "Launch Chrome first, e.g.:"
    echo '  open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/familysearch-freedmens'
    echo ""
    echo "Then log into FamilySearch in that window and rerun this script."
    exit 1
fi

# Extract just the argument list (everything after the binary path)
CHROME_ARGS=$(echo "$CHROME_CMD" | sed -E 's|^.*/Google Chrome[^ ]*||' | sed -E 's/^ +//')
echo "Detected Chrome args: $CHROME_ARGS"

# ── Optional: start from a specific branch name ──────────────────────────────
# Usage: START_BRANCH="Augusta, Georgia" bash scripts/run-all-freedmens.sh
# All branches before the match are skipped.
START_BRANCH="${START_BRANCH:-}"

# ── Helpers ──────────────────────────────────────────────────────────────────

swap_pct() {
    # macOS sysctl vm.swapusage: "total = 1024.00M  used = 513.00M  free = 511.00M"
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
    echo "  swap usage: ${pct}%"
    if [ "$pct" -gt "$SWAP_ABORT_PCT" ]; then
        echo "  ⚠️  Swap above ${SWAP_ABORT_PCT}% — aborting to prevent kernel panic."
        echo "     Close other apps, reboot, then resume with --start N on the current branch."
        return 1
    fi
    return 0
}

relaunch_chrome() {
    echo "  ⟳ Relaunching Chrome to release accumulated memory…"

    # Clean shutdown via AppleScript avoids the "didn't shut down correctly" dialog.
    osascript -e 'tell application "Google Chrome" to quit' 2>/dev/null || true

    # Wait for the debug port to close (max 15s)
    for i in $(seq 1 30); do
        if ! lsof -nP -iTCP:$DEBUG_PORT -sTCP:LISTEN >/dev/null 2>&1; then break; fi
        sleep 0.5
    done

    # Belt-and-suspenders: force kill any stragglers
    pkill -x "Google Chrome" 2>/dev/null || true
    pkill -f "Google Chrome Helper" 2>/dev/null || true
    sleep 2

    # Relaunch with the same args we detected
    # shellcheck disable=SC2086
    open -na "Google Chrome" --args $CHROME_ARGS

    # Wait for the debug port to respond (max 60s)
    for i in $(seq 1 60); do
        if curl -sf "http://localhost:$DEBUG_PORT/json/version" >/dev/null 2>&1; then
            echo "  ✓ Chrome ready on port $DEBUG_PORT"
            # Extra settle time so the first page.goto() doesn't race with startup
            sleep 3
            return 0
        fi
        sleep 1
    done

    echo "  ❌ Chrome failed to respond on port $DEBUG_PORT after 60s"
    return 1
}

# ── Already scraped (skip) ────────────────────────────────────────────────────
# Beaufort, South Carolina  — scraped 2026-04-11
# Charleston, South Carolina — scraped 2026-04-11 (421 pages, 2,526 records)

# ── Remaining branches (alphabetical) ────────────────────────────────────────
BRANCHES=(
    "Atlanta, Georgia"
    "Augusta, Georgia"
    "Baltimore, Maryland"
    "Columbus, Mississippi"
    "Huntsville, Alabama"
    "Lexington, Kentucky"
    "Little Rock, Arkansas"
    "Louisville, Kentucky"
    "Lynchburg, Virginia"
    "Memphis, Tennessee"
    "Mobile, Alabama"
    "Nashville, Tennessee"
    "Natchez, Mississippi"
    "New Bern, North Carolina"
    "New Orleans, Louisiana"
    "New York, New York"
    "Norfolk, Virginia"
    "Philadelphia, Pennsylvania"
    "Raleigh, North Carolina"
    "Richmond, Virginia"
    "Savannah, Georgia"
    "Shreveport, Louisiana"
    "St. Louis, Missouri"
    "Tallahassee, Florida"
    "Vicksburg, Mississippi"
    "Washington D. C."
    "Wilmington, North Carolina"
)

TOTAL=${#BRANCHES[@]}
COUNT=0

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Freedmen's Bank batch runner"
echo "  Branches: $TOTAL  •  Node heap cap: $NODE_OPTIONS"
echo "  Chrome restart every $CHROME_RESTART_EVERY branch(es)"
echo "  Abort if swap > ${SWAP_ABORT_PCT}%"
echo "════════════════════════════════════════════════════════"

# Track whether we have reached the start branch yet (empty = start immediately)
FOUND_START=0
[ -z "$START_BRANCH" ] && FOUND_START=1

for branch in "${BRANCHES[@]}"; do
    COUNT=$((COUNT + 1))

    # --start-branch: skip everything before the named branch
    if [ "$FOUND_START" -eq 0 ]; then
        if [ "$branch" = "$START_BRANCH" ]; then
            FOUND_START=1
        else
            echo "  ⏭  Skipping '$branch' (before START_BRANCH=$START_BRANCH)"
            continue
        fi
    fi

    LOGFILE="/tmp/freedmens-$(echo "$branch" | tr ' ,' '--' | tr -d '.').log"

    echo ""
    echo "════════════════════════════════════════════════════════"
    echo "  Branch $COUNT/$TOTAL: $branch"
    echo "  Log: $LOGFILE"
    echo "════════════════════════════════════════════════════════"

    # Pre-branch memory check — abort cleanly if swap is getting dangerous
    if ! abort_if_swap_high; then
        echo ""
        echo "Stopped before branch '$branch'. Resume later with:"
        echo "  node scripts/scrape-freedmens-bank-indexed.js --branch \"$branch\" --start 0"
        exit 2
    fi

    # Relaunch Chrome between branches (unless disabled or not yet due)
    if [ -z "${SKIP_CHROME_RESTART:-}" ] && [ $(( (COUNT - 1) % CHROME_RESTART_EVERY )) -eq 0 ] && [ "$COUNT" -gt 1 ]; then
        if ! relaunch_chrome; then
            echo "⚠️  Chrome relaunch failed — skipping '$branch' and continuing."
            continue
        fi
    fi

    node scripts/scrape-freedmens-bank-indexed.js --branch "$branch" --start 0 2>&1 | tee "$LOGFILE"

    EXIT_CODE=${PIPESTATUS[0]}
    if [ $EXIT_CODE -ne 0 ]; then
        echo ""
        echo "⚠️  Branch '$branch' exited with code $EXIT_CODE. Continuing to next branch..."
    else
        echo ""
        echo "✅ Branch '$branch' complete."
    fi
done

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ALL $TOTAL BRANCHES COMPLETE"
echo "════════════════════════════════════════════════════════"
