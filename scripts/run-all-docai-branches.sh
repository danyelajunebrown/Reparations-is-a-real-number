#!/bin/bash
# run-all-docai-branches.sh
#
# Sequential DocAI enrichment runner for ALL 29 Freedman's Bank branches.
# Runs the 3 partially-enriched branches first, then all zero-progress
# branches largest-first.
#
# Each branch is fully resumable/idempotent — records with 'docai_enrichment'
# in review_notes are automatically skipped.
#
# Prerequisites (Mac Mini):
#   • Chrome running with remote debugging:
#       open -na "Google Chrome" --args \
#         --remote-debugging-port=9222 \
#         --user-data-dir=/tmp/familysearch-ancestor-climber
#   • Signed into FamilySearch in that Chrome window
#   • .env present with DATABASE_URL, GCP_PROJECT_ID, DOCUMENT_AI_PROCESSOR_ID,
#     GOOGLE_APPLICATION_CREDENTIALS, S3_BUCKET, S3_REGION
#
# Usage:
#   bash scripts/run-all-docai-branches.sh
#
# Run inside screen so it survives SSH disconnect (Mac Mini has no tmux):
#   screen -S docai
#   bash scripts/run-all-docai-branches.sh 2>&1 | tee /tmp/docai-all-branches.log
#   Ctrl-a d  (detach)
#
# Resume after interruption: just re-run the same command. Already-enriched
# records are skipped automatically.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

# Load OPS_NOTIFY_WEBHOOK from .env if present
# shellcheck disable=SC2046
[ -f .env ] && export $(grep -E '^OPS_NOTIFY_WEBHOOK=' .env | xargs) 2>/dev/null || true

ntfy_post() {
    local msg="$1"
    local _default="Freedmans Bank DocAI"
    local title="${2:-$_default}"
    local priority="${3:-default}"
    if [ -n "${OPS_NOTIFY_WEBHOOK:-}" ]; then
        curl -s -o /dev/null \
            -H "Title: $title" \
            -H "Priority: $priority" \
            -d "$msg" \
            "$OPS_NOTIFY_WEBHOOK" &
    fi
}

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── Branch list ───────────────────────────────────────────────────────────────
# Format: "branch-like-filter:limit:label"
# Partial branches FIRST (resume them), then zero-progress largest-first

BRANCHES=(
    # ── RESUME PARTIAL ────────────────────────────────
    "Washington:25000:Washington D.C. (22684 total)"
    "Charleston:35000:Charleston SC (32849 total)"
    "Richmond:35000:Richmond VA (32736 total)"

    # ── ZERO PROGRESS — largest first ─────────────────
    "Augusta:50000:Augusta GA (45493 total)"
    "Savannah:50000:Savannah GA (45394 total)"
    "Atlanta:50000:Atlanta GA (44213 total)"
    "New York:35000:New York NY (30779 total)"
    "Baltimore:20000:Baltimore MD (17556 total)"
    "Vicksburg:20000:Vicksburg MS (16507 total)"
    "Memphis:15000:Memphis TN (13272 total)"
    "New Orleans:15000:New Orleans LA (13080 total)"
    "Huntsville:15000:Huntsville AL (12085 total)"
    "Nashville:12000:Nashville TN (10574 total)"
    "New Bern:12000:New Bern NC (9796 total)"
    "Louisville:12000:Louisville KY (9131 total)"
    "Norfolk:12000:Norfolk VA (8900 total)"
    "Lexington:10000:Lexington KY (8149 total)"
    "Tallahassee:10000:Tallahassee FL (7595 total)"
    "Beaufort:10000:Beaufort SC (7260 total)"
    "Shreveport:8000:Shreveport LA (6288 total)"
    "Mobile:8000:Mobile AL (6212 total)"
    "Wilmington:6000:Wilmington NC (4600 total)"
    "Columbus:5000:Columbus MS (4011 total)"
    "Little Rock:5000:Little Rock AR (3894 total)"
    "Natchez:2500:Natchez MS (1911 total)"
    "St. Louis:1000:St. Louis MO (628 total)"
    "Lynchburg:600:Lynchburg VA (413 total)"
    "Philadelphia:200:Philadelphia PA (122 total)"
    "Raleigh:10:Raleigh NC (4 total)"
)

TOTAL=${#BRANCHES[@]}
DONE=0
FAILED=0

log "════════════════════════════════════════════════════════════"
log "FREEDMAN'S BANK — FULL DOCAI ENRICHMENT RUN"
log "Total branches: $TOTAL"
log "Started: $(date)"
log "════════════════════════════════════════════════════════════"

ntfy_post "DocAI enrichment starting — $TOTAL branches — $(date '+%H:%M')" \
    "Freedman's Bank DocAI START" "default"

for branch_info in "${BRANCHES[@]}"; do
    branch_like=$(echo "$branch_info" | cut -d: -f1)
    limit=$(echo "$branch_info"       | cut -d: -f2)
    label=$(echo "$branch_info"       | cut -d: -f3-)

    log ""
    log "────────────────────────────────────────────────────────────"
    log "Branch: $label"
    log "Filter: --branch-like \"$branch_like\"  Limit: $limit"
    log "────────────────────────────────────────────────────────────"

    ntfy_post "Starting $label" "DocAI — $branch_like" "default"

    node scripts/enrich-freedmens-docai.js \
        --branch-like "$branch_like" \
        --limit "$limit"
    EXIT=$?

    if [ $EXIT -eq 0 ]; then
        DONE=$((DONE + 1))
        log "✅  $label — DONE ($DONE/$TOTAL complete)"
        ntfy_post "$label done at $(date '+%H:%M')" "DocAI ✅ $branch_like" "default"
    else
        FAILED=$((FAILED + 1))
        log "⚠   $label — exited with code $EXIT"
        ntfy_post "$label exited $EXIT at $(date '+%H:%M')" "DocAI ⚠ $branch_like" "high"
        # Don't abort — continue to next branch
    fi
done

log ""
log "════════════════════════════════════════════════════════════"
log "ALL BRANCHES ATTEMPTED"
log "Succeeded: $DONE / $TOTAL"
log "Failures:  $FAILED / $TOTAL"
log "Finished:  $(date)"
log "════════════════════════════════════════════════════════════"

ntfy_post "All $TOTAL branches done — $DONE succeeded, $FAILED failed — $(date '+%H:%M')" \
    "Freedman's Bank DocAI COMPLETE" "default"

# Final audit
log ""
log "Running final audit..."
node scripts/audit-pipeline-state.js
