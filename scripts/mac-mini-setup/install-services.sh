#!/bin/bash
# =============================================================================
# INSTALL MAC MINI SERVICES (Express Server + PM2)
# =============================================================================
# Sets up PM2 to manage the Express server with auto-restart.
# The ancestor climber runs as an orphaned process (nohup) launched by the
# kiosk API — it does NOT need a separate service.
#
# Architecture:
#   PM2 → Express server (0.0.0.0:3000)
#     ├── /api/kiosk/* — Pi kiosk endpoints
#     ├── /api/ancestor-climb/* — Climber management
#     └── serves kiosk.html, index.html
#
#   Kiosk API → nohup node familysearch-ancestor-climber.js (orphaned)
#     └── Chrome (localhost:9222, GUI session)
#
# Usage:
#   ./scripts/mac-mini-setup/install-services.sh
# =============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$PROJECT_DIR")"

echo ""
echo "========================================================================"
echo "  INSTALLING MAC MINI SERVICES"
echo "========================================================================"
echo "  Project: $PROJECT_DIR"
echo "========================================================================"
echo ""

# Ensure PATH includes node/npm
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

mkdir -p "$PROJECT_DIR/logs"

# -----------------------------------------------------------------------------
# 1. Install/verify PM2
# -----------------------------------------------------------------------------
echo "[1/4] Checking PM2..."
if ! command -v pm2 &> /dev/null; then
    echo "  Installing PM2 globally..."
    npm install -g pm2
fi
echo "  ✅ PM2 available: $(pm2 --version 2>/dev/null || echo 'installed')"

# -----------------------------------------------------------------------------
# 2. Configure PM2 for Express server
# -----------------------------------------------------------------------------
echo "[2/4] Configuring Express server..."

# Stop existing instance if running
pm2 delete reparations-server 2>/dev/null || true

# Start server from correct project directory
cd "$PROJECT_DIR"
pm2 start src/server.js \
    --name reparations-server \
    --cwd "$PROJECT_DIR" \
    --max-restarts 100 \
    --restart-delay 5000

echo "  ✅ Express server started via PM2"

# -----------------------------------------------------------------------------
# 3. Set PM2 to auto-start on boot
# -----------------------------------------------------------------------------
echo "[3/4] Configuring auto-start..."

pm2 save
pm2 startup launchd 2>/dev/null || echo "  ⚠️ Run the pm2 startup command shown above with sudo if needed"

echo "  ✅ PM2 process list saved"

# -----------------------------------------------------------------------------
# 4. Verify
# -----------------------------------------------------------------------------
echo "[4/4] Verifying..."

sleep 3
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/health" 2>/dev/null)
if [ "$HEALTH" = "200" ]; then
    echo "  ✅ Express server healthy (HTTP 200)"
else
    echo "  ⚠️ Server not responding yet (HTTP ${HEALTH:-timeout})"
    echo "  Check logs: pm2 logs reparations-server"
fi

# Check if Chrome is running for climber
if pgrep -f "Google Chrome" > /dev/null 2>&1; then
    echo "  ✅ Chrome running (FamilySearch session available)"
else
    echo "  ⚠️ Chrome not running — launch manually for FamilySearch login:"
    echo '     open -a "Google Chrome" --args --user-data-dir=/tmp/familysearch-ancestor-climber --remote-debugging-port=9222'
fi

echo ""
echo "========================================================================"
echo "  SERVICES INSTALLED!"
echo "========================================================================"
echo ""
echo "  Express server managed by PM2:"
echo "    - Auto-starts on boot (via launchd)"
echo "    - Auto-restarts on crash"
echo "    - Binds to 0.0.0.0:3000 (LAN accessible)"
echo ""
echo "  Commands:"
echo "    pm2 status                    — Check server status"
echo "    pm2 logs reparations-server   — View server logs"
echo "    pm2 restart reparations-server — Restart server"
echo "    pm2 stop reparations-server   — Stop server"
echo ""
echo "  Kiosk URL:  http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):3000/kiosk.html"
echo "  Health:     http://localhost:3000/api/health"
echo ""
