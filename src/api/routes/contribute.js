/**
 * Contribute API Routes - Conversational Contribution Pipeline
 *
 * These endpoints support the human-guided contribution flow where
 * the system asks questions and the human provides context that
 * machines can't divine on their own.
 */

const express = require('express');
const router = express.Router();
const ContributionSession = require('../../services/contribution/ContributionSession');
const OwnerPromotion = require('../../services/contribution/OwnerPromotion');

// Will be initialized with database connection
let contributionService = null;
let promotionService = null;

/**
 * Initialize the contribution service with database
 */
function initializeService(database) {
    contributionService = new ContributionSession(database);
    promotionService = new OwnerPromotion(database);
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

        const validMethods = ['auto_ocr', 'guided_entry', 'sample_learn', 'csv_upload'];
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
 * Get extraction job status
 */
router.get('/:sessionId/extraction/:extractionId/status', async (req, res) => {
    try {
        const { sessionId, extractionId } = req.params;

        // Query extraction job status
        const result = await contributionService.db.query(`
            SELECT
                extraction_id,
                method,
                status,
                progress,
                row_count,
                avg_confidence,
                human_corrections,
                illegible_count,
                error_message,
                started_at,
                completed_at
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

        res.json({
            success: true,
            extraction: {
                id: job.extraction_id,
                method: job.method,
                status: job.status,
                progress: job.progress,
                rowCount: job.row_count,
                avgConfidence: job.avg_confidence,
                humanCorrections: job.human_corrections,
                illegibleCount: job.illegible_count,
                error: job.error_message,
                startedAt: job.started_at,
                completedAt: job.completed_at
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

// =============================================================================
// OWNER PROMOTION ENDPOINTS
// =============================================================================

/**
 * POST /api/contribute/:sessionId/extraction/:extractionId/promote
 * Promote qualifying owners from a federal document extraction to the individuals table
 */
router.post('/:sessionId/extraction/:extractionId/promote', async (req, res) => {
    try {
        const { sessionId, extractionId } = req.params;

        // Get session to retrieve source metadata
        const session = await contributionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Check if this is a federal source
        const sourceMetadata = session.sourceMetadata;

        if (!promotionService.isFederalSource(sourceMetadata?.url, sourceMetadata?.documentType)) {
            return res.status(400).json({
                success: false,
                error: 'Only federal/government documents qualify for auto-promotion',
                hint: 'This source does not appear to be a federal document (census, petition, court record, etc.)'
            });
        }

        // Run promotion
        const result = await promotionService.promoteFromExtraction(extractionId, sourceMetadata);

        res.json({
            success: true,
            message: `Promoted ${result.promoted} slave owners to the confirmed database`,
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

module.exports = {
    router,
    initializeService
};
