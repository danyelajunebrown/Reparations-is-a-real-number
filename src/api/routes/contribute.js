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

        // Build query to search unconfirmed_persons, enslaved_individuals, AND canonical_persons
        // Exclude records marked as 'duplicate' (already merged into canonical_persons)
        let unconfirmedWhere = `${whereClause} AND (status IS NULL OR status != 'duplicate')`;
        let enslavedWhere = whereClause;
        // For canonical_persons, we search canonical_name instead of full_name
        let canonicalWhere = hasTextSearch
            ? `(${words.map((_, i) => `canonical_name ILIKE $${i + 1}`).join(' AND ')})`
            : '1=1';

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

        // Cache miss - query database
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

        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

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

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

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

        await pool.end();

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
            // Get owner from canonical_persons table
            const ownerResult = await pool.query(`
                SELECT id, canonical_name as full_name, person_type, primary_county, primary_state, notes
                FROM canonical_persons
                WHERE id::text = $1
            `, [person.enslaved_by_individual_id]);
            if (ownerResult.rows.length > 0) {
                owner = ownerResult.rows[0];
                ownerName = owner.full_name;
                dataAvailability.hasOwnerData = true;
                dataAvailability.hasStructuredOwner = true;
            }
        } else if (tableSource === 'unconfirmed_persons') {
            // First check relationships JSON (used by census OCR extraction)
            if (person.relationships && typeof person.relationships === 'object') {
                if (person.relationships.owner) {
                    ownerName = person.relationships.owner;
                    owner = {
                        full_name: ownerName,
                        location: person.relationships.county && person.relationships.state
                            ? `${person.relationships.county}, ${person.relationships.state}`
                            : null,
                        year: person.relationships.year
                    };
                    dataAvailability.hasOwnerData = true;
                    dataAvailability.hasStructuredOwner = true;
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

        // Get related documents
        let documents = [];
        if (tableSource === 'enslaved_individuals') {
            const docsResult = await pool.query(`
                SELECT cd.id as document_id, cd.document_url, cd.document_type as doc_type
                FROM confirming_documents cd
                JOIN unconfirmed_persons up ON cd.unconfirmed_person_id = up.lead_id
                WHERE up.full_name ILIKE $1
                LIMIT 5
            `, [`%${person.full_name}%`]);
            documents = docsResult.rows;
        }

        // For slaveholders, get their documents from documents table
        let ownerDocuments = [];
        let enslavedPersons = [];
        if (person.person_type === 'slaveholder' || person.person_type === 'owner' || tableSource === 'canonical_persons' || tableSource === 'documents') {
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
                            lead_id as enslaved_id,
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
                            e.lead_id as enslaved_id,
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
        }

        await pool.end();

        res.json({
            success: true,
            person: {
                ...person,
                tableSource,
                location: person.owner_location || (person.primary_county && person.primary_state ? `${person.primary_county}, ${person.primary_state}` : null)
            },
            reparations,
            owner,
            familyMembers,  // Parents, children, spouse for enslaved individuals
            dataAvailability,
            documents,
            ownerDocuments,  // Documents belonging to slaveholders
            enslavedPersons, // Enslaved persons connected to this owner
            rawData: {
                contextText: person.context_text || null,
                locations: person.locations || null,
                notes: person.notes || null
            },
            links: {
                sourceUrl: person.source_url || null,
                familySearch: person.familysearch_id
                    ? `https://www.familysearch.org/tree/person/details/${person.familysearch_id}`
                    : null,
                ancestry: person.ancestry_id
                    ? `https://www.ancestry.com/family-tree/person/${person.ancestry_id}`
                    : null,
                wikiTree: person.notes && person.notes.includes('WikiTree:')
                    ? `https://www.wikitree.com/wiki/${person.notes.match(/WikiTree:\s*([^\s.]+)/)?.[1] || ''}`
                    : null
            }
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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

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

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

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

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

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

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

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
                await pool.end();
                return res.status(400).json({ success: false, error: 'Unknown fix type' });
        }

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

        const result = await pool.query(`
            DELETE FROM unconfirmed_persons WHERE lead_id = $1 RETURNING full_name
        `, [id]);

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

        const result = await pool.query(`
            UPDATE unconfirmed_persons
            SET full_name = COALESCE($2, full_name),
                person_type = COALESCE($3, person_type),
                confidence_score = COALESCE($4, confidence_score),
                updated_at = NOW()
            WHERE lead_id = $1
            RETURNING *
        `, [id, full_name, person_type, confidence_score]);

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

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

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

        const counts = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM enslaved_individuals) as enslaved_count,
                (SELECT COUNT(*) FROM canonical_persons WHERE person_type = 'enslaver') as owner_count,
                (SELECT COUNT(*) FROM unconfirmed_persons) as unconfirmed_count,
                (SELECT COUNT(*) FROM name_match_queue WHERE queue_status = 'pending') as pending_review
        `);

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

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

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

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

        await pool.end();

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

        const searchQuery = `
            SELECT
                lead_id::text as id, full_name as name, person_type as type,
                source_url, source_type, confidence_score as confidence,
                array_to_string(locations, ', ') as locations,
                context_text as "contextText",
                scraped_at as created_at, 'unconfirmed_persons' as table_source
            FROM unconfirmed_persons
            WHERE (full_name ILIKE $1 OR context_text ILIKE $2) ${typeFilter}
            ORDER BY confidence_score DESC, scraped_at DESC
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

/**
 * POST /api/contribute/review-queue/:id/approve
 * Approve a review item and create enslaved individual
 */
router.post('/review-queue/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, gender, notes } = req.body;

        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

        // Get the review item
        const itemResult = await pool.query(
            'SELECT * FROM name_match_queue WHERE id = $1',
            [id]
        );

        if (itemResult.rows.length === 0) {
            await pool.end();
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

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

        await pool.query(`
            UPDATE name_match_queue
            SET queue_status = 'rejected',
                resolved_at = NOW(),
                resolution_type = 'human_rejected',
                resolution_notes = $2
            WHERE id = $1
        `, [id, reason || 'Rejected by reviewer']);

        await pool.end();

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
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
        });

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

        await pool.end();

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

module.exports = {
    router,
    initializeService
};
