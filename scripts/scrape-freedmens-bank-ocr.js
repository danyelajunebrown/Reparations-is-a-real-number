#!/usr/bin/env node
/**
 * Freedmen's Bank Records — Image-Based OCR Scraper
 *
 * Navigates the FamilySearch image viewer for collection 1417695,
 * screenshots each register page, runs Google Vision OCR, and parses
 * the handwritten depositor records.
 *
 * Register format (from introduction):
 *   Account number, name of depositor, date of entry, place born,
 *   place brought up, residence, age, complexion, name of employer
 *   or occupation, wife or husband, children, father, mother,
 *   brothers and sisters, remarks, and signature.
 *   Early books also contain: name of former master/mistress, plantation name.
 *
 * Each record creates BOTH:
 *   - A freedperson entry in unconfirmed_persons
 *   - An enslaver entry in canonical_persons (if former master is named)
 *   - A family_relationships edge linking them
 *
 * Connects to Chrome on port 9222 (must be logged into FamilySearch).
 *
 * Usage:
 *   node scripts/scrape-freedmens-bank-ocr.js --branch "Atlanta, Georgia"
 *   node scripts/scrape-freedmens-bank-ocr.js --branch "Washington D. C." --start 20 --limit 100
 *   node scripts/scrape-freedmens-bank-ocr.js --dry-run --branch "Atlanta, Georgia"
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const puppeteer = require('puppeteer-core');
const { neon } = require('@neondatabase/serverless');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

const branchIdx = process.argv.indexOf('--branch');
const BRANCH = branchIdx !== -1 ? process.argv[branchIdx + 1] : 'Atlanta, Georgia';
const startIdx = process.argv.indexOf('--start');
const START_IMAGE = startIdx !== -1 ? parseInt(process.argv[startIdx + 1]) : 10; // Skip intro pages
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1]) : 500;

const SOURCE_CITATION = "United States, Freedman's Bank Records, 1865-1874. FamilySearch Collection 1417695. NARA RG 101, Microfilm M816.";

// Branch → Roll ARK mapping (from the index page)
const BRANCH_ARKS = {
    'Atlanta, Georgia': { ark: '3:1:S3HY-6723-K4V', totalImages: 612, roll: 6, waypoint: '3MDR-GPX:1551795103,1551795101' },
    'Washington D. C.': { ark: '3:1:S3HY-X4XC-34', totalImages: 841, roll: 4, waypoint: '3MDR-RM9:1551794703,1551800972' },
    // Add more branches as needed — each has its own ARK
};

let sql, browser, page;

const stats = {
    imagesProcessed: 0,
    recordsFound: 0,
    freedpersonsStored: 0,
    enslaversStored: 0,
    withFormerMaster: 0,
    ocrErrors: 0,
    parseErrors: 0,
    startTime: Date.now()
};

async function init() {
    sql = neon(DATABASE_URL);
    browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1200 });
}

/**
 * Navigate to a specific image in the viewer.
 * Uses the page number input or keyboard navigation.
 */
async function navigateToImage(imageNumber) {
    const branchInfo = BRANCH_ARKS[BRANCH];
    if (!branchInfo) throw new Error('Unknown branch: ' + BRANCH);

    // Navigate to the image viewer with the specific image index
    const url = `https://www.familysearch.org/ark:/61903/${branchInfo.ark}?cc=1417695&i=${imageNumber}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    // Verify we're on the right image
    const currentImg = await page.evaluate(() => {
        const text = document.body.innerText;
        const match = text.match(/Image\s*(\d+)\s*of\s*(\d+)/);
        return match ? { current: parseInt(match[1]), total: parseInt(match[2]) } : null;
    });

    return currentImg;
}

/**
 * Screenshot the current viewer page and run Google Vision OCR.
 */
async function ocrCurrentPage() {
    // First, check if FamilySearch has a transcript for this page
    // (DC and some other branches have volunteer-transcribed text)
    const transcript = await page.evaluate(() => {
        // Look for the transcript panel content
        const showTrans = document.body.innerText.indexOf('Show Translation');
        if (showTrans > -1) {
            const text = document.body.innerText.substring(showTrans + 16);
            // Check if there's actual content (not just a DGS number)
            if (text.trim().length > 100 && /Name of Master|Record for|Date.*Application/i.test(text)) {
                return text.substring(0, 10000); // Cap at 10K chars
            }
        }
        return null;
    });

    if (transcript) {
        console.log(' [transcript]');
        return transcript;
    }

    // No transcript — fall back to screenshot + Google Vision OCR
    const screenshotPath = path.resolve(__dirname, '../storage/temp-ocr/freedmens-current.png');
    await page.screenshot({ path: screenshotPath });

    const imgBuffer = fs.readFileSync(screenshotPath);
    const base64 = imgBuffer.toString('base64');

    try {
        const res = await axios.post(
            `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
            {
                requests: [{
                    image: { content: base64 },
                    features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }]
                }]
            },
            { timeout: 30000 }
        );

        const annotation = res.data.responses[0];
        if (annotation.error) {
            stats.ocrErrors++;
            return null;
        }

        return annotation.fullTextAnnotation?.text || '';
    } catch (err) {
        stats.ocrErrors++;
        return null;
    }
}

/**
 * Parse OCR text from a Freedmen's Bank register page.
 *
 * The register is structured in a grid format with labeled fields.
 * OCR output is a flat text block — we look for field markers:
 *   "Record for [NAME]"
 *   "Date of Application"
 *   "Where born" / "Born"
 *   "Residence"
 *   "Complexion" / "Complain" (OCR variant)
 *   "Occupation"
 *   "Works for"
 *   "Wife" / "Husband"
 *   "Children" / "Childr"
 *   "Father"
 *   "Mother"
 *   "Brothers" / "Sisters"
 *   "Former master" / "Master" / "Mistress"
 *   "Plantation"
 */
function parseFreedmensBankOCR(ocrText, imageNumber) {
    const records = [];
    if (!ocrText || ocrText.length < 100) return records;

    // Detect format: DC-style ("Name of Master") vs Atlanta-style ("Record for [NAME]")
    const hasMasterField = /Name of Master/i.test(ocrText);

    if (hasMasterField) {
        return parseDCFormat(ocrText, imageNumber);
    }

    // Split into individual records by "Record for" markers
    const recordBlocks = ocrText.split(/Record for\s+/i).slice(1); // Skip text before first "Record for"

    for (const block of recordBlocks) {
        const record = {
            rawText: block.substring(0, 500),
            imageNumber,
            branch: BRANCH
        };

        // Extract name (first line after "Record for")
        const nameMatch = block.match(/^([A-Z][a-zA-Z\s.]+?)(?:\n|\d|Date|Where|Born)/);
        record.name = nameMatch ? nameMatch[1].trim() : null;

        // If no name from "Record for", try to find it differently
        if (!record.name || record.name.length < 3) {
            const altName = block.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+)/);
            record.name = altName ? altName[1].trim() : null;
        }

        // Date of application
        const dateMatch = block.match(/Date of Application\s*[:\-]?\s*([A-Za-z]+\.?\s*\d+[\s,.]+\d{4})/i);
        record.date = dateMatch ? dateMatch[1].trim() : null;

        // Where born / born
        const bornMatch = block.match(/(?:Where\s*)?born\s*[:\-]?\s*([A-Za-z\s,.']+?)(?:\n|Where|Resid|Comp|Occup)/i);
        record.birthPlace = bornMatch ? bornMatch[1].trim() : null;

        // Residence
        const resMatch = block.match(/Resid(?:en(?:ce|t))?\s*[:\-]?\s*([A-Za-z\s,.']+?)(?:\n|Comp|Occup|Age)/i);
        record.residence = resMatch ? resMatch[1].trim() : null;

        // Complexion (OCR often reads as "Complain" or "Compl")
        const compMatch = block.match(/Comp(?:l(?:ex|ain|a))?\s*(?:ion)?\s*[:\-]?\s*([A-Za-z\s]+?)(?:\n|Occup|Works|Wife|Husb)/i);
        record.complexion = compMatch ? compMatch[1].trim() : null;

        // Occupation
        const occMatch = block.match(/Occup(?:ation)?\s*[:\-]?\s*([A-Za-z\s.']+?)(?:\n|Works|Wife|Husb|Child|Fath|Moth)/i);
        record.occupation = occMatch ? occMatch[1].trim() : null;

        // Works for (employer)
        const worksMatch = block.match(/Works\s*for\s*[:\-]?\s*([A-Za-z\s.']+?)(?:\n|Wife|Husb|Child)/i);
        record.employer = worksMatch ? worksMatch[1].trim() : null;

        // Wife / Husband
        const spouseMatch = block.match(/(?:Wife|Husband|wife|husband)\s*[:\-]?\s*([A-Za-z\s.']+?)(?:\n|Child|Fath|Moth)/i);
        record.spouse = spouseMatch ? spouseMatch[1].trim() : null;

        // Children
        const childMatch = block.match(/Child(?:r(?:en)?)?\s*[:\-]?\s*([A-Za-z\s,.']+?)(?:\n|Fath|Moth|Broth|Sist|Remark)/i);
        record.children = childMatch ? childMatch[1].trim() : null;

        // Father
        const fatherMatch = block.match(/Fath(?:er)?\s*[:\-]?\s*([A-Za-z\s.']+?)(?:\n|Moth|Broth|Sist|Remark)/i);
        record.father = fatherMatch ? fatherMatch[1].trim() : null;

        // Mother
        const motherMatch = block.match(/Moth(?:er)?\s*[:\-]?\s*([A-Za-z\s.']+?)(?:\n|Broth|Sist|Remark|Fath)/i);
        record.mother = motherMatch ? motherMatch[1].trim() : null;

        // Former master / mistress (THE KEY FIELD)
        const masterMatch = block.match(/(?:Former\s*)?(?:Master|Mistress|master|mistress)\s*[:\-]?\s*([A-Za-z\s.']+?)(?:\n|Plant|Remark|Signature)/i);
        record.formerMaster = masterMatch ? masterMatch[1].trim() : null;

        // Plantation
        const plantMatch = block.match(/Plant(?:ation)?\s*[:\-]?\s*([A-Za-z\s.']+?)(?:\n|Remark|Signature)/i);
        record.plantation = plantMatch ? plantMatch[1].trim() : null;

        if (record.name && record.name.length >= 3) {
            records.push(record);
        }
    }

    return records;
}

/**
 * Parse DC-format Freedmen's Bank records.
 * These have explicit "Name of Master" / "Name of Mistress" / "Plantation" fields.
 * Each page can have 8+ registries. Records split on "Record for" / "Recd for" / "Second for" / "come for".
 *
 * Sample format (from Washington DC, Roll 4, Image 13):
 *   "come for Thomas Pence 13. Date, and No of appliance Sep 24 1865
 *    Name of Master, William Burroughs Name of Mistress bury
 *    Plantation, Height, and Complexion, 5 feet is Gellone
 *    Father or Mother Matried P Grandmother Name of Children,
 *    Regiment and Company, has Place of Birth, Prince George C
 *    Residence, Freedman Hospital 7th Occupation, Government Service
 *    REMARKS, He desires that in case of his death his money..."
 */
function parseDCFormat(ocrText, imageNumber) {
    const records = [];

    // Split on record boundaries
    const blocks = ocrText.split(/(?:Record|Recd|Second|come)\s+(?:for|Son)\s+/i).slice(1);

    for (const block of blocks) {
        const record = {
            rawText: block.substring(0, 600),
            imageNumber,
            branch: BRANCH
        };

        // Name (first words before date/number)
        const nameMatch = block.match(/^([A-Z][a-zA-Z\s.]+?)(?:\d|Date|\.)/);
        record.name = nameMatch ? nameMatch[1].trim() : null;

        // Date of application
        const dateMatch = block.match(/Date\s*,?\s*(?:and\s*(?:No?\s*)?(?:of)?\s*)?(?:application|appliance)?\s*,?\s*([A-Za-z]+\.?\s*\d+[\s,.]*\d{4})/i);
        record.date = dateMatch ? dateMatch[1].trim() : null;

        // Name of Master — THE KEY FIELD
        const masterMatch = block.match(/Name\s*of\s*Master\s*[,:\-]?\s*([A-Za-z\s.']+?)(?:\s*Name\s*of\s*Mistress|Plantation|Height|$)/i);
        record.formerMaster = masterMatch ? masterMatch[1].trim() : null;
        // Clean up junk
        if (record.formerMaster && record.formerMaster.length < 3) record.formerMaster = null;

        // Name of Mistress
        const mistressMatch = block.match(/Name\s*of\s*Mistress\s*[,:\-]?\s*([A-Za-z\s.']+?)(?:\s*Plantation|Height|$)/i);
        record.mistress = mistressMatch ? mistressMatch[1].trim() : null;

        // Plantation
        const plantMatch = block.match(/Plantation\s*[,:\-]?\s*([A-Za-z\s.']+?)(?:\s*Height|Complexion|$)/i);
        record.plantation = plantMatch ? plantMatch[1].trim() : null;

        // Complexion
        const compMatch = block.match(/Complexion\s*[,:\-]?\s*([A-Za-z\s.'0-9]+?)(?:\s*Father|Mother|Name of|Married|$)/i);
        record.complexion = compMatch ? compMatch[1].trim() : null;

        // Place of Birth
        const birthMatch = block.match(/Place\s*of\s*Birth\s*[,:\-]?\s*([A-Za-z\s.']+?)(?:\s*Residence|Occupation|$)/i);
        record.birthPlace = birthMatch ? birthMatch[1].trim() : null;

        // Residence
        const resMatch = block.match(/Residence\s*[,:\-]?\s*([A-Za-z\s.'0-9]+?)(?:\s*Occupation|REMARKS|$)/i);
        record.residence = resMatch ? resMatch[1].trim() : null;

        // Occupation
        const occMatch = block.match(/Occupation\s*[,:\-]?\s*([A-Za-z\s.']+?)(?:\s*REMARKS|$)/i);
        record.occupation = occMatch ? occMatch[1].trim() : null;

        // Father or Mother
        const parentMatch = block.match(/Father\s*(?:or\s*Mother)?\s*(?:Married?\s*P?)?\s*([A-Za-z\s.']+?)(?:\s*(?:Grand)?mother|Name\s*of\s*Children|Regiment|$)/i);
        record.father = parentMatch ? parentMatch[1].trim() : null;

        // Grandmother (DC format sometimes has this)
        const grandmaMatch = block.match(/Grandmother\s*[,:\-]?\s*([A-Za-z\s.']+?)(?:\s*Name\s*of|Regiment|$)/i);
        record.grandmother = grandmaMatch ? grandmaMatch[1].trim() : null;

        // Name of Children
        const childMatch = block.match(/Name\s*of\s*Children\s*[,:\-]?\s*([A-Za-z\s,.']+?)(?:\s*Regiment|Place|$)/i);
        record.children = childMatch ? childMatch[1].trim() : null;

        // Regiment and Company (USCT service)
        const regMatch = block.match(/Regiment\s*(?:and\s*)?Company\s*[,:\-]?\s*([A-Za-z\s.'0-9]+?)(?:\s*Place|has|$)/i);
        record.regiment = regMatch ? regMatch[1].trim() : null;

        // Wife/Husband from "Married" context
        const spouseMatch = block.match(/(?:wife|husband)\s+([A-Za-z\s.']+?)(?:\s*Name|Children|$)/i);
        record.spouse = spouseMatch ? spouseMatch[1].trim() : null;

        if (record.name && record.name.length >= 3) {
            records.push(record);
        }
    }

    return records;
}

/**
 * Store a parsed record in the database.
 * Creates BOTH the freedperson AND the enslaver, linked.
 */
async function storeRecord(record) {
    if (DRY_RUN) {
        console.log(`  [DRY] ${record.name} | master: ${record.formerMaster || 'N/A'} | ${record.residence || '?'}`);
        stats.freedpersonsStored++;
        if (record.formerMaster) stats.withFormerMaster++;
        return;
    }

    try {
        const contextText = [
            `Freedman's Bank depositor, ${BRANCH}`,
            record.date ? `Date: ${record.date}` : null,
            record.residence ? `Residence: ${record.residence}` : null,
            record.birthPlace ? `Born: ${record.birthPlace}` : null,
            record.complexion ? `Complexion: ${record.complexion}` : null,
            record.occupation ? `Occupation: ${record.occupation}` : null,
            record.employer ? `Employer: ${record.employer}` : null,
            record.formerMaster ? `Former master: ${record.formerMaster}` : null,
            record.plantation ? `Plantation: ${record.plantation}` : null,
            record.spouse ? `Spouse: ${record.spouse}` : null,
            `Image ${record.imageNumber} of ${BRANCH} register`
        ].filter(Boolean).join('. ');

        // Store the freedperson
        const fpResult = await sql`
            INSERT INTO unconfirmed_persons (
                full_name, person_type, locations,
                source_url, source_page_title, extraction_method,
                context_text, confidence_score, source_type,
                relationships
            ) VALUES (
                ${record.name},
                'freedperson',
                ${record.residence ? [record.residence + ', ' + BRANCH.split(',')[1]?.trim() || ''] : [BRANCH]},
                ${'https://www.familysearch.org/en/search/collection/1417695'},
                ${"Freedman's Bank Records — " + BRANCH},
                ${'freedmens_bank_ocr'},
                ${contextText},
                ${0.75},
                ${'bank_record'},
                ${JSON.stringify({
                    former_enslaver: record.formerMaster || null,
                    plantation: record.plantation || null,
                    spouse: record.spouse || null,
                    children: record.children || null,
                    father: record.father || null,
                    mother: record.mother || null,
                    employer: record.employer || null,
                    complexion: record.complexion || null,
                    occupation: record.occupation || null,
                    birth_place: record.birthPlace || null,
                    application_date: record.date || null,
                    branch: BRANCH,
                    image_number: record.imageNumber,
                    citation: SOURCE_CITATION
                })}
            ) RETURNING lead_id
        `;
        stats.freedpersonsStored++;

        // If former master is named, create/find the enslaver
        if (record.formerMaster && record.formerMaster.length > 3) {
            stats.withFormerMaster++;

            const enslaverName = record.formerMaster;
            const parts = enslaverName.split(/\s+/);

            // Check if enslaver already exists
            const existing = await sql`
                SELECT id FROM canonical_persons
                WHERE LOWER(canonical_name) = LOWER(${enslaverName})
                AND person_type = 'enslaver'
                LIMIT 1
            `;

            let enslaverId;
            if (existing.length > 0) {
                enslaverId = existing[0].id;
            } else {
                const newEnslaver = await sql`
                    INSERT INTO canonical_persons (
                        canonical_name, first_name, last_name,
                        person_type, confidence_score, verification_status,
                        notes, created_by
                    ) VALUES (
                        ${enslaverName},
                        ${parts[0] || ''},
                        ${parts[parts.length - 1] || ''},
                        'enslaver', 0.80, 'unverified',
                        ${"Named as former master by Freedman's Bank depositor " + record.name + ". " + BRANCH + ". " + SOURCE_CITATION},
                        'scrape-freedmens-bank-ocr.js'
                    ) RETURNING id
                `;
                enslaverId = newEnslaver[0].id;
                stats.enslaversStored++;
            }

            // Create the family_relationships edge
            if (fpResult.length > 0 && enslaverId) {
                await sql`
                    INSERT INTO family_relationships (
                        person1_name, person1_role, person1_lead_id,
                        person2_name, person2_role, person2_lead_id,
                        relationship_type, source_url, confidence
                    ) VALUES (
                        ${enslaverName}, 'enslaver', ${enslaverId},
                        ${record.name}, 'freedperson', ${fpResult[0].lead_id},
                        'enslaved_by',
                        ${'https://www.familysearch.org/en/search/collection/1417695'},
                        0.80
                    )
                `;
            }
        }
    } catch (e) {
        stats.parseErrors++;
    }
}

async function main() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  FREEDMEN'S BANK OCR SCRAPER`);
    console.log(`  Branch: ${BRANCH}`);
    console.log(`  Start image: ${START_IMAGE}`);
    console.log(`  Limit: ${LIMIT} images`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'='.repeat(60)}\n`);

    await init();
    console.log('Connected to Chrome + database\n');

    const branchInfo = BRANCH_ARKS[BRANCH];
    if (!branchInfo) {
        console.log('Unknown branch. Available: ' + Object.keys(BRANCH_ARKS).join(', '));
        process.exit(1);
    }

    const endImage = Math.min(START_IMAGE + LIMIT, branchInfo.totalImages);

    // Navigate to starting image
    console.log(`Navigating to image ${START_IMAGE}...`);
    const initial = await navigateToImage(START_IMAGE);
    console.log('Current position: ' + JSON.stringify(initial));

    // Process images
    for (let i = START_IMAGE; i < endImage; i++) {
        process.stdout.write(`\r  Image ${i}/${endImage} — ${stats.recordsFound} records, ${stats.freedpersonsStored} stored, ${stats.withFormerMaster} with master`);

        // Navigate to this image
        if (i > START_IMAGE) {
            // Use right arrow to advance one page
            await page.keyboard.press('ArrowRight');
            await new Promise(r => setTimeout(r, 3000)); // Wait for image to load
        }

        // OCR the current page
        const ocrText = await ocrCurrentPage();
        if (!ocrText) continue;

        stats.imagesProcessed++;

        // Skip if this looks like an intro/index page
        if (!ocrText.match(/Record for|Recd for|come for|Second for|Date.*Applic|Name of Master|Residence|Complexion|Occupation/i)) {
            continue; // Not a depositor register page
        }

        // Parse records from OCR text
        const records = parseFreedmensBankOCR(ocrText, i);
        stats.recordsFound += records.length;

        // Store each record
        for (const record of records) {
            await storeRecord(record);
        }
    }

    // Register source document
    if (!DRY_RUN) {
        const docExists = await sql`
            SELECT id FROM person_documents
            WHERE name_as_appears = ${"Freedman's Bank Records — " + BRANCH}
            LIMIT 1
        `;
        if (docExists.length === 0) {
            await sql`
                INSERT INTO person_documents (
                    name_as_appears, source_url, source_type,
                    collection_name, document_type, page_reference,
                    person_type, extraction_confidence, created_by
                ) VALUES (
                    ${"Freedman's Bank Records — " + BRANCH},
                    ${'https://www.familysearch.org/en/search/collection/1417695'},
                    ${'bank_record'},
                    ${'population-records'},
                    ${'freedmens_bank'},
                    ${branchInfo.totalImages + ' images, Roll ' + branchInfo.roll},
                    ${'freedperson'},
                    ${0.75},
                    ${'scrape-freedmens-bank-ocr.js'}
                )
            `;
        }
    }

    await page.close();

    const elapsed = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
    console.log(`\n\n${'='.repeat(60)}`);
    console.log(`  SCRAPE COMPLETE — ${BRANCH}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Images processed:     ${stats.imagesProcessed}`);
    console.log(`  Records found:        ${stats.recordsFound}`);
    console.log(`  Freedpersons stored:  ${stats.freedpersonsStored}`);
    console.log(`  Enslavers stored:     ${stats.enslaversStored}`);
    console.log(`  With former master:   ${stats.withFormerMaster}`);
    console.log(`  OCR errors:           ${stats.ocrErrors}`);
    console.log(`  Parse errors:         ${stats.parseErrors}`);
    console.log(`  Elapsed:              ${elapsed} minutes`);
    console.log('');
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
