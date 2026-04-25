#!/bin/bash

# Simple test with built-in URL

# Render Postgres decommissioned 2026-04-25 (credential leaked in git history, db deleted).
# Use the DATABASE_URL from .env (Neon) instead.
: "${DATABASE_URL:?set DATABASE_URL in .env (Neon) before running}"
export NODE_ENV="production"

echo "Testing with Wikipedia page..."
node test-autonomous-agent.js "https://en.wikipedia.org/wiki/George_Washington"
