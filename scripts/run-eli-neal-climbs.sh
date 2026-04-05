#!/bin/bash
# Eli Neal — All 4 grandparent climbs
# Maternal: Gwendolyn Fagan (already running), paternal grandparents from top of tree
# Run sequentially since they share one Chrome session on port 9222

cd "$(dirname "$0")/.."

echo "═══════════════════════════════════════════════"
echo "  ELI NEAL — ANCESTOR CLIMBS (4 GRANDPARENTS)"
echo "═══════════════════════════════════════════════"
echo ""

# Grandparent 1: Gwendolyn Louise Fagan (1923-2007) — ALREADY RUNNING
echo "GP1: Gwendolyn Fagan (LX39-1MY) — already running in separate process"
echo ""

# Grandparent 2: Edward Joseph Schwehr (1916-1992)
echo "GP2: Edward Joseph Schwehr (GQ5M-G1L, 1916-1992)"
node scripts/scrapers/familysearch-ancestor-climber.js GQ5M-G1L 2>&1 | tee logs/ancestor-climb-GQ5M-G1L-$(date +%Y-%m-%dT%H-%M-%S).log
echo ""

# Grandparent 3: KV29-9MN (paternal grandfather's parent)
echo "GP3: KV29-9MN (paternal line)"
node scripts/scrapers/familysearch-ancestor-climber.js KV29-9MN 2>&1 | tee logs/ancestor-climb-KV29-9MN-$(date +%Y-%m-%dT%H-%M-%S).log
echo ""

# Grandparent 4: MBLJ-P9B (paternal grandmother's parent)  
echo "GP4: MBLJ-P9B (paternal line)"
node scripts/scrapers/familysearch-ancestor-climber.js MBLJ-P9B 2>&1 | tee logs/ancestor-climb-MBLJ-P9B-$(date +%Y-%m-%dT%H-%M-%S).log
echo ""

echo "═══════════════════════════════════════════════"
echo "  ALL CLIMBS COMPLETE"
echo "═══════════════════════════════════════════════"
