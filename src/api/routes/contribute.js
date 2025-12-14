/**
 * Contribute API Routes - Conversational Contribution Pipeline
 *
 * These endpoints support the human-guided contribution flow where
 * the system asks questions and the human provides context that
 * machines can't divine on their own.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const ContributionSession = require('../../services/contribution/ContributionSession');
const OwnerPromotion = require('../../services/contribution/OwnerPromotion');
const SourceClassifier = require('../../services/SourceClassifier');
const SourceAnalyzer = require('../../services/SourceAnalyzer');
const FamilySearchCatalogProcessor = require('../../services/FamilySearchCatalogProcessor');
const UniversalRouter = require('../../services/UniversalRouter');

// Initialize classifiers and analyzers
const sourceClassifier = new SourceClassifier();
let sourceAnalyzer = null; // Will be initialized with database connection

// Configure multer for file uploads (memory storage for processing)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max per file
        files: 20 // Max 20 files at once
    },
    fileFilter: (req, file, cb) => {
        // Accept only images
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Will be initialized with database connection
let contributionService = null;
let promotionService = null;

/**
 * Initialize the contribution service with database
 */
function initializeService(database, extractionWorker = null) {
    contributionService = new ContributionSession(database, extractionWorker);
    promotionService = new OwnerPromotion(database);
    sourceAnalyzer = new SourceAnalyzer(database);
}

/**
 * POST /api/contribute/start
 * Start a new contribution session with a URL
 */
router.post('/start', async (req, res) => {
    try {
        const { url, contributorId } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }

        // Create session
        const session = await contributionService.createSession(url, contributorId);

        // Immediately analyze the URL
        const analysis = await contributionService.analyzeUrl(session.sessionId);

        res.json({
            success: true,
            sessionId: session.sessionId,
            analysis: analysis.analysis,
            message: analysis.message,
            questions: analysis.questions,
            stage: 'content_description'
        });

    } catch (error) {
        console.error('Contribute start error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/contribute/capabilities
 * Get system capabilities for OCR extraction
 * NOTE: This route MUST come before /:sessionId routes to avoid being caught as a sessionId
 */
router.get('/capabilities', async (req, res) => {
    try {
        // Get extraction worker capabilities if available
        let capabilities = {
            ocrProcessor: false,
            puppeteer: false,
            playwright: false,
            browserAutomation: false
        };

        // Try to get real capabilities from the extraction worker
        if (contributionService && contributionService.extractionWorker) {
            capabilities = contributionService.extractionWorker.getCapabilities();
        }

        // Check for common dependencies
        const checks = {
            googleVision: false,
            tesseract: false
        };

        try {
            require('@google-cloud/vision');
            checks.googleVision = true;
        } catch (e) {}

        try {
            require('tesseract.js');
            checks.tesseract = true;
        } catch (e) {}

        res.json({
            success: true,
            capabilities: {
                ...capabilities,
                ...checks
            },
            message: capabilities.browserAutomation
                ? 'Full extraction capabilities available'
                : 'Limited extraction - browser automation not available (install puppeteer)'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// UNIFIED SEARCH AND STATS ENDPOINTS
// Must be defined BEFORE /:sessionId routes to avoid route conflicts
// =============================================================================

/**
 * GET /api/contribute/search/:query
 * Search across all person tables (unconfirmed_persons, enslaved_people, individuals)
 * This is what the homepage search should call
 */
router.get('/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const { limit = 50, source, type } = req.query;

        if (!query || query.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Query must be at least 2 characters'
            });
        }

        // Use direct connection to ensure we connect to the right database
        const { Pool } = require('pg');
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            return res.status(500).json({
                success: false,
                error: 'DATABASE_URL not configured'
            });
        }
        const pool = new Pool({
            connectionString,
            ssl: { rejectUnauthorized: false }
        });

        // Natural language processing for person type detection
        const queryLower = query.toLowerCase();
        let detectedType = type || null;
        let searchTerms = query;

        // Detect owner/slaveholder queries
        const ownerPatterns = [
            /slave\s*owners?/i,
            /slaveholders?/i,
            /owners?\s+of\s+slaves?/i,
            /plantation\s+owners?/i,
            /masters?/i
        ];

        // Detect enslaved person queries
        const enslavedPatterns = [
            /enslaved\s*(people|persons?|individuals?)?/i,
            /slaves?(?!\s*owners?)/i,
            /bondsmen/i,
            /bondswomen/i
        ];

        // Check for owner patterns
        for (const pattern of ownerPatterns) {
            if (pattern.test(queryLower)) {
                detectedType = 'owner';
                searchTerms = query.replace(pattern, '').trim();
                break;
            }
        }

        // Check for enslaved patterns
        if (!detectedType) {
            for (const pattern of enslavedPatterns) {
                if (pattern.test(queryLower)) {
                    detectedType = 'enslaved';
                    searchTerms = query.replace(pattern, '').trim();
                    break;
                }
            }
        }

        // Build search query - use AND between words for name searches
        const stopWords = ['in', 'the', 'a', 'an', 'of', 'for', 'to', 'from', 'with', 'by', 'on', 'at'];
        const words = searchTerms.split(/\s+/).filter(w => w.length >= 2 && !stopWords.includes(w.toLowerCase()));

        let whereClause;
        let params;
        let paramIndex = 1;
        const hasTextSearch = words.length > 0;

        if (hasTextSearch) {
            // Use AND between words - all words must match the name
            // This ensures "grace butler" only returns records with BOTH words in the name
            const nameConditions = words.map((_, i) => `full_name ILIKE $${i + 1}`).join(' AND ');
            whereClause = `(${nameConditions})`;
            params = words.map(w => `%${w}%`);
            paramIndex = params.length + 1;
        } else {
            whereClause = '1=1';
            params = [];
        }

        // Build query to search both unconfirmed_persons AND enslaved_individuals
        let unconfirmedWhere = whereClause;
        let enslavedWhere = whereClause;

        // Handle source filter
        if (source) {
            unconfirmedWhere += ` AND source_url ILIKE $${paramIndex}`;
            params.push(`%${source}%`);
            paramIndex++;
        }

        // Handle type filter for unconfirmed_persons
        if (detectedType) {
            if (detectedType === 'owner') {
                unconfirmedWhere += ` AND (person_type IN ('owner', 'slaveholder', 'suspected_owner', 'confirmed_owner'))`;
            } else if (detectedType === 'enslaved') {
                unconfirmedWhere += ` AND (person_type IN ('enslaved', 'suspected_enslaved', 'confirmed_enslaved'))`;
            } else {
                unconfirmedWhere += ` AND person_type = $${paramIndex}`;
                params.push(detectedType);
                paramIndex++;
            }
        }

        // Combined query: unconfirmed_persons UNION enslaved_individuals
        let sql = `
            SELECT * FROM (
                SELECT
                    lead_id::text as id,
                    full_name as name,
                    person_type as type,
                    source_url,
                    source_type,
                    confidence_score,
                    locations,
                    context_text,
                    scraped_at as created_at,
                    'unconfirmed_persons' as table_source
                FROM unconfirmed_persons
                WHERE ${unconfirmedWhere}

                UNION ALL

                SELECT
                    enslaved_id as id,
                    full_name as name,
                    'enslaved' as type,
                    NULL as source_url,
                    'confirmed' as source_type,
                    1.0 as confidence_score,
                    NULL as locations,
                    notes as context_text,
                    created_at,
                    'enslaved_individuals' as table_source
                FROM enslaved_individuals
                WHERE ${enslavedWhere}
            ) combined
            ORDER BY confidence_score DESC NULLS LAST, created_at DESC
            LIMIT $${paramIndex}
        `;
        params.push(parseInt(limit));

        const result = await pool.query(sql, params);

        // Extract S3 archive URL from context_text
        const extractArchiveUrl = (contextText) => {
            if (!contextText) return null;
            const s3Match = contextText.match(/https:\/\/[^"'\s]+\.s3[^"'\s]*\.amazonaws\.com[^"'\s]*/);
            if (s3Match) return s3Match[0];
            const archivedMatch = contextText.match(/Archived:\s*(https:\/\/[^\s]+)/);
            if (archivedMatch) return archivedMatch[1];
            return null;
        };

        const processedResults = result.rows.map(row => ({
            ...row,
            archive_url: extractArchiveUrl(row.context_text)
        }));

        // Group by source
        const bySource = {};
        processedResults.forEach(row => {
            const sourceKey = row.source_url ? new URL(row.source_url).hostname : 'unknown';
            if (!bySource[sourceKey]) bySource[sourceKey] = [];
            bySource[sourceKey].push(row);
        });

        await pool.end();

        res.json({
            success: true,
            query,
            searchTerms: searchTerms || query,
            filteredWords: words,
            hasTextSearch,
            detectedType,
            count: processedResults.length,
            results: processedResults,
            bySource,
            sources: Object.keys(bySource).map(key => ({
                hostname: key,
                count: bySource[key].length
            }))
        });

    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/contribute/stats
 * Get statistics about the database records
 */
router.get('/stats', async (req, res) => {
    try {
        const pool = contributionService?.db;
        if (!pool) {
            return res.status(500).json({
                success: false,
                error: 'Database connection not available'
            });
        }

        const stats = await pool.query(`
            SELECT
                COUNT(*) as total_records,
                COUNT(DISTINCT source_url) as unique_sources,
                COUNT(CASE WHEN person_type IN ('owner', 'slaveholder', 'confirmed_owner') THEN 1 END) as slaveholders,
                COUNT(CASE WHEN person_type IN ('enslaved', 'confirmed_enslaved') THEN 1 END) as enslaved,
                COUNT(CASE WHEN source_url LIKE '%msa.maryland.gov%' THEN 1 END) as msa_records,
                COUNT(CASE WHEN source_url LIKE '%familysearch%' THEN 1 END) as familysearch_records,
                COUNT(CASE WHEN source_url LIKE '%civilwardc%' THEN 1 END) as civilwardc_records
            FROM unconfirmed_persons
        `);

        res.json({
            success: true,
            stats: stats.rows[0]
        });

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// SESSION MANAGEMENT ENDPOINTS
// =============================================================================

/**
 * POST /api/contribute/:sessionId/describe
 * Process user's description of what they see
 */
router.post('/:sessionId/describe', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { description, answers } = req.body;

        if (!description && !answers) {
            return res.status(400).json({
                success: false,
                error: 'Description or answers required'
            });
        }

        // Combine answers into description if provided
        let fullDescription = description || '';
        if (answers) {
            for (const [key, value] of Object.entries(answers)) {
                fullDescription += ` ${key}: ${value}.`;
            }
        }

        const result = await contributionService.processContentDescription(
            sessionId,
            fullDescription
        );

        res.json({
            success: true,
            parsed: result.parsed,
            message: result.message,
            questions: result.questions,
            stage: result.nextStage,
            sessionSummary: contributionService.getSessionSummary(result.session)
        });

    } catch (error) {
        console.error('Describe error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/contribute/:sessionId/confirm
 * Confirm the understood structure
 */
router.post('/:sessionId/confirm', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { confirmed, corrections } = req.body;

        const result = await contributionService.confirmStructure(sessionId, {
            confirmed: confirmed !== false,
            corrections: corrections || {}
        });

        res.json({
            success: true,
            message: result.message,
            extractionOptions: result.extractionOptions,
            stage: result.nextStage,
            sessionSummary: contributionService.getSessionSummary(result.session)
        });

    } catch (error) {
        console.error('Confirm error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/contribute/:sessionId/pdf-info
 * Get PDF page count and info for page selection
 */
router.get('/:sessionId/pdf-info', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = await contributionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Get the PDF URL from session
        const pdfUrl = session.sourceMetadata?.contentUrl || session.url;
        if (!pdfUrl) {
            return res.status(400).json({
                success: false,
                error: 'No PDF URL found in session'
            });
        }

        // Check if it's a PDF
        if (!pdfUrl.toLowerCase().includes('.pdf')) {
            return res.status(400).json({
                success: false,
                error: 'URL does not appear to be a PDF'
            });
        }

        // Try to get page count by downloading and analyzing
        try {
            const axios = require('axios');
            const pdfParse = require('pdf-parse');

            // Fetch first few KB to get page count (PDF metadata is usually at start)
            const response = await axios.get(pdfUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)',
                    'Range': 'bytes=0-500000' // Get first 500KB for metadata
                }
            });

            let pageCount = 0;
            let fileSize = response.headers['content-length'] || 'unknown';

            try {
                const pdfData = await pdfParse(Buffer.from(response.data));
                pageCount = pdfData.numpages || 0;
            } catch (parseError) {
                // If parsing fails, estimate from file size (rough: ~50KB per page for scanned docs)
                const contentLength = parseInt(response.headers['content-length'] || '0');
                pageCount = Math.max(1, Math.ceil(contentLength / 100000));
            }

            res.json({
                success: true,
                pdfInfo: {
                    url: pdfUrl,
                    pageCount,
                    fileSize,
                    suggestedSkip: 2, // Suggest skipping first 2 pages for cover/TOC
                    archiveType: session.sourceMetadata?.archiveName || 'unknown'
                }
            });

        } catch (fetchError) {
            // If we can't fetch, return basic info
            res.json({
                success: true,
                pdfInfo: {
                    url: pdfUrl,
                    pageCount: 0, // Unknown
                    fileSize: 'unknown',
                    suggestedSkip: 2,
                    archiveType: session.sourceMetadata?.archiveName || 'unknown',
                    note: 'Could not fetch PDF metadata. You can still specify page numbers manually.'
                }
            });
        }

    } catch (error) {
        console.error('PDF info error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

    /**
     * POST /api/contribute/:sessionId/extract
     * Start extraction with chosen method
     */
    router.post('/:sessionId/extract', async (req, res) => {
        try {
            const { sessionId } = req.params;
            const { method, options } = req.body;

            if (!method) {
                return res.status(400).json({
                    success: false,
                    error: 'Extraction method required'
                });
            }

            const validMethods = ['auto_ocr', 'browser_based_ocr', 'manual_text', 'screenshot_upload', 'guided_entry', 'sample_learn', 'csv_upload'];
            if (!validMethods.includes(method)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid method. Must be one of: ${validMethods.join(', ')}`
                });
            }

            const result = await contributionService.startExtraction(sessionId, method, options);

            res.json({
                success: true,
                extractionId: result.extractionId,
                method: result.method,
                message: result.message,
                stage: result.nextStage
            });

        } catch (error) {
            console.error('Extract error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

/**
 * GET /api/contribute/:sessionId
 * Get current session state
 */
router.get('/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = await contributionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        res.json({
            success: true,
            session: contributionService.getSessionSummary(session),
            conversation: session.conversationHistory,
            sourceMetadata: session.sourceMetadata,
            contentStructure: session.contentStructure,
            extractionGuidance: session.extractionGuidance
        });

    } catch (error) {
        console.error('Get session error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/contribute/:sessionId/chat
 * General chat endpoint for natural language interaction
 * Routes to appropriate handler based on current stage
 */
router.post('/:sessionId/chat', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Message required'
            });
        }

        const session = await contributionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        let result;

        // Route based on current stage
        switch (session.currentStage) {
            case 'url_analysis':
                // Re-analyze if needed
                result = await contributionService.analyzeUrl(sessionId);
                break;

            case 'content_description':
                result = await contributionService.processContentDescription(sessionId, message);
                break;

            case 'structure_confirmation':
                // Parse confirmation from message
                const isConfirmed = /yes|correct|right|good|proceed|continue/i.test(message);
                result = await contributionService.confirmStructure(sessionId, {
                    confirmed: isConfirmed
                });
                break;

            case 'extraction_strategy':
                // Try to detect method from message
                let method = null;
                if (/auto|ocr|automatic/i.test(message)) method = 'auto_ocr';
                if (/guided|manual|row by row/i.test(message)) method = 'guided_entry';
                if (/sample|learn|example/i.test(message)) method = 'sample_learn';
                if (/csv|spreadsheet|upload/i.test(message)) method = 'csv_upload';

                if (method) {
                    result = await contributionService.startExtraction(sessionId, method);
                } else {
                    result = {
                        message: "I didn't catch which method you'd like. Please choose:\n" +
                                "1. **Auto-OCR** - I run OCR, you correct mistakes\n" +
                                "2. **Guided Entry** - You type what you see row by row\n" +
                                "3. **Sample & Learn** - Give me examples, I learn the pattern\n" +
                                "4. **CSV Upload** - Upload a spreadsheet",
                        extractionOptions: contributionService.getExtractionOptions(session)
                    };
                }
                break;

            default:
                result = {
                    message: `Session is in stage: ${session.currentStage}. ` +
                            `Please use the appropriate endpoint for this stage.`
                };
        }

        res.json({
            success: true,
            ...result,
            stage: session.currentStage,
            sessionSummary: contributionService.getSessionSummary(session)
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/contribute/:sessionId/sample
 * Submit sample extractions for learning
 */
router.post('/:sessionId/sample', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { samples } = req.body;

        if (!samples || !Array.isArray(samples) || samples.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Samples array required'
            });
        }

        const session = await contributionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Store samples in extraction guidance
        if (!session.extractionGuidance) {
            session.extractionGuidance = {};
        }
        session.extractionGuidance.sampleExtractions = samples;

        await contributionService.updateSession(session);

        res.json({
            success: true,
            message: `Received ${samples.length} sample extractions. These will help guide the extraction process.`,
            sampleCount: samples.length
        });

    } catch (error) {
        console.error('Sample error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/contribute/:sessionId/extraction/:extractionId/status
 * Get extraction job status with full debug information
 */
router.get('/:sessionId/extraction/:extractionId/status', async (req, res) => {
    try {
        const { sessionId, extractionId } = req.params;
        const includeDebug = req.query.debug === 'true';

        // Query extraction job status including debug log
        const result = await contributionService.db.query(`
            SELECT
                extraction_id,
                method,
                status,
                progress,
                status_message,
                row_count,
                avg_confidence,
                human_corrections,
                illegible_count,
                error_message,
                started_at,
                completed_at,
                updated_at,
                parsed_rows,
                raw_ocr_text,
                debug_log
            FROM extraction_jobs
            WHERE extraction_id = $1 AND session_id = $2
        `, [extractionId, sessionId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Extraction job not found'
            });
        }

        const job = result.rows[0];

        // Parse debug log if present
        let debugLog = null;
        if (includeDebug && job.debug_log) {
            try {
                debugLog = typeof job.debug_log === 'string' ? JSON.parse(job.debug_log) : job.debug_log;
            } catch (e) {
                debugLog = [{ error: 'Failed to parse debug log' }];
            }
        }

        // Parse parsed_rows if present
        let parsedRows = null;
        if (job.parsed_rows) {
            try {
                parsedRows = typeof job.parsed_rows === 'string' ? JSON.parse(job.parsed_rows) : job.parsed_rows;
            } catch (e) {
                parsedRows = null;
            }
        }

        res.json({
            success: true,
            extraction: {
                id: job.extraction_id,
                method: job.method,
                status: job.status,
                progress: job.progress || 0,
                statusMessage: job.status_message || '',
                rowCount: job.row_count || 0,
                avgConfidence: job.avg_confidence || 0,
                humanCorrections: job.human_corrections || 0,
                illegibleCount: job.illegible_count || 0,
                error: job.error_message,
                startedAt: job.started_at,
                completedAt: job.completed_at,
                updatedAt: job.updated_at,
                parsedRows: parsedRows,
                rawOcrText: job.raw_ocr_text,
                debugLog: debugLog,
                // Calculate time elapsed
                elapsedMs: job.started_at ? Date.now() - new Date(job.started_at).getTime() : 0
            }
        });

    } catch (error) {
        console.error('Extraction status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

    /**
     * POST /api/contribute/:sessionId/extraction/:extractionId/correct
     * Submit corrections to extracted data
     */
    router.post('/:sessionId/extraction/:extractionId/correct', async (req, res) => {
        try {
            const { sessionId, extractionId } = req.params;
            const { corrections } = req.body;

            if (!corrections || !Array.isArray(corrections)) {
                return res.status(400).json({
                    success: false,
                    error: 'Corrections array required'
                });
            }

            // Store each correction
            for (const correction of corrections) {
                await contributionService.db.query(`
                    INSERT INTO extraction_corrections
                    (extraction_id, row_index, field_name, original_value, corrected_value, corrected_by)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    extractionId,
                    correction.rowIndex,
                    correction.field,
                    correction.originalValue,
                    correction.correctedValue,
                    correction.correctedBy || 'anonymous'
                ]);
            }

            // Update extraction job correction count
            await contributionService.db.query(`
                UPDATE extraction_jobs
                SET human_corrections = human_corrections + $1
                WHERE extraction_id = $2
            `, [corrections.length, extractionId]);

            res.json({
                success: true,
                message: `Applied ${corrections.length} corrections`,
                correctionCount: corrections.length
            });

        } catch (error) {
            console.error('Correction error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /api/contribute/:sessionId/extraction/:extractionId/manual-text
     * Process manually copied text when PDF download fails
     */
    router.post('/:sessionId/extraction/:extractionId/manual-text', async (req, res) => {
        try {
            const { sessionId, extractionId } = req.params;
            const { text, method } = req.body;

            if (!text || typeof text !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Text content required'
                });
            }

            // Process text using OCR processor
            const ocrResults = await contributionService.processManualText(extractionId, text);

            res.json({
                success: true,
                message: `Processed manual text: ${ocrResults.rowCount} rows extracted`,
                rowCount: ocrResults.rowCount,
                avgConfidence: ocrResults.avgConfidence,
                parsedRows: ocrResults.parsedRows
            });

        } catch (error) {
            console.error('Manual text processing error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /api/contribute/:sessionId/extraction/:extractionId/screenshots
     * Process uploaded screenshots when PDF download fails
     * Uses multer middleware for file uploads
     */
    router.post('/:sessionId/extraction/:extractionId/screenshots', upload.array('images', 20), async (req, res) => {
        try {
            const { sessionId, extractionId } = req.params;

            // req.files is an array when using upload.array()
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'At least one image file required. Make sure to use form field name "images".'
                });
            }

            console.log(`Processing ${req.files.length} uploaded screenshots for extraction ${extractionId}`);

            // Process screenshots using OCR processor
            const ocrResults = await contributionService.processScreenshots(extractionId, req.files);

            res.json({
                success: true,
                message: `Processed ${req.files.length} screenshots: ${ocrResults.rowCount} rows extracted`,
                rowCount: ocrResults.rowCount,
                avgConfidence: ocrResults.avgConfidence,
                parsedRows: ocrResults.parsedRows
            });

        } catch (error) {
            console.error('Screenshot processing error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

// =============================================================================
// OWNER PROMOTION ENDPOINTS
// =============================================================================

/**
 * POST /api/contribute/:sessionId/extraction/:extractionId/promote
 * Promote qualifying owners to the individuals table
 * REQUIRES a confirmatory channel - domain alone does NOT confirm data
 */
router.post('/:sessionId/extraction/:extractionId/promote', async (req, res) => {
    try {
        const { sessionId, extractionId } = req.params;
        const { confirmationChannel } = req.body;

        // CRITICAL: Must specify how the data was confirmed
        if (!confirmationChannel) {
            return res.status(400).json({
                success: false,
                error: 'Confirmatory channel is required',
                hint: 'Data must be confirmed via human transcription, verified OCR, or other valid channel.',
                availableChannels: promotionService.getConfirmatoryChannels()
            });
        }

        // Get session to retrieve source metadata
        const session = await contributionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        const sourceMetadata = session.sourceMetadata;

        // Run promotion with the specified confirmatory channel
        const result = await promotionService.promoteFromExtraction(
            extractionId,
            sourceMetadata,
            confirmationChannel
        );

        if (result.error) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        res.json({
            success: true,
            message: `Promoted ${result.promoted} slave owners via ${confirmationChannel}`,
            ...result
        });

    } catch (error) {
        console.error('Promotion error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/contribute/promote/:leadId
 * Manually promote a specific unconfirmed person by lead ID
 */
router.post('/promote/:leadId', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { verifiedBy } = req.body;

        const result = await promotionService.promoteById(leadId, verifiedBy || 'manual_review');

        if (result.success) {
            res.json({
                success: true,
                message: `Promoted ${result.person} to confirmed individuals`,
                individualId: result.individualId,
                action: result.action
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.reason
            });
        }

    } catch (error) {
        console.error('Manual promotion error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/contribute/promotion-stats
 * Get statistics about promoted individuals
 */
router.get('/promotion-stats', async (req, res) => {
    try {
        const stats = await promotionService.getStats();

        res.json({
            success: true,
            stats
        });

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/contribute/check-federal
 * Check if a URL qualifies as a federal source
 */
router.post('/check-federal', async (req, res) => {
    try {
        const { url, documentType } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL required'
            });
        }

        const isFederal = promotionService.isFederalSource(url, documentType);

        res.json({
            success: true,
            url,
            isFederalSource: isFederal,
            message: isFederal
                ? 'This is a federal/government source - owners can be auto-promoted'
                : 'This is not a recognized federal source - data will go to unconfirmed_persons'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// SOURCE CLASSIFICATION & INTELLIGENT ROUTING ENDPOINTS
// =============================================================================

/**
 * POST /api/contribute/classify-source
 * Analyze a URL to determine source type, confidence, and recommended extraction method
 */
router.post('/classify-source', async (req, res) => {
    try {
        const { url, metadata } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }

        // Classify the source
        const classification = sourceClassifier.classify(url, metadata || {});

        // Get display-friendly format
        const display = sourceClassifier.formatForDisplay(classification);

        // Determine target tables
        const targetTables = sourceClassifier.getTargetTables(classification);

        res.json({
            success: true,
            classification: {
                ...classification,
                display,
                targetTables
            },
            message: `${display.badge} - ${classification.sourceName} (${display.confidence} confidence)`,
            recommendations: {
                extractionMethod: classification.recommendedMethod,
                autoConfirm: classification.shouldAutoConfirm,
                expectedDataTypes: classification.expectedDataTypes
            }
        });

    } catch (error) {
        console.error('Source classification error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// FAMILYSEARCH CATALOG ENDPOINTS
// =============================================================================

/**
 * POST /api/contribute/familysearch-catalog
 * Process a FamilySearch catalog URL and detect/queue multiple film collections
 */
router.post('/familysearch-catalog', async (req, res) => {
    try {
        const { catalogUrl, autoQueue } = req.body;

        if (!catalogUrl) {
            return res.status(400).json({
                success: false,
                error: 'catalogUrl is required'
            });
        }

        // Verify it's a catalog URL
        if (!FamilySearchCatalogProcessor.isCatalogUrl(catalogUrl)) {
            return res.status(400).json({
                success: false,
                error: 'URL does not appear to be a FamilySearch catalog URL',
                hint: 'Expected format: https://www.familysearch.org/search/catalog/XXXXXX'
            });
        }

        // Get database pool from contributionService
        // contributionService.db is the pool passed directly from server.js
        const pool = contributionService?.db;
        if (!pool) {
            return res.status(500).json({
                success: false,
                error: 'Database connection not available'
            });
        }

        const catalogProcessor = new FamilySearchCatalogProcessor({ pool });

        // Extract film information from catalog
        const catalogResult = await catalogProcessor.extractFilms(catalogUrl);

        if (!catalogResult.success) {
            return res.status(400).json({
                success: false,
                error: catalogResult.error
            });
        }

        let queueResult = null;
        if (autoQueue && catalogResult.films.length > 0) {
            // Auto-queue films for processing
            queueResult = await catalogProcessor.queueFilmsForProcessing(catalogResult.films);
        }

        res.json({
            success: true,
            catalog: {
                id: catalogResult.catalogId,
                url: catalogResult.catalogUrl,
                totalFilms: catalogResult.totalFilms
            },
            films: catalogResult.films,
            queueResult: queueResult,
            message: autoQueue
                ? `Found ${catalogResult.totalFilms} films, queued ${queueResult?.queued?.length || 0} for processing`
                : `Found ${catalogResult.totalFilms} films in catalog`
        });

    } catch (error) {
        console.error('FamilySearch catalog error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/contribute/familysearch-catalog/:catalogId/status
 * Get processing status for a FamilySearch catalog
 */
router.get('/familysearch-catalog/:catalogId/status', async (req, res) => {
    try {
        const { catalogId } = req.params;

        // Get database pool
        const pool = contributionService?.db;
        if (!pool) {
            return res.status(500).json({
                success: false,
                error: 'Database connection not available'
            });
        }

        const catalogProcessor = new FamilySearchCatalogProcessor({ pool });
        const status = await catalogProcessor.getCatalogStatus(catalogId);

        res.json({
            success: true,
            status,
            message: `Catalog ${catalogId}: ${status.completed}/${status.total} films completed`
        });

    } catch (error) {
        console.error('Catalog status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/contribute/analyze-source
 * INTELLIGENT SOURCE ANALYSIS - Performs deep analysis of a source URL
 * This is the endpoint that asks the same questions about each source URL
 * that were manually analyzed for sources like the Louisiana Slave Database.
 *
 * Analysis includes:
 * - Source type identification (archive, database, government records, etc.)
 * - Available downloads (ZIP, CSV, PDF, images)
 * - Data fields detected (names, ages, skills, prices, locations, etc.)
 * - Quality assessment (documentation, codebooks, structure)
 * - Processing plan generation
 * - Custom scraper recommendation
 */
router.post('/analyze-source', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }

        if (!sourceAnalyzer) {
            return res.status(500).json({
                success: false,
                error: 'Source analyzer not initialized'
            });
        }

        // Run comprehensive source analysis
        console.log(`\n[ANALYZE-SOURCE] Starting intelligent analysis of: ${url}`);
        const analysis = await sourceAnalyzer.analyzeSource(url);

        // Save analysis to database if available
        await sourceAnalyzer.saveAnalysis(analysis);

        // Generate user-friendly summary
        const summary = generateAnalysisSummary(analysis);

        res.json({
            success: true,
            url,
            analysis: {
                sourceType: analysis.sourceType,
                qualityScore: analysis.qualityIndicators.overallScore,
                downloads: analysis.availableDownloads,
                detectedFields: analysis.detectedFields,
                estimatedRecords: analysis.estimatedRecordCount,
                processingPlan: analysis.processingPlan,
                customScraperNeeded: analysis.customScraperNeeded,
                recommendations: analysis.recommendations
            },
            summary,
            message: summary.headline
        });

    } catch (error) {
        console.error('Source analysis error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Generate a user-friendly summary of the analysis
 */
function generateAnalysisSummary(analysis) {
    const headlines = [];
    const actions = [];

    // Quality-based headlines
    if (analysis.qualityIndicators.overallScore >= 70) {
        headlines.push('HIGH VALUE SOURCE - Contains structured data with documentation');
    } else if (analysis.qualityIndicators.overallScore >= 40) {
        headlines.push('MODERATE VALUE SOURCE - Some structured data found');
    } else {
        headlines.push('BASIC SOURCE - May require manual extraction');
    }

    // Downloads found
    const dataFiles = analysis.availableDownloads.filter(d =>
        ['zip', 'csv', 'xlsx', 'dbf'].includes(d.type)
    );
    if (dataFiles.length > 0) {
        headlines.push(`Found ${dataFiles.length} downloadable data file(s)`);
        actions.push(`Download and process: ${dataFiles.map(d => d.name).join(', ')}`);
    }

    // Fields detected
    const criticalFields = analysis.detectedFields.filter(f => f.importance === 'critical');
    const highFields = analysis.detectedFields.filter(f => f.importance === 'high');
    if (criticalFields.length > 0 || highFields.length > 0) {
        const fieldNames = [...criticalFields, ...highFields].slice(0, 5).map(f => f.field);
        headlines.push(`Detected fields: ${fieldNames.join(', ')}`);
    }

    // Custom scraper needed
    if (analysis.customScraperNeeded) {
        actions.push('Custom scraper recommended for optimal extraction');
    }

    // Processing strategy
    if (analysis.processingPlan) {
        actions.push(`Recommended strategy: ${analysis.processingPlan.strategy}`);
    }

    return {
        headline: headlines[0] || 'Analysis complete',
        details: headlines.slice(1),
        recommendedActions: actions,
        priority: analysis.sourceType?.priority || 'low'
    };
}

/**
 * POST /api/contribute/universal-extract
 * Universal URL extraction using UniversalRouter
 * 
 * This endpoint:
 * 1. Analyzes URL to determine source type and scraper
 * 2. Executes immediately if fast/simple
 * 3. Queues for background processing if complex
 * 4. Returns results or queue ID
 */
router.post('/universal-extract', async (req, res) => {
    try {
        const { url, metadata, options } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }

        // Initialize router
        const router = new UniversalRouter(contributionService.db);

        // Execute extraction
        const result = await router.extract(url, {
            metadata: metadata || {},
            ...options
        });

        // Return appropriate response based on execution strategy
        if (result.immediate) {
            // Immediate execution completed
            res.json({
                success: true,
                immediate: true,
                routing: result.routing,
                extraction: {
                    url: result.result.url,
                    category: result.result.category,
                    ownersFound: result.result.owners.length,
                    enslavedFound: result.result.enslavedPeople.length,
                    relationshipsFound: result.result.relationships.length,
                    duration: result.result.duration,
                    owners: result.result.owners,
                    enslaved: result.result.enslavedPeople,
                    relationships: result.result.relationships,
                    documents: result.result.documents,
                    metadata: result.result.metadata
                },
                message: result.message
            });
        } else {
            // Queued for background processing
            res.json({
                success: true,
                queued: true,
                routing: result.routing,
                queueId: result.queueId,
                queueUrl: result.queueUrl,
                status: result.status,
                estimatedWait: result.estimatedWait,
                message: result.message,
                checkStatusUrl: `/api/contribute/queue/${result.queueId}/status`
            });
        }

    } catch (error) {
        console.error('Universal extract error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/contribute/queue/:queueId/status
 * Check status of queued extraction
 */
router.get('/queue/:queueId/status', async (req, res) => {
    try {
        const { queueId } = req.params;

        const router = new UniversalRouter(contributionService.db);
        const status = await router.getQueueStatus(queueId);

        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'Queue entry not found'
            });
        }

        res.json({
            success: true,
            queue: status
        });

    } catch (error) {
        console.error('Queue status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/contribute/smart-extract
 * Intelligent extraction that auto-detects source type and routes appropriately
 * 
 * @deprecated Use /universal-extract instead (unified interface)
 */
router.post('/smart-extract', async (req, res) => {
    try {
        const { url, metadata } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        // Step 1: Classify the source
        const classification = sourceClassifier.classify(url, metadata || {});
        const display = sourceClassifier.formatForDisplay(classification);

        // Step 2: Check for special handling cases
        let specialHandling = null;

        // FamilySearch catalog - has multiple films
        if (FamilySearchCatalogProcessor.isCatalogUrl(url)) {
            specialHandling = {
                type: 'familysearch_catalog',
                message: 'This is a FamilySearch catalog with multiple film collections',
                nextStep: 'Use /api/contribute/familysearch-catalog to analyze and queue films'
            };
        }
        // FamilySearch film viewer - needs authentication and tile extraction
        else if (FamilySearchCatalogProcessor.isFilmViewerUrl(url)) {
            specialHandling = {
                type: 'familysearch_film',
                message: 'This is a FamilySearch film viewer URL',
                nextStep: 'Start a contribution session to process with OCR'
            };
        }
        // MSA PDF archives
        else if (url.includes('msa.maryland.gov') && url.includes('.pdf')) {
            specialHandling = {
                type: 'msa_pdf',
                message: 'This is a Maryland State Archives PDF document',
                nextStep: 'Start a contribution session for PDF OCR extraction'
            };
        }

        res.json({
            success: true,
            url,
            classification: {
                sourceType: classification.sourceType,
                sourceName: classification.sourceName,
                confidence: classification.confidence,
                isPrimarySource: classification.isPrimarySource,
                shouldAutoConfirm: classification.shouldAutoConfirm,
                badge: display.badge
            },
            recommendedMethod: classification.recommendedMethod,
            expectedDataTypes: classification.expectedDataTypes,
            specialHandling,
            message: specialHandling
                ? specialHandling.message
                : `${display.badge} source detected - use recommended extraction method: ${classification.recommendedMethod}`
        });

    } catch (error) {
        console.error('Smart extract error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = {
    router,
    initializeService
};
