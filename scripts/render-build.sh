#!/usr/bin/env bash
# Render.com build script for Reparations Platform
# This script installs Chrome/Chromium for Puppeteer support

set -e

echo "=== Reparations Platform Build Script ==="

# Install npm dependencies
echo "Installing npm dependencies..."
npm install

# Install Puppeteer browsers
echo "Installing Puppeteer Chrome browser..."
npx puppeteer browsers install chrome || {
    echo "Puppeteer browser install failed, trying alternative method..."
    # Try to install chromium via npm if the above fails
    npm install puppeteer --force
}

# Verify Chrome is available
echo "Verifying Chrome installation..."
if command -v chromium &> /dev/null; then
    echo "Chromium found at: $(which chromium)"
elif command -v chromium-browser &> /dev/null; then
    echo "Chromium-browser found at: $(which chromium-browser)"
elif [ -f "/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome" ]; then
    echo "Puppeteer Chrome found in cache"
else
    echo "WARNING: Chrome not found. Browser-based OCR may not work."
    echo "Manual methods (screenshot upload, text copy) will still be available."
fi

echo "=== Build complete ==="
