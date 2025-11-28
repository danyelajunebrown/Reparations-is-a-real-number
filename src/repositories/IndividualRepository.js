/**
 * Individual Repository
 *
 * Handles all database operations for the individuals table (verified genealogical records).
 */

const BaseRepository = require('./BaseRepository');

class IndividualRepository extends BaseRepository {
  constructor() {
    super('individuals', 'id');
  }

  /**
   * Find individuals linked to a document
   * @param {string} documentId - Document ID
   * @returns {Promise<Array>} Individuals
   */
  async findByDocument(documentId) {
    const query = `
      SELECT i.*, di.relationship, di.confidence_score
      FROM ${this.tableName} i
      JOIN document_individuals di ON i.id = di.individual_id
      WHERE di.document_id = $1
      ORDER BY i.full_name ASC
    `;
    return this.raw(query, [documentId]);
  }

  /**
   * Search individuals by name
   * @param {string} searchTerm - Name to search for
   * @returns {Promise<Array>} Matching individuals
   */
  async searchByName(searchTerm) {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE full_name ILIKE $1
      ORDER BY full_name ASC
    `;
    return this.raw(query, [`%${searchTerm}%`]);
  }

  /**
   * Link individual to document
   * @param {number} individualId - Individual ID
   * @param {string} documentId - Document ID
   * @param {Object} metadata - Link metadata
   * @returns {Promise<Object>} Link record
   */
  async linkToDocument(individualId, documentId, metadata = {}) {
    const query = `
      INSERT INTO document_individuals (
        document_id, individual_id, relationship, confidence_score, notes
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await this.raw(query, [
      documentId,
      individualId,
      metadata.relationship || null,
      metadata.confidenceScore || 100,
      metadata.notes || null
    ]);
    return result[0];
  }

  /**
   * Save individual with document link
   * @param {Object} individualData - Individual data
   * @param {string} documentId - Document ID
   * @returns {Promise<Object>} Created individual
   */
  async saveWithDocument(individualData, documentId) {
    return this.transaction(async (client) => {
      // Create individual
      const individual = await client.query(`
        INSERT INTO individuals (
          full_name, birth_year, death_year, gender, locations,
          spouses, children, parents, notes, source_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [
        individualData.fullName,
        individualData.birthYear || null,
        individualData.deathYear || null,
        individualData.gender || null,
        individualData.locations || null,
        individualData.spouses || null,
        individualData.children || null,
        individualData.parents || null,
        individualData.notes || null,
        individualData.sourceType || 'document'
      ]);

      const individualId = individual.rows[0].id;

      // Link to document
      await client.query(`
        INSERT INTO document_individuals (
          document_id, individual_id, relationship, confidence_score
        ) VALUES ($1, $2, $3, $4)
      `, [
        documentId,
        individualId,
        individualData.relationship || null,
        individualData.confidenceScore || 100
      ]);

      return individual.rows[0];
    });
  }

  /**
   * Get individuals by location
   * @param {string} location - Location to search
   * @returns {Promise<Array>} Individuals
   */
  async findByLocation(location) {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE locations @> $1::jsonb
      ORDER BY full_name ASC
    `;
    return this.raw(query, [JSON.stringify([location])]);
  }

  /**
   * Get statistics for individuals
   * @returns {Promise<Object>} Statistics
   */
  async getStatistics() {
    const query = `
      SELECT
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE gender = 'M') as male_count,
        COUNT(*) FILTER (WHERE gender = 'F') as female_count,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL) as with_birth_year,
        COUNT(*) FILTER (WHERE death_year IS NOT NULL) as with_death_year,
        AVG(death_year - birth_year) FILTER (WHERE birth_year IS NOT NULL AND death_year IS NOT NULL) as avg_lifespan,
        COUNT(DISTINCT source_type) as source_types
      FROM ${this.tableName}
    `;
    const result = await this.raw(query);
    return result[0];
  }
}

module.exports = new IndividualRepository();
