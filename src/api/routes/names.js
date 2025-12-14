/**
 * Name Resolution API Routes
 *
 * Handles identity resolution for historical genealogy records where
 * the same person appears with different spellings across documents.
 *
 * Key endpoints:
 * - POST /api/names/resolve - Resolve a name to canonical identity
 * - GET /api/names/search/:query - Search for similar names
 * - GET /api/names/canonical/:id - Get canonical person details
 * - GET /api/names/queue - Get match queue for human review
 * - POST /api/names/queue/:id/resolve - Resolve a queue item
 * - GET /api/names/stats - Get name resolution statistics
 */

const express = require('express');
const router = express.Router();
const NameResolver = require('../../services/NameResolver');

let nameResolver = null;

/**
 * Initialize the name resolution service with database connection
 */
function initializeService(db) {
    nameResolver = new NameResolver(db);
}

// Middleware to ensure service is initialized
function ensureInitialized(req, res, next) {
    if (!nameResolver) {
        return res.status(500).json({
            success: false,
            error: 'Name resolution service not initialized'
        });
    }
    next();
}

router.use(ensureInitialized);

// =============================================================================
// SEARCH ENDPOINTS
// =============================================================================

/**
 * GET /api/names/search/:query
 * Search for names similar to the query using phonetic and fuzzy matching
 */
router.get('/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const limit = parseInt(req.query.limit) || 20;

        if (!query || query.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Query must be at least 2 characters'
            });
        }

        const results = await nameResolver.searchSimilarNames(query, { limit });

        res.json({
            success: true,
            query,
            results: {
                canonical: results.canonical,
                variants: results.variants,
                unconfirmed: results.unconfirmed
            },
            totalMatches: results.totalMatches,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/names/candidates/:name
 * Find candidate matches for a name (for pre-resolution preview)
 */
router.get('/candidates/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const { state, county, personType } = req.query;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Name is required'
            });
        }

        const candidates = await nameResolver.findCandidateMatches(name, {
            state,
            county,
            personType
        });

        // Add phonetic analysis to response
        const parsed = nameResolver.parseName(name);

        res.json({
            success: true,
            queryName: name,
            parsed,
            phonetics: {
                firstSoundex: nameResolver.soundex(parsed.first),
                lastSoundex: nameResolver.soundex(parsed.last),
                firstMetaphone: nameResolver.metaphone(parsed.first),
                lastMetaphone: nameResolver.metaphone(parsed.last)
            },
            candidateCount: candidates.length,
            candidates: candidates.map(c => ({
                id: c.id,
                canonicalName: c.canonical_name,
                firstName: c.first_name,
                lastName: c.last_name,
                matchType: c.match_type,
                matchScore: c.match_score,
                confidence: c.match_confidence,
                levenshteinDistance: c.levenshtein_distance,
                personType: c.person_type,
                sex: c.sex,
                state: c.primary_state,
                county: c.primary_county
            })),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// RESOLUTION ENDPOINTS
// =============================================================================

/**
 * POST /api/names/resolve
 * Resolve a name to a canonical identity (or create new one)
 *
 * Body: { name, metadata: { sex, state, county, personType, sourceUrl, sourceType } }
 */
router.post('/resolve', async (req, res) => {
    try {
        const { name, metadata = {} } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Name is required'
            });
        }

        const result = await nameResolver.resolveOrCreate(name, metadata);

        res.json({
            success: true,
            resolution: {
                action: result.action,
                confidence: result.confidence,
                canonicalPerson: result.canonicalPerson ? {
                    id: result.canonicalPerson.id,
                    canonicalName: result.canonicalPerson.canonical_name,
                    firstName: result.canonicalPerson.first_name,
                    lastName: result.canonicalPerson.last_name,
                    personType: result.canonicalPerson.person_type,
                    sex: result.canonicalPerson.sex,
                    state: result.canonicalPerson.primary_state,
                    county: result.canonicalPerson.primary_county
                } : null,
                candidates: result.candidates?.map(c => ({
                    id: c.id,
                    canonicalName: c.canonical_name,
                    confidence: c.match_confidence
                }))
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/names/resolve-batch
 * Resolve multiple names in a batch (useful for scraping)
 *
 * Body: { names: [{ name, metadata }] }
 */
router.post('/resolve-batch', async (req, res) => {
    try {
        const { names } = req.body;

        if (!Array.isArray(names) || names.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'names array is required'
            });
        }

        if (names.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 100 names per batch'
            });
        }

        const results = [];
        const stats = {
            matched: 0,
            created: 0,
            queued: 0,
            failed: 0
        };

        for (const item of names) {
            try {
                const result = await nameResolver.resolveOrCreate(item.name, item.metadata || {});
                results.push({
                    name: item.name,
                    success: true,
                    action: result.action,
                    confidence: result.confidence,
                    canonicalId: result.canonicalPerson?.id || null
                });

                if (result.action === 'matched') stats.matched++;
                else if (result.action === 'created_new') stats.created++;
                else if (result.action === 'queued_for_review') stats.queued++;
            } catch (err) {
                results.push({
                    name: item.name,
                    success: false,
                    error: err.message
                });
                stats.failed++;
            }
        }

        res.json({
            success: true,
            batchSize: names.length,
            stats,
            results,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// CANONICAL PERSON MANAGEMENT
// =============================================================================

/**
 * GET /api/names/canonical/:id
 * Get detailed information about a canonical person
 */
router.get('/canonical/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await nameResolver.db.query(
            'SELECT * FROM canonical_persons WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Canonical person not found'
            });
        }

        const person = result.rows[0];

        // Get associated name variants
        const variants = await nameResolver.db.query(
            `SELECT * FROM name_variants WHERE canonical_person_id = $1 ORDER BY created_at DESC`,
            [id]
        );

        res.json({
            success: true,
            canonicalPerson: {
                id: person.id,
                canonicalName: person.canonical_name,
                firstName: person.first_name,
                middleName: person.middle_name,
                lastName: person.last_name,
                suffix: person.suffix,
                phonetics: {
                    firstSoundex: person.first_name_soundex,
                    lastSoundex: person.last_name_soundex,
                    firstMetaphone: person.first_name_metaphone,
                    lastMetaphone: person.last_name_metaphone
                },
                demographics: {
                    sex: person.sex,
                    birthYearEstimate: person.birth_year_estimate,
                    deathYearEstimate: person.death_year_estimate
                },
                location: {
                    state: person.primary_state,
                    county: person.primary_county,
                    plantation: person.primary_plantation
                },
                personType: person.person_type,
                confidenceScore: person.confidence_score,
                verificationStatus: person.verification_status,
                createdAt: person.created_at,
                updatedAt: person.updated_at
            },
            nameVariants: variants.rows.map(v => ({
                id: v.id,
                variantName: v.variant_name,
                sourceUrl: v.source_url,
                sourceType: v.source_type,
                matchMethod: v.match_method,
                matchConfidence: v.match_confidence,
                levenshteinDistance: v.levenshtein_distance,
                createdAt: v.created_at
            })),
            variantCount: variants.rows.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/names/canonical
 * Create a new canonical person
 */
router.post('/canonical', async (req, res) => {
    try {
        const { name, metadata = {} } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Name is required'
            });
        }

        const person = await nameResolver.createCanonicalPerson(name, metadata);

        res.json({
            success: true,
            canonicalPerson: {
                id: person.id,
                canonicalName: person.canonical_name,
                firstName: person.first_name,
                lastName: person.last_name,
                phonetics: {
                    firstSoundex: person.first_name_soundex,
                    lastSoundex: person.last_name_soundex
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/names/canonical/:id/variant
 * Add a name variant to a canonical person
 */
router.post('/canonical/:id/variant', async (req, res) => {
    try {
        const { id } = req.params;
        const { variantName, metadata = {} } = req.body;

        if (!variantName) {
            return res.status(400).json({
                success: false,
                error: 'variantName is required'
            });
        }

        const variant = await nameResolver.addNameVariant(parseInt(id), variantName, metadata);

        res.json({
            success: true,
            variant: {
                id: variant.id,
                variantName: variant.variant_name,
                canonicalPersonId: variant.canonical_person_id,
                levenshteinDistance: variant.levenshtein_distance,
                matchMethod: variant.match_method
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// MATCH QUEUE FOR HUMAN REVIEW
// =============================================================================

/**
 * GET /api/names/queue
 * Get pending items in the match queue for human review
 */
router.get('/queue', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const status = req.query.status || 'pending';

        const result = await nameResolver.getMatchQueue({ limit, status });

        res.json({
            success: true,
            queueItems: result.rows.map(item => ({
                id: item.id,
                unconfirmedName: item.unconfirmed_name,
                unconfirmedPersonId: item.unconfirmed_person_id,
                candidateIds: item.candidate_canonical_ids,
                candidateScores: item.candidate_scores,
                sourceUrl: item.source_url,
                sourceContext: item.source_context,
                locationContext: item.location_context,
                status: item.queue_status,
                priority: item.priority,
                createdAt: item.created_at,
                originalExtractedName: item.original_extracted_name,
                originalSourceUrl: item.original_source_url
            })),
            count: result.rows.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/names/queue/:id
 * Get a single queue item with full candidate details
 */
router.get('/queue/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const queueResult = await nameResolver.db.query(
            'SELECT * FROM name_match_queue WHERE id = $1',
            [id]
        );

        if (queueResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Queue item not found'
            });
        }

        const item = queueResult.rows[0];

        // Get full candidate details
        let candidates = [];
        if (item.candidate_canonical_ids && item.candidate_canonical_ids.length > 0) {
            const candidateResult = await nameResolver.db.query(
                'SELECT * FROM canonical_persons WHERE id = ANY($1)',
                [item.candidate_canonical_ids]
            );
            candidates = candidateResult.rows;
        }

        res.json({
            success: true,
            queueItem: {
                id: item.id,
                unconfirmedName: item.unconfirmed_name,
                unconfirmedPersonId: item.unconfirmed_person_id,
                sourceUrl: item.source_url,
                sourceContext: item.source_context,
                locationContext: item.location_context,
                status: item.queue_status,
                priority: item.priority,
                createdAt: item.created_at
            },
            candidates: candidates.map((c, i) => ({
                id: c.id,
                canonicalName: c.canonical_name,
                firstName: c.first_name,
                lastName: c.last_name,
                personType: c.person_type,
                sex: c.sex,
                state: c.primary_state,
                county: c.primary_county,
                score: item.candidate_scores?.[i] || 0
            })),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/names/queue/:id/resolve
 * Resolve a queue item (human decision)
 *
 * Body: { canonicalPersonId, resolutionType, resolvedBy, notes }
 * resolutionType: 'linked_existing' | 'created_new' | 'marked_duplicate' | 'not_a_person'
 */
router.post('/queue/:id/resolve', async (req, res) => {
    try {
        const { id } = req.params;
        const { canonicalPersonId, resolutionType, resolvedBy, notes } = req.body;

        if (!resolutionType) {
            return res.status(400).json({
                success: false,
                error: 'resolutionType is required'
            });
        }

        const validTypes = ['linked_existing', 'created_new', 'marked_duplicate', 'not_a_person'];
        if (!validTypes.includes(resolutionType)) {
            return res.status(400).json({
                success: false,
                error: `resolutionType must be one of: ${validTypes.join(', ')}`
            });
        }

        if (resolutionType === 'linked_existing' && !canonicalPersonId) {
            return res.status(400).json({
                success: false,
                error: 'canonicalPersonId is required when linking to existing person'
            });
        }

        const result = await nameResolver.resolveQueueItem(parseInt(id), {
            canonicalPersonId,
            resolutionType,
            resolvedBy: resolvedBy || 'anonymous',
            notes
        });

        res.json({
            success: true,
            resolution: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// PHONETIC ANALYSIS TOOLS
// =============================================================================

/**
 * POST /api/names/analyze
 * Analyze a name and return phonetic codes and parsed components
 */
router.post('/analyze', async (req, res) => {
    try {
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Name is required'
            });
        }

        const parsed = nameResolver.parseName(name);

        res.json({
            success: true,
            name,
            parsed,
            phonetics: {
                fullNameSoundex: nameResolver.soundex(name),
                fullNameMetaphone: nameResolver.metaphone(name),
                firstNameSoundex: nameResolver.soundex(parsed.first),
                firstNameMetaphone: nameResolver.metaphone(parsed.first),
                lastNameSoundex: nameResolver.soundex(parsed.last),
                lastNameMetaphone: nameResolver.metaphone(parsed.last)
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/names/compare
 * Compare two names and return similarity metrics
 */
router.post('/compare', async (req, res) => {
    try {
        const { name1, name2 } = req.body;

        if (!name1 || !name2) {
            return res.status(400).json({
                success: false,
                error: 'Both name1 and name2 are required'
            });
        }

        const parsed1 = nameResolver.parseName(name1);
        const parsed2 = nameResolver.parseName(name2);

        const levenshteinFull = nameResolver.levenshtein(name1, name2);
        const levenshteinFirst = nameResolver.levenshtein(parsed1.first, parsed2.first);
        const levenshteinLast = nameResolver.levenshtein(parsed1.last, parsed2.last);

        const maxLen = Math.max(name1.length, name2.length);
        const similarity = 1 - (levenshteinFull / maxLen);

        const soundexFirstMatch = nameResolver.soundex(parsed1.first) === nameResolver.soundex(parsed2.first);
        const soundexLastMatch = nameResolver.soundex(parsed1.last) === nameResolver.soundex(parsed2.last);
        const metaphoneFirstMatch = nameResolver.metaphone(parsed1.first) === nameResolver.metaphone(parsed2.first);
        const metaphoneLastMatch = nameResolver.metaphone(parsed1.last) === nameResolver.metaphone(parsed2.last);

        res.json({
            success: true,
            name1: {
                original: name1,
                parsed: parsed1,
                soundex: { first: nameResolver.soundex(parsed1.first), last: nameResolver.soundex(parsed1.last) },
                metaphone: { first: nameResolver.metaphone(parsed1.first), last: nameResolver.metaphone(parsed1.last) }
            },
            name2: {
                original: name2,
                parsed: parsed2,
                soundex: { first: nameResolver.soundex(parsed2.first), last: nameResolver.soundex(parsed2.last) },
                metaphone: { first: nameResolver.metaphone(parsed2.first), last: nameResolver.metaphone(parsed2.last) }
            },
            comparison: {
                levenshtein: {
                    full: levenshteinFull,
                    firstName: levenshteinFirst,
                    lastName: levenshteinLast
                },
                similarity: {
                    percentage: (similarity * 100).toFixed(1) + '%',
                    score: similarity
                },
                phoneticMatches: {
                    soundexFirst: soundexFirstMatch,
                    soundexLast: soundexLastMatch,
                    metaphoneFirst: metaphoneFirstMatch,
                    metaphoneLast: metaphoneLastMatch,
                    anyPhoneticMatch: soundexFirstMatch || soundexLastMatch || metaphoneFirstMatch || metaphoneLastMatch
                },
                likelyMatch: similarity >= 0.85 || (soundexLastMatch && soundexFirstMatch)
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * GET /api/names/stats
 * Get name resolution system statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await nameResolver.getStats();

        res.json({
            success: true,
            stats: {
                canonicalPersons: parseInt(stats.canonical_count) || 0,
                nameVariants: parseInt(stats.variant_count) || 0,
                queueItems: parseInt(stats.pending_queue) + parseInt(stats.resolved_queue) || 0,
                pendingReview: parseInt(stats.pending_queue) || 0,
                resolvedQueue: parseInt(stats.resolved_queue) || 0,
                unconfirmedPersons: parseInt(stats.unconfirmed_count) || 0,
                unconfirmedWithNames: parseInt(stats.unconfirmed_with_name) || 0
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = { router, initializeService };
