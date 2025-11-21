#!/bin/bash

# Simple test with built-in URL

export DATABASE_URL="postgresql://reparations_user:hjEMn35Kw7p712q1SYJnBxZqIYRdahHv@dpg-d3v78f7diees73epc4k0-a.virginia-postgres.render.com/reparations?sslmode=require"
export NODE_ENV="production"

echo "Testing with Wikipedia page..."
node test-autonomous-agent.js "https://en.wikipedia.org/wiki/George_Washington"
