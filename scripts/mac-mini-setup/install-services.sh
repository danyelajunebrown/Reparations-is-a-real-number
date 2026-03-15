#!/bin/bash
# =============================================================================
# INSTALL LAUNCHD SERVICES FOR AUTO-START AND AUTO-RESTART
# This makes the scrapers run on boot and restart if they crash
# =============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$PROJECT_DIR")"
PLIST_DIR="$HOME/Library/LaunchAgents"

echo ""
echo "========================================================================"
echo "  INSTALLING AUTO-START SERVICES"
echo "========================================================================"
echo ""

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$PLIST_DIR"
mkdir -p "$PROJECT_DIR/logs"

# -----------------------------------------------------------------------------
# Create the scraper runner script
# -----------------------------------------------------------------------------
echo "[1/3] Creating scraper runner script..."

cat > "$PROJECT_DIR/scripts/mac-mini-setup/run-scraper.sh" << 'SCRIPT'
#!/bin/bash
# Scraper runner with auto-restart logic

PROJECT_DIR="$(dirname "$(dirname "$(dirname "$0")")")"
cd "$PROJECT_DIR"

# Source environment
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
source .env 2>/dev/null || true

LOGFILE="$PROJECT_DIR/logs/scraper-$(date +%Y%m%d).log"

echo "========================================" >> "$LOGFILE"
echo "Scraper started: $(date)" >> "$LOGFILE"
echo "========================================" >> "$LOGFILE"

# Run scraper with automatic state progression
while true; do
    echo "[$(date)] Starting scraper batch..." >> "$LOGFILE"

    # Run the 1860 slave schedule scraper
    FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js --year 1860 --limit 50 >> "$LOGFILE" 2>&1
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        echo "[$(date)] Batch complete, restarting in 60 seconds..." >> "$LOGFILE"
        sleep 60
    else
        echo "[$(date)] Scraper exited with code $EXIT_CODE, restarting in 120 seconds..." >> "$LOGFILE"
        sleep 120
    fi
done
SCRIPT

chmod +x "$PROJECT_DIR/scripts/mac-mini-setup/run-scraper.sh"
echo "  Created run-scraper.sh"

# -----------------------------------------------------------------------------
# Create launchd plist for the scraper
# -----------------------------------------------------------------------------
echo "[2/3] Creating launchd service..."

cat > "$PLIST_DIR/com.reparations.scraper.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.reparations.scraper</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$PROJECT_DIR/scripts/mac-mini-setup/run-scraper.sh</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$PROJECT_DIR/logs/launchd-stdout.log</string>

    <key>StandardErrorPath</key>
    <string>$PROJECT_DIR/logs/launchd-stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>FAMILYSEARCH_INTERACTIVE</key>
        <string>true</string>
    </dict>

    <key>ThrottleInterval</key>
    <integer>60</integer>
</dict>
</plist>
PLIST

echo "  Created com.reparations.scraper.plist"

# -----------------------------------------------------------------------------
# Load the service
# -----------------------------------------------------------------------------
echo "[3/3] Loading service..."

# Unload if already loaded
launchctl unload "$PLIST_DIR/com.reparations.scraper.plist" 2>/dev/null || true

# Load the service
launchctl load "$PLIST_DIR/com.reparations.scraper.plist"

echo ""
echo "========================================================================"
echo "  SERVICES INSTALLED!"
echo "========================================================================"
echo ""
echo "  The scraper will now:"
echo "  - Start automatically when you log in"
echo "  - Restart automatically if it crashes"
echo "  - Log to: $PROJECT_DIR/logs/"
echo ""
echo "  Commands:"
echo "  - Check status:  launchctl list | grep reparations"
echo "  - View logs:     tail -f $PROJECT_DIR/logs/scraper-$(date +%Y%m%d).log"
echo "  - Stop service:  launchctl unload ~/Library/LaunchAgents/com.reparations.scraper.plist"
echo "  - Start service: launchctl load ~/Library/LaunchAgents/com.reparations.scraper.plist"
echo ""
