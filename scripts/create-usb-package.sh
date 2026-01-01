#!/bin/bash
# =============================================================================
# CREATE USB PACKAGE
# =============================================================================
# Creates a folder ready to copy to USB drive
# Excludes node_modules (will be installed on target machine)
# =============================================================================

cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)

USB_PACKAGE="$HOME/Desktop/REPARATIONS-USB"

echo ""
echo "Creating USB package at: $USB_PACKAGE"
echo ""

# Clean previous
rm -rf "$USB_PACKAGE"
mkdir -p "$USB_PACKAGE"

# Copy essential directories
echo "📁 Copying scripts..."
cp -r scripts "$USB_PACKAGE/"

echo "📁 Copying src..."
cp -r src "$USB_PACKAGE/"

echo "📁 Copying migrations..."
cp -r migrations "$USB_PACKAGE/"

# Copy essential files
echo "📄 Copying config files..."
cp package.json "$USB_PACKAGE/"
cp package-lock.json "$USB_PACKAGE/" 2>/dev/null || true

# Copy .env (has database credentials)
if [ -f ".env" ]; then
    cp .env "$USB_PACKAGE/"
    echo "✅ .env copied"
else
    echo "⚠️  No .env - you'll need to create one"
fi

# Copy Google Vision key
if [ -f "google-vision-key.json" ]; then
    cp google-vision-key.json "$USB_PACKAGE/"
    echo "✅ google-vision-key.json copied"
else
    echo "⚠️  No google-vision-key.json - OCR won't work without it"
fi

# Copy the double-click launchers
cp START-SCRAPER.command "$USB_PACKAGE/"
cp FIRST-TIME-SETUP.command "$USB_PACKAGE/"
cp REMOTE-SCRAPER-SETUP.md "$USB_PACKAGE/README.md"

# Copy Chrome profile if exists (has FamilySearch cookies - may not transfer well)
# Skipping this - better to log in fresh on new machine

# Make scripts executable
chmod +x "$USB_PACKAGE/START-SCRAPER.command"
chmod +x "$USB_PACKAGE/FIRST-TIME-SETUP.command"
chmod +x "$USB_PACKAGE/scripts/"*.sh

# Calculate size
SIZE=$(du -sh "$USB_PACKAGE" | cut -f1)

echo ""
echo "========================================================================"
echo "  USB PACKAGE READY"
echo "========================================================================"
echo ""
echo "  📁 Location: $USB_PACKAGE"
echo "  📊 Size:     $SIZE (before npm install)"
echo ""
echo "  Copy this entire folder to a USB drive."
echo ""
echo "  On the target Mac:"
echo "    1. Copy folder from USB to Desktop"
echo "    2. Double-click FIRST-TIME-SETUP.command (once)"
echo "    3. Log into FamilySearch when browser opens"
echo "    4. Double-click START-SCRAPER.command (each day)"
echo ""
