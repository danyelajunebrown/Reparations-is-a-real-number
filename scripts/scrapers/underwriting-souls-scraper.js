/**
 * Underwriting Souls Scraper
 *
 * Scrapes digitized insurance documents from the Johns Hopkins
 * "Underwriting Souls: Lloyd's and the Transatlantic Slave Trade" project.
 *
 * Source: https://underwritingsouls.org/digitized-corpus/
 *
 * Document types:
 * - Insurance policies for slave ships
 * - Risk books (underwriter ledgers)
 * - Bills of lading
 * - Letters and correspondence
 * - Advertisements (slave sales, runaways)
 * - Prints and portraits
 *
 * Usage:
 *   node scripts/scrapers/underwriting-souls-scraper.js [url]
 *   node scripts/scrapers/underwriting-souls-scraper.js --queue  # Process from scraping_queue
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Pool } = require('pg');
const path = require('path');

// Import services
const OCRProcessor = require('../../src/services/document/OCRProcessor');
const config = require('../../config');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || config.database.connectionString,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : config.database.ssl
});

// OCR processor for PDFs
const ocrProcessor = new OCRProcessor();

// Stats tracking
const stats = {
    documentsProcessed: 0,
    documentsFailed: 0,
    policiesExtracted: 0,
    underwritersExtracted: 0,
    vesselsExtracted: 0,
    voyagesExtracted: 0,
    startTime: null,
    errors: []
};

// Document type mappings
const DOCUMENT_TYPES = {
    'insurance-policy': 'insurance_policy',
    'risk-book': 'risk_book',
    'bill-of-lading': 'bill_of_lading',
    'certificate': 'certificate',
    'deed': 'deed',
    'letter': 'letter',
    'advert': 'advertisement',
    'portrait': 'portrait',
    'print': 'print',
    'object': 'artifact'
};

/**
 * Main entry point
 */
async function main() {
    stats.startTime = Date.now();

    console.log('\n' + '='.repeat(70));
    console.log('📜 UNDERWRITING SOULS SCRAPER');
    console.log('   Lloyd\'s and the Transatlantic Slave Trade');
    console.log('='.repeat(70));

    const args = process.argv.slice(2);

    if (args.includes('--queue')) {
        // Process URLs from the scraping queue
        await processQueue();
    } else if (args.length > 0 && args[0].startsWith('http')) {
        // Process a single URL
        await processUrl(args[0]);
    } else {
        console.log('\nUsage:');
        console.log('  node underwriting-souls-scraper.js <url>');
        console.log('  node underwriting-souls-scraper.js --queue');
        process.exit(1);
    }

    printSummary();
    await pool.end();
}

/**
 * Process URLs from the scraping queue
 */
async function processQueue() {
    console.log('\n📋 Processing URLs from scraping queue...\n');

    const result = await pool.query(`
        SELECT id, url, metadata
        FROM scraping_queue
        WHERE category = 'underwriting_souls'
        AND status = 'pending'
        ORDER BY priority DESC, created_at ASC
    `);

    console.log(`Found ${result.rows.length} pending URLs\n`);

    for (const row of result.rows) {
        try {
            // Mark as in_progress
            await pool.query(
                `UPDATE scraping_queue SET status = 'in_progress', started_at = NOW() WHERE id = $1`,
                [row.id]
            );

            await processUrl(row.url, row.metadata);

            // Mark as completed
            await pool.query(
                `UPDATE scraping_queue SET status = 'completed', completed_at = NOW() WHERE id = $1`,
                [row.id]
            );

            stats.documentsProcessed++;

            // Rate limiting
            await sleep(2000);

        } catch (error) {
            console.error(`❌ Failed: ${row.url} - ${error.message}`);
            stats.documentsFailed++;
            stats.errors.push({ url: row.url, error: error.message });

            // Mark as failed
            await pool.query(
                `UPDATE scraping_queue SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`,
                [row.id, error.message]
            );
        }
    }
}

/**
 * Process a single URL
 */
async function processUrl(url, metadata = {}) {
    console.log(`\n📄 Processing: ${url}`);

    // Fetch the page
    const response = await axios.get(url, {
        headers: {
            'User-Agent': 'Reparations Research Bot (Historical Research)',
            'Accept': 'text/html,application/xhtml+xml'
        },
        timeout: 30000
    });

    const $ = cheerio.load(response.data);

    // Extract document metadata
    const docData = extractDocumentMetadata($, url);
    console.log(`   Title: ${docData.title}`);
    console.log(`   Type: ${docData.documentType}`);
    console.log(`   Reference: ${docData.referenceNumber}`);
    console.log(`   Date: ${docData.date}`);

    // Look for PDF link
    const pdfUrl = extractPdfUrl($, url);
    if (pdfUrl) {
        console.log(`   PDF: ${pdfUrl}`);
        docData.pdfUrl = pdfUrl;

        // Download and OCR the PDF if it's a record type
        if (['insurance_policy', 'risk_book', 'bill_of_lading', 'certificate', 'deed'].includes(docData.documentType)) {
            console.log('   🔍 Downloading PDF for OCR...');
            const ocrText = await downloadAndOcrPdf(pdfUrl);
            if (ocrText) {
                docData.ocrText = ocrText;
                console.log(`   ✅ OCR complete: ${ocrText.length} chars`);

                // Parse the OCR text for structured data
                const parsedData = parseDocumentText(ocrText, docData.documentType);
                Object.assign(docData, parsedData);
            }
        }
    }

    // Extract description and other page content
    docData.description = extractDescription($);
    docData.relatedExhibitions = extractRelatedExhibitions($);

    // Save to database
    await saveToDatabase(docData, url);

    console.log(`   ✅ Saved to database`);
}

/**
 * Extract document metadata from the page
 */
function extractDocumentMetadata($, url) {
    const data = {
        title: '',
        documentType: 'unknown',
        referenceNumber: null,
        date: null,
        extent: null,
        provenance: null,
        sourceUrl: url
    };

    // Title from page
    data.title = $('h1.entry-title, h1.page-title, h1').first().text().trim() ||
                 $('title').text().split('|')[0].trim();

    // Determine document type from URL or title
    const urlLower = url.toLowerCase();
    const titleLower = data.title.toLowerCase();

    for (const [pattern, type] of Object.entries(DOCUMENT_TYPES)) {
        if (urlLower.includes(pattern) || titleLower.includes(pattern.replace('-', ' '))) {
            data.documentType = type;
            break;
        }
    }

    // Extract metadata fields - they appear as key-value pairs
    const pageText = $('body').text();

    // Reference number
    const refMatch = pageText.match(/Reference(?:\s+Number)?[:\s]+([A-Z0-9-]+)/i);
    if (refMatch) data.referenceNumber = refMatch[1].trim();

    // Date
    const dateMatch = pageText.match(/Date[:\s]+(\d{4}(?:-\d{4})?|\d{1,2}\s+\w+\s+\d{4})/i);
    if (dateMatch) data.date = dateMatch[1].trim();

    // Extent
    const extentMatch = pageText.match(/Extent[:\s]+([^\n]+)/i);
    if (extentMatch) data.extent = extentMatch[1].trim();

    // Provenance
    const provMatch = pageText.match(/Provenance[:\s]+([^\n]+)/i);
    if (provMatch) data.provenance = provMatch[1].trim();

    return data;
}

/**
 * Extract PDF URL from page
 */
function extractPdfUrl($, pageUrl) {
    // Look for direct PDF links
    const pdfLinks = $('a[href$=".pdf"]');
    if (pdfLinks.length > 0) {
        let pdfHref = pdfLinks.first().attr('href');
        // Make absolute if relative
        if (pdfHref.startsWith('/')) {
            const urlObj = new URL(pageUrl);
            pdfHref = `${urlObj.protocol}//${urlObj.host}${pdfHref}`;
        }
        return pdfHref;
    }

    // Look in page source for PDF references
    const pageHtml = $.html();
    const pdfMatch = pageHtml.match(/["'](https?:\/\/[^"']+\.pdf)["']/i) ||
                     pageHtml.match(/["'](\/wp-content\/[^"']+\.pdf)["']/i);
    if (pdfMatch) {
        let pdfUrl = pdfMatch[1];
        if (pdfUrl.startsWith('/')) {
            const urlObj = new URL(pageUrl);
            pdfUrl = `${urlObj.protocol}//${urlObj.host}${pdfUrl}`;
        }
        return pdfUrl;
    }

    return null;
}

/**
 * Extract description text
 */
function extractDescription($) {
    // Look for the main content area
    const contentSelectors = [
        '.entry-content p',
        '.page-content p',
        'article p',
        '.content p'
    ];

    for (const selector of contentSelectors) {
        const paragraphs = $(selector);
        if (paragraphs.length > 0) {
            const text = paragraphs.map((i, el) => $(el).text().trim()).get().join('\n\n');
            if (text.length > 50) return text;
        }
    }

    return null;
}

/**
 * Extract related exhibitions
 */
function extractRelatedExhibitions($) {
    const exhibitions = [];

    // Look for exhibition links or references
    $('a[href*="exhibition"], a[href*="exhibit"]').each((i, el) => {
        exhibitions.push({
            title: $(el).text().trim(),
            url: $(el).attr('href')
        });
    });

    return exhibitions.length > 0 ? exhibitions : null;
}

/**
 * Download PDF and run OCR
 */
async function downloadAndOcrPdf(pdfUrl) {
    try {
        const response = await axios.get(pdfUrl, {
            responseType: 'arraybuffer',
            timeout: 60000,
            headers: {
                'User-Agent': 'Reparations Research Bot (Historical Research)',
                'Accept': 'application/pdf'
            }
        });

        const pdfBuffer = Buffer.from(response.data);

        // Use OCR processor
        const file = {
            buffer: pdfBuffer,
            originalname: 'document.pdf',
            mimetype: 'application/pdf'
        };

        const result = await ocrProcessor.process(file);
        return result.text;

    } catch (error) {
        console.error(`   ⚠️  PDF OCR failed: ${error.message}`);
        return null;
    }
}

/**
 * Parse OCR text to extract structured data based on document type
 */
function parseDocumentText(text, documentType) {
    const data = {
        vessels: [],
        underwriters: [],
        voyages: [],
        insuredValues: [],
        destinations: [],
        persons: []
    };

    if (!text) return data;

    const normalizedText = text.replace(/\s+/g, ' ');

    // Extract vessel/ship names
    const shipPatterns = [
        /(?:ship|vessel|bark|brig|schooner|sloop)\s+(?:called\s+)?(?:the\s+)?["']?([A-Z][a-zA-Z\s]{2,20})["']?/gi,
        /(?:the\s+)?([A-Z][a-z]+)\s+(?:bound\s+)?(?:to|for)\s+(?:Africa|Guinea|Coast|Jamaica|Barbados)/gi
    ];

    for (const pattern of shipPatterns) {
        let match;
        while ((match = pattern.exec(normalizedText)) !== null) {
            const name = match[1].trim();
            if (name.length > 2 && !data.vessels.includes(name)) {
                data.vessels.push(name);
            }
        }
    }

    // Extract monetary values (pounds, shillings, pence)
    const valuePatterns = [
        /£\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
        /(\d{1,3}(?:,\d{3})*)\s*(?:pounds?|l\.)/gi,
        /insured\s+(?:for|at)\s+£?\s*(\d{1,3}(?:,\d{3})*)/gi
    ];

    for (const pattern of valuePatterns) {
        let match;
        while ((match = pattern.exec(normalizedText)) !== null) {
            const value = match[1].replace(/,/g, '');
            if (!data.insuredValues.includes(value)) {
                data.insuredValues.push(value);
            }
        }
    }

    // Extract destinations
    const destinations = [
        'Africa', 'Guinea', 'Gold Coast', 'Windward Coast', 'Slave Coast',
        'Jamaica', 'Barbados', 'Antigua', 'St. Kitts', 'Nevis', 'Dominica',
        'Grenada', 'Trinidad', 'Surinam', 'Demerara', 'Charleston', 'Havana',
        'Liverpool', 'London', 'Bristol'
    ];

    for (const dest of destinations) {
        if (normalizedText.toLowerCase().includes(dest.toLowerCase())) {
            data.destinations.push(dest);
        }
    }

    // Extract names (potential underwriters, captains, merchants)
    const namePatterns = [
        /(?:underwritten|signed|subscribed)\s+by\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/gi,
        /(?:Captain|Capt\.?|Master)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
        /(?:Mr\.?|Messrs\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi
    ];

    for (const pattern of namePatterns) {
        let match;
        while ((match = pattern.exec(normalizedText)) !== null) {
            const name = match[1].trim();
            if (name.length > 3 && !data.persons.includes(name)) {
                data.persons.push(name);
            }
        }
    }

    // For risk books, try to count voyages mentioned
    if (documentType === 'risk_book') {
        const voyageMatch = normalizedText.match(/(\d+)\s+(?:slaving\s+)?voyages?/i);
        if (voyageMatch) {
            data.voyageCount = parseInt(voyageMatch[1]);
        }
    }

    return data;
}

/**
 * Save extracted data to database
 */
async function saveToDatabase(docData, sourceUrl) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Insert or find the institution (Lloyd's of London)
        const lloydsResult = await client.query(`
            SELECT id FROM financial_institutions
            WHERE name ILIKE '%Lloyd%' LIMIT 1
        `);
        const lloydsId = lloydsResult.rows[0]?.id;

        // 2. Insert the document as a source
        const citation = `Underwriting Souls Project, Johns Hopkins University. "${docData.title}". ` +
                        `Reference: ${docData.referenceNumber || 'N/A'}. ` +
                        `Date: ${docData.date || 'N/A'}. ` +
                        `Source: ${sourceUrl}`;

        // Store in unconfirmed_persons for insurance document subjects
        if (docData.documentType === 'insurance_policy' && docData.vessels.length > 0) {
            for (const vessel of docData.vessels) {
                // Create entry for the vessel/voyage
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
                    `Vessel: ${vessel}`,
                    'vessel',
                    sourceUrl,
                    'underwriting_souls_scraper',
                    `${citation}. Destinations: ${docData.destinations.join(', ')}. ` +
                    `Insured values: £${docData.insuredValues.join(', £')}`,
                    0.8,
                    'pending',
                    'primary'
                ]);

                stats.vesselsExtracted++;
            }
        }

        // Store underwriters/persons found
        for (const person of docData.persons || []) {
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
                person,
                'financial_actor', // Could be underwriter, captain, merchant
                sourceUrl,
                'underwriting_souls_scraper',
                `${citation}. Role: Unknown (extracted from ${docData.documentType})`,
                0.6,
                'pending',
                'primary'
            ]);

            stats.underwritersExtracted++;
        }

        // Store the document reference itself
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
            `Document: ${docData.title}`,
            'document_reference',
            sourceUrl,
            'underwriting_souls_scraper',
            `${citation}. Type: ${docData.documentType}. ` +
            `Description: ${docData.description?.substring(0, 500) || 'N/A'}`,
            0.9,
            'pending',
            'primary'
        ]);

        stats.policiesExtracted++;

        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Print summary
 */
function printSummary() {
    const elapsed = (Date.now() - stats.startTime) / 1000;

    console.log('\n' + '='.repeat(70));
    console.log('📊 SCRAPING COMPLETE');
    console.log('='.repeat(70));
    console.log(`   Documents processed: ${stats.documentsProcessed}`);
    console.log(`   Documents failed: ${stats.documentsFailed}`);
    console.log(`   Policies extracted: ${stats.policiesExtracted}`);
    console.log(`   Underwriters/persons: ${stats.underwritersExtracted}`);
    console.log(`   Vessels: ${stats.vesselsExtracted}`);
    console.log(`   Total time: ${(elapsed / 60).toFixed(2)} minutes`);

    if (stats.errors.length > 0) {
        console.log('\n⚠️  Errors:');
        stats.errors.slice(0, 5).forEach(e => console.log(`   ${e.url}: ${e.error}`));
    }

    console.log('='.repeat(70) + '\n');
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
