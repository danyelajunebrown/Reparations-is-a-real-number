/**
 * Descendant Tree Builder
 *
 * Builds complete descendant trees from enslaved ancestors.
 * Computes all descendants, counts by generation, estimates living descendants,
 * and calculates reparations distribution.
 */

class DescendantTreeBuilder {
    constructor(database, maxGenerations = 10) {
        this.db = database;
        this.MAX_GENERATIONS = maxGenerations;
        this.cache = new Map(); // Cache for performance
    }

    /**
     * Build complete descendant tree from an ancestor
     * @param {string} ancestorId - Enslaved person ID
     * @param {number} maxGenerations - Maximum depth to traverse
     * @returns {Promise<Object>} Complete tree structure
     */
    async buildDescendantTree(ancestorId, maxGenerations = null) {
        console.log(`Building descendant tree for: ${ancestorId}`);

        const maxDepth = maxGenerations || this.MAX_GENERATIONS;

        // Get ancestor info
        const ancestorResult = await this.db.query(
            'SELECT * FROM enslaved_individuals WHERE enslaved_id = $1',
            [ancestorId]
        );

        if (!ancestorResult.rows || ancestorResult.rows.length === 0) {
            throw new Error(`Ancestor not found: ${ancestorId}`);
        }

        const ancestor = ancestorResult.rows[0];

        // Build tree recursively
        const tree = await this.buildTreeRecursive(ancestor, 0, maxDepth);

        console.log(`✓ Tree built successfully for ${ancestor.full_name}`);

        return tree;
    }

    /**
     * Recursively build tree node
     * @private
     */
    async buildTreeRecursive(person, currentGeneration, maxDepth) {
        // Stop if max depth reached
        if (currentGeneration >= maxDepth) {
            return {
                ...person,
                generation: currentGeneration,
                children: [],
                truncated: true
            };
        }

        // Get children
        const childrenResult = await this.db.query(`
            SELECT ei.*
            FROM enslaved_individuals ei
            JOIN enslaved_relationships er ON er.enslaved_id_2 = ei.enslaved_id
            WHERE er.enslaved_id_1 = $1
              AND er.relationship_type = 'parent-child'
              AND er.is_directed = true
            ORDER BY ei.birth_year ASC NULLS LAST
        `, [person.enslaved_id]);

        const children = childrenResult.rows || [];

        // Recursively build children's trees
        const childTrees = [];
        for (const child of children) {
            const childTree = await this.buildTreeRecursive(child, currentGeneration + 1, maxDepth);
            childTrees.push(childTree);
        }

        return {
            ...person,
            generation: currentGeneration,
            children: childTrees,
            truncated: false
        };
    }

    /**
     * Count all descendants by generation
     * @param {string} ancestorId - Enslaved person ID
     * @returns {Promise<Object>} Counts by generation and total
     */
    async countAllDescendants(ancestorId) {
        console.log(`Counting descendants for: ${ancestorId}`);

        const counts = {
            ancestorId,
            ancestorName: null,
            total: 0,
            byGeneration: {}
        };

        // Get ancestor name
        const ancestorResult = await this.db.query(
            'SELECT full_name FROM enslaved_individuals WHERE enslaved_id = $1',
            [ancestorId]
        );

        if (ancestorResult.rows && ancestorResult.rows.length > 0) {
            counts.ancestorName = ancestorResult.rows[0].full_name;
        }

        // Count descendants using recursive CTE
        const result = await this.db.query(`
            WITH RECURSIVE descendants AS (
                -- Base case: direct children
                SELECT
                    ei.enslaved_id,
                    ei.full_name,
                    1 as generation
                FROM enslaved_individuals ei
                JOIN enslaved_relationships er ON er.enslaved_id_2 = ei.enslaved_id
                WHERE er.enslaved_id_1 = $1
                  AND er.relationship_type = 'parent-child'
                  AND er.is_directed = true

                UNION ALL

                -- Recursive case: children of children
                SELECT
                    ei.enslaved_id,
                    ei.full_name,
                    d.generation + 1
                FROM enslaved_individuals ei
                JOIN enslaved_relationships er ON er.enslaved_id_2 = ei.enslaved_id
                JOIN descendants d ON er.enslaved_id_1 = d.enslaved_id
                WHERE er.relationship_type = 'parent-child'
                  AND er.is_directed = true
                  AND d.generation < $2
            )
            SELECT
                generation,
                COUNT(*) as count
            FROM descendants
            GROUP BY generation
            ORDER BY generation
        `, [ancestorId, this.MAX_GENERATIONS]);

        // Process results
        if (result.rows) {
            result.rows.forEach(row => {
                const gen = parseInt(row.generation);
                const count = parseInt(row.count);
                counts.byGeneration[gen] = count;
                counts.total += count;
            });
        }

        console.log(`✓ Found ${counts.total} total descendants`);

        return counts;
    }

    /**
     * Get all descendants as a flat list
     * @param {string} ancestorId - Enslaved person ID
     * @param {number} maxGenerations - Maximum depth
     * @returns {Promise<Array>} Array of descendants with generation info
     */
    async getAllDescendants(ancestorId, maxGenerations = null) {
        const maxDepth = maxGenerations || this.MAX_GENERATIONS;

        const result = await this.db.query(`
            WITH RECURSIVE descendants AS (
                -- Base case: direct children
                SELECT
                    ei.*,
                    1 as generation,
                    $1 as ancestor_id
                FROM enslaved_individuals ei
                JOIN enslaved_relationships er ON er.enslaved_id_2 = ei.enslaved_id
                WHERE er.enslaved_id_1 = $1
                  AND er.relationship_type = 'parent-child'
                  AND er.is_directed = true

                UNION ALL

                -- Recursive case
                SELECT
                    ei.*,
                    d.generation + 1,
                    d.ancestor_id
                FROM enslaved_individuals ei
                JOIN enslaved_relationships er ON er.enslaved_id_2 = ei.enslaved_id
                JOIN descendants d ON er.enslaved_id_1 = d.enslaved_id
                WHERE er.relationship_type = 'parent-child'
                  AND er.is_directed = true
                  AND d.generation < $2
            )
            SELECT * FROM descendants
            ORDER BY generation, birth_year ASC NULLS LAST
        `, [ancestorId, maxDepth]);

        return result.rows || [];
    }

    /**
     * Estimate living descendants based on birth/death dates
     * Uses actuarial assumptions
     */
    async estimateLivingDescendants(ancestorId) {
        const currentYear = new Date().getFullYear();
        const maxAge = 120; // Maximum human lifespan

        const result = await this.db.query(`
            WITH RECURSIVE descendants AS (
                SELECT
                    ei.*,
                    1 as generation
                FROM enslaved_individuals ei
                JOIN enslaved_relationships er ON er.enslaved_id_2 = ei.enslaved_id
                WHERE er.enslaved_id_1 = $1
                  AND er.relationship_type = 'parent-child'

                UNION ALL

                SELECT
                    ei.*,
                    d.generation + 1
                FROM enslaved_individuals ei
                JOIN enslaved_relationships er ON er.enslaved_id_2 = ei.enslaved_id
                JOIN descendants d ON er.enslaved_id_1 = d.enslaved_id
                WHERE er.relationship_type = 'parent-child'
                  AND d.generation < $2
            )
            SELECT
                enslaved_id,
                full_name,
                birth_year,
                death_year,
                generation,
                CASE
                    -- Known to be deceased
                    WHEN death_year IS NOT NULL THEN false
                    -- Born too long ago to be alive
                    WHEN birth_year IS NOT NULL AND ($3 - birth_year) > $4 THEN false
                    -- No death date and born recently enough
                    WHEN birth_year IS NOT NULL AND ($3 - birth_year) <= $4 THEN true
                    -- Unknown - estimate by generation
                    ELSE (generation >= 5)
                END as likely_living
            FROM descendants
            ORDER BY generation, birth_year DESC NULLS LAST
        `, [ancestorId, this.MAX_GENERATIONS, currentYear, maxAge]);

        const all = result.rows || [];
        const living = all.filter(d => d.likely_living);

        return {
            total: all.length,
            estimatedLiving: living.length,
            deceased: all.length - living.length,
            livingDescendants: living,
            methodology: 'Estimated based on birth/death dates and maximum human lifespan of 120 years'
        };
    }

    /**
     * Calculate reparations distribution across all descendants
     * @param {string} ancestorId - Enslaved person ID
     * @param {number} totalAmount - Total reparations amount
     * @param {object} options - Distribution options
     * @returns {Promise<Array>} Distribution per descendant
     */
    async distributeReparations(ancestorId, totalAmount, options = {}) {
        console.log(`Distributing $${totalAmount} reparations for: ${ancestorId}`);

        // Default generation multipliers (earlier generations get more)
        const generationMultipliers = options.generationMultipliers || {
            1: 1.0,   // Children
            2: 0.75,  // Grandchildren
            3: 0.5,   // Great-grandchildren
            4: 0.35,  // Great-great-grandchildren
            5: 0.25,  // 5th generation
            6: 0.20,  // 6th generation
            7: 0.15,  // 7th+ generation
        };

        // Get living descendants
        const livingData = await this.estimateLivingDescendants(ancestorId);
        const livingDescendants = livingData.livingDescendants;

        if (livingDescendants.length === 0) {
            console.log('No living descendants found');
            return {
                totalAmount,
                distributedAmount: 0,
                undistributedAmount: totalAmount,
                distributions: []
            };
        }

        // Calculate weighted shares
        let totalWeightedShares = 0;
        const descendantsWithWeights = livingDescendants.map(d => {
            const generation = d.generation;
            const multiplier = generationMultipliers[generation] || generationMultipliers[7] || 0.15;
            const weight = 1.0 * multiplier;
            totalWeightedShares += weight;

            return {
                ...d,
                weight,
                multiplier
            };
        });

        // Calculate individual amounts
        const distributions = descendantsWithWeights.map(d => {
            const share = d.weight / totalWeightedShares;
            const amount = Math.floor(totalAmount * share * 100) / 100; // Round to cents

            return {
                descendantId: d.enslaved_id,
                fullName: d.full_name,
                generation: d.generation,
                multiplier: d.multiplier,
                weight: d.weight,
                sharePercentage: (share * 100).toFixed(4),
                amount: amount
            };
        });

        // Calculate totals
        const distributedAmount = distributions.reduce((sum, d) => sum + d.amount, 0);
        const undistributedAmount = totalAmount - distributedAmount;

        console.log(`✓ Distributed $${distributedAmount.toFixed(2)} among ${distributions.length} living descendants`);

        return {
            ancestorId,
            totalAmount,
            distributedAmount,
            undistributedAmount,
            recipientCount: distributions.length,
            distributions: distributions.sort((a, b) => b.amount - a.amount) // Sort by amount descending
        };
    }

    /**
     * Find relationship path between two people
     * @param {string} personId1 - First person ID
     * @param {string} personId2 - Second person ID
     * @returns {Promise<Object>} Relationship path and description
     */
    async findRelationshipPath(personId1, personId2) {
        // Use bidirectional BFS to find shortest path
        const result = await this.db.query(`
            WITH RECURSIVE
            -- Forward search from person1
            forward AS (
                SELECT
                    $1 as start_id,
                    $1 as current_id,
                    ARRAY[$1] as path,
                    0 as distance

                UNION ALL

                SELECT
                    f.start_id,
                    er.enslaved_id_2,
                    f.path || er.enslaved_id_2,
                    f.distance + 1
                FROM forward f
                JOIN enslaved_relationships er ON er.enslaved_id_1 = f.current_id
                WHERE er.enslaved_id_2 <> ALL(f.path)
                  AND f.distance < 10
            ),
            -- Backward search from person2
            backward AS (
                SELECT
                    $2 as start_id,
                    $2 as current_id,
                    ARRAY[$2] as path,
                    0 as distance

                UNION ALL

                SELECT
                    b.start_id,
                    er.enslaved_id_1,
                    b.path || er.enslaved_id_1,
                    b.distance + 1
                FROM backward b
                JOIN enslaved_relationships er ON er.enslaved_id_2 = b.current_id
                WHERE er.enslaved_id_1 <> ALL(b.path)
                  AND b.distance < 10
            )
            -- Find intersection
            SELECT
                f.path as forward_path,
                b.path as backward_path,
                f.distance + b.distance as total_distance
            FROM forward f
            JOIN backward b ON f.current_id = b.current_id
            ORDER BY total_distance
            LIMIT 1
        `, [personId1, personId2]);

        if (!result.rows || result.rows.length === 0) {
            return {
                found: false,
                message: 'No relationship path found within 10 generations'
            };
        }

        const row = result.rows[0];
        const fullPath = [...row.forward_path.slice(0, -1), ...row.backward_path.reverse()];

        // Get names for all people in path
        const pathWithNames = await this.getPathNames(fullPath);

        return {
            found: true,
            distance: row.total_distance,
            path: pathWithNames,
            description: this.describeRelationship(pathWithNames)
        };
    }

    /**
     * Get names for people in a path
     * @private
     */
    async getPathNames(personIds) {
        if (personIds.length === 0) return [];

        const placeholders = personIds.map((_, i) => `$${i + 1}`).join(',');
        const result = await this.db.query(
            `SELECT enslaved_id, full_name, birth_year, death_year
             FROM enslaved_individuals
             WHERE enslaved_id IN (${placeholders})`,
            personIds
        );

        const nameMap = {};
        result.rows.forEach(row => {
            nameMap[row.enslaved_id] = row;
        });

        return personIds.map(id => nameMap[id] || { enslaved_id: id, full_name: 'Unknown' });
    }

    /**
     * Describe relationship in human-readable form
     * @private
     */
    describeRelationship(path) {
        if (path.length <= 1) {
            return 'Same person';
        }

        if (path.length === 2) {
            return `${path[1].full_name} is the child of ${path[0].full_name}`;
        }

        const distance = path.length - 1;
        const generations = [
            'parent', 'grandparent', 'great-grandparent',
            '2nd great-grandparent', '3rd great-grandparent',
            '4th great-grandparent', '5th great-grandparent'
        ];

        if (distance <= generations.length) {
            return `${path[path.length - 1].full_name} is the ${distance}x-${generations[distance - 1]} of ${path[0].full_name}`;
        }

        return `${path[path.length - 1].full_name} is ${distance} generations descended from ${path[0].full_name}`;
    }

    /**
     * Clear cache (call after database updates)
     */
    clearCache() {
        this.cache.clear();
    }
}

module.exports = DescendantTreeBuilder;
