/**
 * Enslaved People Repository
 *
 * Handles all database operations for the enslaved_people table.
 */

const BaseRepository = require('./BaseRepository');

class EnslavedRepository extends BaseRepository {
  constructor() {
    super('enslaved_people', 'id');
  }

  /**
   * Find all enslaved people for a document
   * @param {string} documentId - Document ID
   * @returns {Promise<Array>} Enslaved people
   */
  async findByDocument(documentId) {
    return this.findAll(
      { document_id: documentId },
      { orderBy: 'name ASC' }
    );
  }

  /**
   * Search enslaved people by name
   * @param {string} searchTerm - Name to search for
   * @returns {Promise<Array>} Matching records
   */
  async searchByName(searchTerm) {
    const query = `
      SELECT ep.*, d.owner_name, d.doc_type, d.owner_location
      FROM ${this.tableName} ep
      JOIN documents d ON ep.document_id = d.document_id
      WHERE ep.name ILIKE $1
      ORDER BY ep.name ASC
    `;
    return this.raw(query, [`%${searchTerm}%`]);
  }

  /**
   * Find enslaved people by owner
   * @param {string} ownerName - Slave owner's name
   * @returns {Promise<Array>} Enslaved people
   */
  async findByOwner(ownerName) {
    const query = `
      SELECT ep.*, d.owner_name, d.doc_type
      FROM ${this.tableName} ep
      JOIN documents d ON ep.document_id = d.document_id
      WHERE d.owner_name = $1
      ORDER BY ep.name ASC
    `;
    return this.raw(query, [ownerName]);
  }

  /**
   * Get total count by owner
   * @param {string} ownerName - Slave owner's name
   * @returns {Promise<number>} Count
   */
  async countByOwner(ownerName) {
    const query = `
      SELECT COUNT(*) as count
      FROM ${this.tableName} ep
      JOIN documents d ON ep.document_id = d.document_id
      WHERE d.owner_name = $1
    `;
    const result = await this.raw(query, [ownerName]);
    return parseInt(result[0].count, 10);
  }

  /**
   * Get family relationships for a person
   * @param {number} personId - Person ID
   * @returns {Promise<Object>} Family relationships
   */
  async getFamilyRelationships(personId) {
    const query = `
      SELECT
        ep.*,
        f.id as family_id,
        f.parent1,
        f.parent2,
        array_agg(fc.child_name) FILTER (WHERE fc.child_name IS NOT NULL) as children
      FROM ${this.tableName} ep
      LEFT JOIN families f ON ep.document_id = f.document_id
        AND (ep.name = f.parent1 OR ep.name = f.parent2)
      LEFT JOIN family_children fc ON f.id = fc.family_id
      WHERE ep.id = $1
      GROUP BY ep.id, f.id, f.parent1, f.parent2
    `;
    const result = await this.raw(query, [personId]);
    return result[0] || null;
  }

  /**
   * Get statistics for enslaved people
   * @returns {Promise<Object>} Statistics
   */
  async getStatistics() {
    const query = `
      SELECT
        COUNT(*) as total_count,
        COUNT(DISTINCT name) as unique_names,
        COUNT(*) FILTER (WHERE gender = 'M') as male_count,
        COUNT(*) FILTER (WHERE gender = 'F') as female_count,
        COUNT(*) FILTER (WHERE age IS NOT NULL) as with_age,
        AVG(age) FILTER (WHERE age IS NOT NULL) as avg_age,
        COUNT(*) FILTER (WHERE family_relationship IS NOT NULL) as with_family,
        SUM(individual_reparations) as total_reparations
      FROM ${this.tableName}
    `;
    const result = await this.raw(query);
    return result[0];
  }
}

module.exports = new EnslavedRepository();
