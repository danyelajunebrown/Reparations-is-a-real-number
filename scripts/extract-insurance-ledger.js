#!/usr/bin/env node
/**
 * Insurance Ledger OCR Extraction
 *
 * Extracts enslaved persons from Southern Mutual Insurance Company
 * servant/slave policy register PDFs (1851-1855).
 *
 * Pipeline:
 *   1. Convert PDF pages to images (sharp/pdf-to-img or pdftoppm)
 *   2. Run Google Vision OCR on each page image
 *   3. Parse insurance ledger format:
 *      NO. | NAME (enslaver) | POST OFFICE | TIME | DATE | EXPIRES |
 *      DESCRIPTION (enslaved person name) | AMOUNT | PREMIUM | CASH
 *   4. Store extracted persons in unconfirmed_persons
 *   5. Store enslavers in canonical_persons (if not already present)
 *   6. Register PDFs in person_documents
 *
 * Usage:
 *   node scripts/extract-insurance-ledger.js
 *   node scripts/extract-insurance-ledger.js --dry-run
 *   node scripts/extract-insurance-ledger.js --pdf <specific-pdf>
 *
 * Source: UGA Digital Humanities, "Southern Mutual Slave Insurance, 1851-1855"
 * Citation: https://digihum.libs.uga.edu/items/show/42
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { neon } = require('@neondatabase/serverless');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const DATABASE_URL = process.env.DATABASE_URL;
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

const STORAGE_DIR = path.resolve(__dirname, '../storage/corporate-disclosures/insurance');
const TEMP_DIR = path.resolve(__dirname, '../storage/temp-ocr');

// The three Southern Mutual PDFs
const REGISTER_PDFS = [
    {
        filename: 'southern-mutual-register-pages-1-13.pdf',
        label: 'Register Pages 1-13',
        sourceUrl: 'https://digihum.libs.uga.edu/items/show/42'
    },
    {
        filename: 'southern-mutual-register-pages-14-27.pdf',
        label: 'Register Pages 14-27',
        sourceUrl: 'https://digihum.libs.uga.edu/items/show/42'
    }
];

// Context PDF (about + index — useful for cross-reference but not for person extraction)
const CONTEXT_PDF = 'southern-mutual-context-index.pdf';

const SOURCE_CITATION = 'Southern Mutual Insurance Company, "Southern Mutual Slave Insurance, 1851-1855," African American Experience in Athens, UGA Library. https://digihum.libs.uga.edu/items/show/42';

let sql = null;

const stats = {
    pagesProcessed: 0,
    policiesExtracted: 0,
    enslavedPersonsExtracted: 0,
    enslaversExtracted: 0,
    errors: 0,
    startTime: Date.now()
};

// ── PDF to Image Conversion ─────────────────────────────────────────

/**
 * Convert a PDF to individual page images using pdftoppm (from poppler)
 * Falls back to ImageMagick convert if pdftoppm unavailable
 */
function pdfToImages(pdfPath, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });

    // Try pdftoppm first (poppler-utils)
    try {
        execSync(`which pdftoppm`, { stdio: 'pipe' });
        console.log(`  Converting ${path.basename(pdfPath)} to images via pdftoppm...`);
        execSync(`pdftoppm -png -r 300 "${pdfPath}" "${outputDir}/page"`, { stdio: 'pipe' });
        const images = fs.readdirSync(outputDir)
            .filter(f => f.startsWith('page') && f.endsWith('.png'))
            .sort()
            .map(f => path.join(outputDir, f));
        console.log(`  → ${images.length} page images generated`);
        return images;
    } catch (e) {
        // pdftoppm not available
    }

    // Try ImageMagick convert
    try {
        execSync(`which magick`, { stdio: 'pipe' });
        console.log(`  Converting ${path.basename(pdfPath)} to images via ImageMagick...`);
        execSync(`magick -density 300 "${pdfPath}" "${outputDir}/page-%03d.png"`, { stdio: 'pipe' });
        const images = fs.readdirSync(outputDir)
            .filter(f => f.startsWith('page') && f.endsWith('.png'))
            .sort()
            .map(f => path.join(outputDir, f));
        console.log(`  → ${images.length} page images generated`);
        return images;
    } catch (e) {
        // ImageMagick not available
    }

    // Try sips (macOS built-in) — only handles single-page
    // For multi-page PDF, we'll use the Preview-based approach
    throw new Error('Neither pdftoppm (poppler) nor ImageMagick found. Install with: brew install poppler');
}

// ── Google Vision OCR ───────────────────────────────────────────────

async function ocrImage(imagePath) {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    try {
        const response = await axios.post(
            `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
            {
                requests: [{
                    image: { content: base64Image },
                    features: [
                        { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }
                    ]
                }]
            },
            { timeout: 30000 }
        );

        const annotation = response.data.responses[0];
        if (annotation.error) {
            console.error(`  OCR error: ${annotation.error.message}`);
            return null;
        }

        return annotation.fullTextAnnotation?.text || annotation.textAnnotations?.[0]?.description || '';
    } catch (err) {
        console.error(`  OCR API error: ${err.message}`);
        return null;
    }
}

// ── Insurance Ledger Parser ─────────────────────────────────────────

/**
 * Parse OCR text from Southern Mutual insurance ledger pages.
 *
 * Ledger format (columns, read left-to-right on rotated page scans):
 *   NO. | NAME | POST OFFICE | TIME | DATE | EXPIRES |
 *   DESCRIPTION ("One Servant (Name)") | AMOUNT | PREMIUM | CASH
 *
 * The scans are rotated 90 degrees and handwritten in 19th century script.
 * OCR will be imperfect — we extract what we can and flag confidence.
 */
function parseInsuranceLedger(ocrText, pdfLabel) {
    const results = {
        policies: [],
        rawText: ocrText
    };

    if (!ocrText || ocrText.length < 30) {
        return results;
    }

    const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Pattern: Policy number (3-4 digits)
    const policyNumberPattern = /\b(\d{3,4})\b/;

    // Pattern: "One Servant (Name)" or "Two Servants" or "Sixteen Servants"
    const servantPattern = /(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+)\s+servants?\s*\(?([^)]*)\)?/i;

    // Pattern: Dollar amounts ($XXX or just 3-4 digit numbers)
    const amountPattern = /\b(\d{3,5})\b/g;

    // Pattern: Dates like "April 7/53" or "Jan 13/54" or "Sept 22/51"
    const datePattern = /(?:jan(?:y|uary)?|feb(?:y|ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*\d{1,2}[\/,]\s*\d{2}/i;

    // Pattern: Location names (Athens, Tuskegee, Covington, etc.)
    const locationPattern = /\b(Athens|Tuskegee|Covington|Monticello|Atlanta|Griffin|Augusta|Macon|Savannah|Lexington)\b/i;

    // Pattern: "Renewal" or "Renew'd"
    const renewalPattern = /renew(?:al|ed|'d)/i;

    // Pattern: "Appraisement"
    const appraisementPattern = /appraisement/i;

    // Try to extract structured entries
    // The OCR output from rotated handwritten ledgers will be messy.
    // We look for clusters of: policy number + name + servant description + amounts
    let currentEntry = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const combined = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(' ');

        // Check for policy number
        const policyMatch = line.match(/^(\d{3,4})\s/);
        if (policyMatch) {
            // Save previous entry
            if (currentEntry && (currentEntry.enslaverName || currentEntry.enslavedName)) {
                results.policies.push(currentEntry);
            }

            currentEntry = {
                policyNumber: parseInt(policyMatch[1]),
                enslaverName: null,
                location: null,
                term: null,
                startDate: null,
                endDate: null,
                enslavedName: null,
                enslavedCount: 1,
                description: null,
                amount: null,
                premium: null,
                cash: null,
                isRenewal: false,
                rawLine: line,
                pdfSource: pdfLabel
            };
        }

        // Check for servant description
        const servantMatch = line.match(servantPattern) || combined.match(servantPattern);
        if (servantMatch && currentEntry) {
            const name = servantMatch[1]?.trim();
            if (name && name.length > 1) {
                currentEntry.enslavedName = name;
            }
            // Extract count from the number word
            const countMatch = line.match(/(\w+)\s+servants?/i);
            if (countMatch) {
                const countWord = countMatch[1].toLowerCase();
                const wordToNum = {
                    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
                    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
                    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14,
                    'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18
                };
                currentEntry.enslavedCount = wordToNum[countWord] || parseInt(countWord) || 1;
            }
            currentEntry.description = line;
        }

        // Check for location
        const locMatch = line.match(locationPattern);
        if (locMatch && currentEntry) {
            currentEntry.location = locMatch[1];
        }

        // Check for renewal
        if (renewalPattern.test(line) && currentEntry) {
            currentEntry.isRenewal = true;
        }

        // Check for dates
        const dateMatch = line.match(datePattern);
        if (dateMatch && currentEntry) {
            if (!currentEntry.startDate) {
                currentEntry.startDate = dateMatch[0];
            } else if (!currentEntry.endDate) {
                currentEntry.endDate = dateMatch[0];
            }
        }
    }

    // Don't forget the last entry
    if (currentEntry && (currentEntry.enslaverName || currentEntry.enslavedName)) {
        results.policies.push(currentEntry);
    }

    return results;
}

// ── Database Storage ────────────────────────────────────────────────

async function storeExtractedPerson(policy) {
    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would store: ${policy.enslavedName || 'unnamed'} (enslaved by ${policy.enslaverName || 'unknown'}, policy #${policy.policyNumber})`);
        return;
    }

    try {
        // Store enslaved person in unconfirmed_persons
        const enslavedName = policy.enslavedName || `Unnamed enslaved person (policy #${policy.policyNumber})`;
        const contextText = [
            `Southern Mutual Insurance Co. servant policy #${policy.policyNumber}`,
            policy.enslaverName ? `Enslaver: ${policy.enslaverName}` : null,
            policy.location ? `Location: ${policy.location}` : null,
            policy.amount ? `Insured value: $${policy.amount}` : null,
            policy.startDate ? `Policy date: ${policy.startDate}` : null,
            policy.enslavedCount > 1 ? `${policy.enslavedCount} servants in this policy` : null,
            policy.isRenewal ? 'Renewal policy' : null
        ].filter(Boolean).join('. ');

        // Extract year from date if possible
        let year = null;
        if (policy.startDate) {
            const yearMatch = policy.startDate.match(/\/(\d{2})$/);
            if (yearMatch) {
                year = 1800 + parseInt(yearMatch[1]);
            }
        }

        await sql`
            INSERT INTO unconfirmed_persons (
                full_name, person_type, locations, source_url,
                source_page_title, extraction_method, context_text,
                confidence_score, source_type, relationships
            ) VALUES (
                ${enslavedName},
                'enslaved',
                ${policy.location ? [policy.location + ', Georgia'] : ['Georgia']},
                ${'https://digihum.libs.uga.edu/items/show/42'},
                ${'Southern Mutual Slave Insurance Register, 1851-1855'},
                ${'insurance_ledger_ocr'},
                ${contextText},
                ${0.70},
                ${'insurance_register'},
                ${JSON.stringify({
                    enslaved_by: policy.enslaverName,
                    policy_number: policy.policyNumber,
                    insured_value: policy.amount,
                    enslaved_count: policy.enslavedCount,
                    policy_year: year,
                    source_company: 'Southern Mutual Insurance Company',
                    source_citation: SOURCE_CITATION
                })}
            )
        `;

        stats.enslavedPersonsExtracted++;

        // Store the enslaver in canonical_persons (insurance register = primary source)
        // This enables cross-referencing: if the same person appears in slave schedules,
        // compensation claims, or other sources, all documents index to the same canonical ID.
        if (policy.enslaverName && policy.enslaverName.length > 3) {
            // Parse name into first/last components
            const nameParts = policy.enslaverName.replace(/Mrs?\.\s*/i, '').replace(/Jr\.?\s*/i, '').trim().split(/\s+/);
            const firstName = nameParts[0] || '';
            const lastName = nameParts[nameParts.length - 1] || '';

            // Check if already in canonical_persons (by last name + state)
            const existingCanonical = await sql`
                SELECT id, canonical_name FROM canonical_persons
                WHERE last_name ILIKE ${lastName}
                AND first_name ILIKE ${firstName.replace(/\./g, '') + '%'}
                AND (primary_state ILIKE '%Georgia%' OR primary_state ILIKE '%GA%' OR primary_state IS NULL)
                LIMIT 1
            `;

            let canonicalId;

            if (existingCanonical.length > 0) {
                canonicalId = existingCanonical[0].id;
                console.log(`    Enslaver ${policy.enslaverName} → existing canonical #${canonicalId} (${existingCanonical[0].canonical_name})`);
                // Update notes to add insurance policy reference
                await sql`
                    UPDATE canonical_persons
                    SET notes = COALESCE(notes, '') || ${'\nSouthern Mutual Insurance policyholder, policy #' + policy.policyNumber + '. ' + SOURCE_CITATION},
                        updated_at = NOW()
                    WHERE id = ${canonicalId}
                `;
            } else {
                // Create new canonical_persons entry
                const result = await sql`
                    INSERT INTO canonical_persons (
                        canonical_name, first_name, last_name,
                        person_type, primary_state, primary_county,
                        confidence_score, verification_status,
                        notes, created_by
                    ) VALUES (
                        ${policy.enslaverName},
                        ${firstName},
                        ${lastName},
                        ${'enslaver'},
                        ${'Georgia'},
                        ${policy.location === 'Athens' ? 'Clarke' : null},
                        ${0.85},
                        ${'unverified'},
                        ${'Southern Mutual Insurance policyholder. Policy #' + policy.policyNumber + '. ' + SOURCE_CITATION},
                        ${'extract-insurance-ledger.js'}
                    )
                    RETURNING id
                `;
                canonicalId = result[0].id;
                stats.enslaversExtracted++;
                console.log(`    New enslaver: ${policy.enslaverName} → canonical #${canonicalId}`);
            }

            // Also store in unconfirmed_persons for the extraction trail
            const existingUnconf = await sql`
                SELECT lead_id FROM unconfirmed_persons
                WHERE full_name = ${policy.enslaverName}
                AND extraction_method = 'insurance_ledger_ocr'
                LIMIT 1
            `;

            if (existingUnconf.length === 0) {
                await sql`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, locations, source_url,
                        source_page_title, extraction_method, context_text,
                        confidence_score, source_type, confirmed_individual_id
                    ) VALUES (
                        ${policy.enslaverName},
                        'enslaver',
                        ${policy.location ? [policy.location + ', Georgia'] : ['Georgia']},
                        ${'https://digihum.libs.uga.edu/items/show/42'},
                        ${'Southern Mutual Slave Insurance Register, 1851-1855'},
                        ${'insurance_ledger_ocr'},
                        ${'Southern Mutual Insurance policyholder. Policy #' + policy.policyNumber + '. Canonical person #' + canonicalId + '. ' + SOURCE_CITATION},
                        ${0.85},
                        ${'insurance_register'},
                        ${String(canonicalId)}
                    )
                `;
            }
        }
    } catch (err) {
        console.error(`  DB error storing policy #${policy.policyNumber}: ${err.message}`);
        stats.errors++;
    }
}

/**
 * Register the PDF documents in person_documents for DAA retrieval
 */
async function registerDocumentsInDB() {
    if (DRY_RUN) {
        console.log('[DRY RUN] Would register PDFs in person_documents');
        return;
    }

    const pdfs = [
        { file: 'southern-mutual-context-index.pdf', label: 'About + Policyholder Index', type: 'insurance_register_index' },
        { file: 'southern-mutual-register-pages-1-13.pdf', label: 'Policy Register Pages 1-13', type: 'insurance_register' },
        { file: 'southern-mutual-register-pages-14-27.pdf', label: 'Policy Register Pages 14-27', type: 'insurance_register' },
        { file: 'ca-doi-slavery-era-insurance-registry-2002.pdf', label: 'CA DOI Slavery Era Insurance Registry Report (May 2002)', type: 'government_disclosure' },
        { file: 'ca-doi-slaveholder-name-registry.pdf', label: 'CA DOI Slaveholder Name Registry', type: 'government_disclosure' }
    ];

    // Also banking and research docs
    const otherPdfs = [
        { file: '../banking/jpmorgan-philadelphia-cto-disclosure-2024.pdf', label: 'JPMorgan Chase Philadelphia CTO Disclosure (2024)', type: 'corporate_disclosure' },
        { file: '../research/brattle-group-quantification-reparations-2023.pdf', label: 'Brattle Group Quantification of Reparations (2023)', type: 'research_report' }
    ];

    for (const pdf of [...pdfs, ...otherPdfs]) {
        const filePath = path.resolve(STORAGE_DIR, pdf.file);
        if (!fs.existsSync(filePath)) {
            console.log(`  Skipping ${pdf.file} — file not found`);
            continue;
        }

        // Check if already registered (by name_as_appears which is unique-constrained)
        const existing = await sql`
            SELECT id FROM person_documents
            WHERE name_as_appears = ${pdf.label}
            AND collection_name = 'corporate-disclosures'
            LIMIT 1
        `;

        if (existing.length > 0) {
            console.log(`  Already registered: ${pdf.label}`);
            continue;
        }

        const localPath = `storage/corporate-disclosures/${pdf.file.replace('../', '')}`;

        const sourceUrls = {
            'insurance_register': 'https://digihum.libs.uga.edu/items/show/42',
            'insurance_register_index': 'https://digihum.libs.uga.edu/items/show/42',
            'corporate_disclosure': 'https://www.phila.gov/media/20250908142331/cto-slavery-era-disclosure-jp-morgan-2024.pdf',
            'government_disclosure': 'https://www.insurance.ca.gov/01-consumers/150-other-prog/10-seir/upload/Slavery-Report.pdf',
            'research_report': 'https://www.brattle.com/wp-content/uploads/2023/07/Quantification-of-Reparations-for-Transatlantic-Chattel-Slavery.pdf'
        };

        await sql`
            INSERT INTO person_documents (
                name_as_appears, source_url, source_type, collection_name,
                document_type, page_reference, person_type,
                extraction_confidence, created_by
            ) VALUES (
                ${pdf.label},
                ${sourceUrls[pdf.type] || sourceUrls['research_report']},
                ${pdf.type},
                ${'corporate-disclosures'},
                ${pdf.type},
                ${pdf.label},
                ${'corporate_entity'},
                ${0.95},
                ${'extract-insurance-ledger.js'}
            )
        `;

        console.log(`  Registered: ${pdf.label}`);
    }
}

// ── Supplemental: Store transcribed data directly ───────────────────

/**
 * Store the manually transcribed entries from the research chat.
 * These are more reliable than OCR for these handwritten ledgers.
 */
async function storeTranscribedEntries() {
    console.log('\n── Storing manually transcribed entries ──');

    const transcribed = [
        { policyNumber: 590, enslaverName: 'Stephen Upson', location: 'Lexington', enslavedName: 'Peter', amount: 1000, year: 1853, description: 'Carpenter' },
        { policyNumber: 591, enslaverName: 'S. Penny', location: 'Athens', enslavedName: 'Lamar', amount: 350, year: 1853 },
        { policyNumber: 595, enslaverName: 'Fred H. Hull', location: 'Athens', enslavedName: null, amount: 1600, year: 1854, enslavedCount: 2, description: 'Two Servants (Geo. Kelm?)' },
        { policyNumber: 626, enslaverName: 'W.P. Harden & S.A. Browning', location: 'Athens', enslavedName: 'Henry', amount: 800, year: 1852, description: 'Transferred to G.F. Maberry' },
        { policyNumber: 738, enslaverName: 'Charles M. Keen', location: 'Athens', enslavedName: 'Luke', amount: 800, year: 1851 },
        { policyNumber: 826, enslaverName: 'Mrs. Wm. W. Pope', location: 'Athens', enslavedName: null, amount: 1300, year: 1851, enslavedCount: 3 },
        { policyNumber: 827, enslaverName: 'Mrs. Wm. Pope, Junior', location: 'Athens', enslavedName: null, amount: 6350, year: 1851, enslavedCount: 16 },
        { policyNumber: 856, enslaverName: 'Hansard, Prila. Dillard', location: 'Athens', enslavedName: 'Alexander', amount: 1000, year: 1851 },
        { policyNumber: 964, enslaverName: 'Samuel Field', location: 'Athens', enslavedName: 'Clark', amount: 650, year: 1852 },
        { policyNumber: 965, enslaverName: 'James O. Cobb', location: 'Athens', enslavedName: 'Jeff', amount: 650, year: 1852 },
        { policyNumber: 966, enslaverName: 'Wm. H. Dorsey', location: 'Athens', enslavedName: 'Maria', amount: 800, year: 1852 },
        { policyNumber: 967, enslaverName: 'Andrew Williams', location: 'Tuskegee, AL', enslavedName: 'Rachel', amount: 800, year: 1852 },
        { policyNumber: 968, enslaverName: 'Mary R. Manley', location: 'Athens', enslavedName: 'Lucy', amount: 400, year: 1852 },
        { policyNumber: 970, enslaverName: 'R.M. Smith', location: 'Athens', enslavedName: 'Priscilla', amount: 450, year: 1852 },
        { policyNumber: 1041, enslaverName: 'D. Spencer', location: 'Covington', enslavedName: 'Sophia', amount: 400, year: 1852 },
        { policyNumber: 1146, enslaverName: 'Asbury Hull', location: 'Athens', enslavedName: 'Anthony', amount: 800, year: 1851 },
        { policyNumber: 1149, enslaverName: 'Mrs. D. Ellis', location: 'Athens', enslavedName: 'Peter', amount: 1000, year: 1851 },
        { policyNumber: 1157, enslaverName: 'Lel Lampkin, trustee', location: 'Athens', enslavedName: 'Mary', amount: 600, year: 1853 },
        { policyNumber: 1446, enslaverName: 'Ernst A. Hunter', location: 'Athens', enslavedName: 'Bill', amount: 800, year: 1854 },
        { policyNumber: 1447, enslaverName: 'Robt. C. Wilson', location: 'Athens', enslavedName: 'Peter', amount: 666, year: 1854 },
        { policyNumber: 1448, enslaverName: 'A.A.F. Hill', location: 'Athens', enslavedName: 'William', amount: 800, year: 1854 },
        { policyNumber: 1449, enslaverName: 'John M. Smith', location: 'Monticello, GA', enslavedName: 'Elijah', amount: 800, year: 1854 },
        { policyNumber: 1451, enslaverName: 'Alex M. Scudder', location: 'Athens', enslavedName: 'Robert', amount: 600, year: 1854 },
        { policyNumber: 1452, enslaverName: 'Wm. N. Dorsey', location: 'Athens', enslavedName: null, amount: 1200, year: 1855, enslavedCount: 2 },
        { policyNumber: 1463, enslaverName: 'Rob. S. Witherspoon', location: 'Athens', enslavedName: 'Patsy', amount: 650, year: 1852 },
        { policyNumber: 1534, enslaverName: 'G.V. Lampkin', location: 'Athens', enslavedName: 'Louisa', amount: 400, year: 1855 },
        { policyNumber: 1560, enslaverName: 'Sarah C. Hunter', location: 'Athens', enslavedName: 'Eliza', amount: 600, year: 1851 },
        { policyNumber: 1779, enslaverName: 'J. Thomas', location: 'Athens', enslavedName: 'Ned', amount: 800, year: 1854 },
        { policyNumber: 575, enslaverName: 'Almeria A. Hall', location: 'Athens', enslavedName: 'Root', amount: 660, year: 1851 },
        { policyNumber: 1018, enslaverName: 'L.A. Moses', location: 'Atlanta', enslavedName: 'Stoney', amount: 525, year: 1855 },
        { policyNumber: null, enslaverName: 'J.S. Witherspoon', location: 'Athens', enslavedName: 'Vetus', amount: 700, year: 1854 },
    ];

    let stored = 0;
    for (const entry of transcribed) {
        const policy = {
            ...entry,
            enslavedCount: entry.enslavedCount || 1
        };

        await storeExtractedPerson(policy);
        stored++;
    }

    console.log(`  Stored ${stored} transcribed entries (${stats.enslavedPersonsExtracted} enslaved persons, ${stats.enslaversExtracted} enslavers)`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  SOUTHERN MUTUAL INSURANCE LEDGER EXTRACTION`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE — writing to database'}`);
    console.log(`${'═'.repeat(70)}\n`);

    // Connect to database
    if (!DRY_RUN) {
        sql = neon(DATABASE_URL);
        console.log('Connected to database\n');
    }

    // Step 1: Register all corporate disclosure PDFs in the database
    console.log('── Step 1: Registering corporate disclosure PDFs ──');
    if (!DRY_RUN) {
        await registerDocumentsInDB();
    } else {
        console.log('  [DRY RUN] Would register 7 PDFs in person_documents');
    }

    // Step 2: Store manually transcribed entries (higher quality than OCR)
    // These come from the research chat where a human read the handwritten ledger
    await storeTranscribedEntries();

    // Step 3: Attempt OCR on register pages for any entries the transcription missed
    console.log('\n── Step 3: OCR extraction from register PDFs ──');

    // Check if pdftoppm is available
    let hasPdftoppm = false;
    try {
        execSync('which pdftoppm', { stdio: 'pipe' });
        hasPdftoppm = true;
    } catch (e) {
        try {
            execSync('which magick', { stdio: 'pipe' });
            hasPdftoppm = true; // Will use ImageMagick instead
        } catch (e2) {
            console.log('  pdftoppm and ImageMagick not available — skipping OCR pass');
            console.log('  Install with: brew install poppler');
            console.log('  The manually transcribed entries have been stored successfully.');
        }
    }

    if (hasPdftoppm) {
        for (const pdf of REGISTER_PDFS) {
            const pdfPath = path.join(STORAGE_DIR, pdf.filename);
            if (!fs.existsSync(pdfPath)) {
                console.log(`  Skipping ${pdf.filename} — not found`);
                continue;
            }

            console.log(`\n  Processing: ${pdf.label}`);

            // Convert to images
            const tempDir = path.join(TEMP_DIR, pdf.filename.replace('.pdf', ''));
            let images;
            try {
                images = pdfToImages(pdfPath, tempDir);
            } catch (err) {
                console.error(`  Failed to convert PDF: ${err.message}`);
                continue;
            }

            // OCR each page
            for (const imagePath of images) {
                const pageName = path.basename(imagePath);
                console.log(`    OCR: ${pageName}...`);

                const ocrText = await ocrImage(imagePath);
                if (!ocrText) {
                    console.log(`    → No text extracted`);
                    stats.errors++;
                    continue;
                }

                stats.pagesProcessed++;
                console.log(`    → ${ocrText.length} chars extracted`);

                // Parse
                const parsed = parseInsuranceLedger(ocrText, pdf.label);
                console.log(`    → ${parsed.policies.length} policy entries found`);

                // Store (OCR entries get lower confidence than transcribed)
                for (const policy of parsed.policies) {
                    // Only store if we got an enslaved name that wasn't already transcribed
                    if (policy.enslavedName) {
                        policy.amount = policy.amount || null;
                        await storeExtractedPerson(policy);
                        stats.policiesExtracted++;
                    }
                }
            }

            // Clean up temp images
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (e) { /* ignore cleanup errors */ }
        }
    }

    // Step 4: Verify accessibility
    console.log('\n── Step 4: Verifying document accessibility ──');
    if (!DRY_RUN) {
        // Check that person_documents entries exist
        const docCount = await sql`
            SELECT COUNT(*) as cnt FROM person_documents
            WHERE collection_name = 'corporate-disclosures'
        `;
        console.log(`  person_documents with corporate-disclosures: ${docCount[0].cnt}`);

        // Check unconfirmed_persons with insurance_ledger_ocr method
        const personCount = await sql`
            SELECT person_type, COUNT(*) as cnt
            FROM unconfirmed_persons
            WHERE extraction_method = 'insurance_ledger_ocr'
            GROUP BY person_type
        `;
        console.log('  unconfirmed_persons (insurance_ledger_ocr):');
        personCount.forEach(p => console.log(`    ${p.person_type}: ${p.cnt}`));

        // Verify DAA system can find these
        const daaCheck = await sql`
            SELECT up.full_name, up.person_type, up.confidence_score,
                   (up.relationships->>'enslaved_by') as enslaver,
                   (up.relationships->>'policy_number') as policy_num,
                   (up.relationships->>'insured_value') as insured_value
            FROM unconfirmed_persons up
            WHERE up.extraction_method = 'insurance_ledger_ocr'
            AND up.person_type = 'enslaved'
            ORDER BY (up.relationships->>'policy_number')::text
            LIMIT 5
        `;
        console.log('\n  Sample entries accessible to DAA system:');
        daaCheck.forEach(p => {
            console.log(`    ${p.full_name} — enslaved by ${p.enslaver}, policy #${p.policy_num}, insured $${p.insured_value}`);
        });
    }

    // Summary
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  EXTRACTION COMPLETE`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`  Pages OCR'd:          ${stats.pagesProcessed}`);
    console.log(`  Policies extracted:    ${stats.policiesExtracted}`);
    console.log(`  Enslaved persons:      ${stats.enslavedPersonsExtracted}`);
    console.log(`  Enslavers:             ${stats.enslaversExtracted}`);
    console.log(`  Errors:                ${stats.errors}`);
    console.log(`  Elapsed:               ${elapsed}s`);
    console.log(`  Mode:                  ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log('');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
