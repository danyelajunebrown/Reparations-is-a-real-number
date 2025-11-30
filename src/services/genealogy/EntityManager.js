/**
 * Individual Entity Manager
 * Manages slaveowner entities, relationships, and document associations
 */

const crypto = require('crypto');

class IndividualEntityManager {
    constructor(database) {
        this.db = database;
    }

    /**
     * Generate a unique individual ID
     * Format: IND_FIRSTNAME_LASTNAME_BIRTHYEAR or IND_HASH
     */
    generateIndividualId(fullName, birthYear = null) {
        const normalized = fullName.trim().toUpperCase().replace(/[^A-Z\s]/g, '');
        const parts = normalized.split(/\s+/);

        if (parts.length >= 2 && birthYear) {
            const firstName = parts[0].substring(0, 10);
            const lastName = parts[parts.length - 1].substring(0, 10);
            return `IND_${firstName}_${lastName}_${birthYear}`;
        } else if (parts.length >= 2) {
            const firstName = parts[0].substring(0, 10);
            const lastName = parts[parts.length - 1].substring(0, 10);
            const hash = crypto.createHash('md5').update(fullName).digest('hex').substring(0, 6);
            return `IND_${firstName}_${lastName}_${hash}`;
        } else {
            const hash = crypto.createHash('md5').update(fullName + Date.now()).digest('hex').substring(0, 12);
            return `IND_${hash}`;
        }
    }

    /**
     * Find or create an individual entity
     * Returns the individual_id
     */
    async findOrCreateIndividual(metadata) {
        const {
            fullName,
            birthYear,
            deathYear,
            gender,
            locations,
            spouses,
            parents,
            children,
            familysearchId,
            ancestryId,
            notes
        } = metadata;

        if (!fullName) {
            throw new Error('fullName is required to create an individual');
        }

        // Try to find existing individual
        let existing = null;

        // First try by exact name and birth year
        if (birthYear) {
            const result = await this.db.query(
                `SELECT individual_id FROM individuals
                 WHERE full_name ILIKE $1 AND birth_year = $2
                 LIMIT 1`,
                [fullName, birthYear]
            );
            if (result.rows && result.rows.length > 0) {
                existing = result.rows[0];
            }
        }

        // If not found, try by FamilySearch ID
        if (!existing && familysearchId) {
            const result = await this.db.query(
                `SELECT individual_id FROM individuals
                 WHERE familysearch_id = $1
                 LIMIT 1`,
                [familysearchId]
            );
            if (result.rows && result.rows.length > 0) {
                existing = result.rows[0];
            }
        }

        // If not found, try by name similarity
        if (!existing) {
            const result = await this.db.query(
                `SELECT individual_id FROM individuals
                 WHERE full_name ILIKE $1
                 LIMIT 1`,
                [fullName]
            );
            if (result.rows && result.rows.length > 0) {
                existing = result.rows[0];
            }
        }

        if (existing) {
            // Update existing individual with new information
            await this.updateIndividual(existing.individual_id, metadata);
            return existing.individual_id;
        } else {
            // Create new individual
            const individualId = this.generateIndividualId(fullName, birthYear);

            await this.db.query(
                `INSERT INTO individuals (
                    individual_id, full_name, birth_year, death_year, gender,
                    locations, spouse_ids, parent_ids, child_ids,
                    familysearch_id, ancestry_id, notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (individual_id) DO NOTHING`,
                [
                    individualId,
                    fullName,
                    birthYear || null,
                    deathYear || null,
                    gender || null,
                    Array.isArray(locations) ? locations.join(', ') : locations,
                    spouses || [],
                    parents || [],
                    children || [],
                    familysearchId || null,
                    ancestryId || null,
                    notes || null
                ]
            );

            return individualId;
        }
    }

    /**
     * Update an existing individual's metadata
     */
    async updateIndividual(individualId, metadata) {
        const updates = [];
        const values = [];
        let paramIndex = 1;

        const fields = {
            fullName: 'full_name',
            birthYear: 'birth_year',
            deathYear: 'death_year',
            gender: 'gender',
            locations: 'locations',
            familysearchId: 'familysearch_id',
            ancestryId: 'ancestry_id',
            notes: 'notes'
        };

        for (const [key, dbField] of Object.entries(fields)) {
            if (metadata[key] !== undefined && metadata[key] !== null) {
                updates.push(`${dbField} = $${paramIndex}`);
                values.push(metadata[key]);
                paramIndex++;
            }
        }

        if (updates.length === 0) {
            return; // Nothing to update
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(individualId);

        const query = `
            UPDATE individuals
            SET ${updates.join(', ')}
            WHERE individual_id = $${paramIndex}
        `;

        await this.db.query(query, values);
    }

    /**
     * Link an individual to a document
     */
    async linkIndividualToDocument(individualId, documentId, role, metadata = {}) {
        await this.db.query(
            `INSERT INTO document_individuals (
                document_id, individual_id, role_in_document,
                inherited_enslaved_count, inherited_reparations, notes
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (document_id, individual_id, role_in_document)
            DO UPDATE SET
                inherited_enslaved_count = COALESCE(EXCLUDED.inherited_enslaved_count, document_individuals.inherited_enslaved_count),
                inherited_reparations = COALESCE(EXCLUDED.inherited_reparations, document_individuals.inherited_reparations),
                notes = COALESCE(EXCLUDED.notes, document_individuals.notes)`,
            [
                documentId,
                individualId,
                role,
                metadata.inheritedEnslavedCount || null,
                metadata.inheritedReparations || null,
                metadata.notes || null
            ]
        );
    }

    /**
     * Create a relationship between two individuals
     */
    async createRelationship(individualId1, individualId2, relationshipType, metadata = {}) {
        const {
            isDirected = false,
            sourceDocumentId = null,
            sourceType = 'inference',
            confidence = 1.0,
            verified = false,
            notes = null
        } = metadata;

        await this.db.query(
            `INSERT INTO individual_relationships (
                individual_id_1, individual_id_2, relationship_type,
                is_directed, source_document_id, source_type,
                confidence, verified, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT DO NOTHING`,
            [
                individualId1,
                individualId2,
                relationshipType,
                isDirected,
                sourceDocumentId,
                sourceType,
                confidence,
                verified,
                notes
            ]
        );
    }

    /**
     * Add a relationship between two individuals (simpler wrapper for createRelationship)
     * Used by API endpoints for easier relationship creation
     */
    async addRelationship(individualId1, individualId2, relationshipType, sourceDocumentId = null, sourceType = 'manual') {
        return await this.createRelationship(individualId1, individualId2, relationshipType, {
            isDirected: relationshipType === 'parent-child', // parent-child is directed, spouse is not
            sourceDocumentId,
            sourceType,
            confidence: 1.0,
            verified: false
        });
    }

    /**
     * Extract related individuals from document OCR text
     * Looks for heir names, witnesses, neighbors, etc.
     */
    async extractRelatedIndividuals(ocrText, documentType, documentId) {
        const relatedIndividuals = [];

        if (documentType === 'will') {
            // Extract heirs from will text
            const heirPatterns = [
                /I (?:give|bequeath|leave) (?:to|unto) (?:my )?(?:son|daughter|wife|husband|brother|sister|nephew|niece|grandson|granddaughter|child|children)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
                /(?:son|daughter|wife|husband|brother|sister|nephew|niece)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
                /executor[s]?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi
            ];

            for (const pattern of heirPatterns) {
                const matches = [...ocrText.matchAll(pattern)];
                for (const match of matches) {
                    const name = match[1].trim();
                    if (name && name.length > 2 && !relatedIndividuals.find(r => r.name === name)) {
                        relatedIndividuals.push({
                            name,
                            role: 'heir',
                            confidence: 0.7,
                            sourceDocumentId: documentId
                        });
                    }
                }
            }
        }

        if (documentType === 'census') {
            // Extract neighbors from census (names on nearby lines)
            const namePattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Male|Female|White|Black)/gmi;
            const matches = [...ocrText.matchAll(namePattern)];

            for (const match of matches) {
                const name = match[1].trim();
                if (name && name.length > 2 && !relatedIndividuals.find(r => r.name === name)) {
                    relatedIndividuals.push({
                        name,
                        role: 'neighbor',
                        confidence: 0.6,
                        sourceDocumentId: documentId
                    });
                }
            }
        }

        return relatedIndividuals;
    }

    /**
     * Update individual statistics after document processing
     */
    async updateIndividualStats(individualId) {
        await this.db.query(
            `UPDATE individuals
             SET
                total_documents = (
                    SELECT COUNT(DISTINCT document_id)
                    FROM document_individuals
                    WHERE individual_id = $1
                ),
                total_enslaved = (
                    SELECT COALESCE(SUM(d.total_enslaved), 0)
                    FROM documents d
                    INNER JOIN document_individuals di ON d.document_id = di.document_id
                    WHERE di.individual_id = $1 AND di.role_in_document = 'owner'
                ),
                total_reparations = (
                    SELECT COALESCE(SUM(d.total_reparations), 0)
                    FROM documents d
                    INNER JOIN document_individuals di ON d.document_id = di.document_id
                    WHERE di.individual_id = $1 AND di.role_in_document = 'owner'
                ),
                updated_at = CURRENT_TIMESTAMP
             WHERE individual_id = $1`,
            [individualId]
        );
    }

    /**
     * Get individual by ID with all relationships
     */
    async getIndividual(individualId) {
        const individualResult = await this.db.query(
            `SELECT * FROM individuals WHERE individual_id = $1`,
            [individualId]
        );

        if (!individualResult.rows || individualResult.rows.length === 0) {
            return null;
        }

        const individual = individualResult.rows[0];

        // Get relationships
        const relationshipsResult = await this.db.query(
            `SELECT * FROM individual_relationships
             WHERE individual_id_1 = $1 OR individual_id_2 = $1`,
            [individualId]
        );

        individual.relationships = relationshipsResult.rows || [];

        // Get documents
        const documentsResult = await this.db.query(
            `SELECT d.*, di.role_in_document
             FROM documents d
             INNER JOIN document_individuals di ON d.document_id = di.document_id
             WHERE di.individual_id = $1`,
            [individualId]
        );

        individual.documents = documentsResult.rows || [];

        return individual;
    }

    /**
     * Find potential duplicate individuals for merging
     */
    async findPotentialDuplicates(individualId) {
        const individual = await this.getIndividual(individualId);
        if (!individual) return [];

        // Find by similar name and birth year within 5 years
        const result = await this.db.query(
            `SELECT individual_id, full_name, birth_year, death_year
             FROM individuals
             WHERE individual_id != $1
               AND full_name ILIKE $2
               AND (birth_year IS NULL OR $3 IS NULL OR ABS(birth_year - $3) <= 5)
             LIMIT 10`,
            [individualId, individual.full_name, individual.birth_year]
        );

        return result.rows || [];
    }
}

module.exports = IndividualEntityManager;
