#!/bin/bash

# Setup script for autonomous research agent

echo "🤖 Setting up Autonomous Research Agent..."

# Set database URL with SSL parameters
export DATABASE_URL="postgresql://reparations_user:<REDACTED-render-pg-decommissioned-2026-04-25>@dpg-d3v78f7diees73epc4k0-a.virginia-postgres.render.com/reparations?sslmode=require"

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
