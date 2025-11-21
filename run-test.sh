#!/bin/bash

# Run autonomous agent test with proper environment

export DATABASE_URL="postgresql://reparations_user:<REDACTED-render-pg-decommissioned-2026-04-25>@dpg-d3v78f7diees73epc4k0-a.virginia-postgres.render.com/reparations?sslmode=require"
export NODE_ENV="production"

node test-autonomous-agent.js "$1"
