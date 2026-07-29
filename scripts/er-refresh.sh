#!/bin/zsh
# Entity-resolution refresh — rebuild blocking keys, then regenerate the
# canonical-dedup and cross-source-enslaver candidate queues. Idempotent: the
# resolvers clear only status='pending' rows, so anything a human already
# reviewed (merged/linked/distinct) is preserved. Safe to run on a schedule to
# keep the dedup queues current as new records are imported.
#
# Cron (Mac Mini, nightly 04:10):
#   10 4 * * * /Users/danyelica/Desktop/Reparations-is-a-real-number/scripts/er-refresh.sh >> /tmp/er-refresh.log 2>&1
#
# Honors OPS_NOTIFY_WEBHOOK from .env (ntfy) for a one-line completion ping.
set -e
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# repo root = parent of this script's dir
SCRIPT_DIR="${0:A:h}"
REPO="${SCRIPT_DIR:h}"
cd "$REPO"

LOCK=/tmp/er-refresh.lock
if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "[er-refresh] already running (pid $(cat "$LOCK")) — exit"; exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

NODE="$(command -v node)"
echo "=== er-refresh START $(date) (node $NODE) ==="

"$NODE" scripts/populate-blocking-keys.mjs --fresh
"$NODE" scripts/resolve-canonical-dedup.mjs --all --apply
"$NODE" scripts/resolve-cross-source-enslavers.mjs --apply

echo "=== er-refresh DONE $(date) ==="

# optional ntfy ping
HOOK="$(grep -E '^OPS_NOTIFY_WEBHOOK=' .env 2>/dev/null | head -1 | cut -d= -f2-)"
HOOK="${HOOK//\"/}"; HOOK="${HOOK//\'/}"; HOOK="${HOOK// /}"   # strip quotes/spaces
if [ -n "$HOOK" ]; then
  curl -fsS -m 10 -d "entity-resolution refresh complete $(date '+%Y-%m-%d %H:%M')" "$HOOK" >/dev/null 2>&1 || true
fi
