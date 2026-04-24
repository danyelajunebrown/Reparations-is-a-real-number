#!/bin/bash
# One-shot script to migrate overnight jobs onto the Mac Mini.
# Assumes you're SSH'd into the Mini (or running locally on it).
# Run: bash scripts/mac-mini-setup/offload-migration.sh
set -euo pipefail

REPO="$HOME/Desktop/Reparations-is-a-real-number"
cd "$REPO"

echo "=== 1. Pull latest ==="
git pull origin main

echo "=== 2. Install deps ==="
npm install --no-audit --no-fund

echo "=== 3. Apply migration 045 (scrape_runs) ==="
if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL not set — source .env first"
    exit 1
fi
psql "$DATABASE_URL" -f migrations/045-scrape-runs.sql

echo "=== 4. Check OPS_SECRET in .env ==="
if ! grep -q "^OPS_SECRET=" .env 2>/dev/null; then
    SECRET=$(openssl rand -hex 32)
    echo "OPS_SECRET=$SECRET" >> .env
    echo "Generated OPS_SECRET — copy this to your MacBook .env too:"
    echo "OPS_SECRET=$SECRET"
fi

echo "=== 5. Restart Express with ops routes ==="
pm2 restart reparations-server --update-env

echo "=== 6. Install Tailscale (if missing) ==="
if ! command -v tailscale >/dev/null; then
    brew install tailscale
    sudo brew services start tailscale
    echo "Run: sudo tailscale up   (then authenticate in browser)"
else
    tailscale status | head -5
fi

echo "=== 7. Verify ops endpoint ==="
sleep 2
SECRET=$(grep ^OPS_SECRET= .env | cut -d= -f2)
curl -s -H "X-Ops-Secret: $SECRET" http://localhost:3000/api/ops/status | head -40

echo ""
echo "=== DONE ==="
echo "Next steps:"
echo "  - Register Tailscale: sudo tailscale up"
echo "  - Queue Freedmens runner: pm2 start ecosystem.config.js --only freedmens-runner"
echo "  - Save PM2 state: pm2 save && pm2 startup"
