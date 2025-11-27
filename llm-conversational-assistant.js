/**
 * LLM-Powered Conversational Database Assistant
 * Uses OpenRouter API to parse natural language and update genealogy database
 */

const fetch = require('node-fetch');
const pool = require('./database');
const IndividualEntityManager = require('./individual-entity-manager');

const entityManager = new IndividualEntityManager(pool);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.2-3b-instruct:free';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Call OpenRouter LLM with structured prompt
 */
async function callLLM(systemPrompt, userMessage) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://reparations-platform.onrender.com',
      'X-Title': 'Reparations Platform'
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3, // Lower temperature for more factual responses
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Extract structured data from natural language using LLM
 */
async function extractIntent(userMessage) {
  const systemPrompt = `You are a genealogy database assistant. Parse user input and extract structured data.

Your response MUST be valid JSON with this exact structure:
{
  "intent": "query" | "add_children" | "add_spouse" | "add_location" | "add_birth_death" | "unknown",
  "person": "person name or null",
  "data": {
    // For add_children: {"children": ["name1", "name2"]}
    // For add_spouse: {"spouse": "name"}
    // For add_location: {"location": "place"}
    // For add_birth_death: {"birthYear": 1780, "deathYear": 1850}
    // For query: {"query_type": "count" | "details" | "list"}
  },
  "confidence": 0.0 to 1.0
}

Examples:
Input: "James Hopewell had two children Anne Maria and James Robert"
Output: {"intent":"add_children","person":"James Hopewell","data":{"children":["Anne Maria Hopewell","James Robert Hopewell"]},"confidence":0.95}

Input: "His wife was Mary"
Output: {"intent":"add_spouse","person":null,"data":{"spouse":"Mary"},"confidence":0.9}

Input: "Who are the slave owners in the database?"
Output: {"intent":"query","person":null,"data":{"query_type":"list"},"confidence":1.0}

Input: "How many enslaved people did James Hopewell own?"
Output: {"intent":"query","person":"James Hopewell","data":{"query_type":"count"},"confidence":0.95}

Input: "James Hopewell"
Output: {"intent":"query","person":"James Hopewell","data":{"query_type":"details"},"confidence":0.95}

Input: "Do you have Nancy D'Wolf?"
Output: {"intent":"query","person":"Nancy D'Wolf","data":{"query_type":"details"},"confidence":0.9}

ONLY return valid JSON, no other text.`;

  const llmResponse = await callLLM(systemPrompt, userMessage);

  // Parse JSON from LLM response
  try {
    // Extract JSON from markdown code blocks if present
    let jsonText = llmResponse.trim();
    if (jsonText.includes('```json')) {
      jsonText = jsonText.split('```json')[1].split('```')[0].trim();
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.split('```')[1].split('```')[0].trim();
    }

    return JSON.parse(jsonText);
  } catch (error) {
    console.error('Failed to parse LLM JSON response:', llmResponse);
    // Fallback to pattern matching
    return fallbackPatternMatch(userMessage);
  }
}

/**
 * Fallback pattern matching when LLM fails
 */
function fallbackPatternMatch(message) {
  const lower = message.toLowerCase();

  // Query relationships FIRST - "who is X's wife/son/daughter/children"
  // Check for possessive ('s) to distinguish from "who is the owner"
  if (lower.match(/who (is|are|was|were) .*('s|'s).*(wife|spouse|husband|children|son|daughter|parent)/i)) {
    const personMatch = message.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    let relationshipType = 'spouse';
    if (lower.includes('child') || lower.includes('son') || lower.includes('daughter')) {
      relationshipType = 'children';
    } else if (lower.includes('parent') || lower.includes('mother') || lower.includes('father')) {
      relationshipType = 'parents';
    }
    return {
      intent: 'query_relationship',
      person: personMatch ? personMatch[1] : null,
      data: { relationship_type: relationshipType },
      confidence: 0.85
    };
  }

  // Reprocess documents - "reprocess documents" or "reprocess all"
  if (lower.match(/reprocess/i)) {
    // Check if they want to reprocess all documents
    if (lower.match(/reprocess\s+(all|documents)/i)) {
      return {
        intent: 'reprocess_all_documents',
        person: null,
        data: {},
        confidence: 0.95
      };
    }

    // Check if they want to reprocess a specific owner's documents
    const personMatch = message.match(/\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    if (personMatch) {
      return {
        intent: 'reprocess_owner_documents',
        person: personMatch[1],
        data: {},
        confidence: 0.85
      };
    }

    // Just "reprocess" by itself - reprocess all
    return {
      intent: 'reprocess_all_documents',
      person: null,
      data: {},
      confidence: 0.8
    };
  }

  // FamilySearch ID attachment - "X's FamilySearch ID is XXXX-XXX"
  if (lower.match(/familysearch\s*id/i)) {
    // Extract FamilySearch ID (format: XXXX-XXX or XXXX-XXXX)
    const fsIdMatch = message.match(/([A-Z0-9]{4}-[A-Z0-9]{3,4})/i);

    // Extract person name (capitalized words before "'s" or after "for")
    let personMatch = message.match(/\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);

    // If we found both person and FamilySearch ID
    if (fsIdMatch && personMatch) {
      console.log('[DEBUG] FamilySearch ID pattern matched:', {
        person: personMatch[1],
        fsId: fsIdMatch[1].toUpperCase()
      });

      return {
        intent: 'attach_familysearch_id',
        person: personMatch[1],
        data: { familysearch_id: fsIdMatch[1].toUpperCase() },
        confidence: 0.9
      };
    }
  }

  // Count documents queries - "how many documents"
  if (lower.match(/how many document/i) ||
      lower.match(/count.*document/i) ||
      lower.match(/number of document/i) ||
      lower.match(/total document/i)) {
    return {
      intent: 'query',
      person: null,
      data: { query_type: 'document_count' },
      confidence: 0.9
    };
  }

  // Count owner queries - "how many owners"
  if (lower.match(/how many (slave )?owner/i) ||
      lower.match(/count (of )?(slave )?owner/i) ||
      lower.match(/number of (slave )?owner/i)) {
    return {
      intent: 'query',
      person: null,
      data: { query_type: 'count' },
      confidence: 0.85
    };
  }

  // List queries - recognize variations of asking for owners
  if (lower.match(/who (are|were|is|was) (the )?(slave )?owner/i) ||
      lower.match(/list.*(slave )?owner/i) ||
      lower.match(/show.*(slave )?owner/i) ||
      lower.match(/(slave )?owner.*database/i) ||
      lower.match(/(slave )?owner.*documented/i)) {
    return {
      intent: 'query',
      person: null,
      data: { query_type: 'list' },
      confidence: 0.8
    };
  }

  // Count enslaved people queries - "how many enslaved" or "how many slaves"
  if (lower.match(/how many.*(enslaved|slave)/i) ||
      lower.match(/count.*(enslaved|slave)/i) ||
      lower.match(/total.*(enslaved|slave)/i)) {
    const personMatch = message.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);

    // If no person name found, count ALL enslaved people
    if (!personMatch) {
      return {
        intent: 'query',
        person: null,
        data: { query_type: 'count_all_enslaved' },
        confidence: 0.85
      };
    }

    // If person name found, count enslaved people for that owner
    return {
      intent: 'query',
      person: personMatch[1],
      data: { query_type: 'count' },
      confidence: 0.75
    };
  }

  // Details queries
  if (lower.match(/tell me about/i) || lower.match(/who is|who was/i) || lower.match(/find/i)) {
    const personMatch = message.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    if (personMatch) {
      return {
        intent: 'query',
        person: personMatch[1],
        data: { query_type: 'details' },
        confidence: 0.75
      };
    }
  }

  // Add children
  if (lower.match(/had.*children?/i) || lower.match(/children?.*(named|were|are)/i)) {
    const personMatch = message.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    const childrenMatches = message.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g);
    return {
      intent: 'add_children',
      person: personMatch ? personMatch[1] : null,
      data: { children: childrenMatches ? childrenMatches.slice(1) : [] },
      confidence: 0.7
    };
  }

  return {
    intent: 'unknown',
    person: null,
    data: {},
    confidence: 0.0
  };
}

/**
 * Find person in database (check documents table for slave owners)
 */
async function findPerson(personName, filters = {}) {
  if (!personName) return null;

  let query = `
    SELECT
      document_id,
      owner_name,
      doc_type,
      owner_birth_year as birth_year,
      owner_death_year as death_year,
      owner_location as location,
      created_at,
      filename
    FROM documents
    WHERE LOWER(owner_name) LIKE LOWER($1)
  `;

  const params = [`%${personName}%`];
  let paramIndex = 2;

  // Apply filters for disambiguation
  if (filters.location) {
    query += ` AND LOWER(owner_location) LIKE LOWER($${paramIndex})`;
    params.push(`%${filters.location}%`);
    paramIndex++;
  }

  if (filters.birthYear) {
    query += ` AND owner_birth_year = $${paramIndex}`;
    params.push(filters.birthYear);
    paramIndex++;
  }

  if (filters.deathYear) {
    query += ` AND owner_death_year = $${paramIndex}`;
    params.push(filters.deathYear);
    paramIndex++;
  }

  if (filters.docType) {
    query += ` AND LOWER(doc_type) LIKE LOWER($${paramIndex})`;
    params.push(`%${filters.docType}%`);
    paramIndex++;
  }

  query += ` ORDER BY created_at DESC`;

  const result = await pool.query(query, params);
  return result.rows; // Return ALL matches, not just first one
}

/**
 * Add children to a person's genealogy record
 */
async function addChildren(personName, children) {
  try {
    // Find the person
    const person = await findPerson(personName);
    if (!person) {
      return {
        success: false,
        message: `Could not find ${personName} in the database. Please upload documents for this person first.`
      };
    }

    // Create or find the parent's individual record
    const parentId = await entityManager.findOrCreateIndividual({
      fullName: person.owner_name,
      birthYear: person.birth_year,
      deathYear: person.death_year,
      locations: person.location ? [person.location] : [],
      notes: `Updated via conversational assistant on ${new Date().toISOString()}`
    });

    // Create child records and add relationships
    const addedChildren = [];
    for (const childName of children) {
      // Create child individual
      const childId = await entityManager.findOrCreateIndividual({
        fullName: childName,
        notes: `Added as child of ${personName} via conversational assistant`
      });

      // Add parent-child relationship
      await entityManager.addRelationship(
        parentId,
        childId,
        'parent-child',
        person.document_id,
        'manual'
      );

      addedChildren.push(childName);
    }

    return {
      success: true,
      message: `Successfully added ${addedChildren.length} children to ${personName}: ${addedChildren.join(', ')}`,
      data: {
        person: person.owner_name,
        children: addedChildren,
        individual_id: parentId
      }
    };

  } catch (error) {
    console.error('Error adding children:', error);
    throw error;
  }
}

/**
 * Add spouse to a person's genealogy record
 */
async function addSpouse(personName, spouseName) {
  try {
    const person = await findPerson(personName);
    if (!person) {
      return {
        success: false,
        message: `Could not find ${personName} in the database.`
      };
    }

    // Create or find the person's individual record
    const personId = await entityManager.findOrCreateIndividual({
      fullName: person.owner_name,
      birthYear: person.birth_year,
      deathYear: person.death_year,
      locations: person.location ? [person.location] : [],
      notes: `Updated via conversational assistant on ${new Date().toISOString()}`
    });

    // Create spouse individual
    const spouseId = await entityManager.findOrCreateIndividual({
      fullName: spouseName,
      notes: `Added as spouse of ${personName} via conversational assistant`
    });

    // Add spouse relationship (bidirectional)
    await entityManager.addRelationship(
      personId,
      spouseId,
      'spouse',
      person.document_id,
      'manual'
    );

    return {
      success: true,
      message: `Successfully added spouse ${spouseName} to ${personName}`,
      data: {
        person: person.owner_name,
        spouse: spouseName,
        individual_id: personId
      }
    };

  } catch (error) {
    console.error('Error adding spouse:', error);
    throw error;
  }
}

/**
 * Add location to a person's genealogy record
 */
async function addLocation(personName, location) {
  try {
    const person = await findPerson(personName);
    if (!person) {
      return {
        success: false,
        message: `Could not find ${personName} in the database.`
      };
    }

    // Get existing locations
    const existing = await entityManager.getIndividual(person.owner_name);
    const existingLocations = existing?.locations ?
      (typeof existing.locations === 'string' ? existing.locations.split(', ') : existing.locations)
      : [];

    // Add new location if not already present
    if (!existingLocations.includes(location)) {
      existingLocations.push(location);
    }

    // Update individual with new location
    const personId = await entityManager.findOrCreateIndividual({
      fullName: person.owner_name,
      birthYear: person.birth_year,
      deathYear: person.death_year,
      locations: existingLocations,
      notes: `Location updated via conversational assistant on ${new Date().toISOString()}`
    });

    return {
      success: true,
      message: `Successfully added location "${location}" to ${personName}`,
      data: {
        person: person.owner_name,
        location: location,
        individual_id: personId
      }
    };

  } catch (error) {
    console.error('Error adding location:', error);
    throw error;
  }
}

/**
 * Query relationships for a person
 */
async function queryRelationships(personName, relationshipType) {
  try {
    // Find the person
    const person = await findPerson(personName);
    if (!person) {
      return {
        success: false,
        message: `Could not find ${personName} in the database.`
      };
    }

    // Get the individual's ID
    const individualResult = await pool.query(
      'SELECT individual_id FROM individuals WHERE LOWER(full_name) LIKE LOWER($1) LIMIT 1',
      [`%${person.owner_name}%`]
    );

    if (!individualResult.rows || individualResult.rows.length === 0) {
      return {
        success: false,
        message: `${person.owner_name} has no relationship data yet. Add relationships using commands like "${person.owner_name} had a wife named Mary"`
      };
    }

    const individualId = individualResult.rows[0].individual_id;

    // Query relationships based on type
    let query, params;
    if (relationshipType === 'spouse') {
      query = `
        SELECT i.full_name, i.birth_year, i.death_year, i.gender
        FROM individual_relationships r
        JOIN individuals i ON (r.individual_id_2 = i.individual_id)
        WHERE r.individual_id_1 = $1 AND r.relationship_type = 'spouse'
      `;
      params = [individualId];
    } else if (relationshipType === 'children') {
      query = `
        SELECT i.full_name, i.birth_year, i.death_year, i.gender
        FROM individual_relationships r
        JOIN individuals i ON (r.individual_id_2 = i.individual_id)
        WHERE r.individual_id_1 = $1 AND r.relationship_type = 'parent-child'
      `;
      params = [individualId];
    } else if (relationshipType === 'parents') {
      query = `
        SELECT i.full_name, i.birth_year, i.death_year, i.gender
        FROM individual_relationships r
        JOIN individuals i ON (r.individual_id_1 = i.individual_id)
        WHERE r.individual_id_2 = $1 AND r.relationship_type = 'parent-child'
      `;
      params = [individualId];
    }

    const result = await pool.query(query, params);

    if (!result.rows || result.rows.length === 0) {
      return {
        success: true,
        message: `No ${relationshipType} found for ${person.owner_name}.`
      };
    }

    // Format response
    let message = '';
    if (relationshipType === 'spouse' && result.rows.length > 0) {
      const spouse = result.rows[0];
      message = `${person.owner_name}'s spouse is ${spouse.full_name}`;
      if (spouse.birth_year || spouse.death_year) {
        message += ` (${spouse.birth_year || '?'}-${spouse.death_year || '?'})`;
      }
    } else if (relationshipType === 'children') {
      message = `${person.owner_name} has ${result.rows.length} child${result.rows.length === 1 ? '' : 'ren'}:\n`;
      result.rows.forEach((child, i) => {
        message += `${i + 1}. ${child.full_name}`;
        if (child.birth_year || child.death_year) {
          message += ` (${child.birth_year || '?'}-${child.death_year || '?'})`;
        }
        message += '\n';
      });
    } else if (relationshipType === 'parents') {
      message = `${person.owner_name}'s parents:\n`;
      result.rows.forEach((parent, i) => {
        message += `${i + 1}. ${parent.full_name}`;
        if (parent.birth_year || parent.death_year) {
          message += ` (${parent.birth_year || '?'}-${parent.death_year || '?'})`;
        }
        message += '\n';
      });
    }

    return {
      success: true,
      message: message.trim(),
      data: result.rows
    };

  } catch (error) {
    console.error('Error querying relationships:', error);
    return {
      success: false,
      message: `Error retrieving relationship data: ${error.message}`
    };
  }
}

/**
 * Reprocess all documents with improved parser
 */
async function reprocessAllDocuments() {
  try {
    console.log('[DEBUG] Reprocessing all documents...');

    // Get all documents from database
    const result = await pool.query('SELECT document_id, owner_name FROM documents ORDER BY created_at DESC');

    if (result.rows.length === 0) {
      return {
        success: false,
        message: 'No documents found in the database to reprocess.'
      };
    }

    const axios = require('axios');
    const API_URL = process.env.API_URL || 'http://localhost:3000';

    let successCount = 0;
    let totalImprovement = 0;
    const results = [];

    for (const doc of result.rows) {
      try {
        const response = await axios.post(`${API_URL}/api/reprocess-document`, {
          documentId: doc.document_id
        });

        if (response.data.success) {
          successCount++;
          totalImprovement += response.data.improvement || 0;
          results.push({
            owner: doc.owner_name,
            improvement: response.data.improvement
          });
        }
      } catch (error) {
        console.error(`Failed to reprocess ${doc.owner_name}:`, error.message);
      }
    }

    return {
      success: true,
      message: `Successfully reprocessed ${successCount}/${result.rows.length} documents. Total improvement: +${totalImprovement} enslaved people found.`,
      data: {
        total: result.rows.length,
        successful: successCount,
        totalImprovement: totalImprovement,
        results: results
      }
    };

  } catch (error) {
    console.error('Error reprocessing documents:', error);
    return {
      success: false,
      message: `Error reprocessing documents: ${error.message}`
    };
  }
}

/**
 * Reprocess documents for a specific owner
 */
async function reprocessOwnerDocuments(ownerName) {
  try {
    console.log('[DEBUG] Reprocessing documents for:', ownerName);

    // Get documents for this owner
    const result = await pool.query(
      'SELECT document_id, owner_name FROM documents WHERE LOWER(owner_name) LIKE LOWER($1)',
      [`%${ownerName}%`]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        message: `No documents found for ${ownerName}.`
      };
    }

    const axios = require('axios');
    const API_URL = process.env.API_URL || 'http://localhost:3000';

    let successCount = 0;
    let totalImprovement = 0;

    for (const doc of result.rows) {
      try {
        const response = await axios.post(`${API_URL}/api/reprocess-document`, {
          documentId: doc.document_id
        });

        if (response.data.success) {
          successCount++;
          totalImprovement += response.data.improvement || 0;
        }
      } catch (error) {
        console.error(`Failed to reprocess document ${doc.document_id}:`, error.message);
      }
    }

    return {
      success: true,
      message: `Reprocessed ${successCount}/${result.rows.length} documents for ${result.rows[0].owner_name}. Improvement: +${totalImprovement} enslaved people found.`,
      data: {
        owner: result.rows[0].owner_name,
        total: result.rows.length,
        successful: successCount,
        totalImprovement: totalImprovement
      }
    };

  } catch (error) {
    console.error('Error reprocessing owner documents:', error);
    return {
      success: false,
      message: `Error reprocessing documents: ${error.message}`
    };
  }
}

/**
 * Attach FamilySearch ID to a person (owner or enslaved individual)
 */
async function attachFamilySearchId(personName, familySearchId) {
  try {
    // First, check if this is a slave owner (in documents table)
    const ownerResult = await pool.query(
      'SELECT owner_name, document_id FROM documents WHERE LOWER(owner_name) LIKE LOWER($1) LIMIT 1',
      [`%${personName}%`]
    );

    if (ownerResult.rows.length > 0) {
      // Update slave owner's FamilySearch ID
      await pool.query(
        'UPDATE documents SET owner_familysearch_id = $1 WHERE LOWER(owner_name) LIKE LOWER($2)',
        [familySearchId, `%${personName}%`]
      );

      return {
        success: true,
        message: `Successfully attached FamilySearch ID ${familySearchId} to slave owner ${ownerResult.rows[0].owner_name}`,
        data: {
          person: ownerResult.rows[0].owner_name,
          familysearch_id: familySearchId,
          type: 'owner'
        }
      };
    }

    // If not an owner, check if this is an enslaved individual
    const individualResult = await pool.query(
      'SELECT individual_id, full_name FROM individuals WHERE LOWER(full_name) LIKE LOWER($1) LIMIT 1',
      [`%${personName}%`]
    );

    if (individualResult.rows.length > 0) {
      // Update individual's FamilySearch ID
      await pool.query(
        'UPDATE individuals SET familysearch_id = $1 WHERE individual_id = $2',
        [familySearchId, individualResult.rows[0].individual_id]
      );

      return {
        success: true,
        message: `Successfully attached FamilySearch ID ${familySearchId} to ${individualResult.rows[0].full_name}`,
        data: {
          person: individualResult.rows[0].full_name,
          familysearch_id: familySearchId,
          type: 'individual'
        }
      };
    }

    // Person not found
    return {
      success: false,
      message: `Could not find ${personName} in the database. Please upload documents or add individual records first.`
    };

  } catch (error) {
    console.error('Error attaching FamilySearch ID:', error);
    return {
      success: false,
      message: `Error attaching FamilySearch ID: ${error.message}`
    };
  }
}

/**
 * Query the database
 */
async function queryDatabase(intent) {
  const { person, data } = intent;

  if (data.query_type === 'document_count') {
    // Count total documents
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM documents
    `);

    const count = parseInt(result.rows[0].count);
    return {
      success: true,
      message: `There are ${count} document${count === 1 ? '' : 's'} stored in the database.`,
      data: { count }
    };
  }

  if (data.query_type === 'list') {
    // List all slave owners
    const result = await pool.query(`
      SELECT owner_name, COUNT(*) as document_count
      FROM documents
      GROUP BY owner_name
      ORDER BY owner_name
    `);

    return {
      success: true,
      message: `Found ${result.rows.length} slave owners in the database:`,
      data: result.rows
    };
  }

  if (data.query_type === 'count_all_enslaved') {
    // Count total enslaved people across all documents
    const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM enslaved_people
    `);

    if (!result.rows || result.rows.length === 0) {
      return {
        success: true,
        message: 'No enslaved people documented in the database yet.',
        data: { count: 0 }
      };
    }

    const count = parseInt(result.rows[0].count);
    return {
      success: true,
      message: `There are ${count} enslaved ${count === 1 ? 'person' : 'people'} documented in the database.`,
      data: { count }
    };
  }

  if (data.query_type === 'count' && !person) {
    // Count total owners (not enslaved people)
    const result = await pool.query(`
      SELECT COUNT(DISTINCT owner_name) as count
      FROM documents
    `);

    if (!result.rows || result.rows.length === 0) {
      return {
        success: true,
        message: 'No slave owners documented in the database yet.',
        data: { count: 0 }
      };
    }

    const count = parseInt(result.rows[0].count);
    return {
      success: true,
      message: `There are ${count} slave owner${count === 1 ? '' : 's'} documented in the database.`,
      data: { count }
    };
  }

  if (data.query_type === 'count' && person) {
    // Count enslaved people for a specific owner
    const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM enslaved_people
      WHERE document_id IN (
        SELECT document_id FROM documents WHERE LOWER(owner_name) LIKE LOWER($1)
      )
    `, [`%${person}%`]);

    const ownerResult = await pool.query(`
      SELECT owner_name FROM documents WHERE LOWER(owner_name) LIKE LOWER($1) LIMIT 1
    `, [`%${person}%`]);

    const ownerName = ownerResult.rows[0]?.owner_name || person;
    const count = result.rows[0].count;

    return {
      success: true,
      message: `${ownerName} enslaved ${count} people according to documents in the database.`,
      data: { person: ownerName, count: parseInt(count) }
    };
  }

  if (data.query_type === 'details' && person) {
    // Get detailed info about a person
    // Check if user is disambiguating from previous results
    const filters = {};

    // Extract filters from data (LLM can provide these)
    if (data.location) filters.location = data.location;
    if (data.birthYear) filters.birthYear = data.birthYear;
    if (data.deathYear) filters.deathYear = data.deathYear;
    if (data.docType) filters.docType = data.docType;

    const matches = await findPerson(person, filters);

    if (!matches || matches.length === 0) {
      return {
        success: false,
        message: `Could not find "${person}" in the database. Try searching for slave owners or check the spelling.`
      };
    }

    // If multiple matches, ask user to clarify
    if (matches.length > 1) {
      const matchList = matches.map((m, idx) => {
        const parts = [m.owner_name];
        if (m.birth_year && m.death_year) parts.push(`(${m.birth_year}-${m.death_year})`);
        else if (m.birth_year) parts.push(`(b. ${m.birth_year})`);
        else if (m.death_year) parts.push(`(d. ${m.death_year})`);
        if (m.location) parts.push(`from ${m.location}`);
        parts.push(`[${m.doc_type || 'document'}]`);
        return `${idx + 1}. ${parts.join(' ')}`;
      }).join('\n');

      return {
        success: true,
        message: `Found ${matches.length} people matching "${person}":\n\n${matchList}\n\nPlease specify which one you mean by saying:\n- "The one from [location]"\n- "The one born in [year]"\n- "Number [1-${matches.length}]"`,
        data: {
          ambiguous: true,
          candidates: matches,
          count: matches.length
        }
      };
    }

    // Single match - return details
    const personData = matches[0];

    // Get counts of enslaved people and reparations
    const enslavedResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM enslaved_people
      WHERE document_id = $1
    `, [personData.document_id]);

    const repsResult = await pool.query(`
      SELECT COALESCE(SUM(total_reparations_owed), 0) as total
      FROM reparations_breakdown
      WHERE document_id = $1
    `, [personData.document_id]);

    const enslavedCount = parseInt(enslavedResult.rows[0]?.count || 0);
    const reparationsTotal = parseFloat(repsResult.rows[0]?.total || 0);

    const details = [];
    details.push(`📄 **${personData.owner_name}**`);
    if (personData.birth_year || personData.death_year) {
      details.push(`📅 Life: ${personData.birth_year || '?'} - ${personData.death_year || '?'}`);
    }
    if (personData.location) {
      details.push(`📍 Location: ${personData.location}`);
    }
    if (enslavedCount > 0) {
      details.push(`⛓️  Enslaved: ${enslavedCount} people`);
    }
    if (reparationsTotal > 0) {
      details.push(`💰 Reparations: $${(reparationsTotal / 1000000).toFixed(1)}M`);
    }
    details.push(`📁 Document: ${personData.doc_type || 'unknown type'}`);

    return {
      success: true,
      message: details.join('\n'),
      data: {
        ...personData,
        enslaved_count: enslavedCount,
        reparations_total: reparationsTotal,
        document_ids: [personData.document_id]
      }
    };
  }

  return {
    success: false,
    message: 'Could not understand the query. Please try rephrasing.'
  };
}

/**
 * Main conversational processing function
 */
async function processConversation(userMessage, context = {}) {
  try {
    // IMPORTANT: Check for specific patterns FIRST (before LLM)
    // LLM often misclassifies these commands
    const lower = userMessage.toLowerCase();
    let intent;

    // Relationship queries - "who is X's wife"
    if (lower.match(/who (is|are|was|were) .*('s|'s).*(wife|spouse|husband|children|son|daughter|parent)/i)) {
      console.log('[DEBUG] Detected relationship query pattern, using pattern matching');
      intent = fallbackPatternMatch(userMessage);
    }
    // FamilySearch ID commands - "X's FamilySearch ID is XXXX-XXX"
    else if (lower.match(/familysearch\s*id/i)) {
      console.log('[DEBUG] Detected FamilySearch ID pattern, using pattern matching');
      intent = fallbackPatternMatch(userMessage);
    }
    // Reprocess commands - "reprocess documents" or "reprocess all"
    else if (lower.match(/reprocess/i)) {
      console.log('[DEBUG] Detected reprocess pattern, using pattern matching');
      intent = fallbackPatternMatch(userMessage);
    }
    // Count enslaved people - "how many enslaved" or "how many slaves"
    else if (lower.match(/how many.*(enslaved|slave)/i) || lower.match(/count.*(enslaved|slave)/i) || lower.match(/total.*(enslaved|slave)/i)) {
      console.log('[DEBUG] Detected enslaved count pattern, using pattern matching');
      intent = fallbackPatternMatch(userMessage);
    }
    // Disambiguation - "the one from Maryland" or "number 2" or "the one born in 1780"
    else if (context.lastAmbiguousQuery &&
             (lower.match(/^(the one|number|#)\s/i) || lower.match(/from\s+[a-z]/i) || lower.match(/born in|died in/i))) {
      console.log('[DEBUG] Detected disambiguation query');
      const filters = {};

      // Extract filters from natural language
      const locationMatch = userMessage.match(/(?:from|in)\s+([a-z\s]+?)(?:\s|$)/i);
      if (locationMatch) filters.location = locationMatch[1].trim();

      const birthMatch = userMessage.match(/born\s+in\s+(\d{4})/i);
      if (birthMatch) filters.birthYear = parseInt(birthMatch[1]);

      const deathMatch = userMessage.match(/died?\s+in\s+(\d{4})/i);
      if (deathMatch) filters.deathYear = parseInt(deathMatch[1]);

      // Handle "number 2" or "#2"
      const numberMatch = userMessage.match(/(?:number|#)\s*(\d+)/i);
      if (numberMatch && context.lastCandidates) {
        const index = parseInt(numberMatch[1]) - 1;
        if (index >= 0 && index < context.lastCandidates.length) {
          const selected = context.lastCandidates[index];
          intent = {
            intent: 'query',
            person: selected.owner_name,
            data: {
              query_type: 'details',
              location: selected.location,
              birthYear: selected.birth_year,
              deathYear: selected.death_year
            },
            confidence: 1.0
          };
        }
      } else {
        // Apply filters to narrow down previous results
        intent = {
          intent: 'query',
          person: context.lastAmbiguousQuery,
          data: {
            query_type: 'details',
            ...filters
          },
          confidence: 0.9
        };
      }
    }
    // Simple person name lookup - "james hopewell" or "do you have james hopewell" or "tell me about james hopewell"
    else if (userMessage.match(/^[A-Z][a-z]+(\s+[A-Z][a-z']+)+$/i) ||
             lower.match(/^(do you have|tell me about|find|search|show me|who is|what about)\s+[a-z]/i)) {
      console.log('[DEBUG] Detected person lookup query, using details query');
      // Extract person name - remove query words
      const personName = userMessage.replace(/^(do you have|tell me about|find|search|show me|who is|what about)\s+/i, '').trim();
      intent = {
        intent: 'query',
        person: personName,
        data: { query_type: 'details' },
        confidence: 0.9
      };
    }
    // Otherwise, use LLM
    else {
      // Try LLM for non-relationship queries
      try {
        intent = await extractIntent(userMessage);
        console.log('[DEBUG] Extracted intent:', JSON.stringify(intent));
      } catch (llmError) {
        console.log('[DEBUG] LLM intent extraction failed, using fallback pattern matching');
        // If LLM fails (rate limit, timeout, etc), use fallback
        intent = fallbackPatternMatch(userMessage);
      }

      // If intent is unknown, try fallback
      if (intent.intent === 'unknown') {
        console.log('[DEBUG] Intent unknown, trying fallback pattern matching');
        intent = fallbackPatternMatch(userMessage);
      }
    }

    // If person is null but we have context, use last mentioned person
    if (!intent.person && context.lastPerson) {
      intent.person = context.lastPerson;
    }

    let result;

    switch (intent.intent) {
      case 'add_children':
        result = await addChildren(intent.person, intent.data.children);
        break;

      case 'add_spouse':
        result = await addSpouse(intent.person, intent.data.spouse);
        break;

      case 'add_location':
        result = await addLocation(intent.person, intent.data.location);
        break;

      case 'attach_familysearch_id':
        result = await attachFamilySearchId(intent.person, intent.data.familysearch_id);
        break;

      case 'reprocess_all_documents':
        result = await reprocessAllDocuments();
        break;

      case 'reprocess_owner_documents':
        result = await reprocessOwnerDocuments(intent.person);
        break;

      case 'query':
        result = await queryDatabase(intent);
        break;

      case 'query_relationship':
        result = await queryRelationships(intent.person, intent.data.relationship_type);
        break;

      default:
        result = {
          success: false,
          message: `I'm not sure how to help with that. I can help you:\n- Add children: "James had two children Anne and Robert"\n- Add spouse: "His wife was Mary"\n- Add locations: "He lived in Maryland"\n- Attach FamilySearch IDs: "James Hopewell's FamilySearch ID is XXXX-XXX"\n- Reprocess documents: "reprocess documents" or "reprocess Ann M. Biscoe"\n- Query data: "Who are the slave owners?" or "How many enslaved people did James own?"`
        };
    }

    // Update context with last mentioned person
    if (intent.person) {
      context.lastPerson = intent.person;
    }

    // Store ambiguous query context for follow-up disambiguation
    if (result.data?.ambiguous) {
      context.lastAmbiguousQuery = intent.person;
      context.lastCandidates = result.data.candidates;
    } else {
      // Clear ambiguous context once resolved
      delete context.lastAmbiguousQuery;
      delete context.lastCandidates;
    }

    return {
      ...result,
      intent: intent,
      context: context
    };

  } catch (error) {
    console.error('Conversational processing error:', error);
    return {
      success: false,
      message: `Error processing your request: ${error.message}`,
      error: error.message
    };
  }
}

module.exports = {
  processConversation,
  extractIntent,
  callLLM
};
