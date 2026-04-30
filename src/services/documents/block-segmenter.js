/**
 * Block segmentation for the document-ingestion pipeline.
 *
 * Different document classes need different segmentation strategies:
 *
 *   - Newspaper page → multiple distinct ads/notices/articles in spatially-
 *     separated blocks. We use the OCR engine's pre-existing block grouping
 *     (loc.gov / ALTO position[0] index) since the OCR has already done the
 *     spatial clustering work.
 *
 *   - Multi-page composite (will package, court filing) → page-level
 *     segmentation with per-page type classification (will narrative,
 *     codicil, oath form, witness deposition, registry proof). Implemented
 *     in will-package-splitter.js (separate file, will-extractor's domain).
 *
 *   - Ledger book / register / multi-entry roll → row-level segmentation
 *     based on horizontal divider lines + period rendering. Implemented in
 *     register-row-segmenter.js (future, when Hynson/Hanover roll arrives).
 *
 * This file holds the newspaper segmenter. The other two are separate
 * modules so each can specialize without coupling.
 */

/**
 * Segment a loc.gov word-coordinates JSON file into blocks.
 *
 * Input is the JSON shape returned by loc.gov's word-coordinates endpoint,
 * already saved to disk by scripts/pull-runaway-ad-samples.sh:
 *
 *   { "<xml_path>": { "coords": { "<word>": [{coordinates, language, position}, ...] } } }
 *
 * Each occurrence carries position=[block_idx, line_idx]. Words sharing the
 * same block_idx belong to the same OCR block (typically corresponds to a
 * column section, an ad, an article). We group by block_idx, sort words
 * within each block by reading order (y then x), and emit per-block text +
 * bounding box.
 *
 * @param {object} wordCoordsJson - parsed loc.gov word-coords JSON
 * @returns {Block[]}
 *
 * @typedef {object} Block
 * @property {number} blockIdx
 * @property {string} text - words joined in reading order
 * @property {{minX, minY, maxX, maxY, width, height}} bbox
 * @property {number} wordCount
 */
function segmentNewspaperPage(wordCoordsJson) {
    if (!wordCoordsJson || typeof wordCoordsJson !== 'object') return [];

    const xmlKey = Object.keys(wordCoordsJson)[0];
    const coords = wordCoordsJson[xmlKey]?.coords;
    if (!coords) return [];

    // Bucket: blockIdx → { tokens: [{x, y, word, lineIdx}], bbox extents }
    const blocks = new Map();
    for (const [word, occurrences] of Object.entries(coords)) {
        for (const occ of occurrences) {
            const pos = occ.position;
            const c = occ.coordinates;
            if (!pos || !c || c.length < 4) continue;
            const blockIdx = pos[0];
            const lineIdx = pos[1] ?? 0;
            if (!blocks.has(blockIdx)) {
                blocks.set(blockIdx, {
                    tokens: [],
                    minX: Infinity, minY: Infinity, maxX: 0, maxY: 0,
                });
            }
            const b = blocks.get(blockIdx);
            b.tokens.push({ x: c[0], y: c[1], word, lineIdx });
            b.minX = Math.min(b.minX, c[0]);
            b.minY = Math.min(b.minY, c[1]);
            b.maxX = Math.max(b.maxX, c[0] + c[2]);
            b.maxY = Math.max(b.maxY, c[1] + c[3]);
        }
    }

    // Build output blocks. Within each block, sort by lineIdx then x for
    // reading order. lineIdx is the OCR's own line number which is more
    // reliable than y-coordinate clustering (handles slightly skewed scans).
    const out = [];
    for (const [blockIdx, b] of blocks.entries()) {
        b.tokens.sort((a, t) => {
            if (a.lineIdx !== t.lineIdx) return a.lineIdx - t.lineIdx;
            return a.x - t.x;
        });
        const text = b.tokens.map(t => t.word).join(' ');
        out.push({
            blockIdx,
            text,
            bbox: {
                minX: b.minX, minY: b.minY,
                maxX: b.maxX, maxY: b.maxY,
                width: b.maxX - b.minX,
                height: b.maxY - b.minY,
            },
            wordCount: b.tokens.length,
        });
    }

    // Sort blocks by reading order on the page: top-to-bottom, then left-to-right
    // This makes upstream block-clustering (e.g. recombining a multi-block ad
    // that was split across columns) easier to reason about.
    out.sort((a, b) => {
        const yDiff = Math.floor(a.bbox.minY / 500) - Math.floor(b.bbox.minY / 500);
        if (yDiff !== 0) return yDiff;
        return a.bbox.minX - b.bbox.minX;
    });

    return out;
}

/**
 * Filter blocks to those large enough to contain a typical runaway ad
 * (heuristic: ≥ 15 words AND ≥ 100 chars). Tiny blocks are usually
 * page-furniture (column heads, prices, page numbers).
 */
function filterMeaningfulBlocks(blocks, { minWords = 15, minChars = 100 } = {}) {
    return blocks.filter(b => b.wordCount >= minWords && b.text.length >= minChars);
}

module.exports = {
    segmentNewspaperPage,
    filterMeaningfulBlocks,
};
