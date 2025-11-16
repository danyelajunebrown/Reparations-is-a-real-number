/**
 * Free Local NLP System for Reparations Research
 * No external APIs - pattern matching + context awareness
 * Handles: entity extraction, intent classification, follow-ups, pronouns
 */

class FreeNLPResearchAssistant {
    constructor(database) {
        this.database = database;
        this.sessions = new Map(); // Store conversation context per session
        
        // Intent patterns (what is the user trying to do?)
        this.intentPatterns = {
            // Search for a person
            find_person: [
                /do you have.*?([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /is there.*?([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /tell me about ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /who (?:is|was) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /find ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /show me ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /search (?:for )?([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i
            ],
            
            // Update person metadata
            update_person: [
                /([A-Z][a-z]+(?: [A-Z][a-z]+)*)'s (?:wife|husband|spouse) (?:was|is) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /([A-Z][a-z]+(?: [A-Z][a-z]+)*) married ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /([A-Z][a-z]+(?: [A-Z][a-z]+)*)'s (?:child|children|son|daughter) (?:was|were|is|are) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /([A-Z][a-z]+(?: [A-Z][a-z]+)*)'s (?:parent|parents|father|mother) (?:was|were|is|are) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /update ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /set ([A-Z][a-z]+(?: [A-Z][a-z]+)*)'s (spouse|wife|husband|child|children|parent|parents) to ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i
            ],
            
            // Count enslaved people
            count_enslaved: [
                /how many (?:slaves?|enslaved(?: people)?)(?: did| )?([A-Z][a-z]+(?: [A-Z][a-z]+)*)?/i,
                /how many (?:did|does) ([A-Z][a-z]+(?: [A-Z][a-z]+)*) (?:own|have|enslave)/i,
                /(?:enslaved|slave) count (?:for )?([A-Z][a-z]+(?: [A-Z][a-z]+)*)?/i
            ],
            
            // Trace lineage/descendants
            trace_lineage: [
                /how many (?:slave ?owners?|owners?) (?:is|was|are) ([A-Z][a-z]+(?: [A-Z][a-z]+)*) descended from/i,
                /who (?:are|were) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)'s ancestors/i,
                /trace (?:the )?lineage (?:of|for) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /ancestors? (?:of )?([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i
            ],
            
            // Get statistics
            statistics: [
                /stats?(?:istics?)?/i,
                /how many (?:total|documents?|owners?|people)/i,
                /show me (?:the )?(?:stats?|totals?|summary)/i,
                /what'?s in the database/i
            ],
            
            // Get family/relationships
            family: [
                /who (?:are|were|was) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)'s (?:children|kids|heirs|family)/i,
                /(?:children|heirs|family) of ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /who inherited from ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i
            ],
            
            // Reparations amount
            reparations: [
                /how much (?:does|did) ([A-Z][a-z]+(?: [A-Z][a-z]+)*) owe/i,
                /reparations (?:for|owed by) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /what'?s the (?:reparations|amount) for ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i
            ]
        };
        
        // Pronoun references
        this.pronouns = ['he', 'she', 'they', 'them', 'his', 'her', 'their', 'him'];
    }
    
    /**
     * Get or create session context
     */
    getSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, {
                lastPerson: null,        // Last person mentioned
                lastPersonType: null,    // 'owner' or 'enslaved'
                lastIntent: null,        // Last action performed
                conversationHistory: []  // Full history
            });
        }
        return this.sessions.get(sessionId);
    }
    
    /**
     * Check if query contains pronouns
     */
    containsPronoun(query) {
        const lower = query.toLowerCase();
        return this.pronouns.some(p => {
            const pattern = new RegExp(`\\b${p}\\b`, 'i');
            return pattern.test(lower);
        });
    }
    
    /**
     * Replace pronouns with last mentioned person
     */
    resolvePronoun(query, session) {
        if (!session.lastPerson) {
            return { query, resolved: false };
        }
        
        let resolved = query;
        this.pronouns.forEach(pronoun => {
            const pattern = new RegExp(`\\b${pronoun}\\b`, 'gi');
            resolved = resolved.replace(pattern, session.lastPerson);
        });
        
        return { 
            query: resolved, 
            resolved: true,
            originalPerson: session.lastPerson 
        };
    }
    
    /**
     * Extract person name from query
     */
    extractPersonName(query) {
        // Try to find capitalized names (First Last pattern)
        const namePattern = /\b([A-Z][a-z]+(?: [A-Z][a-z]+)+)\b/g;
        const matches = query.match(namePattern);
        
        if (matches && matches.length > 0) {
            return matches[0];
        }
        
        // Try single capitalized word (like "Hopewell")
        const singlePattern = /\b([A-Z][a-z]{2,})\b/;
        const singleMatch = query.match(singlePattern);
        
        return singleMatch ? singleMatch[1] : null;
    }
    
    /**
     * Classify intent from query
     */
    classifyIntent(query) {
        for (const [intent, patterns] of Object.entries(this.intentPatterns)) {
            for (const pattern of patterns) {
                const match = query.match(pattern);
                if (match) {
                    return {
                        intent,
                        personName: match[1] || this.extractPersonName(query),
                        confidence: 1.0
                    };
                }
            }
        }
        
        // Default fallback
        const personName = this.extractPersonName(query);
        if (personName) {
            return {
                intent: 'find_person',
                personName,
                confidence: 0.7
            };
        }
        
        return {
            intent: 'unknown',
            personName: null,
            confidence: 0.0
        };
    }
    
    /**
     * Search for a person in the database
     */
    async findPerson(name) {
        const results = {
            asOwner: null,
            asEnslaved: null,
            asIndividual: null
        };
        
        // Search documents table (slave owners)
        try {
            const ownerQuery = await this.database.query(`
                SELECT DISTINCT
                    d.owner_name,
                    d.owner_birth_year,
                    d.owner_death_year,
                    d.owner_location,
                    COUNT(DISTINCT d.document_id) as document_count,
                    SUM(d.total_enslaved) as total_enslaved,
                    SUM(d.total_reparations) as total_reparations
                FROM documents d
                WHERE d.owner_name ILIKE $1
                GROUP BY d.owner_name, d.owner_birth_year, d.owner_death_year, d.owner_location
            `, [`%${name}%`]);
            
            if (ownerQuery.rows && ownerQuery.rows.length > 0) {
                results.asOwner = ownerQuery.rows[0];
            }
        } catch (err) {
            console.error('Error searching owners:', err);
        }
        
        // Search enslaved_people table
        try {
            const enslavedQuery = await this.database.query(`
                SELECT 
                    ep.name,
                    ep.gender,
                    ep.age,
                    ep.family_relationship,
                    ep.bequeathed_to,
                    d.owner_name,
                    d.doc_type
                FROM enslaved_people ep
                JOIN documents d ON ep.document_id = d.document_id
                WHERE ep.name ILIKE $1
                LIMIT 5
            `, [`%${name}%`]);
            
            if (enslavedQuery.rows && enslavedQuery.rows.length > 0) {
                results.asEnslaved = enslavedQuery.rows;
            }
        } catch (err) {
            console.error('Error searching enslaved:', err);
        }
        
        // Search individuals table
        try {
            const individualQuery = await this.database.query(`
                SELECT 
                    i.full_name,
                    i.birth_year,
                    i.death_year,
                    i.total_documents,
                    i.total_enslaved,
                    i.total_reparations
                FROM individuals i
                WHERE i.full_name ILIKE $1
                LIMIT 5
            `, [`%${name}%`]);
            
            if (individualQuery.rows && individualQuery.rows.length > 0) {
                results.asIndividual = individualQuery.rows[0];
            }
        } catch (err) {
            console.error('Error searching individuals:', err);
        }
        
        return results;
    }
    
    /**
     * Generate natural language response
     */
    formatResponse(intent, data, personName, session) {
        let response = '';
        
        switch (intent) {
            case 'find_person':
                if (data.asOwner) {
                    const owner = data.asOwner;
                    response = `Yes, I found ${owner.owner_name} in the records.\n\n`;
                    response += `📍 Location: ${owner.owner_location || 'Unknown'}\n`;
                    response += `📅 Life: ${owner.owner_birth_year || '?'} - ${owner.owner_death_year || '?'}\n`;
                    response += `📄 Documents: ${owner.document_count}\n`;
                    response += `⛓️ Enslaved: ${owner.total_enslaved} people\n`;
                    response += `💰 Reparations Owed: $${(owner.total_reparations / 1000000).toFixed(1)}M`;
                    
                    session.lastPerson = owner.owner_name;
                    session.lastPersonType = 'owner';
                } else if (data.asIndividual) {
                    const ind = data.asIndividual;
                    response = `Yes, I found ${ind.full_name} in the records.\n\n`;
                    response += `📅 Life: ${ind.birth_year || '?'} - ${ind.death_year || '?'}\n`;
                    response += `📄 Documents: ${ind.total_documents}\n`;
                    response += `⛓️ Enslaved: ${ind.total_enslaved} people\n`;
                    response += `💰 Reparations: $${(ind.total_reparations / 1000000).toFixed(1)}M`;
                    
                    session.lastPerson = ind.full_name;
                    session.lastPersonType = 'owner';
                } else if (data.asEnslaved && data.asEnslaved.length > 0) {
                    const person = data.asEnslaved[0];
                    response = `Yes, I found ${person.name} as an enslaved person.\n\n`;
                    response += `Enslaved by: ${person.owner_name}\n`;
                    if (person.gender) response += `Gender: ${person.gender}\n`;
                    if (person.family_relationship) response += `Family: ${person.family_relationship}\n`;
                    if (person.bequeathed_to) response += `Bequeathed to: ${person.bequeathed_to}\n`;
                    
                    session.lastPerson = person.name;
                    session.lastPersonType = 'enslaved';
                } else {
                    response = `I couldn't find "${personName}" in the database. Try:\n`;
                    response += `- Check spelling\n`;
                    response += `- Try just the last name\n`;
                    response += `- Ask "what's in the database?" to see what we have`;
                }
                break;
                
            case 'count_enslaved':
                if (data.asOwner) {
                    response = `${data.asOwner.owner_name} enslaved ${data.asOwner.total_enslaved} people according to the documents we have.`;
                    session.lastPerson = data.asOwner.owner_name;
                } else if (data.asIndividual) {
                    response = `${data.asIndividual.full_name} enslaved ${data.asIndividual.total_enslaved} people across ${data.asIndividual.total_documents} documents.`;
                    session.lastPerson = data.asIndividual.full_name;
                } else {
                    response = `I don't have enslavement records for "${personName}". Would you like to search for a different person?`;
                }
                break;
                
            case 'reparations':
                if (data.asOwner) {
                    const amount = (data.asOwner.total_reparations / 1000000).toFixed(1);
                    response = `${data.asOwner.owner_name} owes $${amount} million in reparations.\n\n`;
                    response += `This is calculated based on ${data.asOwner.total_enslaved} enslaved people documented in ${data.asOwner.document_count} document(s).`;
                    session.lastPerson = data.asOwner.owner_name;
                } else if (data.asIndividual) {
                    const amount = (data.asIndividual.total_reparations / 1000000).toFixed(1);
                    response = `${data.asIndividual.full_name} owes $${amount} million in reparations.`;
                    session.lastPerson = data.asIndividual.full_name;
                } else {
                    response = `I don't have reparations calculations for "${personName}".`;
                }
                break;
                
            case 'statistics':
                response = `📊 Database Statistics:\n\n`;
                response += `📄 Total Documents: ${data.stats.total_documents}\n`;
                response += `👤 Slave Owners: ${data.stats.unique_owners}\n`;
                response += `⛓️ Enslaved People: ${data.stats.total_enslaved_counted}\n`;
                response += `💰 Total Reparations: $${(data.stats.total_reparations_calculated / 1000000).toFixed(1)}M`;
                break;
                
            default:
                response = `I can help you with:\n`;
                response += `- "Do you have [person name]?"\n`;
                response += `- "How many enslaved people did [person] own?"\n`;
                response += `- "What reparations does [person] owe?"\n`;
                response += `- "Show me statistics"`;
        }
        
        return response;
    }
    
    /**
     * Main query method
     */
    async query(userQuery, sessionId = 'default') {
        const session = this.getSession(sessionId);
        
        // Add to conversation history
        session.conversationHistory.push({
            timestamp: new Date(),
            query: userQuery,
            type: 'user'
        });
        
        try {
            // Check for pronouns and resolve
            let processedQuery = userQuery;
            let resolved = false;
            
            if (this.containsPronoun(userQuery)) {
                const resolution = this.resolvePronoun(userQuery, session);
                processedQuery = resolution.query;
                resolved = resolution.resolved;
            }
            
            // Classify intent
            const { intent, personName } = this.classifyIntent(processedQuery);
            session.lastIntent = intent;
            
            // Execute query based on intent
            let data = {};
            let response = '';
            
            if (intent === 'statistics') {
                data.stats = await this.database.getStats();
                response = this.formatResponse(intent, data, null, session);
                
            } else if (personName) {
                data = await this.findPerson(personName);
                response = this.formatResponse(intent, data, personName, session);
                
            } else if (resolved && session.lastPerson) {
                // Follow-up question about last person
                data = await this.findPerson(session.lastPerson);
                response = this.formatResponse(intent, data, session.lastPerson, session);
                
            } else {
                response = this.formatResponse('unknown', {}, null, session);
            }
            
            // Add response to history
            session.conversationHistory.push({
                timestamp: new Date(),
                response,
                type: 'assistant',
                intent
            });
            
            return {
                success: true,
                response,
                intent,
                personName: personName || session.lastPerson,
                resolved,
                source: 'free-nlp'
            };
            
        } catch (error) {
            console.error('NLP query error:', error);
            return {
                success: false,
                error: error.message,
                response: 'Sorry, I encountered an error processing your question.'
            };
        }
    }
    
    /**
     * Clear session history
     */
    clearSession(sessionId = 'default') {
        this.sessions.delete(sessionId);
    }
}

module.exports = FreeNLPResearchAssistant;
