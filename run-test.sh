#!/bin/bash

# Run autonomous agent test with proper environment

# Render Postgres decommissioned 2026-04-25 (credential leaked in git history, db deleted).
# Use the DATABASE_URL from .env (Neon) instead.
: "${DATABASE_URL:?set DATABASE_URL in .env (Neon) before running}"
export NODE_ENV="production"

node test-autonomous-agent.js "$1"
