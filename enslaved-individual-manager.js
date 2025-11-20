/**
 * Enslaved Individual Manager
 *
 * Manages enslaved_individuals table - creates records for enslaved people
 * when documents like tombstones are uploaded where they are the primary subject.
 *
 * This centers enslaved people as first-class entities with their own unique IDs,
 * genealogy tracking, and document linkage.
 */

const crypto = require('crypto');

class EnslavedIndividualManager {
  constructor(database) {
    this.db = database;
  }

  /**
   * Generate unique ID for enslaved individual
   */
  generateEnslavedId() {
    return 'enslaved_' + crypto.randomBytes(8).toString('hex');
  }

  /**
   * Find or create an enslaved individual record
   *
   * @param {object} personData - { fullName, birthYear, deathYear, spouseName, enslavedBy, location }
   * @returns {string} enslavedId
   */
  async findOrCreateEnslavedIndividual(personData) {
    const {
      fullName,
      birthYear,
      deathYear,
      gender,
      spouseName,
      enslavedBy, // owner name
      location,
      notes
    } = personData;

    if (!fullName) {
      throw new Error('Enslaved person name is required');
    }

    console.log(`Finding or creating enslaved individual: ${fullName}`);

    // Try to find existing record by name and approximate dates
    let existingPerson = null;

    if (birthYear && deathYear) {
      // Match by name and dates
      const result = await this.db.query(`
        SELECT enslaved_id FROM enslaved_individuals
        WHERE LOWER(full_name) = LOWER($1)
          AND (birth_year IS NULL OR birth_year = $2)
          AND (death_year IS NULL OR death_year = $3)
        LIMIT 1
      `, [fullName, birthYear, deathYear]);

      if (result.rows && result.rows.length > 0) {
        existingPerson = result.rows[0];
      }
    } else {
      // Match by name only (less precise)
      const result = await this.db.query(`
        SELECT enslaved_id FROM enslaved_individuals
        WHERE LOWER(full_name) = LOWER($1)
        LIMIT 1
      `, [fullName]);

      if (result.rows && result.rows.length > 0) {
        existingPerson = result.rows[0];
      }
    }

    if (existingPerson) {
      console.log(`✓ Found existing enslaved individual: ${existingPerson.enslaved_id}`);

      // Update with any new information
      await this.updateEnslavedIndividual(existingPerson.enslaved_id, personData);

      return existingPerson.enslaved_id;
    }

    // Create new record
    const enslavedId = this.generateEnslavedId();

    // Find owner individual_id if enslaved_by is provided
    let enslavedByIndividualId = null;
    if (enslavedBy) {
      try {
        const ownerResult = await this.db.query(`
          SELECT individual_id FROM individuals
          WHERE LOWER(full_name) = LOWER($1)
          LIMIT 1
        `, [enslavedBy]);

        if (ownerResult.rows && ownerResult.rows.length > 0) {
          enslavedByIndividualId = ownerResult.rows[0].individual_id;
          console.log(`✓ Linked to owner: ${enslavedBy} (${enslavedByIndividualId})`);
        }
      } catch (error) {
        console.warn(`Could not link to owner ${enslavedBy}:`, error.message);
      }
    }

    await this.db.query(`
      INSERT INTO enslaved_individuals (
        enslaved_id,
        full_name,
        birth_year,
        death_year,
        gender,
        spouse_name,
        enslaved_by_individual_id,
        notes,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      enslavedId,
      fullName,
      birthYear || null,
      deathYear || null,
      gender || null,
      spouseName || null,
      enslavedByIndividualId,
      notes || null
    ]);

    console.log(`✓ Created enslaved individual: ${enslavedId} (${fullName})`);

    return enslavedId;
  }

  /**
   * Update existing enslaved individual with new information
   */
  async updateEnslavedIndividual(enslavedId, personData) {
    const {
      birthYear,
      deathYear,
      gender,
      spouseName,
      enslavedBy,
      notes
    } = personData;

    // Build update query dynamically for fields that are provided
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (birthYear) {
      updates.push(`birth_year = $${paramCount++}`);
      values.push(birthYear);
    }

    if (deathYear) {
      updates.push(`death_year = $${paramCount++}`);
      values.push(deathYear);
    }

    if (gender) {
      updates.push(`gender = $${paramCount++}`);
      values.push(gender);
    }

    if (spouseName) {
      updates.push(`spouse_name = $${paramCount++}`);
      values.push(spouseName);
    }

    if (notes) {
      updates.push(`notes = COALESCE(notes || E'\\n\\n', '') || $${paramCount++}`);
      values.push(notes);
    }

    // Find owner if provided
    if (enslavedBy) {
      try {
        const ownerResult = await this.db.query(`
          SELECT individual_id FROM individuals
          WHERE LOWER(full_name) = LOWER($1)
          LIMIT 1
        `, [enslavedBy]);

        if (ownerResult.rows && ownerResult.rows.length > 0) {
          updates.push(`enslaved_by_individual_id = $${paramCount++}`);
          values.push(ownerResult.rows[0].individual_id);
        }
      } catch (error) {
        console.warn(`Could not update owner link:`, error.message);
      }
    }

    if (updates.length > 0) {
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(enslavedId);

      const query = `
        UPDATE enslaved_individuals
        SET ${updates.join(', ')}
        WHERE enslaved_id = $${paramCount}
      `;

      await this.db.query(query, values);
      console.log(`✓ Updated enslaved individual: ${enslavedId}`);
    }
  }

  /**
   * Link enslaved individual to a document
   */
  async linkToDocument(enslavedId, documentId) {
    await this.db.query(`
      UPDATE documents
      SET enslaved_individual_id = $1,
          primary_subject_type = 'enslaved'
      WHERE document_id = $2
    `, [enslavedId, documentId]);

    console.log(`✓ Linked document ${documentId} to enslaved individual ${enslavedId}`);
  }

  /**
   * Get enslaved individual by ID
   */
  async getById(enslavedId) {
    const result = await this.db.query(`
      SELECT * FROM enslaved_individuals
      WHERE enslaved_id = $1
    `, [enslavedId]);

    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get all documents for an enslaved individual
   */
  async getDocuments(enslavedId) {
    const result = await this.db.query(`
      SELECT d.*
      FROM documents d
      WHERE d.enslaved_individual_id = $1
      ORDER BY d.created_at DESC
    `, [enslavedId]);

    return result.rows || [];
  }

  /**
   * Get enslaved individuals by owner
   */
  async getByOwner(ownerIndividualId) {
    const result = await this.db.query(`
      SELECT * FROM enslaved_individuals
      WHERE enslaved_by_individual_id = $1
      ORDER BY full_name
    `, [ownerIndividualId]);

    return result.rows || [];
  }

  /**
   * Add alternative name spelling
   */
  async addAlternativeName(enslavedId, alternativeName) {
    await this.db.query(`
      UPDATE enslaved_individuals
      SET alternative_names = array_append(COALESCE(alternative_names, '{}'), $1),
          updated_at = CURRENT_TIMESTAMP
      WHERE enslaved_id = $2
    `, [alternativeName, enslavedId]);

    console.log(`✓ Added alternative name "${alternativeName}" for ${enslavedId}`);
  }

  /**
   * Set middle name
   */
  async setMiddleName(enslavedId, middleName) {
    await this.db.query(`
      UPDATE enslaved_individuals
      SET middle_name = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE enslaved_id = $2
    `, [middleName, enslavedId]);

    console.log(`✓ Set middle name "${middleName}" for ${enslavedId}`);
  }

  /**
   * Set FamilySearch ID
   */
  async setFamilySearchId(enslavedId, familysearchId) {
    await this.db.query(`
      UPDATE enslaved_individuals
      SET familysearch_id = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE enslaved_id = $2
    `, [familysearchId, enslavedId]);

    console.log(`✓ Set FamilySearch ID "${familysearchId}" for ${enslavedId}`);
  }

  /**
   * Add child name (as text)
   */
  async addChildName(enslavedId, childName) {
    await this.db.query(`
      UPDATE enslaved_individuals
      SET child_names = array_append(COALESCE(child_names, '{}'), $1),
          updated_at = CURRENT_TIMESTAMP
      WHERE enslaved_id = $2
    `, [childName, enslavedId]);

    console.log(`✓ Added child "${childName}" for ${enslavedId}`);
  }

  /**
   * Flexible metadata update
   * Supports any field with proper validation
   */
  async updateMetadata(enslavedId, updates) {
    const allowedFields = [
      'middle_name', 'birth_year', 'death_year', 'gender',
      'spouse_name', 'freedom_year', 'familysearch_id',
      'ancestry_id', 'notes'
    ];

    const updateClauses = [];
    const values = [];
    let paramCount = 1;

    for (const [field, value] of Object.entries(updates)) {
      if (allowedFields.includes(field) && value !== undefined && value !== null) {
        // For notes, append instead of replace
        if (field === 'notes') {
          updateClauses.push(`notes = COALESCE(notes || E'\\n\\n', '') || $${paramCount++}`);
        } else {
          updateClauses.push(`${field} = $${paramCount++}`);
        }
        values.push(value);
      }
    }

    if (updateClauses.length > 0) {
      updateClauses.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(enslavedId);

      const query = `
        UPDATE enslaved_individuals
        SET ${updateClauses.join(', ')}
        WHERE enslaved_id = $${paramCount}
      `;

      await this.db.query(query, values);
      console.log(`✓ Updated metadata for ${enslavedId}:`, Object.keys(updates));
    }
  }

  /**
   * Search by name (including alternative names)
   */
  async searchByName(name) {
    const result = await this.db.query(`
      SELECT *
      FROM enslaved_individuals
      WHERE LOWER(full_name) LIKE LOWER($1)
         OR $1 = ANY(SELECT LOWER(unnest(alternative_names)))
      ORDER BY full_name
      LIMIT 10
    `, [`%${name}%`]);

    return result.rows || [];
  }
}

module.exports = EnslavedIndividualManager;
