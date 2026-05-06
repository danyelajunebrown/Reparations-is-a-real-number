#!/usr/bin/env node
/**
 * enrich-freedmens-docai.js
 *
 * Document AI enrichment pass for Freedmen's Bank indexed records.
 *
 * For every unconfirmed_persons row written by scrape-freedmens-bank-indexed.js
 * this script:
 *   1. Navigates Chrome to the record's FamilySearch ARK URL (the handwritten ledger page)
 *   2. Screenshots the viewer at full width so the ledger form is clearly visible
 *   3. Sends the screenshot to the freedmens-bank-ledger-v1 Document AI Custom Extractor
 *   4. Parses the 31-field entity response (last_master, plantation, old_title, etc.)
 *   5. Upserts extracted fields into unconfirmed_persons.relationships JSONB
 *   6. Archives the screenshot to S3 at freedmens-bank/{branch-slug}/docai/{id}.png
 *   7. On low-confidence or no critical fields → inserts into parse_failure_queue (migration 044)
 *
 * Prerequisites (Mac Mini):
 *   • Chrome running:  open -na "Google Chrome" --args --remote-debugging-port=9222 \
 *                        --user-data-dir=/tmp/familysearch-ancestor-climber
 *   • Signed into FamilySearch manually in that Chrome window
 *   • .env: DATABASE_URL, GCP_PROJECT_ID, DOCUMENT_AI_PROCESSOR_ID,
 *            GOOGLE_APPLICATION_CREDENTIALS, S3_BUCKET, S3_REGION
 *   • npm packages already installed: puppeteer-core, @neondatabase/serverless,
 *            @google-cloud/documentai, @aws-sdk/client-s3
 *
 * ⚠️  Do NOT run concurrently with scrape-freedmens-bank-indexed.js or the 1860
 *     slave schedule scraper — all three share the same Chrome/FamilySearch session.
 *
 * Usage:
 *   node scripts/enrich-freedmens-docai.js                          # all un-enriched
 *   node scripts/enrich-freedmens-docai.js --branch "Richmond, Virginia"
 *   node scripts/enrich-freedmens-docai.js --limit 100              # first 100 records
 *   node scripts/enrich-freedmens-docai.js --dry-run                # no DB/S3 writes
 *   node scripts/enrich-freedmens-docai.js --reprocess              # re-enrich done records
 *   node scripts/enrich-freedmens-docai.js --start-id 50000         # resume from row id
 *
 * Resumable: records with 'docai_enrichment' in review_notes are skipped by default.
 * Re-run is fully idempotent — DB writes use UPDATE with no-harm-done semantics.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const puppeteer = require('puppeteer-core');
const { neon }  = require('@neondatabase/serverless');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs   = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt  = (name, def = null) => {
    const i = argv.indexOf(name);
    return (i !== -1 && argv[i + 1]) ? argv[i + 1] : def;
};

const BRANCH_FILTER   = opt('--branch');
const LIMIT           = parseInt(opt('--limit', '0')) || 0;
const START_ID        = parseInt(opt('--start-id', '0')) || 0;
const DRY_RUN         = flag('--dry-run');
const REPROCESS       = flag('--reprocess');
const DEBUG_PORT      = parseInt(opt('--port', '9222'));
const MIN_CONFIDENCE  = parseFloat(opt('--min-confidence', '0.40'));

// ── Env validation ────────────────────────────────────────────────────────────
['DATABASE_URL', 'GCP_PROJECT_ID', 'DOCUMENT_AI_PROCESSOR_ID'].forEach(k => {
    if (!process.env[k]) { console.error(`FATAL: ${k} not set in .env`); process.exit(1); }
});

const PROJECT_ID     = process.env.GCP_PROJECT_ID;
const PROCESSOR_ID   = process.env.DOCUMENT_AI_PROCESSOR_ID;
const PROCESSOR_NAME = `projects/${PROJECT_ID}/locations/us/processors/${PROCESSOR_ID}`;
const S3_BUCKET      = process.env.S3_BUCKET   || null;
const S3_REGION      = process.env.S3_REGION   || 'us-east-2';

// ── Clients ───────────────────────────────────────────────────────────────────
const sql = neon(process.env.DATABASE_URL);

// Regional endpoint is required — global returns PERMISSION_DENIED for us-region processors
const docAiClient = new DocumentProcessorServiceClient({
    apiEndpoint: 'us-documentai.googleapis.com',
});

const s3 = S3_BUCKET ? new S3Client({ region: S3_REGION }) : null;

// ── 31-field entity names (must match the schema in define-docai-schema-freedmens.mjs) ──
const ENTITY_FIELDS = [
    // Account identity
    'account_number', 'date_of_entry',
    // Depositor biographical
    'depositor_name', 'birthplace', 'where_brought_up', 'age', 'residence',
    'complexion', 'occupation', 'employer',
    // Family
    'marital_status', 'spouse_name', 'spouse_residence', 'father_name',
    'mother_name', 'siblings_names', 'children_names', 'family_residences',
    'spouse_father', 'spouse_mother', 'spouse_siblings',
    // Enslavement record (the critical ones)
    'last_master', 'last_mistress', 'plantation', 'slave_residence', 'old_title',
    // Civil War / post-emancipation
    'union_lines', 'post_emancipation',
    // Signature + misc
    'signature', 'further_facts', 'remarks',
];

// Multi-value fields (OPTIONAL_MULTIPLE in schema)
const MULTI_FIELDS = new Set(['siblings_names', 'children_names', 'spouse_siblings']);

// If ALL of these are empty → queue for human review
const CRITICAL_FIELDS = ['last_master', 'last_mistress', 'old_title', 'plantation'];

// ── Fetch un-enriched records ─────────────────────────────────────────────────
async function fetchRecords() {
    const conditions = [];
    const params = [];

    conditions.push(`extraction_method = 'freedmens_bank_index'`);
    conditions.push(`source_url IS NOT NULL`);
    conditions.push(`source_url LIKE '%familysearch.org%'`);

    if (!REPROCESS) {
        conditions.push(`(review_notes IS NULL OR review_notes NOT LIKE '%docai_enrichment%')`);
    }

    if (BRANCH_FILTER) {
        params.push(BRANCH_FILTER);
        conditions.push(`locations @> ARRAY[$${params.length}]::text[]`);
    }

    if (START_ID > 0) {
        params.push(START_ID);
        conditions.push(`id >= $${params.length}`);
    }

    const where    = conditions.join(' AND ');
    const limitSql = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
    const query    = `SELECT id, full_name, source_url, locations, relationships
                      FROM unconfirmed_persons
                      WHERE ${where}
                      ORDER BY id
                      ${limitSql}`;

    const result = await sql.query(query, params);
    return result.rows;
}

// ── Navigate to ARK URL + screenshot the ledger image ────────────────────────
async function screenshotLedger(page, arkUrl) {
    // Strip any query string — FS ARK bare URL opens the image viewer directly
    const cleanUrl = arkUrl.split('?')[0];

    // Blank-page flush forces FS SPA to do a clean mount on the new ARK
    await page.goto('about:blank', { waitUntil: 'load', timeout: 10_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 400));

    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // Wait for the image canvas or viewer element
    await Promise.race([
        page.waitForSelector('canvas', { timeout: 15_000 }),
        page.waitForSelector('[class*="image-viewer"]', { timeout: 15_000 }),
        page.waitForSelector('img[src*="familysearch"]', { timeout: 15_000 }),
        new Promise(r => setTimeout(r, 8_000)),   // fallback: just wait
    ]).catch(() => {});

    // Extra settle for React hydration + image decode
    await new Promise(r => setTimeout(r, 2_500));

    // Close the index panel if it opened automatically (we want max image area)
    await page.evaluate(() => {
        const closeBtn = document.querySelector('[aria-label="Close"], [class*="close-panel"], [class*="panel-close"]');
        if (closeBtn) closeBtn.click();
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 500));

    const buf = await page.screenshot({ type: 'png', encoding: 'binary' });
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'binary');
}

// ── Call Document AI ──────────────────────────────────────────────────────────
async function callDocAI(imageBuffer) {
    const [result] = await docAiClient.processDocument({
        name: PROCESSOR_NAME,
        rawDocument: {
            content: imageBuffer.toString('base64'),
            mimeType:  'image/png',
        },
    });
    return result.document;
}

// ── Parse entity array → structured field map ─────────────────────────────────
function parseEntities(document) {
    const fields      = {};  // field_name → { text, confidence } or [...]
    const rawEntities = [];  // full list for audit/training

    for (const entity of (document?.entities || [])) {
        const type       = entity.type || '';
        const text       = (entity.mentionText || '').trim();
        const confidence = typeof entity.confidence === 'number' ? entity.confidence : 0;

        rawEntities.push({ type, text, confidence });

        if (!ENTITY_FIELDS.includes(type) || !text) continue;

        if (MULTI_FIELDS.has(type)) {
            if (!fields[type]) fields[type] = [];
            fields[type].push({ text, confidence });
        } else {
            // Keep the highest-confidence extraction if Doc AI returns duplicates
            if (!fields[type] || confidence > fields[type].confidence) {
                fields[type] = { text, confidence };
            }
        }
    }

    // Aggregate confidence across all entities
    const avgConf = rawEntities.length
        ? rawEntities.reduce((s, e) => s + e.confidence, 0) / rawEntities.length
        : 0;

    return { fields, rawEntities, avgConf };
}

// ── False-positive validator ───────────────────────────────────────────────────
// Catches all known classes of DocAI hallucination / misread on Freedmens ledger pages.
// Returns { cleaned, warnings, rejectedFields } — cleaned has FP values nulled out,
// warnings is an array of human-readable explanations for the review queue.

const FP_JUNK_EXACT = new Set([
    'unknown', 'none', 'freed', 'free', 'same', 'above', 'n/a', 'na', 'deceased',
    'dead', 'not given', 'not stated', "don't know", 'do not know', 'not known',
    'himself', 'herself', 'themselves', 'self', 'himself/herself',
    '-', '--', '---', '?', '??', 'x', 'xx', 'xxx', '0', '00',
]);

// Substrings that almost certainly mean the OCR grabbed a page/column header
const FP_HEADER_SUBSTRINGS = [
    'savings and trust', 'freedmen', 'last master or mistress',
    'plantation where', 'residence of', 'where brought up',
    'name of last', 'name of father', 'name of mother',
    'further facts', 'signature of depositor', 'date of entry',
    'remarks', 'branch at', 'account no', 'account number',
];

// Known city/state names that appear as branch locations — should never be
// an enslaver name. Expand as new branches are scraped.
const FP_CITY_NAMES = new Set([
    'atlanta', 'augusta', 'baltimore', 'columbus', 'huntsville',
    'lexington', 'little rock', 'louisville', 'lynchburg', 'memphis',
    'mobile', 'nashville', 'natchez', 'new bern', 'new orleans',
    'new york', 'norfolk', 'philadelphia', 'raleigh', 'richmond',
    'savannah', 'shreveport', 'st. louis', 'saint louis', 'tallahassee',
    'vicksburg', 'washington', 'washington d.c.', 'wilmington',
    'georgia', 'maryland', 'mississippi', 'alabama', 'kentucky',
    'arkansas', 'virginia', 'tennessee', 'north carolina', 'louisiana',
    'new york', 'pennsylvania', 'florida', 'missouri', 'south carolina',
    'district of columbia',
]);

// Fields where the value should look like a human name
const NAME_FIELDS = new Set([
    'last_master', 'last_mistress', 'depositor_name',
    'father_name', 'mother_name', 'spouse_name',
    'spouse_father', 'spouse_mother',
]);

// Enslaver-specific fields (extra scrutiny)
const ENSLAVER_FIELDS = new Set(['last_master', 'last_mistress', 'old_title']);

function isNumericOnly(s) { return /^\d[\d\s.,/-]*$/.test(s.trim()); }
function isPunctuationOnly(s) { return /^[\s\-_.,;:'"?!()[\]{}/*]+$/.test(s); }

function cleanText(s) {
    return (s || '').trim()
        .replace(/\s+/g, ' ')       // collapse whitespace
        .replace(/^[,.\-_"']+/, '') // strip leading junk chars
        .replace(/[,.\-_"']+$/, ''); // strip trailing junk chars
}

function validateFields(fields, depositorName) {
    const cleaned  = {};  // field_name → { text, confidence } (validated)
    const warnings = [];  // human-readable FP explanations
    const rejectedFields = [];

    const depositorLower = (depositorName || '').toLowerCase().trim();

    for (const [field, value] of Object.entries(fields)) {
        // Multi-value fields (arrays)
        if (Array.isArray(value)) {
            const validItems = [];
            for (const item of value) {
                const { flagged, reason } = checkValue(item.text, field, depositorLower);
                if (flagged) {
                    warnings.push(`[FP] ${field}[] item rejected — ${reason}: "${item.text.substring(0, 40)}"`);
                } else {
                    validItems.push(item);
                }
            }
            if (validItems.length > 0) cleaned[field] = validItems;
            else if (value.length > 0) rejectedFields.push(field);
            continue;
        }

        // Single-value fields
        const { flagged, reason } = checkValue(value.text, field, depositorLower);
        if (flagged) {
            warnings.push(`[FP] ${field} rejected — ${reason}: "${value.text.substring(0, 60)}"`);
            rejectedFields.push(field);
        } else {
            cleaned[field] = value;
        }
    }

    // ── Cross-field checks ───────────────────────────────────────────────────
    const masterText    = cleaned['last_master']?.text?.toLowerCase()   || '';
    const mistressText  = cleaned['last_mistress']?.text?.toLowerCase() || '';
    const plantText     = cleaned['plantation']?.text?.toLowerCase()    || '';

    // Depositor as their own enslaver
    if (depositorLower && masterText && masterText === depositorLower) {
        warnings.push(`[FP-CROSS] last_master == depositor_name ("${cleaned['last_master'].text}") — almost certainly misread`);
        delete cleaned['last_master'];
        rejectedFields.push('last_master');
    }
    if (depositorLower && mistressText && mistressText === depositorLower) {
        warnings.push(`[FP-CROSS] last_mistress == depositor_name ("${cleaned['last_mistress'].text}") — almost certainly misread`);
        delete cleaned['last_mistress'];
        rejectedFields.push('last_mistress');
    }

    // Master and mistress are identical exact strings (OCR bled between columns)
    if (masterText && mistressText && masterText === mistressText) {
        warnings.push(`[FP-CROSS] last_master == last_mistress ("${masterText}") — likely column bleed`);
        // Keep both but log — don't reject since married couples can share a surname
    }

    // Master name === plantation name (e.g., OCR confused field boundaries)
    if (masterText && plantText && (masterText.includes(plantText) || plantText.includes(masterText)) && plantText.length > 5) {
        warnings.push(`[FP-CROSS] last_master overlaps plantation ("${masterText}" / "${plantText}") — possible field boundary confusion`);
    }

    // old_title check: if it doesn't start with a recognizable title prefix, flag but keep
    if (cleaned['old_title']) {
        const t = cleaned['old_title'].text.toLowerCase();
        const hasTitle = ['mr', 'mrs', 'dr', 'col', 'gen', 'maj', 'capt', 'rev', 'hon',
                          'judge', 'estate', 'esq', 'lt', 'prof', 'miss', 'ms'].some(p => t.startsWith(p));
        if (!hasTitle && cleaned['old_title'].confidence < 0.70) {
            warnings.push(`[FP-WARN] old_title "${cleaned['old_title'].text}" has no recognizable title prefix (conf=${cleaned['old_title'].confidence.toFixed(2)}) — may be misclassified`);
        }
    }

    return { cleaned, warnings, rejectedFields };
}

function checkValue(raw, field, depositorLower) {
    const text = cleanText(raw || '');
    const lower = text.toLowerCase();

    if (!text || text.length < 2)             return { flagged: true, reason: 'too short / empty' };
    if (isPunctuationOnly(text))               return { flagged: true, reason: 'punctuation only' };
    if (isNumericOnly(text) && NAME_FIELDS.has(field)) return { flagged: true, reason: 'numeric only in name field' };
    if (text.length > 80)                      return { flagged: true, reason: `too long (${text.length} chars — likely multi-field capture)` };
    if (FP_JUNK_EXACT.has(lower))              return { flagged: true, reason: `junk value "${lower}"` };

    // Partial junk check (starts with known junk word + minimal suffix)
    for (const junk of FP_JUNK_EXACT) {
        if (lower.startsWith(junk + ' ') && text.length < junk.length + 5) {
            return { flagged: true, reason: `near-junk value "${lower}"` };
        }
    }

    // Page/column header text leaked in
    for (const hdr of FP_HEADER_SUBSTRINGS) {
        if (lower.includes(hdr)) return { flagged: true, reason: `contains page/column header text "${hdr}"` };
    }

    // City/state name in enslaver field
    if (ENSLAVER_FIELDS.has(field) && FP_CITY_NAMES.has(lower)) {
        return { flagged: true, reason: `city/state name in enslaver field: "${lower}"` };
    }

    // Single-word, all-lowercase, < 4 chars in a name field → likely a stray word
    if (NAME_FIELDS.has(field) && !text.includes(' ') && text === text.toLowerCase() && text.length < 4) {
        return { flagged: true, reason: `suspicious short lowercase token in name field: "${text}"` };
    }

    // Depositor name appears verbatim in enslaver field (case-insensitive)
    if (ENSLAVER_FIELDS.has(field) && depositorLower && lower === depositorLower) {
        return { flagged: true, reason: 'enslaver field matches depositor name' };
    }

    // Looks like an account number (e.g., "No. 1234", "# 567")
    if (/^(no\.?|#)\s*\d+/i.test(text)) {
        return { flagged: true, reason: `looks like an account number: "${text}"` };
    }

    return { flagged: false, reason: null };
}

// ── Flatten fields for DB storage ─────────────────────────────────────────────
function flattenFields(fields) {
    const flat = {};
    for (const [k, v] of Object.entries(fields)) {
        if (Array.isArray(v)) {
            flat[k] = v.map(x => x.text);
        } else {
            flat[k]                  = v.text;
            flat[`${k}_confidence`]  = Math.round(v.confidence * 100) / 100;
        }
    }
    return flat;
}

// ── Upload screenshot to S3 ───────────────────────────────────────────────────
async function uploadToS3(buffer, recordId, branch) {
    if (!s3 || !S3_BUCKET) return null;
    const slug = (branch || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const key  = `freedmens-bank/${slug}/docai/${recordId}.png`;
    try {
        await s3.send(new PutObjectCommand({
            Bucket:      S3_BUCKET,
            Key:         key,
            Body:        buffer,
            ContentType: 'image/png',
        }));
        return key;
    } catch (e) {
        console.warn(`  ⚠ S3 upload failed: ${e.message}`);
        return null;
    }
}

// ── Write enrichment to unconfirmed_persons ───────────────────────────────────
async function storeEnrichment(recordId, flatFields) {
    // Merge docai_fields into existing relationships JSONB, then tag review_notes
    await sql`
        UPDATE unconfirmed_persons
        SET
            relationships = COALESCE(relationships, '{}'::jsonb)
                            || jsonb_build_object('docai_fields', ${JSON.stringify(flatFields)}::jsonb),
            review_notes  = CASE
                                WHEN review_notes IS NULL OR review_notes = ''
                                THEN 'docai_enrichment'
                                ELSE review_notes || '; docai_enrichment'
                            END,
            updated_at    = NOW()
        WHERE id = ${recordId}
    `;
}

// ── Log to parse_failure_queue (migration 044) ────────────────────────────────
async function queueFailure(opts) {
    const {
        sourceUrl, sourceIdentifier, s3Key,
        extractedFields, rawEntities,
        failureReason, missingFields,
        avgConf, errorMessage,
    } = opts;

    try {
        await sql`
            INSERT INTO parse_failure_queue (
                document_type,
                source_identifier,
                s3_key,
                source_url,
                engine_attempted,
                engine_processor_id,
                engine_confidence,
                extracted_fields,
                failure_reason,
                required_fields_missing,
                error_message,
                training_eligible
            ) VALUES (
                'freedmens_bank_ledger_page',
                ${sourceIdentifier || null},
                ${s3Key || null},
                ${sourceUrl || null},
                'document_ai_custom_extractor',
                ${PROCESSOR_ID},
                ${avgConf !== undefined ? Math.round(avgConf * 100) / 100 : null},
                ${JSON.stringify(extractedFields || {})}::jsonb,
                ${failureReason},
                ${missingFields || null},
                ${errorMessage || null},
                ${failureReason !== 'parse_exception'}
            )
            ON CONFLICT DO NOTHING
        `;
    } catch (e) {
        console.warn(`  ⚠ parse_failure_queue insert failed: ${e.message}`);
    }
}

// ── Progress logger ───────────────────────────────────────────────────────────
function pad(n, w = 6) { return String(n).padStart(w); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  Freedmens Bank → Document AI Enrichment');
    console.log(`  Processor:  ${PROCESSOR_NAME}`);
    console.log(`  Mode:       ${DRY_RUN ? '⚠ DRY RUN (no DB/S3 writes)' : 'LIVE'}`);
    console.log(`  S3:         ${S3_BUCKET || '(not configured — screenshots not archived)'}`);
    console.log(`  Branch:     ${BRANCH_FILTER || '(all branches)'}`);
    console.log(`  Limit:      ${LIMIT || '(no limit)'}`);
    console.log(`  Start ID:   ${START_ID || '(from beginning)'}`);
    console.log(`  Reprocess:  ${REPROCESS}`);
    console.log(`  Queue threshold: avg confidence < ${MIN_CONFIDENCE} OR no critical fields`);
    console.log('═══════════════════════════════════════════════════════════════════\n');

    console.log('Fetching un-enriched records from Neon…');
    const records = await fetchRecords();
    console.log(`Found ${records.length} records to process.\n`);

    if (records.length === 0) {
        console.log('All matching records are already enriched. Use --reprocess to re-run.');
        return;
    }

    // Connect to existing Chrome session
    const browser = await puppeteer.connect({
        browserURL:      `http://localhost:${DEBUG_PORT}`,
        defaultViewport: { width: 2800, height: 1700 },
    });

    // Reuse existing FamilySearch tab if open (preserves login session)
    const allPages = await browser.pages();
    let page = allPages.find(p => /familysearch\.org/.test(p.url()));
    if (!page) {
        console.log('  → No FamilySearch tab found — opening a new tab.');
        page = await browser.newPage();
    } else {
        console.log(`  → Reusing FS tab: ${page.url().substring(0, 80)}`);
    }
    await page.setViewport({ width: 2800, height: 1700 });
    console.log('');

    const stats = {
        processed:   0,
        enriched:    0,
        queued:      0,
        navErrors:   0,
        docaiErrors: 0,
        skipped:     0,
        fpRejected:  0,   // total fields cleaned out by false-positive validator
        fpWarned:    0,   // records that had at least one FP warning
    };
    const startTime = Date.now();

    for (const record of records) {
        const { id, full_name, source_url, locations } = record;
        const branch = Array.isArray(locations) ? locations[0] : (locations || 'unknown');
        const n = `[${pad(stats.processed + 1)}/${records.length}]`;

        process.stdout.write(`${n} ${full_name.substring(0, 36).padEnd(36)} id=${id} … `);

        // ── 1. Screenshot the ledger ────────────────────────────────────────
        let imageBuffer;
        try {
            imageBuffer = await screenshotLedger(page, source_url);
        } catch (navErr) {
            console.log(`NAV_FAIL  ${navErr.message.substring(0, 60)}`);
            if (!DRY_RUN) {
                await queueFailure({
                    sourceUrl: source_url,
                    sourceIdentifier: `${branch}/id-${id}`,
                    failureReason: 'parse_exception',
                    errorMessage: `Navigation failed: ${navErr.message}`,
                    avgConf: 0,
                });
            }
            stats.navErrors++;
            stats.processed++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`DRY_RUN   screenshot ${(imageBuffer.length / 1024).toFixed(0)} KB — skipping Doc AI + DB`);
            stats.processed++;
            continue;
        }

        // ── 2. Upload screenshot to S3 ──────────────────────────────────────
        const s3Key = await uploadToS3(imageBuffer, id, branch);

        // ── 3. Call Document AI ─────────────────────────────────────────────
        let document;
        try {
            document = await callDocAI(imageBuffer);
        } catch (docErr) {
            console.log(`DOCAI_FAIL  ${docErr.message.substring(0, 60)}`);
            await queueFailure({
                sourceUrl: source_url,
                sourceIdentifier: `${branch}/id-${id}`,
                s3Key,
                failureReason: 'parse_exception',
                errorMessage: `Document AI error: ${docErr.message}`,
                avgConf: 0,
            });
            stats.docaiErrors++;
            stats.processed++;
            await new Promise(r => setTimeout(r, 3000)); // back-off on API error
            continue;
        }

        // ── 4. Parse entities ───────────────────────────────────────────────
        const { fields: rawFields, rawEntities, avgConf } = parseEntities(document);

        // ── 4b. False-positive validation ───────────────────────────────────
        const { cleaned: fields, warnings: fpWarnings, rejectedFields } = validateFields(rawFields, full_name);

        if (fpWarnings.length > 0) {
            stats.fpRejected += rejectedFields.length;
            stats.fpWarned++;
            // Print FP warnings inline under the record line
            fpWarnings.forEach(w => console.log(`    ⚠ FP  ${w}`));
        }

        // Build flat map — embed FP audit trail so the review queue has full context
        const flatFields = flattenFields(fields);
        if (fpWarnings.length > 0) {
            flatFields._fp_warnings = fpWarnings;
            flatFields._fp_rejected_fields = rejectedFields;
        }

        const criticalHit = CRITICAL_FIELDS.some(f => fields[f]?.text);
        const missingCrit = CRITICAL_FIELDS.filter(f => !fields[f]?.text);

        // Build a summary for the console
        const hitStr = CRITICAL_FIELDS
            .filter(f => fields[f]?.text)
            .map(f => `${f}="${fields[f].text.substring(0, 20)}"`)
            .join(' | ') || '(no critical fields)';

        console.log(`    conf=${avgConf.toFixed(2)}  FP-rejected=${rejectedFields.length}  ${hitStr}`);

        // ── 5. Store enrichment ─────────────────────────────────────────────
        await storeEnrichment(id, flatFields);
        stats.enriched++;

        // ── 6. Queue for human review if quality is low OR FP warnings present
        const shouldQueue = !criticalHit || avgConf < MIN_CONFIDENCE || fpWarnings.length > 0;
        if (shouldQueue) {
            await queueFailure({
                sourceUrl: source_url,
                sourceIdentifier: `${branch}/id-${id}`,
                s3Key,
                extractedFields: flatFields,
                rawEntities,
                failureReason: !criticalHit
                    ? 'required_fields_empty'
                    : fpWarnings.length > 0
                        ? 'false_positive_detected'
                        : 'sub_threshold_confidence',
                missingFields: missingCrit,
                avgConf,
                errorMessage: fpWarnings.length > 0 ? fpWarnings.join(' | ') : null,
            });
            stats.queued++;
        }

        stats.processed++;

        // ── Periodic progress line ──────────────────────────────────────────
        if (stats.processed % 25 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const rate    = (stats.processed / ((Date.now() - startTime) / 1000)).toFixed(2);
            console.log(
                `\n  ── progress: ${stats.processed}/${records.length}  ` +
                `enriched=${stats.enriched} queued=${stats.queued} ` +
                `fp-warned=${stats.fpWarned} fp-fields-rejected=${stats.fpRejected} ` +
                `navErr=${stats.navErrors} docaiErr=${stats.docaiErrors} ` +
                `elapsed=${elapsed}s (${rate} rec/s) ──\n`
            );
        }

        // Brief pause between records — polite to FS + avoids rate-limiting
        await new Promise(r => setTimeout(r, 1500));
    }

    try { await browser.disconnect(); } catch (_) {}

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log(`Total processed:          ${stats.processed}`);
    console.log(`Enriched (DB updated):    ${stats.enriched}`);
    console.log(`Queued (human review):    ${stats.queued}`);
    console.log(`FP-warned records:        ${stats.fpWarned}  (had ≥1 false-positive warning)`);
    console.log(`FP-rejected fields total: ${stats.fpRejected}  (fields nulled out by validator)`);
    console.log(`Nav errors:               ${stats.navErrors}`);
    console.log(`Doc AI errors:            ${stats.docaiErrors}`);
    console.log(`Elapsed:                  ${elapsed}s`);
    if (stats.enriched > 0) {
        console.log(`Avg throughput:           ${(stats.enriched / parseFloat(elapsed)).toFixed(2)} records/s`);
    }
    if (!DRY_RUN && stats.queued > 0) {
        console.log(`\n  → ${stats.queued} records queued in parse_failure_queue for human review.`);
        console.log(`    Reasons: required_fields_empty | false_positive_detected | sub_threshold_confidence`);
        console.log(`    View at /review → Parse Failures queue.`);
    }
    if (stats.fpWarned > 0) {
        const fpRate = ((stats.fpWarned / stats.processed) * 100).toFixed(1);
        console.log(`\n  ⚠ FP rate: ${fpRate}% of records had at least one false-positive field removed.`);
        console.log(`    Check parse_failure_queue WHERE failure_reason = 'false_positive_detected'`);
        console.log(`    to review rejected values for potential model retraining.`);
    }
    console.log('═══════════════════════════════════════════════════════════════════');
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('\nFatal:', err.message);
        process.exit(1);
    });
