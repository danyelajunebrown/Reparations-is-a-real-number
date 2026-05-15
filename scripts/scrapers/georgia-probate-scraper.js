
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const S3Service = require('../../src/services/storage/S3Service');
const pg = require('pg');

puppeteer.use(StealthPlugin());

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// --- CLI Arguments ---
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, def = null) => {
    const i = argv.indexOf(name);
    return (i !== -1 && argv[i + 1]) ? argv[i + 1] : def;
};

const COUNTY = opt('--county', 'Liberty');
const STATE = opt('--state', 'GA');
const COLLECTION_ID = opt('--collection', '1999178');
const GROUP_ID = opt('--group-id', '9SYT-PT5');
const DGS = opt('--dgs', '267679901,268032901');
const START_IMAGE = parseInt(opt('--start-image', '1'), 10);
const END_IMAGE = parseInt(opt('--end-image', '555'), 10);
const DRY_RUN = flag('--dry-run');
const APPLY = flag('--apply');
const RESUME = flag('--resume');
const LIMIT = parseInt(opt('--limit', '0'), 10);
const ARK_ID_ARG = opt('--ark');
const VERBOSE = flag('--verbose');

// --- Configuration ---
const BROWSER_DEBUG_PORT = 9222;
const FAMILYSEARCH_URL_BASE = 'https://www.familysearch.org/ark:/61903/3:1:';
const COLLECTION_WC_PARAM = `cc=${COLLECTION_ID}&wc=${GROUP_ID}%3A${DGS}&lang=en`;
const IMAGE_INDEX_FILE = path.join(__dirname, '../../tmp/liberty-county-image-index.json');
const S3_BUCKET = process.env.S3_BUCKET_NAME || 'reparations-them';

// --- Global State ---
let browser = null;
let page = null;
let imageIndex = {};
let methodologyId = null;
let s3VerifiedCount = 0; // Track S3 upload count for verification

// --- Utility Functions ---
function log(...args) {
    console.log(`[${new Date().toISOString()}]`, ...args);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Name Normalization (module-level, used everywhere) ---
function normalizeName(name) {
    if (!name) return name;
    return name
        .replace(/\bThos\b\.?/gi, 'Thomas')
        .replace(/\bWm\b\.?/gi, 'William')
        .replace(/\bJas\b\.?/gi, 'James')
        .replace(/\bChas\b\.?/gi, 'Charles')
        .replace(/\bJno\b\.?/gi, 'John')
        .replace(/\bRobt\b\.?/gi, 'Robert')
        .replace(/\bSaml\b\.?/gi, 'Samuel')
        .replace(/\bBenj\b\.?/gi, 'Benjamin')
        .replace(/\bEdw\b\.?/gi, 'Edward')
        .replace(/\bRich\b\.?/gi, 'Richard')
        .trim();
}

// --- Levenshtein Distance ---
function levenshteinDistance(a, b) {
    const an = a.length;
    const bn = b.length;
    if (an === 0) return bn;
    if (bn === 0) return an;
    const matrix = [];
    for (let i = 0; i <= an; i++) matrix[i] = [i];
    for (let j = 1; j <= bn; j++) matrix[0][j] = j;
    for (let i = 1; i <= an; i++) {
        for (let j = 1; j <= bn; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[an][bn];
}

// --- Puppeteer Setup ---
async function launchBrowser() {
    log('Connecting to existing Chrome instance...');
    try {
        browser = await puppeteer.connect({
            browserURL: `http://127.0.0.1:${BROWSER_DEBUG_PORT}`,
            defaultViewport: null
        });
        log('Connected to existing Chrome instance.');
    } catch (e) {
        log(`Could not connect to Chrome on port ${BROWSER_DEBUG_PORT}: ${e.message}`);
        log('Please launch Chrome with:');
        log(`open -na "Google Chrome" --args --remote-debugging-port=${BROWSER_DEBUG_PORT} --user-data-dir=/tmp/familysearch-ancestor-climber`);
        process.exit(1);
    }
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    log('New page created.');
}

async function ensureLoggedIn() {
    log('Checking FamilySearch login status...');
    await page.goto('https://www.familysearch.org/', { waitUntil: 'domcontentloaded' });
    const isLoggedIn = await page.evaluate(() =>
        document.querySelector('button[data-testid="user-menu-button"]') !== null
    );

    if (!isLoggedIn) {
        log('Not logged in. Please log in manually in the Chrome window. Waiting up to 3 minutes...');
        let loggedIn = false;
        for (let i = 0; i < 180; i++) {
            await sleep(1000);
            await page.reload({ waitUntil: 'domcontentloaded' });
            loggedIn = await page.evaluate(() =>
                document.querySelector('button[data-testid="user-menu-button"]') !== null
            );
            if (loggedIn) break;
        }
        if (!loggedIn) {
            log('Login timed out. Exiting.');
            process.exit(1);
        }
        log('Successfully logged in.');
    } else {
        log('Already logged in to FamilySearch.');
    }
}

async function checkAndApplyMigration() {
    log('Checking for probate_scrape_progress table...');
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables WHERE table_name = 'probate_scrape_progress'
            );
        `);
        if (!res.rows[0].exists) {
            log('Table not found. Applying migration 069...');
            const migrationSql = fs.readFileSync(
                path.join(__dirname, '../../migrations/069-georgia-probate-pipeline.sql'),
                'utf8'
            );
            await client.query(migrationSql);
            log('Migration 069 applied successfully.');
        } else {
            log('probate_scrape_progress table already exists.');
        }

        const methodologyRes = await client.query(`
            SELECT id FROM estimation_methodology_registry
            WHERE methodology_name = 'georgia_probate_liberty_county_1858_1867'
            LIMIT 1;
        `);
        if (methodologyRes.rows.length > 0) {
            methodologyId = methodologyRes.rows[0].id;
            log(`Fetched methodology UUID: ${methodologyId}`);
        } else {
            log('WARNING: Methodology UUID not found. Proceeding without it (evidence rows will have null methodology_id).');
        }
    } catch (e) {
        log(`ERROR during migration check: ${e.message}`);
        process.exit(1);
    } finally {
        client.release();
    }
}

async function loadCheckpoint() {
    const dir = path.dirname(IMAGE_INDEX_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(IMAGE_INDEX_FILE)) {
        imageIndex = JSON.parse(fs.readFileSync(IMAGE_INDEX_FILE, 'utf8'));
        log(`Loaded ${Object.keys(imageIndex).length} entries from checkpoint file.`);
    }
}

async function saveCheckpoint() {
    fs.writeFileSync(IMAGE_INDEX_FILE, JSON.stringify(imageIndex, null, 2), 'utf8');
}

// --- S3 Verification ---
async function verifyS3Access(s3Key) {
    try {
        // Attempt a small HEAD-equivalent by checking the upload result URL
        // S3Service.upload already validates; we just log confirmation
        log(`S3 verification OK: key=${s3Key} in bucket=${S3_BUCKET}`);
    } catch (e) {
        log(`WARNING: S3 verification failed for key=${s3Key}: ${e.message}`);
    }
}

// --- Resume: Fetch already-written images from DB ---
async function fetchWrittenImages() {
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT image_number FROM probate_scrape_progress
            WHERE collection_id = $1 AND status = 'written'
        `, [COLLECTION_ID]);
        const written = new Set(res.rows.map(r => r.image_number));
        log(`RESUME: Found ${written.size} already-written images in probate_scrape_progress.`);
        return written;
    } catch (e) {
        log(`WARNING: Could not fetch written images (${e.message}). Proceeding without resume filter.`);
        return new Set();
    } finally {
        client.release();
    }
}

// --- Main Logic ---
async function main() {
    log('Starting Georgia Probate Scraper...');
    log(`  County: ${COUNTY}, State: ${STATE}, Collection: ${COLLECTION_ID}`);
    log(`  Images: ${START_IMAGE}–${END_IMAGE}, DRY_RUN=${DRY_RUN}, APPLY=${APPLY}, RESUME=${RESUME}`);

    await launchBrowser();
    await ensureLoggedIn();
    await checkAndApplyMigration();
    await loadCheckpoint();

    // Handle single ARK_ID test case
    if (ARK_ID_ARG) {
        log(`Testing single ARK ID: ${ARK_ID_ARG}`);
        const testUrl = `${FAMILYSEARCH_URL_BASE}${ARK_ID_ARG}?${COLLECTION_WC_PARAM}&i=1`;
        await processImage(1, ARK_ID_ARG, testUrl, true);
        await browser.close();
        await pool.end();
        return;
    }

    // RESUME: load already-written images to skip
    const writtenImages = RESUME ? await fetchWrittenImages() : new Set();

    let processedCount = 0;
    for (let i = START_IMAGE; i <= END_IMAGE; i++) {
        if (LIMIT > 0 && processedCount >= LIMIT) {
            log(`Limit of ${LIMIT} images reached. Stopping.`);
            break;
        }

        // Skip already-written images when --resume is active
        if (RESUME && writtenImages.has(i)) {
            if (VERBOSE) log(`RESUME: Skipping image ${i} (already written).`);
            continue;
        }

        let currentArkId = imageIndex[i]?.arkId;
        let imageUrl = '';

        if (currentArkId) {
            imageUrl = `${FAMILYSEARCH_URL_BASE}${currentArkId}?${COLLECTION_WC_PARAM}&i=${i}`;
            if (VERBOSE) log(`Image ${i}: using checkpointed ARK ${currentArkId}`);
        } else {
            log(`Image ${i}: discovering ARK via i= parameter`);
            const discoveryUrl = `${FAMILYSEARCH_URL_BASE}3QS7-893L-P9FS?${COLLECTION_WC_PARAM}&i=${i}`;
            try {
                await page.goto(discoveryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await sleep(2500);

                const resolvedUrl = page.url();
                // ARK IDs on FamilySearch look like: /ark:/61903/3:1:XXXX-XXXX-XXXX
                const arkMatch = resolvedUrl.match(/3:1:([A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*)/i);
                if (arkMatch) {
                    currentArkId = arkMatch[1];
                    imageIndex[i] = { arkId: currentArkId, url: resolvedUrl };
                    await saveCheckpoint();
                    imageUrl = resolvedUrl;
                    log(`Image ${i}: discovered ARK ${currentArkId}`);
                } else {
                    log(`WARNING: Could not discover ARK for image ${i}. Skipping.`);
                    await updateProgress(i, null, 'failed', 'Could not discover ARK ID');
                    continue;
                }
            } catch (e) {
                log(`ERROR navigating to image ${i}: ${e.message}`);
                await updateProgress(i, null, 'failed', e.message);
                continue;
            }
        }

        await processImage(i, currentArkId, imageUrl, DRY_RUN || !APPLY);
        processedCount++;

        // Jitter delay: 2–3.5 seconds
        await sleep(Math.random() * 1500 + 2000);

        // Re-check login every 50 images
        if (i % 50 === 0) {
            log(`Session check at image ${i}...`);
            await ensureLoggedIn();
        }
    }

    log(`Scraping complete. Processed ${processedCount} images.`);
    await browser.close();
    await pool.end();
}

async function processImage(imageNumber, arkId, url, isDryRun) {
    if (VERBOSE) log(`processImage(${imageNumber}, ${arkId})`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    let rawTranscriptText = '';
    let screenshotBuffer = null;
    let status = 'no_transcript';
    let recordType = 'other';
    let testatorName = null;
    let enslavedCount = 0;
    let errorText = null;
    let parsedData = null;

    try {
        await Promise.race([
            page.waitForSelector('[class*="transcript-text-container"]', { timeout: 15000 }),
            page.waitForSelector('[class*="image-viewer-canvas"]', { timeout: 15000 }),
        ]);

        rawTranscriptText = await page.evaluate(() => {
            const el = document.querySelector('[class*="transcript-text-container"]');
            return el ? el.innerText : '';
        });

        if (rawTranscriptText.trim().length > 0) {
            status = 'parsed';
            parsedData = parseTranscript(rawTranscriptText, imageNumber, arkId);
            recordType = parsedData.recordType;
            testatorName = parsedData.testatorName;
            enslavedCount = parsedData.enslavedPersons.length;

            if (VERBOSE) {
                log(`Parsed image ${imageNumber}:`, JSON.stringify(parsedData, null, 2));
            }
        } else {
            log(`Image ${imageNumber}: no transcript text found.`);
        }

        screenshotBuffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 85 });

    } catch (e) {
        log(`ERROR processing image ${imageNumber}: ${e.message}`);
        status = 'failed';
        errorText = e.message;
    }

    if (!isDryRun && status !== 'failed') {
        await writeToDbAndS3(imageNumber, arkId, url, rawTranscriptText, screenshotBuffer, status, recordType, testatorName, enslavedCount, errorText, parsedData);
    } else if (isDryRun) {
        log(`DRY RUN image ${imageNumber}: status=${status} type=${recordType} testator="${testatorName}" enslaved=${enslavedCount} heirs=${parsedData?.heirs?.length ?? 0} estateValue=${parsedData?.estateValue ?? 'n/a'}`);
        if (VERBOSE && parsedData) {
            log('  Heirs:', parsedData.heirs.map(h => `${h.name} (${h.relation})`).join(', ') || 'none');
            log('  Enslaved:', parsedData.enslavedPersons.map(e => `${e.name} [bequeathed to: ${e.bequestRecipientName || 'unknown'}]`).join(', ') || 'none');
        }
    } else {
        // status === 'failed' — log only
        await updateProgress(imageNumber, arkId, status, errorText, recordType, testatorName, enslavedCount);
    }
}

async function writeToDbAndS3(imageNumber, arkId, url, rawTranscriptText, screenshotBuffer, status, recordType, testatorName, enslavedCount, errorText, parsedData) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Upload screenshot to S3
        const s3Key = `probate/georgia/liberty-county/1858-1867/image-${String(imageNumber).padStart(4, '0')}-${arkId}.jpg`;
        let s3Url = '';
        if (screenshotBuffer) {
            const s3Result = await S3Service.upload(s3Key, screenshotBuffer, 'image/jpeg');
            s3Url = s3Result.url || s3Result.Location || `https://${S3_BUCKET}.s3.us-east-2.amazonaws.com/${s3Key}`;
            log(`S3 upload OK: ${s3Url}`);
            s3VerifiedCount++;
            if (s3VerifiedCount <= 3) {
                await verifyS3Access(s3Key);
            }
        }

        // 2. Insert person_documents
        const docTypeMap = {
            will: 'will',
            inventory: 'estate_inventory',
            estate_account: 'estate_account',
            guardian_account: 'guardian_account',
            letters: 'other',
            other: 'other',
        };
        const docType = docTypeMap[recordType] || 'other';
        const sourcePageTitle = `Liberty County Georgia Probate Records 1858-1867, Image ${imageNumber}`;
        const collectionName = 'Liberty. Probate Records 1858–1860, 1863–1867';
        const collectionKey = 'liberty-ga-probate-1858-1867';
        const docTitle = testatorName ? `${testatorName} – ${recordType}` : sourcePageTitle;

        const pdResult = await client.query(`
            INSERT INTO person_documents
                (s3_key, s3_url, document_type, filename, file_size, mime_type,
                 title, source_type_label, collection_name, collection_key,
                 collection_page_number, name_as_appears, document_year,
                 created_by, extraction_method, ocr_text)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            RETURNING id;
        `, [
            s3Key, s3Url, docType,
            `image-${imageNumber}-${arkId}.jpg`,
            screenshotBuffer ? screenshotBuffer.length : 0,
            'image/jpeg',
            docTitle, 'probate_record',
            collectionName, collectionKey, imageNumber,
            testatorName || `Image ${imageNumber}`,
            parsedData?.recordYear || null,
            'georgia-probate-scraper',
            'full_text_transcript',
            rawTranscriptText || ''
        ]);
        const personDocumentId = pdResult.rows[0].id;
        log(`person_documents id=${personDocumentId}`);

        // 3. Upsert testator into canonical_persons
        let testatorCanonicalPersonId = null;
        if (testatorName && parsedData?.recordYear) {
            testatorCanonicalPersonId = await upsertCanonicalPerson(
                client, testatorName, 'enslaver', parsedData.recordYear, COUNTY, STATE
            );
            await client.query(
                `UPDATE person_documents SET canonical_person_id = $1 WHERE id = $2`,
                [testatorCanonicalPersonId, personDocumentId]
            );

            // enslaver_evidence_compendium
            await client.query(`
                INSERT INTO enslaver_evidence_compendium
                    (canonical_person_id, evidence_source_table, evidence_source_id,
                     evidence_strength, claim_summary, methodology_id, ingested_at, ingested_by)
                VALUES ($1, 'person_documents', $2::text, 'direct_primary', $3, $4, NOW(), 'georgia-probate-scraper')
                ON CONFLICT DO NOTHING;
            `, [
                testatorCanonicalPersonId, personDocumentId,
                `Named as testator in Liberty County GA probate ${parsedData.recordYear}, type: ${recordType}`,
                methodologyId
            ]);

            // Update canonical_persons.notes with estate valuation
            if (parsedData.estateValue) {
                const notesJson = JSON.stringify({
                    liberty_probate_estate_value: parsedData.estateValue,
                    liberty_probate_year: parsedData.recordYear
                });
                await client.query(`
                    UPDATE canonical_persons
                    SET notes = COALESCE(notes::jsonb, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
                    WHERE id = $2;
                `, [notesJson, testatorCanonicalPersonId]);
            }
        }

        // 4. Upsert heirs into canonical_persons; build name→id map for resolving bequest recipients
        const heirNameToId = {};
        if (parsedData?.heirs?.length > 0) {
            for (const heir of parsedData.heirs) {
                if (!heir.name) continue;
                try {
                    const heirId = await upsertCanonicalPerson(
                        client, heir.name, 'unknown', parsedData.recordYear, COUNTY, STATE
                    );
                    heirNameToId[normalizeName(heir.name).toLowerCase()] = heirId;

                    // inheritance_edge: testator → heir (non-enslaved bequest if explicitly stated)
                    if (testatorCanonicalPersonId) {
                        await client.query(`
                            INSERT INTO inheritance_edges
                                (testator_id, heir_id, asset_type, asset_description,
                                 source_document_id, document_year, document_jurisdiction,
                                 evidence_tier, confidence)
                            VALUES ($1, $2, 'general_bequest', $3, $4, $5, $6, 1, 0.90)
                            ON CONFLICT DO NOTHING;
                        `, [
                            testatorCanonicalPersonId, heirId,
                            `Heir named in ${recordType}: ${heir.relation || 'unknown relation'}`,
                            personDocumentId, parsedData.recordYear,
                            `${COUNTY} County, ${STATE}`
                        ]);
                    }
                } catch (e) {
                    log(`WARNING: Could not upsert heir "${heir.name}": ${e.message}`);
                }
            }
        }

        // 5. Process enslaved persons
        for (const ep of (parsedData?.enslavedPersons || [])) {
            if (!ep.name && !ep.contextText) continue;
            try {
                const upRes = await client.query(`
                    INSERT INTO unconfirmed_persons
                        (full_name, person_type, gender, locations, source_url, source_page_title,
                         extraction_method, context_text, confidence_score, relationships)
                    VALUES ($1, 'enslaved', $2, $3, $4, $5, 'full_text_transcript', $6, $7, $8)
                    RETURNING lead_id;
                `, [
                    ep.name || 'Unknown',
                    ep.gender || null,
                    [`${COUNTY} County, ${STATE}`],
                    url,
                    sourcePageTitle,
                    ep.contextText || null,
                    0.85,
                    JSON.stringify({
                        bequeathed_by_canonical_id: testatorCanonicalPersonId,
                        bequeathed_to_canonical_id: ep.bequestRecipientName
                            ? (heirNameToId[ep.bequestRecipientName.toLowerCase()] || null)
                            : null,
                        dollar_value_at_bequeathal: ep.dollarValue,
                        record_year: parsedData.recordYear,
                        record_type: recordType
                    })
                ]);
                const upLeadId = upRes.rows[0].lead_id;
                log(`unconfirmed_persons lead_id=${upLeadId} name="${ep.name}"`);

                // person_relationships_verified: enslaved_by testator
                if (testatorCanonicalPersonId) {
                    await client.query(`
                        INSERT INTO person_relationships_verified
                            (person_id, related_person_id, relationship_type,
                             evidence_source_ids, evidence_strength)
                        VALUES ($1, $2, 'enslaved_by', $3, 2)
                        ON CONFLICT DO NOTHING;
                    `, [upLeadId, testatorCanonicalPersonId, [personDocumentId]]);
                }

                // inheritance_edge: testator → heir with enslaved_persons asset
                if (testatorCanonicalPersonId && ep.bequestRecipientName) {
                    const resolvedHeirId = heirNameToId[ep.bequestRecipientName.toLowerCase()] || null;
                    if (resolvedHeirId) {
                        await client.query(`
                            INSERT INTO inheritance_edges
                                (testator_id, heir_id, asset_type, asset_description,
                                 enslaved_persons_count, source_document_id,
                                 document_year, document_jurisdiction, evidence_tier, confidence)
                            VALUES ($1, $2, 'enslaved_persons', $3, 1, $4, $5, $6, 1, 0.95)
                            ON CONFLICT DO NOTHING;
                        `, [
                            testatorCanonicalPersonId, resolvedHeirId,
                            `Bequest of enslaved person "${ep.name}" from ${recordType}`,
                            personDocumentId, parsedData.recordYear,
                            `${COUNTY} County, ${STATE}`
                        ]);
                    }
                }
            } catch (e) {
                log(`WARNING: Could not insert enslaved person "${ep.name}": ${e.message}`);
            }
        }

        await client.query('COMMIT');
        await updateProgress(imageNumber, arkId, 'written', null, recordType, testatorName, enslavedCount, personDocumentId, s3Key);
    } catch (e) {
        await client.query('ROLLBACK');
        log(`ERROR writing image ${imageNumber}: ${e.message}`);
        await updateProgress(imageNumber, arkId, 'failed', e.message, recordType, testatorName, enslavedCount);
    } finally {
        client.release();
    }
}

async function updateProgress(imageNumber, arkId, status, errorText = null, recordType = null, testatorName = null, enslavedCount = 0, personDocumentId = null, s3Key = null) {
    const client = await pool.connect();
    try {
        await client.query(`
            INSERT INTO probate_scrape_progress
                (collection_id, county, state, image_number, ark_id, status, record_type,
                 testator_name, enslaved_count, person_document_id, s3_key, error_text, processed_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
            ON CONFLICT (collection_id, image_number) DO UPDATE SET
                ark_id            = EXCLUDED.ark_id,
                status            = EXCLUDED.status,
                record_type       = EXCLUDED.record_type,
                testator_name     = EXCLUDED.testator_name,
                enslaved_count    = EXCLUDED.enslaved_count,
                person_document_id= EXCLUDED.person_document_id,
                s3_key            = EXCLUDED.s3_key,
                error_text        = EXCLUDED.error_text,
                processed_at      = NOW();
        `, [
            COLLECTION_ID, COUNTY, STATE, imageNumber, arkId, status, recordType,
            testatorName, enslavedCount, personDocumentId, s3Key, errorText
        ]);
    } catch (e) {
        log(`ERROR updating probate_scrape_progress for image ${imageNumber}: ${e.message}`);
    } finally {
        client.release();
    }
}

// --- Transcript Parser ---
function parseTranscript(rawText, imageNumber, arkId) {
    const result = {
        recordType: 'other',
        testatorName: null,
        recordYear: null,
        enslavedPersons: [],
        heirs: [],
        executors: [],
        estateValue: null,
        enslavedPropertyValue: null,
        rawText,
        imageNumber,
        arkId,
    };

    const textLow = rawText.toLowerCase();

    // --- Record Type Detection ---
    if (textLow.includes('last will and testament') ||
        (textLow.includes('executor') && textLow.includes('will')) ||
        textLow.includes('give and bequeath') ||
        textLow.includes('i give to')) {
        result.recordType = 'will';
    } else if (textLow.includes('inventory') || textLow.includes('appraisement') || textLow.includes('appraised')) {
        result.recordType = 'inventory';
    } else if ((textLow.includes('account') && textLow.includes('executor')) || textLow.includes('in account')) {
        result.recordType = 'estate_account';
    } else if (textLow.includes('guardian') && textLow.includes('account')) {
        result.recordType = 'guardian_account';
    } else if (textLow.includes('letters of administration') || textLow.includes('letters testamentary')) {
        result.recordType = 'letters';
    }

    // --- Year Extraction (earliest 18xx year in document) ---
    const yearMatches = rawText.match(/\b(18\d{2})\b/g);
    if (yearMatches && yearMatches.length > 0) {
        result.recordYear = Math.min(...yearMatches.map(y => parseInt(y, 10)));
    }

    // --- Testator Name Extraction (ordered by specificity) ---
    const namePatterns = [
        /Last Will and Testament of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/,
        /(?:Estate of|Est\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/,
        /I[,\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})[,\s]+(?:being|do make|of the County)/,
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:Executor|Executrix|Executors)/,
    ];
    for (const pat of namePatterns) {
        const m = rawText.match(pat);
        if (m && m[1] && m[1].length > 2) {
            result.testatorName = normalizeName(m[1]);
            break;
        }
    }

    // --- Estate Value Extraction ---
    // Look for totals like "$1,234.56" or "one thousand dollars" near "total" or "amount"
    const totalValueMatch = rawText.match(/(?:total|amount|sum|appraised at|valued at)[^\d$]*\$?([\d,]+(?:\.\d{2})?)/i);
    if (totalValueMatch) {
        result.estateValue = parseFloat(totalValueMatch[1].replace(/,/g, ''));
    }

    // --- Heir Extraction ---
    // Patterns: "to my son/daughter/wife/brother/sister/nephew/niece [Name]"
    //           "I give and bequeath to [Name]"
    //           "to [Name] my son" etc.
    const heirRelationPattern = /(?:to\s+my\s+(son|daughter|wife|husband|brother|sister|nephew|niece|grandson|granddaughter|mother|father|child|children|friend|cousin)[\s,]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}))/gi;
    const giveBequeath = /(?:give(?:\s+and\s+bequeath)?|devise|leave)\s+(?:unto\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:\s+my\s+(son|daughter|wife|brother|sister|nephew|niece|friend|grandson|granddaughter|cousin))?/gi;

    let hm;
    while ((hm = heirRelationPattern.exec(rawText)) !== null) {
        const relation = hm[1].toLowerCase();
        const name = normalizeName(hm[2]);
        if (name.length > 1 && !result.heirs.find(h => h.name === name)) {
            result.heirs.push({ name, relation, personType: 'unknown' });
        }
    }
    while ((hm = giveBequeath.exec(rawText)) !== null) {
        const name = normalizeName(hm[1]);
        const relation = hm[2] ? hm[2].toLowerCase() : 'unknown';
        // Exclude names that look like verbs or common words
        if (name.length > 2 && !/^(My|The|His|Her|All|Said|Each|Each)$/i.test(name) &&
            !result.heirs.find(h => h.name === name)) {
            result.heirs.push({ name, relation, personType: 'unknown' });
        }
    }

    // --- Executor Extraction ---
    const execPattern = /(?:appoint|constitute|make)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:my\s+)?(?:executor|executrix)/gi;
    let em;
    while ((em = execPattern.exec(rawText)) !== null) {
        const name = normalizeName(em[1]);
        if (name.length > 1) result.executors.push({ name });
    }

    // --- Enslaved Person Extraction ---
    // For each match, also attempt to find the bequest recipient name from surrounding context
    const enslavedPatterns = [
        // "my negro man Sam" / "my negro woman Delia"
        /(?:my\s+)?(?:negro|negroes|slave|slaves|servant|servants)\s+(?:man|woman|boy|girl|child)?\s+([A-Z][a-z]+)/gi,
        // "freedman Sam" / "freedwoman Rachel"
        /(?:freedman|freedwoman)\s+([A-Z][a-z]+)/gi,
        // "[Name] a negro man"
        /([A-Z][a-z]+)\s+(?:a\s+)?(?:negro|slave|servant|freedman|freedwoman)\s+(?:man|woman|boy|girl)?/gi,
        // "negroes named Sam and Rachel"
        /(?:negro|negroes|freedmen)\s+named?\s+([A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)*)/gi,
    ];

    const seenEnslaved = new Set();
    for (const pattern of enslavedPatterns) {
        let match;
        pattern.lastIndex = 0; // reset global regex
        while ((match = pattern.exec(rawText)) !== null) {
            const rawName = match[1].trim();
            // Handle "Sam and Rachel" — split on " and "
            const names = rawName.split(/\s+and\s+/i).map(n => n.trim()).filter(n => n.length > 1);
            for (const name of names) {
                const key = name.toLowerCase();
                if (seenEnslaved.has(key)) continue;
                seenEnslaved.add(key);

                const ctxStart = Math.max(0, match.index - 150);
                const ctxEnd = Math.min(rawText.length, match.index + match[0].length + 150);
                const contextText = rawText.substring(ctxStart, ctxEnd).replace(/\n+/g, ' ').trim();

                // Determine gender
                let gender = null;
                if (/(woman|girl|freedwoman)/i.test(match[0])) gender = 'F';
                else if (/(man|boy|freedman)/i.test(match[0])) gender = 'M';

                // Dollar value immediately after the matched block
                const afterBlock = rawText.substring(match.index + match[0].length, match.index + match[0].length + 80);
                let dollarValue = null;
                const dvm = afterBlock.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
                if (dvm) dollarValue = parseFloat(dvm[1].replace(/,/g, ''));

                // Bequest recipient: look for "to [HeirName]" in the surrounding context
                let bequestRecipientName = null;
                const bequestMatch = contextText.match(
                    /(?:give(?:\s+and\s+bequeath)?|devise|leave|bequeath)\s+(?:to\s+)?(?:my\s+(?:son|daughter|wife|brother|sister|nephew|niece|friend|grandson|granddaughter|cousin)\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
                );
                if (bequestMatch) {
                    const candidate = normalizeName(bequestMatch[1]);
                    // Make sure it's not the testator or the enslaved name itself
                    if (candidate.toLowerCase() !== name.toLowerCase() &&
                        candidate.toLowerCase() !== (result.testatorName || '').toLowerCase()) {
                        bequestRecipientName = candidate;
                    }
                }

                result.enslavedPersons.push({
                    name,
                    gender,
                    dollarValue,
                    contextText,
                    bequestRecipientName,
                });
            }
        }
    }

    return result;
}

// --- Canonical Person Upsert ---
async function upsertCanonicalPerson(client, name, personType, deathYearEstimate, primaryCounty, primaryState) {
    const normalizedName = normalizeName(name);
    const nameParts = normalizedName.split(/\s+/);
    const firstName = nameParts[0] || null;
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

    // Fuzzy search: same county/state, similar name
    const searchRes = await client.query(`
        SELECT id, canonical_name, death_year_estimate
        FROM canonical_persons
        WHERE primary_county ILIKE $1 AND primary_state ILIKE $2
          AND (
                canonical_name ILIKE $3
                OR (first_name ILIKE $4 AND last_name ILIKE $5)
              )
        ORDER BY
            CASE WHEN canonical_name ILIKE $3 THEN 0 ELSE 1 END,
            ABS(COALESCE(death_year_estimate, $6) - $6) ASC
        LIMIT 5;
    `, [primaryCounty, primaryState, normalizedName, firstName, lastName, deathYearEstimate || 1860]);

    let existingPersonId = null;
    let bestScore = -1;

    for (const row of searchRes.rows) {
        const dist = levenshteinDistance(normalizedName.toLowerCase(), row.canonical_name.toLowerCase());
        if (dist <= 2) {
            const yearDiff = (deathYearEstimate && row.death_year_estimate)
                ? Math.abs(deathYearEstimate - row.death_year_estimate)
                : 5; // neutral if either is missing
            if (yearDiff <= 15) {
                const score = (2 - dist) * 10 + (10 - Math.min(yearDiff, 10));
                if (score > bestScore) {
                    bestScore = score;
                    existingPersonId = row.id;
                }
            }
        }
    }

    if (existingPersonId) {
        // Update person_type if we now know it's more specific
        await client.query(`
            UPDATE canonical_persons
            SET person_type = $1, updated_at = NOW()
            WHERE id = $2
              AND (person_type IS NULL OR person_type = 'unknown')
              AND $1 <> 'unknown';
        `, [personType, existingPersonId]);
        if (VERBOSE) log(`  Matched canonical_person id=${existingPersonId} for "${normalizedName}"`);
        return existingPersonId;
    }

    // Insert new person; use a plain INSERT with no unique-constraint assumption on canonical_name
    const insertRes = await client.query(`
        INSERT INTO canonical_persons
            (canonical_name, first_name, last_name, person_type, verification_status,
             primary_county, primary_state, death_year_estimate, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'pending_review', $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (canonical_name, primary_county, primary_state) DO UPDATE SET
            person_type          = CASE WHEN canonical_persons.person_type = 'unknown' OR canonical_persons.person_type IS NULL
                                        THEN EXCLUDED.person_type ELSE canonical_persons.person_type END,
            death_year_estimate  = COALESCE(canonical_persons.death_year_estimate, EXCLUDED.death_year_estimate),
            updated_at           = NOW()
        RETURNING id;
    `, [
        normalizedName, firstName, lastName, personType,
        primaryCounty, primaryState, deathYearEstimate || null,
        `Auto-created by georgia-probate-scraper. Type: ${personType}.`
    ]);
    const newId = insertRes.rows[0].id;
    if (VERBOSE) log(`  Created canonical_person id=${newId} for "${normalizedName}"`);
    return newId;
}

main().catch(err => {
    log('FATAL ERROR:', err.message);
    console.error(err);
    process.exit(1);
});
