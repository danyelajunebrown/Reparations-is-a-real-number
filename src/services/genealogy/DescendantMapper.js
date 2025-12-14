/**
 * DescendantMapper.js
 * 
 * Orchestrates the mapping of slave owner descendants
 * Coordinates WikiTreeScraper and database storage
 * Builds complete genealogy trees from ancestor to modern descendants
 * 
 * Features:
 * - Recursive tree traversal with depth control
 * - Database storage of suspected descendants
 * - Parent-child relationship tracking
 * - Confidence scoring
 * - Living status estimation
 * - Privacy protection
 */

const WikiTreeScraper = require('./WikiTreeScraper');
const { v4: uuidv4 } = require('uuid');

class DescendantMapper {
    constructor(db, options = {}) {
        this.db = db;
        this.scraper = new WikiTreeScraper({
            headless: options.headless !== undefined ? options.headless : true,
            rateLimit: options.rateLimit || 2000
        });
        this.maxDepth = options.maxDepth || 8;
        this.processedIds = new Set(); // Track processed WikiTree IDs
        this.descendantsFound = [];
    }

    /**
     * Initialize the mapper
     */
    async init() {
        await this.scraper.init();
        console.log('DescendantMapper initialized');
    }

    /**
     * Close and cleanup
     */
    async close() {
        await this.scraper.close();
    }

    /**
     * Map all descendants of a slave owner
     * @param {string} ownerName - Slave owner's name
     * @param {string} wikiTreeId - WikiTree ID of the ancestor
     * @param {Object} ownerData - Additional owner data (birth year, death year, etc.)
     * @returns {Object} Summary of mapping results
     */
    async mapDescendants(ownerName, wikiTreeId, ownerData = {}) {
        console.log('========================================');
        console.log(`Mapping Descendants: ${ownerName}`);
        console.log(`WikiTree ID: ${wikiTreeId}`);
        console.log(`Max Depth: ${this.maxDepth} generations`);
        console.log('========================================\n');

        const startTime = Date.now();
        this.processedIds.clear();
        this.descendantsFound = [];

        try {
            // Get or create slave owner record
            const ownerId = await this.ensureOwnerRecord(ownerName, wikiTreeId, ownerData);
            console.log(`Owner ID: ${ownerId}\n`);

            // Scrape ancestor's profile
            console.log('Scraping ancestor profile...');
            const ancestorProfile = await this.scraper.scrapeProfile(wikiTreeId);
            
            if (!ancestorProfile.success) {
                throw new Error(`Failed to scrape ancestor profile: ${ancestorProfile.error}`);
            }

            console.log(`✓ Ancestor: ${ancestorProfile.name}`);
            console.log(`  Birth: ${ancestorProfile.birthYear || 'Unknown'}`);
            console.log(`  Death: ${ancestorProfile.deathYear || 'Unknown'}`);
            console.log(`  Children: ${ancestorProfile.children.length}\n`);

            // Traverse descendants recursively
            // Note: We start at generation 1 (children), not 0 (ancestor)
            // The ancestor is not stored in descendants_suspected table
            console.log('Traversing descendant tree...\n');
            
            // Process each child of the ancestor
            if (ancestorProfile.children.length > 0) {
                for (const child of ancestorProfile.children) {
                    // Rate limiting
                    await this.scraper.wait();

                    // Scrape child's profile
                    const childProfile = await this.scraper.scrapeProfile(child.wikiTreeId);

                    if (childProfile.success) {
                        await this.traverseDescendants(
                            ownerId,
                            childProfile,
                            null, // No parent ID (children are first generation)
                            1     // Generation 1 (children)
                        );
                    } else {
                        console.log(`  ⚠️  Failed to scrape ${child.name}: ${childProfile.error}`);
                    }
                }
            } else {
                console.log('  No children found for ancestor.\n');
            }

            const duration = (Date.now() - startTime) / 1000;

            // Summary
            const summary = {
                success: true,
                ownerName,
                ownerId,
                ancestorWikiTreeId: wikiTreeId,
                totalDescendants: this.descendantsFound.length,
                maxGeneration: Math.max(...this.descendantsFound.map(d => d.generation), 0),
                durationSeconds: duration,
                descendantsFound: this.descendantsFound
            };

            console.log('\n========================================');
            console.log('✓ Mapping Complete!');
            console.log('========================================');
            console.log(`Total descendants mapped: ${summary.totalDescendants}`);
            console.log(`Generations traversed: ${summary.maxGeneration + 1}`);
            console.log(`Duration: ${duration.toFixed(1)}s`);
            console.log(`Avg time per person: ${(duration / (summary.totalDescendants || 1)).toFixed(2)}s`);

            return summary;

        } catch (error) {
            console.error('\n❌ Mapping failed!');
            console.error('Error:', error.message);
            throw error;
        }
    }

    /**
     * Recursively traverse descendants
     */
    async traverseDescendants(ownerId, personProfile, parentDescendantId, generation) {
        // Check if already processed
        if (this.processedIds.has(personProfile.wikiTreeId)) {
            console.log(`  ⚠️  Skipping ${personProfile.name} (already processed)`);
            return null;
        }

        // Check depth limit
        if (generation > this.maxDepth) {
            console.log(`  ⏹  Reached max depth at generation ${generation}`);
            return null;
        }

        this.processedIds.add(personProfile.wikiTreeId);

        // Store this descendant in database
        const descendantId = await this.storeDescendant(
            ownerId,
            personProfile,
            parentDescendantId,
            generation
        );

        // Track for summary
        this.descendantsFound.push({
            id: descendantId,
            name: personProfile.name,
            wikiTreeId: personProfile.wikiTreeId,
            generation,
            parentId: parentDescendantId,
            childrenCount: personProfile.children.length
        });

        console.log(`  Gen ${generation}: ${personProfile.name} (${personProfile.children.length} children)`);

        // Recursively process children
        if (personProfile.children.length > 0 && generation < this.maxDepth) {
            for (const child of personProfile.children) {
                // Rate limiting
                await this.scraper.wait();

                // Scrape child's profile
                const childProfile = await this.scraper.scrapeProfile(child.wikiTreeId);

                if (childProfile.success) {
                    await this.traverseDescendants(
                        ownerId,
                        childProfile,
                        descendantId,
                        generation + 1
                    );
                } else {
                    console.log(`    ⚠️  Failed to scrape ${child.name}: ${childProfile.error}`);
                }
            }
        }

        return descendantId;
    }

    /**
     * Store descendant in database
     */
    async storeDescendant(ownerId, profile, parentDescendantId, generation) {
        // Calculate confidence score
        const confidenceScore = this.calculateConfidence(profile);

        // Estimate living status
        const isLiving = this.scraper.estimateLiving(profile.birthYear, profile.deathYear);

        // Build relationship path
        const relationshipPath = this.buildRelationshipPath(generation);

        // Build confidence factors JSON
        const confidenceFactors = {
            has_wikitree_profile: 0.3,
            has_birth_date: profile.birthYear ? 0.2 : 0,
            has_death_date: profile.deathYear || profile.isLiving ? 0.2 : 0,
            has_location: (profile.birthPlace || profile.deathPlace) ? 0.15 : 0,
            has_children: profile.children && profile.children.length > 0 ? 0.15 : 0
        };

        try {
            const result = await this.db.query(`
                INSERT INTO slave_owner_descendants_suspected (
                    owner_individual_id,
                    owner_name,
                    owner_birth_year,
                    owner_death_year,
                    descendant_name,
                    descendant_birth_year,
                    descendant_death_year,
                    generation_from_owner,
                    relationship_path,
                    parent_descendant_id,
                    familysearch_person_id,
                    source_documents,
                    confidence_score,
                    confidence_factors,
                    status,
                    is_living,
                    estimated_living_probability,
                    discovered_via,
                    discovery_date,
                    last_verified_date
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_DATE, CURRENT_DATE)
                RETURNING id
            `, [
                null, // owner_individual_id - NULL until we link to individuals table
                this.ownerName,
                this.ownerData.deathYear || null,
                this.ownerData.birthYear || null,
                profile.name,
                profile.birthYear,
                profile.deathYear,
                generation,
                relationshipPath,
                parentDescendantId,
                profile.wikiTreeId, // Store WikiTree ID in familysearch_person_id field
                `{WikiTree profile: https://www.wikitree.com/wiki/${profile.wikiTreeId}}`,
                confidenceScore,
                JSON.stringify(confidenceFactors),
                confidenceScore >= 0.85 ? 'confirmed_lineage' : (confidenceScore >= 0.60 ? 'probable' : 'suspected'),
                isLiving,
                isLiving ? 0.95 : 0.0,
                'wikitree_scraping'
            ]);

            return result.rows[0].id;

        } catch (error) {
            console.error(`Error storing descendant ${profile.name}:`, error.message);
            throw error;
        }
    }

    /**
     * Calculate confidence score for a descendant
     */
    calculateConfidence(profile) {
        let score = 0;

        // Has WikiTree profile = 0.3
        score += 0.3;

        // Birth date known = 0.2
        if (profile.birthYear) {
            score += 0.2;
        }

        // Death date known (if deceased) = 0.2
        if (profile.deathYear || profile.isLiving) {
            score += 0.2;
        }

        // Has location data = 0.15
        if (profile.birthPlace || profile.deathPlace) {
            score += 0.15;
        }

        // Has children (verifiable relationships) = 0.15
        if (profile.children && profile.children.length > 0) {
            score += 0.15;
        }

        return Math.min(score, 1.0);
    }

    /**
     * Build human-readable relationship path
     */
    buildRelationshipPath(generation) {
        if (generation === 0) return 'self';
        if (generation === 1) return 'child';
        if (generation === 2) return 'grandchild';
        
        const greats = 'great-'.repeat(generation - 2);
        return `${greats}grandchild`;
    }

    /**
     * Ensure slave owner record exists - stores owner name for later reference
     */
    async ensureOwnerRecord(ownerName, wikiTreeId, ownerData) {
        // Store owner name for use in storeDescendant
        this.ownerName = ownerName;
        this.wikiTreeId = wikiTreeId;
        this.ownerData = ownerData;
        
        // For now, use wikiTreeId as the owner_individual_id
        // In production, this should link to the individuals table
        return wikiTreeId;
    }

    /**
     * Get full lineage from ancestor to specific descendant
     */
    async getFullLineage(ownerName, descendantName) {
        const result = await this.db.query(`
            WITH RECURSIVE lineage AS (
                -- Start with the descendant
                SELECT 
                    sd.id,
                    sd.parent_descendant_id,
                    sd.descendant_name,
                    sd.familysearch_person_id as wikitree_id,
                    sd.generation_from_owner,
                    sd.relationship_path,
                    sd.descendant_birth_year as birth_year,
                    sd.descendant_death_year as death_year,
                    1 as level
                FROM slave_owner_descendants_suspected sd
                WHERE sd.owner_name ILIKE $1
                  AND sd.descendant_name ILIKE $2
                
                UNION ALL
                
                -- Recursively get parents
                SELECT 
                    sd.id,
                    sd.parent_descendant_id,
                    sd.descendant_name,
                    sd.familysearch_person_id as wikitree_id,
                    sd.generation_from_owner,
                    sd.relationship_path,
                    sd.descendant_birth_year as birth_year,
                    sd.descendant_death_year as death_year,
                    l.level + 1
                FROM slave_owner_descendants_suspected sd
                JOIN lineage l ON sd.id = l.parent_descendant_id
            )
            SELECT * FROM lineage
            ORDER BY generation_from_owner ASC
        `, [ownerName, `%${descendantName}%`]);

        return result.rows;
    }

    /**
     * Get statistics for a mapping
     */
    async getMappingStats(ownerId) {
        const stats = await this.db.query(`
            SELECT 
                COUNT(*) as total_descendants,
                COUNT(DISTINCT generation_from_owner) as generations_mapped,
                AVG(confidence_score) as avg_confidence,
                COUNT(*) FILTER (WHERE is_living = true) as living_descendants,
                COUNT(*) FILTER (WHERE confidence_score >= 0.85) as high_confidence,
                COUNT(*) FILTER (WHERE confidence_score BETWEEN 0.60 AND 0.84) as medium_confidence,
                COUNT(*) FILTER (WHERE confidence_score < 0.60) as low_confidence
            FROM slave_owner_descendants_suspected
            WHERE owner_name = $1
        `, [this.ownerName]);

        return stats.rows[0];
    }
}

module.exports = DescendantMapper;
