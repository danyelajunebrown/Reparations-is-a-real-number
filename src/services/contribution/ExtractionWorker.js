/**
 * ExtractionWorker - OCR Processing Service
 *
 * This service handles the actual OCR extraction process:
 * 1. Download PDF from source URL
 * 2. Run OCR using Google Cloud Vision
 * 3. Parse OCR text into structured rows based on column definitions
 * 4. Save results to database
 * 5. Update extraction job status
 *
 * DEBUGGING: This module has comprehensive logging at every stage.
 * Check extraction_jobs.debug_log for full diagnostic information.
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const OCRProcessor = require('../document/OCRProcessor');
const logger = require('../../utils/logger');

// Playwright is optional - may not be installed on all systems
let chromium = null;
try {
    chromium = require('playwright').chromium;
} catch (e) {
    logger.warn('Playwright not available - browser-based OCR will be disabled', { error: e.message });
}

// Puppeteer as alternative to Playwright
let puppeteer = null;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    logger.warn('Puppeteer not available - will try other methods', { error: e.message });
}

class ExtractionWorker {
    /**
     * Constructor
     * @param {Object} database - Database connection
     */
    constructor(database) {
        this.db = database;
        this.ocrProcessor = new OCRProcessor();

        // Debug log buffer - stores detailed diagnostic info
        this.debugLog = [];
        this.currentExtractionId = null;
    }

    /**
     * Add entry to debug log with timestamp
     * @param {string} stage - Current processing stage
     * @param {string} message - Log message
     * @param {Object} data - Additional data
     */
    debug(stage, message, data = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            stage,
            message,
            data,
            elapsed: this.startTime ? Date.now() - this.startTime : 0
        };

        this.debugLog.push(entry);

        // Also log to console/file for server-side visibility
        logger.info(`[Extraction:${this.currentExtractionId?.slice(0,8)}] ${stage}: ${message}`, data);

        // Persist to database periodically
        this.persistDebugLog().catch(err => {
            logger.error('Failed to persist debug log', { error: err.message });
        });
    }

    /**
     * Persist debug log to database
     */
    async persistDebugLog() {
        if (!this.currentExtractionId || this.debugLog.length === 0) return;

        try {
            await this.db.query(`
                UPDATE extraction_jobs
                SET debug_log = $1
                WHERE extraction_id = $2
            `, [JSON.stringify(this.debugLog), this.currentExtractionId]);
        } catch (error) {
            // Silently fail - debug log is not critical
        }
    }

    /**
     * Process an extraction job from start to finish
     * @param {string} extractionId - The extraction job ID
     */
    async processExtraction(extractionId) {
        // Initialize debug state
        this.currentExtractionId = extractionId;
        this.debugLog = [];
        this.startTime = Date.now();

        this.debug('INIT', 'Starting extraction process', { extractionId });

        try {
            // Update status to processing
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 5 });
            this.debug('STATUS', 'Updated status to processing');

            // Get extraction job details
            this.debug('DB_QUERY', 'Fetching extraction job details');
            const jobResult = await this.db.query(`
                SELECT ej.*, cs.content_structure, cs.source_metadata, cs.url as session_url
                FROM extraction_jobs ej
                JOIN contribution_sessions cs ON ej.session_id = cs.session_id
                WHERE ej.extraction_id = $1
            `, [extractionId]);

            if (jobResult.rows.length === 0) {
                this.debug('ERROR', 'Extraction job not found in database');
                throw new Error('Extraction job not found');
            }

            const job = jobResult.rows[0];
            const contentUrl = job.content_url;
            const sourceMetadata = job.source_metadata ? (typeof job.source_metadata === 'string' ? JSON.parse(job.source_metadata) : job.source_metadata) : {};
            const contentStructure = job.content_structure ? (typeof job.content_structure === 'string' ? JSON.parse(job.content_structure) : job.content_structure) : {};
            const columns = contentStructure?.columns || [];
            const sessionUrl = job.session_url;

            this.debug('JOB_INFO', 'Retrieved job details', {
                contentUrl: contentUrl || 'NOT SET',
                sessionUrl,
                sourceType: sourceMetadata?.sourceType,
                archiveName: sourceMetadata?.archiveName,
                contentType: sourceMetadata?.contentType,
                columnCount: columns.length,
                hasIframe: sourceMetadata?.hasIframe,
                hasPdfLink: sourceMetadata?.hasPdfLink
            });

            // Update progress
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 10 });

            // Determine the best URL to fetch
            const fetchUrl = contentUrl || sourceMetadata?.contentUrl || sessionUrl;
            if (!fetchUrl) {
                this.debug('ERROR', 'No valid URL found to fetch content', { contentUrl, sessionUrl });
                throw new Error('No content URL available for extraction');
            }

            this.debug('URL_RESOLVE', 'Determined fetch URL', { fetchUrl, source: contentUrl ? 'content_url' : sessionUrl ? 'session_url' : 'unknown' });

            // Download content using multiple fallback methods
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 15, status_message: 'Downloading content...' });
            const downloadResult = await this.downloadContentWithFallbacks(fetchUrl, sourceMetadata);

            if (!downloadResult.success) {
                this.debug('ERROR', 'All download methods failed', {
                    attemptedMethods: downloadResult.attemptedMethods,
                    errors: downloadResult.errors
                });
                throw new Error(`Failed to download content: ${downloadResult.errors.join('; ')}`);
            }

            this.debug('DOWNLOAD', 'Content downloaded successfully', {
                method: downloadResult.method,
                contentType: downloadResult.contentType,
                size: downloadResult.buffer?.length || 0
            });

            await this.updateExtractionStatus(extractionId, 'processing', { progress: 40, status_message: 'Running OCR...' });

            // Run OCR
            this.debug('OCR_START', 'Starting OCR processing', { contentType: downloadResult.contentType });
            const ocrResults = await this.runOCR(downloadResult.buffer, downloadResult.contentType);

            this.debug('OCR_COMPLETE', 'OCR processing completed', {
                service: ocrResults.service,
                confidence: ocrResults.confidence,
                textLength: ocrResults.text?.length || 0,
                textPreview: ocrResults.text?.substring(0, 200) || 'EMPTY'
            });

            await this.updateExtractionStatus(extractionId, 'processing', { progress: 60, status_message: 'Parsing results...' });

            // Parse OCR text into rows
            this.debug('PARSE_START', 'Parsing OCR text into rows', { columnCount: columns.length });
            const parsedRows = await this.parseOCRtoRows(ocrResults.text, columns);

            this.debug('PARSE_COMPLETE', 'Parsing completed', {
                rowCount: parsedRows.length,
                sampleRow: parsedRows[0] || null
            });

            await this.updateExtractionStatus(extractionId, 'processing', { progress: 80, status_message: 'Finalizing...' });

            // Calculate average confidence
            const avgConfidence = parsedRows.length > 0
                ? parsedRows.reduce((sum, row) => sum + row.confidence, 0) / parsedRows.length
                : 0;

            // Update job with results
            this.debug('SAVE', 'Saving extraction results to database');
            await this.db.query(`
                UPDATE extraction_jobs
                SET
                    status = 'completed',
                    progress = 100,
                    status_message = 'Extraction complete',
                    raw_ocr_text = $1,
                    parsed_rows = $2,
                    row_count = $3,
                    avg_confidence = $4,
                    completed_at = NOW(),
                    debug_log = $6
                WHERE extraction_id = $5
            `, [
                ocrResults.text,
                JSON.stringify(parsedRows),
                parsedRows.length,
                parseFloat(avgConfidence.toFixed(2)),
                extractionId,
                JSON.stringify(this.debugLog)
            ]);

            this.debug('COMPLETE', 'Extraction completed successfully', {
                rowCount: parsedRows.length,
                avgConfidence: avgConfidence.toFixed(2),
                totalTime: Date.now() - this.startTime
            });

            logger.operation('Extraction completed successfully', {
                extractionId,
                rowCount: parsedRows.length,
                avgConfidence: avgConfidence.toFixed(2)
            });

            return {
                success: true,
                extractionId,
                rowCount: parsedRows.length,
                avgConfidence,
                status: 'completed'
            };

        } catch (error) {
            this.debug('FATAL_ERROR', 'Extraction failed with error', {
                error: error.message,
                stack: error.stack
            });

            logger.error('Extraction failed', {
                extractionId,
                error: error.message,
                stack: error.stack
            });

            // Update job status to failed with full debug log
            await this.updateExtractionStatus(extractionId, 'failed', {
                error_message: error.message,
                debug_log: JSON.stringify(this.debugLog)
            });

            return {
                success: false,
                extractionId,
                error: error.message,
                status: 'failed',
                debugLog: this.debugLog
            };
        }
    }

    /**
     * Download content using multiple fallback methods
     * Tries direct download, then browser-based approaches, then alternative methods
     * @param {string} url - URL to download
     * @param {Object} sourceMetadata - Source metadata for context
     * @returns {Promise<Object>} Download result with buffer and metadata
     */
    async downloadContentWithFallbacks(url, sourceMetadata = {}) {
        const result = {
            success: false,
            buffer: null,
            method: null,
            contentType: null,
            attemptedMethods: [],
            errors: []
        };

        // Method 1: Direct HTTP download
        this.debug('DOWNLOAD_METHOD', 'Attempting direct HTTP download', { url });
        try {
            const directResult = await this.tryDirectDownload(url);
            if (directResult.success) {
                result.success = true;
                result.buffer = directResult.buffer;
                result.method = 'direct_http';
                result.contentType = directResult.contentType;
                return result;
            }
            result.attemptedMethods.push('direct_http');
            result.errors.push(`Direct download: ${directResult.error}`);
        } catch (error) {
            result.attemptedMethods.push('direct_http');
            result.errors.push(`Direct download: ${error.message}`);
            this.debug('DOWNLOAD_FAIL', 'Direct download failed', { error: error.message });
        }

        // Method 2: Try with different User-Agent (pretend to be browser)
        this.debug('DOWNLOAD_METHOD', 'Attempting browser-mimicking download');
        try {
            const browserMimicResult = await this.tryBrowserMimicDownload(url);
            if (browserMimicResult.success) {
                result.success = true;
                result.buffer = browserMimicResult.buffer;
                result.method = 'browser_mimic';
                result.contentType = browserMimicResult.contentType;
                return result;
            }
            result.attemptedMethods.push('browser_mimic');
            result.errors.push(`Browser mimic: ${browserMimicResult.error}`);
        } catch (error) {
            result.attemptedMethods.push('browser_mimic');
            result.errors.push(`Browser mimic: ${error.message}`);
            this.debug('DOWNLOAD_FAIL', 'Browser mimic download failed', { error: error.message });
        }

        // Method 3: Try fetching the parent page and extracting PDF link
        if (sourceMetadata?.hasPdfLink || !url.endsWith('.pdf')) {
            this.debug('DOWNLOAD_METHOD', 'Attempting to find and fetch PDF from page');
            try {
                const pdfLinkResult = await this.tryExtractAndFetchPdf(url, sourceMetadata);
                if (pdfLinkResult.success) {
                    result.success = true;
                    result.buffer = pdfLinkResult.buffer;
                    result.method = 'pdf_link_extraction';
                    result.contentType = 'application/pdf';
                    return result;
                }
                result.attemptedMethods.push('pdf_link_extraction');
                result.errors.push(`PDF extraction: ${pdfLinkResult.error}`);
            } catch (error) {
                result.attemptedMethods.push('pdf_link_extraction');
                result.errors.push(`PDF extraction: ${error.message}`);
                this.debug('DOWNLOAD_FAIL', 'PDF link extraction failed', { error: error.message });
            }
        }

        // Method 4: Browser-based screenshot (Puppeteer or Playwright)
        if (puppeteer || chromium) {
            this.debug('DOWNLOAD_METHOD', 'Attempting browser-based screenshot');
            try {
                const screenshotResult = await this.tryBrowserScreenshot(url);
                if (screenshotResult.success) {
                    result.success = true;
                    result.buffer = screenshotResult.buffer;
                    result.method = 'browser_screenshot';
                    result.contentType = 'image/png';
                    return result;
                }
                result.attemptedMethods.push('browser_screenshot');
                result.errors.push(`Browser screenshot: ${screenshotResult.error}`);
            } catch (error) {
                result.attemptedMethods.push('browser_screenshot');
                result.errors.push(`Browser screenshot: ${error.message}`);
                this.debug('DOWNLOAD_FAIL', 'Browser screenshot failed', { error: error.message });
            }
        } else {
            this.debug('DOWNLOAD_SKIP', 'Skipping browser screenshot - no browser automation available');
            result.errors.push('Browser screenshot: No browser automation library available (install puppeteer or playwright)');
        }

        // Method 5: Report failure with detailed diagnostics
        this.debug('DOWNLOAD_EXHAUSTED', 'All download methods exhausted', {
            attemptedMethods: result.attemptedMethods,
            errorCount: result.errors.length
        });

        return result;
    }

    /**
     * Try direct HTTP download
     */
    async tryDirectDownload(url) {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60000,
            headers: {
                'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)',
                'Accept': 'application/pdf,image/*,*/*'
            },
            validateStatus: (status) => status < 400
        });

        if (response.status >= 400) {
            return { success: false, error: `HTTP ${response.status}` };
        }

        const contentType = response.headers['content-type'] || 'application/octet-stream';
        return {
            success: true,
            buffer: Buffer.from(response.data),
            contentType
        };
    }

    /**
     * Try download mimicking a real browser
     */
    async tryBrowserMimicDownload(url) {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1'
            },
            validateStatus: (status) => status < 400,
            maxRedirects: 10
        });

        if (response.status >= 400) {
            return { success: false, error: `HTTP ${response.status}` };
        }

        const contentType = response.headers['content-type'] || 'application/octet-stream';
        return {
            success: true,
            buffer: Buffer.from(response.data),
            contentType
        };
    }

    /**
     * Try to find PDF link in page and fetch it
     */
    async tryExtractAndFetchPdf(url, sourceMetadata) {
        // Fetch the HTML page
        const cheerio = require('cheerio');
        const pageResponse = await axios.get(url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(pageResponse.data);

        // Look for PDF links
        let pdfUrl = null;

        // Common PDF link patterns
        const pdfPatterns = [
            'a[href$=".pdf"]',
            'a[href*="/pdf/"]',
            'iframe[src$=".pdf"]',
            'iframe[src*="/pdf/"]',
            'embed[src$=".pdf"]',
            'object[data$=".pdf"]'
        ];

        for (const pattern of pdfPatterns) {
            const el = $(pattern).first();
            if (el.length) {
                pdfUrl = el.attr('href') || el.attr('src') || el.attr('data');
                if (pdfUrl) {
                    this.debug('PDF_FOUND', 'Found PDF link in page', { pattern, pdfUrl });
                    break;
                }
            }
        }

        // Also check for Maryland State Archives specific pattern
        const msaMatch = pageResponse.data.match(/href="([^"]*\.pdf)"/i);
        if (!pdfUrl && msaMatch) {
            pdfUrl = msaMatch[1];
            this.debug('PDF_FOUND', 'Found MSA PDF link', { pdfUrl });
        }

        if (!pdfUrl) {
            return { success: false, error: 'No PDF link found in page' };
        }

        // Resolve relative URL
        const resolvedUrl = new URL(pdfUrl, url).href;
        this.debug('PDF_RESOLVE', 'Resolved PDF URL', { original: pdfUrl, resolved: resolvedUrl });

        // Try to fetch the PDF
        const pdfResult = await this.tryBrowserMimicDownload(resolvedUrl);
        return pdfResult;
    }

    /**
     * Try browser-based screenshot
     */
    async tryBrowserScreenshot(url) {
        let browser = null;
        try {
            // Prefer Puppeteer as it's more commonly available
            if (puppeteer) {
                this.debug('BROWSER', 'Launching Puppeteer');
                browser = await puppeteer.launch({
                    headless: 'new',
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
            } else if (chromium) {
                this.debug('BROWSER', 'Launching Playwright Chromium');
                browser = await chromium.launch();
            } else {
                return { success: false, error: 'No browser automation available' };
            }

            const page = await browser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });

            this.debug('BROWSER', 'Navigating to URL', { url });
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // Wait a bit for any dynamic content
            await new Promise(r => setTimeout(r, 2000));

            this.debug('BROWSER', 'Taking screenshot');
            const screenshot = await page.screenshot({
                fullPage: true,
                type: 'png'
            });

            await browser.close();

            return {
                success: true,
                buffer: Buffer.from(screenshot),
                contentType: 'image/png'
            };

        } catch (error) {
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Run OCR on content buffer
     * @param {Buffer} buffer - Content buffer to process
     * @param {string} contentType - MIME type of the content
     * @returns {Promise<Object>} OCR results
     */
    async runOCR(buffer, contentType = 'application/pdf') {
        this.debug('OCR_INIT', 'Initializing OCR', { contentType, bufferSize: buffer?.length });

        try {
            // Determine file extension and mimetype
            let extension = '.pdf';
            let mimetype = contentType;

            if (contentType.includes('image/png')) {
                extension = '.png';
                mimetype = 'image/png';
            } else if (contentType.includes('image/jpeg') || contentType.includes('image/jpg')) {
                extension = '.jpg';
                mimetype = 'image/jpeg';
            } else if (contentType.includes('image/')) {
                extension = '.png';
                mimetype = 'image/png';
            }

            // Create file object for OCR processor
            const file = {
                buffer: buffer,
                originalname: `document${extension}`,
                mimetype: mimetype
            };

            this.debug('OCR_PROCESS', 'Sending to OCR processor', {
                filename: file.originalname,
                mimetype: file.mimetype,
                bufferLength: file.buffer?.length
            });

            // Process with OCR
            const results = await this.ocrProcessor.process(file);

            this.debug('OCR_RESULT', 'OCR processor returned', {
                hasText: !!results.text,
                textLength: results.text?.length || 0,
                confidence: results.confidence,
                service: results.service,
                hasError: !!results.error
            });

            if (!results.text || results.text.trim().length === 0) {
                this.debug('OCR_WARNING', 'OCR returned empty text', { results });
                // Don't throw - return empty results so frontend can show appropriate message
                return {
                    text: '',
                    confidence: 0,
                    service: results.service || 'unknown',
                    error: 'OCR returned no text - document may be image-based or protected'
                };
            }

            logger.operation('OCR processing completed', {
                service: results.service,
                confidence: results.confidence,
                textLength: results.text.length
            });

            return results;

        } catch (error) {
            this.debug('OCR_ERROR', 'OCR processing failed', {
                error: error.message,
                stack: error.stack
            });

            logger.error('OCR processing failed', {
                error: error.message
            });

            // Return error result instead of throwing
            return {
                text: '',
                confidence: 0,
                service: 'error',
                error: `OCR processing failed: ${error.message}`
            };
        }
    }

    /**
     * Parse OCR text into structured rows based on column definitions
     * @param {string} ocrText - Raw OCR text
     * @param {Array} columns - Column definitions
     * @returns {Promise<Array>} Parsed rows
     */
    async parseOCRtoRows(ocrText, columns) {
        try {
            if (!ocrText || ocrText.trim().length === 0) {
                return [];
            }

            if (!columns || columns.length === 0) {
                logger.warn('No columns defined for parsing');
                return [];
            }

            // Split text into lines
            const lines = ocrText.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            const parsedRows = [];

            // Parse each line into columns
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Skip header lines that match column headers exactly
                const headerMatch = columns.some(col =>
                    line.includes(col.headerExact || col.headerGuess || '')
                );

                if (headerMatch && i === 0) {
                    continue; // Skip header row
                }

                // Parse line into columns
                const row = this.parseLineToColumns(line, columns);

                if (row && Object.keys(row.columns).length > 0) {
                    parsedRows.push(row);
                }
            }

            logger.operation('OCR text parsed into rows', {
                lineCount: lines.length,
                parsedRowCount: parsedRows.length,
                columnCount: columns.length
            });

            return parsedRows;

        } catch (error) {
            logger.error('Failed to parse OCR text to rows', {
                error: error.message
            });
            throw new Error(`Failed to parse OCR text: ${error.message}`);
        }
    }

    /**
     * Parse a single line into column values
     * @param {string} line - Text line
     * @param {Array} columns - Column definitions
     * @returns {Object} Parsed row
     */
    parseLineToColumns(line, columns) {
        const row = {
            rowIndex: 0, // Will be set by caller
            columns: {},
            confidence: 0.85, // Default confidence
            rawText: line
        };

        // Simple parsing: split by whitespace and assign to columns
        const values = line.split(/\s{2,}/) // Split by 2+ spaces
            .map(v => v.trim())
            .filter(v => v.length > 0);

        // Assign values to columns based on position
        for (let i = 0; i < Math.min(values.length, columns.length); i++) {
            const column = columns[i];
            const value = values[i];

            if (column && value) {
                const headerName = column.headerExact || column.headerGuess || `Column ${column.position}`;
                row.columns[headerName] = value;
            }
        }

        // Calculate confidence based on line completeness
        const filledColumns = Object.keys(row.columns).length;
        const totalColumns = columns.length;
        row.confidence = filledColumns / totalColumns;

        return row;
    }

    /**
     * Update extraction job status
     * @param {string} extractionId - Extraction job ID
     * @param {string} status - New status
     * @param {Object} data - Additional data to update
     */
    async updateExtractionStatus(extractionId, status, data = {}) {
        try {
            const updateData = {
                status
            };

            // Add additional data
            if (data.progress !== undefined) {
                updateData.progress = data.progress;
            }
            if (data.error_message) {
                updateData.error_message = data.error_message;
            }
            if (data.status_message) {
                updateData.status_message = data.status_message;
            }
            if (data.debug_log) {
                updateData.debug_log = data.debug_log;
            }

            // Build query
            const fields = [];
            const values = [];
            let paramIndex = 1;

            for (const [key, value] of Object.entries(updateData)) {
                fields.push(`${key} = $${paramIndex}`);
                values.push(value);
                paramIndex++;
            }

            // Always update the updated_at timestamp
            fields.push(`updated_at = NOW()`);

            values.push(extractionId);

            const query = `
                UPDATE extraction_jobs
                SET ${fields.join(', ')}
                WHERE extraction_id = $${paramIndex}
            `;

            await this.db.query(query, values);

            logger.debug('Extraction status updated', {
                extractionId,
                status,
                data
            });

        } catch (error) {
            logger.error('Failed to update extraction status', {
                extractionId,
                status,
                error: error.message
            });
            // Don't throw - status update failure shouldn't abort extraction
            this.debug('STATUS_UPDATE_FAIL', 'Failed to update status', { error: error.message });
        }
    }

    /**
     * Get extraction capabilities for diagnostics
     * @returns {Object} Available capabilities
     */
    getCapabilities() {
        return {
            ocrProcessor: !!this.ocrProcessor,
            puppeteer: !!puppeteer,
            playwright: !!chromium,
            browserAutomation: !!(puppeteer || chromium)
        };
    }

    /**
     * Process browser-based extraction (for protected URLs)
     * @param {string} extractionId - The extraction job ID
     */
    async processBrowserBasedExtraction(extractionId) {
        // Initialize debug state
        this.currentExtractionId = extractionId;
        this.debugLog = [];
        this.startTime = Date.now();

        this.debug('INIT', 'Starting browser-based extraction process', { extractionId });

        try {
            // Update status to processing
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 5 });
            this.debug('STATUS', 'Updated status to processing');

            // Get extraction job details
            this.debug('DB_QUERY', 'Fetching extraction job details');
            const jobResult = await this.db.query(`
                SELECT ej.*, cs.content_structure, cs.source_metadata, cs.url as session_url
                FROM extraction_jobs ej
                JOIN contribution_sessions cs ON ej.session_id = cs.session_id
                WHERE ej.extraction_id = $1
            `, [extractionId]);

            if (jobResult.rows.length === 0) {
                this.debug('ERROR', 'Extraction job not found in database');
                throw new Error('Extraction job not found');
            }

            const job = jobResult.rows[0];
            const contentUrl = job.content_url;
            const sourceMetadata = job.source_metadata ? (typeof job.source_metadata === 'string' ? JSON.parse(job.source_metadata) : job.source_metadata) : {};
            const contentStructure = job.content_structure ? (typeof job.content_structure === 'string' ? JSON.parse(job.content_structure) : job.content_structure) : {};
            const columns = contentStructure?.columns || [];
            const sessionUrl = job.session_url;

            this.debug('JOB_INFO', 'Retrieved job details for browser-based extraction', {
                contentUrl: contentUrl || 'NOT SET',
                sessionUrl,
                sourceType: sourceMetadata?.sourceType,
                archiveName: sourceMetadata?.archiveName,
                contentType: sourceMetadata?.contentType,
                columnCount: columns.length
            });

            // Update progress
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 10 });

            // Determine the best URL to fetch
            const fetchUrl = contentUrl || sourceMetadata?.contentUrl || sessionUrl;
            if (!fetchUrl) {
                this.debug('ERROR', 'No valid URL found to fetch content', { contentUrl, sessionUrl });
                throw new Error('No content URL available for extraction');
            }

            this.debug('URL_RESOLVE', 'Determined fetch URL for browser-based extraction', { fetchUrl });

            // Use browser-based screenshot method
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 20, status_message: 'Launching browser...' });
            const screenshotResult = await this.tryBrowserScreenshot(fetchUrl);

            if (!screenshotResult.success) {
                this.debug('ERROR', 'Browser-based screenshot failed', {
                    error: screenshotResult.error
                });
                throw new Error(`Browser-based screenshot failed: ${screenshotResult.error}`);
            }

            this.debug('BROWSER_SUCCESS', 'Browser-based screenshot successful', {
                method: screenshotResult.method,
                contentType: screenshotResult.contentType,
                size: screenshotResult.buffer?.length || 0
            });

            await this.updateExtractionStatus(extractionId, 'processing', { progress: 50, status_message: 'Running OCR on screenshot...' });

            // Run OCR on the screenshot
            this.debug('OCR_START', 'Starting OCR processing on screenshot', { contentType: screenshotResult.contentType });
            const ocrResults = await this.runOCR(screenshotResult.buffer, screenshotResult.contentType);

            this.debug('OCR_COMPLETE', 'OCR processing completed on screenshot', {
                service: ocrResults.service,
                confidence: ocrResults.confidence,
                textLength: ocrResults.text?.length || 0,
                textPreview: ocrResults.text?.substring(0, 200) || 'EMPTY'
            });

            await this.updateExtractionStatus(extractionId, 'processing', { progress: 70, status_message: 'Parsing results...' });

            // Parse OCR text into rows
            this.debug('PARSE_START', 'Parsing OCR text into rows', { columnCount: columns.length });
            const parsedRows = await this.parseOCRtoRows(ocrResults.text, columns);

            this.debug('PARSE_COMPLETE', 'Parsing completed', {
                rowCount: parsedRows.length,
                sampleRow: parsedRows[0] || null
            });

            await this.updateExtractionStatus(extractionId, 'processing', { progress: 90, status_message: 'Finalizing...' });

            // Calculate average confidence
            const avgConfidence = parsedRows.length > 0
                ? parsedRows.reduce((sum, row) => sum + row.confidence, 0) / parsedRows.length
                : 0;

            // Update job with results
            this.debug('SAVE', 'Saving browser-based extraction results to database');
            await this.db.query(`
                UPDATE extraction_jobs
                SET
                    status = 'completed',
                    progress = 100,
                    status_message = 'Browser-based extraction complete',
                    raw_ocr_text = $1,
                    parsed_rows = $2,
                    row_count = $3,
                    avg_confidence = $4,
                    completed_at = NOW(),
                    debug_log = $6,
                    method = 'browser_based_ocr'
                WHERE extraction_id = $5
            `, [
                ocrResults.text,
                JSON.stringify(parsedRows),
                parsedRows.length,
                parseFloat(avgConfidence.toFixed(2)),
                extractionId,
                JSON.stringify(this.debugLog)
            ]);

            this.debug('COMPLETE', 'Browser-based extraction completed successfully', {
                rowCount: parsedRows.length,
                avgConfidence: avgConfidence.toFixed(2),
                totalTime: Date.now() - this.startTime
            });

            logger.operation('Browser-based extraction completed successfully', {
                extractionId,
                rowCount: parsedRows.length,
                avgConfidence: avgConfidence.toFixed(2)
            });

            return {
                success: true,
                extractionId,
                rowCount: parsedRows.length,
                avgConfidence,
                status: 'completed'
            };

        } catch (error) {
            this.debug('FATAL_ERROR', 'Browser-based extraction failed with error', {
                error: error.message,
                stack: error.stack
            });

            logger.error('Browser-based extraction failed', {
                extractionId,
                error: error.message,
                stack: error.stack
            });

            // Update job status to failed with full debug log
            await this.updateExtractionStatus(extractionId, 'failed', {
                error_message: error.message,
                debug_log: JSON.stringify(this.debugLog)
            });

            return {
                success: false,
                extractionId,
                error: error.message,
                status: 'failed',
                debugLog: this.debugLog
            };
        }
    }
}

module.exports = ExtractionWorker;
