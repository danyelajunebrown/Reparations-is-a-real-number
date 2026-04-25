#!/bin/bash

# Setup script for autonomous research agent

echo "🤖 Setting up Autonomous Research Agent..."

# Set database URL with SSL parameters
# Render Postgres decommissioned 2026-04-25 (credential leaked in git history, db deleted).
# Use the DATABASE_URL from .env (Neon) instead.
: "${DATABASE_URL:?set DATABASE_URL in .env (Neon) before running}"

# Force SSL for Render
export NODE_ENV="production"

echo "✓ Database URL configured with SSL"

# Initialize database
echo "📊 Initializing database schema..."
psql "$DATABASE_URL" -f init-unconfirmed-persons-schema.sql

if [ $? -eq 0 ]; then
    echo "✓ Database initialized successfully"
else
    echo "❌ Database initialization failed"
    exit 1
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To test the agent, run:"
echo '  node test-autonomous-agent.js "https://www.findagrave.com/memorial/8194"'
