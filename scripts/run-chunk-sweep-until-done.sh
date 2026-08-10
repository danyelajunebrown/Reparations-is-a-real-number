#!/bin/bash
# Supervisor for the chunked re-embed. The sweep is idempotent and resumable (it selects only documents
# with no chunk_index>0 row), so the correct response to ANY crash is to start it again. Added after a
# single dropped Neon socket (EADDRNOTAVAIL on an idle pool client) killed a run at ~11,200 of 20,055 docs
# and left a log that looked stalled rather than dead.
cd "$(dirname "$0")/.." || exit 1
for i in $(seq 1 40); do
  echo "=== sweep attempt $i · $(date) ==="
  node scripts/embed-doc-chunks.mjs --unchunked --conc 3 --apply && { echo "=== sweep completed cleanly ==="; break; }
  echo "=== attempt $i died, restarting in 20s ==="; sleep 20
done
