#!/usr/bin/env bash
# Phase B continuation: pull additional public-domain sample documents
# beyond runaway ads. Targets:
#   - LoC Born in Slavery / WPA Federal Writers' Project (slave narratives)
#   - Documenting the American South (manumissions, narratives, deeds)
#   - Internet Archive (digitized plantation records)
#   - LoC manuscripts (planters' papers, letters)
#
# Last Seen / Information Wanted requires their dedicated UI; deferred to
# manual fetch (added to shopping list).
#
# Idempotent: skips files that already exist.

set -uo pipefail
ROOT="/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main/samples"
UA="Mozilla/5.0 reparations-research/1.0 (educational; danyelebrown@gmail.com)"

mkdir -p "$ROOT/wpa_narratives" "$ROOT/docsouth_records" "$ROOT/manuscripts_letters"

###############################################################################
# 1. LoC Born in Slavery / WPA — search for narratives
###############################################################################
echo ">>> WPA narratives via LoC search"
WPA_DIR="$ROOT/wpa_narratives"
curl -sL -A "$UA" "https://www.loc.gov/collections/slave-narratives-from-the-federal-writers-project-1936-to-1938/?fo=json&c=5&at=results,pagination" -o "$WPA_DIR/.search.json" 2>&1
TOTAL=$(jq -r '.pagination.total // 0' "$WPA_DIR/.search.json")
echo "    WPA collection total items: $TOTAL"

# Pull metadata for top 5 results — these are typically multi-volume narrative collections
jq -c '.results[]?' "$WPA_DIR/.search.json" | head -5 | while read -r ITEM; do
    ID=$(echo "$ITEM" | jq -r '.id')
    TITLE=$(echo "$ITEM" | jq -r '.title' | head -c 120)
    DATE=$(echo "$ITEM" | jq -r '.date // "unknown"')
    URL=$(echo "$ITEM" | jq -r '.url // (.id)' | head -1)
    SLUG=$(echo "$TITLE" | tr -cd '[:alnum:] ' | tr -s ' ' '_' | tr '[:upper:]' '[:lower:]' | head -c 60)
    SAMPLE_DIR="$WPA_DIR/$SLUG"
    mkdir -p "$SAMPLE_DIR"

    cat > "$SAMPLE_DIR/metadata.json" <<EOF
{
  "document_class": "wpa_slave_narrative",
  "loc_id": $(jq -Rs . <<<"$ID"),
  "title": $(jq -Rs . <<<"$TITLE"),
  "publication_date": "$DATE",
  "loc_url": $(jq -Rs . <<<"$URL"),
  "note": "WPA Federal Writers' Project slave narratives, 1936-1938. ~2,300 first-person interviews with formerly enslaved people. Each narrative names former owners, plantations, locations. Critical Black-ancestry evidence stream. Top-level metadata only here; specific narrative texts fetched on-demand by extractor.",
  "license": "Library of Congress public-domain"
}
EOF
    echo "    metadata: $SLUG"
    sleep 0.5
done
rm -f "$WPA_DIR/.search.json"

###############################################################################
# 2. DocSouth — fetch a few specific known-good URLs
###############################################################################
echo ">>> DocSouth — known-good narrative + record URLs"
DOC_DIR="$ROOT/docsouth_records"

# Known DocSouth resources, hand-curated for relevance:
declare -a DS_URLS=(
    "https://docsouth.unc.edu/neh/jacobs/jacobs.html|incidents_jacobs|narrative|1861|Jacobs, Harriet — Incidents in the Life of a Slave Girl"
    "https://docsouth.unc.edu/fpn/douglass/douglass.html|narrative_douglass|narrative|1845|Douglass, Frederick — Narrative of the Life"
    "https://docsouth.unc.edu/fpn/jacobs/menu.html|jacobs_menu|narrative_index|1861|Jacobs Incidents — DocSouth menu"
)

for ENTRY in "${DS_URLS[@]}"; do
    IFS='|' read -r URL SLUG CLASS YEAR TITLE <<< "$ENTRY"
    SAMPLE_DIR="$DOC_DIR/$SLUG"
    mkdir -p "$SAMPLE_DIR"
    if [ ! -s "$SAMPLE_DIR/page.html" ]; then
        echo "    fetch $SLUG"
        curl -sL -A "$UA" "$URL" -o "$SAMPLE_DIR/page.html" || true
        sleep 1.0
    fi
    cat > "$SAMPLE_DIR/metadata.json" <<EOF
{
  "document_class": "$CLASS",
  "title": $(jq -Rs . <<<"$TITLE"),
  "publication_date": "$YEAR",
  "source_url": "$URL",
  "files": {"narrative_html": "page.html"},
  "note": "Documenting the American South (UNC) digitized narrative. HTML page; extractor will need to strip navigation chrome and isolate narrative body.",
  "license": "DocSouth (UNC) — academic use; check individual rights"
}
EOF
    SIZE=$(stat -f%z "$SAMPLE_DIR/page.html" 2>/dev/null || echo 0)
    echo "      saved ${SIZE}B"
done

###############################################################################
# 3. Internet Archive — search for digitized plantation records
###############################################################################
echo ">>> Internet Archive — plantation records search"
IA_DIR="$ROOT/manuscripts_letters"

IA_QUERIES=(
    "isaac+franklin+slave+trader"
    "george+noble+jones+plantation"
    "freedmen's+bureau+labor+contract"
)

for Q in "${IA_QUERIES[@]}"; do
    SLUG=$(echo "$Q" | tr '+' '_' | tr -cd '[:alnum:]_')
    RESULT_FILE="$IA_DIR/.search_$SLUG.json"
    curl -sL -A "$UA" "https://archive.io/advancedsearch.php?q=${Q}&fl[]=identifier,title,year,creator&output=json&rows=3" -o "$RESULT_FILE" 2>&1
    if [ -s "$RESULT_FILE" ]; then
        echo "    $Q → $(jq -r '.response.numFound // 0' "$RESULT_FILE") hits"
        jq -c '.response.docs[]?' "$RESULT_FILE" | head -3 | while read -r ITEM; do
            IDENT=$(echo "$ITEM" | jq -r '.identifier')
            TITLE=$(echo "$ITEM" | jq -r '.title' | head -c 80)
            YEAR=$(echo "$ITEM" | jq -r '.year // "unknown"')
            ITEM_DIR="$IA_DIR/${SLUG}_${IDENT:0:40}"
            mkdir -p "$ITEM_DIR"
            cat > "$ITEM_DIR/metadata.json" <<EOF
{
  "document_class": "published_compilation_of_primary_records",
  "ia_identifier": $(jq -Rs . <<<"$IDENT"),
  "title": $(jq -Rs . <<<"$TITLE"),
  "publication_year": "$YEAR",
  "ia_details_url": "https://archive.org/details/$IDENT",
  "ia_pdf_url": "https://archive.org/download/$IDENT/$IDENT.pdf",
  "search_query": "$Q",
  "note": "Internet Archive metadata pointer. Full PDF/text fetched on-demand by extractor. Verify slavery relevance from title before deep ingestion.",
  "license": "varies — check per-item"
}
EOF
            echo "      metadata: $IDENT"
        done
    fi
    rm -f "$RESULT_FILE"
done

###############################################################################
# Final manifest
###############################################################################
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Sample tree:"
find "$ROOT" -type d -not -path '*/.*' | sort
echo ""
echo "  Total samples size:"
du -sh "$ROOT"
echo "═══════════════════════════════════════════════════════════════"
