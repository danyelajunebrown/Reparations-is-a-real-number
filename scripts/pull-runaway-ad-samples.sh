#!/usr/bin/env bash
# Pull representative runaway-ad samples from Chronicling America via loc.gov.
# Saves to samples/runaway_ads/ in the repo with manifest.

set -euo pipefail
ROOT="/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main/samples/runaway_ads"
mkdir -p "$ROOT"
UA="Mozilla/5.0 reparations-research/1.0 (educational; danyelebrown@gmail.com)"

# Three queries × three results per era = 9 samples spanning 1780s–1860s.
QUERIES=(
    "ranaway+negro+reward"
    "ranaway+from+the+subscriber"
    "absconded+negro"
)
ERAS=("1810/1830" "1830/1850" "1850/1865")

MANIFEST="$ROOT/manifest.json"
echo "[" > "$MANIFEST"
FIRST=1

for ERA in "${ERAS[@]}"; do
    for Q in "${QUERIES[@]}"; do
        echo ">>> era=$ERA q=$Q"
        SLUG="$(echo "$Q" | tr '+' '_')_$(echo "$ERA" | tr '/' '-')"
        RESPF="$ROOT/.tmp_${SLUG}.json"
        curl -sL -A "$UA" "https://www.loc.gov/search/?q=${Q}&fa=partof:chronicling+america&dates=${ERA}&fo=json&c=1&at=results" -o "$RESPF"

        # Extract first result's id, date, image URL, ALTO URL
        RESULT_JSON=$(jq -c '.results[0] // empty' "$RESPF")
        if [ -z "$RESULT_JSON" ]; then
            echo "    no results"
            continue
        fi

        ID=$(echo "$RESULT_JSON" | jq -r '.id')
        DATE=$(echo "$RESULT_JSON" | jq -r '.date')
        TITLE=$(echo "$RESULT_JSON" | jq -r '.title' | head -c 100)
        # Pick the medium-resolution image (12.5%)
        IMG_URL=$(echo "$RESULT_JSON" | jq -r '.image_url[1] // .image_url[0]' | sed 's/#.*$//')
        ALTO_URL=$(echo "$RESULT_JSON" | jq -r '.image_url[]' | grep "word-coordinates-service\|alto_json" | head -1 | sed 's/#.*$//' || echo "")

        SAMPLE_DIR="$ROOT/$SLUG"
        mkdir -p "$SAMPLE_DIR"
        IMG_PATH="$SAMPLE_DIR/page.jpg"
        ALTO_PATH="$SAMPLE_DIR/alto.json"

        if [ ! -s "$IMG_PATH" ]; then
            echo "    fetch image"
            curl -sL -A "$UA" "$IMG_URL" -o "$IMG_PATH" || true
        fi
        if [ -n "$ALTO_URL" ] && [ ! -s "$ALTO_PATH" ]; then
            echo "    fetch alto"
            curl -sL -A "$UA" "$ALTO_URL" -o "$ALTO_PATH" || true
        fi

        IMG_SIZE=$(stat -f%z "$IMG_PATH" 2>/dev/null || echo 0)
        ALTO_SIZE=$(stat -f%z "$ALTO_PATH" 2>/dev/null || echo 0)
        echo "    saved img=${IMG_SIZE}B alto=${ALTO_SIZE}B"

        # Metadata file per sample
        cat > "$SAMPLE_DIR/metadata.json" <<EOF
{
  "document_class": "newspaper_runaway_ad",
  "loc_id": $(jq -Rs . <<<"$ID"),
  "newspaper_title": $(jq -Rs . <<<"$TITLE"),
  "publication_date": "$DATE",
  "search_era": "$ERA",
  "search_query": "$Q",
  "image_url": "$IMG_URL",
  "alto_url": "$ALTO_URL",
  "files": {
    "page_image": "page.jpg",
    "alto_json": "alto.json"
  },
  "note": "Page-level image. Per-ad block segmentation happens at extraction time. ALTO XML carries word-level bounding boxes for block extraction.",
  "license": "Library of Congress public-domain (No Known Restrictions)"
}
EOF

        # Append to combined manifest
        if [ $FIRST -eq 0 ]; then echo "," >> "$MANIFEST"; fi
        cat "$SAMPLE_DIR/metadata.json" >> "$MANIFEST"
        FIRST=0

        rm -f "$RESPF"
        sleep 1.0  # be polite
    done
done

echo "" >> "$MANIFEST"
echo "]" >> "$MANIFEST"

echo "═══════════════════════════════════════════════════════════════"
echo "  Samples saved to: $ROOT"
ls -la "$ROOT" | head -30
echo "  manifest at: $MANIFEST"
