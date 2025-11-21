/**
 * Autonomous Web Scraping Agent
 *
 * Universal scraper that works on ANY website.
 * Extracts genealogical data, downloads documents, and builds knowledge base.
 *
 * NO platform-specific code.
 * NO API dependencies.
 * Pure intelligent scraping + ML extraction.
 */

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AutonomousWebScraper {
    constructor(database) {
        this.db = database;
        this.browser = null;
        this.downloadDir = './scraped-documents';

        // Ensure download directory exists
        if (!fs.existsSync(this.downloadDir)) {
            fs.mkdirSync(this.downloadDir, { recursive: true });
        }
    }

    /**
     * Main entry point: Scrape a URL
     * @param {string} url - Any URL to scrape
     * @param {object} options - Scraping options
     * @returns {Promise<object>} Extraction results
     */
    async scrapeURL(url, options = {}) {
        console.log(`\n🔍 Autonomous Agent: Scraping ${url}`);

        const startTime = Date.now();
        const results = {
            url,
            scrapedAt: new Date(),
            persons: [],
            documents: [],
            relationships: [],
            rawText: '',
            tables: [],
            images: [],
            errors: []
        };

        try {
            // Launch headless browser
            if (!this.browser) {
                this.browser = await puppeteer.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
            }

            const page = await this.browser.newPage();

            // Set user agent (appear as normal browser)
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

            console.log('  📄 Loading page...');
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Get page title
            results.pageTitle = await page.title();
            console.log(`  ✓ Loaded: ${results.pageTitle}`);

            // Extract main content using Readability-style algorithm
            console.log('  📝 Extracting content...');
            const content = await this.extractMainContent(page);
            results.rawText = content.text;
            results.html = content.html;

            // Extract all tables (often contain genealogical data)
            console.log('  📊 Extracting tables...');
            results.tables = await this.extractTables(page);

            // Find all downloadable documents
            console.log('  📎 Finding documents...');
            results.documents = await this.findDocuments(page, url);

            // Find all images (might be scanned documents)
            console.log('  🖼️  Finding images...');
            results.images = await this.findImages(page, url);

            await page.close();

            console.log(`  ✓ Scraping complete (${Date.now() - startTime}ms)`);
            console.log(`    • Text: ${results.rawText.length} characters`);
            console.log(`    • Tables: ${results.tables.length}`);
            console.log(`    • Documents: ${results.documents.length}`);
            console.log(`    • Images: ${results.images.length}`);

            return results;

        } catch (error) {
            console.error(`  ✗ Scraping failed:`, error.message);
            results.errors.push({
                stage: 'scraping',
                error: error.message
            });
            return results;
        }
    }

    /**
     * Extract main content from page (remove nav, ads, footer, etc.)
     */
    async extractMainContent(page) {
        return await page.evaluate(() => {
            // Remove unwanted elements
            const unwantedSelectors = [
                'nav', 'header', 'footer', 'aside',
                '.advertisement', '.ad', '.sidebar',
                '.navigation', '.menu', '.comments',
                'script', 'style', 'noscript'
            ];

            unwantedSelectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Get main content area (try common selectors)
            let mainElement =
                document.querySelector('main') ||
                document.querySelector('article') ||
                document.querySelector('[role="main"]') ||
                document.querySelector('.content') ||
                document.querySelector('#content') ||
                document.body;

            return {
                text: mainElement.innerText,
                html: mainElement.innerHTML
            };
        });
    }

    /**
     * Extract all tables from page
     */
    async extractTables(page) {
        return await page.evaluate(() => {
            const tables = [];

            document.querySelectorAll('table').forEach((table, index) => {
                const headers = [];
                const rows = [];

                // Get headers
                table.querySelectorAll('thead th, tr:first-child th').forEach(th => {
                    headers.push(th.innerText.trim());
                });

                // If no headers in thead, try first row
                if (headers.length === 0) {
                    const firstRow = table.querySelector('tr');
                    if (firstRow) {
                        firstRow.querySelectorAll('td, th').forEach(cell => {
                            headers.push(cell.innerText.trim());
                        });
                    }
                }

                // Get all data rows
                table.querySelectorAll('tbody tr, tr').forEach((tr, rowIndex) => {
                    const row = [];
                    tr.querySelectorAll('td').forEach(td => {
                        row.push(td.innerText.trim());
                    });
                    if (row.length > 0) {
                        rows.push(row);
                    }
                });

                if (rows.length > 0) {
                    tables.push({
                        index,
                        headers,
                        rows,
                        rowCount: rows.length,
                        columnCount: headers.length || rows[0].length
                    });
                }
            });

            return tables;
        });
    }

    /**
     * Find all downloadable documents on page
     */
    async findDocuments(page, baseUrl) {
        const documents = await page.evaluate(() => {
            const docs = [];

            document.querySelectorAll('a[href]').forEach(link => {
                const href = link.href;
                const text = link.innerText.trim();
                const lower = href.toLowerCase();

                // Check if link points to a document
                if (lower.endsWith('.pdf') ||
                    lower.endsWith('.doc') ||
                    lower.endsWith('.docx') ||
                    lower.includes('download') ||
                    lower.includes('document') ||
                    lower.includes('/file/') ||
                    lower.includes('attachment')) {

                    docs.push({
                        url: href,
                        text: text
                    });
                }
            });

            return docs;
        });

        // Deduplicate and add document type guessing (must be done in Node.js context)
        const unique = [];
        const seen = new Set();

        documents.forEach(doc => {
            if (!seen.has(doc.url)) {
                seen.add(doc.url);
                // Add guessed type in Node.js context where we have access to class methods
                doc.guessedType = this.guessDocumentType(doc.text + ' ' + doc.url);
                unique.push(doc);
            }
        });

        return unique;
    }

    /**
     * Find all images on page (might be scanned documents)
     */
    async findImages(page, baseUrl) {
        return await page.evaluate(() => {
            const images = [];

            document.querySelectorAll('img[src]').forEach((img, index) => {
                const src = img.src;
                const alt = img.alt || '';

                // Skip tiny images (likely icons, logos)
                if (img.naturalWidth < 100 || img.naturalHeight < 100) {
                    return;
                }

                // Skip data URIs
                if (src.startsWith('data:')) {
                    return;
                }

                images.push({
                    url: src,
                    alt: alt,
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                    index
                });
            });

            return images;
        });
    }

    /**
     * Guess document type from filename/text
     *
     * PRIMARY SOURCES include:
     * - Wills, probate records, estate inventories
     * - Slave schedules, census records
     * - Deeds, bills of sale
     * - Letters (from slaves, owners, family members)
     * - Newspaper advertisements (slave sales, runaway rewards)
     * - Court records
     */
    guessDocumentType(text) {
        const lower = text.toLowerCase();

        // Wills and estates
        if (lower.includes('will') || lower.includes('testament')) return 'will';
        if (lower.includes('probate')) return 'probate';
        if (lower.includes('inventory') || lower.includes('estate')) return 'estate_inventory';

        // Slavery-specific records
        if (lower.includes('slave schedule')) return 'slave_schedule';
        if (lower.includes('bill of sale') || lower.includes('sale of slaves')) return 'bill_of_sale';
        if (lower.includes('runaway') || lower.includes('reward')) return 'runaway_ad';
        if (lower.includes('slave auction') || lower.includes('slaves for sale')) return 'slave_sale_ad';

        // Letters and correspondence
        if (lower.includes('letter') || lower.includes('correspondence')) return 'letter';
        if (lower.includes('diary') || lower.includes('journal')) return 'diary';

        // Legal records
        if (lower.includes('deed') || lower.includes('land')) return 'deed';
        if (lower.includes('court') || lower.includes('trial')) return 'court_record';

        // Census and vital records
        if (lower.includes('census')) return 'census';
        if (lower.includes('marriage') || lower.includes('wedding')) return 'marriage';
        if (lower.includes('birth')) return 'birth_certificate';
        if (lower.includes('death') || lower.includes('obituary')) return 'death_certificate';

        // Newspaper
        if (lower.includes('newspaper') || lower.includes('gazette') || lower.includes('advertisement')) return 'newspaper';

        return 'other';
    }

    /**
     * Download a document from URL
     */
    async downloadDocument(docUrl, metadata = {}) {
        try {
            console.log(`    📥 Downloading: ${docUrl}`);

            const response = await fetch(docUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const buffer = await response.arrayBuffer();

            // Generate filename
            const urlPath = new URL(docUrl).pathname;
            const originalFilename = path.basename(urlPath) || 'document';
            const hash = crypto.createHash('md5').update(docUrl).digest('hex').substring(0, 8);
            const filename = `${Date.now()}_${hash}_${originalFilename}`;
            const filePath = path.join(this.downloadDir, filename);

            // Save file
            fs.writeFileSync(filePath, Buffer.from(buffer));

            const fileSize = fs.statSync(filePath).size;
            console.log(`    ✓ Downloaded: ${filename} (${(fileSize / 1024).toFixed(1)} KB)`);

            return {
                success: true,
                filePath,
                filename,
                originalUrl: docUrl,
                fileSize,
                metadata
            };

        } catch (error) {
            console.error(`    ✗ Download failed:`, error.message);
            return {
                success: false,
                error: error.message,
                originalUrl: docUrl
            };
        }
    }

    /**
     * Download multiple documents
     */
    async downloadDocuments(documents) {
        const results = [];

        for (const doc of documents) {
            const result = await this.downloadDocument(doc.url, {
                text: doc.text,
                guessedType: doc.guessedType
            });
            results.push(result);

            // Small delay to be polite
            await this.sleep(1000);
        }

        return results;
    }

    /**
     * Close browser
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    /**
     * Utility: Sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = AutonomousWebScraper;
