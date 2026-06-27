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

// Use centralized database connection (Neon serverless HTTP)
const { query: dbQuery, pool: sharedPool } = require('../../database/connection');

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

// Simple in-memory cache for stats (5 minute TTL)
let statsCache = {
    data: null,
    timestamp: 0,
    ttl: 5 * 60 * 1000 // 5 minutes
};

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

        // ── Person-ID search ────────────────────────────────────────────────
        // Name search can't disambiguate the many same-named owners (e.g. dozens
        // of "David Smith"s), so a bare number — optionally written `#1170` or
        // `id:1170` — is treated as an exact person-ID lookup across the three
        // person tables. Runs before the length guard so even short ids work.
        const idMatch = query.trim().match(/^(?:id:|#)?\s*(\d+)$/i);
        if (idMatch) {
            const pid = idMatch[1];
            const idResult = await sharedPool.query(`
                SELECT id::text AS id, canonical_name AS name, person_type AS type,
                       NULL AS source_url, 'canonical' AS source_type,
                       COALESCE(confidence_score, 1.0) AS confidence_score,
                       CONCAT_WS(', ', primary_county, primary_state) AS locations,
                       notes AS context_text, created_at, 'canonical_persons' AS table_source
                FROM canonical_persons WHERE id = $1::int
                UNION ALL
                SELECT lead_id::text, full_name, person_type, source_url, source_type,
                       confidence_score, array_to_string(locations, ', '), context_text,
                       scraped_at, 'unconfirmed_persons'
                FROM unconfirmed_persons
                WHERE lead_id::text = $2 AND (status IS NULL OR status != 'duplicate')
                UNION ALL
                SELECT enslaved_id::text, full_name, 'enslaved', NULL, 'confirmed', 1.0,
                       NULL::text, notes, created_at, 'enslaved_individuals'
                FROM enslaved_individuals WHERE enslaved_id::text = $2
            `, [pid, pid]);
            return res.json({
                success: true,
                query,
                searchTerms: pid,
                filteredWords: [],
                hasTextSearch: false,
                idSearch: true,
                detectedType: null,
                count: idResult.rows.length,
                results: idResult.rows,
                bySource: {},
                sources: []
            });
        }

        if (!query || query.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Query must be at least 2 characters'
            });
        }

        // Use shared connection pool for better performance
        const pool = sharedPool;

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

        // Build query to search unconfirmed_persons, enslaved_individuals, AND canonical_persons
        // Exclude records marked as 'duplicate' (already merged into canonical_persons)
        let unconfirmedWhere = `${whereClause} AND (status IS NULL OR status != 'duplicate')`;
        let enslavedWhere = whereClause;
        // For canonical_persons, we search canonical_name instead of full_name.
        // Fix 3: Exclude climb-sourced descendant rows from public search results.
        // person_type 'descendant'/'modern_person' are populated by ancestor_climb_sessions
        // and must NEVER appear in public slavery records search.
        const EXCLUDED_SEARCH_TYPES = `('descendant', 'modern_person', 'participant', 'merged')`;
        let canonicalWhere = hasTextSearch
            ? `(${words.map((_, i) => `canonical_name ILIKE $${i + 1}`).join(' AND ')}) AND person_type NOT IN ${EXCLUDED_SEARCH_TYPES}`
            : `person_type NOT IN ${EXCLUDED_SEARCH_TYPES}`;

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

        // Combined query: unconfirmed_persons UNION enslaved_individuals UNION canonical_persons
        let sql = `
            SELECT * FROM (
                SELECT
                    lead_id::text as id,
                    full_name as name,
                    person_type as type,
                    source_url,
                    source_type,
                    confidence_score,
                    array_to_string(locations, ', ') as locations,
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
                    NULL::text as locations,
                    notes as context_text,
                    created_at,
                    'enslaved_individuals' as table_source
                FROM enslaved_individuals
                WHERE ${enslavedWhere}

                UNION ALL

                SELECT
                    id::text as id,
                    canonical_name as name,
                    person_type as type,
                    NULL as source_url,
                    'canonical' as source_type,
                    COALESCE(confidence_score, 1.0) as confidence_score,
                    CONCAT_WS(', ', primary_county, primary_state) as locations,
                    notes as context_text,
                    created_at,
                    'canonical_persons' as table_source
                FROM canonical_persons
                WHERE ${canonicalWhere}
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

        // Note: Don't end shared pool - it's reused across requests

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
 * GET /api/contribute/extraction-progress
 * Get current and recent extraction job progress
 */
router.get('/extraction-progress', async (req, res) => {
    try {
        const pool = sharedPool;

        // Get current/recent extraction jobs
        const jobs = await pool.query(`
            SELECT
                id,
                job_name,
                year,
                collection_id,
                status,
                locations_total,
                locations_processed,
                images_processed,
                owners_extracted,
                enslaved_extracted,
                errors,
                current_state,
                current_county,
                current_district,
                started_at,
                updated_at,
                completed_at,
                error_message,
                CASE
                    WHEN locations_total > 0 THEN
                        ROUND((locations_processed::numeric / locations_total) * 100, 1)
                    ELSE 0
                END as percent_complete,
                CASE
                    WHEN status = 'running' AND updated_at < NOW() - INTERVAL '5 minutes' THEN 'stalled'
                    ELSE status
                END as actual_status,
                EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) as elapsed_seconds
            FROM extraction_progress
            ORDER BY started_at DESC
            LIMIT 10
        `);

        // Calculate estimated time remaining for running jobs
        const enrichedJobs = jobs.rows.map(job => {
            let eta = null;
            if (job.status === 'running' && job.locations_processed > 0) {
                const rate = job.locations_processed / job.elapsed_seconds; // locations per second
                const remaining = job.locations_total - job.locations_processed;
                if (rate > 0) {
                    eta = Math.round(remaining / rate); // seconds remaining
                }
            }

            return {
                ...job,
                eta_seconds: eta,
                eta_formatted: eta ? formatDuration(eta) : null
            };
        });

        // Get the current running job (if any)
        const currentJob = enrichedJobs.find(j => j.status === 'running' || j.actual_status === 'stalled');

        res.json({
            success: true,
            current: currentJob || null,
            recent: enrichedJobs,
            hasRunningJob: !!currentJob
        });
    } catch (error) {
        console.error('Extraction progress error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper function to format duration
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
}

/**
 * GET /api/contribute/stats
 * Get statistics about the database records (with 5-minute cache)
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

        const now = Date.now();
        const isCacheValid = statsCache.data && (now - statsCache.timestamp) < statsCache.ttl;

        // Return cached data if valid
        if (isCacheValid) {
            return res.json({
                success: true,
                stats: statsCache.data,
                cached: true,
                cacheAge: Math.floor((now - statsCache.timestamp) / 1000) // seconds
            });
        }

        // Cache miss - query database.
        // Apr 13, 2026: stats query now counts BOTH unconfirmed_persons AND
        // canonical_persons + enslaved_individuals. Previously it only counted
        // unconfirmed_persons, which under-reported slaveholders by ~99% after
        // the Apr 5 promotion moved 123K+ enslavers into canonical_persons.
        // See activeContext.md for full context.
        const stats = await pool.query(`
            WITH up AS (
                SELECT
                    COUNT(*) AS total_records,
                    COUNT(DISTINCT source_url) AS unique_sources,
                    COUNT(*) FILTER (WHERE person_type IN ('owner', 'slaveholder', 'confirmed_owner')) AS unconfirmed_slaveholders,
                    COUNT(*) FILTER (WHERE person_type IN ('enslaved', 'confirmed_enslaved')) AS unconfirmed_enslaved,
                    COUNT(*) FILTER (WHERE source_url LIKE '%msa.maryland.gov%') AS msa_records,
                    COUNT(*) FILTER (WHERE source_url LIKE '%familysearch%') AS familysearch_records,
                    COUNT(*) FILTER (WHERE source_url LIKE '%civilwardc%') AS civilwardc_records
                FROM unconfirmed_persons
            ),
            cp AS (
                SELECT
                    COUNT(*) FILTER (WHERE person_type IN ('enslaver', 'slaveholder', 'owner', 'free_poc_slaveholder')) AS canonical_slaveholders,
                    COUNT(*) FILTER (WHERE person_type IN ('enslaved', 'enslaved_ancestor', 'freedperson')) AS canonical_enslaved
                FROM canonical_persons
            ),
            ei AS (
                SELECT COUNT(*) AS confirmed_enslaved FROM enslaved_individuals
            )
            SELECT
                (up.total_records + cp.canonical_slaveholders + cp.canonical_enslaved + ei.confirmed_enslaved) AS total_records,
                up.unique_sources,
                (up.unconfirmed_slaveholders + cp.canonical_slaveholders) AS slaveholders,
                (up.unconfirmed_enslaved + cp.canonical_enslaved + ei.confirmed_enslaved) AS enslaved,
                up.msa_records,
                up.familysearch_records,
                up.civilwardc_records
            FROM up, cp, ei
        `);

        // Update cache
        statsCache.data = stats.rows[0];
        statsCache.timestamp = now;

        res.json({
            success: true,
            stats: statsCache.data,
            cached: false
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
 * GET /api/contribute/browse
 * Browse all persons in the database with filtering and pagination
 * This endpoint powers the new People Tab in the UI
 */
router.get('/browse', async (req, res) => {
    try {
        const { limit = 100, offset = 0, type, source, minConfidence = 0 } = req.query;

        // Use shared connection pool. Previously this endpoint instantiated a
        // new Pool per request and ended it, which exhausted Neon connections
        // under load (FRONTEND-ENHANCEMENT-PLAN.md flagged this). Fixed Apr 13.
        const pool = sharedPool;

        // Build dynamic query
        // Exclude needs_review and rejected records (ML misclassification cleanup)
        let query = `
            SELECT
                lead_id as id,
                full_name as name,
                person_type as type,
                source_url,
                source_type,
                confidence_score,
                extraction_method as source,
                array_to_string(locations, ', ') as locations,
                context_text,
                scraped_at as created_at
            FROM unconfirmed_persons
            WHERE confidence_score >= $1
              AND (status IS NULL OR status NOT IN ('needs_review', 'rejected'))
        `;

        const params = [parseFloat(minConfidence) || 0];
        let paramIndex = 2;

        // Filter by person type
        if (type) {
            if (type === 'enslaved') {
                query += ` AND person_type IN ('enslaved', 'suspected_enslaved', 'confirmed_enslaved')`;
            } else if (type === 'owner') {
                query += ` AND person_type IN ('owner', 'slaveholder', 'suspected_owner', 'confirmed_owner')`;
            } else {
                query += ` AND person_type = $${paramIndex}`;
                params.push(type);
                paramIndex++;
            }
        }

        // Filter by source
        if (source) {
            if (source === 'familysearch') {
                query += ` AND source_url ILIKE '%familysearch%'`;
            } else if (source === 'msa') {
                query += ` AND source_url ILIKE '%msa.maryland.gov%'`;
            } else if (source === 'beyond_kin') {
                query += ` AND extraction_method ILIKE '%beyond%kin%'`;
            } else {
                query += ` AND (source_url ILIKE $${paramIndex} OR extraction_method ILIKE $${paramIndex})`;
                params.push(`%${source}%`);
                paramIndex++;
            }
        }

        // Add ordering and pagination
        query += ` ORDER BY confidence_score DESC NULLS LAST, scraped_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        // Get total count for pagination (also exclude needs_review/rejected)
        let countQuery = `SELECT COUNT(*) FROM unconfirmed_persons WHERE confidence_score >= $1 AND (status IS NULL OR status NOT IN ('needs_review', 'rejected'))`;
        const countParams = [parseFloat(minConfidence) || 0];

        if (type) {
            if (type === 'enslaved') {
                countQuery += ` AND person_type IN ('enslaved', 'suspected_enslaved', 'confirmed_enslaved')`;
            } else if (type === 'owner') {
                countQuery += ` AND person_type IN ('owner', 'slaveholder', 'suspected_owner', 'confirmed_owner')`;
            }
        }
        if (source) {
            if (source === 'familysearch') {
                countQuery += ` AND source_url ILIKE '%familysearch%'`;
            } else if (source === 'msa') {
                countQuery += ` AND source_url ILIKE '%msa.maryland.gov%'`;
            } else if (source === 'beyond_kin') {
                countQuery += ` AND extraction_method ILIKE '%beyond%kin%'`;
            }
        }

        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        // Note: don't end the shared pool — it's reused across requests.

        // Extract archive URL from context_text
        const extractArchiveUrl = (contextText) => {
            if (!contextText) return null;
            const s3Match = contextText.match(/https:\/\/[^"'\s]+\.s3[^"'\s]*\.amazonaws\.com[^"'\s]*/);
            if (s3Match) return s3Match[0];
            return null;
        };

        const people = result.rows.map(row => ({
            ...row,
            archive_url: extractArchiveUrl(row.context_text)
        }));

        res.json({
            success: true,
            count: people.length,
            total,
            offset: parseInt(offset),
            limit: parseInt(limit),
            hasMore: (parseInt(offset) + people.length) < total,
            people
        });

    } catch (error) {
        console.error('Browse error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/contribute/review-queue
 * Get all pending items in the name match queue for human review
 * NOTE: This route MUST be before /person/:id to avoid route conflict
 */
router.get('/review-queue', async (req, res) => {
    try {
        const { Pool } = require('pg');
        const pool = sharedPool;

        const result = await pool.query(`
            SELECT
                id,
                unconfirmed_name,
                queue_status,
                priority,
                source_url,
                source_context,
                location_context,
                created_at
            FROM name_match_queue
            WHERE queue_status = 'pending_review'
            ORDER BY priority DESC, created_at ASC
        `);
        res.json({
            success: true,
            count: result.rows.length,
            items: result.rows.map(row => ({
                ...row,
                source_context: row.source_context ? JSON.parse(row.source_context) : null
            }))
        });

    } catch (error) {
        console.error('Review queue error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contribute/person/:id
 * Get full person profile with reparations calculation
 * Works for both unconfirmed_persons (lead_id) and enslaved_individuals (enslaved_id)
 */
router.get('/person/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { table } = req.query; // 'unconfirmed_persons' or 'enslaved_individuals'

        // Use shared Neon serverless connection (HTTP)
        const pool = sharedPool;

        let person = null;
        let tableSource = table || 'unknown';

        // Try enslaved_individuals first if ID looks like enslaved_id format
        if (!table || table === 'enslaved_individuals' || id.startsWith('enslaved_')) {
            const enslavedResult = await pool.query(`
                SELECT
                    enslaved_id as id,
                    full_name,
                    given_name,
                    middle_name,
                    surname,
                    birth_year,
                    death_year,
                    gender,
                    occupation,
                    skill_level,
                    racial_designation,
                    enslaved_status,
                    freedom_year,
                    enslaved_by_individual_id,
                    spouse_name,
                    spouse_ids,
                    parent_ids,
                    child_ids,
                    child_names,
                    alternative_names,
                    direct_reparations,
                    inherited_reparations,
                    total_reparations_owed,
                    amount_paid,
                    amount_outstanding,
                    verified,
                    notes,
                    created_at,
                    'enslaved_individuals' as table_source
                FROM enslaved_individuals
                WHERE enslaved_id = $1
            `, [id]);

            if (enslavedResult.rows.length > 0) {
                person = enslavedResult.rows[0];
                tableSource = 'enslaved_individuals';
            }
        }

        // Try unconfirmed_persons if not found or explicitly requested
        if (!person && (!table || table === 'unconfirmed_persons')) {
            const unconfirmedResult = await pool.query(`
                SELECT
                    lead_id::text as id,
                    full_name,
                    person_type,
                    birth_year,
                    death_year,
                    gender,
                    locations,
                    source_url,
                    source_type,
                    context_text,
                    confidence_score,
                    relationships,
                    extraction_method,
                    scraped_at as created_at,
                    'unconfirmed_persons' as table_source
                FROM unconfirmed_persons
                WHERE lead_id = $1
            `, [id]);

            if (unconfirmedResult.rows.length > 0) {
                person = unconfirmedResult.rows[0];
                tableSource = 'unconfirmed_persons';
            }
        }

        // Try canonical_persons for slaveholders/owners
        if (!person && (!table || table === 'canonical_persons')) {
            const canonicalResult = await pool.query(`
                SELECT
                    id::text as id,
                    canonical_name as full_name,
                    first_name,
                    last_name,
                    birth_year_estimate as birth_year,
                    death_year_estimate as death_year,
                    sex as gender,
                    person_type,
                    primary_state,
                    primary_county,
                    primary_plantation,
                    notes,
                    confidence_score,
                    verification_status,
                    created_at,
                    'canonical_persons' as table_source
                FROM canonical_persons
                WHERE id::text = $1 OR canonical_name ILIKE $2
            `, [id, `%${id}%`]);

            if (canonicalResult.rows.length > 0) {
                person = canonicalResult.rows[0];
                tableSource = 'canonical_persons';
            }
        }

        // Try documents table for slaveholder documents
        if (!person && (!table || table === 'documents')) {
            const docResult = await pool.query(`
                SELECT
                    document_id as id,
                    owner_name as full_name,
                    owner_birth_year as birth_year,
                    owner_death_year as death_year,
                    owner_location,
                    doc_type,
                    s3_key,
                    filename,
                    total_enslaved,
                    total_reparations,
                    verification_status,
                    created_at,
                    'documents' as table_source
                FROM documents
                WHERE document_id = $1 OR owner_name ILIKE $2
            `, [id, `%${id}%`]);

            if (docResult.rows.length > 0) {
                person = docResult.rows[0];
                person.person_type = 'slaveholder';
                tableSource = 'documents';
            }
        }

        if (!person) {
            // Note: Don't call pool.end() - using shared connection
            return res.status(404).json({
                success: false,
                error: 'Person not found'
            });
        }

        // Calculate reparations for BOTH tables
        let reparations = {
            wageTheft: 0,
            damages: 0,
            interest: 0,
            total: 0,
            breakdown: []
        };

        // Extract ALL available information
        let owner = null;
        let ownerName = null;
        let dataAvailability = {
            hasOwnerData: false,
            hasStructuredOwner: false,
            hasBirthYear: !!person.birth_year,
            hasDeathYear: !!person.death_year,
            hasGender: !!person.gender,
            hasLocation: !!person.locations,
            hasContextText: !!person.context_text,
            hasSourceUrl: !!person.source_url
        };
        
        if (tableSource === 'enslaved_individuals' && person.enslaved_by_individual_id) {
            // Get owner from canonical_persons table — include full location fields
            const ownerResult = await pool.query(`
                SELECT id, canonical_name as full_name, person_type,
                       primary_county, primary_state, primary_plantation,
                       CONCAT_WS(', ', primary_plantation, primary_county, primary_state) AS location,
                       notes
                FROM canonical_persons
                WHERE id::text = $1
            `, [person.enslaved_by_individual_id]);
            if (ownerResult.rows.length > 0) {
                owner = ownerResult.rows[0];
                ownerName = owner.full_name;
                dataAvailability.hasOwnerData = true;
                dataAvailability.hasStructuredOwner = true;

                // Check for DC Compensated Emancipation petition tied to this owner
                // Exposes compensation_paid and petition_date on the enslaved person's modal
                try {
                    const petitionResult = await pool.query(`
                        SELECT docket_number, filed_date AS petition_date,
                               total_approved_usd AS total_compensation_paid,
                               source_citation AS petition_reference,
                               source_archive,
                               enslaved_persons_claimed AS enslaved_names,
                               source_document_url, claimant_name,
                               petition_type, filed_year
                        FROM historical_reparations_petitions
                        WHERE claimant_canonical_id = $1::integer
                        LIMIT 1
                    `, [person.enslaved_by_individual_id]);
                    if (petitionResult.rows.length > 0) {
                        owner.petition = petitionResult.rows[0];
                        dataAvailability.hasPetitionRecord = true;
                    }
                } catch (e) {
                    // Table may not have petitioner_canonical_id column yet — non-fatal
                    console.log('petition lookup (non-fatal):', e.message?.substring(0, 80));
                }

                // Check person_relationships_verified for inheritance chain
                // (e.g. enslaved person inherited from Hopewell will → Ann Maria Biscoe)
                try {
                    const inheritanceResult = await pool.query(`
                        SELECT prv.relationship_type,
                               prv.conflict_notes AS evidence_text,
                               NULL::date AS document_date,
                               cp.canonical_name AS from_person_name,
                               cp.id AS from_person_id
                        FROM person_relationships_verified prv
                        JOIN canonical_persons cp ON cp.id = prv.person_id
                        WHERE prv.related_person_id = $1::integer
                          AND prv.relationship_type IN ('inherited', 'bequeathed', 'transferred')
                        LIMIT 3
                    `, [person.enslaved_by_individual_id]);
                    if (inheritanceResult.rows.length > 0) {
                        owner.inheritance_chain = inheritanceResult.rows;
                        dataAvailability.hasInheritanceChain = true;
                    }
                } catch (e) {
                    console.log('inheritance chain (non-fatal):', e.message?.substring(0, 80));
                }
            }
        } else if (tableSource === 'unconfirmed_persons') {
            // First check relationships JSON (used by census OCR extraction)
            if (person.relationships && typeof person.relationships === 'object') {
                // DocAI-enriched Freedmen's Bank records store extracted fields in docai_fields.
                // The enrichment script pushes a JSONB element into the array:
                //   relationships = [{ "docai_fields": { last_master: ..., ... } }, ...]
                // OR directly sets relationships.docai_fields (object format).
                const docaiFields = Array.isArray(person.relationships)
                    ? person.relationships.find(r => r && r.docai_fields)?.docai_fields
                    : person.relationships?.docai_fields;

                // Expose docai_fields directly on person for the frontend
                if (docaiFields) {
                    person.docai_fields = docaiFields;
                }

                // Support census OCR 'owner' key AND Freedmen's Bank 'last_master'/'last_mistress' keys.
                // Check both flat relationships AND nested docai_fields (DocAI-enriched records).
                const rawOwner = person.relationships.owner
                    || person.relationships.last_master
                    || person.relationships.last_mistress
                    || docaiFields?.last_master
                    || docaiFields?.last_mistress;
                if (rawOwner) {
                    ownerName = rawOwner;
                    owner = {
                        full_name: ownerName,
                        // Freedmen's Bank: master_location or county/state
                        location: person.relationships.master_location
                            || docaiFields?.master_location
                            || (person.relationships.county && person.relationships.state
                                ? `${person.relationships.county}, ${person.relationships.state}`
                                : null),
                        year: person.relationships.year || docaiFields?.date_of_entry,
                        // Freedmen's Bank-specific enrichment
                        branch: person.relationships.branch || null,
                        account_number: person.relationships.account_number || null,
                        plantation: person.relationships.slave_residence
                            || docaiFields?.slave_residence || null,
                    };
                    dataAvailability.hasOwnerData = true;
                    dataAvailability.hasStructuredOwner = true;
                }
                // Freedmen's Bank: infer location from branch city if not set
                if (!person.location && person.relationships.branch) {
                    person.location = person.relationships.branch;
                    person.location_source = 'freedmens_bank_branch';
                }
            }

            // Fallback to context_text patterns if no owner found
            if (!owner && person.context_text) {
                const ownerPatterns = [
                    /Owner:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i,
                    /Slaveholder:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i,
                    /Enslaved by:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i,
                    /held by:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i,
                    /Property of:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i,
                    /Owned by:\s*([A-Za-z\s\.]+?)(?:\s*\||$)/i
                ];

                for (const pattern of ownerPatterns) {
                    const match = person.context_text.match(pattern);
                    if (match && match[1]) {
                        ownerName = match[1].trim();
                        owner = { full_name: ownerName };
                        dataAvailability.hasOwnerData = true;
                        dataAvailability.hasStructuredOwner = true;
                        break;
                    }
                }
            }
        }

        // Calculate approximate birth year from age if not already set
        if (!person.birth_year && person.relationships && person.relationships.age && person.relationships.year) {
            const age = parseInt(person.relationships.age);
            const documentYear = parseInt(person.relationships.year);
            if (!isNaN(age) && !isNaN(documentYear)) {
                person.birth_year = documentYear - age;
                person.birth_year_source = 'calculated_from_document_age';
            }
        }

        // Extract color/racial designation if available
        if (!person.racial_designation && person.relationships && person.relationships.color) {
            person.racial_designation = person.relationships.color;
        }

        // Extract characteristics/injuries from relationships
        if (!person.characteristics && person.relationships && person.relationships.characteristics) {
            person.characteristics = person.relationships.characteristics;
        }

        // Calculate years enslaved
        let yearsEnslaved = 30; // Default
        let startYear = person.birth_year ? person.birth_year + 10 : null; // Assume started at 10
        let endYear = 1865; // Default emancipation

        if (person.freedom_year) {
            endYear = person.freedom_year;
        } else if (person.death_year) {
            endYear = Math.min(person.death_year, 1865);
        }

        if (startYear && endYear) {
            yearsEnslaved = Math.max(0, endYear - startYear);
        } else if (person.birth_year) {
            // Estimate from birth year to 1865
            yearsEnslaved = Math.max(0, Math.min(1865, person.death_year || 1865) - person.birth_year - 10);
        }

        // Always calculate reparations for enslaved people
        if (person.person_type && (person.person_type.includes('enslaved') || tableSource === 'enslaved_individuals')) {
            const yearsSinceEmancipation = 2025 - endYear;
            const annualWage = 15000; // Conservative modern equivalent

            reparations.wageTheft = Math.max(0, yearsEnslaved) * annualWage;
            reparations.damages = 100000; // Base human dignity damages
            reparations.interest = (reparations.wageTheft + reparations.damages) *
                (Math.pow(1.02, yearsSinceEmancipation) - 1); // 2% compound
            
            reparations.total = tableSource === 'enslaved_individuals' && person.total_reparations_owed
                ? parseFloat(person.total_reparations_owed)
                : (reparations.wageTheft + reparations.damages + reparations.interest);

            reparations.breakdown = [
                { 
                    label: 'Wage Theft', 
                    amount: reparations.wageTheft,
                    description: `${Math.max(0, yearsEnslaved)} years × $${annualWage.toLocaleString()}/year` 
                },
                { 
                    label: 'Human Dignity Damages', 
                    amount: reparations.damages,
                    description: 'Base compensation for enslavement' 
                },
                { 
                    label: 'Compound Interest', 
                    amount: reparations.interest,
                    description: `${yearsSinceEmancipation} years @ 2% annual` 
                }
            ];

            reparations.amountPaid = parseFloat(person.amount_paid) || 0;
            reparations.amountOutstanding = reparations.total - reparations.amountPaid;
            reparations.yearsEnslaved = yearsEnslaved;
        }

        // Get related documents for enslaved individuals.
        // Priority order:
        //   1. person_documents linked via enslaver's canonical_person_id (DC petitions, plantation records)
        //   2. Source URL extracted from the notes field (MSA, NARA, etc.)
        //   3. confirming_documents (legacy — mostly broken beyondkin.org header images, skipped if useless)
        let documents = [];
        if (tableSource === 'enslaved_individuals') {

            // 1. Query person_documents linked to the enslaver — these are petition/plantation
            //    records that name the enslaved person by full_name.
            if (person.enslaved_by_individual_id) {
                try {
                    // Expand to all pages in each matched collection:
                    // Step 1 finds collection_keys where any page names this person.
                    // Step 2 returns ALL pages for those collections so the viewer
                    // can navigate the complete document, not just the name-matched pages.
                    const petitionDocs = await pool.query(`
                        SELECT pd.id,
                            pd.name_as_appears           AS filename,
                            pd.document_type             AS doc_type,
                            pd.collection_name,
                            pd.collection_key,
                            pd.collection_page_number,
                            pd.collection_page_count,
                            pd.source_type_label,
                            COALESCE(pd.title, pd.collection_name,
                                pd.document_type)        AS title,
                            pd.page_reference,
                            pd.s3_key,
                            pd.s3_url,
                            pd.source_url,
                            pd.document_date,
                            pd.document_year
                        FROM person_documents pd
                        WHERE pd.collection_key IN (
                            SELECT DISTINCT collection_key
                            FROM person_documents
                            WHERE canonical_person_id = $1
                              AND name_as_appears ILIKE $2
                              AND collection_key IS NOT NULL
                        )
                        UNION
                        -- Ungrouped single-page docs that name this person directly
                        SELECT pd2.id,
                            pd2.name_as_appears           AS filename,
                            pd2.document_type             AS doc_type,
                            pd2.collection_name,
                            pd2.collection_key,
                            pd2.collection_page_number,
                            pd2.collection_page_count,
                            pd2.source_type_label,
                            COALESCE(pd2.title, pd2.collection_name,
                                pd2.document_type)        AS title,
                            pd2.page_reference,
                            pd2.s3_key,
                            pd2.s3_url,
                            pd2.source_url,
                            pd2.document_date,
                            pd2.document_year
                        FROM person_documents pd2
                        WHERE pd2.canonical_person_id = $1
                          AND pd2.name_as_appears ILIKE $2
                          AND pd2.collection_key IS NULL
                        ORDER BY collection_key NULLS LAST, collection_page_number ASC
                        LIMIT 50
                    `, [person.enslaved_by_individual_id, `%${person.full_name}%`]);
                    documents = petitionDocs.rows.map(d => ({ ...d, document_id: String(d.id) }));
                } catch (e) {
                    console.log('person_documents enslaver query error (non-fatal):', e.message);
                }
            }

            // If still no docs, also check ALL petition docs for this enslaver
            // (some petitions list multiple enslaved people by name on one page —
            //  name match above might miss abbreviations like "O. Brown")
            if (documents.length === 0 && person.enslaved_by_individual_id) {
                try {
                    const allPetitionDocs = await pool.query(`
                        SELECT
                            id,
                            name_as_appears           AS filename,
                            document_type             AS doc_type,
                            COALESCE(
                                collection_name || CASE WHEN page_reference IS NOT NULL THEN ' — ' || page_reference ELSE '' END,
                                page_reference,
                                collection_name,
                                document_type
                            )                         AS title,
                            page_reference,
                            s3_key,
                            s3_url,
                            source_url,
                            document_date,
                            document_year
                        FROM person_documents
                        WHERE canonical_person_id = $1
                        ORDER BY COALESCE(image_number, 999) ASC
                        LIMIT 5
                    `, [person.enslaved_by_individual_id]);
                    documents = allPetitionDocs.rows.map(d => ({ ...d, document_id: String(d.id) }));
                } catch (e) {
                    console.log('person_documents enslaver fallback query error (non-fatal):', e.message);
                }
            }

            // 2. Extract source URL from the notes field.
            //    Format: "...Source: https://msa.maryland.gov/...pdf..."
            //    This is the primary proof link for enslaved individuals like Otho Brown
            //    whose source document is stored at MSA/NARA but not yet in S3.
            const noteSourceMatch = person.notes
                ? person.notes.match(/Source:\s*(https?:\/\/\S+)/i)
                : null;
            if (noteSourceMatch) {
                // Strip trailing punctuation that the greedy \S+ regex may pull in
                // e.g. "...am812--97.pdf. Row OCR:" → strip the trailing "."
                const cleanUrl = noteSourceMatch[1].replace(/[.,;:!?]+$/, '');

                // Parse a human-readable title from the notes
                // Handles formats like "SC 2908, Vol. 812, p. 97" or "Maryland State Archives..."
                const archiveRef = person.notes.match(
                    /SC\s*\d+[^,]*,\s*[Vv]ol\.\s*\d+[^,]*,\s*p\.\s*\d+/i
                ) || person.notes.match(/SC\s*\d+.*?p\.\s*\d+/i);
                const noteDoc = {
                    document_id: null,
                    doc_type: 'primary_source',
                    title: archiveRef
                        ? archiveRef[0].trim()
                        : 'Primary Source Document',
                    filename: cleanUrl.split('/').pop() || 'document.pdf',
                    source_url: cleanUrl,
                    s3_key: null,
                    s3_url: null,
                };
                // Only add if not already covered by a person_documents row with same URL
                const alreadyCovered = documents.some(d => d.source_url === cleanUrl);
                if (!alreadyCovered) {
                    documents = [noteDoc, ...documents];
                }
            }

            // 2b. person_documents linked directly via enslaved_individual_id.
            //     MSA certificates of freedom (996 rows) are stored with this FK only.
            //     These are invisible unless we query via the enslaved person's own ID.
            try {
                const directEnslavedDocs = await pool.query(`
                    SELECT pd.id,
                        COALESCE(pd.title, pd.collection_name, pd.document_type) AS title,
                        pd.name_as_appears AS filename,
                        pd.document_type AS doc_type,
                        pd.collection_name,
                        pd.collection_key,
                        pd.collection_page_number,
                        pd.collection_page_count,
                        pd.source_type_label,
                        pd.page_reference,
                        pd.s3_key,
                        pd.s3_url,
                        pd.source_url,
                        pd.document_date,
                        pd.document_year
                    FROM person_documents pd
                    WHERE pd.enslaved_individual_id = $1
                    ORDER BY pd.image_number ASC NULLS LAST, pd.id ASC
                    LIMIT 20
                `, [person.id]);
                if (directEnslavedDocs.rows.length > 0) {
                    const newDocs = directEnslavedDocs.rows.map(d => ({ ...d, document_id: String(d.id) }));
                    // Merge, deduplicating by id
                    const existingIds = new Set(documents.map(d => String(d.id)));
                    for (const d of newDocs) {
                        if (!existingIds.has(String(d.id))) documents.push(d);
                    }
                }
            } catch (e) {
                console.log('person_documents enslaved_individual_id query (non-fatal):', e.message);
            }

            // 3. confirming_documents (legacy fallback — skip if document_url looks like
            //    a placeholder/broken image rather than an actual document)
            if (documents.length === 0) {
                const docsResult = await pool.query(`
                    SELECT
                        cd.id         AS legacy_id,
                        cd.document_url,
                        cd.document_type AS doc_type
                    FROM confirming_documents cd
                    JOIN unconfirmed_persons up ON cd.unconfirmed_person_id = up.lead_id
                    WHERE up.full_name ILIKE $1
                      AND cd.document_url NOT ILIKE '%BK-Header%'
                      AND cd.document_url NOT ILIKE '%.jpg'
                    LIMIT 5
                `, [`%${person.full_name}%`]);
                if (docsResult.rows.length > 0) {
                    documents = docsResult.rows.map(d => ({
                        document_id: null,
                        doc_type: d.doc_type,
                        title: d.doc_type,
                        filename: d.document_url.split('/').pop() || 'document',
                        source_url: d.document_url,
                        s3_key: null,
                        s3_url: null,
                    }));
                }
            }
        } else if (tableSource === 'unconfirmed_persons') {
            // ── Fix: Freedman's Bank depositors + 1860 slave schedule persons live in
            //    unconfirmed_persons. Their source images are linked via unconfirmed_person_id,
            //    NOT canonical_person_id. Without this block the primary source viewer never loads.
            try {
                const upDocsResult = await pool.query(`
                    SELECT
                        pd.id,
                        COALESCE(pd.title, pd.collection_name, pd.document_type) AS title,
                        pd.name_as_appears AS filename,
                        pd.document_type AS doc_type,
                        pd.collection_name,
                        pd.collection_key,
                        pd.collection_page_number,
                        pd.collection_page_count,
                        pd.source_type_label,
                        pd.page_reference,
                        pd.s3_key,
                        pd.s3_url,
                        pd.source_url,
                        pd.document_date,
                        pd.document_year
                    FROM person_documents pd
                    WHERE pd.unconfirmed_person_id = $1
                    ORDER BY pd.image_number ASC NULLS LAST, pd.id ASC
                    LIMIT 20
                `, [parseInt(id, 10)]);
                if (upDocsResult.rows.length > 0) {
                    documents = upDocsResult.rows.map(d => ({ ...d, document_id: String(d.id) }));
                }
            } catch (e) {
                console.log('person_documents unconfirmed_persons query (non-fatal):', e.message);
            }
        }

        // For slaveholders, get their documents from documents table
        let ownerDocuments = [];
        let documentCollections = [];
        let enslavedPersons = [];
        let descendants = [];

        // ── Fix: Guard against freedpersons being shown as slaveholders.
        //    unconfirmed_persons are ALWAYS depositors/freedpeople — never run enslaved lookup.
        //    canonical_persons records whose person_type is a freedperson type are also excluded.
        //    Without this guard, a freed person named "William Davis" would show all enslaved
        //    people owned by every other William Davis in the database (fuzzy name fallbacks).
        const FREEDPERSON_TYPES = new Set([
            'freedperson', 'depositor', 'enslaved', 'enslaved_ancestor',
            'confirmed_enslaved', 'free_poc', 'free_person_of_color', 'suspected_enslaved'
        ]);
        const isConfirmedSlaveholder = ['slaveholder', 'owner', 'enslaver',
            'confirmed_owner', 'suspected_owner', 'free_poc_slaveholder']
            .includes(person.person_type);
        const isFreedpersonType = FREEDPERSON_TYPES.has(person.person_type);

        // ── Enslaved / freedperson OWN source documents ────────────────────
        //    The slaveholder block below is gated by !isFreedpersonType so a
        //    freedperson is never shown as owning other people. That same guard
        //    also suppressed an enslaved/freed person's OWN documents — e.g. the
        //    1860 slave-schedule scan or certificate of freedom linked directly
        //    via canonical_person_id — leaving their primary-source viewer empty.
        //    This branch loads ONLY their own docs (no owner→enslaved lookup,
        //    no collection expansion, so no probate-roll blow-up).
        if (isFreedpersonType && tableSource !== 'unconfirmed_persons' &&
            (tableSource === 'canonical_persons' || tableSource === 'documents')) {
            try {
                const ownDocs = await pool.query(`
                    SELECT pd.id, pd.name_as_appears AS filename, pd.document_type AS doc_type,
                        pd.collection_name, pd.collection_key, pd.collection_page_number,
                        pd.collection_page_count, pd.source_type_label,
                        COALESCE(pd.title, pd.collection_name, pd.document_type) AS title,
                        pd.page_reference, pd.s3_key, pd.s3_url, pd.source_url,
                        pd.document_date, pd.document_year, pd.ocr_text,
                        COALESCE(pd.evidence_strength, 'unverified') AS evidence_strength
                    FROM person_documents pd
                    WHERE pd.canonical_person_id = $1
                      AND NOT (pd.s3_key IS NULL AND (
                          pd.source_url ILIKE '%familysearch.org/tree/%'
                          OR pd.source_url ILIKE '%wikitree.com%'
                      ))
                    ORDER BY pd.collection_key NULLS LAST, pd.collection_page_number ASC, pd.id ASC
                    LIMIT 200
                `, [parseInt(id, 10)]);
                if (ownDocs.rows.length > 0) {
                    const grouped = {};
                    for (const row of ownDocs.rows) {
                        const key = row.collection_key || `__solo__${row.id}`;
                        if (!grouped[key]) {
                            grouped[key] = {
                                collection_key: row.collection_key,
                                collection_name: row.collection_name || row.title || row.filename,
                                source_type_label: row.source_type_label,
                                doc_type: row.doc_type,
                                page_count: row.collection_page_count || 1,
                                pages: [],
                            };
                        }
                        grouped[key].pages.push(row);
                    }
                    documentCollections = Object.values(grouped);
                    ownerDocuments = [...ownDocs.rows, ...ownerDocuments];
                }
            } catch (e) {
                console.log('person_documents own-docs (freedperson) query error (non-fatal):', e.message);
            }
        }

        if (!isFreedpersonType && tableSource !== 'unconfirmed_persons' && (
            isConfirmedSlaveholder ||
            tableSource === 'canonical_persons' ||
            tableSource === 'documents'
        )) {
            // Get documents for this owner
            const ownerDocsResult = await pool.query(`
                SELECT
                    document_id,
                    filename,
                    doc_type,
                    s3_key,
                    total_enslaved,
                    ocr_page_count,
                    verification_status
                FROM documents
                WHERE owner_name ILIKE $1
            `, [`%${person.full_name}%`]);
            ownerDocuments = ownerDocsResult.rows;

            // Also pull primary-source images from person_documents (linked by canonical_person_id)
            // These are DC compensated emancipation petitions, wills, etc. uploaded to S3.
            // Expands to full collections — e.g. all 12 pages of a DC petition, not just the pages
            // directly linked to this person's canonical_person_id.
            try {
                const personDocsResult = await pool.query(`
                    SELECT pd.id, pd.name_as_appears AS filename, pd.document_type AS doc_type,
                        pd.collection_name, pd.collection_key, pd.collection_page_number,
                        pd.collection_page_count, pd.source_type_label,
                        COALESCE(pd.title, pd.collection_name, pd.document_type) AS title,
                        pd.page_reference, pd.s3_key, pd.s3_url, pd.source_url,
                        pd.document_date, pd.document_year, pd.ocr_text,
                        COALESCE(pd.evidence_strength, 'unverified') AS evidence_strength
                    FROM person_documents pd
                    WHERE pd.collection_key IN (
                        SELECT DISTINCT collection_key FROM person_documents
                        WHERE canonical_person_id = $1 AND collection_key IS NOT NULL
                    )
                    -- collection_key expansion is for small per-document collections
                    -- (e.g. a 12-page DC petition). Probate collection_key is the
                    -- whole roll (500-800 pages); expanding it returned thousands of
                    -- unrelated pages. Probate is handled by the direct-link half below.
                    AND pd.collection_key NOT LIKE 'georgia-probate-%'
                    -- Exclude climb-sourced FS/WikiTree *profile* URLs (no real document, just an
                    -- external ID link). FamilySearch /ark:/ record URLs are genuine indexed source
                    -- records and ARE kept — see scripts/backfill-bucketB-source-documents.mjs.
                    AND NOT (pd.s3_key IS NULL AND (
                        pd.source_url ILIKE '%familysearch.org/tree/%'
                        OR pd.source_url ILIKE '%wikitree.com%'
                    ))
                    UNION
                    SELECT pd2.id, pd2.name_as_appears AS filename, pd2.document_type AS doc_type,
                        pd2.collection_name, pd2.collection_key, pd2.collection_page_number,
                        pd2.collection_page_count, pd2.source_type_label,
                        COALESCE(pd2.title, pd2.collection_name, pd2.document_type) AS title,
                        pd2.page_reference, pd2.s3_key, pd2.s3_url, pd2.source_url,
                        pd2.document_date, pd2.document_year, pd2.ocr_text,
                        COALESCE(pd2.evidence_strength, 'unverified') AS evidence_strength
                    FROM person_documents pd2
                    -- direct-linked pages: collection-less docs, plus probate pages
                    -- (testator propagation already linked every page of a person's
                    -- own will/inventory, so this returns their full document — not
                    -- the whole roll).
                    WHERE pd2.canonical_person_id = $1
                      AND (pd2.collection_key IS NULL OR pd2.collection_key LIKE 'georgia-probate-%')
                    -- Exclude climb-sourced FS/WikiTree *profile* URLs only; FamilySearch /ark:/
                    -- record URLs are genuine indexed source records and ARE kept.
                    AND NOT (pd2.s3_key IS NULL AND (
                        pd2.source_url ILIKE '%familysearch.org/tree/%'
                        OR pd2.source_url ILIKE '%wikitree.com%'
                    ))
                    ORDER BY collection_key NULLS LAST, collection_page_number ASC
                `, [parseInt(id, 10)]);
                if (personDocsResult.rows.length > 0) {
                    // Group into collection cards for the UI
                    const grouped = {};
                    for (const row of personDocsResult.rows) {
                        const key = row.collection_key || `__solo__${row.id}`;
                        if (!grouped[key]) {
                            grouped[key] = {
                                collection_key: row.collection_key,
                                collection_name: row.collection_name || row.title || row.filename,
                                source_type_label: row.source_type_label,
                                doc_type: row.doc_type,
                                page_count: row.collection_page_count || 1,
                                pages: [],
                            };
                        }
                        grouped[key].pages.push(row);
                    }
                    documentCollections = Object.values(grouped);
                    // Prepend flat rows so they appear first in legacy "Primary source documents"
                    ownerDocuments = [...personDocsResult.rows, ...ownerDocuments];
                }
            } catch (personDocsErr) {
                console.log('person_documents query error (non-fatal):', personDocsErr.message);
            }

            // Get enslaved persons connected to this owner
            // First try enslaved_individuals with direct owner link
            const directLinked = await pool.query(`
                SELECT
                    full_name as enslaved_name,
                    enslaved_id,
                    gender,
                    notes
                FROM enslaved_individuals
                WHERE enslaved_by_individual_id = $1
                   OR notes ILIKE $2
                LIMIT 100
            `, [id, `%${person.full_name}%`]);
            enslavedPersons = directLinked.rows;

            // If no direct links, try census OCR relationships JSON first
            if (enslavedPersons.length === 0) {
                try {
                    // Query enslaved persons where relationships->>'owner' matches this person
                    const censusLinked = await pool.query(`
                        SELECT DISTINCT
                            full_name as enslaved_name,
                            lead_id as lead_id,
                            'unconfirmed_persons' AS table_source,
                            source_url,
                            gender,
                            relationships->>'year' as year,
                            relationships->>'county' as county,
                            relationships->>'state' as state
                        FROM unconfirmed_persons
                        WHERE person_type = 'enslaved'
                        AND relationships->>'owner' ILIKE $1
                        LIMIT 100
                    `, [`%${person.full_name}%`]);
                    enslavedPersons = censusLinked.rows;
                } catch (e) {
                    console.log('Census relationships query error:', e.message);
                }
            }

            // If still no links, try enslaved_owner_connections view
            if (enslavedPersons.length === 0) {
                try {
                    const enslavedResult = await pool.query(`
                        SELECT DISTINCT
                            enslaved_name,
                            enslaved_id,
                            source_url
                        FROM enslaved_owner_connections
                        WHERE owner_name ILIKE $1
                        LIMIT 50
                    `, [`%${person.full_name}%`]);
                    enslavedPersons = enslavedResult.rows;
                } catch (e) {
                    // View may not exist, try alternate query
                    const altResult = await pool.query(`
                        SELECT DISTINCT
                            e.full_name as enslaved_name,
                            e.lead_id as lead_id,
                            'unconfirmed_persons' AS table_source,
                            e.source_url
                        FROM unconfirmed_persons e
                        JOIN unconfirmed_persons o ON e.source_url = o.source_url
                        WHERE e.person_type = 'enslaved'
                        AND o.person_type IN ('slaveholder', 'owner')
                        AND o.full_name ILIKE $1
                        LIMIT 50
                    `, [`%${person.full_name}%`]);
                    enslavedPersons = altResult.rows;
                }
            }

            // Get descendants from WikiTree scraping (slave_owner_descendants_suspected)
            let descendants = [];
            try {
                const descendantsResult = await pool.query(`
                    SELECT
                        id,
                        descendant_name,
                        descendant_birth_year,
                        descendant_death_year,
                        generation_from_owner,
                        is_living,
                        estimated_living_probability,
                        familysearch_person_id as wikitree_id,
                        discovered_via,
                        research_notes
                    FROM slave_owner_descendants_suspected
                    WHERE owner_individual_id = $1
                    OR owner_name ILIKE $2
                    ORDER BY generation_from_owner ASC, descendant_birth_year ASC
                    LIMIT 50
                `, [id, `%${person.full_name}%`]);
                descendants = descendantsResult.rows;
            } catch (e) {
                console.log('Descendants query error:', e.message);
            }

            // Calculate reparations owed BY this slaveholder
            if (enslavedPersons.length > 0) {
                const basePerPerson = 100000; // Base human dignity damages
                const yearsPerPerson = 20; // Average years enslaved
                const annualWage = 25000;
                const yearsSinceEmancipation = 160;

                const totalPerPerson = (yearsPerPerson * annualWage) + basePerPerson;
                const withInterest = totalPerPerson * Math.pow(1.02, yearsSinceEmancipation);

                reparations.total = enslavedPersons.length * withInterest;
                reparations.breakdown = [
                    {
                        label: 'Enslaved Persons',
                        amount: enslavedPersons.length,
                        description: `${enslavedPersons.length} individuals documented`
                    },
                    {
                        label: 'Per Person Debt',
                        amount: withInterest,
                        description: `$${basePerPerson.toLocaleString()} base + ${yearsPerPerson} years wages + interest`
                    },
                    {
                        label: 'Total Debt Owed',
                        amount: reparations.total,
                        description: 'Outstanding reparations liability'
                    }
                ];
            }
        }

        // For enslaved individuals, expand family relationships
        let familyMembers = {
            parents: [],
            children: [],
            spouse: null
        };

        if (tableSource === 'enslaved_individuals') {
            // Get parents
            if (person.parent_ids && person.parent_ids.length > 0) {
                const parentResult = await pool.query(`
                    SELECT enslaved_id, full_name, gender, birth_year, death_year
                    FROM enslaved_individuals
                    WHERE enslaved_id = ANY($1)
                `, [person.parent_ids]);
                familyMembers.parents = parentResult.rows;
            }

            // Get children
            if (person.child_ids && person.child_ids.length > 0) {
                const childResult = await pool.query(`
                    SELECT enslaved_id, full_name, gender, birth_year, death_year
                    FROM enslaved_individuals
                    WHERE enslaved_id = ANY($1)
                `, [person.child_ids]);
                familyMembers.children = childResult.rows;
            } else if (person.child_names && person.child_names.length > 0) {
                // If we have child names but not IDs, include them as unlinked
                familyMembers.children = person.child_names.map(name => ({
                    full_name: name,
                    linked: false
                }));
            }

            // Get spouse
            if (person.spouse_ids && person.spouse_ids.length > 0) {
                const spouseResult = await pool.query(`
                    SELECT enslaved_id, full_name, gender, birth_year, death_year
                    FROM enslaved_individuals
                    WHERE enslaved_id = ANY($1)
                `, [person.spouse_ids]);
                familyMembers.spouse = spouseResult.rows[0] || null;
            } else if (person.spouse_name) {
                familyMembers.spouse = { full_name: person.spouse_name, linked: false };
            }

            // Also check if this person is listed as a parent of anyone
            const childrenOfResult = await pool.query(`
                SELECT enslaved_id, full_name, gender, birth_year
                FROM enslaved_individuals
                WHERE $1 = ANY(parent_ids)
                LIMIT 50
            `, [person.id]);
            if (childrenOfResult.rows.length > 0) {
                // Merge with existing children, avoiding duplicates
                const existingIds = new Set(familyMembers.children.map(c => c.enslaved_id));
                for (const child of childrenOfResult.rows) {
                    if (!existingIds.has(child.enslaved_id)) {
                        familyMembers.children.push(child);
                    }
                }
            }
        } else if (tableSource === 'canonical_persons') {
            // Fix 2: Query canonical_family_edges for navigable family relationships.
            // The enslaved_individuals block above uses array columns (parent_ids/spouse_ids),
            // but canonical_persons uses the canonical_family_edges graph table (M066).
            try {
                const canonicalId = parseInt(id, 10);
                const edgesResult = await pool.query(`
                    SELECT
                        cfe.relationship_type,
                        cfe.evidence_tier,
                        cfe.verified,
                        cfe.confidence,
                        -- Resolve the "other" person in the edge
                        CASE WHEN cfe.person_a_id = $1 THEN cfe.person_b_id
                             ELSE cfe.person_a_id END AS related_id,
                        CASE WHEN cfe.person_a_id = $1 THEN cpb.canonical_name
                             ELSE cpa.canonical_name END AS related_name,
                        CASE WHEN cfe.person_a_id = $1 THEN cpb.birth_year_estimate
                             ELSE cpa.birth_year_estimate END AS related_birth_year,
                        CASE WHEN cfe.person_a_id = $1 THEN cpb.death_year_estimate
                             ELSE cpa.death_year_estimate END AS related_death_year,
                        CASE WHEN cfe.person_a_id = $1 THEN cpb.sex
                             ELSE cpa.sex END AS related_gender,
                        CASE WHEN cfe.person_a_id = $1 THEN cpb.person_type
                             ELSE cpa.person_type END AS related_person_type
                    FROM canonical_family_edges cfe
                    JOIN canonical_persons cpa ON cpa.id = cfe.person_a_id
                    JOIN canonical_persons cpb ON cpb.id = cfe.person_b_id
                    WHERE (cfe.person_a_id = $1 OR cfe.person_b_id = $1)
                      AND cfe.relationship_type IN ('spouse', 'parent_of', 'child_of', 'sibling_of')
                    ORDER BY cfe.evidence_tier ASC, cfe.confidence DESC NULLS LAST
                    LIMIT 50
                `, [canonicalId]);

                for (const edge of edgesResult.rows) {
                    const relatedPerson = {
                        id: edge.related_id,
                        full_name: edge.related_name,
                        birth_year: edge.related_birth_year,
                        death_year: edge.related_death_year,
                        gender: edge.related_gender,
                        person_type: edge.related_person_type,
                        table_source: 'canonical_persons',
                        evidence_tier: edge.evidence_tier,
                        verified: edge.verified,
                        linked: true,
                    };

                    // Normalize relationship_type → familyMembers bucket
                    if (edge.relationship_type === 'spouse') {
                        // Last spouse wins (multiple spouse edges allowed by schema)
                        familyMembers.spouse = relatedPerson;
                    } else if (edge.relationship_type === 'parent_of') {
                        // This person is the parent; related is the child
                        familyMembers.children.push(relatedPerson);
                    } else if (edge.relationship_type === 'child_of') {
                        // This person is the child; related is the parent
                        familyMembers.parents.push(relatedPerson);
                    }
                    // sibling_of: not yet surfaced in UI — skip
                }
            } catch (familyEdgesErr) {
                // canonical_family_edges may not exist yet — non-fatal, falls back to spouse_name text
                console.log('canonical_family_edges query (non-fatal):', familyEdgesErr.message?.substring(0, 80));
            }

            // Fallback: if no spouse found via edges, use the spouse_name text column
            // (evidence_tier=3 implied — unverified, just a name string)
            if (!familyMembers.spouse && person.spouse_name) {
                familyMembers.spouse = {
                    full_name: person.spouse_name,
                    linked: false,
                    evidence_tier: 3,
                    verified: false,
                    source: 'spouse_name_text_column',
                };
            }
        }
        // ── W1: Normalize enslavedPersons so every item has a stable `id` and
        //         `full_name`, and a `table_source` for building the correct link.
        //         Different queries return different field names (enslaved_id, lead_id,
        //         enslaved_name, etc.) — normalize here so PersonProfile.jsx never
        //         renders a broken /person/enslaved_individuals/undefined link.
        const normalizedEnslavedPersons = (enslavedPersons || []).map(ep => ({
            ...ep,
            id: ep.enslaved_id || ep.id || ep.lead_id,
            full_name: ep.full_name || ep.enslaved_name || 'Unknown',
            table_source: ep.table_source || ((ep.enslaved_id && !ep.lead_id) ? 'enslaved_individuals' : 'unconfirmed_persons'),
        })).filter(ep => ep.id); // drop any that still have no id (safety guard)

        // ── W1b: Normalize descendants — slave_owner_descendants_suspected uses
        //         `descendant_name`, not `full_name`. PersonProfile renders d.full_name.
        const normalizedDescendants = (descendants || []).map(d => ({
            ...d,
            full_name: d.full_name || d.descendant_name || 'Unknown descendant',
            birth_year: d.birth_year || d.descendant_birth_year,
            death_year: d.death_year || d.descendant_death_year,
            generation: d.generation || d.generation_from_owner,
        }));

        // ── W2: Infer birth_year from notes for enslaved_individuals if still missing.
        //         MSA Certificates of Freedom and many civilwardc records include age
        //         and document year in their notes/OCR text. Format example:
        //         "...age 28...1848..." or "...age: 34...year: 1862..."
        if (tableSource === 'enslaved_individuals' && !person.birth_year) {
            const notesText = person.notes || '';
            const ageMatch = notesText.match(/\bage[:\s]+(\d{1,3})\b/i)
                || notesText.match(/,\s*age\s+(\d{1,3})\b/i);
            // Year: look for 4-digit year in 1600–1870 range
            const yearMatch = notesText.match(/\b(1[6-8]\d{2})\b/);
            if (ageMatch && yearMatch) {
                const age = parseInt(ageMatch[1], 10);
                const docYear = parseInt(yearMatch[1], 10);
                if (age > 0 && age < 110 && docYear > 1600 && docYear <= 1870) {
                    person.birth_year = docYear - age;
                    person.birth_year_source = 'notes_age_year_inference';
                    person.birth_year_confidence = 0.65;
                    person.birth_year_formula = `document year (${docYear}) − stated age (${age}) = ${person.birth_year} · confidence 65%`;
                    dataAvailability.hasBirthYear = true;
                }
            }
        }

        // ── W6: Query person_external_ids for FamilySearch / WikiTree / Ancestry links.
        //         The canonical_persons SELECT does not include familysearch_id (it doesn't
        //         exist as a direct column — IDs live in person_external_ids). Same for
        //         enslaved_individuals. We do a quick lookup here and merge into `links`.
        let externalLinks = {
            sourceUrl: person.source_url || null,
            familySearch: null,
            ancestry: null,
            wikiTree: null,
        };
        try {
            const canonicalIdForLinks = tableSource === 'canonical_persons'
                ? parseInt(id, 10)
                : (tableSource === 'enslaved_individuals' && person.enslaved_by_individual_id
                    ? parseInt(person.enslaved_by_individual_id, 10)
                    : null);
            if (canonicalIdForLinks) {
                const extIdResult = await pool.query(`
                    SELECT external_id, id_system, external_url
                    FROM person_external_ids
                    WHERE canonical_person_id = $1
                      AND id_system IN ('familysearch', 'wikitree', 'ancestry')
                    LIMIT 5
                `, [canonicalIdForLinks]);
                for (const row of extIdResult.rows) {
                    if (row.id_system === 'familysearch' && !externalLinks.familySearch) {
                        externalLinks.familySearch = row.external_url
                            || `https://www.familysearch.org/tree/person/details/${row.external_id}`;
                    } else if (row.id_system === 'wikitree' && !externalLinks.wikiTree) {
                        externalLinks.wikiTree = row.external_url
                            || `https://www.wikitree.com/wiki/${row.external_id}`;
                    } else if (row.id_system === 'ancestry' && !externalLinks.ancestry) {
                        externalLinks.ancestry = row.external_url
                            || `https://www.ancestry.com/family-tree/person/${row.external_id}`;
                    }
                }
            }
        } catch (e) {
            // person_external_ids may not exist on older schema — non-fatal
            console.log('person_external_ids lookup (non-fatal):', e.message?.substring(0, 80));
        }
        // Fallback to legacy notes-based WikiTree scrape pattern
        if (!externalLinks.wikiTree && person.notes && person.notes.includes('WikiTree:')) {
            const wtMatch = person.notes.match(/WikiTree:\s*([^\s.]+)/);
            if (wtMatch) externalLinks.wikiTree = `https://www.wikitree.com/wiki/${wtMatch[1]}`;
        }

        // ── W3: Build location string that includes plantation name if available.
        const locationStr = person.owner_location
            || [person.primary_plantation, person.primary_county, person.primary_state]
                .filter(Boolean).join(', ')
            || person.location   // may have been set from Freedmen's Bank branch (W4)
            || null;

        // ── Coverage summary — tells the frontend exactly what data is and isn't available
        // so it can render helpful empty states rather than invisible blank sections.
        const extractionMethod = person.extraction_method || person.source_type || '';
        const notesStr = (person.notes || '').toLowerCase();
        let sourceLabel = null;
        if (extractionMethod.includes('freedmens_bank') || notesStr.includes('freedmen')) {
            sourceLabel = 'Freedmen\'s Bank Index';
        } else if (extractionMethod.includes('1860') || notesStr.includes('1860 slave schedule')) {
            const stateStr = person.primary_state ? ` · ${person.primary_state}` : '';
            sourceLabel = `1860 U.S. Slave Schedule${stateStr}`;
        } else if (extractionMethod.includes('civilwardc') || notesStr.includes('civilwardc')) {
            sourceLabel = 'CivilWarDC Petition Database';
        } else if (extractionMethod.includes('msa') || notesStr.includes('msa sc')) {
            sourceLabel = 'Maryland State Archives';
        } else if (extractionMethod.includes('rootsweb') || notesStr.includes('rootsweb')) {
            sourceLabel = 'Rootsweb Genealogy';
        } else if (tableSource === 'canonical_persons') {
            const stateStr = person.primary_state ? ` · ${person.primary_state}` : '';
            sourceLabel = `Historical records${stateStr}`;
        } else if (tableSource === 'enslaved_individuals') {
            sourceLabel = 'Enslaved individuals index';
        } else if (tableSource === 'unconfirmed_persons') {
            sourceLabel = extractionMethod || 'Unconfirmed record';
        }

        // Did any of this person's documents come from an original record
        // (scanned will, deed, slave schedule scan, original petition)? Used
        // by the frontend to surface a "Primary documentation still needed"
        // banner when every linked doc is secondary/indexed.
        const allDocsForCoverage = [...documents, ...ownerDocuments,
            ...documentCollections.flatMap((c) => c.pages || [])];
        const hasPrimarySource = allDocsForCoverage
            .some((d) => d.evidence_strength === 'direct_primary');

        const coverage = {
            hasDocuments: (documents.length + ownerDocuments.length + documentCollections.length) > 0,
            hasPrimarySource,
            hasClimbData: dataAvailability.hasBirthYear || false,
            hasFamilyMembers: (
                (Array.isArray(familyMembers?.parents) && familyMembers.parents.length > 0) ||
                (Array.isArray(familyMembers?.children) && familyMembers.children.length > 0) ||
                !!familyMembers?.spouse
            ),
            hasPetitions: dataAvailability.hasPetitionRecord || false,
            hasExternalIds: !!(
                externalLinks.familySearch || externalLinks.wikiTree || externalLinks.ancestry
            ),
            source_label: sourceLabel,
            extraction_method: extractionMethod || null,
        };

        // Forensic estate accounting — surface the structured will_extractions
        // payload (estate totals, non-chattel assets, liabilities, heirs, and
        // enslaved people with appraised values) for a testator whose will has
        // been forensically extracted. Latest non-rejected extraction wins.
        let forensicEstate = null;
        try {
            const canonicalId = tableSource === 'canonical_persons' ? parseInt(id, 10) : null;
            if (canonicalId) {
                const weRes = await pool.query(`
                    SELECT we.id, we.document_id, we.extractor_version, we.status,
                           we.structured_extraction_jsonb AS s, we.created_at
                      FROM will_extractions we
                     WHERE we.canonical_person_id = $1 AND we.status <> 'rejected'
                     ORDER BY we.created_at DESC NULLS LAST, we.id DESC
                     LIMIT 1
                `, [canonicalId]);
                if (weRes.rows[0]) {
                    const row = weRes.rows[0];
                    const s = typeof row.s === 'string' ? JSON.parse(row.s) : (row.s || {});
                    const totals = s.estate_totals || {};
                    forensicEstate = {
                        will_extraction_id: row.id,
                        document_id: row.document_id,
                        extractor_version: row.extractor_version,
                        testator: s.testator || s.testator_name || null,
                        document_type: s.document_type || null,
                        document_year: s.year || s.document_year || null,
                        totals: {
                            total_appraised_value_usd: totals.total_appraised_value_usd ?? null,
                            enslaved_value_usd: totals.enslaved_value_usd ?? null,
                            non_chattel_value_usd: totals.non_chattel_value_usd ?? null,
                        },
                        enslaved_persons: Array.isArray(s.enslaved_persons) ? s.enslaved_persons : [],
                        non_chattel_assets: Array.isArray(s.non_chattel_assets) ? s.non_chattel_assets : [],
                        liabilities: Array.isArray(s.liabilities) ? s.liabilities : [],
                        heirs: Array.isArray(s.heirs) ? s.heirs : [],
                    };
                }
            }
        } catch (feErr) {
            console.log('forensic estate query (non-fatal):', feErr.message?.substring(0, 100));
        }

        res.json({
            success: true,
            person: {
                ...person,
                tableSource,
                location: locationStr,
                // Estimation metadata — used by UI to render "(est.)" labels with hover tooltips
                birth_year_source: person.birth_year_source || null,
                birth_year_confidence: person.birth_year_confidence || null,
                birth_year_formula: person.birth_year_formula || null,
                death_year_source: person.death_year_source || null,
                freedom_year: person.freedom_year || null,
                freedom_year_source: person.freedom_year_source || null,
                // Plantation displayed separately in identity grid
                primary_plantation: person.primary_plantation || null,
            },
            reparations,
            owner,
            familyMembers,
            dataAvailability,
            documents,
            ownerDocuments,
            documentCollections,
            enslavedPersons: normalizedEnslavedPersons,
            forensicEstate,
            descendants: normalizedDescendants,
            rawData: {
                contextText: person.context_text || null,
                locations: person.locations || null,
                notes: person.notes || null
            },
            links: externalLinks,
            coverage,
        });

    } catch (error) {
        console.error('Person profile error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// DATA QUALITY & CLEANUP ENDPOINTS
// (MUST be before :sessionId routes to avoid route conflicts)
// =============================================================================

const fs = require('fs');
const path = require('path');

/**
 * GET /api/contribute/canonical-audit
 * Audit canonical_persons table for garbage entries
 */
router.get('/canonical-audit', async (req, res) => {
    try {
        const { Pool } = require('pg');
        const pool = sharedPool;

        // Get all canonical_persons
        const allRecords = await pool.query(`
            SELECT id, canonical_name as full_name, person_type,
                   primary_state, primary_county,
                   LEFT(notes, 200) as context_preview,
                   confidence_score, created_at, verification_status
            FROM canonical_persons
            ORDER BY created_at DESC
        `);

        // Identify garbage patterns
        const garbage = [];
        const validOwners = [];
        const validEnslaved = [];

        for (const r of allRecords.rows) {
            const name = r.full_name || '';
            const isGarbage =
                // Not a person name
                name.includes('Army') ||
                name.includes('University') ||
                name.includes('Library') ||
                name.includes('Archive') ||
                name.includes('Museum') ||
                name.includes('Society') ||
                name.includes('Department') ||
                name.includes('Committee') ||
                name.includes('Congress') ||
                name.includes('Government') ||
                // Single word that's not a name
                (name.split(' ').length === 1 && name.length < 4) ||
                // All caps (likely header/title)
                (name === name.toUpperCase() && name.length > 5) ||
                // Contains numbers
                /\d/.test(name) ||
                // Too short
                name.length < 3 ||
                // Common garbage words
                name.toLowerCase().includes('unknown') ||
                name.toLowerCase().includes('participant') ||
                name.toLowerCase().includes('researcher') ||
                name.toLowerCase().includes('record') ||
                name.toLowerCase().includes('index') ||
                name.toLowerCase().includes('census') ||
                // Wikipedia/citation garbage
                (r.context_preview && r.context_preview.includes('ISBN'));

            if (isGarbage) {
                garbage.push(r);
            } else if (r.person_type === 'enslaved' || r.person_type === 'confirmed_enslaved') {
                validEnslaved.push(r);
            } else {
                validOwners.push(r);
            }
        }
        res.json({
            success: true,
            summary: {
                total: allRecords.rows.length,
                garbage: garbage.length,
                validOwners: validOwners.length,
                validEnslaved: validEnslaved.length
            },
            garbageRecords: garbage,
            sampleValidOwners: validOwners.slice(0, 20),
            sampleValidEnslaved: validEnslaved.slice(0, 20)
        });

    } catch (error) {
        console.error('Canonical audit error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/contribute/canonical-audit/cleanup
 * Remove garbage from canonical_persons
 */
router.delete('/canonical-audit/cleanup', async (req, res) => {
    try {
        const { Pool } = require('pg');
        const pool = sharedPool;

        // Delete garbage patterns from canonical_persons
        const result = await pool.query(`
            DELETE FROM canonical_persons
            WHERE
                -- Organizations, not people
                canonical_name ILIKE '%Army%' OR
                canonical_name ILIKE '%University%' OR
                canonical_name ILIKE '%Library%' OR
                canonical_name ILIKE '%Archive%' OR
                canonical_name ILIKE '%Museum%' OR
                canonical_name ILIKE '%Society%' OR
                canonical_name ILIKE '%Department%' OR
                canonical_name ILIKE '%Committee%' OR
                canonical_name ILIKE '%Congress%' OR
                canonical_name ILIKE '%Government%' OR
                -- Unknown placeholders
                canonical_name ILIKE '%unknown%' OR
                canonical_name ILIKE '%participant%' OR
                canonical_name ILIKE '%researcher%' OR
                -- Contains numbers (not names)
                canonical_name ~ '[0-9]' OR
                -- Too short
                LENGTH(canonical_name) < 3 OR
                -- Wikipedia/citation garbage in context
                notes ILIKE '%ISBN%'
            RETURNING id, canonical_name as full_name
        `);
        res.json({
            success: true,
            message: `Deleted ${result.rowCount} garbage records from canonical_persons`,
            deletedCount: result.rowCount,
            deletedRecords: result.rows.slice(0, 50) // Show first 50
        });

    } catch (error) {
        console.error('Canonical cleanup error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contribute/data-quality
 * Analyze database for garbage and issues
 */
router.get('/data-quality', async (req, res) => {
    try {
        const { Pool } = require('pg');
        const pool = sharedPool;

        // Get issue counts
        const issues = await pool.query(`
            SELECT
                'placeholder_names' as issue_type,
                COUNT(*) as count,
                'Records with "Unknown Enslaved Person" - need manual extraction' as description
            FROM unconfirmed_persons
            WHERE full_name LIKE 'Unknown Enslaved Person%'
            UNION ALL
            SELECT 'names_with_numbers', COUNT(*), 'Names with list numbers like "1 Walter Bell"'
            FROM unconfirmed_persons WHERE full_name ~ '^[0-9]+ '
            UNION ALL
            SELECT 'missing_owner_link', COUNT(*), 'Enslaved persons without owner connection'
            FROM unconfirmed_persons WHERE person_type = 'enslaved' AND context_text NOT LIKE '%Owner:%'
            UNION ALL
            SELECT 'low_confidence', COUNT(*), 'Records with confidence < 0.5'
            FROM unconfirmed_persons WHERE confidence_score < 0.5
            UNION ALL
            SELECT 'very_low_confidence', COUNT(*), 'Records with confidence < 0.3 - likely garbage'
            FROM unconfirmed_persons WHERE confidence_score < 0.3
            UNION ALL
            SELECT 'all_caps', COUNT(*), 'Names in ALL CAPS - possible OCR issue'
            FROM unconfirmed_persons WHERE full_name = UPPER(full_name) AND LENGTH(full_name) > 2
            ORDER BY count DESC
        `);

        // Get sample garbage for review
        const sampleGarbage = await pool.query(`
            SELECT lead_id, full_name, person_type, confidence_score,
                   LEFT(context_text, 100) as context_preview,
                   source_url
            FROM unconfirmed_persons
            WHERE confidence_score < 0.5
               OR full_name LIKE 'Unknown%'
               OR full_name ~ '^[0-9]+ '
            ORDER BY confidence_score ASC
            LIMIT 50
        `);

        // Get fixable patterns (names with numbers that can be auto-cleaned)
        const fixablePatterns = await pool.query(`
            SELECT
                'strip_leading_numbers' as fix_type,
                COUNT(*) as affected_count,
                'Remove leading numbers from names like "1 Walter Bell"' as description
            FROM unconfirmed_persons WHERE full_name ~ '^[0-9]+ [A-Z]'
            UNION ALL
            SELECT 'strip_gender_suffix', COUNT(*), 'Remove "—Male" or "—Female" suffixes'
            FROM unconfirmed_persons WHERE full_name ~ '—(Male|Female)$'
            UNION ALL
            SELECT 'delete_placeholders', COUNT(*), 'Delete "Unknown Enslaved Person" placeholders'
            FROM unconfirmed_persons WHERE full_name LIKE 'Unknown Enslaved Person%'
        `);
        res.json({
            success: true,
            summary: {
                totalIssues: issues.rows.reduce((sum, r) => sum + parseInt(r.count), 0),
                issueBreakdown: issues.rows
            },
            fixablePatterns: fixablePatterns.rows,
            sampleGarbage: sampleGarbage.rows,
            message: 'Data quality analysis complete. Review samples and apply fixes.'
        });

    } catch (error) {
        console.error('Data quality error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contribute/data-quality/fix
 * Apply automated fixes to database
 */
router.post('/data-quality/fix', async (req, res) => {
    try {
        const { fixType } = req.body;

        const { Pool } = require('pg');
        const pool = sharedPool;

        let result;
        let message;

        switch (fixType) {
            case 'strip_leading_numbers':
                result = await pool.query(`
                    UPDATE unconfirmed_persons
                    SET full_name = REGEXP_REPLACE(full_name, '^[0-9]+ ', ''),
                        updated_at = NOW()
                    WHERE full_name ~ '^[0-9]+ [A-Z]'
                    RETURNING lead_id
                `);
                message = `Stripped leading numbers from ${result.rowCount} names`;
                break;

            case 'strip_gender_suffix':
                result = await pool.query(`
                    UPDATE unconfirmed_persons
                    SET full_name = REGEXP_REPLACE(full_name, '—(Male|Female)$', ''),
                        updated_at = NOW()
                    WHERE full_name ~ '—(Male|Female)$'
                    RETURNING lead_id
                `);
                message = `Stripped gender suffixes from ${result.rowCount} names`;
                break;

            case 'delete_placeholders':
                result = await pool.query(`
                    DELETE FROM unconfirmed_persons
                    WHERE full_name LIKE 'Unknown Enslaved Person%'
                    RETURNING lead_id
                `);
                message = `Deleted ${result.rowCount} placeholder records`;
                break;

            case 'delete_very_low_confidence':
                result = await pool.query(`
                    DELETE FROM unconfirmed_persons
                    WHERE confidence_score < 0.3
                    RETURNING lead_id
                `);
                message = `Deleted ${result.rowCount} very low confidence records`;
                break;

            default:
                return res.status(400).json({ success: false, error: 'Unknown fix type' });
        }
        res.json({
            success: true,
            message,
            affectedRows: result.rowCount
        });

    } catch (error) {
        console.error('Data fix error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/contribute/data-quality/record/:id
 * Delete a specific garbage record
 */
router.delete('/data-quality/record/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { Pool } = require('pg');
        const pool = sharedPool;

        const result = await pool.query(`
            DELETE FROM unconfirmed_persons WHERE lead_id = $1 RETURNING full_name
        `, [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Record not found' });
        }

        res.json({
            success: true,
            message: `Deleted: ${result.rows[0].full_name}`
        });

    } catch (error) {
        console.error('Delete record error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/contribute/data-quality/record/:id
 * Fix/update a specific record
 */
router.put('/data-quality/record/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, person_type, confidence_score } = req.body;

        const { Pool } = require('pg');
        const pool = sharedPool;

        const result = await pool.query(`
            UPDATE unconfirmed_persons
            SET full_name = COALESCE($2, full_name),
                person_type = COALESCE($3, person_type),
                confidence_score = COALESCE($4, confidence_score),
                updated_at = NOW()
            WHERE lead_id = $1
            RETURNING *
        `, [id, full_name, person_type, confidence_score]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Record not found' });
        }

        // Add corrected name to training data
        if (full_name) {
            const patternsFile = path.join(__dirname, '../../../data/learned-patterns.json');
            if (fs.existsSync(patternsFile)) {
                const patternsData = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));
                if (!patternsData.knownNames.includes(full_name)) {
                    patternsData.knownNames.push(full_name);
                    patternsData.lastUpdated = new Date().toISOString();
                    fs.writeFileSync(patternsFile, JSON.stringify(patternsData, null, 2));
                }
            }
        }

        res.json({
            success: true,
            message: `Updated record`,
            record: result.rows[0]
        });

    } catch (error) {
        console.error('Update record error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contribute/data-quality-metrics
 * Comprehensive real-time metrics for monitoring dashboard
 */
router.get('/data-quality-metrics', async (req, res) => {
    try {
        const { Pool } = require('pg');
        const pool = sharedPool;

        // Get counts by status
        const statusCounts = await pool.query(`
            SELECT
                COALESCE(status, 'pending') as status,
                COUNT(*) as count
            FROM unconfirmed_persons
            GROUP BY COALESCE(status, 'pending')
        `);

        // Get counts by source
        const sourceCounts = await pool.query(`
            SELECT
                CASE
                    WHEN source_url LIKE '%familysearch%' THEN 'FamilySearch'
                    WHEN source_url LIKE '%msa.maryland.gov%' THEN 'Maryland Archives'
                    WHEN source_url LIKE '%civilwardc%' THEN 'Civil War DC'
                    WHEN source_url LIKE '%beyondkin%' THEN 'Beyond Kin'
                    ELSE 'Other'
                END as source,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE COALESCE(status, 'pending') = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'needs_review') as needs_review,
                COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
                COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed
            FROM unconfirmed_persons
            GROUP BY
                CASE
                    WHEN source_url LIKE '%familysearch%' THEN 'FamilySearch'
                    WHEN source_url LIKE '%msa.maryland.gov%' THEN 'Maryland Archives'
                    WHEN source_url LIKE '%civilwardc%' THEN 'Civil War DC'
                    WHEN source_url LIKE '%beyondkin%' THEN 'Beyond Kin'
                    ELSE 'Other'
                END
            ORDER BY total DESC
        `);

        // Get counts by person_type
        const typeCounts = await pool.query(`
            SELECT
                person_type,
                COUNT(*) as count,
                COUNT(*) FILTER (WHERE COALESCE(status, 'pending') = 'pending') as displayable
            FROM unconfirmed_persons
            WHERE COALESCE(status, 'pending') NOT IN ('rejected', 'needs_review')
            GROUP BY person_type
            ORDER BY count DESC
        `);

        // Get garbage rate (rejected / total)
        const garbageStats = await pool.query(`
            SELECT
                COUNT(*) as total_records,
                COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count,
                COUNT(*) FILTER (WHERE COALESCE(status, 'pending') NOT IN ('rejected', 'needs_review')) as clean_count,
                AVG(confidence_score) FILTER (WHERE COALESCE(status, 'pending') NOT IN ('rejected', 'needs_review')) as avg_confidence
            FROM unconfirmed_persons
        `);

        // Get owner linkage rate for FamilySearch
        const linkageStats = await pool.query(`
            SELECT
                COUNT(*) as total_enslaved,
                COUNT(*) FILTER (WHERE context_text LIKE '%Owner:%' OR context_text LIKE '%Slaveholder:%') as with_owner_link
            FROM unconfirmed_persons
            WHERE person_type = 'enslaved'
              AND source_url LIKE '%familysearch%'
              AND COALESCE(status, 'pending') NOT IN ('rejected', 'needs_review')
        `);

        // Get recent processing activity
        const recentActivity = await pool.query(`
            SELECT
                DATE(updated_at) as date,
                COUNT(*) FILTER (WHERE status = 'pending') as promoted,
                COUNT(*) FILTER (WHERE status = 'rejected') as rejected
            FROM unconfirmed_persons
            WHERE updated_at > CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(updated_at)
            ORDER BY date DESC
        `);
        // Calculate metrics
        const stats = garbageStats.rows[0];
        const totalRecords = parseInt(stats.total_records);
        const rejectedCount = parseInt(stats.rejected_count);
        const cleanCount = parseInt(stats.clean_count);
        const avgConfidence = parseFloat(stats.avg_confidence) || 0;

        const garbageRate = totalRecords > 0 ? ((rejectedCount / totalRecords) * 100).toFixed(1) : 0;
        const cleanRate = totalRecords > 0 ? ((cleanCount / totalRecords) * 100).toFixed(1) : 0;

        const linkage = linkageStats.rows[0];
        const ownerLinkageRate = linkage.total_enslaved > 0
            ? ((parseInt(linkage.with_owner_link) / parseInt(linkage.total_enslaved)) * 100).toFixed(1)
            : 0;

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            summary: {
                totalRecords,
                cleanRecords: cleanCount,
                rejectedRecords: rejectedCount,
                garbageRate: parseFloat(garbageRate),
                cleanRate: parseFloat(cleanRate),
                avgConfidence: avgConfidence.toFixed(2),
                ownerLinkageRate: parseFloat(ownerLinkageRate)
            },
            byStatus: statusCounts.rows.reduce((acc, row) => {
                acc[row.status] = parseInt(row.count);
                return acc;
            }, {}),
            bySource: sourceCounts.rows.map(row => ({
                source: row.source,
                total: parseInt(row.total),
                pending: parseInt(row.pending),
                needsReview: parseInt(row.needs_review),
                rejected: parseInt(row.rejected),
                confirmed: parseInt(row.confirmed)
            })),
            byType: typeCounts.rows.map(row => ({
                type: row.person_type,
                count: parseInt(row.count),
                displayable: parseInt(row.displayable)
            })),
            recentActivity: recentActivity.rows.map(row => ({
                date: row.date,
                promoted: parseInt(row.promoted),
                rejected: parseInt(row.rejected)
            })),
            targets: {
                garbageRate: { current: parseFloat(garbageRate), target: 5, status: parseFloat(garbageRate) < 5 ? 'good' : 'needs_work' },
                ownerLinkage: { current: parseFloat(ownerLinkageRate), target: 50, status: parseFloat(ownerLinkageRate) >= 50 ? 'good' : 'needs_work' },
                avgConfidence: { current: parseFloat(avgConfidence.toFixed(2)), target: 0.7, status: avgConfidence >= 0.7 ? 'good' : 'needs_work' }
            }
        });

    } catch (error) {
        console.error('Data quality metrics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contribute/ocr-issues
 * Get all OCR-flagged records that need rescraping or review
 * Used by review.html to surface data quality issues
 */
router.get('/ocr-issues', async (req, res) => {
    try {
        const { Pool } = require('pg');
        const pool = sharedPool;

        // Get summary by issue type and state
        const summary = await pool.query(`
            WITH parsed AS (
                SELECT
                    lead_id,
                    full_name,
                    data_quality_flags->>'ocr_issue' as issue_type,
                    data_quality_flags->>'priority' as priority,
                    CASE
                        WHEN context_text ILIKE '%arkansas%' THEN 'Arkansas'
                        WHEN context_text ILIKE '%louisiana%' THEN 'Louisiana'
                        WHEN context_text ILIKE '%maryland%' THEN 'Maryland'
                        WHEN context_text ILIKE '%tennessee%' THEN 'Tennessee'
                        WHEN context_text ILIKE '%georgia%' THEN 'Georgia'
                        WHEN context_text ILIKE '%alabama%' THEN 'Alabama'
                        WHEN context_text ILIKE '%district of columbia%' THEN 'DC'
                        ELSE 'Other'
                    END as state,
                    context_text
                FROM unconfirmed_persons
                WHERE data_quality_flags->>'ocr_issue' IS NOT NULL
            )
            SELECT
                issue_type,
                state,
                COUNT(*) as count,
                COUNT(*) FILTER (WHERE priority = 'high') as high_priority
            FROM parsed
            GROUP BY issue_type, state
            ORDER BY count DESC
        `);

        // Get sample records for each issue type
        const samples = await pool.query(`
            SELECT
                lead_id,
                full_name,
                data_quality_flags->>'ocr_issue' as issue_type,
                data_quality_flags->>'priority' as priority,
                LEFT(context_text, 150) as context_preview
            FROM unconfirmed_persons
            WHERE data_quality_flags->>'ocr_issue' IS NOT NULL
            ORDER BY
                CASE WHEN data_quality_flags->>'priority' = 'high' THEN 0 ELSE 1 END,
                data_quality_flags->>'ocr_issue'
            LIMIT 100
        `);

        // Get county-level breakdown for Arkansas (worst affected)
        const arkansasCounties = await pool.query(`
            SELECT
                SUBSTRING(context_text FROM '\\| ([^,]+), Arkansas') as county,
                COUNT(*) as flagged_count
            FROM unconfirmed_persons
            WHERE context_text ILIKE '%arkansas%'
            AND data_quality_flags->>'ocr_issue' IS NOT NULL
            GROUP BY county
            ORDER BY flagged_count DESC
            LIMIT 20
        `);

        // Total counts
        const totals = await pool.query(`
            SELECT
                COUNT(*) as total_flagged,
                COUNT(*) FILTER (WHERE data_quality_flags->>'priority' = 'high') as high_priority,
                COUNT(*) FILTER (WHERE data_quality_flags->>'needs_rescrape' = 'true') as needs_rescrape
            FROM unconfirmed_persons
            WHERE data_quality_flags->>'ocr_issue' IS NOT NULL
        `);
        res.json({
            success: true,
            totals: totals.rows[0],
            summaryByIssueAndState: summary.rows,
            arkansasCountyBreakdown: arkansasCounties.rows,
            sampleRecords: samples.rows,
            actions: {
                rescrapeUrl: '/api/contribute/ocr-issues/rescrape',
                deleteUrl: '/api/contribute/ocr-issues/delete',
                clearFlagsUrl: '/api/contribute/ocr-issues/clear-flags'
            },
            message: 'Use pre-indexed FamilySearch data when rescraping. See OCR-QUALITY-CRISIS-PLAN.md'
        });

    } catch (error) {
        console.error('OCR issues endpoint error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contribute/ocr-issues/mark-for-rescrape
 * Mark records for rescraping with improved OCR
 */
router.post('/ocr-issues/mark-for-rescrape', async (req, res) => {
    try {
        const { issueType, state, county } = req.body;

        const { Pool } = require('pg');
        const pool = sharedPool;

        let query = `
            UPDATE unconfirmed_persons
            SET data_quality_flags = data_quality_flags || '{"marked_for_rescrape": true, "rescrape_requested_at": "${new Date().toISOString()}"}'::jsonb
            WHERE data_quality_flags->>'ocr_issue' IS NOT NULL
        `;

        const conditions = [];
        if (issueType) conditions.push(`data_quality_flags->>'ocr_issue' = '${issueType}'`);
        if (state) conditions.push(`context_text ILIKE '%${state}%'`);
        if (county) conditions.push(`context_text ILIKE '%${county}%'`);

        if (conditions.length > 0) {
            query += ' AND ' + conditions.join(' AND ');
        }

        query += ' RETURNING lead_id';

        const result = await pool.query(query);
        res.json({
            success: true,
            markedCount: result.rowCount,
            message: `${result.rowCount} records marked for rescraping with pre-indexed data priority`
        });

    } catch (error) {
        console.error('Mark for rescrape error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// TRAINING & FEEDBACK SYSTEM ENDPOINTS
// =============================================================================

/**
 * GET /api/contribute/training-stats
 * Get parser accuracy statistics and training data info
 */
router.get('/training-stats', async (req, res) => {
    try {
        const patternsFile = path.join(__dirname, '../../../data/learned-patterns.json');
        const examplesFile = path.join(__dirname, '../../../data/training-examples.json');

        let patternsData = { knownNames: [], knownOwners: [], patterns: [], stats: {} };
        let examples = [];

        if (fs.existsSync(patternsFile)) {
            patternsData = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));
        }
        if (fs.existsSync(examplesFile)) {
            examples = JSON.parse(fs.readFileSync(examplesFile, 'utf8'));
        }

        const { Pool } = require('pg');
        const pool = sharedPool;

        const counts = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM enslaved_individuals) as enslaved_count,
                (SELECT COUNT(*) FROM canonical_persons WHERE person_type = 'enslaver') as owner_count,
                (SELECT COUNT(*) FROM unconfirmed_persons) as unconfirmed_count,
                (SELECT COUNT(*) FROM name_match_queue WHERE queue_status = 'pending') as pending_review
        `);
        res.json({
            success: true,
            training: {
                knownNamesCount: patternsData.knownNames?.length || 0,
                knownOwnersCount: patternsData.knownOwners?.length || 0,
                patternsCount: patternsData.patterns?.length || 0,
                documentsProcessed: examples.length,
                lastUpdated: patternsData.lastUpdated || null
            },
            accuracy: patternsData.stats || {
                overallAccuracy: '2.4',
                accuracyByDocType: {}
            },
            database: counts.rows[0],
            sampleNames: (patternsData.knownNames || []).slice(0, 20),
            sampleOwners: (patternsData.knownOwners || []).slice(0, 10)
        });

    } catch (error) {
        console.error('Training stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contribute/system-status
 * Get overall system status for the dashboard
 */
router.get('/system-status', async (req, res) => {
    try {
        const { Pool } = require('pg');
        const pool = sharedPool;

        const status = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM enslaved_individuals) as confirmed_enslaved,
                (SELECT COUNT(*) FROM enslaved_individuals WHERE enslaved_by_individual_id IS NOT NULL) as linked_to_owner,
                (SELECT COUNT(*) FROM canonical_persons WHERE person_type = 'enslaver') as confirmed_owners,
                (SELECT COUNT(*) FROM unconfirmed_persons WHERE person_type = 'enslaved') as unconfirmed_enslaved,
                (SELECT COUNT(*) FROM unconfirmed_persons WHERE source_url LIKE '%008891%') as ravenel_records,
                (SELECT COUNT(*) FROM unconfirmed_persons WHERE source_url LIKE '%msa.maryland.gov%') as msa_records,
                (SELECT COUNT(*) FROM name_match_queue WHERE queue_status = 'pending') as pending_review,
                (SELECT COUNT(*) FROM confirming_documents) as document_count
        `);
        const patternsFile = path.join(__dirname, '../../../data/learned-patterns.json');
        let trainingStats = { knownNames: 0, patterns: 0 };
        if (fs.existsSync(patternsFile)) {
            const data = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));
            trainingStats = {
                knownNames: data.knownNames?.length || 0,
                knownOwners: data.knownOwners?.length || 0,
                patterns: data.patterns?.length || 0
            };
        }

        res.json({
            success: true,
            database: status.rows[0],
            training: trainingStats,
            pipelines: {
                familySearchScraper: 'Ready - uses UnifiedNameExtractor',
                msaScraper: 'Ready - uses UnifiedNameExtractor',
                humanReview: status.rows[0].pending_review > 0 ? 'Items pending' : 'Up to date'
            }
        });

    } catch (error) {
        console.error('System status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contribute/training/add-name
 * Add a manually extracted name to training data
 */
router.post('/training/add-name', async (req, res) => {
    try {
        const { name, type, documentRef, context, relationships } = req.body;

        if (!name || !type) {
            return res.status(400).json({ success: false, error: 'Name and type are required' });
        }

        const patternsFile = path.join(__dirname, '../../../data/learned-patterns.json');
        let patternsData = { knownNames: [], knownOwners: [], patterns: [] };

        if (fs.existsSync(patternsFile)) {
            patternsData = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));
        }

        if (type === 'enslaved') {
            if (!patternsData.knownNames.includes(name)) {
                patternsData.knownNames.push(name);
            }
        } else if (type === 'owner') {
            if (!patternsData.knownOwners.includes(name)) {
                patternsData.knownOwners.push(name);
            }
        }

        if (context) {
            patternsData.patterns.push({
                type: 'manual_extraction',
                name,
                personType: type,
                context,
                relationships: relationships || [],
                documentRef: documentRef || null,
                addedAt: new Date().toISOString()
            });
        }

        patternsData.lastUpdated = new Date().toISOString();

        const dataDir = path.dirname(patternsFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(patternsFile, JSON.stringify(patternsData, null, 2));

        res.json({
            success: true,
            message: `Added ${name} to ${type === 'enslaved' ? 'known names' : 'known owners'}`,
            totals: {
                knownNames: patternsData.knownNames.length,
                knownOwners: patternsData.knownOwners.length,
                patterns: patternsData.patterns.length
            }
        });

    } catch (error) {
        console.error('Add name error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contribute/training/documents
 * Get list of documents available for manual extraction training
 */
router.get('/training/documents', async (req, res) => {
    try {
        const examplesFile = path.join(__dirname, '../../../data/training-examples.json');
        let examples = [];

        if (fs.existsSync(examplesFile)) {
            examples = JSON.parse(fs.readFileSync(examplesFile, 'utf8'));
        }

        const { Pool } = require('pg');
        const pool = sharedPool;

        const ravenelDocs = await pool.query(`
            SELECT DISTINCT
                document_url,
                COUNT(*) as persons_extracted,
                MIN(confidence_score) as min_confidence,
                AVG(confidence_score) as avg_confidence
            FROM unconfirmed_persons
            WHERE source_url LIKE '%008891%'
            GROUP BY document_url
            ORDER BY avg_confidence ASC
            LIMIT 20
        `);
        res.json({
            success: true,
            processedDocuments: examples.map(e => ({
                film: e.film,
                image: e.image,
                documentType: e.documentType,
                manualCount: e.manualCount,
                scraperCount: e.scraperCount,
                accuracy: e.accuracy
            })),
            pendingDocuments: ravenelDocs.rows,
            message: 'Documents sorted by lowest confidence - these need manual review'
        });

    } catch (error) {
        console.error('Training documents error:', error);
        res.status(500).json({ success: false, error: error.message });
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
 * GET /api/contribute/search
 * Search with query params: ?q=name&limit=50&source=&type=
 * Alternative to /search/:query - must be defined BEFORE /:sessionId routes
 */
router.get('/search', async (req, res) => {
    try {
        const { q: query, limit = 50, source, type } = req.query;

        if (!query || query.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Query must be at least 2 characters'
            });
        }

        // Use shared database connection (Neon serverless HTTP)
        const pool = sharedPool;

        const queryLower = query.toLowerCase();
        let detectedType = type || null;
        let searchTerms = query;

        // Detect owner/slaveholder queries
        const ownerPatterns = [
            /slave\s*owners?/i, /slaveholders?/i, /owners?\s+of\s+slaves?/i,
            /plantation\s+owners?/i, /masters?/i
        ];
        const enslavedPatterns = [
            /enslaved\s*(people|persons?|individuals?)?/i,
            /slaves?(?!\s*owners?)/i, /bondsmen/i, /bondswomen/i
        ];

        for (const pattern of ownerPatterns) {
            if (pattern.test(queryLower)) {
                detectedType = 'owner';
                searchTerms = query.replace(pattern, '').trim();
                break;
            }
        }
        if (!detectedType) {
            for (const pattern of enslavedPatterns) {
                if (pattern.test(queryLower)) {
                    detectedType = 'enslaved';
                    searchTerms = query.replace(pattern, '').trim();
                    break;
                }
            }
        }

        const searchPattern = `%${searchTerms}%`;
        let params = [searchPattern, searchPattern, parseInt(limit)];
        let typeFilter = '';
        if (detectedType) {
            typeFilter = ` AND person_type = $4`;
            params.push(detectedType);
        }

        // Search across all tables: unconfirmed_persons, enslaved_individuals, canonical_persons
        // Exclude records marked as 'duplicate' (already merged into canonical_persons)
        const searchQuery = `
            SELECT * FROM (
                SELECT
                    lead_id::text as id, full_name as name, person_type as type,
                    source_url, source_type, confidence_score as confidence,
                    array_to_string(locations, ', ') as locations,
                    context_text as "contextText",
                    scraped_at as created_at, 'unconfirmed_persons' as table_source
                FROM unconfirmed_persons
                WHERE (full_name ILIKE $1 OR context_text ILIKE $2)
                  AND (status IS NULL OR status != 'duplicate')
                  ${typeFilter}

                UNION ALL

                SELECT
                    enslaved_id as id, full_name as name, 'enslaved' as type,
                    NULL as source_url, 'confirmed' as source_type, 1.0 as confidence,
                    NULL::text as locations, notes as "contextText",
                    created_at, 'enslaved_individuals' as table_source
                FROM enslaved_individuals
                WHERE full_name ILIKE $1

                UNION ALL

                SELECT
                    id::text as id, canonical_name as name, person_type as type,
                    NULL as source_url, 'canonical' as source_type,
                    COALESCE(confidence_score, 1.0) as confidence,
                    CONCAT_WS(', ', primary_county, primary_state) as locations,
                    notes as "contextText", created_at, 'canonical_persons' as table_source
                FROM canonical_persons
                -- Fix 3: Exclude climb-sourced descendant/modern rows from search
                WHERE canonical_name ILIKE $1
                  AND person_type NOT IN ('descendant', 'modern_person', 'participant', 'merged')
            ) combined
            ORDER BY confidence DESC NULLS LAST, created_at DESC
            LIMIT $3
        `;

        const result = await pool.query(searchQuery, params);
        // Note: Don't call pool.end() - using shared connection

        res.json({
            success: true,
            count: result.rows.length,
            query: searchTerms,
            detectedType,
            results: result.rows
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// GRAPH VISUALIZATION API - Obsidian-style network view
// Must be defined BEFORE /:sessionId to avoid route conflicts
// =============================================================================

/**
 * GET /api/contribute/graph
 * Returns nodes and edges for force-directed graph visualization
 */
router.get('/graph', async (req, res) => {
    try {
        const pool = sharedPool;
        const { limit = 200, type = 'all', state, search } = req.query;
        const maxLimit = Math.min(parseInt(limit), 500);

        let whereConditions = [];
        let params = [];
        let paramIndex = 1;

        if (type === 'enslaved') {
            whereConditions.push(`person_type IN ('enslaved', 'suspected_enslaved')`);
        } else if (type === 'slaveholder') {
            whereConditions.push(`person_type IN ('slaveholder', 'owner', 'suspected_owner')`);
        }

        if (state) {
            whereConditions.push(`locations::text ILIKE $${paramIndex}`);
            params.push(`%${state}%`);
            paramIndex++;
        }

        if (search) {
            whereConditions.push(`full_name ILIKE $${paramIndex}`);
            params.push(`%${search}%`);
            paramIndex++;
        }

        const whereClause = whereConditions.length > 0
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';

        const nodesQuery = `
            SELECT
                lead_id as id,
                full_name as name,
                person_type as type,
                confidence_score,
                COALESCE(locations[1], 'Unknown') as location,
                CASE
                    WHEN person_type IN ('slaveholder', 'owner', 'suspected_owner') THEN 'owner'
                    WHEN person_type IN ('enslaved', 'suspected_enslaved') THEN 'enslaved'
                    ELSE 'unknown'
                END as category
            FROM unconfirmed_persons
            ${whereClause}
            ORDER BY confidence_score DESC NULLS LAST
            LIMIT $${paramIndex}
        `;
        params.push(maxLimit);

        const nodesResult = await pool.query(nodesQuery, params);

        const typeBreakdown = {};
        const locationBreakdown = {};
        nodesResult.rows.forEach(node => {
            typeBreakdown[node.category] = (typeBreakdown[node.category] || 0) + 1;
            locationBreakdown[node.location] = (locationBreakdown[node.location] || 0) + 1;
        });

        res.json({
            success: true,
            graph: {
                nodes: nodesResult.rows.map(node => ({
                    id: node.id,
                    name: node.name || 'Unknown',
                    type: node.category,
                    location: node.location,
                    confidence: parseFloat(node.confidence_score) || 0.5,
                    size: 5 + (parseFloat(node.confidence_score) || 0.5) * 10
                })),
                edges: []
            },
            stats: {
                nodeCount: nodesResult.rows.length,
                edgeCount: 0,
                byType: typeBreakdown,
                byLocation: locationBreakdown
            },
            filters: { type, state, search, limit: maxLimit }
        });

    } catch (error) {
        console.error('Graph API error:', error);
        res.status(500).json({ success: false, error: error.message });
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
                message: `Promoted ${result.person} to canonical person #${result.canonicalId}${result.gate && !result.gate.assertable_slaveowner ? ' (gated — needs a stored document to assert publicly)' : ''}`,
                canonicalId: result.canonicalId,
                gate: result.gate,
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

/**
 * POST /api/contribute/review-queue/:id/approve
 * Approve a review item and create enslaved individual
 */
router.post('/review-queue/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, gender, notes } = req.body;

        const { Pool } = require('pg');
        const pool = sharedPool;

        // Get the review item
        const itemResult = await pool.query(
            'SELECT * FROM name_match_queue WHERE id = $1',
            [id]
        );

        if (itemResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Item not found' });
        }

        const item = itemResult.rows[0];
        const context = item.source_context ? JSON.parse(item.source_context) : {};

        // Create enslaved individual
        const insertResult = await pool.query(`
            INSERT INTO enslaved_individuals (
                enslaved_id,
                full_name,
                gender,
                notes,
                enslaved_by_individual_id,
                created_at
            ) VALUES (
                $1, $2, $3, $4, $5, NOW()
            )
            RETURNING enslaved_id
        `, [
            `hopewell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            full_name || item.unconfirmed_name,
            gender || context.gender || null,
            notes || `From James Hopewell will (1811). ${context.notes || ''}`,
            context.owner_id || null
        ]);

        // Update queue status
        await pool.query(`
            UPDATE name_match_queue
            SET queue_status = 'approved',
                resolved_at = NOW(),
                resolution_type = 'human_approved'
            WHERE id = $1
        `, [id]);
        res.json({
            success: true,
            message: 'Enslaved individual created',
            enslaved_id: insertResult.rows[0].enslaved_id
        });

    } catch (error) {
        console.error('Approve error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contribute/review-queue/:id/reject
 * Reject a review item
 */
router.post('/review-queue/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const { Pool } = require('pg');
        const pool = sharedPool;

        await pool.query(`
            UPDATE name_match_queue
            SET queue_status = 'rejected',
                resolved_at = NOW(),
                resolution_type = 'human_rejected',
                resolution_notes = $2
            WHERE id = $1
        `, [id, reason || 'Rejected by reviewer']);
        res.json({
            success: true,
            message: 'Item rejected'
        });

    } catch (error) {
        console.error('Reject error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contribute/review-queue/approve-all
 * Approve all pending review items
 */
router.post('/review-queue/approve-all', async (req, res) => {
    try {
        const { Pool } = require('pg');
        const pool = sharedPool;

        // Get all pending items
        const items = await pool.query(`
            SELECT * FROM name_match_queue WHERE queue_status = 'pending_review'
        `);

        let approved = 0;
        for (const item of items.rows) {
            const context = item.source_context ? JSON.parse(item.source_context) : {};

            await pool.query(`
                INSERT INTO enslaved_individuals (
                    enslaved_id, full_name, gender, notes, enslaved_by_individual_id, created_at
                ) VALUES ($1, $2, $3, $4, $5, NOW())
            `, [
                `hopewell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                item.unconfirmed_name,
                context.gender || null,
                `From James Hopewell will (1811). ${context.notes || ''}`,
                context.owner_id || null
            ]);

            await pool.query(`
                UPDATE name_match_queue
                SET queue_status = 'approved', resolved_at = NOW(), resolution_type = 'bulk_approved'
                WHERE id = $1
            `, [item.id]);

            approved++;
        }
        res.json({
            success: true,
            message: `Approved ${approved} items`,
            approved
        });

    } catch (error) {
        console.error('Approve all error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// FREEDMEN'S BANK DEPOSITOR ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

router.get('/depositors/branches', async (req, res) => {
    try {
        const pool = sharedPool;
        const result = await pool.query(`
            SELECT locations[1] AS branch, COUNT(*)::int AS depositor_count
            FROM unconfirmed_persons
            WHERE extraction_method IN ('freedmens_bank_index', 'freedmens_bank_ocr', 'freedmens_bank_scrape')
            AND person_type = 'freedperson'
            GROUP BY locations[1]
            ORDER BY depositor_count DESC
        `);
        res.json({ branches: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/depositors/search', async (req, res) => {
    try {
        const { q, branch, limit = 50, offset = 0 } = req.query;
        const pool = sharedPool;
        const params = [];
        const conditions = [
            "extraction_method IN ('freedmens_bank_index', 'freedmens_bank_ocr', 'freedmens_bank_scrape')"
        ];

        if (q && q.length >= 2) {
            const words = q.split(/\s+/).filter(w => w.length >= 2);
            words.forEach(w => {
                params.push(`%${w}%`);
                conditions.push(`full_name ILIKE $${params.length}`);
            });
        }

        if (branch) {
            params.push(branch);
            conditions.push(`$${params.length} = ANY(locations)`);
        }

        params.push(parseInt(limit));
        params.push(parseInt(offset));

        const result = await pool.query(`
            SELECT lead_id, full_name, locations, context_text,
                   relationships, source_url, extraction_method
            FROM unconfirmed_persons
            WHERE ${conditions.join(' AND ')}
            ORDER BY full_name
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        const countResult = await pool.query(`
            SELECT COUNT(*)::int AS total
            FROM unconfirmed_persons
            WHERE ${conditions.join(' AND ')}
        `, params.slice(0, -2));

        res.json({
            depositors: result.rows.map(r => ({
                ...r,
                family_members: Array.isArray(r.relationships) ? r.relationships : [],
                branch: r.locations?.[0] || null
            })),
            total: countResult.rows[0]?.total || result.rows.length,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = {
    router,
    initializeService
};
