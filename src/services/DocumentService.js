/**
 * Document Service
 *
 * Business logic for document processing, upload, and retrieval.
 */

const DocumentRepository = require('../repositories/DocumentRepository');
const EnslavedRepository = require('../repositories/EnslavedRepository');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class DocumentService {
  /**
   * Process and save a document with all metadata
   * @param {Object} file - Uploaded file object
   * @param {Object} metadata - Document metadata
   * @param {Object} processingResults - OCR and extraction results
   * @returns {Promise<Object>} Saved document
   */
  async processDocument(file, metadata, processingResults) {
    try {
      const documentId = uuidv4();

      // Build complete metadata object
      const completeMetadata = {
        documentId,
        ownerName: metadata.ownerName,
        ownerBirthYear: metadata.birthYear,
        ownerDeathYear: metadata.deathYear,
        ownerLocation: metadata.location,
        uploadedBy: metadata.uploadedBy || 'system',
        storage: {
          documentType: metadata.documentType,
          filename: file.originalname,
          filePath: processingResults.storage?.filePath,
          relativePath: processingResults.storage?.relativePath,
          fileSize: file.size,
          mimeType: file.mimetype
        },
        ipfs: {
          ipfsHash: processingResults.ipfs?.ipfsHash || '',
          sha256: processingResults.ipfs?.sha256,
          ipfsGatewayUrl: processingResults.ipfs?.ipfsGatewayUrl
        },
        ocr: {
          text: processingResults.ocr?.text,
          confidence: processingResults.ocr?.confidence,
          pageCount: processingResults.ocr?.pageCount,
          ocrService: processingResults.ocr?.service
        },
        enslaved: {
          totalCount: processingResults.enslaved?.totalCount || 0,
          namedIndividuals: processingResults.enslaved?.namedIndividuals || 0,
          people: processingResults.enslaved?.people || [],
          families: processingResults.enslaved?.families || []
        },
        reparations: {
          total: processingResults.reparations?.total || 0,
          perPerson: processingResults.reparations?.perPerson || 0,
          estimatedYears: processingResults.reparations?.estimatedYears || 0,
          breakdown: processingResults.reparations?.breakdown
        },
        blockchain: {
          verificationLevel: processingResults.verificationConfidence || 'pending'
        }
      };

      // Save document with all relations
      const savedDocument = await DocumentRepository.saveWithRelations(completeMetadata);

      logger.operation('Document processed and saved', {
        documentId,
        ownerName: metadata.ownerName,
        enslavedCount: processingResults.enslaved?.totalCount || 0
      });

      return {
        success: true,
        documentId,
        document: savedDocument
      };
    } catch (error) {
      logger.error('Failed to process document', {
        error: error.message,
        stack: error.stack,
        metadata
      });
      throw error;
    }
  }

  /**
   * Get document by ID with all relations
   * @param {string} documentId - Document ID
   * @returns {Promise<Object|null>} Document with relations
   */
  async getDocumentById(documentId) {
    // Try the primary documents table first
    const doc = await DocumentRepository.findByIdWithRelations(documentId);
    if (doc) return doc;

    // Fall back to person_documents (DC compensated emancipation petitions, etc.)
    // These are primary-source image rows linked to canonical_persons.
    try {
      const { pool } = require('../database/connection');
      const result = await pool.query(`
        SELECT
          id::text        AS document_id,
          s3_key          AS file_path,
          s3_key,
          name_as_appears AS owner_name,
          document_type   AS doc_type,
          page_reference  AS filename,
          COALESCE(collection_name || ' — ' || page_reference, page_reference) AS title,
          source_url,
          ocr_text,
          document_date,
          document_year,
          'person_documents' AS table_source
        FROM person_documents
        WHERE id = $1
      `, [parseInt(documentId, 10)]);
      if (result.rows.length > 0) return result.rows[0];
    } catch (e) {
      // person_documents fallback failed — return null gracefully
    }
    return null;
  }

  /**
   * Search documents by owner name
   * @param {string} ownerName - Owner name to search
   * @returns {Promise<Array>} Matching documents
   */
  async searchByOwner(ownerName) {
    return DocumentRepository.searchByOwnerName(ownerName);
  }

  /**
   * Get owner summary with statistics
   * @param {string} ownerName - Owner name
   * @returns {Promise<Object|null>} Owner summary
   */
  async getOwnerSummary(ownerName) {
    const summary = await DocumentRepository.getOwnerSummary(ownerName);
    if (!summary) return null;

    // Enhance with enslaved people details
    const enslavedPeople = await EnslavedRepository.findByOwner(ownerName);

    return {
      ...summary,
      enslavedPeople: enslavedPeople.map(person => ({
        name: person.name,
        age: person.age,
        gender: person.gender,
        documentType: person.doc_type
      }))
    };
  }

  /**
   * Get documents by type
   * @param {string} docType - Document type
   * @returns {Promise<Array>} Documents
   */
  async getDocumentsByType(docType) {
    return DocumentRepository.findByType(docType);
  }

  /**
   * Get verification queue
   * @returns {Promise<Array>} Documents pending verification
   */
  async getVerificationQueue() {
    return DocumentRepository.getVerificationQueue();
  }

  /**
   * Get blockchain submission queue
   * @returns {Promise<Array>} Verified documents ready for blockchain
   */
  async getBlockchainQueue() {
    return DocumentRepository.getBlockchainQueue();
  }

  /**
   * Search documents with advanced filters
   * @param {Object} filters - Search filters
   * @returns {Promise<Array>} Matching documents
   */
  async advancedSearch(filters) {
    const {
      ownerName,
      location,
      docType,
      yearFrom,
      yearTo,
      minReparations,
      minEnslaved
    } = filters;

    let query = `
      SELECT
        d.*,
        COUNT(DISTINCT ep.id) as enslaved_count,
        array_agg(DISTINCT ep.name) FILTER (WHERE ep.name IS NOT NULL) as enslaved_names
      FROM documents d
      LEFT JOIN enslaved_people ep ON d.document_id = ep.document_id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (ownerName) {
      query += ` AND d.owner_name ILIKE $${paramIndex}`;
      params.push(`%${ownerName}%`);
      paramIndex++;
    }

    if (location) {
      query += ` AND d.owner_location ILIKE $${paramIndex}`;
      params.push(`%${location}%`);
      paramIndex++;
    }

    if (docType) {
      query += ` AND d.doc_type = $${paramIndex}`;
      params.push(docType);
      paramIndex++;
    }

    if (yearFrom) {
      query += ` AND d.owner_birth_year >= $${paramIndex}`;
      params.push(yearFrom);
      paramIndex++;
    }

    if (yearTo) {
      query += ` AND d.owner_death_year <= $${paramIndex}`;
      params.push(yearTo);
      paramIndex++;
    }

    query += ` GROUP BY d.document_id`;

    if (minReparations) {
      query += ` HAVING d.total_reparations >= $${paramIndex}`;
      params.push(minReparations);
      paramIndex++;
    }

    if (minEnslaved) {
      query += ` HAVING COUNT(DISTINCT ep.id) >= $${paramIndex}`;
      params.push(minEnslaved);
      paramIndex++;
    }

    query += ` ORDER BY d.created_at DESC LIMIT 100`;

    return DocumentRepository.raw(query, params);
  }

  /**
   * Update document metadata
   * @param {string} documentId - Document ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object|null>} Updated document
   */
  async updateDocument(documentId, updates) {
    const updated = await DocumentRepository.update(documentId, updates);

    if (updated) {
      logger.operation('Document updated', {
        documentId,
        fields: Object.keys(updates)
      });
    }

    return updated;
  }

  /**
   * Delete document and all relations
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} Success
   */
  async deleteDocument(documentId) {
    // Relations will be deleted by CASCADE constraints
    const deleted = await DocumentRepository.delete(documentId);

    if (deleted) {
      logger.operation('Document deleted', { documentId });
    }

    return deleted;
  }

  /**
   * Get global statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStatistics() {
    const query = `SELECT * FROM stats_dashboard`;
    const result = await DocumentRepository.raw(query);
    return result[0] || {};
  }
}

module.exports = new DocumentService();
