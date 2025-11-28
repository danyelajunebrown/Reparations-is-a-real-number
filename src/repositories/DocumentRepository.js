/**
 * Document Repository
 *
 * Handles all database operations for the documents table.
 */

const BaseRepository = require('./BaseRepository');
const db = require('../database/connection');

class DocumentRepository extends BaseRepository {
  constructor() {
    super('documents', 'document_id');
  }

  /**
   * Find documents by owner name
   * @param {string} ownerName - Owner name
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Documents
   */
  async findByOwner(ownerName, options = {}) {
    return this.findAll(
      { owner_name: ownerName },
      { orderBy: 'created_at DESC', ...options }
    );
  }

  /**
   * Find documents by type
   * @param {string} docType - Document type (will, deed, etc.)
   * @returns {Promise<Array>} Documents
   */
  async findByType(docType) {
    return this.findAll(
      { doc_type: docType },
      { orderBy: 'created_at DESC' }
    );
  }

  /**
   * Search documents by owner name pattern
   * @param {string} searchTerm - Search term
   * @returns {Promise<Array>} Matching documents
   */
  async searchByOwnerName(searchTerm) {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE owner_name ILIKE $1
      ORDER BY created_at DESC
    `;
    return this.raw(query, [`%${searchTerm}%`]);
  }

  /**
   * Get document with enslaved people and reparations breakdown
   * @param {string} documentId - Document ID
   * @returns {Promise<Object|null>} Document with relations
   */
  async findByIdWithRelations(documentId) {
    const query = `
      SELECT
        d.*,
        json_agg(DISTINCT jsonb_build_object(
          'id', ep.id,
          'name', ep.name,
          'gender', ep.gender,
          'age', ep.age,
          'individualReparations', ep.individual_reparations
        )) FILTER (WHERE ep.id IS NOT NULL) as enslaved_people,
        json_agg(DISTINCT jsonb_build_object(
          'id', rb.id,
          'wageTheft', rb.wage_theft,
          'damages', rb.damages,
          'profitShare', rb.profit_share,
          'compoundInterest', rb.compound_interest,
          'penalty', rb.penalty
        )) FILTER (WHERE rb.id IS NOT NULL) as reparations_breakdown
      FROM documents d
      LEFT JOIN enslaved_people ep ON d.document_id = ep.document_id
      LEFT JOIN reparations_breakdown rb ON d.document_id = rb.document_id
      WHERE d.document_id = $1
      GROUP BY d.document_id
    `;

    const result = await this.raw(query, [documentId]);
    return result[0] || null;
  }

  /**
   * Get owner summary statistics
   * @param {string} ownerName - Owner name
   * @returns {Promise<Object>} Owner statistics
   */
  async getOwnerSummary(ownerName) {
    const query = `
      SELECT
        owner_name,
        COUNT(*) as document_count,
        SUM(total_enslaved) as total_enslaved,
        SUM(total_reparations) as total_reparations,
        AVG(ocr_confidence) as avg_ocr_confidence,
        MIN(owner_birth_year) as birth_year,
        MAX(owner_death_year) as death_year,
        array_agg(DISTINCT owner_location) FILTER (WHERE owner_location IS NOT NULL) as locations
      FROM documents
      WHERE owner_name = $1
      GROUP BY owner_name
    `;

    const result = await this.raw(query, [ownerName]);
    return result[0] || null;
  }

  /**
   * Get documents ready for blockchain submission
   * @returns {Promise<Array>} Verified documents
   */
  async getBlockchainQueue() {
    const query = `SELECT * FROM blockchain_queue ORDER BY created_at ASC`;
    return this.raw(query);
  }

  /**
   * Get documents pending verification
   * @returns {Promise<Array>} Unverified documents
   */
  async getVerificationQueue() {
    const query = `SELECT * FROM verification_queue ORDER BY created_at ASC`;
    return this.raw(query);
  }

  /**
   * Save complete document metadata with relations
   * @param {Object} metadata - Complete document metadata
   * @returns {Promise<Object>} Created document
   */
  async saveWithRelations(metadata) {
    return this.transaction(async (client) => {
      // Insert document
      const docResult = await client.query(`
        INSERT INTO documents (
          document_id, owner_name, owner_birth_year, owner_death_year,
          owner_location, doc_type, filename, file_path, relative_path,
          file_size, mime_type, ipfs_hash, sha256_hash, ipfs_gateway_url,
          ocr_text, ocr_confidence, ocr_page_count, ocr_service,
          total_enslaved, named_enslaved, total_reparations,
          per_person_reparations, estimated_years,
          verification_confidence, uploaded_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25
        )
        RETURNING *
      `, [
        metadata.documentId,
        metadata.ownerName || metadata.owner,
        metadata.ownerBirthYear || metadata.birthYear || null,
        metadata.ownerDeathYear || metadata.deathYear || null,
        metadata.ownerLocation || metadata.location || null,
        metadata.storage?.documentType || 'unknown',
        metadata.storage?.filename,
        metadata.storage?.filePath,
        metadata.storage?.relativePath,
        metadata.storage?.fileSize,
        metadata.storage?.mimeType,
        metadata.ipfs?.ipfsHash || '',
        metadata.ipfs?.sha256,
        metadata.ipfs?.ipfsGatewayUrl,
        metadata.ocr?.text,
        metadata.ocr?.confidence,
        metadata.ocr?.pageCount,
        metadata.ocr?.ocrService,
        metadata.enslaved?.totalCount || 0,
        metadata.enslaved?.namedIndividuals || 0,
        metadata.reparations?.total || 0,
        metadata.reparations?.perPerson || 0,
        metadata.reparations?.estimatedYears || 0,
        metadata.blockchain?.verificationLevel,
        metadata.uploadedBy || 'system'
      ]);

      // Insert enslaved people
      if (metadata.enslaved?.people) {
        for (const person of metadata.enslaved.people) {
          await client.query(`
            INSERT INTO enslaved_people (
              document_id, name, gender, age, source,
              family_relationship, spouse, parent, bequeathed_to,
              notes, individual_reparations
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `, [
            metadata.documentId,
            person.name,
            person.gender || null,
            person.age || null,
            person.source || null,
            person.familyRelationship || null,
            person.spouse || null,
            person.parent || null,
            person.bequeathedTo || null,
            person.notes || null,
            person.individualReparations || 0
          ]);
        }
      }

      // Insert families
      if (metadata.enslaved?.families) {
        for (const family of metadata.enslaved.families) {
          const familyResult = await client.query(`
            INSERT INTO families (document_id, parent1, parent2)
            VALUES ($1, $2, $3)
            RETURNING id
          `, [
            metadata.documentId,
            family.parents[0] || null,
            family.parents[1] || null
          ]);

          const familyId = familyResult.rows[0].id;

          if (family.children) {
            for (const child of family.children) {
              await client.query(`
                INSERT INTO family_children (family_id, child_name)
                VALUES ($1, $2)
              `, [familyId, child]);
            }
          }
        }
      }

      // Insert reparations breakdown
      if (metadata.reparations?.breakdown) {
        const b = metadata.reparations.breakdown;
        await client.query(`
          INSERT INTO reparations_breakdown (
            document_id, wage_theft, damages, profit_share,
            compound_interest, penalty
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          metadata.documentId,
          b.wageTheft || 0,
          b.damages || 0,
          b.profitShare || 0,
          b.compoundInterest || 0,
          b.penalty || 0
        ]);
      }

      return docResult.rows[0];
    });
  }
}

module.exports = new DocumentRepository();
