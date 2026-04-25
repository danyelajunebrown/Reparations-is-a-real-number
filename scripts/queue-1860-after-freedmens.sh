#!/bin/bash
# Block until freedmens-remaining exits, then start slave-schedule-1860.
# One FamilySearch session, one scraper at a time — enforced by waiting.
set -uo pipefail

log() { echo "[$(date +'%F %T')] $*"; }

log "Waiting for freedmens-remaining to finish before starting 1860..."

while true; do
    STATUS=$(pm2 jlist 2>/dev/null | /usr/bin/python3 -c "import sys,json; apps=json.load(sys.stdin); f=[a for a in apps if a['name']=='freedmens-remaining'];print(f[0]['pm2_env']['status'] if f else 'missing')" 2>/dev/null || echo unknown)
    if [ "$STATUS" != "online" ]; then
        log "freedmens-remaining is $STATUS — starting 1860 now."
        break
    fi
    sleep 60
done

pm2 start slave-schedule-1860 --update-env 2>&1 | tail -3
log "1860 started."
