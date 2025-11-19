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

  // Count enslaved people queries
  if (lower.match(/how many.*enslaved/i) || lower.match(/count.*enslaved/i)) {
    const personMatch = message.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    return {
      intent: 'query',
      person: personMatch ? personMatch[1] : null,
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
async function findPerson(personName) {
  if (!personName) return null;

  const query = `
    SELECT
      document_id,
      owner_name,
      doc_type,
      owner_birth_year as birth_year,
      owner_death_year as death_year,
      owner_location as location,
      created_at
    FROM documents
    WHERE LOWER(owner_name) LIKE LOWER($1)
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const result = await pool.query(query, [`%${personName}%`]);
  return result.rows.length > 0 ? result.rows[0] : null;
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
 * Query the database
 */
async function queryDatabase(intent) {
  const { person, data } = intent;

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
    const personData = await findPerson(person);

    if (!personData) {
      return {
        success: false,
        message: `Could not find ${person} in the database.`
      };
    }

    return {
      success: true,
      message: `Found ${personData.owner_name}`,
      data: personData
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
    // Extract intent from natural language
    let intent;
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

      case 'query':
        result = await queryDatabase(intent);
        break;

      default:
        result = {
          success: false,
          message: `I'm not sure how to help with that. I can help you:\n- Add children: "James had two children Anne and Robert"\n- Add spouse: "His wife was Mary"\n- Add locations: "He lived in Maryland"\n- Query data: "Who are the slave owners?" or "How many enslaved people did James own?"`
        };
    }

    // Update context with last mentioned person
    if (intent.person) {
      context.lastPerson = intent.person;
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
