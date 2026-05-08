#!/bin/bash
# =============================================================================
# Raspberry Pi Intake Kiosk — Launcher
# =============================================================================
# Opens Chromium in full-screen kiosk mode pointing at the React frontend
# with the ?mode=kiosk flag. The kiosk flag tells the frontend to show the
# REQUEST INTAKE button below the search bar, which opens the Google Intake
# Form as a full-screen iframe overlay.
#
# Runs in a retry loop so Chrome restarts automatically after crashes or
# the daily Google Form session timeout.
#
# Installation:
#   Append to /etc/xdg/lxsession/LXDE-pi/autostart (Raspberry Pi OS Desktop):
#     @/home/danyelicafish/kiosk/launch-kiosk.sh
#
#   Or install as a systemd service:
#     sudo cp scripts/pi/reparations-kiosk.service /etc/systemd/system/
#     sudo systemctl enable --now reparations-kiosk
#
# Environmental overrides:
#   KIOSK_URL   — target URL (default: GitHub Pages)
#   RETRY_DELAY — seconds between restart attempts (default: 10)
# =============================================================================
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
KIOSK_URL="${KIOSK_URL:-https://danyelajunebrown.github.io/Reparations-is-a-real-number/?mode=kiosk}"
RETRY_DELAY="${RETRY_DELAY:-10}"
LOG_DIR="${LOG_DIR:-/home/danyelicafish/kiosk}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/kiosk-launch.log"

log() { echo "[$(date +'%F %T')] $*" | tee -a "$LOG_FILE"; }

# ── Chrome flags ────────────────────────────────────────────────────────────
# --kiosk                   Full-screen, no tabs, no address bar
# --no-first-run            Skip Chromium first-run wizard
# --no-default-browser-check
# --disable-infobars        Hide "Chrome is being controlled" bar
# --disable-session-crashed-bubble   Don't show "restore pages" dialog
# --noerrdialogs            Suppress error dialogs
# --disable-pinch           Prevent accidental zoom on touchscreen
# --overscroll-history-navigation=0  Disable swipe-back gesture
CHROME_FLAGS=(
    --kiosk
    --no-first-run
    --no-default-browser-check
    --disable-infobars
    --disable-session-crashed-bubble
    --noerrdialogs
    --disable-pinch
    --overscroll-history-navigation=0
)

# ── Find Chromium ───────────────────────────────────────────────────────────
CHROME=""
for candidate in /usr/bin/chromium-browser /usr/bin/chromium /snap/bin/chromium; do
    if [ -x "$candidate" ]; then
        CHROME="$candidate"
        break
    fi
done

if [ -z "$CHROME" ]; then
    log "FATAL: Chromium not found. Tried: /usr/bin/chromium-browser /usr/bin/chromium /snap/bin/chromium"
    log "Install: sudo apt install chromium-browser"
    exit 1
fi

log "Using Chromium: $CHROME"
log "Target URL: $KIOSK_URL"
log "Log directory: $LOG_DIR"

# ── Kill any existing kiosk Chrome instances ────────────────────────────────
# (Prevents duplicate windows on restart)
pkill -f "chromium.*kiosk.*Reparations" 2>/dev/null || true
sleep 2

# ── Launch loop ─────────────────────────────────────────────────────────────
# Chrome in kiosk mode may exit for various reasons (crash, session expiry,
# OOM). Restart automatically with a short delay.
while true; do
    log "Launching kiosk..."
    nohup "$CHROME" "${CHROME_FLAGS[@]}" "$KIOSK_URL" > "$LOG_DIR/chrome-stdout.log" 2>&1 &
    CHROME_PID=$!
    log "Chrome PID: $CHROME_PID"

    # Wait for Chrome to exit
    wait $CHROME_PID 2>/dev/null || true
    EXIT_CODE=$?
    log "Chrome exited (code: $EXIT_CODE). Restarting in ${RETRY_DELAY}s..."
    sleep "$RETRY_DELAY"
done