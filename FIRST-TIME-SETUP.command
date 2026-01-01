#!/bin/bash
# =============================================================================
# FIRST TIME SETUP - DOUBLE-CLICK THIS FIRST
# =============================================================================
# Run this ONCE on a new computer to:
# 1. Install dependencies
# 2. Log into FamilySearch
# =============================================================================

cd "$(dirname "$0")"

echo ""
echo "========================================================================"
echo "  FIRST TIME SETUP"
echo "========================================================================"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not installed!"
    echo ""
    echo "   Please install Node.js first:"
    echo "   1. Go to https://nodejs.org"
    echo "   2. Download the LTS version"
    echo "   3. Run the installer"
    echo "   4. Run this script again"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies (this may take a few minutes)..."
npm install

echo ""
echo "========================================================================"
echo "  FAMILYSEARCH LOGIN"
echo "========================================================================"
echo ""
echo "A browser window will open."
echo "Please log into FamilySearch, then come back here."
echo ""
read -p "Press Enter to open FamilySearch login..."

# Run a quick test to trigger login
FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js --state Delaware --year 1860 --limit 1

echo ""
echo "========================================================================"
echo "  SETUP COMPLETE!"
echo "========================================================================"
echo ""
echo "  Now double-click START-SCRAPER.command each day to run."
echo ""
read -p "Press Enter to close..."
