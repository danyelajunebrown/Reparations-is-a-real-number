#!/bin/bash
# =============================================================================
# PACKAGE PROJECT FOR TRANSFER
# =============================================================================
# Creates a transfer package with essential files (excludes node_modules)
# Usage: ./scripts/package-for-transfer.sh
# =============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_NAME="reparations-scraper-$(date +%Y%m%d)"
OUTPUT_DIR="$HOME/Desktop"
PACKAGE_PATH="$OUTPUT_DIR/$PACKAGE_NAME"

echo "========================================================================"
echo "  PACKAGING FOR TRANSFER"
echo "========================================================================"
echo ""

cd "$PROJECT_DIR"

# Create package directory
rm -rf "$PACKAGE_PATH"
mkdir -p "$PACKAGE_PATH"

echo "📁 Copying essential files..."

# Copy essential directories
cp -r scripts "$PACKAGE_PATH/"
cp -r src "$PACKAGE_PATH/"
cp -r migrations "$PACKAGE_PATH/"
cp -r contracts "$PACKAGE_PATH/" 2>/dev/null || true

# Copy essential files
cp package.json "$PACKAGE_PATH/"
cp package-lock.json "$PACKAGE_PATH/" 2>/dev/null || true
cp .env "$PACKAGE_PATH/" 2>/dev/null || echo "⚠️  No .env file (you'll need to create one)"
cp google-vision-key.json "$PACKAGE_PATH/" 2>/dev/null || echo "⚠️  No google-vision-key.json (copy manually)"
cp REMOTE-SCRAPER-SETUP.md "$PACKAGE_PATH/"

# Copy Chrome profile (has FamilySearch cookies)
if [ -d ".chrome-profile" ]; then
    echo "📁 Copying Chrome profile (with cookies)..."
    cp -r .chrome-profile "$PACKAGE_PATH/"
fi

# Create archive
echo ""
echo "📦 Creating archive..."
cd "$OUTPUT_DIR"
tar -czf "$PACKAGE_NAME.tar.gz" "$PACKAGE_NAME"

# Get size
SIZE=$(du -sh "$PACKAGE_NAME.tar.gz" | cut -f1)

echo ""
echo "========================================================================"
echo "  PACKAGE CREATED"
echo "========================================================================"
echo ""
echo "  📦 Archive: $OUTPUT_DIR/$PACKAGE_NAME.tar.gz"
echo "  📊 Size:    $SIZE"
echo ""
echo "  Transfer this file to the remote Mac, then:"
echo "    1. tar -xzf $PACKAGE_NAME.tar.gz"
echo "    2. cd $PACKAGE_NAME"
echo "    3. ./scripts/setup-remote-mac.sh"
echo ""

# Cleanup extracted folder (keep only the archive)
rm -rf "$PACKAGE_PATH"

echo "✅ Done! Transfer $PACKAGE_NAME.tar.gz to the remote machine."
