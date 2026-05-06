#!/usr/bin/env bash
# =============================================================================
# run-freedmens-complete.sh
#
# Full Freedmens Bank pipeline on Mac Mini — chains all steps in the correct
# order and then arms the 1860 slave schedule scraper when done.
#
# Run order:
#   1. git pull (pick up the latest scripts)
#   2. Layer 1 — scrape-freedmens-bank-indexed.js (all 27 branches, via run-all-freedmens.sh)
#   3. Layer 2 — enrich-freedmens-docai.js (Document AI enrichment → S3)
#   4. S3 backfill — backfill-freedmens-to-s3.js
#   5. Start slave-schedule-1860 PM2 app
#
# Prerequisites (Mac Mini):
#   • Chrome running on port 9222, signed into FamilySearch
#   • .env: DATABASE_URL, GCP_PROJECT_ID, DOCUMENT_AI_PROCESSOR_ID,
#            GOOGLE_APPLICATION_CREDENTIALS, S3_BUCKET, S3_REGION
#   • PM2 installed, slave-schedule-1860 app registered (but stopped)
#
# Usage:
#   bash scripts/run-freedmens-complete.sh
#   bash scripts/run-freedmens-complete.sh --skip-layer1   # skip the indexed scrape
#   bash scripts/run-freedmens-complete.sh --skip-layer2   # skip Doc AI enrichment
#   bash scripts/run-freedmens-complete.sh --skip-1860     # don't start 1860 at end
#   bash scripts/run-freedmens-complete.sh --dry-run-docai # dry-run Layer 2 only
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${REPO_ROOT}/debug/logs"
TODAY=$(date +%Y%m%d-%H%M)

mkdir -p "${LOG_DIR}"

# ── CLI flags ──────────────────────────────────────────────────────────────────
SKIP_LAYER1=false
SKIP_LAYER2=false
SKIP_1860=false
DRY_RUN_DOCAI=false

for arg in "$@"; do
  case "$arg" in
    --skip-layer1)    SKIP_LAYER1=true ;;
    --skip-layer2)    SKIP_LAYER2=true ;;
    --skip-1860)      SKIP_1860=true ;;
    --dry-run-docai)  DRY_RUN_DOCAI=true ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────────────────
log() { echo "[$(date '+%H:%M:%S')] $*"; }
section() {
  echo ""
  echo "════════════════════════════════════════════════════════════════════"
  echo "  $*"
  echo "════════════════════════════════════════════════════════════════════"
}

# ── Startup ────────────────────────────────────────────────────────────────────
section "Freedmens Bank Complete Pipeline — ${TODAY}"
log "Repo root: ${REPO_ROOT}"
log "Logs dir:  ${LOG_DIR}"
log "Flags: SKIP_LAYER1=${SKIP_LAYER1} SKIP_LAYER2=${SKIP_LAYER2} SKIP_1860=${SKIP_1860} DRY_RUN_DOCAI=${DRY_RUN_DOCAI}"

cd "${REPO_ROOT}"

# ── Step 0: git pull ───────────────────────────────────────────────────────────
section "Step 0 — git pull"
git pull origin main
log "Pull complete."

# ── Step 1: Layer 1 indexed scrape ─────────────────────────────────────────────
if [ "${SKIP_LAYER1}" = true ]; then
  log "SKIP_LAYER1 set — skipping run-all-freedmens.sh"
else
  section "Step 1 — Layer 1: Freedmens Bank indexed scrape (all 27 branches)"
  log "Starting run-all-freedmens.sh — logs → ${LOG_DIR}/freedmens-layer1-${TODAY}.log"

  bash scripts/run-all-freedmens.sh 2>&1 | tee "${LOG_DIR}/freedmens-layer1-${TODAY}.log"
  LAYER1_EXIT="${PIPESTATUS[0]}"

  if [ "${LAYER1_EXIT}" -ne 0 ]; then
    log "⚠ run-all-freedmens.sh exited with code ${LAYER1_EXIT} — check log for errors."
    log "Continuing to Layer 2 anyway (partial data is fine)."
  else
    log "Layer 1 complete."
  fi
fi

# ── Step 2: Layer 2 Document AI enrichment ─────────────────────────────────────
if [ "${SKIP_LAYER2}" = true ]; then
  log "SKIP_LAYER2 set — skipping enrich-freedmens-docai.js"
else
  section "Step 2 — Layer 2: Document AI enrichment → S3"

  DOCAI_FLAGS=""
  if [ "${DRY_RUN_DOCAI}" = true ]; then
    DOCAI_FLAGS="--dry-run"
    log "DRY_RUN_DOCAI set — running in dry-run mode (no DB/S3 writes)"
  fi

  log "Starting enrich-freedmens-docai.js ${DOCAI_FLAGS} — logs → ${LOG_DIR}/freedmens-docai-${TODAY}.log"
  # shellcheck disable=SC2086
  node scripts/enrich-freedmens-docai.js ${DOCAI_FLAGS} 2>&1 | tee "${LOG_DIR}/freedmens-docai-${TODAY}.log"
  DOCAI_EXIT="${PIPESTATUS[0]}"

  if [ "${DOCAI_EXIT}" -ne 0 ]; then
    log "⚠ enrich-freedmens-docai.js exited with code ${DOCAI_EXIT} — check log for errors."
    log "Continuing to S3 backfill anyway."
  else
    log "Layer 2 complete."
  fi
fi

# ── Step 3: S3 backfill ────────────────────────────────────────────────────────
section "Step 3 — S3 backfill"
log "Starting backfill-freedmens-to-s3.js — logs → ${LOG_DIR}/freedmens-s3-backfill-${TODAY}.log"

node scripts/backfill-freedmens-to-s3.js 2>&1 | tee "${LOG_DIR}/freedmens-s3-backfill-${TODAY}.log"
S3_EXIT="${PIPESTATUS[0]}"

if [ "${S3_EXIT}" -ne 0 ]; then
  log "⚠ backfill-freedmens-to-s3.js exited with code ${S3_EXIT} — check log."
else
  log "S3 backfill complete."
fi

# ── Step 4: Start 1860 slave schedule ─────────────────────────────────────────
if [ "${SKIP_1860}" = true ]; then
  log "SKIP_1860 set — leaving slave-schedule-1860 stopped."
elif [ "${DRY_RUN_DOCAI}" = true ]; then
  log "DRY-run mode active — NOT starting slave-schedule-1860 (Freedmens not fully written)."
else
  section "Step 4 — Start 1860 Slave Schedule Scraper"
  log "Freedmens pipeline done. Starting slave-schedule-1860 via PM2…"

  pm2 start slave-schedule-1860 2>&1 | tee -a "${LOG_DIR}/freedmens-docai-${TODAY}.log" || \
    log "⚠ PM2 start failed — slave-schedule-1860 may already be running or not registered."

  log "slave-schedule-1860 armed. Tail with: pm2 logs slave-schedule-1860 --lines 50"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
section "Pipeline Complete — ${TODAY}"
log "Logs saved to: ${LOG_DIR}/"
ls -lh "${LOG_DIR}/" | grep "${TODAY}" || true
echo ""
log "Done."
