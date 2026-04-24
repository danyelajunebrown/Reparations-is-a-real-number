#!/bin/bash
# Install the reparations health watchdog on the Pi.
# Run from MacBook: scp this directory to Pi then execute remotely, OR
# run directly on Pi after cloning the repo.
set -euo pipefail

INSTALL_DIR=/home/danyelicafish/reparations-watchdog
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "[install] source: $REPO_DIR"
echo "[install] target: $INSTALL_DIR"

mkdir -p "$INSTALL_DIR/scripts/pi" "$INSTALL_DIR/src/utils"
cp "$REPO_DIR/scripts/pi/health-watchdog.js" "$INSTALL_DIR/scripts/pi/"
cp "$REPO_DIR/src/utils/notify.js" "$INSTALL_DIR/src/utils/"

# Minimal package.json — node 20 has fetch, no extra deps needed besides dotenv
cat > "$INSTALL_DIR/package.json" <<'JSON'
{
  "name": "reparations-watchdog",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "dotenv": "^16.4.5"
  }
}
JSON

cd "$INSTALL_DIR"
if ! command -v node >/dev/null; then
    echo "[install] node not found — installing via apt"
    sudo apt-get update -qq
    sudo apt-get install -y nodejs npm
fi

npm install --production --no-audit --no-fund

# Drop a .env stub if missing
if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" <<'ENV'
OPS_NOTIFY_WEBHOOK=https://ntfy.sh/FILL_ME_IN
MINI_OPS_URL=http://100.114.130.16:3000/api/ops/status
OPS_SECRET=FILL_ME_IN
RENDER_HEALTH_URL=https://reparations-platform.onrender.com/api/health
ENV
    echo "[install] created .env stub — EDIT IT before enabling service"
fi

sudo cp "$REPO_DIR/scripts/pi/reparations-watchdog.service" /etc/systemd/system/
sudo systemctl daemon-reload
echo "[install] systemd unit copied."
echo
echo "Next:"
echo "  1. Edit $INSTALL_DIR/.env with real OPS_SECRET + ntfy topic"
echo "  2. sudo systemctl enable --now reparations-watchdog"
echo "  3. sudo systemctl status reparations-watchdog"
echo "  4. tail -f $INSTALL_DIR/watchdog.log"
