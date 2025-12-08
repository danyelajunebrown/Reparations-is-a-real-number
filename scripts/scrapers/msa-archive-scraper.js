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
const config = require('../../config');

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

// Database connection
const pool = new Pool({
    connectionString: config.database.connectionString,
    ssl: config.database.ssl
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

    // Step 4: Parse extracted data
    console.log('   📝 Parsing extracted data...');
    const parsedData = parseOcrText(ocrResult.text, volumeId, page);
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
 * Extract embedded image from PDF
 */
async function extractImageFromPdf(pdfBuffer) {
    try {
        const pdfString = pdfBuffer.toString('binary');

        // Look for JPEG markers
        const jpegStart = pdfString.indexOf('\xFF\xD8\xFF');
        if (jpegStart !== -1) {
            let jpegEnd = pdfString.indexOf('\xFF\xD9', jpegStart);
            if (jpegEnd !== -1) {
                jpegEnd += 2;
                const jpegData = Buffer.from(pdfString.slice(jpegStart, jpegEnd), 'binary');

                // Convert to PNG with sharp for better OCR
                const pngBuffer = await sharp(jpegData)
                    .png()
                    .toBuffer();

                return pngBuffer;
            }
        }

        // Look for PNG markers
        const pngStart = pdfString.indexOf('\x89PNG');
        if (pngStart !== -1) {
            const pngEnd = pdfString.indexOf('IEND', pngStart);
            if (pngEnd !== -1) {
                return Buffer.from(pdfString.slice(pngStart, pngEnd + 8), 'binary');
            }
        }

        return null;
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
 */
function parseOcrText(text, volumeId, page) {
    const result = {
        enslavedPersons: [],
        slaveholders: [],
        rawText: text
    };

    if (!text || text.length < 50) return result;

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Patterns for name extraction
    // These are adapted for historical slave records from Maryland
    const namePattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+/;
    const ageGenderPattern = /\b(male|female|m|f)\b.*?\b(\d{1,2})\b/i;

    let currentOwner = null;

    for (const line of lines) {
        // Skip header lines
        if (line.match(/RECORD OF SLAVES|MONTGOMERY COUNTY|DATE|NAME OF|SEX|AGE|PHYSICAL/i)) {
            continue;
        }

        // Detect owner names (usually in NAME OF OWNER column, leftmost)
        // Owners often appear in a specific format or with specific keywords
        const ownerMatch = line.match(/^([A-Z][a-z]+\s+[A-Z]?\.?\s*[A-Z][a-z]+)\s*$/);
        if (ownerMatch) {
            currentOwner = ownerMatch[1].trim();
            if (!result.slaveholders.find(s => s.name === currentOwner)) {
                result.slaveholders.push({
                    name: currentOwner,
                    page,
                    confidence: 0.7
                });
            }
            continue;
        }

        // Look for enslaved person patterns
        // Format often: Name | Sex | Age | Condition | Term | Military status
        const parts = line.split(/\s{2,}|\t/).filter(p => p.length > 0);

        if (parts.length >= 2) {
            // First part might be a name
            const possibleName = parts[0];

            // Check if it looks like a name (starts with capital, has letters)
            if (possibleName.match(/^[A-Z][a-z]+/) && !possibleName.match(/^\d/)) {
                let gender = null;
                let age = null;
                let condition = null;

                // Look for gender/age in remaining parts
                for (const part of parts.slice(1)) {
                    if (part.match(/^(male|female|m|f)$/i)) {
                        gender = part.toLowerCase().startsWith('m') ? 'Male' : 'Female';
                    } else if (part.match(/^\d{1,2}$/)) {
                        age = parseInt(part);
                    } else if (part.match(/healthy|unsound|sick/i)) {
                        condition = part;
                    }
                }

                // Only add if we have some data beyond just a name
                if (gender || age) {
                    result.enslavedPersons.push({
                        name: possibleName,
                        gender,
                        age,
                        condition,
                        owner: currentOwner,
                        page,
                        confidence: 0.6
                    });
                }
            }
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
                `Volume ${volumeId}, Page ${page}. Age: ${person.age || 'unknown'}. Condition: ${person.condition || 'unknown'}. Owner: ${person.owner || 'unknown'}`,
                person.confidence,
                JSON.stringify(relationships),
                'pending',
                'primary'
            ]);
        }

        // Insert slaveholders
        for (const owner of parsedData.slaveholders) {
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
                `Volume ${volumeId}, Page ${page}. Montgomery County Slave Statistics 1867-1868.`,
                owner.confidence,
                'pending',
                'primary'
            ]);
        }

        // Insert document record if S3 upload succeeded
        if (s3Url) {
            await client.query(`
                INSERT INTO documents (
                    title,
                    source_url,
                    storage_url,
                    document_type,
                    archive_name,
                    metadata,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT DO NOTHING
            `, [
                `Montgomery County Slave Statistics - Volume ${volumeId}, Page ${page}`,
                sourceUrl,
                s3Url,
                'slave_record',
                'Maryland State Archives',
                JSON.stringify({
                    volumeId,
                    page,
                    collection: 'SC 2908',
                    series: 'Montgomery County Slave Statistics',
                    dateRange: '1867-1868'
                })
            ]);
        }

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
