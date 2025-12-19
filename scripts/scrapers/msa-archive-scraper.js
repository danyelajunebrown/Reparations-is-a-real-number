/**
 * Maryland State Archives (MSA) Autonomous Scraper
 *
 * This script crawls MSA archive volumes, downloads PDF images,
 * runs OCR (Google Vision or Tesseract), extracts enslaved persons
 * and slaveholders, and stores them in the database with S3 document storage.
 *
 * Usage:
 *   node scripts/scrapers/msa-archive-scraper.js [volumeId] [startPage] [endPage]
 *
 * Example:
 *   node scripts/scrapers/msa-archive-scraper.js 812 1 132
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Pool } = require('pg');

// Import services
const OCRProcessor = require('../../src/services/document/OCRProcessor');
const UnifiedNameExtractor = require('../../src/services/UnifiedNameExtractor');
const config = require('../../config');

// Global name extractor instance (initialized in scrapeVolume())
let nameExtractor = null;

// S3 client setup
let s3Client = null;
let s3Enabled = false;

if (config.storage.s3.enabled) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    s3Client = new S3Client({
        region: config.storage.s3.region,
        credentials: {
            accessKeyId: config.storage.s3.accessKeyId,
            secretAccessKey: config.storage.s3.secretAccessKey
        }
    });
    s3Enabled = true;
    console.log('✅ S3 storage enabled');
} else {
    console.log('⚠️  S3 storage disabled - documents will not be uploaded');
}

// Database connection - prioritize DATABASE_URL env var for running locally against production
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || config.database.connectionString,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : config.database.ssl
});

// OCR processor
const ocrProcessor = new OCRProcessor();

// Stats tracking
const stats = {
    pagesProcessed: 0,
    pagesSkipped: 0,
    pagesFailed: 0,
    personsExtracted: 0,
    slaveholdersExtracted: 0,
    documentsUploaded: 0,
    startTime: null,
    errors: []
};

/**
 * Main scraper function
 */
async function scrapeVolume(volumeId, startPage = 1, endPage = null) {
    stats.startTime = Date.now();

    console.log('\n' + '='.repeat(70));
    console.log('🏛️  MARYLAND STATE ARCHIVES AUTONOMOUS SCRAPER');
    console.log('='.repeat(70));
    console.log(`Volume: ${volumeId}`);
    console.log(`Pages: ${startPage} to ${endPage || 'end'}`);
    console.log(`OCR: ${ocrProcessor.googleVisionAvailable ? 'Google Vision' : 'Tesseract (fallback)'}`);
    console.log(`S3: ${s3Enabled ? 'Enabled' : 'Disabled'}`);
    console.log('='.repeat(70) + '\n');

    // Initialize UnifiedNameExtractor with training data
    nameExtractor = new UnifiedNameExtractor();
    await nameExtractor.initialize();
    console.log('✅ UnifiedNameExtractor initialized with training data\n');

    // Find the last page if not specified
    if (!endPage) {
        endPage = await findLastPage(volumeId);
        console.log(`📄 Detected ${endPage} pages in volume ${volumeId}\n`);
    }

    // Process each page
    for (let page = startPage; page <= endPage; page++) {
        try {
            await processPage(volumeId, page);
            stats.pagesProcessed++;

            // Progress update every 10 pages
            if (page % 10 === 0) {
                printProgress(page, endPage);
            }

            // Rate limiting - be nice to the archive server
            await sleep(1000);

        } catch (error) {
            console.error(`❌ Page ${page} failed: ${error.message}`);
            stats.pagesFailed++;
            stats.errors.push({ page, error: error.message });
        }
    }

    // Print final summary
    printSummary();
}

/**
 * Find the last page in a volume using binary search
 */
async function findLastPage(volumeId) {
    let low = 1;
    let high = 500; // Assume max 500 pages

    while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        const exists = await pageExists(volumeId, mid);

        if (exists) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    return low;
}

/**
 * Check if a page exists
 */
async function pageExists(volumeId, page) {
    const url = `https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000${volumeId}/html/am${volumeId}--${page}.html`;
    try {
        const response = await axios.head(url, { timeout: 5000 });
        return response.status === 200;
    } catch {
        return false;
    }
}

/**
 * Process a single page
 */
async function processPage(volumeId, page) {
    const pageUrl = `https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000${volumeId}/html/am${volumeId}--${page}.html`;
    const pdfUrl = `https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000${volumeId}/pdf/am${volumeId}--${page}.pdf`;

    console.log(`\n📄 Processing page ${page}...`);
    console.log(`   URL: ${pdfUrl}`);

    // Step 1: Download PDF
    console.log('   ⬇️  Downloading PDF...');
    const pdfBuffer = await downloadPdf(pdfUrl);

    if (!pdfBuffer) {
        console.log('   ⚠️  PDF download failed, skipping page');
        stats.pagesSkipped++;
        return;
    }

    console.log(`   ✅ Downloaded ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    // Step 2: Extract image from PDF
    console.log('   🖼️  Extracting image from PDF...');
    const imageBuffer = await extractImageFromPdf(pdfBuffer);

    if (!imageBuffer) {
        console.log('   ⚠️  Image extraction failed, skipping page');
        stats.pagesSkipped++;
        return;
    }

    console.log(`   ✅ Extracted image (${(imageBuffer.length / 1024).toFixed(1)} KB)`);

    // Step 3: Run OCR
    console.log('   🔍 Running OCR...');
    const ocrResult = await runOcr(imageBuffer);

    if (!ocrResult.text || ocrResult.text.length < 50) {
        console.log(`   ⚠️  OCR returned minimal text (${ocrResult.text?.length || 0} chars)`);
        // Still continue - might be a mostly blank page
    } else {
        console.log(`   ✅ OCR completed: ${ocrResult.text.length} chars, ${(ocrResult.confidence * 100).toFixed(1)}% confidence`);
    }

    // Step 4: Parse extracted data using UnifiedNameExtractor
    console.log('   📝 Parsing extracted data...');
    const parsedData = await parseOcrText(ocrResult.text, volumeId, page);
    console.log(`   ✅ Found: ${parsedData.enslavedPersons.length} enslaved, ${parsedData.slaveholders.length} slaveholders`);

    // Step 5: Upload to S3 (if enabled)
    let s3DocumentUrl = null;
    if (s3Enabled) {
        console.log('   ☁️  Uploading to S3...');
        s3DocumentUrl = await uploadToS3(pdfBuffer, volumeId, page);
        if (s3DocumentUrl) {
            console.log(`   ✅ Uploaded: ${s3DocumentUrl}`);
            stats.documentsUploaded++;
        }
    }

    // Step 6: Save to database
    console.log('   💾 Saving to database...');
    await saveToDatabase(parsedData, pdfUrl, s3DocumentUrl, volumeId, page);

    stats.personsExtracted += parsedData.enslavedPersons.length;
    stats.slaveholdersExtracted += parsedData.slaveholders.length;

    console.log(`   ✅ Page ${page} complete!`);
}

/**
 * Download PDF from URL
 */
async function downloadPdf(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60000,
            headers: {
                'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)',
                'Accept': 'application/pdf'
            }
        });

        return Buffer.from(response.data);
    } catch (error) {
        console.error(`   Download error: ${error.message}`);
        return null;
    }
}

/**
 * Extract embedded image from PDF and resize for OCR
 */
async function extractImageFromPdf(pdfBuffer) {
    try {
        const pdfString = pdfBuffer.toString('binary');
        let imageBuffer = null;

        // Look for JPEG markers
        const jpegStart = pdfString.indexOf('\xFF\xD8\xFF');
        if (jpegStart !== -1) {
            let jpegEnd = pdfString.indexOf('\xFF\xD9', jpegStart);
            if (jpegEnd !== -1) {
                jpegEnd += 2;
                imageBuffer = Buffer.from(pdfString.slice(jpegStart, jpegEnd), 'binary');
            }
        }

        // Look for PNG markers if no JPEG found
        if (!imageBuffer) {
            const pngStart = pdfString.indexOf('\x89PNG');
            if (pngStart !== -1) {
                const pngEnd = pdfString.indexOf('IEND', pngStart);
                if (pngEnd !== -1) {
                    imageBuffer = Buffer.from(pdfString.slice(pngStart, pngEnd + 8), 'binary');
                }
            }
        }

        if (!imageBuffer) {
            return null;
        }

        // Resize image for OCR - Google Vision works best with 1024-2048px width
        // This significantly reduces API call time and improves reliability
        const resizedBuffer = await sharp(imageBuffer)
            .resize(2000, null, { // Max width 2000px, maintain aspect ratio
                fit: 'inside',
                withoutEnlargement: true
            })
            .png({ quality: 90 })
            .toBuffer();

        return resizedBuffer;
    } catch (error) {
        console.error(`   Image extraction error: ${error.message}`);
        return null;
    }
}

/**
 * Run OCR on image
 */
async function runOcr(imageBuffer) {
    try {
        const file = {
            buffer: imageBuffer,
            originalname: 'page.png',
            mimetype: 'image/png'
        };

        return await ocrProcessor.process(file);
    } catch (error) {
        console.error(`   OCR error: ${error.message}`);
        return { text: '', confidence: 0, service: 'error' };
    }
}

/**
 * Parse OCR text to extract enslaved persons and slaveholders
 *
 * The OCR output from these historical slave records comes in various formats.
 * Google Vision reads left-to-right, top-to-bottom, so column data gets mixed.
 *
 * Common patterns in the text:
 * - Names: "Saydia King", "William Hall", "Rhody Key"
 * - Gender/age: "female 50", "Male 45", "male 15"
 * - Conditions: "healthy", "Healthy", "unsound"
 * - Terms: "for life", "For life"
 *
 * NOW ENHANCED with UnifiedNameExtractor for better name extraction
 */
async function parseOcrText(text, volumeId, page) {
    const result = {
        enslavedPersons: [],
        slaveholders: [],
        rawText: text
    };

    if (!text || text.length < 50) return result;

    // Use UnifiedNameExtractor first for improved name extraction
    if (nameExtractor) {
        try {
            const extraction = await nameExtractor.extract(text, {
                source: 'msa',
                volumeId,
                page,
                documentType: 'slave_schedule' // MSA SC 2908 is slave schedules
            });

            if (extraction.success && extraction.enslavedPersons.length > 0) {
                // Add names from UnifiedExtractor with higher confidence
                for (const person of extraction.enslavedPersons) {
                    result.enslavedPersons.push({
                        name: person.name,
                        gender: person.gender || null,
                        age: person.age || null,
                        condition: null,
                        owner: null,
                        page,
                        confidence: Math.max(person.confidence, 0.8),
                        source: 'unified_extractor'
                    });
                }

                for (const owner of extraction.slaveholders) {
                    result.slaveholders.push({
                        name: owner.name,
                        page,
                        confidence: owner.confidence
                    });
                }

                console.log(`   📊 UnifiedExtractor found: ${extraction.enslavedPersons.length} enslaved, ${extraction.slaveholders.length} owners`);
            }
        } catch (err) {
            console.log(`   ⚠️ UnifiedExtractor error: ${err.message}, using MSA-specific patterns`);
        }
    }

    // Track already found names to avoid duplicates
    const foundNames = new Set(result.enslavedPersons.map(p => p.name.toLowerCase()));

    // Normalize text - replace multiple spaces/tabs with single space
    const normalizedText = text.replace(/\s+/g, ' ');
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Words to exclude from name extraction (common OCR artifacts, headers, and column labels)
    const excludeWords = new Set([
        // Headers and titles
        'record', 'slaves', 'montgomery', 'county', 'date', 'name', 'owner',
        'sex', 'age', 'physical', 'condition', 'term', 'service', 'military',
        'constitution', 'adoption', 'time', 'remarks', 'page', 'male', 'female',
        // Column headers from MSA forms
        'month', 'day', 'year', 'compensation', 'received', 'drafted', 'none',
        'regen', 'meanin', 'israil', // Common OCR misreads
        // Common words
        'healthy', 'unsound', 'sick', 'life', 'years', 'the', 'and', 'for', 'at',
        'of', 'in', 'to', 'is', 'as', 'by', 'from', 'with', 'was', 'were', 'been',
        'slaves', 'slave', 'persons', 'sept', 'free', 'colored', 'black', 'negro',
        // OCR artifacts
        'that', 'your', 'petitioner', 'petition', 'here', 'limbs', 'body', 'sound'
    ]);

    // (foundNames already initialized above with names from UnifiedExtractor)

    // Pattern 1: Look for "Name Gender Age" patterns (most common in OCR)
    // Example: "Saydia King female 50 healthy" or "William Hall Male 45"
    const nameGenderAgePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(female|male|f|m)\s+(\d{1,2})/gi;
    let match;

    while ((match = nameGenderAgePattern.exec(normalizedText)) !== null) {
        const name = match[1].trim();
        const genderRaw = match[2].toLowerCase();
        const age = parseInt(match[3]);

        // Skip if name is in exclude list or too short
        if (name.length < 3 || excludeWords.has(name.toLowerCase())) continue;

        const nameLower = name.toLowerCase();
        if (foundNames.has(nameLower)) continue;
        foundNames.add(nameLower);

        const gender = genderRaw.startsWith('f') ? 'Female' : 'Male';

        // Look for condition near this match
        const contextStart = Math.max(0, match.index - 20);
        const contextEnd = Math.min(normalizedText.length, match.index + match[0].length + 30);
        const context = normalizedText.slice(contextStart, contextEnd);

        let condition = null;
        if (context.match(/healthy/i)) condition = 'healthy';
        else if (context.match(/unsound/i)) condition = 'unsound';
        else if (context.match(/sick/i)) condition = 'sick';

        result.enslavedPersons.push({
            name,
            gender,
            age,
            condition,
            owner: null, // Will try to associate later
            page,
            confidence: 0.75
        });
    }

    // Pattern 2: Look for standalone names that look like enslaved persons
    // Names that appear with single first name (common for enslaved persons)
    // or with "child" descriptor
    const singleNamePattern = /\b([A-Z][a-z]{2,})\s+(child|infant|boy|girl)\b/gi;
    while ((match = singleNamePattern.exec(normalizedText)) !== null) {
        const name = match[1].trim();
        const descriptor = match[2].toLowerCase();

        if (excludeWords.has(name.toLowerCase())) continue;

        const nameLower = name.toLowerCase();
        if (foundNames.has(nameLower)) continue;
        foundNames.add(nameLower);

        const gender = (descriptor === 'boy') ? 'Male' :
                       (descriptor === 'girl') ? 'Female' : null;

        result.enslavedPersons.push({
            name: `${name} (${descriptor})`,
            gender,
            age: null,
            condition: null,
            owner: null,
            page,
            confidence: 0.6
        });
    }

    // Pattern 3: Look for owner names - typically "First Last" patterns
    // that appear at the start of lines or after certain keywords
    const ownerPattern = /([A-Z][a-z]+\s+[A-Z]\.?\s*[A-Z][a-z]+)/g;
    const potentialOwners = [];

    while ((match = ownerPattern.exec(normalizedText)) !== null) {
        const name = match[1].trim();

        // Skip if it's already an enslaved person
        if (foundNames.has(name.toLowerCase())) continue;

        // Skip common OCR artifacts
        if (excludeWords.has(name.split(' ')[0].toLowerCase())) continue;
        if (excludeWords.has(name.split(' ').pop().toLowerCase())) continue;

        potentialOwners.push(name);
    }

    // Deduplicate owners
    const uniqueOwners = [...new Set(potentialOwners)];
    for (const ownerName of uniqueOwners) {
        // Check if this name appears multiple times (more likely to be an owner)
        const count = potentialOwners.filter(n => n === ownerName).length;

        result.slaveholders.push({
            name: ownerName,
            page,
            confidence: count > 1 ? 0.8 : 0.6
        });
    }

    // Pattern 4: Extract additional names from structured patterns
    // Look for lines that have "Name" followed by demographic info
    for (const line of lines) {
        // Skip header lines
        if (line.match(/RECORD OF SLAVES|MONTGOMERY COUNTY|DATE|NAME OF|SEX|AGE|PHYSICAL|CONSTITUTION/i)) {
            continue;
        }

        // Look for patterns like: "Name, age Gender" or "Name age"
        const lineMatch = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s*(\d{1,2})?\s*(male|female|m|f)?/i);
        if (lineMatch) {
            const name = lineMatch[1].trim();
            const age = lineMatch[2] ? parseInt(lineMatch[2]) : null;
            const genderRaw = lineMatch[3]?.toLowerCase();

            if (name.length < 3 || excludeWords.has(name.toLowerCase())) continue;

            const nameLower = name.toLowerCase();
            if (foundNames.has(nameLower)) continue;
            foundNames.add(nameLower);

            const gender = genderRaw ? (genderRaw.startsWith('f') ? 'Female' : 'Male') : null;

            // Only add if we have SOME demographic info or name looks like enslaved person name
            if (age || gender || name.split(' ').length === 1) {
                result.enslavedPersons.push({
                    name,
                    gender,
                    age,
                    condition: null,
                    owner: null,
                    page,
                    confidence: 0.5
                });
            }
        }
    }

    // Pattern 5: Try to find full names by looking for "FirstName LastName" where LastName looks like a surname
    // Common enslaved surnames from these records: Johnson, Jackson, Brown, Smith, Jones, etc.
    const commonSurnames = new Set(['johnson', 'jackson', 'brown', 'smith', 'jones', 'williams', 'davis', 'thomas', 'harris', 'robinson', 'clark', 'lewis', 'walker', 'hall', 'young', 'king', 'wright', 'hill', 'green', 'adams', 'baker', 'nelson', 'moore', 'taylor', 'white', 'wilson', 'campbell', 'owen', 'owens']);

    // Look for "First Last" patterns where Last is a known surname
    const fullNamePattern = /([A-Z][a-z]+)\s+([A-Z][a-z]+)/g;
    while ((match = fullNamePattern.exec(normalizedText)) !== null) {
        const firstName = match[1].trim();
        const lastName = match[2].trim();
        const fullName = `${firstName} ${lastName}`;

        // Skip if either part is excluded
        if (excludeWords.has(firstName.toLowerCase()) || excludeWords.has(lastName.toLowerCase())) continue;

        // Skip if already found
        if (foundNames.has(fullName.toLowerCase())) continue;

        // Check if lastName looks like a surname
        if (commonSurnames.has(lastName.toLowerCase())) {
            foundNames.add(fullName.toLowerCase());

            // Look for age nearby
            const contextStart = Math.max(0, match.index - 30);
            const contextEnd = Math.min(normalizedText.length, match.index + match[0].length + 50);
            const context = normalizedText.slice(contextStart, contextEnd);

            let age = null;
            const ageMatch = context.match(/\b(\d{1,2})\b/);
            if (ageMatch) age = parseInt(ageMatch[1]);

            let condition = null;
            if (context.match(/healthy/i)) condition = 'healthy';
            else if (context.match(/unsound/i)) condition = 'unsound';

            result.enslavedPersons.push({
                name: fullName,
                gender: null,
                age,
                condition,
                owner: null,
                page,
                confidence: 0.7
            });
        }
    }

    // Try to associate enslaved persons with owners if we have position info
    // For now, just note that we found potential relationships
    if (result.slaveholders.length > 0 && result.enslavedPersons.length > 0) {
        // Basic heuristic: if only one owner, associate all enslaved with them
        if (result.slaveholders.length === 1) {
            const owner = result.slaveholders[0].name;
            result.enslavedPersons.forEach(person => {
                person.owner = owner;
            });
        }
    }

    return result;
}

/**
 * Upload PDF to S3
 */
async function uploadToS3(pdfBuffer, volumeId, page) {
    if (!s3Enabled || !s3Client) return null;

    try {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');

        const key = `archives/msa/volume-${volumeId}/page-${page}.pdf`;

        await s3Client.send(new PutObjectCommand({
            Bucket: config.storage.s3.bucket,
            Key: key,
            Body: pdfBuffer,
            ContentType: 'application/pdf',
            Metadata: {
                source: 'msa-maryland-gov',
                volumeId: String(volumeId),
                page: String(page),
                scrapedAt: new Date().toISOString()
            }
        }));

        return `https://${config.storage.s3.bucket}.s3.${config.storage.s3.region}.amazonaws.com/${key}`;
    } catch (error) {
        console.error(`   S3 upload error: ${error.message}`);
        return null;
    }
}

/**
 * Save extracted data to database
 */
async function saveToDatabase(parsedData, sourceUrl, s3Url, volumeId, page) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Insert enslaved persons
        for (const person of parsedData.enslavedPersons) {
            const relationships = person.owner ? [{
                type: 'enslaved_by',
                relatedPerson: person.owner,
                confidence: person.confidence
            }] : [];

            // Full citation: "Record of Slaves in Montgomery County at the Time of the Adoption of the Constitution in 1864"
            // Maryland State Archives, SC 2908, Volume 812
            const citation = `Maryland State Archives, SC 2908, Vol. ${volumeId}, p. ${page}. "Record of Slaves in Montgomery County at the Time of the Adoption of the Constitution in 1864." ${s3Url ? `Archived: ${s3Url}` : ''}`;

            await client.query(`
                INSERT INTO unconfirmed_persons (
                    full_name,
                    person_type,
                    gender,
                    source_url,
                    extraction_method,
                    context_text,
                    confidence_score,
                    relationships,
                    status,
                    source_type,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                ON CONFLICT DO NOTHING
            `, [
                person.name,
                'enslaved',
                person.gender,
                sourceUrl,
                'msa_archive_scraper',
                `${citation}. Age: ${person.age || 'unknown'}. Condition: ${person.condition || 'unknown'}. Owner: ${person.owner || 'unknown'}`,
                person.confidence,
                JSON.stringify(relationships),
                'pending',
                'primary'
            ]);
        }

        // Insert slaveholders with full citation
        for (const owner of parsedData.slaveholders) {
            const citation = `Maryland State Archives, SC 2908, Vol. ${volumeId}, p. ${page}. "Record of Slaves in Montgomery County at the Time of the Adoption of the Constitution in 1864." ${s3Url ? `Archived: ${s3Url}` : ''}`;

            await client.query(`
                INSERT INTO unconfirmed_persons (
                    full_name,
                    person_type,
                    source_url,
                    extraction_method,
                    context_text,
                    confidence_score,
                    status,
                    source_type,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT DO NOTHING
            `, [
                owner.name,
                'slaveholder',
                sourceUrl,
                'msa_archive_scraper',
                citation,
                owner.confidence,
                'pending',
                'primary'
            ]);
        }

        // Document PDFs are uploaded to S3 and linked in each person's context_text

        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Print progress update
 */
function printProgress(current, total) {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const pagesPerSecond = stats.pagesProcessed / elapsed;
    const remaining = (total - current) / pagesPerSecond;

    console.log('\n' + '-'.repeat(50));
    console.log(`📊 Progress: ${current}/${total} (${((current/total)*100).toFixed(1)}%)`);
    console.log(`   Enslaved: ${stats.personsExtracted} | Slaveholders: ${stats.slaveholdersExtracted}`);
    console.log(`   Documents uploaded: ${stats.documentsUploaded}`);
    console.log(`   Rate: ${pagesPerSecond.toFixed(2)} pages/sec`);
    console.log(`   Est. remaining: ${(remaining/60).toFixed(1)} minutes`);
    console.log('-'.repeat(50) + '\n');
}

/**
 * Print final summary
 */
function printSummary() {
    const elapsed = (Date.now() - stats.startTime) / 1000;

    console.log('\n' + '='.repeat(70));
    console.log('📊 SCRAPING COMPLETE - FINAL SUMMARY');
    console.log('='.repeat(70));
    console.log(`   Total pages processed: ${stats.pagesProcessed}`);
    console.log(`   Pages skipped: ${stats.pagesSkipped}`);
    console.log(`   Pages failed: ${stats.pagesFailed}`);
    console.log(`   Enslaved persons extracted: ${stats.personsExtracted}`);
    console.log(`   Slaveholders extracted: ${stats.slaveholdersExtracted}`);
    console.log(`   Documents uploaded to S3: ${stats.documentsUploaded}`);
    console.log(`   Total time: ${(elapsed/60).toFixed(2)} minutes`);
    console.log(`   Average rate: ${(stats.pagesProcessed/elapsed).toFixed(2)} pages/sec`);

    if (stats.errors.length > 0) {
        console.log('\n⚠️  Errors encountered:');
        stats.errors.slice(0, 10).forEach(err => {
            console.log(`   Page ${err.page}: ${err.error}`);
        });
        if (stats.errors.length > 10) {
            console.log(`   ... and ${stats.errors.length - 10} more errors`);
        }
    }

    console.log('='.repeat(70) + '\n');
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main execution
const args = process.argv.slice(2);
const volumeId = args[0] || '812';
const startPage = parseInt(args[1]) || 1;
const endPage = args[2] ? parseInt(args[2]) : null;

scrapeVolume(volumeId, startPage, endPage)
    .then(() => {
        console.log('✅ Scraper finished successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Scraper failed:', error);
        process.exit(1);
    });
