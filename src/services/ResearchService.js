/**
 * Research Service
 *
 * Natural language research queries and conversational assistant.
 */

const DocumentRepository = require('../repositories/DocumentRepository');
const EnslavedRepository = require('../repositories/EnslavedRepository');
const IndividualRepository = require('../repositories/IndividualRepository');
const logger = require('../utils/logger');

class ResearchService {
  constructor() {
    // Session storage for conversational context
    this.sessions = new Map();
  }

  /**
   * Process a natural language query
   * @param {string} query - User's question
   * @param {string} sessionId - Session ID for context
   * @returns {Promise<Object>} Response with answer and evidence
   */
  async processQuery(query, sessionId = 'default') {
    try {
      // Get or create session
      const session = this.getSession(sessionId);

      // Classify intent
      const intent = this.classifyIntent(query);

      // Extract entities (names, numbers, etc.)
      const entities = this.extractEntities(query);

      // Resolve pronouns using session context
      const resolvedQuery = this.resolvePronouns(query, session);

      // Update entity extraction with resolved query
      const resolvedEntities = this.extractEntities(resolvedQuery);
      const finalEntities = { ...entities, ...resolvedEntities };

      // Execute query based on intent
      let response;
      switch (intent.type) {
        case 'search_owner':
          response = await this.searchOwner(finalEntities.personName);
          break;
        case 'search_enslaved':
          response = await this.searchEnslaved(finalEntities.personName);
          break;
        case 'count_enslaved':
          response = await this.countEnslaved(finalEntities.personName || session.lastPerson);
          break;
        case 'reparations_amount':
          response = await this.getReparationsAmount(finalEntities.personName || session.lastPerson);
          break;
        case 'statistics':
          response = await this.getStatistics();
          break;
        default:
          response = await this.searchGeneral(resolvedQuery);
      }

      // Update session context
      if (finalEntities.personName) {
        session.lastPerson = finalEntities.personName;
        session.lastPersonType = intent.type.includes('enslaved') ? 'enslaved' : 'owner';
      }
      session.lastIntent = intent.type;
      session.history.push({ query, response, timestamp: new Date() });

      logger.operation('Research query processed', {
        sessionId,
        intent: intent.type,
        entities: finalEntities
      });

      return {
        success: true,
        answer: response.answer,
        evidence: response.evidence,
        intent: intent.type
      };
    } catch (error) {
      logger.error('Research query failed', {
        error: error.message,
        query
      });
      return {
        success: false,
        answer: "I encountered an error processing your query. Please try rephrasing.",
        error: error.message
      };
    }
  }

  /**
   * Search for a slave owner
   * @param {string} ownerName - Owner name
   * @returns {Promise<Object>} Response
   */
  async searchOwner(ownerName) {
    const documents = await DocumentRepository.searchByOwnerName(ownerName);

    if (documents.length === 0) {
      return {
        answer: `I couldn't find any records for "${ownerName}" in the database.`,
        evidence: []
      };
    }

    const doc = documents[0];
    const summary = await DocumentRepository.getOwnerSummary(ownerName);

    return {
      answer: `Yes, I found ${summary.document_count} document(s) for ${ownerName}. ` +
        `Location: ${doc.owner_location || 'Unknown'}. ` +
        `Life: ${doc.owner_birth_year || '?'}-${doc.owner_death_year || '?'}. ` +
        `Enslaved: ${summary.total_enslaved} people. ` +
        `Reparations: $${(summary.total_reparations / 1000000).toFixed(1)}M.`,
      evidence: documents.map(d => ({
        documentId: d.document_id,
        type: d.doc_type,
        confidence: d.ocr_confidence
      }))
    };
  }

  /**
   * Search for an enslaved person
   * @param {string} personName - Person name
   * @returns {Promise<Object>} Response
   */
  async searchEnslaved(personName) {
    const people = await EnslavedRepository.searchByName(personName);

    if (people.length === 0) {
      return {
        answer: `I couldn't find any enslaved person named "${personName}" in the records.`,
        evidence: []
      };
    }

    const person = people[0];
    return {
      answer: `Found ${personName} in the records. ` +
        `Enslaved by: ${person.owner_name}. ` +
        (person.age ? `Age: ${person.age}. ` : '') +
        (person.gender ? `Gender: ${person.gender}. ` : '') +
        `Document type: ${person.doc_type}.`,
      evidence: people.map(p => ({
        documentId: p.document_id,
        ownerName: p.owner_name,
        age: p.age,
        gender: p.gender
      }))
    };
  }

  /**
   * Count enslaved people for an owner
   * @param {string} ownerName - Owner name
   * @returns {Promise<Object>} Response
   */
  async countEnslaved(ownerName) {
    const count = await EnslavedRepository.countByOwner(ownerName);

    if (count === 0) {
      return {
        answer: `No enslaved people found for "${ownerName}".`,
        evidence: []
      };
    }

    return {
      answer: `${ownerName} enslaved ${count} ${count === 1 ? 'person' : 'people'} according to the documents we have.`,
      evidence: [{ ownerName, count }]
    };
  }

  /**
   * Get reparations amount for an owner
   * @param {string} ownerName - Owner name
   * @returns {Promise<Object>} Response
   */
  async getReparationsAmount(ownerName) {
    const summary = await DocumentRepository.getOwnerSummary(ownerName);

    if (!summary) {
      return {
        answer: `No records found for "${ownerName}".`,
        evidence: []
      };
    }

    const millions = (summary.total_reparations / 1000000).toFixed(1);
    return {
      answer: `${ownerName} owes $${millions} million in reparations.`,
      evidence: [{
        ownerName,
        totalReparations: summary.total_reparations,
        enslavedCount: summary.total_enslaved
      }]
    };
  }

  /**
   * Get global statistics
   * @returns {Promise<Object>} Response
   */
  async getStatistics() {
    const query = `SELECT * FROM stats_dashboard`;
    const result = await DocumentRepository.raw(query);
    const stats = result[0] || {};

    return {
      answer: `Database Statistics:\n` +
        `- Total Documents: ${stats.total_documents || 0}\n` +
        `- Total Slave Owners: ${stats.total_owners || 0}\n` +
        `- Total Enslaved: ${stats.total_enslaved || 0}\n` +
        `- Total Reparations: $${((stats.total_reparations || 0) / 1000000).toFixed(1)}M`,
      evidence: [stats]
    };
  }

  /**
   * General search across all records
   * @param {string} query - Search query
   * @returns {Promise<Object>} Response
   */
  async searchGeneral(query) {
    // Search in multiple places
    const [owners, enslaved] = await Promise.all([
      DocumentRepository.raw(`
        SELECT DISTINCT owner_name, owner_location, total_enslaved
        FROM documents
        WHERE owner_name ILIKE $1 OR owner_location ILIKE $1
        LIMIT 5
      `, [`%${query}%`]),
      EnslavedRepository.searchByName(query)
    ]);

    if (owners.length === 0 && enslaved.length === 0) {
      return {
        answer: `No results found for "${query}". Try searching for specific names or asking about statistics.`,
        evidence: []
      };
    }

    let answer = '';
    if (owners.length > 0) {
      answer += `Found ${owners.length} owner(s): ${owners.map(o => o.owner_name).join(', ')}. `;
    }
    if (enslaved.length > 0) {
      answer += `Found ${enslaved.length} enslaved person(s): ${enslaved.map(e => e.name).join(', ')}.`;
    }

    return { answer, evidence: { owners, enslaved } };
  }

  /**
   * Classify query intent
   * @param {string} query - User query
   * @returns {Object} Intent classification
   */
  classifyIntent(query) {
    const q = query.toLowerCase();

    // Pattern matching for intent classification
    if (/(do you have|tell me about|who is|search for|find)/i.test(q)) {
      if (/(enslaved|slave|ancestor)/i.test(q)) {
        return { type: 'search_enslaved', confidence: 0.9 };
      }
      return { type: 'search_owner', confidence: 0.9 };
    }

    if (/(how many|count|number of).*(enslaved|slave|owned)/i.test(q)) {
      return { type: 'count_enslaved', confidence: 0.95 };
    }

    if (/(how much|what.*owe|reparations|amount)/i.test(q)) {
      return { type: 'reparations_amount', confidence: 0.95 };
    }

    if (/(statistic|total|overview|summary)/i.test(q)) {
      return { type: 'statistics', confidence: 0.9 };
    }

    return { type: 'search_general', confidence: 0.5 };
  }

  /**
   * Extract entities from query
   * @param {string} query - User query
   * @returns {Object} Extracted entities
   */
  extractEntities(query) {
    const entities = {};

    // Extract capitalized names (simple name detection)
    const nameMatch = query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/);
    if (nameMatch) {
      entities.personName = nameMatch[1];
    }

    // Extract numbers
    const numberMatch = query.match(/\b(\d+)\b/);
    if (numberMatch) {
      entities.number = parseInt(numberMatch[1], 10);
    }

    return entities;
  }

  /**
   * Resolve pronouns using session context
   * @param {string} query - User query
   * @param {Object} session - Session object
   * @returns {string} Resolved query
   */
  resolvePronouns(query, session) {
    if (!session.lastPerson) return query;

    // Replace pronouns with last mentioned person
    return query
      .replace(/\b(he|she|they|him|her|them)\b/gi, session.lastPerson)
      .replace(/\bhis\b/gi, `${session.lastPerson}'s`)
      .replace(/\bher\b/gi, `${session.lastPerson}'s`);
  }

  /**
   * Get or create session
   * @param {string} sessionId - Session ID
   * @returns {Object} Session object
   */
  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        lastPerson: null,
        lastPersonType: null,
        lastIntent: null,
        history: []
      });
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Clear session
   * @param {string} sessionId - Session ID
   */
  clearSession(sessionId) {
    this.sessions.delete(sessionId);
    logger.operation('Session cleared', { sessionId });
  }
}

module.exports = new ResearchService();
