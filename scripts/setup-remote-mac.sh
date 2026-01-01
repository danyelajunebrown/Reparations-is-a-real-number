#!/bin/bash
# =============================================================================
# REMOTE MAC SETUP SCRIPT
# =============================================================================
# Run this on the remote macOS machine to set up the scraper environment
# Usage: ./scripts/setup-remote-mac.sh
# =============================================================================

set -e

echo "========================================================================"
echo "  1860 SLAVE SCHEDULE SCRAPER - REMOTE SETUP"
echo "========================================================================"
echo ""

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo "❌ This script is for macOS only"
    exit 1
fi

# Check for Homebrew
if ! command -v brew &> /dev/null; then
    echo "📦 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "✅ Homebrew already installed"
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    brew install node@18
else
    NODE_VERSION=$(node --version)
    echo "✅ Node.js already installed ($NODE_VERSION)"
fi

# Check for Chrome
if [ ! -d "/Applications/Google Chrome.app" ]; then
    echo "📦 Installing Google Chrome..."
    brew install --cask google-chrome
else
    echo "✅ Google Chrome already installed"
fi

# Install npm dependencies
echo ""
echo "📦 Installing npm dependencies..."
npm install

# Create logs directory
mkdir -p logs/1860-slave-schedules

# Check for .env file
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  No .env file found!"
    echo "   Please create .env with DATABASE_URL"
    echo ""
    echo "   Example:"
    echo '   DATABASE_URL=postgresql://...'
    echo ""
else
    echo "✅ .env file exists"
fi

# Check for Google Vision key
if [ ! -f "google-vision-key.json" ]; then
    echo ""
    echo "⚠️  No google-vision-key.json found!"
    echo "   OCR will not work without this file."
    echo "   Copy it from the original machine."
    echo ""
else
    echo "✅ Google Vision key exists"
fi

# Make scripts executable
chmod +x scripts/run-all-1860-slave-schedules.sh
chmod +x scripts/run-census-scraper-resilient.sh

echo ""
echo "========================================================================"
echo "  SETUP COMPLETE"
echo "========================================================================"
echo ""
echo "Next steps:"
echo "  1. Ensure .env has DATABASE_URL"
echo "  2. Copy google-vision-key.json if missing"
echo "  3. Run initial login:"
echo "     FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js --state Delaware --year 1860 --limit 1"
echo "  4. Log into FamilySearch when browser opens"
echo "  5. Start full scraper:"
echo "     ./scripts/run-all-1860-slave-schedules.sh"
echo ""
