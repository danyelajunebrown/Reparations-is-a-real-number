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
const NarrativeExtractor = require('./NarrativeExtractor');
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
        this.narrativeExtractor = new NarrativeExtractor();

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

            // Parse OCR options (page selection, etc.) from ocr_config
            const ocrOptions = job.ocr_config ? (typeof job.ocr_config === 'string' ? JSON.parse(job.ocr_config) : job.ocr_config) : {};

            this.debug('JOB_INFO', 'Retrieved job details', {
                contentUrl: contentUrl || 'NOT SET',
                sessionUrl,
                sourceType: sourceMetadata?.sourceType,
                archiveName: sourceMetadata?.archiveName,
                contentType: sourceMetadata?.contentType,
                columnCount: columns.length,
                hasIframe: sourceMetadata?.hasIframe,
                hasPdfLink: sourceMetadata?.hasPdfLink,
                ocrOptions: ocrOptions
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

            // Run OCR with page selection options
            this.debug('OCR_START', 'Starting OCR processing', { contentType: downloadResult.contentType, ocrOptions });
            const ocrResults = await this.runOCR(downloadResult.buffer, downloadResult.contentType, ocrOptions);

            this.debug('OCR_COMPLETE', 'OCR processing completed', {
                service: ocrResults.service,
                confidence: ocrResults.confidence,
                textLength: ocrResults.text?.length || 0,
                textPreview: ocrResults.text?.substring(0, 200) || 'EMPTY'
            });

            await this.updateExtractionStatus(extractionId, 'processing', { progress: 60, status_message: 'Parsing results...' });

            // Parse OCR text into rows
            this.debug('PARSE_START', 'Parsing OCR text into rows', { columnCount: columns.length });
            let parsedRows = await this.parseOCRtoRows(ocrResults.text, columns);

            this.debug('PARSE_COMPLETE', 'Table parsing completed', {
                rowCount: parsedRows.length,
                sampleRow: parsedRows[0] || null
            });

            // Check if table parsing worked well
            const avgTableConfidence = parsedRows.length > 0
                ? parsedRows.reduce((sum, row) => sum + row.confidence, 0) / parsedRows.length
                : 0;

            // If table parsing has low confidence or few multi-column rows, try narrative extraction
            const multiColumnRows = parsedRows.filter(r => Object.keys(r.columns).length >= 3).length;
            const tableParsingWorked = avgTableConfidence > 0.5 && multiColumnRows > parsedRows.length * 0.3;

            if (!tableParsingWorked && ocrResults.text && ocrResults.text.length > 500) {
                this.debug('NARRATIVE_START', 'Table parsing insufficient, trying narrative extraction', {
                    avgTableConfidence,
                    multiColumnRows,
                    totalRows: parsedRows.length
                });

                await this.updateExtractionStatus(extractionId, 'processing', {
                    progress: 70,
                    status_message: 'Extracting entities from narrative text...'
                });

                // Get target names from session context if available
                const targetNames = this.extractTargetNamesFromContext(contentStructure);

                // Run narrative extraction
                const narrativeResults = await this.narrativeExtractor.extractFromNarrative(
                    ocrResults.text,
                    { targetNames }
                );

                this.debug('NARRATIVE_COMPLETE', 'Narrative extraction completed', {
                    slaveholders: narrativeResults.slaveholders.length,
                    enslaved: narrativeResults.enslavedPersons.length,
                    transactions: narrativeResults.transactions.length,
                    relationships: narrativeResults.relationships.length,
                    confidence: narrativeResults.confidence
                });

                // Convert narrative results to row format
                const narrativeRows = this.narrativeExtractor.toRowFormat(narrativeResults);

                // If narrative extraction found meaningful data, use it instead or combine
                if (narrativeRows.length > 0 && narrativeResults.confidence > avgTableConfidence) {
                    this.debug('NARRATIVE_CHOSEN', 'Using narrative extraction results', {
                        narrativeRows: narrativeRows.length,
                        narrativeConfidence: narrativeResults.confidence,
                        tableConfidence: avgTableConfidence
                    });

                    // Combine both results, narrative first
                    parsedRows = [...narrativeRows, ...parsedRows.filter(r => Object.keys(r.columns).length >= 3)];
                } else {
                    // Add narrative insights as supplementary data
                    this.debug('NARRATIVE_SUPPLEMENTARY', 'Adding narrative insights as supplement');
                    parsedRows = [...parsedRows, ...narrativeRows];
                }
            }

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
     * @param {Object} options - OCR options (page selection, etc.)
     * @returns {Promise<Object>} OCR results
     */
    async runOCR(buffer, contentType = 'application/pdf', options = {}) {
        this.debug('OCR_INIT', 'Initializing OCR', { contentType, bufferSize: buffer?.length, options });

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
                bufferLength: file.buffer?.length,
                pageOptions: options
            });

            // Process with OCR, passing page selection options
            const results = await this.ocrProcessor.process(file, options);

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
     * Uses intelligent table detection and multiple parsing strategies
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

            this.debug('PARSE_INIT', 'Starting OCR text parsing', {
                textLength: ocrText.length,
                columnCount: columns.length,
                columnHeaders: columns.map(c => c.headerExact || c.headerGuess)
            });

            // Split text into lines
            const lines = ocrText.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            // Try to detect table structure
            const tableStructure = this.detectTableStructure(lines, columns);
            this.debug('PARSE_STRUCTURE', 'Table structure detected', tableStructure);

            const parsedRows = [];
            let rowIndex = 0;

            // Parse based on detected structure
            if (tableStructure.type === 'tab_delimited') {
                // Tab-separated values
                for (const line of lines) {
                    if (this.isHeaderLine(line, columns)) continue;
                    if (this.isNoiseLine(line)) continue;

                    const row = this.parseTabDelimited(line, columns, rowIndex++);
                    if (row && Object.keys(row.columns).length >= 2) {
                        parsedRows.push(row);
                    }
                }
            } else if (tableStructure.type === 'fixed_width') {
                // Fixed-width columns (common in historical records)
                for (const line of lines) {
                    if (this.isHeaderLine(line, columns)) continue;
                    if (this.isNoiseLine(line)) continue;

                    const row = this.parseFixedWidth(line, columns, tableStructure.columnPositions, rowIndex++);
                    if (row && Object.keys(row.columns).length >= 2) {
                        parsedRows.push(row);
                    }
                }
            } else if (tableStructure.type === 'pipe_delimited') {
                // Pipe-separated values
                for (const line of lines) {
                    if (this.isHeaderLine(line, columns)) continue;
                    if (this.isNoiseLine(line)) continue;

                    const row = this.parsePipeDelimited(line, columns, rowIndex++);
                    if (row && Object.keys(row.columns).length >= 2) {
                        parsedRows.push(row);
                    }
                }
            } else {
                // Smart whitespace-based parsing
                for (const line of lines) {
                    if (this.isHeaderLine(line, columns)) continue;
                    if (this.isNoiseLine(line)) continue;

                    const row = this.parseSmartWhitespace(line, columns, rowIndex++);
                    if (row && Object.keys(row.columns).length >= 2) {
                        parsedRows.push(row);
                    }
                }
            }

            this.debug('PARSE_COMPLETE', 'OCR parsing completed', {
                lineCount: lines.length,
                parsedRowCount: parsedRows.length,
                avgConfidence: parsedRows.length > 0
                    ? (parsedRows.reduce((sum, r) => sum + r.confidence, 0) / parsedRows.length).toFixed(2)
                    : 0
            });

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
     * Detect the table structure from OCR text
     * @param {string[]} lines - Text lines
     * @param {Array} columns - Expected columns
     * @returns {Object} Structure info
     */
    detectTableStructure(lines, columns) {
        const structure = {
            type: 'whitespace',
            columnPositions: [],
            delimiter: null,
            confidence: 0.5
        };

        // Sample first 20 non-header lines
        const sampleLines = lines.slice(0, 20).filter(l => !this.isNoiseLine(l));

        if (sampleLines.length === 0) return structure;

        // Check for tab delimiters
        const tabCount = sampleLines.filter(l => l.includes('\t')).length;
        if (tabCount / sampleLines.length > 0.5) {
            structure.type = 'tab_delimited';
            structure.delimiter = '\t';
            structure.confidence = 0.9;
            return structure;
        }

        // Check for pipe delimiters
        const pipeCount = sampleLines.filter(l => l.includes('|')).length;
        if (pipeCount / sampleLines.length > 0.5) {
            structure.type = 'pipe_delimited';
            structure.delimiter = '|';
            structure.confidence = 0.9;
            return structure;
        }

        // Check for fixed-width by analyzing spacing patterns
        const columnPositions = this.detectFixedWidthColumns(sampleLines, columns.length);
        if (columnPositions.length >= columns.length - 1) {
            structure.type = 'fixed_width';
            structure.columnPositions = columnPositions;
            structure.confidence = 0.7;
            return structure;
        }

        return structure;
    }

    /**
     * Detect fixed-width column positions by analyzing whitespace patterns
     * @param {string[]} lines - Sample lines
     * @param {number} expectedColumns - Expected number of columns
     * @returns {number[]} Column start positions
     */
    detectFixedWidthColumns(lines, expectedColumns) {
        if (lines.length === 0) return [];

        // Find the longest line to establish max width
        const maxLength = Math.max(...lines.map(l => l.length));

        // Count spaces at each position across all lines
        const spaceFrequency = new Array(maxLength).fill(0);

        for (const line of lines) {
            for (let i = 0; i < line.length; i++) {
                if (line[i] === ' ' && i > 0 && line[i-1] !== ' ') {
                    // This is a transition from non-space to space
                    spaceFrequency[i]++;
                }
            }
        }

        // Find positions with high space frequency (likely column boundaries)
        const threshold = lines.length * 0.4;
        const boundaries = [];

        for (let i = 0; i < spaceFrequency.length; i++) {
            if (spaceFrequency[i] >= threshold) {
                // Merge nearby boundaries
                if (boundaries.length === 0 || i - boundaries[boundaries.length - 1] > 3) {
                    boundaries.push(i);
                }
            }
        }

        return boundaries;
    }

    /**
     * Check if a line is a header line
     * @param {string} line - Line to check
     * @param {Array} columns - Column definitions
     * @returns {boolean}
     */
    isHeaderLine(line, columns) {
        const lineLower = line.toLowerCase();
        let matchCount = 0;

        for (const col of columns) {
            const header = (col.headerExact || col.headerGuess || '').toLowerCase();
            if (header && lineLower.includes(header)) {
                matchCount++;
            }
        }

        // If more than half of column headers match, it's a header line
        return matchCount >= columns.length / 2;
    }

    /**
     * Check if a line is noise (headers, footers, page numbers, etc.)
     * @param {string} line - Line to check
     * @returns {boolean}
     */
    isNoiseLine(line) {
        // Skip very short lines
        if (line.length < 5) return true;

        // Skip page numbers
        if (/^(page\s*)?\d+\s*$/i.test(line)) return true;

        // Skip lines that are all dashes or equals (table borders)
        if (/^[-=_|+]+$/.test(line)) return true;

        // Skip lines with only special characters
        if (/^[^a-zA-Z0-9]+$/.test(line)) return true;

        // Skip common document noise
        const noisePatterns = [
            /^copyright/i,
            /^all rights reserved/i,
            /^continued/i,
            /^total[:\s]/i,
            /^\(continued\)/i,
            /^maryland historical/i,
            /^page \d+ of \d+/i,
            /^--- page/i
        ];

        return noisePatterns.some(pattern => pattern.test(line));
    }

    /**
     * Parse a tab-delimited line
     */
    parseTabDelimited(line, columns, rowIndex) {
        const values = line.split('\t').map(v => v.trim());
        return this.assignValuesToColumns(values, columns, line, rowIndex);
    }

    /**
     * Parse a pipe-delimited line
     */
    parsePipeDelimited(line, columns, rowIndex) {
        const values = line.split('|').map(v => v.trim()).filter(v => v.length > 0);
        return this.assignValuesToColumns(values, columns, line, rowIndex);
    }

    /**
     * Parse a fixed-width line
     */
    parseFixedWidth(line, columns, positions, rowIndex) {
        const values = [];
        let lastPos = 0;

        for (const pos of positions) {
            values.push(line.substring(lastPos, pos).trim());
            lastPos = pos;
        }
        // Get the last column
        values.push(line.substring(lastPos).trim());

        return this.assignValuesToColumns(values.filter(v => v.length > 0), columns, line, rowIndex);
    }

    /**
     * Smart whitespace-based parsing that looks for 2+ consecutive spaces
     */
    parseSmartWhitespace(line, columns, rowIndex) {
        // Split by 2+ spaces (common in typed/printed documents)
        const values = line.split(/\s{2,}/)
            .map(v => v.trim())
            .filter(v => v.length > 0);

        // If we got reasonable number of values, use them
        if (values.length >= 2) {
            return this.assignValuesToColumns(values, columns, line, rowIndex);
        }

        // Otherwise, try splitting by single space but be smarter about it
        // Look for capitalized words that might start new columns
        const smartValues = this.intelligentSplit(line, columns);
        return this.assignValuesToColumns(smartValues, columns, line, rowIndex);
    }

    /**
     * Intelligent split based on expected column types
     * @param {string} line - Line to split
     * @param {Array} columns - Column definitions with data types
     * @returns {string[]} Split values
     */
    intelligentSplit(line, columns) {
        const values = [];
        let remaining = line.trim();

        for (let i = 0; i < columns.length && remaining.length > 0; i++) {
            const col = columns[i];
            const dataType = col.dataType;

            let extracted = null;
            let match = null;

            // Try to extract based on expected data type
            switch (dataType) {
                case 'date':
                    // Match date patterns: YYYY, MM/DD/YYYY, Month DD, YYYY, etc.
                    match = remaining.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|[A-Za-z]+\s+\d{4})\s*/);
                    break;
                case 'age':
                    // Match age patterns: number or range
                    match = remaining.match(/^(\d{1,3}(?:\s*-\s*\d{1,3})?(?:\s*(?:years?|yrs?|mos?|months?))?)\s*/i);
                    break;
                case 'gender':
                    // Match gender: M, F, Male, Female, Man, Woman
                    match = remaining.match(/^(M|F|Male|Female|Man|Woman|Boy|Girl)\s*/i);
                    break;
                case 'owner_name':
                case 'enslaved_name':
                case 'witness':
                    // Match names: Capitalized words with possible suffixes
                    match = remaining.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Jr\.?|Sr\.?|III?|IV|V))?)\s*/);
                    break;
                case 'compensation':
                    // Match money: $XXX.XX or number
                    match = remaining.match(/^(\$?\d+(?:\.\d{2})?|\d+\s*(?:dollars?|cts?|cents?))\s*/i);
                    break;
                default:
                    // Generic: take until next large gap or end
                    match = remaining.match(/^([^\s]{1,50}(?:\s[^\s]+){0,5}?)\s{2,}|^(.+)$/);
            }

            if (match) {
                extracted = (match[1] || match[2] || '').trim();
                remaining = remaining.substring(match[0].length).trim();
            } else {
                // Fall back: take first word
                const spaceIdx = remaining.indexOf(' ');
                if (spaceIdx > 0) {
                    extracted = remaining.substring(0, spaceIdx);
                    remaining = remaining.substring(spaceIdx + 1).trim();
                } else {
                    extracted = remaining;
                    remaining = '';
                }
            }

            if (extracted) {
                values.push(extracted);
            }
        }

        return values;
    }

    /**
     * Assign extracted values to columns
     */
    assignValuesToColumns(values, columns, rawLine, rowIndex) {
        const row = {
            rowIndex,
            columns: {},
            confidence: 0,
            rawText: rawLine
        };

        // Assign values to columns based on position
        let assignedCount = 0;
        for (let i = 0; i < Math.min(values.length, columns.length); i++) {
            const column = columns[i];
            const value = values[i];

            if (column && value && value.length > 0) {
                const headerName = column.headerExact || column.headerGuess || `Column ${column.position}`;
                row.columns[headerName] = value;
                assignedCount++;
            }
        }

        // Calculate confidence based on column fill rate
        row.confidence = assignedCount / columns.length;

        return row;
    }

    /**
     * Parse a single line into column values (legacy method for compatibility)
     * @param {string} line - Text line
     * @param {Array} columns - Column definitions
     * @returns {Object} Parsed row
     */
    parseLineToColumns(line, columns) {
        return this.parseSmartWhitespace(line, columns, 0);
    }

    /**
     * Extract target names from content structure (user's description)
     * This helps the narrative extractor know who to look for
     * @param {Object} contentStructure - Session's content structure
     * @returns {string[]} List of names to search for
     */
    extractTargetNamesFromContext(contentStructure) {
        const names = [];

        if (!contentStructure) return names;

        // Check for explicitly mentioned names in the description
        const description = contentStructure.rawHumanInput || contentStructure.description || '';

        // Extract capitalized names (2+ words starting with capitals)
        const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
        let match;
        while ((match = namePattern.exec(description)) !== null) {
            names.push(match[1]);
        }

        // Check column headers for owner/slaveholder columns
        const columns = contentStructure.columns || [];
        for (const col of columns) {
            const header = (col.headerExact || col.headerGuess || '').toLowerCase();
            if (header.includes('owner') || header.includes('slaveholder') || header.includes('master')) {
                // This is a slaveholder column - look for common slaveholding family names in region
                // These would ideally come from a knowledge base
            }
        }

        return [...new Set(names)];
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
