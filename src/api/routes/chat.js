/**
 * Chat API - Universal Database Research Assistant
 * Handles any question about any data in the database
 * Can also add/update information
 */
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
});

// Session storage for conversation context
const sessions = new Map();

// Intent patterns
const INTENTS = {
    count: /how many|count|total|number of/i,
    search: /find|search|look for|who is|tell me about|what do you know about/i,
    statistics: /statistics|stats|breakdown|summary|overview/i,
    reparations: /reparations|owed|debt|compensation|calculate/i,
    sources: /source|where|from|data|where does/i,
    list: /list|show me|all|display/i,
    add: /add|create|insert|record|new/i,
    update: /update|change|modify|set|correct/i,
    help: /help|what can|how do|commands/i,
    civilwar: /civil war|civilwar|dc petition/i
};

// Entity patterns
const ENTITIES = {
    enslaved: /enslaved|slave[ds]?\b/i,
    owner: /owner|slaveholder|master/i,
    familysearch: /familysearch/i,
    msa: /maryland|msa/i,
    civilwar: /civil war|civilwar|dc petition/i,
    document: /\b(uploaded )?(document|will|deed|inventory)s?\b/i,  // Specific document types only
    people: /people|persons?|individuals?/i  // For "how many people" type queries
};

/**
 * POST /api/chat
 * Process natural language questions and commands
 */
router.post('/', async (req, res) => {
    try {
        const { message, query, sessionId = 'default' } = req.body;
        const userMessage = message || query;

        if (!userMessage || !userMessage.trim()) {
            return res.json({
                success: true,
                response: "Please ask me a question about the database. Try: 'How many enslaved persons are documented?' or 'Find records about Ravenel'"
            });
        }

        const input = userMessage.toLowerCase().trim();
        let response = '';

        // Get/create session for context
        if (!sessions.has(sessionId)) {
            sessions.set(sessionId, { lastPerson: null, lastQuery: null, lastResults: [] });
        }
        const session = sessions.get(sessionId);

        // Help
        if (INTENTS.help.test(input)) {
            response = `**Research Assistant Commands:**

**Search & Count:**
• "How many enslaved persons are in the database?"
• "How many slaveholders are documented?"
• "Find records about [name]"
• "Search for Ravenel"

**Statistics:**
• "Show me statistics"
• "Database overview"
• "Source breakdown"

**Reparations:**
• "Calculate reparations for [name]"
• "What is owed to [name]?"

**Sources:**
• "What are the data sources?"
• "How many FamilySearch records?"
• "Maryland Archives stats"

**Specific Queries:**
• "List enslaved persons from Civil War DC"
• "Show high confidence records"
• "Find records with owner link"`;
            return res.json({ success: true, response });
        }

        // Count queries
        if (INTENTS.count.test(input)) {
            let sql, label;

            if (ENTITIES.enslaved.test(input)) {
                sql = `SELECT COUNT(*) FROM unconfirmed_persons WHERE person_type = 'enslaved' AND (status IS NULL OR status NOT IN ('rejected', 'needs_review'))`;
                label = 'enslaved persons';
            } else if (ENTITIES.owner.test(input)) {
                sql = `SELECT COUNT(*) FROM unconfirmed_persons WHERE person_type IN ('owner', 'slaveholder') AND (status IS NULL OR status NOT IN ('rejected', 'needs_review'))`;
                label = 'slaveholders';
            } else if (ENTITIES.familysearch.test(input)) {
                sql = `SELECT COUNT(*) FROM unconfirmed_persons WHERE source_url LIKE '%familysearch%' AND (status IS NULL OR status NOT IN ('rejected', 'needs_review'))`;
                label = 'FamilySearch records';
            } else if (ENTITIES.msa.test(input)) {
                sql = `SELECT COUNT(*) FROM unconfirmed_persons WHERE source_url LIKE '%msa.maryland%' AND (status IS NULL OR status NOT IN ('rejected', 'needs_review'))`;
                label = 'Maryland Archives records';
            } else if (ENTITIES.civilwar.test(input)) {
                sql = `SELECT COUNT(*) FROM unconfirmed_persons WHERE source_url LIKE '%civilwardc%' AND (status IS NULL OR status NOT IN ('rejected', 'needs_review'))`;
                label = 'Civil War DC records';
            } else if (/total/i.test(input) || ENTITIES.people.test(input) || /how many\s*(records)?$/i.test(input)) {
                // "total records", "total", "how many people", "how many records" → all database records
                sql = `SELECT COUNT(*) FROM unconfirmed_persons WHERE (status IS NULL OR status NOT IN ('rejected', 'needs_review'))`;
                label = 'total records';
            } else if (ENTITIES.document.test(input) && !/documented/i.test(input)) {
                // Only count documents if not asking about "documented" (people documented)
                sql = `SELECT COUNT(*) FROM documents`;
                label = 'uploaded documents';
            } else {
                sql = `SELECT COUNT(*) FROM unconfirmed_persons WHERE (status IS NULL OR status NOT IN ('rejected', 'needs_review'))`;
                label = 'total records';
            }

            const result = await pool.query(sql);
            response = `There are **${parseInt(result.rows[0].count).toLocaleString()}** ${label} in the database.`;
            return res.json({ success: true, response });
        }

        // Statistics
        if (INTENTS.statistics.test(input)) {
            const [typeStats, sourceStats, statusStats] = await Promise.all([
                pool.query(`
                    SELECT person_type, COUNT(*) as count
                    FROM unconfirmed_persons
                    WHERE (status IS NULL OR status NOT IN ('rejected', 'needs_review'))
                    GROUP BY person_type ORDER BY count DESC
                `),
                pool.query(`
                    SELECT
                        CASE
                            WHEN source_url LIKE '%familysearch%' THEN 'FamilySearch'
                            WHEN source_url LIKE '%msa.maryland%' THEN 'Maryland Archives'
                            WHEN source_url LIKE '%civilwardc%' THEN 'Civil War DC'
                            WHEN source_url LIKE '%beyondkin%' THEN 'Beyond Kin'
                            ELSE 'Other'
                        END as source, COUNT(*) as count
                    FROM unconfirmed_persons
                    WHERE (status IS NULL OR status NOT IN ('rejected', 'needs_review'))
                    GROUP BY 1 ORDER BY count DESC
                `),
                pool.query(`
                    SELECT COALESCE(status, 'pending') as status, COUNT(*) as count
                    FROM unconfirmed_persons
                    GROUP BY 1 ORDER BY count DESC
                `)
            ]);

            const byType = typeStats.rows.map(r => `• ${r.person_type || 'unknown'}: ${parseInt(r.count).toLocaleString()}`).join('\n');
            const bySource = sourceStats.rows.map(r => `• ${r.source}: ${parseInt(r.count).toLocaleString()}`).join('\n');
            const byStatus = statusStats.rows.map(r => `• ${r.status}: ${parseInt(r.count).toLocaleString()}`).join('\n');

            response = `**Database Statistics**

**By Person Type:**
${byType}

**By Source:**
${bySource}

**By Status:**
${byStatus}`;
            return res.json({ success: true, response });
        }

        // Reparations calculation (check BEFORE search to avoid two-word pattern catch)
        if (INTENTS.reparations.test(input)) {
            let personName = null;
            // Try to extract name from query
            const nameMatch = input.match(/(?:for|to|owed to|calculate for)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
            if (nameMatch) {
                personName = nameMatch[1];
            } else {
                personName = session.lastPerson;
            }

            if (personName) {
                const person = await pool.query(`
                    SELECT lead_id, full_name, person_type, confidence_score
                    FROM unconfirmed_persons
                    WHERE full_name ILIKE $1 AND person_type = 'enslaved'
                    AND (status IS NULL OR status NOT IN ('rejected', 'needs_review'))
                    LIMIT 1
                `, [`%${personName}%`]);

                if (person.rows.length > 0) {
                    // Calculate reparations (25 year estimate)
                    const years = 25;
                    const wageTheft = years * 120 * 300 * 30; // $120/day * 300 days * inflation
                    const damages = years * 15000 * 1.5;
                    const profitShare = years * 300 * 30 * 0.4;
                    const subtotal = wageTheft + damages + profitShare;
                    const interest = subtotal * (Math.pow(1.04, 160) - 1);
                    const total = subtotal + interest;

                    response = `**Reparations Estimate for ${person.rows[0].full_name}:**

• Wage Theft (${years} years): $${wageTheft.toLocaleString()}
• Human Dignity Damages: $${damages.toLocaleString()}
• Profit Share: $${profitShare.toLocaleString()}
• Compound Interest (4%, 160 years): $${Math.round(interest).toLocaleString()}

**Total Estimated: $${Math.round(total).toLocaleString()}**

*Based on standard formula. Click "Calculate Reparations" for detailed breakdown.*`;
                } else {
                    response = `Could not find enslaved person "${personName}" to calculate reparations. Try searching first.`;
                }
            } else {
                response = `To calculate reparations, I need a name. Try:\n• "Calculate reparations for [name]"\n• Search for a person first, then ask about their reparations`;
            }
            return res.json({ success: true, response });
        }

        // List queries (check BEFORE search to avoid two-word pattern catch)
        if (INTENTS.list.test(input)) {
            let sql = `SELECT full_name, person_type, confidence_score FROM unconfirmed_persons WHERE (status IS NULL OR status NOT IN ('rejected', 'needs_review'))`;
            let label = 'records';

            if (ENTITIES.enslaved.test(input)) {
                sql += ` AND person_type = 'enslaved'`;
                label = 'enslaved persons';
            } else if (ENTITIES.owner.test(input)) {
                sql += ` AND person_type IN ('owner', 'slaveholder')`;
                label = 'slaveholders';
            }

            // Source filters
            if (INTENTS.civilwar.test(input)) {
                sql += ` AND source_url LIKE '%civilwardc%'`;
                label += ' from Civil War DC';
            } else if (ENTITIES.familysearch.test(input)) {
                sql += ` AND source_url LIKE '%familysearch%'`;
                label += ' from FamilySearch';
            } else if (ENTITIES.msa.test(input)) {
                sql += ` AND source_url LIKE '%msa.maryland%'`;
                label += ' from Maryland Archives';
            }

            if (/high confidence/i.test(input)) {
                sql += ` AND confidence_score >= 0.9`;
                label += ' (high confidence)';
            }

            sql += ` ORDER BY confidence_score DESC LIMIT 20`;

            const results = await pool.query(sql);
            if (results.rows.length > 0) {
                const list = results.rows.map((r, i) => {
                    const confidence = r.confidence_score ? `${(parseFloat(r.confidence_score) * 100).toFixed(0)}%` : 'unrated';
                    return `${i + 1}. ${r.full_name} (${r.person_type || 'unknown'}) - ${confidence}`;
                }).join('\n');
                response = `**Top 20 ${label}:**\n\n${list}`;
            } else {
                response = `No ${label} found matching criteria.`;
            }
            return res.json({ success: true, response });
        }

        // Source info
        if (INTENTS.sources.test(input) && !INTENTS.search.test(input)) {
            const sources = await pool.query(`
                SELECT
                    CASE
                        WHEN source_url LIKE '%familysearch%' THEN 'FamilySearch (Ravenel papers)'
                        WHEN source_url LIKE '%msa.maryland%' THEN 'Maryland State Archives'
                        WHEN source_url LIKE '%civilwardc%' THEN 'Civil War DC Petitions'
                        WHEN source_url LIKE '%beyondkin%' THEN 'Beyond Kin'
                        ELSE 'Other sources'
                    END as source,
                    COUNT(*) as count
                FROM unconfirmed_persons
                WHERE (status IS NULL OR status NOT IN ('rejected', 'needs_review'))
                GROUP BY 1 ORDER BY count DESC
            `);

            const list = sources.rows.map(r => `• **${r.source}**: ${parseInt(r.count).toLocaleString()} records`).join('\n');
            response = `**Data Sources:**\n\n${list}\n\nData is extracted from historical documents, archives, and genealogical records.`;
            return res.json({ success: true, response });
        }

        // Search for person/records
        if (INTENTS.search.test(input) || /^[A-Za-z]+ [A-Za-z]+$/i.test(userMessage.trim())) {
            // Extract name from query - handle "search for X" vs "search X"
            let searchName = userMessage.trim();
            const nameMatch = input.match(/(?:find|search for|search|look for|who is|tell me about|what do you know about)\s+(.+)/i);
            if (nameMatch) {
                searchName = nameMatch[1]
                    .replace(/[?'"]/g, '')
                    .replace(/^for\s+/i, '')
                    .replace(/^records?\s+(about|for|on)\s+/i, '')  // Remove "records about"
                    .replace(/^(information|info|data)\s+(about|for|on)\s+/i, '')  // Remove "info about"
                    .trim();
            }

            // Search all entity tables: unconfirmed_persons, enslaved_individuals, canonical_persons
            const results = await pool.query(`
                SELECT * FROM (
                    SELECT
                        lead_id::text as id, full_name, person_type, source_url,
                        confidence_score, context_text, 'unconfirmed_persons' as table_source
                    FROM unconfirmed_persons
                    WHERE full_name ILIKE $1
                    AND (status IS NULL OR status NOT IN ('rejected', 'needs_review'))

                    UNION ALL

                    SELECT
                        enslaved_id as id, full_name, 'enslaved' as person_type,
                        NULL as source_url, 1.0 as confidence_score,
                        notes as context_text, 'enslaved_individuals' as table_source
                    FROM enslaved_individuals
                    WHERE full_name ILIKE $1

                    UNION ALL

                    SELECT
                        id::text as id, canonical_name as full_name, person_type,
                        NULL as source_url, COALESCE(confidence_score, 1.0) as confidence_score,
                        notes as context_text, 'canonical_persons' as table_source
                    FROM canonical_persons
                    WHERE canonical_name ILIKE $1
                ) combined
                ORDER BY confidence_score DESC NULLS LAST
                LIMIT 10
            `, [`%${searchName}%`]);

            if (results.rows.length > 0) {
                session.lastResults = results.rows;
                session.lastPerson = results.rows[0].full_name;

                const matches = results.rows.map((r, i) => {
                    const confidence = r.confidence_score ? `${(parseFloat(r.confidence_score) * 100).toFixed(0)}% confidence` : 'unrated';
                    const source = r.table_source === 'enslaved_individuals' ? ' [Confirmed]' :
                                  r.table_source === 'canonical_persons' ? ' [Canonical]' : '';
                    return `${i + 1}. **${r.full_name}** (${r.person_type || 'unknown'}) - ${confidence}${source}`;
                }).join('\n');

                // Count by table source for summary
                const confirmed = results.rows.filter(r => r.table_source === 'enslaved_individuals').length;
                const canonical = results.rows.filter(r => r.table_source === 'canonical_persons').length;
                const unconfirmed = results.rows.filter(r => r.table_source === 'unconfirmed_persons').length;

                let summary = `Found **${results.rows.length}** record(s) matching "${searchName}"`;
                if (confirmed > 0 || canonical > 0) {
                    const parts = [];
                    if (confirmed > 0) parts.push(`${confirmed} confirmed`);
                    if (canonical > 0) parts.push(`${canonical} canonical`);
                    if (unconfirmed > 0) parts.push(`${unconfirmed} unconfirmed`);
                    summary += ` (${parts.join(', ')})`;
                }

                response = `${summary}:\n\n${matches}\n\n*Use the search bar to see full details and documents.*`;
            } else {
                response = `No records found matching "${searchName}". Try:\n• Different spelling\n• First name only\n• Last name only`;
            }
            return res.json({ success: true, response });
        }

        // Civil War specific queries
        if (INTENTS.civilwar.test(input)) {
            const count = await pool.query(`
                SELECT COUNT(*) FROM unconfirmed_persons
                WHERE source_url LIKE '%civilwardc%'
                AND (status IS NULL OR status NOT IN ('rejected', 'needs_review'))
            `);
            const enslaved = await pool.query(`
                SELECT COUNT(*) FROM unconfirmed_persons
                WHERE source_url LIKE '%civilwardc%'
                AND person_type = 'enslaved'
                AND (status IS NULL OR status NOT IN ('rejected', 'needs_review'))
            `);

            response = `**Civil War DC Petitions:**\n\n• Total records: ${parseInt(count.rows[0].count).toLocaleString()}\n• Enslaved persons: ${parseInt(enslaved.rows[0].count).toLocaleString()}\n\nThese records are from the Civil War DC Emancipation petitions. Use "list Civil War enslaved" to see names.`;
            return res.json({ success: true, response });
        }

        // Default - try to understand and help
        response = `I'm not sure how to answer that. Try:\n• "How many enslaved persons are in the database?"\n• "Find records about [name]"\n• "Show me statistics"\n• "What are the data sources?"\n• Type "help" for all commands`;

        res.json({ success: true, response });

    } catch (error) {
        console.error('Chat error:', error);
        res.json({
            success: false,
            response: `Error: ${error.message}. Please try a different question.`
        });
    }
});

module.exports = router;
