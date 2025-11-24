/**
 * Free Local NLP System for Reparations Research
 * No external APIs - pattern matching + context awareness
 * Handles: entity extraction, intent classification, follow-ups, pronouns, tree building
 */

const TreeBuilderConversation = require('./tree-builder-conversation');

class FreeNLPResearchAssistant {
    constructor(database, enslavedManager = null, descendantTreeBuilder = null) {
        this.database = database;
        this.enslavedManager = enslavedManager;
        this.descendantTreeBuilder = descendantTreeBuilder;
        this.sessions = new Map(); // Store conversation context per session
        this.treeBuilder = new TreeBuilderConversation(database); // Tree builder

        // Intent patterns (what is the user trying to do?)
        this.intentPatterns = {
            // DOCUMENT VIEWING: Show/load documents (check FIRST before find_person!)
            view_document: [
                // With possessive
                /show(?: me)? ([a-z][a-z]+(?: [a-z][a-z]+)*)'s (?:will|document|tombstone|inventory|deed|records?)/i,
                /view ([a-z][a-z]+(?: [a-z][a-z]+)*)'s (?:will|document|tombstone|inventory|deed|records?)/i,
                /display ([a-z][a-z]+(?: [a-z][a-z]+)*)'s (?:will|document|tombstone|inventory|deed|records?)/i,
                /load ([a-z][a-z]+(?: [a-z][a-z]+)*)'s (?:will|document|tombstone|inventory|deed|records?)/i,
                /pull up ([a-z][a-z]+(?: [a-z][a-z]+)*)'s (?:will|document|tombstone|inventory|deed|records?)/i,
                /get ([a-z][a-z]+(?: [a-z][a-z]+)*)'s (?:will|document|tombstone|inventory|deed|records?)/i,
                // Without possessive
                /show(?: me)? ([a-z][a-z]+(?: [a-z][a-z]+)*) (?:will|document|tombstone|inventory|deed|records?)/i,
                /view ([a-z][a-z]+(?: [a-z][a-z]+)*) (?:will|document|tombstone|inventory|deed|records?)/i,
                /display ([a-z][a-z]+(?: [a-z][a-z]+)*) (?:will|document|tombstone|inventory|deed|records?)/i,
                /load ([a-z][a-z]+(?: [a-z][a-z]+)*) (?:will|document|tombstone|inventory|deed|records?)/i,
                /pull up ([a-z][a-z]+(?: [a-z][a-z]+)*) (?:will|document|tombstone|inventory|deed|records?)/i,
                /get ([a-z][a-z]+(?: [a-z][a-z]+)*) (?:will|document|tombstone|inventory|deed|records?)/i,
                // With "for/of"
                /(?:show|view|display|load)(?: me)? (?:the )?(?:will|document|tombstone|inventory|deed|records?) (?:for|of) ([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                // Generic "documents for" pattern
                /(?:show|view|display|load|get|pull up)(?: me)? (?:the )?documents? (?:for|of|from) ([a-z][a-z]+(?: [a-z][a-z]+)*)/i
            ],

            // Search for a person
            find_person: [
                /do you have (?:a |the |any )?(?:records? for |information (?:on|about) )?([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                /is there (?:a |any )?(?:record|info|information) (?:for|about|on) ([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                /tell me about ([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                /who (?:is|was) ([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                /find ([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                /show me ([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                /search (?:for )?([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                /(?:^|\s)([a-z][a-z]+(?:\s+[a-z][a-z]+)+)(?:\?|$)/i  // Just a name with question mark
            ],
            
            // Update person metadata
            update_person: [
                // Middle name
                /([a-z]+(?:\s+[a-z]+)*)'s middle name (?:is|was) ([a-z]+)/i,
                /set ([a-z]+(?:\s+[a-z]+)*)'s middle name to ([a-z]+)/i,
                /add middle name ([a-z]+) (?:to|for) ([a-z]+(?:\s+[a-z]+)*)/i,

                // Alternative names/spellings
                /([a-z]+(?:\s+[a-z]+)*) (?:also|is also) (?:spelled|known as|called) ([a-z]+(?:\s+[a-z]+)*)/i,
                /add (?:alternative|alternate|alias) (?:name|spelling) ([a-z]+(?:\s+[a-z]+)*) (?:to|for) ([a-z]+(?:\s+[a-z]+)*)/i,
                /([a-z]+(?:\s+[a-z]+)*) (?:goes by|went by) ([a-z]+(?:\s+[a-z]+)*)/i,

                // FamilySearch ID
                /([a-z]+(?:\s+[a-z]+)*)'s FamilySearch ID (?:is|=) ([A-Z0-9-]+)/i,
                /set FamilySearch ID (?:to |)([A-Z0-9-]+) for ([a-z]+(?:\s+[a-z]+)*)/i,
                /FamilySearch ID for ([a-z]+(?:\s+[a-z]+)*) is ([A-Z0-9-]+)/i,

                // Children - FIXED: More specific patterns to identify parent correctly
                /([a-z]+(?:\s+[a-z]+)*) had (?:a child|children|two children|three children|(?:\d+) children)(?: named)? (.+)/i,
                /([a-z]+(?:\s+[a-z]+)*)'s children (?:were?|are|include[sd]?) (.+)/i,
                /add child(?:ren)? (.+) (?:to|for) ([a-z]+(?:\s+[a-z]+)*)/i,
                /([a-z]+(?:\s+[a-z]+)*)'s (?:daughter|son) (?:is|was) ([a-z]+(?:\s+[a-z]+)*)/i,

                // Spouse
                /([a-z]+(?:\s+[a-z]+)*)'s (?:wife|husband|spouse) (?:was|is) ([a-z]+(?:\s+[a-z]+)*)/i,
                /([a-z]+(?:\s+[a-z]+)*) married ([a-z]+(?:\s+[a-z]+)*)/i,

                // General notes
                /add note (?:to |for |)([a-z]+(?:\s+[a-z]+)*)[: ] (.+)/i,
                /note for ([a-z]+(?:\s+[a-z]+)*)[: ] (.+)/i
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
            ],

            // GENEALOGY: Count descendants
            count_descendants: [
                /how many descendants (?:does|did) ([A-Z][a-z]+(?: [A-Z][a-z]+)*) have/i,
                /(?:total )?descendants? (?:of|for) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /count descendants? (?:of|for) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /how many people descended from ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i
            ],

            // GENEALOGY: Show family tree
            show_tree: [
                /show (?:me )?(?:the )?(?:family )?tree (?:for|of) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /(?:family )?tree (?:for|of) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /display tree/i,
                /view tree/i
            ],

            // GENEALOGY: Find relationship
            find_relationship: [
                /how (?:am i|is .+) related to ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /relationship (?:between|to) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /(?:am i|is .+) (?:a )?descendant of ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i
            ],

            // GENEALOGY: Living descendants
            living_descendants: [
                /how many living descendants (?:does|did) ([A-Z][a-z]+(?: [A-Z][a-z]+)*) have/i,
                /living descendants? (?:of|for) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /estimate living descendants/i
            ],

            // GENEALOGY: Distribution/shares
            descendant_shares: [
                /(?:what is|what's|calculate) (?:my|the) share/i,
                /how much would (?:my|each) share be/i,
                /distribute reparations (?:for|to) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i,
                /reparations distribution (?:for|of) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i
            ],

            // TREE BUILDER: Start conversational tree building
            build_tree: [
                /build (?:a |an? )?(?:family )?tree/i,
                /add (?:a |an? )?(?:family )?tree/i,
                /create (?:a |an? )?(?:family )?tree/i,
                /add descendants for ([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                /add children (?:and grandchildren )?for ([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                /build family (?:for|of) ([a-z][a-z]+(?: [a-z][a-z]+)*)/i,
                /start tree builder/i,
                /build another tree/i
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
     * Parse metadata update from query
     */
    parseMetadataUpdate(query) {
        const updates = {
            personName: null,
            field: null,
            value: null,
            action: null  // 'set', 'add', 'append'
        };

        // Middle name patterns
        if (/middle name/i.test(query)) {
            const match = query.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*)'s middle name (?:is|was) ([A-Za-z]+)/i) ||
                          query.match(/set ([A-Za-z]+(?:\s+[A-Za-z]+)*)'s middle name to ([A-Za-z]+)/i) ||
                          query.match(/add middle name ([A-Za-z]+) (?:to|for) ([A-Za-z]+(?:\s+[A-Za-z]+)*)/i);
            if (match) {
                updates.personName = match[match.length === 4 ? 2 : 1];
                updates.value = match[match.length === 4 ? 1 : 2];
                updates.field = 'middle_name';
                updates.action = 'set';
                return updates;
            }
        }

        // Alternative names patterns
        if (/spelled|known as|alias|goes by/i.test(query)) {
            const match = query.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*) (?:also|is also) (?:spelled|known as|called) ([A-Za-z]+(?:\s+[A-Za-z]+)*)/i) ||
                          query.match(/add (?:alternative|alternate|alias) (?:name|spelling) ([A-Za-z]+(?:\s+[A-Za-z]+)*) (?:to|for) ([A-Za-z]+(?:\s+[A-Za-z]+)*)/i) ||
                          query.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*) (?:goes by|went by) ([A-Za-z]+(?:\s+[A-Za-z]+)*)/i);
            if (match) {
                updates.personName = match[match[0].includes('to') || match[0].includes('for') ? 2 : 1];
                updates.value = match[match[0].includes('to') || match[0].includes('for') ? 1 : 2];
                updates.field = 'alternative_names';
                updates.action = 'add';
                return updates;
            }
        }

        // FamilySearch ID patterns
        if (/FamilySearch ID/i.test(query)) {
            const match = query.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*)'s FamilySearch ID (?:is|=) ([A-Z0-9-]+)/i) ||
                          query.match(/set FamilySearch ID (?:to |)([A-Z0-9-]+) for ([A-Za-z]+(?:\s+[A-Za-z]+)*)/i) ||
                          query.match(/FamilySearch ID for ([A-Za-z]+(?:\s+[A-Za-z]+)*) is ([A-Z0-9-]+)/i);
            if (match) {
                updates.personName = match[match[0].includes('for') ? 2 : 1];
                updates.value = match[match[0].includes('for') ? 1 : 2];
                updates.field = 'familysearch_id';
                updates.action = 'set';
                return updates;
            }
        }

        // Children patterns
        if (/child(?:ren)?/i.test(query)) {
            const match = query.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*)'s children (?:were?|are|include[sd]?) (.+)/i) ||
                          query.match(/add child ([A-Za-z]+(?:\s+[A-Za-z]+)*) (?:to|for) ([A-Za-z]+(?:\s+[A-Za-z]+)*)/i) ||
                          query.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*) had (?:a child|children) (?:named |)(.+)/i);
            if (match) {
                updates.personName = match[match[0].includes('to') || match[0].includes('for') ? 2 : 1];
                updates.value = match[match[0].includes('to') || match[0].includes('for') ? 1 : 2];
                updates.field = 'child_names';
                updates.action = 'add';
                return updates;
            }
        }

        // Spouse patterns
        if (/wife|husband|spouse|married/i.test(query)) {
            const match = query.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*)'s (?:wife|husband|spouse) (?:was|is) ([A-Za-z]+(?:\s+[A-Za-z]+)*)/i) ||
                          query.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*) married ([A-Za-z]+(?:\s+[A-Za-z]+)*)/i);
            if (match) {
                updates.personName = match[1];
                updates.value = match[2];
                updates.field = 'spouse_name';
                updates.action = 'set';
                return updates;
            }
        }

        // Notes patterns
        if (/note/i.test(query)) {
            const match = query.match(/add note (?:to |for |)([A-Za-z]+(?:\s+[A-Za-z]+)*)[: ] (.+)/i) ||
                          query.match(/note for ([A-Za-z]+(?:\s+[A-Za-z]+)*)[: ] (.+)/i);
            if (match) {
                updates.personName = match[1];
                updates.value = match[2];
                updates.field = 'notes';
                updates.action = 'append';
                return updates;
            }
        }

        return updates;
    }

    /**
     * Execute metadata update
     * FIXED: Now searches BOTH owners (documents table) AND enslaved people
     */
    async executeUpdate(personName, field, value, action) {
        try {
            // SPECIAL CASE: FamilySearch ID - check documents table (slave owners) FIRST
            if (field === 'familysearch_id') {
                // Try to find as slave owner first
                const ownerResult = await this.database.query(`
                    SELECT owner_name, document_id
                    FROM documents
                    WHERE LOWER(owner_name) = LOWER($1)
                    LIMIT 1
                `, [personName]);

                if (ownerResult.rows.length > 0) {
                    // Update as owner in documents table
                    await this.database.query(`
                        UPDATE documents
                        SET owner_familysearch_id = $1
                        WHERE LOWER(owner_name) = LOWER($2)
                    `, [value, personName]);

                    return {
                        success: true,
                        message: `Successfully attached FamilySearch ID ${value} to slave owner ${ownerResult.rows[0].owner_name}`
                    };
                }
            }

            // For all other fields OR if person not found as owner, search enslaved people
            if (!this.enslavedManager) {
                throw new Error('EnslavedIndividualManager not available');
            }

            // Find the person in enslaved_individuals
            const results = await this.enslavedManager.searchByName(personName);

            if (!results || results.length === 0) {
                return {
                    success: false,
                    message: `❌ Could not find ${personName} in the database. Please upload documents or add individual records first.`
                };
            }

            const person = results[0];
            const enslavedId = person.enslaved_id;

            // Execute the update based on field and action
            switch (field) {
                case 'middle_name':
                    await this.enslavedManager.setMiddleName(enslavedId, value);
                    break;

                case 'alternative_names':
                    await this.enslavedManager.addAlternativeName(enslavedId, value);
                    break;

                case 'familysearch_id':
                    await this.enslavedManager.setFamilySearchId(enslavedId, value);
                    break;

                case 'child_names':
                    // Parse multiple children (comma-separated or "and")
                    const childNames = value.split(/,|\sand\s/i).map(name => name.trim()).filter(n => n.length > 1);
                    let addedCount = 0;
                    for (const childName of childNames) {
                        if (childName && childName.length > 0) {
                            await this.enslavedManager.addChildName(enslavedId, childName);
                            addedCount++;
                        }
                    }
                    return {
                        success: true,
                        message: `Successfully added ${addedCount} children to ${person.full_name}: ${childNames.join(', ')}`
                    };

                case 'spouse_name':
                case 'notes':
                    await this.enslavedManager.updateMetadata(enslavedId, { [field]: value });
                    break;

                default:
                    return {
                        success: false,
                        message: `Unknown field: ${field}`
                    };
            }

            return {
                success: true,
                message: `✓ Updated ${person.full_name}'s ${field.replace(/_/g, ' ')}`
            };

        } catch (error) {
            console.error('Update error:', error);
            return {
                success: false,
                message: `Error updating ${personName}: ${error.message}`
            };
        }
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
            // CHECK IF IN TREE BUILDER MODE
            if (session.treeBuilderState && session.treeBuilderState.mode === 'tree_builder' && session.treeBuilderState.step !== 'complete') {
                const result = await this.treeBuilder.processInput(userQuery, session.treeBuilderState);

                session.treeBuilderState = result.state;

                // If complete, exit tree builder mode
                if (result.complete) {
                    delete session.treeBuilderState;
                }

                return {
                    success: true,
                    response: result.message,
                    intent: 'build_tree',
                    source: 'tree-builder'
                };
            }

            // DETECT COMPLEX GENEALOGY DATA (not in tree builder mode)
            // If user pastes complex data with children/grandchildren outside tree builder mode
            const complexDataPattern = /grandchildren|children.*children|had.*child.*child/i;
            const hasComplexData = complexDataPattern.test(userQuery) && userQuery.length > 200;

            if (hasComplexData && !session.treeBuilderState) {
                return {
                    success: true,
                    response: `🌳 I detected complex genealogy data!\n\nTo add multi-generation family trees, please use the **Tree Builder**.\n\nType: **"build tree"** to start the guided tree builder.\n\nIt will walk you through adding:\n- Root ancestor\n- Children\n- Grandchildren\n\n...one step at a time! Much easier than pasting all at once. 😊\n\nThen you can type the information for each person as I ask for it.`,
                    intent: 'complex_data_detected',
                    source: 'nlp-assistant'
                };
            }

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

            if (intent === 'update_person') {
                // Handle metadata updates
                const updateInfo = this.parseMetadataUpdate(processedQuery);

                if (updateInfo.personName && updateInfo.field && updateInfo.value) {
                    const result = await this.executeUpdate(
                        updateInfo.personName,
                        updateInfo.field,
                        updateInfo.value,
                        updateInfo.action
                    );

                    // Check if update failed
                    if (!result.success) {
                        return {
                            success: false,
                            error: result.message,
                            response: result.message,
                            intent: 'update_person'
                        };
                    }

                    response = result.message;
                    session.lastPerson = updateInfo.personName;
                } else {
                    response = `I couldn't understand that update. Try:\n` +
                               `- "Adjua's middle name is Maria"\n` +
                               `- "Adjua also goes by Adjwa"\n` +
                               `- "Adjua's FamilySearch ID is XXXX-XXX"\n` +
                               `- "Adjua's children were John, Mary, and Sarah"`;
                }

            } else if (intent === 'statistics') {
                data.stats = await this.database.getStats();
                response = this.formatResponse(intent, data, null, session);

            } else if (intent === 'count_descendants') {
                // Handle descendant counting
                data = await this.handleCountDescendants(personName || session.lastPerson);
                response = this.formatGenealogyResponse(intent, data, session);

            } else if (intent === 'living_descendants') {
                // Handle living descendants estimation
                data = await this.handleLivingDescendants(personName || session.lastPerson);
                response = this.formatGenealogyResponse(intent, data, session);

            } else if (intent === 'descendant_shares') {
                // Handle reparations distribution calculation
                data = await this.handleDescendantShares(personName, session);
                response = this.formatGenealogyResponse(intent, data, session);

            } else if (intent === 'build_tree') {
                // START TREE BUILDER MODE
                session.treeBuilderState = this.treeBuilder.initializeSession(sessionId);
                const result = await this.treeBuilder.processInput(userQuery, session.treeBuilderState);

                session.treeBuilderState = result.state;

                return {
                    success: true,
                    response: result.message,
                    intent: 'build_tree',
                    source: 'tree-builder'
                };

            } else if (intent === 'view_document') {
                // HANDLE DOCUMENT VIEWING
                data = await this.searchDocuments(personName || session.lastPerson);
                response = this.formatDocumentResponse(data, personName || session.lastPerson);

                // Store documents in session for frontend to retrieve
                session.lastDocuments = data.documents || [];

                return {
                    success: true,
                    response,
                    intent: 'view_document',
                    documents: data.documents || [],
                    personName: personName || session.lastPerson,
                    source: 'free-nlp'
                };

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

    // ============================================
    // GENEALOGY QUERY HANDLERS
    // ============================================

    /**
     * Handle count_descendants intent
     */
    async handleCountDescendants(personName) {
        if (!this.descendantTreeBuilder) {
            return {
                error: 'Genealogy features not available. DescendantTreeBuilder not configured.'
            };
        }

        try {
            // Find person in enslaved_individuals table
            const personResult = await this.database.query(`
                SELECT enslaved_id, full_name, birth_year, death_year
                FROM enslaved_individuals
                WHERE full_name ILIKE $1
                LIMIT 1
            `, [`%${personName}%`]);

            if (!personResult.rows || personResult.rows.length === 0) {
                return {
                    error: `Person "${personName}" not found in genealogy database`
                };
            }

            const person = personResult.rows[0];

            // Count descendants
            const counts = await this.descendantTreeBuilder.countAllDescendants(person.enslaved_id);

            return {
                success: true,
                person,
                counts
            };

        } catch (error) {
            console.error('Error counting descendants:', error);
            return {
                error: error.message
            };
        }
    }

    /**
     * Handle living_descendants intent
     */
    async handleLivingDescendants(personName) {
        if (!this.descendantTreeBuilder) {
            return {
                error: 'Genealogy features not available'
            };
        }

        try {
            // Find person
            const personResult = await this.database.query(`
                SELECT enslaved_id, full_name
                FROM enslaved_individuals
                WHERE full_name ILIKE $1
                LIMIT 1
            `, [`%${personName}%`]);

            if (!personResult.rows || personResult.rows.length === 0) {
                return {
                    error: `Person "${personName}" not found`
                };
            }

            const person = personResult.rows[0];

            // Estimate living descendants
            const livingData = await this.descendantTreeBuilder.estimateLivingDescendants(person.enslaved_id);

            return {
                success: true,
                person,
                livingData
            };

        } catch (error) {
            console.error('Error estimating living descendants:', error);
            return {
                error: error.message
            };
        }
    }

    /**
     * Handle descendant_shares intent
     */
    async handleDescendantShares(personName, session) {
        if (!this.descendantTreeBuilder) {
            return {
                error: 'Genealogy features not available'
            };
        }

        try {
            // If no person name, use session context
            if (!personName && session.lastPerson) {
                personName = session.lastPerson;
            }

            if (!personName) {
                return {
                    error: 'Please specify a person, e.g., "distribute reparations for James Hopewell"'
                };
            }

            // Find person
            const personResult = await this.database.query(`
                SELECT ei.enslaved_id, ei.full_name, ei.birth_year, ei.death_year,
                       d.total_reparations
                FROM enslaved_individuals ei
                LEFT JOIN documents d ON d.owner_name ILIKE ei.full_name
                WHERE ei.full_name ILIKE $1
                LIMIT 1
            `, [`%${personName}%`]);

            if (!personResult.rows || personResult.rows.length === 0) {
                return {
                    error: `Person "${personName}" not found`
                };
            }

            const person = personResult.rows[0];
            const totalReparations = person.total_reparations || 1000000; // Default $1M if not set

            // Calculate distribution
            const distribution = await this.descendantTreeBuilder.distributeReparations(
                person.enslaved_id,
                totalReparations
            );

            return {
                success: true,
                person,
                distribution
            };

        } catch (error) {
            console.error('Error calculating shares:', error);
            return {
                error: error.message
            };
        }
    }

    /**
     * Format genealogy responses
     */
    formatGenealogyResponse(intent, data, session) {
        let response = '';

        switch (intent) {
            case 'count_descendants':
                if (data.error) {
                    response = `❌ ${data.error}`;
                } else if (data.counts) {
                    const person = data.person;
                    const counts = data.counts;

                    response = `${person.full_name} has **${counts.total} known descendants** across ${Object.keys(counts.byGeneration).length} generations:\n\n`;

                    Object.entries(counts.byGeneration)
                        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                        .forEach(([gen, count]) => {
                            const genLabel = this.getGenerationLabel(parseInt(gen));
                            response += `  • Generation ${gen} (${genLabel}): ${count}\n`;
                        });

                    response += `\n💡 Ask "show me living descendants" or "calculate reparations distribution" for more details.`;

                    session.lastPerson = person.full_name;
                    session.lastPersonType = 'enslaved';
                }
                break;

            case 'living_descendants':
                if (data.error) {
                    response = `❌ ${data.error}`;
                } else if (data.livingData) {
                    const person = data.person;
                    const ld = data.livingData;

                    response = `${person.full_name} has approximately **${ld.estimatedLiving} living descendants** (out of ${ld.total} total).\n\n`;
                    response += `📊 Breakdown:\n`;
                    response += `  • Living (estimated): ${ld.estimatedLiving}\n`;
                    response += `  • Deceased: ${ld.deceased}\n`;
                    response += `  • Total descendants: ${ld.total}\n\n`;
                    response += `ℹ️ ${ld.methodology}`;

                    session.lastPerson = person.full_name;
                }
                break;

            case 'descendant_shares':
                if (data.error) {
                    response = `❌ ${data.error}`;
                } else if (data.distribution) {
                    const person = data.person;
                    const dist = data.distribution;

                    response = `💰 Reparations Distribution for ${person.full_name}\n\n`;
                    response += `Total Reparations: $${this.formatMoney(dist.totalAmount)}\n`;
                    response += `Living Descendants: ${dist.recipientCount}\n`;
                    response += `Amount Distributed: $${this.formatMoney(dist.distributedAmount)}\n\n`;

                    response += `📋 Top 10 Recipients:\n`;
                    dist.distributions.slice(0, 10).forEach((d, i) => {
                        response += `${i + 1}. ${d.fullName} (Gen ${d.generation}): $${this.formatMoney(d.amount)} (${d.sharePercentage}%)\n`;
                    });

                    if (dist.distributions.length > 10) {
                        response += `\n... and ${dist.distributions.length - 10} more recipients.`;
                    }

                    response += `\n\n💡 Earlier generations receive larger shares due to generation multipliers.`;

                    session.lastPerson = person.full_name;
                }
                break;

            default:
                response = 'Genealogy query result not formatted';
        }

        return response;
    }

    /**
     * Get generation label (children, grandchildren, etc.)
     */
    getGenerationLabel(gen) {
        const labels = {
            1: 'Children',
            2: 'Grandchildren',
            3: 'Great-grandchildren',
            4: '2nd great-grandchildren',
            5: '3rd great-grandchildren',
            6: '4th great-grandchildren',
            7: '5th great-grandchildren',
            8: '6th great-grandchildren'
        };
        return labels[gen] || `${gen}th generation`;
    }

    /**
     * Format money amounts
     */
    formatMoney(amount) {
        if (amount >= 1000000) {
            return (amount / 1000000).toFixed(2) + 'M';
        } else if (amount >= 1000) {
            return (amount / 1000).toFixed(2) + 'K';
        }
        return amount.toFixed(2);
    }

    // ============================================
    // DOCUMENT VIEWING METHODS
    // ============================================

    /**
     * Search for documents related to a person
     */
    async searchDocuments(personName) {
        if (!personName) {
            return {
                success: false,
                documents: [],
                error: 'No person specified'
            };
        }

        try {
            // Normalize search term for name variations (D'Wolf, DeWolf, etc.)
            const normalizedSearch = personName
                .toLowerCase()
                .replace(/['\s-]/g, '')
                .replace(/^de/, 'd');

            const searchQuery = `
                WITH normalized_search AS (
                    SELECT $1::text as original_search, $2::text as normalized_search
                ),
                doc_matches AS (
                    SELECT DISTINCT
                        d.document_id,
                        d.owner_name,
                        d.filename,
                        d.doc_type,
                        d.file_size,
                        d.mime_type,
                        d.owner_location,
                        d.created_at,
                        'owner' as match_type
                    FROM documents d, normalized_search ns
                    WHERE LOWER(d.owner_name) LIKE '%' || LOWER(ns.original_search) || '%'
                       OR LOWER(REPLACE(REPLACE(REPLACE(d.owner_name, '''', ''), ' ', ''), '-', ''))
                          LIKE '%' || ns.normalized_search || '%'
                ),
                individual_matches AS (
                    SELECT DISTINCT
                        d.document_id,
                        d.owner_name,
                        d.filename,
                        d.doc_type,
                        d.file_size,
                        d.mime_type,
                        d.owner_location,
                        d.created_at,
                        'individual' as match_type
                    FROM documents d
                    INNER JOIN document_individuals di ON d.document_id = di.document_id
                    INNER JOIN individuals i ON di.individual_id = i.individual_id, normalized_search ns
                    WHERE LOWER(i.full_name) LIKE '%' || LOWER(ns.original_search) || '%'
                       OR LOWER(REPLACE(REPLACE(REPLACE(i.full_name, '''', ''), ' ', ''), '-', ''))
                          LIKE '%' || ns.normalized_search || '%'
                ),
                enslaved_matches AS (
                    SELECT DISTINCT
                        d.document_id,
                        d.owner_name,
                        d.filename,
                        d.doc_type,
                        d.file_size,
                        d.mime_type,
                        d.owner_location,
                        d.created_at,
                        'enslaved' as match_type
                    FROM documents d
                    INNER JOIN enslaved_people ep ON d.document_id = ep.document_id, normalized_search ns
                    WHERE LOWER(ep.name) LIKE '%' || LOWER(ns.original_search) || '%'
                       OR LOWER(REPLACE(REPLACE(REPLACE(ep.name, '''', ''), ' ', ''), '-', ''))
                          LIKE '%' || ns.normalized_search || '%'
                )
                SELECT * FROM doc_matches
                UNION
                SELECT * FROM individual_matches
                UNION
                SELECT * FROM enslaved_matches
                ORDER BY created_at DESC
                LIMIT 20
            `;

            const result = await this.database.query(searchQuery, [personName, normalizedSearch]);

            return {
                success: true,
                documents: result.rows || [],
                count: result.rows ? result.rows.length : 0
            };

        } catch (error) {
            console.error('Document search error:', error);
            return {
                success: false,
                documents: [],
                error: error.message
            };
        }
    }

    /**
     * Format document search results for chat response
     */
    formatDocumentResponse(data, personName) {
        if (!data.success || !data.documents || data.documents.length === 0) {
            return `❌ I couldn't find any documents for ${personName}.\n\nTry:\n` +
                   `• Checking the spelling\n` +
                   `• Searching by first or last name only\n` +
                   `• Using the search bar above to browse all documents`;
        }

        const count = data.documents.length;
        const plural = count !== 1 ? 's' : '';

        let response = `📄 **Found ${count} document${plural} for ${personName}:**\n\n`;

        data.documents.forEach((doc, index) => {
            const docType = (doc.doc_type || 'unknown').toUpperCase();
            const fileSize = (doc.file_size / 1024).toFixed(1);
            const uploadDate = new Date(doc.created_at).toLocaleDateString();

            response += `${index + 1}. **${doc.filename}**\n`;
            response += `   • Type: ${docType}\n`;
            response += `   • Owner: ${doc.owner_name}\n`;
            if (doc.owner_location) {
                response += `   • Location: ${doc.owner_location}\n`;
            }
            response += `   • Size: ${fileSize} KB\n`;
            response += `   • Uploaded: ${uploadDate}\n`;
            response += `   • Match: ${doc.match_type}\n\n`;
        });

        response += `💡 **To view these documents:**\n`;
        response += `• Use the search bar above and enter "${personName}"\n`;
        response += `• Click "👁️ View Document" to open in the viewer\n`;
        response += `• Click "⬇️ Download" to save the file\n`;

        return response;
    }
}

module.exports = FreeNLPResearchAssistant;
