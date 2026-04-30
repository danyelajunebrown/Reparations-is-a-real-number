#!/usr/bin/env node
/**
 * Freedmen's Bank — Enslaver Field Extraction via Google Vision + spatial parser.
 *
 * Replaces the earlier flat-text regex parser, which failed because:
 *   1. Form labels are in a LEFT column and handwritten values are in a
 *      RIGHT column — not adjacent in OCR text. Value for "Age," was
 *      several labels away in the flat text stream.
 *   2. "age" matched inside "Image 705 of 1,118" (the FS viewer's page
 *      counter), so every page reported age="705 of 1,118".
 *   3. Each ledger image holds FOUR depositor records in a 2×2 grid. The
 *      old parser treated the whole page as one record.
 *
 * New approach:
 *   • Request Vision DOCUMENT_TEXT_DETECTION, keep full word/bbox data.
 *   • Partition each page into 4 record quadrants by finding "No.NNNN"
 *     account anchors — one anchor per record.
 *   • Inside each quadrant, find printed-form labels (strict regex, whole
 *     phrase match on merged row text) and pair them with handwritten
 *     value words to the RIGHT on the same y-row.
 *   • Skip images > 324 (Charleston Roll 21's enslaver-field cutoff per
 *     user's manual audit 2026-04-18).
 *   • Cache OCR+parse results by origLink so four depositors sharing a
 *     page only trigger one Vision call.
 *
 * Usage:
 *   node scripts/extract-freedmens-fields.js --branch "Charleston, South Carolina — Roll 21" --limit 5 --dry-run
 *   node scripts/extract-freedmens-fields.js --branch "Charleston, South Carolina — Roll 21"
 *
 * Flags:
 *   --branch <name>    (required) BRANCHES key from scrape-freedmens-bank-indexed.js
 *   --limit N          stop after N Vision calls (not depositor rows)
 *   --dry-run          skip DB writes + S3 archival, print extracted fields
 *   --max-image N      override the default 324 ceiling
 *   --acct-max N       pre-filter depositors to account # <= N (default 319
 *                      for Charleston Roll 21 — the known-safe low range)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const puppeteer = require('puppeteer-core');
const { neon } = require('@neondatabase/serverless');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ── CLI args ────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const argAt = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
};
const BRANCH = argAt('--branch');
const LIMIT = parseInt(argAt('--limit')) || null;
const MAX_IMAGE = parseInt(argAt('--max-image')) || 324;
const ACCT_MAX = parseInt(argAt('--acct-max')) || 319;
// When set, skip the Vision API call and re-parse a previously saved response
// JSON from disk. Makes parser iteration free. Also skips taking a new
// screenshot (the existing .png is left alone).
const REUSE_OCR = process.argv.includes('--reuse-ocr');
// Sample a random depositor from the branch (ORDER BY RANDOM()). Useful for
// verification sweeps where we want to probe "any page" not "first page".
const RANDOM_SAMPLE = process.argv.includes('--random');

// USE_DOCUMENT_AI=true (env var or --document-ai flag) routes OCR through
// the deployed Freedmans_Bank_Deposit_Reader Custom Extractor instead of
// the Vision-API-plus-spatial-parser path. See src/services/document-ai-extractor.js
// for thresholds, schema, and cost notes.
const USE_DOCUMENT_AI = process.env.USE_DOCUMENT_AI === 'true' || process.argv.includes('--document-ai');
const docAiExtractor = USE_DOCUMENT_AI ? require('../src/services/document-ai-extractor') : null;

const sql = neon(process.env.DATABASE_URL);
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;

let s3Service = null;
try { s3Service = require('../src/services/storage/S3Service'); } catch (_) {}

// ── Form templates ─────────────────────────────────────────────────────────
// Charleston Roll 21 uses TWO form variants:
//   Images 1–324:   single-record numbered form ("1. Name of Depositor.", ...,
//                   "21. Name of last master of depositor.", etc.)
//                   Enslaver fields (lines 21–23) exist only in this variant.
//   Images 325+:    4-record short-form ("Age,", "Residence,", ...) — no
//                   enslaver fields present on the form at all.
//
// Labels below start with an optional numeric prefix "(\d+\.\s*)?" so the same
// regex matches both variants. All regexes are anchored (^ $) and applied to
// the merged leading-word text of a row, so "age" no longer matches inside
// "Image 705 of 1,118".
const NUM = String.raw`(\d+\.\s*)?`;

// Label patterns tested against:
//   • Charleston Roll 21 pre-image-324: numbered 26-field form, 1 record/page
//   • Baltimore + Huntsville: unnumbered ~13-field form, 8 records/page
// Multi-word patterns come before single-word ones so longest-first loop
// matches the more specific label first.
const LABEL_PATTERNS = [
    // ── Record header: "Record for NAME" — identifies a depositor record on
    //    unnumbered forms (Baltimore, Huntsville, etc.). The catchment area
    //    after this label is the depositor's name.
    { key: 'record_header_name',     rx: new RegExp(`^record\\s+for[,.:]?$`, 'i') },

    // ── Enslaver / post-emancipation labor-relationship fields ──
    // "Name of Master" (Baltimore/Huntsville) and "Name of last master of
    // depositor" (Charleston R21) both match — every prefix group is optional.
    // "Name of Employer" (Raleigh, Mobile) is tracked as a peer field because
    // in the 1867-1874 era it frequently referred to the former slaveholder
    // continuing the labor relationship under a new contractual name.
    { key: 'last_master',            rx: new RegExp(`^${NUM}(name\\s+of\\s+(the\\s+)?(last\\s+)?)?master(\\s+or\\s+mistress)?(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'last_mistress',          rx: new RegExp(`^${NUM}(name\\s+of\\s+(the\\s+)?(last\\s+)?)?mistress(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'employer',               rx: new RegExp(`^${NUM}(name\\s+of\\s+)?employer[,.:;]?$`, 'i') },
    { key: 'plantation',             rx: new RegExp(`^${NUM}plantation[,.:;]?$`, 'i') },
    { key: 'old_title',              rx: new RegExp(`^${NUM}old\\s+title(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'slave_residence',        rx: new RegExp(`^${NUM}last\\s+residence(\\s+of\\s+depositor)?(\\s+while\\s+a\\s+slave)?[,.:;]?$`, 'i') },
    { key: 'union_lines',            rx: new RegExp(`^${NUM}time\\s+when(\\s+depositor)?(\\s+came\\s+within\\s+the\\s+union\\s+lines)?[,.:;]?$`, 'i') },
    { key: 'post_emancipation',      rx: new RegExp(`^${NUM}what\\s+depositor\\s+has\\s+since\\s+been\\s+doing[,.:;]?`, 'i') },
    { key: 'further_facts',          rx: new RegExp(`^${NUM}further\\s+facts(\\s+for\\s+identification)?[,.:;]?$`, 'i') },
    { key: 'remarks',                rx: new RegExp(`^${NUM}remarks[,.:;]?$`, 'i') },

    // ── Depositor identity ──
    { key: 'depositor_name',         rx: new RegExp(`^${NUM}name\\s+of\\s+depositor[,.:;]?$`, 'i') },
    { key: 'date',                   rx: new RegExp(`^${NUM}date(\\s+and\\s+no\\.?\\s+of\\s+application| of application)?[,.:;]?$`, 'i') },
    { key: 'application_no',         rx: new RegExp(`^${NUM}no\\.?\\s+of\\s+application[,.:;]?$`, 'i') },
    { key: 'birthplace',             rx: new RegExp(`^${NUM}(where\\s+born|birthplace|place\\s+of\\s+birth)[,.:;]?$`, 'i') },
    { key: 'raised_in',              rx: new RegExp(`^${NUM}where\\s+brought\\s+up[,.:;]?$`, 'i') },
    { key: 'residence',              rx: new RegExp(`^${NUM}residence(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'age',                    rx: new RegExp(`^${NUM}age[,.:;]?$`, 'i') },
    { key: 'height_and_complexion',  rx: new RegExp(`^${NUM}height\\s+and\\s+complexion[,.:;]?$`, 'i') },
    { key: 'complexion',             rx: new RegExp(`^${NUM}complexion[,.:;]?$`, 'i') },
    { key: 'occupation',             rx: new RegExp(`^${NUM}occupation[,.:;]?$`, 'i') },
    { key: 'works_for',              rx: new RegExp(`^${NUM}works\\s+for[,.:;]?$`, 'i') },
    { key: 'regiment_and_company',   rx: new RegExp(`^${NUM}regiment\\s+and\\s+company[,.:;]?$`, 'i') },
    { key: 'regiment',               rx: new RegExp(`^${NUM}regiment[,.:;]?$`, 'i') },
    { key: 'company',                rx: new RegExp(`^${NUM}company[,.:;]?$`, 'i') },
    { key: 'marital_status',         rx: new RegExp(`^${NUM}married\\s+or\\s+single[,.:;]?$`, 'i') },
    // Compound "Father or Mother? Married?" label used on Baltimore/Huntsville/
    // Mobile short-form. When printed as one label this must match BEFORE the
    // plain father/mother patterns or it will get incorrectly split. Value is
    // usually a short yes/no or relationship status — not a name.
    { key: 'father_or_mother_married', rx: new RegExp(`^${NUM}father\\s+or\\s+mother\\??\\s*,?\\s*married\\??[,.:;]?$`, 'i') },

    // ── Family ──
    { key: 'spouse_name',            rx: new RegExp(`^${NUM}(name\\s+of\\s+)?(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'spouse_residence',       rx: new RegExp(`^${NUM}residence\\s+of\\s+(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'children',               rx: new RegExp(`^${NUM}(names?\\s+(and\\s+ages\\s+)?of\\s+(their\\s+)?)?children[,.:;]?$`, 'i') },
    { key: 'children_res',           rx: new RegExp(`^${NUM}residences?\\s+of\\s+(their\\s+)?children[,.:;]?$`, 'i') },

    // Spouse's relatives — placed BEFORE the plain father/mother so longest-
    // first loop picks the more specific phrase on Charleston R21.
    { key: 'spouse_father',              rx: new RegExp(`^${NUM}name\\s+of\\s+father\\s+of\\s+(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'spouse_mother',              rx: new RegExp(`^${NUM}name\\s+of\\s+mother\\s+of\\s+(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'spouse_siblings',            rx: new RegExp(`^${NUM}(names\\s+of\\s+)?brothers\\s+and\\s+sisters\\s+of\\s+(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'spouse_family_residences',   rx: new RegExp(`^${NUM}residences?\\s+of\\s+father\\s*,?\\s*mother\\s*,?\\s*(and\\s+)?brothers\\s*,?\\s*and\\s+sisters\\s+of\\s+(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },

    { key: 'family_residences',          rx: new RegExp(`^${NUM}residences?\\s+of\\s+father\\s*,?\\s*mother\\s*,?\\s*(and\\s+)?brothers\\s*,?\\s*and\\s+sisters(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'siblings',                   rx: new RegExp(`^${NUM}(names\\s+of\\s+)?brothers\\s+and\\s+sisters(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'father',                     rx: new RegExp(`^${NUM}(name\\s+of\\s+)?father(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'mother',                     rx: new RegExp(`^${NUM}(name\\s+of\\s+)?mother(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },

    { key: 'signature',                  rx: new RegExp(`^${NUM}signature(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
];

const stats = { pagesOcrd: 0, recordsParsed: 0, depositorsMatched: 0, dbUpdates: 0, skippedPastCutoff: 0, errors: 0, cacheHits: 0, startTime: Date.now() };

// ── Vision OCR returning full response (not just text) ──────────────────────
// Retries transient Vision API failures (5xx + network errors) with exponential
// backoff. The Apr 27 savannah run died at OCR call #992 from a single
// uncaught HTTP 503 — long branches need a retry layer or one transient blip
// kills hours of progress.
async function ocrImageFull(imageBuffer) {
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;
    const body = { requests: [{ image: { content: imageBuffer.toString('base64') }, features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }] }] };
    const delays = [5000, 15000, 45000];
    let lastErr = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            const res = await axios.post(url, body, { timeout: 60000 });
            const annotation = res.data.responses[0];
            if (annotation.error) throw new Error(`Vision API: ${annotation.error.message}`);
            return annotation.fullTextAnnotation || null;
        } catch (e) {
            lastErr = e;
            const status = e.response?.status;
            const transient = !status || (status >= 500 && status < 600) || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED';
            if (!transient || attempt === delays.length) break;
            console.log(`  ⚠ Vision API ${status || e.code || 'error'}, retrying in ${delays[attempt] / 1000}s (attempt ${attempt + 1}/${delays.length})`);
            await new Promise(r => setTimeout(r, delays[attempt]));
        }
    }
    throw lastErr;
}

// ── Flatten the nested Vision response to a flat word list with bounding boxes
function extractWords(fullTextAnnotation) {
    const words = [];
    for (const page of fullTextAnnotation?.pages || []) {
        for (const block of page.blocks || []) {
            for (const para of block.paragraphs || []) {
                for (const w of para.words || []) {
                    const text = (w.symbols || []).map(s => s.text).join('');
                    const box = w.boundingBox;
                    if (!text || !box?.vertices?.length) continue;
                    const xs = box.vertices.map(v => v.x || 0);
                    const ys = box.vertices.map(v => v.y || 0);
                    words.push({
                        text,
                        x: Math.min(...xs),
                        y: Math.min(...ys),
                        xR: Math.max(...xs),
                        yB: Math.max(...ys),
                        h: Math.max(...ys) - Math.min(...ys),
                    });
                }
            }
        }
    }
    return words;
}

// ── Filter out FS viewer UI chrome so parser only sees the ledger ──────────
//
// At viewport 2400×1800 the FS Image viewer paints a top nav bar, a right-hand
// tools/indexing sidebar, a thin left-edge "Feedback" rail, and a bottom strip
// of thumbnails. Their OCR-able text (e.g. "Bank Records", "NAMES", "SAVE
// RECORD") bleeds into ledger rows during y-clustering — "Bank Records" at
// x=2316 ended up tacked onto ledger row y=838 and polluted old_title's value.
//
// Rectangles tuned against image 107 of Charleston Roll 21; adjust if the
// viewer layout changes.
const LEDGER_BOUNDS = {
    minX: 40,     // exclude the left "Feedback" vertical rail
    maxX: 2200,   // exclude the right tools/metadata sidebar
    minY: 120,    // exclude top nav / collection breadcrumb / tab bar
    maxY: 1600,   // exclude bottom thumbnail strip + "mark"/signature tail
};
function filterToLedger(words, bounds = LEDGER_BOUNDS) {
    return words.filter(w =>
        w.x >= bounds.minX && w.xR <= bounds.maxX &&
        w.y >= bounds.minY && w.yB <= bounds.maxY
    );
}

// ── Group words into horizontal rows by y-center clustering ─────────────────
function groupIntoRows(words, tol = 10) {
    const sorted = [...words].sort((a, b) => (a.y + a.yB) / 2 - (b.y + b.yB) / 2);
    const rows = [];
    for (const w of sorted) {
        const mid = (w.y + w.yB) / 2;
        const last = rows[rows.length - 1];
        if (last && Math.abs(mid - last.mid) <= tol) {
            last.words.push(w);
            last.mid = last.words.reduce((s, x) => s + (x.y + x.yB) / 2, 0) / last.words.length;
        } else {
            rows.push({ mid, words: [w] });
        }
    }
    for (const row of rows) row.words.sort((a, b) => a.x - b.x);
    return rows;
}

// ── Find record anchors ────────────────────────────────────────────────────
//
// Two anchor types:
//   1. "No.NNNN" account numbers (Charleston Roll 21 pre-image-324)
//   2. "Record for [name]" headers (Baltimore, Huntsville, Charleston 22+, all
//      short-form branches) — no numeric anchor, just the phrase that opens
//      each depositor's record
//
// Each anchor carries an `acct` when extractable from a nearby number-looking
// word; otherwise acct stays null and the caller matches via position.
function findRecordAnchors(words) {
    const anchors = [];

    // Type 1: "No.NNNN" — single word ("No.3833") or pair ("No." + "3833")
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const asOne = /^No\.?\s*(\d{2,5})\.?$/i.exec(w.text);
        if (asOne) {
            anchors.push({ acct: parseInt(asOne[1]), x: w.x, y: w.y, source: 'no-single' });
            continue;
        }
        const next = words[i + 1];
        if (/^No\.?$/i.test(w.text) && next && /^\d{2,5}\.?$/.test(next.text) && Math.abs(next.y - w.y) < 20) {
            anchors.push({ acct: parseInt(next.text), x: w.x, y: w.y, source: 'no-pair' });
        }
    }

    // Type 2: "Record for" phrase. Vision's OCR routinely mis-reads "Record"
    // as "Becord", "lecord", "Pecord", "Reword", etc. when the "R" is written
    // in cursive script. We accept a broad set of 1-character-off variants
    // for the first word and also allow "for" with or without trailing
    // punctuation. Spatial y-adjacency (< 25px) keeps false positives low.
    const RECORD_WORD_RX = /^[BRbrPplL][e3]?[cokng][o0aq]?rd[.,]?$/i;
    const FOR_WORD_RX = /^for[.,:;]?$/i;
    for (let i = 0; i < words.length - 1; i++) {
        if (RECORD_WORD_RX.test(words[i].text) && FOR_WORD_RX.test(words[i + 1].text)
            && Math.abs(words[i + 1].y - words[i].y) < 25) {
            anchors.push({ acct: null, x: words[i].x, y: words[i].y, source: 'record-for' });
        }
    }

    // Dedup: two anchors within ~60px of each other probably reference the
    // same record header that Vision OCR'd twice. Prefer the numbered one.
    const dedup = [];
    for (const a of [...anchors].sort((p, q) => (p.acct == null ? 1 : 0) - (q.acct == null ? 1 : 0))) {
        if (dedup.some(d => Math.abs(d.x - a.x) < 60 && Math.abs(d.y - a.y) < 60)) continue;
        dedup.push(a);
    }
    // Sort top-to-bottom then left-to-right for stable iteration
    dedup.sort((p, q) => (p.y - q.y) || (p.x - q.x));
    return dedup;
}

// ── Assign each word to the nearest record zone ─────────────────────────────
//
// Two layouts to handle:
//   Single-record form (Charleston Roll 21 images 1–324):
//     One "No. NNNN" anchor per page, at the top of the right-hand ledger
//     spread. The entire image (both ledger pages, all 26 fields) is one
//     record. Assigning by "anchor must be above-left" would wrongly exclude
//     the left-ledger-page fields (labels 1–16) because they sit to the LEFT
//     of the anchor. Single-anchor ⇒ whole page is one zone.
//
//   Multi-record form (Charleston Roll 21 images 325+):
//     Four "No. NNNN" anchors in a 2×2 grid. Each word belongs to the anchor
//     whose bounding rectangle (above-and-leftward) contains it.
function assignToZones(words, anchors) {
    if (!anchors.length) return new Map();

    if (anchors.length === 1) {
        const key = anchors[0].acct != null ? anchors[0].acct : `anchor-0`;
        return new Map([[key, { anchor: anchors[0], words: [...words] }]]);
    }

    // Multi-anchor: build unique keys since several anchors can share acct=null
    // (a page with 8 "Record for NAME" anchors would otherwise collapse into
    // a single null-keyed zone and lose 7 of 8 records).
    const keyFor = (a, idx) => a.acct != null ? `acct-${a.acct}` : `anchor-${idx}`;
    const zones = new Map();
    const keyed = anchors.map((a, i) => ({ ...a, _key: keyFor(a, i) }));
    for (const a of keyed) zones.set(a._key, { anchor: a, words: [] });

    for (const w of words) {
        const candidates = keyed.filter(a => a.y <= w.y + 5 && a.x <= w.x + 150);
        if (!candidates.length) continue;
        candidates.sort((p, q) => (q.y - p.y) || (q.x - p.x));
        zones.get(candidates[0]._key).words.push(w);
    }
    return zones;
}

// ── Within one record zone, match labels → values by spatial row ────────────
//
// Key design points (learned the hard way on Charleston Roll 21 image 107):
//   • Labels can start at ANY index within a row, not just index 0. Row y=805
//     contains "Louisa no. married 21. Name of last master of depositor. Mrs
//     Cyans Howe" — the left-column's children-list values spill into the same
//     y-band as the right-column's label 21. We scan every possible start.
//   • Multiple labels can appear on one row (e.g., left-column value + right-
//     column label) so after finding a label and its value, we resume scanning
//     FROM the end of the value, not from the next row.
//   • Numbered form labels span up to 8-9 words ("21. Name of last master of
//     depositor."), so max label phrase length is 10 words.
//   • Value = words to the right of the label, on the same row, stopping at
//     the next label on the row or at the end of the row.
//   • Same-row only for MVP. Cross-row value attribution is ambiguous on this
//     form (value for label 23 is closer in y to label 22 than to label 23)
//     so we don't attempt it yet — it would invent data more often than find it.
const MAX_LABEL_WORDS = 10;

function normalizeLabelPhrase(words) {
    return words.map(w => w.text).join(' ')
        .replace(/\s+([.,:;])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

function matchLabelAt(rowWords, idx) {
    const maxN = Math.min(MAX_LABEL_WORDS, rowWords.length - idx);
    for (let n = maxN; n >= 1; n--) {
        const phrase = normalizeLabelPhrase(rowWords.slice(idx, idx + n));
        const pattern = LABEL_PATTERNS.find(p => p.rx.test(phrase));
        if (pattern) return { pattern, n, phrase };
    }
    return null;
}

// Catchment-area value extraction.
//
// Algorithm:
//   1. Scan every row for labels (same row scanner as before).
//   2. For each label detected, record its (x, y, width, endX) + which label
//      key it matched.
//   3. Sort labels top-to-bottom.
//   4. For each label, build a CATCHMENT RECTANGLE:
//      • y-top    = midway between this label's y and the PREVIOUS label's y
//      • y-bottom = midway between this label's y and the NEXT label's y
//      • x-left   = label's right edge (+ small padding)
//      • x-right  = right edge of the enclosing zone (or far-right page)
//      If no prev/next label in a direction, fall back to zone bounds.
//   5. Collect all zone words inside the catchment rectangle, EXCLUDING any
//      word that is itself part of another label.
//   6. Concatenate in reading order → value.
//
// This replaces the earlier same-row-only logic which failed when Vision
// placed a multi-word handwritten value like "Mrs Cyans Howe" on three
// different y-rows (~40px apart each).
function extractFieldsFromZone(zoneWords, debug = false) {
    const fields = {};
    const debugLog = [];
    if (!zoneWords.length) return debug ? { __debug: debugLog } : fields;

    const rows = groupIntoRows(zoneWords, 10);

    // ── Phase 1: find every label occurrence with its spatial footprint ──
    // Track which word indices are consumed by a label so Phase 3 doesn't
    // accidentally pull label text into a value.
    const labelOccurrences = []; // { pattern, x, y, xR, wordRefs:Set<word> }
    for (const row of rows) {
        let idx = 0;
        while (idx < row.words.length) {
            const hit = matchLabelAt(row.words, idx);
            if (!hit) { idx++; continue; }
            const labelWords = row.words.slice(idx, idx + hit.n);
            labelOccurrences.push({
                pattern: hit.pattern,
                phrase: hit.phrase,
                x: labelWords[0].x,
                y: row.mid,
                xR: labelWords[labelWords.length - 1].xR,
                wordRefs: new Set(labelWords),
            });
            idx += hit.n;
        }
    }

    if (!labelOccurrences.length) return debug ? { __debug: debugLog } : fields;

    // Sort labels top-to-bottom; on same y, left-to-right
    const sorted = [...labelOccurrences].sort((a, b) => (a.y - b.y) || (a.x - b.x));

    // Zone bounds for fallback
    const ys = zoneWords.map(w => w.y + (w.yB - w.y) / 2);
    const xs = zoneWords.map(w => w.x);
    const xRs = zoneWords.map(w => w.xR);
    const zoneTop = Math.min(...ys) - 20;
    const zoneBottom = Math.max(...ys) + 40;
    const zoneRight = Math.max(...xRs) + 10;

    // Set of all words that are part of SOME label, so we never re-include them
    const labelWordSet = new Set();
    for (const lo of labelOccurrences) for (const w of lo.wordRefs) labelWordSet.add(w);

    // ── Phase 2 + 3: catchment and value extraction ──
    for (let i = 0; i < sorted.length; i++) {
        const lo = sorted[i];

        // Find previous label (in sorted order, with y strictly less)
        const prev = [...sorted.slice(0, i)].reverse().find(p => p.y < lo.y - 2);
        // Find next label (y strictly greater)
        const next = sorted.slice(i + 1).find(p => p.y > lo.y + 2);

        // Catchment: strict midpoint bisection between neighboring labels
        // PLUS a nearest-label tiebreak for words near the boundary so no
        // word gets assigned to two labels.
        //
        // Prior version used Y_BUFFER=12 on BOTH sides of each midpoint,
        // producing a 24-px overlap zone where words appeared in two
        // adjacent labels' catchments — observed in Charleston Roll 21
        // acct-100 where "Mrs Cyane Howe" ended up in both `children`
        // (her daughters listed above) and `last_master` (the actual
        // enslaver name one line below). That's the same handwriting
        // blob clearly below "children" and clearly adjacent to
        // "last_master", but the buffer put it inside both windows.
        const yTop    = prev ? (prev.y + lo.y) / 2 : zoneTop;
        const yBottom = next ? (lo.y + next.y) / 2 : zoneBottom;
        const xLeft   = lo.xR + 2;
        const xRight  = zoneRight;

        const inCatchment = zoneWords.filter(w => {
            if (labelWordSet.has(w)) return false;
            const wy = (w.y + w.yB) / 2;
            const wxMid = (w.x + w.xR) / 2;
            if (wxMid < xLeft || wxMid > xRight) return false;
            // Nearest-label assignment: the word's midpoint must be at least
            // as close to THIS label's y as to any other label's y. This
            // replaces the symmetrical-buffer approach — words near a
            // boundary go to exactly one label.
            const dThis = Math.abs(wy - lo.y);
            const dPrev = prev ? Math.abs(wy - prev.y) : Infinity;
            const dNext = next ? Math.abs(wy - next.y) : Infinity;
            if (dPrev < dThis || dNext < dThis) return false;
            return wy >= yTop && wy <= yBottom;
        });

        // Sort catchment words in reading order
        inCatchment.sort((a, b) => {
            const aMid = (a.y + a.yB) / 2;
            const bMid = (b.y + b.yB) / 2;
            if (Math.abs(aMid - bMid) > 10) return aMid - bMid;
            return a.x - b.x;
        });

        const value = inCatchment
            .map(w => w.text).join(' ')
            .replace(/\s+([.,:;])/g, '$1')
            .replace(/^[.,:;\s]+/, '')
            .trim();

        if (debug) debugLog.push({
            y: Math.round(lo.y),
            label: lo.pattern.key,
            phrase: lo.phrase,
            value: value.slice(0, 120),
            catchment_words: inCatchment.length,
            already_set: !!fields[lo.pattern.key],
        });

        // First occurrence wins (top-of-zone wins for repeated labels)
        if (value && !fields[lo.pattern.key]) fields[lo.pattern.key] = value;
    }

    if (debug) fields.__debug = debugLog;
    return fields;
}

// ── Extract image number from Vision's text header ("Image 705 of 1,118") ──
function extractImageNumber(fullTextAnnotation) {
    const text = fullTextAnnotation?.text || '';
    const m = text.match(/Image\s+(\d+)\s+of\s+[\d,]+/i);
    return m ? parseInt(m[1]) : null;
}

// ── S3 archive helper ──────────────────────────────────────────────────────
async function archiveToS3(key, data, contentType) {
    if (DRY_RUN || !s3Service?.isEnabled()) return null;
    try {
        const body = typeof data === 'string' ? Buffer.from(data) : data;
        const result = await s3Service.upload(key, body, contentType);
        return result.key;
    } catch (err) {
        console.error(`  S3 archive failed: ${err.message}`);
        return null;
    }
}

// ── Zoom the FS image viewer so the ledger fills the viewport ──────────────
//
// Each time puppeteer revisits an image URL the viewer can restore to a
// previous zoom state (often a tiny fit-to-window that leaves the ledger at
// ~20% of viewport height — OCR quality tanks). We unconditionally drive the
// viewer to maximum zoom before screenshotting. We try several tactics:
//   1. Close any side panel so the image gets full width.
//   2. Click the "Zoom In" button if we can find it.
//   3. Fire '+' and '=' keyboard events (common viewer shortcuts).
// All tactics are best-effort — whichever one works, works.
async function zoomInFsViewer(page, presses = 3) {
    // Wait for the viewer to render its control chrome before doing anything
    try {
        await page.waitForSelector('button[aria-label="Zoom In"]', { timeout: 15000 });
    } catch (_) {
        console.log('    (Zoom In button never appeared — falling back to keyboard)');
    }

    // Close the right-hand Names/indexing panel so the ledger gets full width.
    // FS renders multiple buttons with aria-label="Close" (tooltips, dialogs);
    // the one we want has the `tuckInIcon` class on its element tree. Fall
    // back to clicking any visible Close button whose position is in the right
    // quarter of the viewport.
    await page.evaluate(() => {
        const closes = [...document.querySelectorAll('button[aria-label="Close"], [role="button"][aria-label="Close"]')]
            .filter(el => el.offsetParent !== null);
        for (const el of closes) {
            const rect = el.getBoundingClientRect();
            const isPanelClose = (el.className || '').toString().includes('tuckIn') ||
                                 rect.left > window.innerWidth * 0.6;
            if (isPanelClose) el.click();
        }
    });
    await new Promise(r => setTimeout(r, 800));

    // Zoom in. 3 clicks is the sweet spot on a 2400×1800 viewport — enough
    // that the ledger fills the vertical space, but before text goes blurry.
    // (10 clicks made text huge but blurry; 0 clicks left the ledger tiny.)
    let clicks = 0;
    for (let i = 0; i < presses; i++) {
        const ok = await page.evaluate(() => {
            const btn = document.querySelector('button[aria-label="Zoom In"]');
            if (!btn) return false;
            btn.focus();
            btn.click();
            return true;
        });
        if (ok) clicks++;
        else await page.keyboard.press('+');
        await new Promise(r => setTimeout(r, 400));
    }
    // Settle
    await new Promise(r => setTimeout(r, 2000));
    return clicks;
}

// ── Core: process ONE ledger page, return { skip, imageNum, records } ──────
// records is an array of { acct, fields } — one entry per detected record.
async function ocrAndParsePage(page, imageUrl, localDir, tag) {
    const cachedVisionPath = localDir && tag ? path.join(localDir, `${tag}-vision.json`) : null;
    let annotation, screenshot;

    if (REUSE_OCR && cachedVisionPath && fs.existsSync(cachedVisionPath)) {
        annotation = JSON.parse(fs.readFileSync(cachedVisionPath, 'utf8'));
        stats.cacheHits++;
    } else {
        // Strip FS's `view=index` query param — when present, FS auto-opens
        // the right-hand indexing panel on page load, which shrinks the image
        // to ~15% of viewport. Without the param the image gets full width.
        const cleanImageUrl = imageUrl.replace(/([?&])view=index(&|$)/, (m, a, b) => b ? a : '');

        await page.setViewport({ width: 2800, height: 1700 });
        await page.goto(cleanImageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 8000));
        // Zero zoom clicks — rely on the viewer's fit-to-window default.
        // Earlier zoom-in attempts over-scaled past native resolution → blurry.
        await zoomInFsViewer(page, 0);

        screenshot = await page.screenshot({ encoding: 'binary' });
        stats.pagesOcrd++;

        // ── Document AI path ───────────────────────────────────────────
        // When USE_DOCUMENT_AI=true, route through the deployed
        // Freedmans_Bank_Deposit_Reader Custom Extractor instead of Vision +
        // spatial parser. Returns records[] in the same shape the spatial
        // parser produces so downstream depositor matching is unchanged.
        if (USE_DOCUMENT_AI) {
            try {
                const result = await docAiExtractor.extractFromImage(screenshot);
                const records = result.records;
                stats.recordsParsed += records.length;

                // Persist artifacts for canary inspection (local + S3)
                if (localDir) {
                    fs.mkdirSync(localDir, { recursive: true });
                    const outTag = tag || `image-docai-${Date.now()}`;
                    const branchSlug = path.basename(localDir);
                    fs.writeFileSync(path.join(localDir, `${outTag}.png`), screenshot);
                    const docaiJson = JSON.stringify({ records, raw: result.raw }, null, 2);
                    fs.writeFileSync(path.join(localDir, `${outTag}-docai.json`), docaiJson);
                    // S3 mirror — silent no-op when S3 disabled or auth fails
                    await archiveToS3(`freedmens-bank/${branchSlug}/${outTag}.png`, screenshot, 'image/png');
                    await archiveToS3(`freedmens-bank/${branchSlug}/${outTag}-docai.json`, docaiJson, 'application/json');
                }

                const docaiBranchSlug = localDir ? path.basename(localDir) : null;
                const docaiOutTag = tag || `image-docai-${Date.now()}`;
                const docaiS3Key = docaiBranchSlug ? `freedmens-bank/${docaiBranchSlug}/${docaiOutTag}.png` : null;
                return {
                    skip: false,
                    imageNum: null,
                    records,
                    screenshot,
                    _source: 'document_ai',
                    _image_s3_key: docaiS3Key,
                    _branch_slug: docaiBranchSlug,
                };
            } catch (e) {
                console.log(`  ⚠ Document AI failed: ${e.message} — falling back to Vision+spatial parser`);
                // Fall through to Vision path below; helps during canary so a
                // single Document AI outage doesn't kill the run.
            }
        }

        annotation = await ocrImageFull(screenshot);
        if (!annotation) return { skip: true, reason: 'no_ocr' };

        // Cache annotation so --reuse-ocr can iterate the parser later.
        if (cachedVisionPath) {
            fs.mkdirSync(path.dirname(cachedVisionPath), { recursive: true });
            fs.writeFileSync(cachedVisionPath, JSON.stringify(annotation));
        }
    }

    const imageNum = extractImageNumber(annotation);
    if (imageNum && imageNum > MAX_IMAGE) {
        stats.skippedPastCutoff++;
        return { skip: true, imageNum, reason: 'past_cutoff' };
    }

    const allWords = extractWords(annotation);
    const words = filterToLedger(allWords);
    const anchors = findRecordAnchors(words);
    const zones = assignToZones(words, anchors);

    const records = [];
    for (const [key, zone] of zones) {
        const fields = extractFieldsFromZone(zone.words, true);
        records.push({
            acct: zone.anchor.acct,                           // numeric or null
            headerName: fields.record_header_name || null,    // for name-based matching
            fields,
            anchor: zone.anchor,
        });
        stats.recordsParsed++;
    }

    // Save artifacts for debugging — include row-grouped word positions so
    // we can spot-check whether labels and values are actually on the same y.
    // Also mirror to S3 (silent no-op if S3 disabled / auth fails) so the
    // source ledger images survive Mac Mini disk failure.
    let visionImageS3Key = null;
    let visionBranchSlug = null;
    if (localDir) {
        fs.mkdirSync(localDir, { recursive: true });
        const outTag = tag || `image-${imageNum || 'unk'}`;
        const branchSlug = path.basename(localDir);
        visionBranchSlug = branchSlug;
        if (screenshot) {
            fs.writeFileSync(path.join(localDir, `${outTag}.png`), screenshot);
            await archiveToS3(`freedmens-bank/${branchSlug}/${outTag}.png`, screenshot, 'image/png');
            visionImageS3Key = `freedmens-bank/${branchSlug}/${outTag}.png`;
        }
        const ocrText = annotation.text || '';
        fs.writeFileSync(path.join(localDir, `${outTag}-ocr.txt`), ocrText);
        await archiveToS3(`freedmens-bank/${branchSlug}/${outTag}-ocr.txt`, ocrText, 'text/plain');

        const rowsDump = groupIntoRows(words, 12).map(r => ({
            y: Math.round(r.mid),
            words: r.words.map(w => `${w.text}@(${w.x},${w.y},${w.xR - w.x}×${w.h})`),
        }));
        const parsedJson = JSON.stringify({ imageNum, anchors, records, rows: rowsDump }, null, 2);
        fs.writeFileSync(path.join(localDir, `${outTag}-parsed.json`), parsedJson);
        await archiveToS3(`freedmens-bank/${branchSlug}/${outTag}-parsed.json`, parsedJson, 'application/json');
    }

    return {
        skip: false,
        imageNum,
        records,
        screenshot,
        annotation,
        _source: 'google_vision_spatial_parser_v2',
        _image_s3_key: visionImageS3Key,
        _branch_slug: visionBranchSlug,
    };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
    if (!BRANCH) {
        console.error('Usage: node scripts/extract-freedmens-fields.js --branch "Branch Name" [--limit N] [--dry-run] [--max-image N] [--acct-max N]');
        process.exit(1);
    }
    if (!GOOGLE_VISION_API_KEY) {
        console.error('GOOGLE_VISION_API_KEY not set in .env');
        process.exit(1);
    }

    console.log('\n' + '═'.repeat(64));
    console.log(`  FREEDMEN'S BANK — ENSLAVER FIELD EXTRACTION (${USE_DOCUMENT_AI ? 'Document AI' : 'Google Vision'})`);
    console.log(`  Branch:     ${BRANCH}`);
    console.log(`  Mode:       ${DRY_RUN ? 'DRY RUN (no DB/S3 writes)' : 'LIVE'}`);
    if (USE_DOCUMENT_AI) console.log(`  OCR engine: Document AI Custom Extractor (${docAiExtractor.DEFAULT_PROCESSOR_PATH.split('/').pop()})`);
    console.log(`  Max image:  ${MAX_IMAGE}`);
    console.log(`  Max acct#:  ${ACCT_MAX}`);
    console.log('═'.repeat(64) + '\n');

    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
    const pages = await browser.pages();
    let page = pages.find(p => /familysearch\.org/.test(p.url()));
    if (!page) page = await browser.newPage();

    const branchLocation = BRANCH.split(' — ')[0];
    const rollLabel = BRANCH.includes(' — ') ? BRANCH.split(' — ').pop() : null;

    const rows = await sql`
        SELECT lead_id, full_name, source_url, relationships, context_text,
               NULLIF((regexp_match(context_text, 'account #([0-9]+)'))[1], '')::int AS acct
        FROM unconfirmed_persons
        WHERE extraction_method IN ('freedmens_bank_index', 'freedmens_bank_ocr')
          AND ${branchLocation} = ANY(locations)
          ${rollLabel ? sql`AND context_text LIKE ${'%' + rollLabel + '%'}` : sql``}
          AND source_url LIKE '%ark:/61903/1:1:%'
          AND (review_notes IS NULL OR NOT (review_notes::text LIKE '%ledger_extraction%'))
        ${RANDOM_SAMPLE ? sql`ORDER BY RANDOM()` : sql`ORDER BY lead_id`}
        LIMIT ${RANDOM_SAMPLE ? 50 : 5000}
    `;
    // In random-sample mode, take any depositor regardless of account number;
    // the point is to probe arbitrary pages across the branch.
    const depositors = RANDOM_SAMPLE
        ? rows
        : rows.filter(r => r.acct !== null && r.acct <= ACCT_MAX);
    const filterLabel = RANDOM_SAMPLE ? 'random sample' : `account # ≤ ${ACCT_MAX}`;
    console.log(`  ${depositors.length} depositors in scope (${filterLabel}), from ${rows.length} total in branch\n`);

    // origLink → { records, imageNum } cache so multiple depositors sharing a
    // page only trigger one OCR call.
    const pageCache = new Map();
    let ocrCalls = 0;
    const localDir = path.resolve(__dirname, `../debug/freedmens-bank/enslaver-test/${branchLocation.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${(rollLabel || 'roll').toLowerCase().replace(/ /g,'-')}`);

    // Retry-aware page navigation. Both Tallahassee (Apr 28, 5h 37m) and
    // Huntsville (Apr 28, 5 min) crashed at this exact navigate→evaluate
    // step from "Attempted to use detached Frame" / "net::ERR_ABORTED"
    // errors — Chrome/Puppeteer state corruption after macOS sleep events
    // or rapid navigations. One per-depositor failure used to abort the
    // whole branch.
    //
    // Strategy: on transient errors (detached frame, ERR_ABORTED,
    // navigation timeout, Target closed), retry up to 3 times. If the
    // current page is unusable, close it and open a fresh one from the
    // existing browser. After all retries fail, skip the depositor and
    // continue the branch.
    const isTransientPuppeteerError = (err) => {
        const m = (err?.message || '').toLowerCase();
        return m.includes('detached frame') ||
               m.includes('err_aborted') ||
               m.includes('navigation timeout') ||
               m.includes('target closed') ||
               m.includes('execution context was destroyed') ||
               m.includes('net::err_') ||
               m.includes('frame got detached');
    };
    async function fetchOrigLink(detailUrl, depLabel) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await new Promise(r => setTimeout(r, 4000));

                // Detect catastrophic page states BEFORE looking for the link.
                // Without these checks, login-redirect and rate-limit pages
                // silently return null and the caller can't tell the difference
                // from "depositor genuinely has no original-document link" —
                // and we burn through every depositor in the branch before
                // anyone notices. (This actually happened on 2026-04-30.)
                const pageState = await page.evaluate(() => {
                    const url = location.href;
                    const bodyText = (document.body?.innerText || '').slice(0, 4000).toLowerCase();
                    const links = [...document.querySelectorAll('a')];
                    const orig = links.find(a => /original|document/i.test(a.innerText || ''));
                    return {
                        url,
                        loggedOut: url.includes('ident.familysearch.org/identity/login') || url.includes('/identity/login'),
                        rateLimited:
                            /too\s+many\s+requests|rate\s+limit|please\s+try\s+again\s+later|temporarily\s+unavailable|usage\s+limit\s+exceeded/.test(bodyText)
                            || /\/(rate-limit|throttled|429)/.test(url),
                        origLinkHref: orig ? orig.href : null,
                    };
                });

                if (pageState.loggedOut) {
                    const e = new Error('SESSION_EXPIRED: redirected to FS login');
                    e.code = 'SESSION_EXPIRED';
                    throw e;
                }
                if (pageState.rateLimited) {
                    const e = new Error('RATE_LIMITED: FS rate-limit page detected');
                    e.code = 'RATE_LIMITED';
                    throw e;
                }
                return pageState.origLinkHref;
            } catch (err) {
                // Hard-stop conditions bubble up immediately; don't retry these.
                if (err.code === 'SESSION_EXPIRED' || err.code === 'RATE_LIMITED') throw err;
                if (!isTransientPuppeteerError(err) || attempt === 3) throw err;
                console.log(`    ⚠ ${depLabel}: ${err.message.split('\n')[0]} — retry ${attempt}/3 with fresh page`);
                stats.errors++;
                try { await page.close(); } catch (_) {}
                page = await browser.newPage();
                await new Promise(r => setTimeout(r, 5000 * attempt));
            }
        }
    }

    // Track consecutive "no original-document link" failures so we can abort
    // the whole branch if we see a sustained pattern (signal that something
    // is systemically wrong — login expired silently, FS HTML changed,
    // browser session lost, etc.) instead of churning through 1,675
    // depositors logging the same misleading message.
    let consecutiveLinkMissing = 0;
    const ABORT_AFTER_CONSECUTIVE_MISSING = 25;

    for (const dep of depositors) {
        if (LIMIT && ocrCalls >= LIMIT) break;

        // When --reuse-ocr, skip the detail-page round trip — we're going to
        // load the Vision response from disk and never touch Chrome.
        let origLink;
        if (REUSE_OCR) {
            origLink = `cached://acct-${dep.acct}`;
        } else {
            const detailUrl = `${dep.source_url}?lang=en`;
            try {
                origLink = await fetchOrigLink(detailUrl, `${dep.full_name} (acct ${dep.acct})`);
            } catch (err) {
                if (err.code === 'SESSION_EXPIRED') {
                    console.log(`  ✗ ABORTING BRANCH: FS session expired (redirected to login). Re-login Chrome and restart.`);
                    stats.errors++;
                    process.exit(2);
                }
                if (err.code === 'RATE_LIMITED') {
                    console.log(`  ✗ ABORTING BRANCH: FS rate-limit detected. Wait at least 30 minutes before retrying.`);
                    stats.errors++;
                    process.exit(3);
                }
                console.log(`  ✗ ${dep.full_name} (acct ${dep.acct}) — gave up after 3 retries: ${err.message.split('\n')[0]}`);
                stats.errors++;
                continue;
            }
            if (!origLink) {
                console.log(`  ✗ ${dep.full_name} (acct ${dep.acct}) — no original-document link`);
                consecutiveLinkMissing++;
                if (consecutiveLinkMissing >= ABORT_AFTER_CONSECUTIVE_MISSING) {
                    console.log(`  ✗ ABORTING BRANCH: ${ABORT_AFTER_CONSECUTIVE_MISSING} consecutive depositors with no original-document link. Likely FS markup change or silent session issue — investigate before re-running.`);
                    process.exit(4);
                }
                continue;
            }
            consecutiveLinkMissing = 0;  // reset on success
        }

        let pageResult = pageCache.get(origLink);
        if (pageResult) {
            stats.cacheHits++;
        } else {
            // Tag uses account# when available, else lead_id. Shared page
            // depositors hit the same cache entry in acct mode.
            const tag = dep.acct != null ? `acct-${dep.acct}` : `lead-${dep.lead_id}`;
            console.log(`\n  OCR call #${ocrCalls + 1}: acct ${dep.acct} (${dep.full_name})${REUSE_OCR ? ' [reuse-ocr]' : ''}`);
            const fullResult = await ocrAndParsePage(page, origLink, localDir, tag);
            // Cache only the lightweight fields needed by downstream depositor
            // matching. screenshot (~2-5MB PNG buffer) and annotation (full
            // Vision response with every word box) are NOT consumed after this
            // point — retaining them in the Map leaks ~GB across long runs
            // (Huntsville Abort trap 6 at ~1,250 unique pages).
            //
            // We DO retain _image_s3_key, _branch_slug, and _source: those are
            // small strings (~80 bytes each) that downstream needs to write
            // person_documents audit rows. Earlier omission caused ~734 OCR
            // calls to extract data without a single person_documents insert
            // (caught live 2026-04-30).
            pageResult = {
                skip: fullResult.skip,
                reason: fullResult.reason,
                imageNum: fullResult.imageNum,
                records: fullResult.records,
                _image_s3_key: fullResult._image_s3_key || null,
                _branch_slug: fullResult._branch_slug || null,
                _source: fullResult._source || null,
            };
            pageCache.set(origLink, pageResult);
            ocrCalls++;
            if (!REUSE_OCR) await new Promise(r => setTimeout(r, 5000)); // rate-limit courtesy
        }

        if (pageResult.skip) {
            console.log(`    → skipped (${pageResult.reason}${pageResult.imageNum ? `, image ${pageResult.imageNum}` : ''})`);
            continue;
        }

        // Match record → depositor. Prefer account# (reliable when present).
        // Fall back to fuzzy name match against the "Record for" header —
        // Vision's OCR of handwritten names is noisy, so we require only a
        // couple of token overlaps to accept.
        const normalizeName = (s) => (s || '')
            .toLowerCase()
            .replace(/[.,:;'"()]/g, ' ')
            .split(/\s+/).filter(t => t.length >= 3);
        const nameMatch = (a, b) => {
            const ta = normalizeName(a), tb = normalizeName(b);
            if (!ta.length || !tb.length) return false;
            return ta.some(x => tb.some(y => x === y || (x.length >= 4 && (y.startsWith(x.slice(0, 4)) || x.startsWith(y.slice(0, 4))))));
        };

        // Four-tier match classification — cleaner than the earlier
        // "acct first, name fallback" that mis-attributed when FS's index
        // disagreed with its own ledger image (e.g. Charleston R23 acct 6627
        // indexed as "Prince Small et al" but the ledger image showed
        // "Williams Fuller"). We now distinguish the tiers explicitly and
        // only claim full confidence when acct# AND name both line up.
        const acctHit = pageResult.records.find(r => r.acct != null && r.acct === dep.acct);
        const nameHit = pageResult.records.find(r => nameMatch(r.headerName, dep.full_name));

        let match = null;
        let matchTier = null;   // 'acct_and_name' | 'name_only' | 'acct_only_name_mismatch' | null
        let matchConfidence = 0;
        if (acctHit && nameMatch(acctHit.headerName, dep.full_name)) {
            match = acctHit;
            matchTier = 'acct_and_name';
            matchConfidence = 0.95;
        } else if (nameHit) {
            match = nameHit;
            matchTier = 'name_only';
            matchConfidence = 0.80;
        } else if (acctHit) {
            // Account# matched but the extracted record's header name did not
            // share tokens with the DB depositor name. Likely an upstream FS
            // index ↔ ledger inconsistency. Still write, but flag for review.
            match = acctHit;
            matchTier = 'acct_only_name_mismatch';
            matchConfidence = 0.45;
        }

        if (!match) {
            const pageSummary = pageResult.records.map(r =>
                `${r.acct ?? '-'}${r.headerName ? `=${r.headerName.slice(0, 25)}` : ''}`
            ).join(', ');
            console.log(`    ✗ acct ${dep.acct} ("${dep.full_name}") not found on image ${pageResult.imageNum} (page records: ${pageSummary})`);
            continue;
        }

        stats.depositorsMatched++;
        const f = match.fields;
        const flag = [f.last_master, f.old_title, f.slave_residence].filter(Boolean).length ? ' ★' : '';
        const tierMark = matchTier === 'acct_only_name_mismatch' ? ' ⚠️' : '';
        console.log(`    ✓ acct ${dep.acct} (${dep.full_name}, image ${pageResult.imageNum}) [${matchTier} ${matchConfidence}]${flag}${tierMark}`);
        console.log(`      master="${f.last_master || ''}" mistress="${f.last_mistress || ''}" old_title="${f.old_title || ''}" slave_res="${f.slave_residence || ''}"`);
        console.log(`      residence="${f.residence || ''}" age="${f.age || ''}" complexion="${f.complexion || ''}" occupation="${f.occupation || ''}"`);

        if (DRY_RUN) continue;

        // ── DB writeback ────────────────────────────────────────────────
        const existing = typeof dep.relationships === 'string'
            ? JSON.parse(dep.relationships || '[]')
            : (dep.relationships || []);
        const rels = Array.isArray(existing) ? [...existing] : [];

        // Per-relationship confidence inherits the match tier's confidence
        // (capped at the field-level confidence floor).
        const relConfidence = Math.min(0.70, matchConfidence);

        if (f.last_master && f.last_master.toLowerCase() !== 'free' && f.last_master.length > 1) {
            rels.push({ type: 'enslaved_by', name: f.last_master, role: 'master', match_source: 'google_vision_ledger_extraction', confidence: relConfidence, match_tier: matchTier });
        }
        if (f.last_mistress && f.last_mistress.length > 1) {
            rels.push({ type: 'enslaved_by', name: f.last_mistress, role: 'mistress', match_source: 'google_vision_ledger_extraction', confidence: relConfidence, match_tier: matchTier });
        }
        // Employer (Mobile, Raleigh) promoted to enslaved_by at lower confidence.
        // In the 1867-1874 Freedmen's Bank era, "employer" frequently referred
        // to the former slaveholder continuing the labor relationship under a
        // contractual name (sharecropping, tenancy, convict-lease precursor).
        // Lower confidence than master/mistress because post-emancipation
        // employment was sometimes genuinely new; downstream MatchVerifier
        // can promote to full enslaver when cross-referenced against
        // 1860 slave schedules.
        if (f.employer && f.employer.length > 1 && f.employer.toLowerCase() !== 'none' && f.employer.toLowerCase() !== 'self') {
            rels.push({ type: 'enslaved_by', name: f.employer, role: 'employer_post_1865', match_source: 'google_vision_ledger_extraction', confidence: Math.max(0.40, relConfidence - 0.20), match_tier: matchTier, note: 'labor relationship recorded as "employer" on Freedmen\'s Bank form; may be former slaveholder — requires cross-ref to 1860 slave schedules' });
        }
        // Plantation is a place, but when the depositor was enslaved there
        // it identifies the site of enslavement. Kept as a non-person entry
        // for geographic cross-reference.
        if (f.plantation && f.plantation.length > 2 && !/^\d+$/.test(f.plantation)) {
            rels.push({ type: 'enslaved_at_location', name: f.plantation, match_source: 'google_vision_ledger_extraction', confidence: Math.max(0.40, relConfidence - 0.15), match_tier: matchTier });
        }
        if (f.old_title && f.old_title.length > 1) {
            rels.push({ type: 'enslaved_name', name: f.old_title, match_source: 'google_vision_ledger_extraction', match_tier: matchTier });
        }

        const requiresReview = matchTier === 'acct_only_name_mismatch';
        const extractionSource = pageResult._source || 'google_vision_spatial_parser_v2';
        await sql`
            UPDATE unconfirmed_persons
            SET relationships = ${JSON.stringify(rels)}::jsonb,
                review_notes = ${JSON.stringify({
                    ledger_extraction: f,
                    extraction_source: extractionSource,
                    image_num: pageResult.imageNum,
                    image_s3_key: pageResult._image_s3_key || null,
                    branch_slug: pageResult._branch_slug || null,
                    match_tier: matchTier,
                    match_confidence: matchConfidence,
                    requires_human_review: requiresReview,
                    review_reason: requiresReview ? `acct# ${dep.acct} matched but extracted header "${match.headerName || ''}" does not share tokens with DB depositor "${dep.full_name}" — likely FS index↔ledger inconsistency` : null,
                    extracted_at: new Date().toISOString(),
                })}::jsonb,
                updated_at = NOW()
            WHERE lead_id = ${dep.lead_id}
        `;
        stats.dbUpdates++;

        // ── Document-level audit row ────────────────────────────────────
        // Per memory-bank/plan-apr29 Stage 4 commitment: every extracted
        // record must have a person_documents row pointing to its source
        // image in S3. Without this, downstream readers can't verify claims
        // against the ledger image, can't re-extract under different OCR
        // engines, and can't audit the trail from field → primary source.
        //
        // Idempotency: skip if a person_documents row already exists for
        // this (unconfirmed_person_id, s3_key). Same depositor across
        // multiple ledger pages produces multiple rows (correct behavior).
        if (pageResult._image_s3_key) {
            try {
                const existsRows = await sql`
                    SELECT 1 FROM person_documents
                    WHERE unconfirmed_person_id = ${dep.lead_id}
                      AND s3_key = ${pageResult._image_s3_key}
                    LIMIT 1
                `;
                if (existsRows.length === 0) {
                    const ledgerSummary = [
                        f.last_master ? `master="${f.last_master}"` : null,
                        f.last_mistress ? `mistress="${f.last_mistress}"` : null,
                        f.plantation ? `plantation="${f.plantation}"` : null,
                        f.old_title ? `old_title="${f.old_title}"` : null,
                        f.residence ? `residence="${f.residence}"` : null,
                    ].filter(Boolean).join('; ').slice(0, 500);

                    const s3Bucket = process.env.S3_BUCKET || 'reparations-them';
                    const s3Url = `s3://${s3Bucket}/${pageResult._image_s3_key}`;

                    await sql`
                        INSERT INTO person_documents (
                            unconfirmed_person_id,
                            name_as_appears,
                            s3_url,
                            s3_key,
                            source_url,
                            source_type,
                            collection_name,
                            image_number,
                            page_reference,
                            ocr_text,
                            context_snippet,
                            person_type,
                            document_type,
                            extraction_confidence,
                            created_at,
                            created_by
                        ) VALUES (
                            ${dep.lead_id},
                            ${match.headerName || dep.full_name || null},
                            ${s3Url},
                            ${pageResult._image_s3_key},
                            ${dep.source_url || null},
                            ${'freedmens_bank'},
                            ${pageResult._branch_slug || null},
                            ${pageResult.imageNum || null},
                            ${`acct ${dep.acct}, image ${pageResult.imageNum}`},
                            ${JSON.stringify(f).slice(0, 8000)},
                            ${ledgerSummary || null},
                            ${'depositor'},
                            ${'freedmens_bank_ledger'},
                            ${matchConfidence},
                            NOW(),
                            ${`freedmens-extract-${extractionSource}`}
                        )
                    `;
                    stats.documentsCreated = (stats.documentsCreated || 0) + 1;
                }
            } catch (e) {
                // Log but don't fail the depositor match; person_documents
                // is an audit-trail concern, not business logic.
                console.log(`      ⚠ person_documents insert failed for lead_id=${dep.lead_id}: ${e.message.slice(0, 100)}`);
            }
        }
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
    console.log('\n' + '═'.repeat(64));
    console.log('  COMPLETE');
    console.log('═'.repeat(64));
    console.log(`  Pages OCRd:          ${stats.pagesOcrd}`);
    console.log(`  Records parsed:      ${stats.recordsParsed}`);
    console.log(`  Depositors matched:  ${stats.depositorsMatched}`);
    console.log(`  Cache hits:          ${stats.cacheHits}`);
    console.log(`  Skipped past cutoff: ${stats.skippedPastCutoff}`);
    console.log(`  DB updates:          ${stats.dbUpdates}`);
    console.log(`  person_documents:    ${stats.documentsCreated || 0}`);
    console.log(`  Errors:              ${stats.errors}`);
    console.log(`  Elapsed:             ${elapsed} min`);
    console.log(`  Artifacts:           ${localDir}\n`);

    try { await browser.disconnect(); } catch (_) {}
}

main().then(() => process.exit(0)).catch(err => { console.error('Fatal:', err.stack || err.message); process.exit(1); });
