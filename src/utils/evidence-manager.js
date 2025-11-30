/**
 * Adaptive Evidence Management System
 * Handles diverse evidence types: headstones, photos, webpages, documents, DNA, etc.
 * Builds lineage trees and tracks debt/credit relationships
 */

const pool = require('./database');
const crypto = require('crypto');
const StorageAdapter = require('../services/document/StorageAdapter');

class EvidenceManager {
  constructor(config = {}) {
    this.storageAdapter = new StorageAdapter(config);
    this.knownEvidenceTypes = new Set();
    this.loadKnownTypes();
  }

  /**
   * Load all evidence types that have been used
   * System learns what types of evidence exist
   */
  async loadKnownTypes() {
    try {
      const result = await pool.query(`
        SELECT DISTINCT evidence_type FROM evidence
        WHERE evidence_type IS NOT NULL
      `);
      result.rows.forEach(row => this.knownEvidenceTypes.add(row.evidence_type));
      console.log(`✓ Loaded ${this.knownEvidenceTypes.size} known evidence types`);
    } catch (error) {
      console.warn('Could not load evidence types:', error.message);
    }
  }

  /**
   * Add ANY type of evidence - system adapts to what you give it
   */
  async addEvidence(evidence) {
    const {
      // Core info
      evidenceType,        // "headstone", "webpage", "photo", "document", etc.
      title,               // "Adjua d'Wolf Headstone"
      description,         // What this evidence shows

      // Content (flexible - can have any combination)
      textContent,         // Transcribed text or webpage content
      imageUrl,            // URL to photo/scan
      sourceUrl,           // Original webpage URL
      filePath,            // Local file path

      // Who/What/Where/When
      subjectPersonId,     // Who is this evidence about?
      subjectPersonName,   // Name if person not in system yet
      relatedPersons,      // Array of {personId, relationship, role}

      // Provenance
      location,            // Where found (cemetery, archive, website)
      date,                // When evidence was created (headstone date, document date)
      collectedBy,         // Who collected this evidence
      collectedDate,       // When collected

      // What it proves
      proves,              // Array of claims: ["ownership", "parentage", "death_date"]
      confidence,          // 0-1 confidence score

      // Citations
      citations,           // Array of source citations
      notes,               // Research notes

      // Metadata (completely flexible - store anything)
      customMetadata       // JSON object with any additional fields
    } = evidence;

    const evidenceId = this.generateEvidenceId();

    // Learn this evidence type
    if (evidenceType) {
      this.knownEvidenceTypes.add(evidenceType);
    }

    try {
      const insertQuery = `
        INSERT INTO evidence (
          evidence_id,
          evidence_type,
          title,
          description,
          text_content,
          image_url,
          source_url,
          file_path,
          subject_person_id,
          subject_person_name,
          location,
          evidence_date,
          collected_by,
          collected_date,
          proves,
          confidence,
          citations,
          notes,
          custom_metadata,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP)
        RETURNING *
      `;

      const result = await pool.query(insertQuery, [
        evidenceId,
        evidenceType || 'unknown',
        title,
        description,
        textContent,
        imageUrl,
        sourceUrl,
        filePath,
        subjectPersonId,
        subjectPersonName,
        location,
        date,
        collectedBy,
        collectedDate || new Date().toISOString(),
        JSON.stringify(proves || []),
        confidence || 0.8,
        JSON.stringify(citations || []),
        notes,
        JSON.stringify(customMetadata || {})
      ]);

      // Link related persons
      if (relatedPersons && relatedPersons.length > 0) {
        await this.linkRelatedPersons(evidenceId, relatedPersons);
      }

      console.log(`✓ Added evidence: ${title} (${evidenceType})`);

      return {
        success: true,
        evidenceId: evidenceId,
        evidence: result.rows[0]
      };

    } catch (error) {
      console.error('Error adding evidence:', error);
      throw error;
    }
  }

  /**
   * Link evidence to multiple people and their relationships
   */
  async linkRelatedPersons(evidenceId, relatedPersons) {
    for (const person of relatedPersons) {
      await pool.query(`
        INSERT INTO evidence_person_links (
          evidence_id,
          person_id,
          relationship_type,
          role,
          notes
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [
        evidenceId,
        person.personId,
        person.relationship || 'subject',
        person.role || 'mentioned',
        person.notes || null
      ]);
    }
  }

  /**
   * Build debt/credit lineage tree
   * Traces ownership → descendants → reparations
   */
  async buildLineageTree(rootPersonId, options = {}) {
    const {
      maxDepth = 10,
      includeEvidence = true,
      includeDebt = true
    } = options;

    console.log(`Building lineage tree for person: ${rootPersonId}`);

    const tree = {
      root: await this.getPersonWithEvidence(rootPersonId),
      generations: [],
      totalDebt: 0,
      totalDescendants: 0
    };

    // Build descendants tree
    const descendants = await this.getDescendants(rootPersonId, maxDepth);
    tree.generations = this.organizeByGeneration(descendants);
    tree.totalDescendants = descendants.length;

    // Calculate debt if this is a slave owner
    if (includeDebt) {
      tree.debt = await this.calculateDebtLineage(rootPersonId);
      tree.totalDebt = tree.debt.totalOwed;
    }

    return tree;
  }

  /**
   * Get all descendants of a person
   */
  async getDescendants(personId, maxDepth, currentDepth = 0, visited = new Set()) {
    if (currentDepth >= maxDepth || visited.has(personId)) {
      return [];
    }

    visited.add(personId);
    const descendants = [];

    // Get children
    const childrenQuery = `
      SELECT individual_id_2 as child_id, i.*
      FROM individual_relationships ir
      JOIN individuals i ON i.individual_id = ir.individual_id_2
      WHERE ir.individual_id_1 = $1
        AND ir.relationship_type = 'parent-child'
    `;

    const result = await pool.query(childrenQuery, [personId]);

    for (const child of result.rows) {
      const childData = {
        ...child,
        depth: currentDepth + 1,
        descendants: await this.getDescendants(child.child_id, maxDepth, currentDepth + 1, visited)
      };
      descendants.push(childData);
    }

    return descendants;
  }

  /**
   * Organize descendants by generation
   */
  organizeByGeneration(descendants, generation = 1) {
    const generations = [];

    const processLevel = (people, gen) => {
      if (!generations[gen]) {
        generations[gen] = [];
      }

      people.forEach(person => {
        generations[gen].push({
          id: person.individual_id,
          name: person.full_name,
          birthYear: person.birth_year,
          deathYear: person.death_year
        });

        if (person.descendants && person.descendants.length > 0) {
          processLevel(person.descendants, gen + 1);
        }
      });
    };

    processLevel(descendants, generation);
    return generations.filter(g => g && g.length > 0);
  }

  /**
   * Calculate debt lineage (slave owner → descendants owe reparations)
   */
  async calculateDebtLineage(slaveOwnerId) {
    // Get all enslaved people owned
    const enslavedQuery = `
      SELECT COUNT(*) as count, SUM(d.total_reparations) as total_debt
      FROM documents d
      WHERE d.owner_name IN (
        SELECT full_name FROM individuals WHERE individual_id = $1
      )
    `;

    const debtResult = await pool.query(enslavedQuery, [slaveOwnerId]);

    // Get all heirs (descendants)
    const heirs = await this.getDescendants(slaveOwnerId, 10);

    return {
      slaveOwner: slaveOwnerId,
      enslavedCount: parseInt(debtResult.rows[0]?.count || 0),
      totalOwed: parseFloat(debtResult.rows[0]?.total_debt || 0),
      heirCount: this.countAllDescendants(heirs),
      perHeirDebt: heirs.length > 0
        ? parseFloat(debtResult.rows[0]?.total_debt || 0) / this.countAllDescendants(heirs)
        : 0,
      heirs: heirs
    };
  }

  /**
   * Count all descendants recursively
   */
  countAllDescendants(descendants) {
    let count = descendants.length;
    descendants.forEach(d => {
      if (d.descendants) {
        count += this.countAllDescendants(d.descendants);
      }
    });
    return count;
  }

  /**
   * Get person with all their evidence
   */
  async getPersonWithEvidence(personId) {
    const person = await pool.query(`
      SELECT * FROM individuals WHERE individual_id = $1
    `, [personId]);

    if (person.rows.length === 0) {
      throw new Error(`Person ${personId} not found`);
    }

    // Get all evidence about this person
    const evidence = await pool.query(`
      SELECT e.* FROM evidence e
      LEFT JOIN evidence_person_links epl ON e.evidence_id = epl.evidence_id
      WHERE e.subject_person_id = $1 OR epl.person_id = $1
      ORDER BY e.collected_date DESC
    `, [personId]);

    return {
      ...person.rows[0],
      evidence: evidence.rows
    };
  }

  /**
   * Generate unique evidence ID
   */
  generateEvidenceId() {
    return 'EV_' + crypto.randomBytes(8).toString('hex');
  }

  /**
   * Get all evidence types system has learned
   */
  getKnownEvidenceTypes() {
    return Array.from(this.knownEvidenceTypes).sort();
  }
}

module.exports = EvidenceManager;
