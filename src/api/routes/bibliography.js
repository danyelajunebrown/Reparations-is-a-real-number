/**
 * Bibliography API Routes
 *
 * Manages intellectual property citations, sources, and contributor records.
 *
 * Endpoints:
 * - GET    /api/bibliography                 - Get all bibliography entries
 * - GET    /api/bibliography/stats           - Get bibliography statistics
 * - GET    /api/bibliography/:id             - Get single entry
 * - POST   /api/bibliography                 - Add new entry
 * - POST   /api/bibliography/pending         - Flag a pending citation
 * - GET    /api/bibliography/pending         - Get all pending citations
 * - PUT    /api/bibliography/pending/:id     - Resolve pending citation
 * - POST   /api/bibliography/participants    - Add participant
 * - GET    /api/bibliography/participants    - Get all participants
 * - POST   /api/bibliography/analyze         - Analyze text for copy/paste
 * - GET    /api/bibliography/export          - Export bibliography
 * - POST   /api/bibliography/from-url        - Generate citation from URL
 */

const express = require('express');
const router = express.Router();
const BibliographyManager = require('../../utils/bibliography-manager');

// Initialize bibliography manager (will use pool if available)
let bibliographyManager = null;

// Middleware to ensure manager is initialized
const ensureManager = (req, res, next) => {
    if (!bibliographyManager) {
        // Try to get pool from app
        const pool = req.app.get('pool');
        bibliographyManager = new BibliographyManager(pool);
    }
    req.bibliographyManager = bibliographyManager;
    next();
};

router.use(ensureManager);

/**
 * GET /api/bibliography
 * Get all bibliography entries with optional filtering
 */
router.get('/', async (req, res) => {
    try {
        const { sourceType, category, search } = req.query;

        const entries = await req.bibliographyManager.getAllEntries({
            sourceType,
            category,
            search
        });

        const pending = await req.bibliographyManager.getPendingCitations();
        const participants = await req.bibliographyManager.getParticipants();

        res.json({
            success: true,
            entries,
            pending,
            participants,
            count: {
                entries: entries.length,
                pending: pending.length,
                participants: participants.length
            }
        });
    } catch (error) {
        console.error('Error fetching bibliography:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/bibliography/stats
 * Get bibliography statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await req.bibliographyManager.getStatistics();

        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/bibliography/export
 * Export full bibliography in various formats
 */
router.get('/export', async (req, res) => {
    try {
        const format = req.query.format || 'json';
        const validFormats = ['json', 'bibtex', 'apa', 'chicago'];

        if (!validFormats.includes(format)) {
            return res.status(400).json({
                success: false,
                error: `Invalid format. Valid formats: ${validFormats.join(', ')}`
            });
        }

        const exported = await req.bibliographyManager.exportBibliography(format);

        if (format === 'json') {
            res.json({
                success: true,
                data: exported
            });
        } else {
            res.set('Content-Type', 'text/plain');
            res.set('Content-Disposition', `attachment; filename="bibliography.${format === 'bibtex' ? 'bib' : 'txt'}"`);
            res.send(exported);
        }
    } catch (error) {
        console.error('Error exporting bibliography:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/bibliography/pending
 * Get all pending citations
 */
router.get('/pending', async (req, res) => {
    try {
        const pending = await req.bibliographyManager.getPendingCitations();

        res.json({
            success: true,
            pending,
            count: pending.length
        });
    } catch (error) {
        console.error('Error fetching pending citations:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/bibliography/pending
 * Flag a new pending citation
 */
router.post('/pending', async (req, res) => {
    try {
        const { title, type, url, context, usedIn, flaggedBy } = req.body;

        if (!title && !url) {
            return res.status(400).json({
                success: false,
                error: 'Either title or URL is required'
            });
        }

        const pending = await req.bibliographyManager.flagPendingCitation({
            title: title || 'Untitled Source',
            type: type || 'unknown',
            url,
            context,
            usedIn,
            flaggedBy
        });

        res.json({
            success: true,
            pending,
            message: 'Citation flagged for follow-up'
        });
    } catch (error) {
        console.error('Error flagging pending citation:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/bibliography/pending/:id
 * Resolve a pending citation by linking to full entry
 */
router.put('/pending/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { citationId } = req.body;

        if (!citationId) {
            return res.status(400).json({
                success: false,
                error: 'citationId is required to resolve pending citation'
            });
        }

        await req.bibliographyManager.resolvePendingCitation(id, citationId);

        res.json({
            success: true,
            message: 'Pending citation resolved'
        });
    } catch (error) {
        console.error('Error resolving pending citation:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/bibliography/participants
 * Get all participants
 */
router.get('/participants', async (req, res) => {
    try {
        const participants = await req.bibliographyManager.getParticipants();

        res.json({
            success: true,
            participants,
            count: participants.length
        });
    } catch (error) {
        console.error('Error fetching participants:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/bibliography/participants
 * Add a new participant
 */
router.post('/participants', async (req, res) => {
    try {
        const { name, role, affiliation, contribution, contributions } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Participant name is required'
            });
        }

        const participant = await req.bibliographyManager.addParticipant({
            name,
            role,
            affiliation,
            contribution,
            contributions
        });

        res.json({
            success: true,
            participant,
            message: 'Participant added to bibliography'
        });
    } catch (error) {
        console.error('Error adding participant:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/bibliography
 * Add a new bibliography entry
 */
router.post('/', async (req, res) => {
    try {
        const {
            title, sourceType, category, author, url,
            archiveName, collectionName, collectionId, location,
            publicationDate, description, notes, usedIn, addedBy
        } = req.body;

        if (!title) {
            return res.status(400).json({
                success: false,
                error: 'Title is required'
            });
        }

        const entry = await req.bibliographyManager.addEntry({
            title,
            sourceType: sourceType || 'secondary',
            category: category || 'general',
            author,
            url,
            archiveName,
            collectionName,
            collectionId,
            location,
            publicationDate,
            description,
            notes,
            usedIn,
            addedBy
        });

        res.json({
            success: true,
            entry,
            message: 'Bibliography entry added'
        });
    } catch (error) {
        console.error('Error adding bibliography entry:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/bibliography/analyze
 * Analyze text for potential copy/paste content needing citation
 */
router.post('/analyze', async (req, res) => {
    try {
        const { text, context } = req.body;

        if (!text) {
            return res.status(400).json({
                success: false,
                error: 'Text content is required for analysis'
            });
        }

        const analysis = req.bibliographyManager.analyzeForCopyPaste(text, context);

        // If flags found, optionally auto-flag them as pending
        if (analysis.hasFlags && req.body.autoFlag) {
            for (const flag of analysis.flags) {
                if (flag.match.startsWith('http')) {
                    await req.bibliographyManager.flagPendingCitation({
                        title: flag.knownArchive || 'URL Reference',
                        type: 'copy-paste',
                        url: flag.match,
                        context: context?.location || 'Auto-detected',
                        detectedPatterns: [flag.pattern]
                    });
                }
            }
        }

        res.json({
            success: true,
            analysis,
            message: analysis.hasFlags
                ? `Found ${analysis.flagCount} potential citations needed`
                : 'No obvious citation needs detected'
        });
    } catch (error) {
        console.error('Error analyzing text:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/bibliography/from-url
 * Generate citation suggestions from a URL
 */
router.post('/from-url', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        const citation = await req.bibliographyManager.generateCitationFromUrl(url);

        res.json({
            success: true,
            citation,
            message: citation.archiveName
                ? `Recognized as ${citation.archiveName}`
                : 'Unknown source - additional details needed'
        });
    } catch (error) {
        console.error('Error generating citation from URL:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/bibliography/:id
 * Get single bibliography entry
 */
router.get('/:id', async (req, res) => {
    try {
        const entries = await req.bibliographyManager.getAllEntries();
        const entry = entries.find(e => e.id === req.params.id);

        if (!entry) {
            return res.status(404).json({
                success: false,
                error: 'Bibliography entry not found'
            });
        }

        res.json({
            success: true,
            entry
        });
    } catch (error) {
        console.error('Error fetching bibliography entry:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
