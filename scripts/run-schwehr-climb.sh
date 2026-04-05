#!/bin/bash
# Wait for Gwendolyn Fagan climb to finish, then climb Edward Schwehr
cd "$(dirname "$0")/.."

echo "Waiting for Gwendolyn Fagan climb (PID 39226) to finish..."
while kill -0 39226 2>/dev/null; do
    sleep 30
done
echo "Gwendolyn climb finished. Starting Edward Schwehr climb..."
sleep 5

node scripts/scrapers/familysearch-ancestor-climber.js GQ5M-G1L 2>&1 | tee logs/ancestor-climb-GQ5M-G1L-$(date +%Y-%m-%dT%H-%M-%S).log

echo "Edward Schwehr climb complete."
