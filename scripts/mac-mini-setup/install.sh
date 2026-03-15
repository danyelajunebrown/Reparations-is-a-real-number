#!/bin/bash
# =============================================================================
# REPARATIONS SCRAPER - MAC MINI DEDICATED SETUP
# Run this once on a fresh Mac Mini to set everything up
# =============================================================================

set -e  # Exit on any error

echo ""
echo "========================================================================"
echo "  REPARATIONS PLATFORM - DEDICATED MAC MINI SETUP"
echo "========================================================================"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$PROJECT_DIR")"

echo "Project directory: $PROJECT_DIR"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Check for Homebrew, install if missing
# -----------------------------------------------------------------------------
echo "[1/6] Checking Homebrew..."
if ! command -v brew &> /dev/null; then
    echo "  Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add to path for Apple Silicon Macs
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    fi
else
    echo "  Homebrew already installed"
fi
echo ""

# -----------------------------------------------------------------------------
# Step 2: Install Node.js
# -----------------------------------------------------------------------------
echo "[2/6] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "  Installing Node.js via Homebrew..."
    brew install node
else
    NODE_VERSION=$(node --version)
    echo "  Node.js already installed: $NODE_VERSION"
fi
echo ""

# -----------------------------------------------------------------------------
# Step 3: Install Google Chrome (for Puppeteer)
# -----------------------------------------------------------------------------
echo "[3/6] Checking Google Chrome..."
if [[ ! -d "/Applications/Google Chrome.app" ]]; then
    echo "  Installing Google Chrome..."
    brew install --cask google-chrome
else
    echo "  Google Chrome already installed"
fi
echo ""

# -----------------------------------------------------------------------------
# Step 4: Install project dependencies
# -----------------------------------------------------------------------------
echo "[4/6] Installing project dependencies..."
cd "$PROJECT_DIR"
npm install
echo ""

# -----------------------------------------------------------------------------
# Step 5: Verify .env file exists
# -----------------------------------------------------------------------------
echo "[5/6] Checking environment configuration..."
if [[ ! -f "$PROJECT_DIR/.env" ]]; then
    echo "  ERROR: .env file not found!"
    echo "  Please copy .env from your main machine or create one with:"
    echo "    DATABASE_URL=your_neon_database_url"
    exit 1
else
    echo "  .env file found"
    # Verify DATABASE_URL is set
    if grep -q "DATABASE_URL" "$PROJECT_DIR/.env"; then
        echo "  DATABASE_URL configured"
    else
        echo "  WARNING: DATABASE_URL not found in .env"
    fi
fi
echo ""

# -----------------------------------------------------------------------------
# Step 6: Test database connection
# -----------------------------------------------------------------------------
echo "[6/6] Testing database connection..."
cd "$PROJECT_DIR"
node -e "
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT COUNT(*) as count FROM unconfirmed_persons\`.then(r => {
    console.log('  Database connected! Records count:', r[0].count);
    process.exit(0);
}).catch(e => {
    console.error('  Database connection failed:', e.message);
    process.exit(1);
});
"

echo ""
echo "========================================================================"
echo "  SETUP COMPLETE!"
echo "========================================================================"
echo ""
echo "  Next steps:"
echo "  1. Run a test scrape:  npm run scrape:test"
echo "  2. Install auto-start: ./scripts/mac-mini-setup/install-services.sh"
echo "  3. Start scraping:     npm run scrape:1860"
echo ""
