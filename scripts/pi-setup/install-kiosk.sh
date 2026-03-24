#!/bin/bash
# =============================================================================
# RASPBERRY PI KIOSK SETUP
# =============================================================================
# Configures a Raspberry Pi to auto-launch Chromium in kiosk mode,
# pointing at the Mac Mini's kiosk interface.
#
# Prerequisites:
#   - Raspberry Pi OS (Bookworm or later) with desktop environment
#   - Network connection to Mac Mini (192.168.0.196)
#
# Usage:
#   chmod +x scripts/pi-setup/install-kiosk.sh
#   ./scripts/pi-setup/install-kiosk.sh [MAC_MINI_IP]
#
# Default Mac Mini IP: 192.168.0.196
# =============================================================================

set -e

MAC_MINI_IP="${1:-192.168.0.196}"
MAC_MINI_PORT="3000"
KIOSK_URL="http://${MAC_MINI_IP}:${MAC_MINI_PORT}/kiosk.html"

echo ""
echo "========================================================================"
echo "  REPARATIONS KIOSK - RASPBERRY PI SETUP"
echo "========================================================================"
echo "  Mac Mini:  ${MAC_MINI_IP}:${MAC_MINI_PORT}"
echo "  Kiosk URL: ${KIOSK_URL}"
echo "========================================================================"
echo ""

# -----------------------------------------------------------------------------
# 1. System updates & dependencies
# -----------------------------------------------------------------------------
echo "[1/6] Installing dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    chromium \
    unclutter \
    xdotool \
    > /dev/null 2>&1 || true
echo "  ✅ Dependencies installed"

# -----------------------------------------------------------------------------
# 2. Disable screen blanking / power saving
# -----------------------------------------------------------------------------
echo "[2/6] Disabling screen blanking..."

# For X11 / lightdm
if [ -f /etc/lightdm/lightdm.conf ]; then
    sudo sed -i '/^\[Seat:\*\]/a xserver-command=X -s 0 -dpms' /etc/lightdm/lightdm.conf 2>/dev/null || true
fi

# For Wayland / labwc (Bookworm default)
mkdir -p ~/.config/labwc
if [ -f ~/.config/labwc/rc.xml ]; then
    # Disable idle timeout in labwc
    if ! grep -q "screenSaver" ~/.config/labwc/rc.xml; then
        sed -i '/<\/lab>/i \  <screenSaver>\n    <timeout>0</timeout>\n  </screenSaver>' ~/.config/labwc/rc.xml
    fi
fi

# Disable DPMS via xset (works on both X11 and some Wayland)
cat > ~/.xinitrc.d/disable-blanking.sh << 'XEOF'
#!/bin/bash
xset s off
xset -dpms
xset s noblank
XEOF
chmod +x ~/.xinitrc.d/disable-blanking.sh 2>/dev/null || true

echo "  ✅ Screen blanking disabled"

# -----------------------------------------------------------------------------
# 3. Create kiosk launcher script
# -----------------------------------------------------------------------------
echo "[3/6] Creating kiosk launcher..."

mkdir -p ~/kiosk
cat > ~/kiosk/launch-kiosk.sh << KEOF
#!/bin/bash
# =============================================================================
# REPARATIONS KIOSK LAUNCHER
# Waits for Mac Mini, then launches Chromium in fullscreen kiosk mode
# =============================================================================

KIOSK_URL="${KIOSK_URL}"
MAC_MINI_IP="${MAC_MINI_IP}"
MAC_MINI_PORT="${MAC_MINI_PORT}"
LOG_FILE=~/kiosk/kiosk.log

echo "[\$(date)] Kiosk launcher starting..." >> "\$LOG_FILE"

# Wait for network
echo "[\$(date)] Waiting for network..." >> "\$LOG_FILE"
RETRIES=0
while ! ping -c 1 -W 2 "\$MAC_MINI_IP" > /dev/null 2>&1; do
    RETRIES=\$((RETRIES + 1))
    if [ \$RETRIES -gt 60 ]; then
        echo "[\$(date)] ERROR: Mac Mini unreachable after 60 attempts" >> "\$LOG_FILE"
        # Show error on screen
        export DISPLAY=:0
        zenity --error --text="Cannot reach Mac Mini at \${MAC_MINI_IP}.\nCheck network connection." --timeout=30 2>/dev/null || true
        exit 1
    fi
    sleep 2
done
echo "[\$(date)] Mac Mini reachable" >> "\$LOG_FILE"

# Wait for Express server
echo "[\$(date)] Waiting for Express server..." >> "\$LOG_FILE"
RETRIES=0
while ! curl -s -o /dev/null -w "%{http_code}" "http://\${MAC_MINI_IP}:\${MAC_MINI_PORT}/api/health" 2>/dev/null | grep -q "200"; do
    RETRIES=\$((RETRIES + 1))
    if [ \$RETRIES -gt 30 ]; then
        echo "[\$(date)] ERROR: Express server not responding after 30 attempts" >> "\$LOG_FILE"
        break
    fi
    sleep 3
done
echo "[\$(date)] Express server ready" >> "\$LOG_FILE"

# Hide mouse cursor after 3 seconds of inactivity
unclutter -idle 3 -root &

# Clear Chromium crash flags (prevents "restore session" dialog)
CHROMIUM_DIR=~/.config/chromium
mkdir -p "\$CHROMIUM_DIR/Default"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "\$CHROMIUM_DIR/Default/Preferences" 2>/dev/null || true
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "\$CHROMIUM_DIR/Default/Preferences" 2>/dev/null || true

# Launch Chromium in kiosk mode
echo "[\$(date)] Launching Chromium kiosk: \$KIOSK_URL" >> "\$LOG_FILE"
export DISPLAY=:0

# Use whichever chromium binary is available
CHROMIUM=\$(command -v chromium-browser || command -v chromium || echo chromium-browser)
"\$CHROMIUM" \\
    --kiosk \\
    --noerrdialogs \\
    --disable-translate \\
    --no-first-run \\
    --fast \\
    --fast-start \\
    --disable-infobars \\
    --disable-features=TranslateUI \\
    --disable-pinch \\
    --overscroll-history-navigation=0 \\
    --disable-session-crashed-bubble \\
    --check-for-update-interval=31536000 \\
    --touch-events=enabled \\
    --enable-touchview \\
    "\$KIOSK_URL" >> "\$LOG_FILE" 2>&1
KEOF

chmod +x ~/kiosk/launch-kiosk.sh
echo "  ✅ Kiosk launcher created at ~/kiosk/launch-kiosk.sh"

# -----------------------------------------------------------------------------
# 4. Create systemd service for auto-start
# -----------------------------------------------------------------------------
echo "[4/6] Creating systemd service..."

sudo tee /etc/systemd/system/reparations-kiosk.service > /dev/null << SEOF
[Unit]
Description=Reparations Kiosk (Chromium fullscreen)
After=graphical.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/$(whoami)/.Xauthority
ExecStartPre=/bin/sleep 5
ExecStart=/home/$(whoami)/kiosk/launch-kiosk.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=graphical.target
SEOF

sudo systemctl daemon-reload
sudo systemctl enable reparations-kiosk.service
echo "  ✅ Systemd service created and enabled"

# -----------------------------------------------------------------------------
# 5. Create autostart desktop entry (backup method for Wayland/labwc)
# -----------------------------------------------------------------------------
echo "[5/6] Creating autostart entry..."

mkdir -p ~/.config/autostart
cat > ~/.config/autostart/reparations-kiosk.desktop << DEOF
[Desktop Entry]
Type=Application
Name=Reparations Kiosk
Exec=/home/$(whoami)/kiosk/launch-kiosk.sh
X-GNOME-Autostart-enabled=true
Hidden=false
NoDisplay=false
DEOF

echo "  ✅ Autostart desktop entry created"

# -----------------------------------------------------------------------------
# 6. Test connectivity
# -----------------------------------------------------------------------------
echo "[6/6] Testing connectivity..."

if ping -c 1 -W 2 "$MAC_MINI_IP" > /dev/null 2>&1; then
    echo "  ✅ Mac Mini reachable at ${MAC_MINI_IP}"
else
    echo "  ⚠️ Mac Mini NOT reachable at ${MAC_MINI_IP} — check network"
fi

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://${MAC_MINI_IP}:${MAC_MINI_PORT}/api/health" 2>/dev/null)
if [ "$HEALTH" = "200" ]; then
    echo "  ✅ Express server responding (HTTP ${HEALTH})"
else
    echo "  ⚠️ Express server not responding (HTTP ${HEALTH:-timeout}) — may not be running yet"
fi

echo ""
echo "========================================================================"
echo "  KIOSK SETUP COMPLETE!"
echo "========================================================================"
echo ""
echo "  The kiosk will auto-launch on next boot."
echo ""
echo "  To start now:      ~/kiosk/launch-kiosk.sh"
echo "  To check service:  sudo systemctl status reparations-kiosk"
echo "  To view logs:      cat ~/kiosk/kiosk.log"
echo "  To stop kiosk:     sudo systemctl stop reparations-kiosk"
echo "  To disable:        sudo systemctl disable reparations-kiosk"
echo ""
echo "  Mac Mini IP: ${MAC_MINI_IP}"
echo "  Kiosk URL:   ${KIOSK_URL}"
echo ""
