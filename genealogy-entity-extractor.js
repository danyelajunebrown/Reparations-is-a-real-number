/**
 * Genealogy Entity Extractor
 *
 * ML-powered extraction of persons, relationships, and genealogical data
 * from ANY text (web pages, documents, etc.)
 *
 * NO external APIs required - pure local NLP
 */

class GenealogyEntityExtractor {
    constructor() {
        // Common words that look like names but aren't
        this.stopWords = new Set([
            'About', 'After', 'Before', 'During', 'Early', 'First', 'Last',
            'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
            'January', 'February', 'March', 'April', 'May', 'June', 'July',
            'August', 'September', 'October', 'November', 'December',
            'County', 'State', 'City', 'Town', 'Village', 'Parish',
            'North', 'South', 'East', 'West', 'New', 'Old', 'Saint',
            'Maryland', 'Virginia', 'Georgia', 'Carolina', 'Mississippi',
            'Alabama', 'Louisiana', 'Texas', 'Kentucky', 'Tennessee',
            // Wikipedia/reference artifacts
            'From Wikipedia', 'General Washington', 'External Links',
            'Further Reading', 'Jump Up', 'See Also', 'Related', 'Authority Control',
            'Library Resources', 'Resources In', 'Archived From', 'Retrieved From',
            // Titles and monuments
            'Mount Vernon', 'Mount Rushmore', 'National Memorial', 'Historic District',
            'Presidential Library', 'United States', 'Seven Years', 'Thirteen Colonies',
            'States Army', 'Continental Army', 'Revolutionary War', 'Civil War',
            // Generic terms
            'Because We', 'How George', 'Did His', 'American Historical'
        ]);

        // Patterns that indicate this is NOT a person name
        this.nonPersonPatterns = [
            /^\d+$/,  // Just numbers
            /^[A-Z\s]+$/,  // ALL CAPS (likely headers)
            /\d{4}/,  // Contains a year (likely bibliography)
            /^(ISBN|ISSN|DOI|pp?\.)/i,  // Reference markers
            /^Vol\.|^No\.|^Ed\./i,  // Volume, Number, Edition
            /^https?:\/\//,  // URLs
            /[@#$%^&*()]/,  // Special characters
        ];

        // Relationship keywords
        // IMPORTANT: Evidence of slave ownership should be captured aggressively
        // Historical efforts were made to erase slavery records
        this.relationshipPatterns = {
            parent_child: [
                /(\w+(?:\s+\w+)*)'s (?:son|daughter|child) (\w+(?:\s+\w+)*)/gi,
                /(\w+(?:\s+\w+)*),\s+(?:son|daughter|child) of (\w+(?:\s+\w+)*)/gi,
                /(\w+(?:\s+\w+)*) had (?:a son|a daughter|a child|children) (?:named |called )?(\w+(?:\s+\w+)*)/gi
            ],
            spouse: [
                /(\w+(?:\s+\w+)*)'s (?:wife|husband|spouse) (\w+(?:\s+\w+)*)/gi,
                /(\w+(?:\s+\w+)*) married (\w+(?:\s+\w+)*)/gi,
                /(\w+(?:\s+\w+)*) and (?:his|her|their) (?:wife|husband|spouse) (\w+(?:\s+\w+)*)/gi
            ],
            enslaved: [
                // Direct ownership statements
                /(\w+(?:\s+\w+)*) enslaved (\w+(?:\s+\w+)*)/gi,
                /(\w+(?:\s+\w+)*) owned (\w+(?:\s+\w+)*)/gi,
                /(\w+(?:\s+\w+)*) held (\w+(?:\s+\w+)*) in (?:slavery|bondage)/gi,

                // Estate/will language
                /(\w+(?:\s+\w+)*) (?:bequeath|bequest|leave|give|devise)(?:ed|s)? (?:his|her|their)? (?:slaves?|negroes?|servants?)/gi,
                /(?:slaves?|negroes?|servants?) of (\w+(?:\s+\w+)*)/gi,
                /(\w+(?:\s+\w+)*)'s (?:slaves?|negroes?|servants?|plantation)/gi,

                // Sale/transfer language
                /(\w+(?:\s+\w+)*) (?:sold|purchased|bought|acquired) (?:slaves?|negroes?)/gi,
                /sold (?:by|from) (\w+(?:\s+\w+)*)/gi,

                // Passive constructions
                /enslaved (?:by|to|under) (\w+(?:\s+\w+)*)/gi,
                /owned by (\w+(?:\s+\w+)*)/gi,

                // Relationship to enslaved person
                /(\w+(?:\s+\w+)*),?\s+(?:an? )?enslaved (?:person|man|woman|child|boy|girl)/gi,
                /(\w+(?:\s+\w+)*),?\s+(?:a )?(?:negro|slave|servant)/gi,

                // Property/inventory language
                /(\w+(?:\s+\w+)*) possessed (?:slaves?|negroes?)/gi,
                /estate of (\w+(?:\s+\w+)*) (?:included|contained|listed) (?:slaves?|negroes?)/gi,

                // Plantation/slaveholder references
                /(\w+(?:\s+\w+)*),?\s+(?:a )?(?:slaveholder|slaveowner|planter|plantation owner)/gi,
                /(\w+(?:\s+\w+)*)'s plantation/gi
            ]
        };

        // Slave ownership indicators (for learning/growing patterns)
        this.slaveOwnershipIndicators = [
            'enslaved', 'slave', 'slaves', 'slavery', 'negro', 'negroes',
            'owned', 'bequeath', 'bequest', 'plantation', 'slaveholder',
            'slaveowner', 'servant', 'servants', 'bondage', 'bondsmen',
            'sold', 'purchased', 'bought', 'acquired', 'possessed',
            'estate', 'inventory', 'will', 'probate', 'planter'
        ];
    }

    /**
     * Extract all persons from text
     * @param {string} text - Raw text to analyze
     * @param {string} sourceUrl - URL where text came from
     * @returns {Promise<Array>} Array of person objects
     */
    async extractPersons(text, sourceUrl = '') {
        console.log('\n  🧠 ML Entity Extraction:');
        console.log(`    • Text length: ${text.length} characters`);

        const persons = [];
        const relationships = [];

        // Step 1: Extract all potential person names
        const names = this.extractNames(text);
        console.log(`    • Found ${names.length} potential names`);

        // Step 2: For each name, extract context and analyze
        for (const name of names) {
            const contexts = this.getContextAroundName(text, name);

            for (const context of contexts) {
                const person = {
                    fullName: name,
                    type: this.classifyPersonType(context),
                    birthYear: this.extractBirthYear(context),
                    deathYear: this.extractDeathYear(context),
                    locations: this.extractLocations(context),
                    gender: this.extractGender(context),
                    confidence: this.calculateConfidence(context, name),
                    evidence: context,
                    sourceUrl: sourceUrl,
                    extractedAt: new Date()
                };

                // Only add if confidence is reasonable
                if (person.confidence >= 0.3) {
                    persons.push(person);
                }
            }
        }

        // Step 3: Extract relationships
        const extractedRelationships = this.extractRelationships(text);
        console.log(`    • Found ${extractedRelationships.length} relationships`);

        console.log(`    ✓ Extracted ${persons.length} persons (confidence >= 30%)`);

        return {
            persons,
            relationships: extractedRelationships
        };
    }

    /**
     * Extract names from text using pattern matching
     */
    extractNames(text) {
        const names = new Set();

        // Pattern 1: Title + First + Last (e.g., "Mr. James Hopewell")
        const titlePattern = /\b(?:Mr\.?|Mrs\.?|Miss|Ms\.?|Dr\.?|Rev\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
        const titleMatches = [...text.matchAll(titlePattern)];
        titleMatches.forEach(match => {
            const context = text.substring(Math.max(0, match.index - 200), Math.min(text.length, match.index + 200));
            if (this.isValidPersonName(match[1], context)) {
                names.add(match[1]);
            }
        });

        // Pattern 2: First + Middle? + Last (capitalized words)
        // Also captures single capitalized words in slavery context
        const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?(?:\s+[A-Z][a-z]+){0,2})\b/g;
        const nameMatches = [...text.matchAll(namePattern)];
        nameMatches.forEach(match => {
            const name = match[1];
            const context = text.substring(Math.max(0, match.index - 200), Math.min(text.length, match.index + 200));
            if (this.isValidPersonName(name, context)) {
                names.add(name);
            }
        });

        // Pattern 3: Names in quotes (e.g., "James Hopewell" or "Caesar")
        const quotedPattern = /"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)"/g;
        const quotedMatches = [...text.matchAll(quotedPattern)];
        quotedMatches.forEach(match => {
            const context = text.substring(Math.max(0, match.index - 200), Math.min(text.length, match.index + 200));
            if (this.isValidPersonName(match[1], context)) {
                names.add(match[1]);
            }
        });

        // Pattern 4: Generic slave references (e.g., "a negro", "three slaves")
        const genericSlavePattern = /\b(a|an|the|one|two|three|four|five|several|many)?\s*(negro|slave|african|servant)s?\b/gi;
        const genericMatches = [...text.matchAll(genericSlavePattern)];
        genericMatches.forEach(match => {
            // Create a placeholder name for counting
            const count = match[1] || 'one';
            names.add(`[${count} ${match[2]}]`); // E.g., "[one negro]", "[three slaves]"
        });

        return Array.from(names);
    }

    /**
     * Validate if a string is likely a real person name
     *
     * IMPORTANT: Enslaved people often listed with single names only.
     * Context is key - if evidence suggests slavery, single names are valid.
     */
    isValidPersonName(name, context = '') {
        const parts = name.trim().split(/\s+/);
        const lower = context.toLowerCase();

        // Single-name validation (for enslaved persons)
        if (parts.length === 1) {
            // Check if context suggests this is an enslaved person
            const slaveryContext = lower.match(/\b(enslaved|slave|negro|african|servant|owned|bequeathed|inherited)\b/i);

            if (slaveryContext) {
                // Allow single names in slavery context
                // Must be at least 2 characters
                if (name.length < 2 || name.length > 50) return false;

                // Should be capitalized or be a generic term
                if (!/^[A-Z]/.test(name) && !this.isGenericSlaveReference(name)) {
                    return false;
                }

                return true;
            }

            // Outside slavery context, single names not valid
            return false;
        }

        // Multi-word name validation (standard)

        // Check stop words (first word)
        if (this.stopWords.has(parts[0])) return false;

        // Check full name against stop words
        if (this.stopWords.has(name)) return false;

        // Check non-person patterns
        for (const pattern of this.nonPersonPatterns) {
            if (pattern.test(name)) return false;
        }

        // Name must be reasonable length
        if (name.length < 4 || name.length > 50) return false;

        // Each part should start with capital letter followed by lowercase
        for (const part of parts) {
            if (part.length > 2) {  // Skip initials like "J."
                if (!/^[A-Z][a-z]+/.test(part)) return false;
            }
        }

        return true;
    }

    /**
     * Check if this is a generic reference to enslaved person(s)
     * E.g., "a negro", "a slave", "three Africans"
     */
    isGenericSlaveReference(text) {
        const lower = text.toLowerCase();
        return lower.match(/\b(negro|slave|slaves|african|africans|servant|servants)\b/i);
    }

    /**
     * Get text context around a name (for analysis)
     */
    getContextAroundName(text, name) {
        const contexts = [];
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedName, 'gi');

        let match;
        while ((match = regex.exec(text)) !== null) {
            const start = Math.max(0, match.index - 200);
            const end = Math.min(text.length, match.index + name.length + 200);
            const context = text.substring(start, end);
            contexts.push(context);
        }

        return contexts;
    }

    /**
     * Classify person type (enslaved, owner, descendant, unknown)
     */
    classifyPersonType(context) {
        const lower = context.toLowerCase();

        // Check for enslaved person indicators
        if (lower.match(/\benslaved\b/i) ||
            lower.match(/\bslave\b/i) ||
            lower.match(/\bservant\b/i) ||
            lower.match(/\bbequeathed to\b/i) ||
            lower.match(/\binherited by\b/i)) {
            return 'enslaved';
        }

        // Check for owner indicators
        if (lower.match(/\bowned\b/i) ||
            lower.match(/\bmaster\b/i) ||
            lower.match(/\bensla(?:ver|veholder)\b/i) ||
            lower.match(/\bestate\b/i) ||
            lower.match(/\bplantation\b/i)) {
            return 'owner';
        }

        // Check for descendant indicators
        if (lower.match(/\bson of\b/i) ||
            lower.match(/\bdaughter of\b/i) ||
            lower.match(/\bchild of\b/i) ||
            lower.match(/\bheir\b/i) ||
            lower.match(/\bdescendant\b/i)) {
            return 'descendant';
        }

        return 'unknown';
    }

    /**
     * Extract birth year from context
     */
    extractBirthYear(context) {
        // Pattern: "born 1780" or "b. 1780" or "(1780-1825)"
        const patterns = [
            /\bborn\s+(?:in\s+)?(\d{4})\b/i,
            /\bb\.?\s+(\d{4})\b/i,
            /\((\d{4})\s*[-–]\s*\d{4}\)/,
            /\bbirthdate:?\s+(\d{4})\b/i
        ];

        for (const pattern of patterns) {
            const match = context.match(pattern);
            if (match) {
                const year = parseInt(match[1]);
                if (year >= 1600 && year <= 2025) {
                    return year;
                }
            }
        }

        return null;
    }

    /**
     * Extract death year from context
     */
    extractDeathYear(context) {
        // Pattern: "died 1825" or "d. 1825" or "(1780-1825)"
        const patterns = [
            /\bdied\s+(?:in\s+)?(\d{4})\b/i,
            /\bd\.?\s+(\d{4})\b/i,
            /\(\d{4}\s*[-–]\s*(\d{4})\)/,
            /\bdeathdate:?\s+(\d{4})\b/i,
            /\bdeceased\s+(\d{4})\b/i
        ];

        for (const pattern of patterns) {
            const match = context.match(pattern);
            if (match) {
                const year = parseInt(match[1]);
                if (year >= 1600 && year <= 2025) {
                    return year;
                }
            }
        }

        return null;
    }

    /**
     * Extract locations from context
     */
    extractLocations(context) {
        const locations = [];

        // Common location patterns
        const patterns = [
            /\b([A-Z][a-z]+),\s+([A-Z][a-z]+)\b/g, // "Baltimore, Maryland"
            /\b([A-Z][a-z]+\s+County)\b/g, // "Anne Arundel County"
            /\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g // "in Maryland"
        ];

        patterns.forEach(pattern => {
            const matches = [...context.matchAll(pattern)];
            matches.forEach(match => {
                locations.push(match[1]);
            });
        });

        return [...new Set(locations)];
    }

    /**
     * Extract gender from context
     */
    extractGender(context) {
        const lower = context.toLowerCase();

        if (lower.match(/\b(he|him|his|man|male|mr|mister|gentleman)\b/)) {
            return 'Male';
        }

        if (lower.match(/\b(she|her|woman|female|mrs|miss|ms|lady)\b/)) {
            return 'Female';
        }

        return null;
    }

    /**
     * Calculate confidence score (0.0 to 1.0)
     *
     * IMPORTANT: Web-scraped data is NEVER confirmed. This score indicates
     * likelihood that this is a real person worth investigating further.
     * Only primary sources can confirm slave ownership/enslaved status.
     */
    calculateConfidence(context, name) {
        let score = 0.3; // Lower base confidence (these are leads, not facts)

        const lower = context.toLowerCase();

        // MAJOR PENALTIES (likely false positives)

        // Bibliography/reference section indicators
        if (lower.match(/\b(isbn|doi|pp\.|vol\.|archived from|retrieved|external links)\b/i)) {
            score -= 0.5;
        }

        // Contains year patterns (often bibliography citations)
        const yearMatches = context.match(/\b\d{4}\b/g);
        if (yearMatches && yearMatches.length > 2) {
            score -= 0.3; // Multiple years = likely bibliography
        }

        // Short context (not enough info)
        if (context.length < 100) {
            score -= 0.3;
        }

        // Headers/titles (often ALL CAPS or short)
        if (context === context.toUpperCase() && context.length < 100) {
            score -= 0.4;
        }

        // POSITIVE SIGNALS (likely real person)

        // Biographical indicators (birth/death)
        if (lower.match(/\bborn\b/i) || lower.match(/\bb\.\s*\d{4}/i)) {
            score += 0.2;
        }
        if (lower.match(/\bdied\b/i) || lower.match(/\bd\.\s*\d{4}/i)) {
            score += 0.2;
        }

        // Has complete birth-death range
        if (lower.match(/\(?\d{4}\s*[-–]\s*\d{4}\)?/)) {
            score += 0.15;
        }

        // Family relationships (strong indicator of real person)
        if (lower.match(/\b(son|daughter|child|wife|husband|mother|father|married)\b/i)) {
            score += 0.15;
        }

        // Genealogical/slavery context
        if (lower.match(/\b(enslaved|slave|owner|plantation|estate|will|probate)\b/i)) {
            score += 0.2;
        }

        // Gender pronouns (indicates biographical text)
        if (lower.match(/\b(he|she|his|her)\b/i)) {
            score += 0.1;
        }

        // Location context (place names)
        if (lower.match(/\b[A-Z][a-z]+,\s+[A-Z][a-z]+\b/)) {
            score += 0.1;
        }

        // Longer context = more reliable
        if (context.length > 200) {
            score += 0.1;
        }

        // Cap the maximum score for web-scraped data at 0.75
        // (reserves 0.76-1.0 for primary source confirmations)
        return Math.max(0.0, Math.min(0.75, score));
    }

    /**
     * Extract relationships from text
     *
     * IMPORTANT: These are LEADS only, not confirmations.
     * Primary sources required to confirm any relationship.
     */
    extractRelationships(text) {
        const relationships = [];

        // Extract parent-child relationships
        this.relationshipPatterns.parent_child.forEach(pattern => {
            const matches = [...text.matchAll(pattern)];
            matches.forEach(match => {
                const person1 = match[2] ? match[2].trim() : '';
                const person2 = match[1] ? match[1].trim() : '';

                // Validate both names before adding
                if (this.isValidPersonName(person1) && this.isValidPersonName(person2)) {
                    relationships.push({
                        type: 'parent-child',
                        person1: person1, // parent
                        person2: person2, // child
                        evidence: match[0],
                        confidence: 0.6, // Lower confidence for web-scraped relationships
                        needsPrimarySource: true
                    });
                }
            });
        });

        // Extract spouse relationships
        this.relationshipPatterns.spouse.forEach(pattern => {
            const matches = [...text.matchAll(pattern)];
            matches.forEach(match => {
                const person1 = match[1] ? match[1].trim() : '';
                const person2 = match[2] ? match[2].trim() : '';

                // Validate both names before adding
                if (this.isValidPersonName(person1) && this.isValidPersonName(person2)) {
                    relationships.push({
                        type: 'spouse',
                        person1: person1,
                        person2: person2,
                        evidence: match[0],
                        confidence: 0.5, // Lower confidence for web-scraped relationships
                        needsPrimarySource: true
                    });
                }
            });
        });

        // Extract enslaved relationships
        // IMPORTANT: Record owners even if enslaved person details are unclear
        // Evidence of ownership matters more than complete slave records
        this.relationshipPatterns.enslaved.forEach(pattern => {
            const matches = [...text.matchAll(pattern)];
            matches.forEach(match => {
                let owner = null;
                let enslaved = null;

                // Try to extract owner name from match
                // Owner is typically the first captured group
                if (match[1]) owner = match[1].trim();

                // Enslaved person might be second group or implicit
                if (match[2]) enslaved = match[2].trim();

                // Validate owner (required)
                const isValidOwner = owner &&
                    owner.length > 3 &&
                    this.isValidPersonName(owner, match[0]);

                if (!isValidOwner) return; // Skip if no valid owner

                // Validate enslaved person (optional - owner is more important)
                let isValidEnslaved = false;
                if (enslaved) {
                    isValidEnslaved = enslaved.length > 1 &&
                        !enslaved.match(/^\d+$/) && // Not just a number
                        !enslaved.match(/^(he|she|they|it)$/i); // Not a pronoun
                }

                // Record relationship
                // Even if we don't have enslaved person details, we have ownership evidence
                relationships.push({
                    type: 'enslaved-by',
                    enslaved: isValidEnslaved ? enslaved : '[unknown enslaved person]',
                    owner: owner,
                    evidence: match[0],
                    confidence: isValidEnslaved ? 0.7 : 0.6, // Lower confidence if enslaved unknown
                    needsPrimarySource: true // CRITICAL: Must verify with primary sources
                });
            });
        });

        return relationships;
    }

    /**
     * Extract data from tables (often used for genealogical data)
     */
    extractFromTable(table) {
        const persons = [];

        // Check if table has genealogical headers
        const headers = table.headers.map(h => h.toLowerCase());

        const nameCol = headers.findIndex(h => h.includes('name'));
        const birthCol = headers.findIndex(h => h.includes('birth'));
        const deathCol = headers.findIndex(h => h.includes('death'));
        const relationCol = headers.findIndex(h => h.includes('relation'));

        if (nameCol >= 0) {
            table.rows.forEach(row => {
                const person = {
                    fullName: row[nameCol],
                    birthYear: birthCol >= 0 ? this.parseYear(row[birthCol]) : null,
                    deathYear: deathCol >= 0 ? this.parseYear(row[deathCol]) : null,
                    type: 'unknown',
                    confidence: 0.7,
                    evidence: `From table: ${row.join(', ')}`,
                    extractedAt: new Date()
                };

                if (person.fullName) {
                    persons.push(person);
                }
            });
        }

        return persons;
    }

    /**
     * Parse year from string
     */
    parseYear(str) {
        const match = str.match(/\b(\d{4})\b/);
        return match ? parseInt(match[1]) : null;
    }
}

module.exports = GenealogyEntityExtractor;
