/**
 * NameResolver - Identity Resolution Service for Historical Genealogy Records
 *
 * Handles the reality that the same person appears with different spellings:
 * - "Sally Swailes" in census
 * - "Sally Swailer" in OCR
 * - "Sarah Swales" in family archive
 *
 * Uses Soundex, Metaphone, and Levenshtein distance for matching.
 */

class NameResolver {
    constructor(db) {
        this.db = db;
    }

    // ============================
    // SOUNDEX IMPLEMENTATION
    // ============================

    /**
     * American Soundex algorithm for phonetic matching
     * "Swailes" and "Swales" and "Swailer" all produce same code
     */
    soundex(name) {
        if (!name || typeof name !== 'string') return '';

        const s = name.toUpperCase().replace(/[^A-Z]/g, '');
        if (!s) return '';

        const firstLetter = s[0];
        const codes = {
            'B': 1, 'F': 1, 'P': 1, 'V': 1,
            'C': 2, 'G': 2, 'J': 2, 'K': 2, 'Q': 2, 'S': 2, 'X': 2, 'Z': 2,
            'D': 3, 'T': 3,
            'L': 4,
            'M': 5, 'N': 5,
            'R': 6
        };

        let result = firstLetter;
        let prevCode = codes[firstLetter] || 0;

        for (let i = 1; i < s.length && result.length < 4; i++) {
            const code = codes[s[i]] || 0;
            if (code && code !== prevCode) {
                result += code;
            }
            if (code) prevCode = code;
        }

        return result.padEnd(4, '0');
    }

    // ============================
    // DOUBLE METAPHONE (SIMPLIFIED)
    // ============================

    /**
     * Simplified Metaphone for phonetic matching
     * Better for European names than Soundex
     */
    metaphone(name) {
        if (!name || typeof name !== 'string') return '';

        let s = name.toUpperCase().replace(/[^A-Z]/g, '');
        if (!s) return '';

        // Common transformations
        s = s.replace(/^KN/, 'N')
             .replace(/^GN/, 'N')
             .replace(/^PN/, 'N')
             .replace(/^AE/, 'E')
             .replace(/^WR/, 'R')
             .replace(/^WH/, 'W')
             .replace(/MB$/, 'M')
             .replace(/X/, 'KS')
             .replace(/SCH/, 'SK')
             .replace(/GH/, '')
             .replace(/PH/, 'F')
             .replace(/CK/, 'K')
             .replace(/SH/, 'X')
             .replace(/TH/, '0')
             .replace(/C(?=[IEY])/, 'S')
             .replace(/C/, 'K')
             .replace(/Q/, 'K')
             .replace(/DG/, 'J')
             .replace(/G(?=[IEY])/, 'J')
             .replace(/G/, 'K');

        // Remove duplicate adjacent letters
        let result = s[0] || '';
        for (let i = 1; i < s.length; i++) {
            if (s[i] !== s[i - 1]) {
                result += s[i];
            }
        }

        // Remove vowels except at start
        if (result.length > 1) {
            result = result[0] + result.slice(1).replace(/[AEIOU]/g, '');
        }

        return result.slice(0, 8);
    }

    // ============================
    // LEVENSHTEIN DISTANCE
    // ============================

    /**
     * Calculate edit distance between two strings
     */
    levenshtein(a, b) {
        if (!a) return b ? b.length : 0;
        if (!b) return a.length;

        a = a.toLowerCase();
        b = b.toLowerCase();

        const matrix = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b[i - 1] === a[j - 1]) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    // ============================
    // NAME PARSING
    // ============================

    /**
     * Parse a full name into components
     */
    parseName(fullName) {
        if (!fullName) return { first: '', middle: '', last: '', suffix: '' };

        const suffixes = ['JR', 'SR', 'II', 'III', 'IV', 'V'];
        const parts = fullName.trim().split(/\s+/);

        const result = {
            first: '',
            middle: '',
            last: '',
            suffix: ''
        };

        // Check for suffix
        const lastPart = parts[parts.length - 1]?.toUpperCase().replace(/[.,]/g, '');
        if (suffixes.includes(lastPart)) {
            result.suffix = parts.pop();
        }

        if (parts.length >= 1) result.first = parts[0];
        if (parts.length >= 3) {
            result.middle = parts.slice(1, -1).join(' ');
            result.last = parts[parts.length - 1];
        } else if (parts.length === 2) {
            result.last = parts[1];
        }

        return result;
    }

    // ============================
    // CANONICAL PERSON MANAGEMENT
    // ============================

    /**
     * Create a new canonical person from a name
     */
    async createCanonicalPerson(fullName, metadata = {}) {
        const parsed = this.parseName(fullName);

        const result = await this.db.query(`
            INSERT INTO canonical_persons (
                canonical_name, first_name, middle_name, last_name, suffix,
                first_name_soundex, last_name_soundex,
                first_name_metaphone, last_name_metaphone,
                person_type, sex, primary_state, primary_county,
                confidence_score, verification_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *
        `, [
            fullName,
            parsed.first,
            parsed.middle,
            parsed.last,
            parsed.suffix,
            this.soundex(parsed.first),
            this.soundex(parsed.last),
            this.metaphone(parsed.first),
            this.metaphone(parsed.last),
            metadata.personType || 'enslaved',
            metadata.sex || null,
            metadata.state || null,
            metadata.county || null,
            metadata.confidence || 0.50,
            'auto_created'
        ]);

        return result.rows[0];
    }

    /**
     * Add a name variant to a canonical person
     */
    async addNameVariant(canonicalPersonId, variantName, metadata = {}) {
        const parsed = this.parseName(variantName);
        const canonicalPerson = await this.db.query(
            'SELECT canonical_name FROM canonical_persons WHERE id = $1',
            [canonicalPersonId]
        );

        if (!canonicalPerson.rows[0]) {
            throw new Error(`Canonical person ${canonicalPersonId} not found`);
        }

        const levenDist = this.levenshtein(
            canonicalPerson.rows[0].canonical_name,
            variantName
        );

        const result = await this.db.query(`
            INSERT INTO name_variants (
                canonical_person_id, variant_name,
                variant_first_name, variant_last_name,
                first_name_soundex, last_name_soundex,
                source_url, source_type,
                unconfirmed_person_id,
                match_method, match_confidence, levenshtein_distance
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [
            canonicalPersonId,
            variantName,
            parsed.first,
            parsed.last,
            this.soundex(parsed.first),
            this.soundex(parsed.last),
            metadata.sourceUrl || null,
            metadata.sourceType || null,
            metadata.unconfirmedPersonId || null,
            metadata.matchMethod || 'auto',
            metadata.confidence || 0.70,
            levenDist
        ]);

        return result.rows[0];
    }

    // ============================
    // MATCHING LOGIC
    // ============================

    /**
     * Find candidate matches for a name in the canonical persons table
     * Returns scored candidates ordered by match quality
     *
     * Uses multiple strategies:
     * 1. Exact match
     * 2. Soundex phonetic match
     * 3. Metaphone phonetic match
     * 4. Similar first letter + fuzzy Levenshtein (for OCR errors like Swailes/Swailer)
     * 5. Check name_variants table for known variants
     */
    async findCandidateMatches(fullName, options = {}) {
        const parsed = this.parseName(fullName);
        const firstSoundex = this.soundex(parsed.first);
        const lastSoundex = this.soundex(parsed.last);
        const firstMetaphone = this.metaphone(parsed.first);
        const lastMetaphone = this.metaphone(parsed.last);

        // Get first letter for fuzzy matching (OCR often gets first letter right)
        const lastNameFirstLetter = parsed.last ? parsed.last[0].toUpperCase() : '';
        const firstNameFirstLetter = parsed.first ? parsed.first[0].toUpperCase() : '';

        // Search by multiple criteria including fuzzy matching
        const candidates = await this.db.query(`
            SELECT DISTINCT
                cp.*,
                CASE
                    WHEN LOWER(cp.canonical_name) = LOWER($1) THEN 'exact'
                    WHEN cp.last_name_soundex = $2 AND cp.first_name_soundex = $3 THEN 'soundex'
                    WHEN cp.last_name_metaphone = $4 AND cp.first_name_metaphone = $5 THEN 'metaphone'
                    WHEN cp.last_name_soundex = $2 THEN 'soundex_last_only'
                    WHEN UPPER(LEFT(cp.last_name, 1)) = $8 AND UPPER(LEFT(cp.first_name, 1)) = $9 THEN 'first_letter'
                    ELSE 'fuzzy'
                END as match_type,
                (
                    CASE WHEN LOWER(cp.canonical_name) = LOWER($1) THEN 100 ELSE 0 END +
                    CASE WHEN cp.last_name_soundex = $2 THEN 30 ELSE 0 END +
                    CASE WHEN cp.first_name_soundex = $3 THEN 30 ELSE 0 END +
                    CASE WHEN cp.last_name_metaphone = $4 THEN 25 ELSE 0 END +
                    CASE WHEN cp.first_name_metaphone = $5 THEN 25 ELSE 0 END +
                    CASE WHEN LOWER(cp.last_name) = LOWER($6) THEN 40 ELSE 0 END +
                    CASE WHEN LOWER(cp.first_name) = LOWER($7) THEN 40 ELSE 0 END +
                    CASE WHEN UPPER(LEFT(cp.last_name, 1)) = $8 THEN 15 ELSE 0 END +
                    CASE WHEN UPPER(LEFT(cp.first_name, 1)) = $9 THEN 15 ELSE 0 END
                ) as match_score
            FROM canonical_persons cp
            WHERE
                LOWER(cp.canonical_name) = LOWER($1)
                OR cp.last_name_soundex = $2
                OR cp.last_name_metaphone = $4
                OR LOWER(cp.last_name) = LOWER($6)
                OR (UPPER(LEFT(cp.last_name, 1)) = $8 AND UPPER(LEFT(cp.first_name, 1)) = $9 AND LENGTH(cp.last_name) BETWEEN LENGTH($6) - 2 AND LENGTH($6) + 2)
            ORDER BY match_score DESC
            LIMIT 20
        `, [
            fullName,
            lastSoundex,
            firstSoundex,
            lastMetaphone,
            firstMetaphone,
            parsed.last,
            parsed.first,
            lastNameFirstLetter,
            firstNameFirstLetter
        ]);

        // Also check name_variants table for known OCR variants
        const variantMatches = await this.db.query(`
            SELECT DISTINCT cp.*, 'variant' as match_type, 80 as match_score
            FROM name_variants nv
            JOIN canonical_persons cp ON nv.canonical_person_id = cp.id
            WHERE
                LOWER(nv.variant_name) = LOWER($1)
                OR nv.last_name_soundex = $2
                OR (UPPER(LEFT(nv.variant_last_name, 1)) = $3 AND UPPER(LEFT(nv.variant_first_name, 1)) = $4)
            LIMIT 10
        `, [fullName, lastSoundex, lastNameFirstLetter, firstNameFirstLetter]);

        // Combine and deduplicate results
        const allCandidates = [...candidates.rows];
        for (const variant of variantMatches.rows) {
            if (!allCandidates.find(c => c.id === variant.id)) {
                allCandidates.push(variant);
            }
        }

        // Add Levenshtein distance and calculate confidence
        const scored = allCandidates.map(c => ({
            ...c,
            levenshtein_distance: this.levenshtein(c.canonical_name, fullName),
            confidence: this.calculateConfidence(c, fullName, parsed)
        }));

        // Filter by minimum Levenshtein similarity (at least 60% similar)
        const filtered = scored.filter(c => {
            const maxLen = Math.max(c.canonical_name.length, fullName.length);
            const similarity = 1 - (c.levenshtein_distance / maxLen);
            return similarity >= 0.60 || c.match_type === 'exact' || c.match_type === 'soundex';
        });

        return filtered
            .map(c => ({ ...c, match_confidence: c.confidence }))
            .sort((a, b) => b.match_confidence - a.match_confidence)
            .slice(0, 10);
    }

    /**
     * Calculate match confidence between candidate and query name
     * Uses a combination of:
     * - Exact matching (1.0)
     * - Soundex phonetic matching (0.35 per component)
     * - Levenshtein similarity (up to 0.70 bonus)
     * - First letter matching (0.10 per component)
     */
    calculateConfidence(candidate, queryName, parsedQuery) {
        // Exact match
        if (candidate.canonical_name.toLowerCase() === queryName.toLowerCase()) {
            return 1.0;
        }

        let score = 0;

        // Soundex matches (phonetic similarity)
        const querySoundexFirst = this.soundex(parsedQuery.first);
        const querySoundexLast = this.soundex(parsedQuery.last);

        if (candidate.last_name_soundex === querySoundexLast) score += 0.25;
        if (candidate.first_name_soundex === querySoundexFirst) score += 0.25;

        // Exact component matches
        if (candidate.last_name?.toLowerCase() === parsedQuery.last?.toLowerCase()) score += 0.15;
        if (candidate.first_name?.toLowerCase() === parsedQuery.first?.toLowerCase()) score += 0.15;

        // First letter matches (OCR usually gets first letter right)
        if (candidate.last_name?.[0]?.toUpperCase() === parsedQuery.last?.[0]?.toUpperCase()) score += 0.10;
        if (candidate.first_name?.[0]?.toUpperCase() === parsedQuery.first?.[0]?.toUpperCase()) score += 0.10;

        // Levenshtein similarity bonus (big improvement for OCR errors)
        // "Sally Swailes" vs "Sally Swailer" = 1 char diff = very high similarity
        const levDist = this.levenshtein(candidate.canonical_name, queryName);
        const maxLen = Math.max(candidate.canonical_name.length, queryName.length);
        const levSimilarity = 1 - (levDist / maxLen);

        // High Levenshtein similarity adds significant bonus
        if (levSimilarity >= 0.90) score += 0.50;        // 90%+ similar -> +0.50
        else if (levSimilarity >= 0.85) score += 0.40;  // 85%+ similar -> +0.40
        else if (levSimilarity >= 0.80) score += 0.30;  // 80%+ similar -> +0.30
        else if (levSimilarity >= 0.70) score += 0.20;  // 70%+ similar -> +0.20
        else if (levSimilarity >= 0.60) score += 0.10;  // 60%+ similar -> +0.10

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Resolve a name - find existing canonical person or create new one
     * Used during scraping to automatically link records
     */
    async resolveOrCreate(fullName, metadata = {}) {
        const candidates = await this.findCandidateMatches(fullName, metadata);

        // High confidence match (>= 0.85)
        if (candidates.length > 0 && candidates[0].match_confidence >= 0.85) {
            // Add as variant if it's a new spelling
            const existingVariant = await this.db.query(
                'SELECT id FROM name_variants WHERE LOWER(variant_name) = LOWER($1) AND canonical_person_id = $2',
                [fullName, candidates[0].id]
            );

            if (!existingVariant.rows[0] && fullName.toLowerCase() !== candidates[0].canonical_name.toLowerCase()) {
                await this.addNameVariant(candidates[0].id, fullName, {
                    ...metadata,
                    matchMethod: 'auto_soundex',
                    confidence: candidates[0].match_confidence
                });
            }

            return {
                action: 'matched',
                canonicalPerson: candidates[0],
                confidence: candidates[0].match_confidence
            };
        }

        // Medium confidence (0.60-0.84) - queue for human review
        if (candidates.length > 0 && candidates[0].match_confidence >= 0.60) {
            await this.addToMatchQueue(fullName, candidates, metadata);
            return {
                action: 'queued_for_review',
                candidates: candidates.slice(0, 5),
                confidence: candidates[0].match_confidence
            };
        }

        // Low confidence or no matches - create new canonical person
        const newPerson = await this.createCanonicalPerson(fullName, metadata);
        return {
            action: 'created_new',
            canonicalPerson: newPerson,
            confidence: 1.0
        };
    }

    /**
     * Add uncertain match to human review queue
     */
    async addToMatchQueue(fullName, candidates, metadata = {}) {
        const candidateIds = candidates.map(c => c.id);
        const candidateScores = candidates.map(c => c.match_confidence);

        await this.db.query(`
            INSERT INTO name_match_queue (
                unconfirmed_person_id, unconfirmed_name,
                candidate_canonical_ids, candidate_scores,
                source_url, source_context, location_context,
                queue_status, priority
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
            ON CONFLICT DO NOTHING
        `, [
            metadata.unconfirmedPersonId || null,
            fullName,
            candidateIds,
            candidateScores,
            metadata.sourceUrl || null,
            metadata.sourceContext || null,
            metadata.locationContext || null,
            this.calculatePriority(candidates)
        ]);
    }

    /**
     * Calculate queue priority (1-10)
     * Higher priority for borderline cases that need quick resolution
     */
    calculatePriority(candidates) {
        if (candidates.length === 0) return 3;

        const topScore = candidates[0].match_confidence;
        // Very close to threshold = high priority
        if (topScore >= 0.80 && topScore < 0.85) return 8;
        if (topScore >= 0.70 && topScore < 0.80) return 6;
        if (topScore >= 0.60 && topScore < 0.70) return 4;
        return 3;
    }

    // ============================
    // SEARCH / QUERY METHODS
    // ============================

    /**
     * Search for names similar to query (for user-facing search)
     */
    async searchSimilarNames(query, options = {}) {
        const parsed = this.parseName(query);
        const limit = options.limit || 20;

        // Search canonical persons
        const canonical = await this.db.query(`
            SELECT cp.*, 'canonical' as source_type
            FROM canonical_persons cp
            WHERE
                cp.canonical_name ILIKE $1
                OR cp.last_name_soundex = $2
                OR cp.first_name_soundex = $3
            LIMIT $4
        `, [
            `%${query}%`,
            this.soundex(parsed.last),
            this.soundex(parsed.first),
            limit
        ]);

        // Search name variants
        const variants = await this.db.query(`
            SELECT nv.*, cp.canonical_name, 'variant' as source_type
            FROM name_variants nv
            JOIN canonical_persons cp ON nv.canonical_person_id = cp.id
            WHERE
                nv.variant_name ILIKE $1
                OR nv.last_name_soundex = $2
            LIMIT $3
        `, [
            `%${query}%`,
            this.soundex(parsed.last),
            limit
        ]);

        // Search unconfirmed persons (not yet linked) - use lead_id as the primary key
        let unconfirmed = { rows: [] };
        try {
            unconfirmed = await this.db.query(`
                SELECT up.lead_id as id, up.full_name, up.person_type, up.gender, up.source_url,
                       up.source_type, up.locations, up.birth_year, 'unconfirmed' as source_type_label
                FROM unconfirmed_persons up
                WHERE
                    up.full_name ILIKE $1
                LIMIT $2
            `, [`%${query}%`, limit]);
        } catch (e) { /* table may not exist */ }

        return {
            canonical: canonical.rows,
            variants: variants.rows,
            unconfirmed: unconfirmed.rows,
            totalMatches: canonical.rows.length + variants.rows.length + unconfirmed.rows.length
        };
    }

    /**
     * Get match queue items for human review
     */
    async getMatchQueue(options = {}) {
        const limit = options.limit || 50;
        const status = options.status || 'pending';

        return await this.db.query(`
            SELECT
                mq.*,
                up.full_name as original_extracted_name,
                up.source_url as original_source_url
            FROM name_match_queue mq
            LEFT JOIN unconfirmed_persons up ON mq.unconfirmed_person_id = up.id
            WHERE mq.queue_status = $1
            ORDER BY mq.priority DESC, mq.created_at ASC
            LIMIT $2
        `, [status, limit]);
    }

    /**
     * Resolve a queue item (human decision)
     */
    async resolveQueueItem(queueId, resolution) {
        const { canonicalPersonId, resolutionType, resolvedBy, notes } = resolution;

        await this.db.query(`
            UPDATE name_match_queue
            SET
                resolved_canonical_id = $1,
                resolution_type = $2,
                resolved_by = $3,
                resolution_notes = $4,
                resolved_at = NOW(),
                queue_status = 'resolved'
            WHERE id = $5
        `, [canonicalPersonId, resolutionType, resolvedBy, notes, queueId]);

        // If linked to existing canonical person, add variant
        if (resolutionType === 'linked_existing' && canonicalPersonId) {
            const queueItem = await this.db.query(
                'SELECT * FROM name_match_queue WHERE id = $1',
                [queueId]
            );

            if (queueItem.rows[0]) {
                await this.addNameVariant(canonicalPersonId, queueItem.rows[0].unconfirmed_name, {
                    unconfirmedPersonId: queueItem.rows[0].unconfirmed_person_id,
                    sourceUrl: queueItem.rows[0].source_url,
                    matchMethod: 'human_confirmed',
                    confidence: 0.99
                });
            }
        }

        return { success: true, queueId, resolutionType };
    }

    // ============================
    // STATISTICS
    // ============================

    async getStats() {
        // Use individual try/catch blocks to handle missing tables gracefully
        let canonicalCount = 0, variantCount = 0, pendingQueue = 0, resolvedQueue = 0;
        let unconfirmedCount = 0, unconfirmedWithName = 0;

        try {
            const result = await this.db.query('SELECT COUNT(*) as count FROM canonical_persons');
            canonicalCount = parseInt(result.rows[0].count);
        } catch (e) { /* table may not exist */ }

        try {
            const result = await this.db.query('SELECT COUNT(*) as count FROM name_variants');
            variantCount = parseInt(result.rows[0].count);
        } catch (e) { /* table may not exist */ }

        try {
            const result = await this.db.query("SELECT COUNT(*) as count FROM name_match_queue WHERE queue_status = 'pending'");
            pendingQueue = parseInt(result.rows[0].count);
        } catch (e) { /* table may not exist */ }

        try {
            const result = await this.db.query("SELECT COUNT(*) as count FROM name_match_queue WHERE queue_status = 'resolved'");
            resolvedQueue = parseInt(result.rows[0].count);
        } catch (e) { /* table may not exist */ }

        try {
            const result = await this.db.query('SELECT COUNT(*) as count FROM unconfirmed_persons');
            unconfirmedCount = parseInt(result.rows[0].count);
        } catch (e) { /* table may not exist */ }

        try {
            const result = await this.db.query('SELECT COUNT(*) as count FROM unconfirmed_persons WHERE full_name IS NOT NULL');
            unconfirmedWithName = parseInt(result.rows[0].count);
        } catch (e) { /* table may not exist */ }

        return {
            canonical_persons: canonicalCount,
            name_variants: variantCount,
            queue_items: pendingQueue + resolvedQueue,
            pending_review: pendingQueue,
            resolved_review: resolvedQueue,
            unconfirmed_persons: unconfirmedCount,
            unconfirmed_with_name: unconfirmedWithName
        };
    }
}

module.exports = NameResolver;
