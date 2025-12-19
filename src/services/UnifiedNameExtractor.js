/**
 * UnifiedNameExtractor Service
 *
 * SYSTEM-WIDE name extraction service that ALL scrapers should use.
 * Centralizes:
 * - Name validation (NameValidator)
 * - Document type classification
 * - Columnar layout detection
 * - Family relationship extraction
 * - Value/price extraction
 * - Learning from training data
 *
 * Usage:
 *   const extractor = new UnifiedNameExtractor();
 *   await extractor.initialize(); // Load training data
 *   const result = await extractor.extract(ocrText, { documentType: 'will', source: 'familysearch' });
 */

const NameValidator = require('./NameValidator');
const fs = require('fs');
const path = require('path');

class UnifiedNameExtractor {
    constructor(options = {}) {
        this.options = options;

        // Paths to learned data
        this.patternsFile = options.patternsFile || path.join(__dirname, '../../data/learned-patterns.json');
        this.examplesFile = options.examplesFile || path.join(__dirname, '../../data/training-examples.json');

        // Loaded training data
        this.knownNames = new Set();
        this.knownOwners = new Set();
        this.learnedPatterns = [];
        this.improvementRules = [];

        // Document type indicators (learned + hardcoded)
        this.documentTypeIndicators = {
            bill_of_sale: ['sold', 'purchased', 'buyer', 'seller', 'consideration', 'bargain'],
            mortgage: ['mortgage', 'debt', 'security', 'creditor', 'debtor', 'lien'],
            estate_inventory: ['inventory', 'estate', 'deceased', 'appraisal', 'administrator'],
            will: ['will', 'testament', 'bequeath', 'devise', 'executor', 'heir'],
            plantation_inventory: ['plantation', 'hands', 'negroes', 'slaves', 'workers'],
            workers_list: ['list', 'names', 'roll', 'register'],
            family_chart: ['family', 'wife', 'husband', 'children', 'descendants']
        };

        // African day-names and month-names (valid as enslaved names)
        this.africanDayNames = new Set([
            'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
            'cudjoe', 'cudjo', 'quashee', 'quash', 'quaco', 'cuffee', 'cuffy', 'quamina',
            'juba', 'abba', 'phibbi', 'phoebe', 'amba', 'abena', 'adjua', 'penda', 'phibba'
        ]);

        this.africanMonthNames = new Set([
            'january', 'february', 'march', 'april', 'may', 'june',
            'july', 'august', 'september', 'october', 'november', 'december'
        ]);

        // Common enslaved names (classical, biblical, etc.)
        this.commonEnslavedNames = new Set([
            'prince', 'pompey', 'caesar', 'scipio', 'cato', 'mingo', 'sambo', 'nero',
            'venus', 'flora', 'rose', 'dinah', 'lucy', 'hannah', 'jenny', 'nancy',
            'betty', 'molly', 'sarah', 'mary', 'tom', 'jack', 'harry', 'ben', 'sam',
            'joe', 'will', 'dick', 'peter', 'charles', 'george', 'john', 'james',
            'isaac', 'moses', 'abraham', 'daniel', 'jacob', 'david', 'solomon',
            'rachel', 'rebecca', 'ruth', 'esther', 'hagar', 'leah', 'martha', 'agnes',
            'adam', 'bob', 'cato', 'frank', 'henry', 'jim', 'lewis', 'ned', 'phil',
            'robin', 'stepney', 'tony', 'york', 'affey', 'bella', 'celia', 'delia',
            'eliza', 'fanny', 'grace', 'harriet', 'judy', 'kate', 'lizette', 'milly',
            'patsy', 'peggy', 'sally', 'sue', 'tilly', 'winney'
        ]);

        // Family relationship keywords
        this.relationshipKeywords = {
            parent: ['mother', 'father', 'parent', 'mama', 'daddy'],
            child: ['child', 'son', 'daughter', 'children', 'boy', 'girl'],
            spouse: ['wife', 'husband', 'spouse'],
            grandparent: ['grandmother', 'grandfather', 'grandparent', 'granny'],
            grandchild: ['grandchild', 'grandson', 'granddaughter']
        };

        // Stats for feedback
        this.stats = {
            documentsProcessed: 0,
            namesExtracted: 0,
            namesRejected: 0,
            familyGroupsFound: 0
        };

        console.log('UnifiedNameExtractor initialized');
    }

    /**
     * Initialize by loading training data
     */
    async initialize() {
        try {
            // Load learned patterns
            if (fs.existsSync(this.patternsFile)) {
                const patternsData = JSON.parse(fs.readFileSync(this.patternsFile, 'utf8'));
                this.knownNames = new Set(patternsData.knownNames || []);
                this.knownOwners = new Set(patternsData.knownOwners || []);
                this.learnedPatterns = patternsData.patterns || [];
                this.improvementRules = patternsData.improvementRules || [];

                console.log(`Loaded: ${this.knownNames.size} known names, ${this.knownOwners.size} known owners, ${this.learnedPatterns.length} patterns`);
            } else {
                console.log('No learned patterns file found - using defaults only');
            }

            // Merge known names with common enslaved names
            this.commonEnslavedNames.forEach(name => this.knownNames.add(name));
            this.africanDayNames.forEach(name => this.knownNames.add(name));

        } catch (error) {
            console.error('Failed to load training data:', error.message);
        }
    }

    /**
     * Main extraction method - call this from any scraper
     *
     * @param {string} text - OCR or transcript text
     * @param {Object} metadata - Document metadata
     * @returns {Object} Extraction results
     */
    async extract(text, metadata = {}) {
        if (!text || text.trim().length < 20) {
            return {
                success: false,
                error: 'Text too short',
                enslavedPersons: [],
                slaveholders: [],
                familyGroups: [],
                documentType: 'unknown'
            };
        }

        this.stats.documentsProcessed++;

        // Step 1: Classify document type
        const documentType = metadata.documentType || this.classifyDocumentType(text);

        // Step 2: Detect layout (columnar vs narrative)
        const layout = this.detectLayout(text);

        // Step 3: Extract names based on layout and document type
        let enslavedPersons = [];
        let slaveholders = [];

        if (layout.isColumnar) {
            // Use columnar extraction
            const columnResults = this.extractFromColumns(text, layout);
            enslavedPersons = columnResults.enslaved;
            slaveholders = columnResults.owners;
        } else {
            // Use narrative extraction
            const narrativeResults = this.extractFromNarrative(text, documentType);
            enslavedPersons = narrativeResults.enslaved;
            slaveholders = narrativeResults.owners;
        }

        // Step 4: Extract family relationships
        const familyGroups = this.extractFamilyRelationships(text, enslavedPersons);

        // Step 5: Extract values/prices
        const values = this.extractValues(text);

        // Step 6: Associate values with names
        this.associateValuesWithNames(enslavedPersons, values, text);

        // Update stats
        this.stats.namesExtracted += enslavedPersons.length;
        this.stats.familyGroupsFound += familyGroups.length;

        return {
            success: true,
            documentType,
            layout: layout.type,
            enslavedPersons,
            slaveholders,
            familyGroups,
            values,
            stats: {
                extracted: enslavedPersons.length,
                rejected: this.stats.namesRejected,
                familyGroups: familyGroups.length
            }
        };
    }

    /**
     * Classify document type from text content
     */
    classifyDocumentType(text) {
        const normalizedText = text.toLowerCase();
        const scores = {};

        for (const [type, indicators] of Object.entries(this.documentTypeIndicators)) {
            scores[type] = indicators.filter(ind => normalizedText.includes(ind)).length;
        }

        // Find type with highest score
        let maxScore = 0;
        let bestType = 'unknown';
        for (const [type, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                bestType = type;
            }
        }

        return bestType;
    }

    /**
     * Detect if text has columnar layout
     */
    detectLayout(text) {
        const lines = text.split('\n').filter(l => l.trim().length > 0);

        // Check for columnar indicators:
        // 1. Multiple spaces (>3) between words in most lines
        // 2. Tab characters
        // 3. Consistent spacing patterns

        let columnarLines = 0;
        let tabLines = 0;
        const spacingPatterns = [];

        for (const line of lines) {
            // Check for multiple spaces
            if (/\s{4,}/.test(line)) {
                columnarLines++;
                // Record spacing positions
                const matches = [...line.matchAll(/\s{4,}/g)];
                spacingPatterns.push(matches.map(m => m.index));
            }
            // Check for tabs
            if (line.includes('\t')) {
                tabLines++;
            }
        }

        const isColumnar = (columnarLines / lines.length) > 0.3 || (tabLines / lines.length) > 0.2;

        // Try to detect number of columns
        let columnCount = 1;
        if (isColumnar && spacingPatterns.length > 0) {
            // Find most common gap positions
            const allGaps = spacingPatterns.flat();
            const gapBuckets = {};
            allGaps.forEach(gap => {
                const bucket = Math.round(gap / 10) * 10; // Group by 10-char buckets
                gapBuckets[bucket] = (gapBuckets[bucket] || 0) + 1;
            });

            // Count significant gaps (appearing in >20% of lines)
            const significantGaps = Object.values(gapBuckets).filter(count =>
                count > spacingPatterns.length * 0.2
            ).length;

            columnCount = significantGaps + 1;
        }

        return {
            isColumnar,
            type: isColumnar ? `${columnCount}_columns` : 'narrative',
            columnCount,
            totalLines: lines.length,
            columnarLines
        };
    }

    /**
     * Extract names from columnar layout
     */
    extractFromColumns(text, layout) {
        const enslaved = [];
        const owners = [];
        const foundNames = new Set();
        const lines = text.split('\n');

        for (const line of lines) {
            // Split line by large whitespace gaps
            const parts = line.split(/\s{3,}/).map(p => p.trim()).filter(p => p.length > 0);

            for (const part of parts) {
                // Try to extract name from each part
                const nameMatch = part.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
                if (nameMatch) {
                    const name = nameMatch[1].trim();
                    const key = name.toLowerCase();

                    if (!foundNames.has(key)) {
                        const validation = this.validateName(name, part);
                        if (validation.valid) {
                            foundNames.add(key);

                            // Determine person type from context
                            const isOwner = this.isLikelyOwner(name, part);

                            const person = {
                                name,
                                context: part,
                                confidence: validation.confidence,
                                source: 'columnar_extraction'
                            };

                            // Extract additional info from context
                            this.enrichPersonData(person, part);

                            if (isOwner) {
                                owners.push(person);
                            } else {
                                enslaved.push(person);
                            }
                        } else {
                            this.stats.namesRejected++;
                        }
                    }
                }
            }
        }

        return { enslaved, owners };
    }

    /**
     * Extract names from narrative text
     */
    extractFromNarrative(text, documentType) {
        const enslaved = [];
        const owners = [];
        const foundNames = new Set();
        const normalizedText = text.replace(/\s+/g, ' ').trim();

        // Patterns for enslaved persons
        const enslavedPatterns = [
            // "Negro/Negroe [Name]" or "slave [Name]"
            /(?:negro(?:e|es)?|slave|mulatto|colou?red?)\s+([A-Z][a-z]+)/gi,
            // "[Name] a negro/slave"
            /\b([A-Z][a-z]+)\s+(?:a\s+)?(?:negro|slave|servant|mulatto)/gi,
            // "my/the [role] [Name]" - e.g., "my driver Moses"
            /\b(?:my|the|our|his|her)\s+(?:driver|cook|servant|slave|man|woman|boy|girl|nurse|gardener)\s+([A-Z][a-z]+)/gi,
            // "[Name], aged [number]" or "[Name] aged [number]"
            /\b([A-Z][a-z]+),?\s+aged?\s+(\d+)/gi,
            // "Old/Young [Name]"
            /\b(?:old|young|little|big)\s+([A-Z][a-z]+)/gi,
            // "[Name] and her/his child"
            /\b([A-Z][a-z]+)\s+and\s+(?:his|her)\s+child/gi,
            // Standalone known names (from training data)
            /\b([A-Z][a-z]+)\b/g
        ];

        // Patterns for slaveholders
        const ownerPatterns = [
            // "Mr./Mrs./Dr./Col. [Name]"
            /\b(?:Mr\.|Mrs\.|Dr\.|Col\.|Capt\.|Hon\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
            // Known owner family names (Ravenel, Porcher, etc.)
            /\b(Ravenel|Porcher|Pringle|Middleton|Pinckney|Coffin|Hopewell)(?:\s+[A-Z][a-z]+)?/gi,
            // "[Name], Esq." or "[Name], Esquire"
            /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+(?:Esq\.?|Esquire)/gi
        ];

        // Extract enslaved persons
        for (const pattern of enslavedPatterns) {
            let match;
            while ((match = pattern.exec(normalizedText)) !== null) {
                const name = match[1]?.trim();
                if (!name) continue;

                const key = name.toLowerCase();
                if (foundNames.has(key)) continue;

                // Skip if it's a known owner
                if (this.knownOwners.has(key)) continue;

                const validation = this.validateName(name, match[0]);
                if (validation.valid) {
                    // Extra check: is this likely an enslaved person?
                    const isKnownEnslaved = this.knownNames.has(key) ||
                        this.commonEnslavedNames.has(key) ||
                        this.africanDayNames.has(key);

                    // Standalone names only count if they're known
                    if (pattern.source === '\\b([A-Z][a-z]+)\\b' && !isKnownEnslaved) {
                        continue;
                    }

                    foundNames.add(key);

                    const person = {
                        name,
                        context: match[0],
                        confidence: validation.confidence,
                        source: 'narrative_extraction'
                    };

                    this.enrichPersonData(person, match[0]);
                    enslaved.push(person);
                } else {
                    this.stats.namesRejected++;
                }
            }
        }

        // Extract slaveholders
        for (const pattern of ownerPatterns) {
            let match;
            while ((match = pattern.exec(normalizedText)) !== null) {
                const name = match[1]?.trim() || match[0]?.trim();
                if (!name) continue;

                const key = name.toLowerCase();
                if (foundNames.has(key)) continue;

                const validation = NameValidator.validate(name);
                if (validation.valid) {
                    foundNames.add(key);
                    owners.push({
                        name,
                        context: match[0],
                        confidence: validation.confidence,
                        source: 'narrative_extraction'
                    });
                }
            }
        }

        return { enslaved, owners };
    }

    /**
     * Validate a name using NameValidator + training data
     */
    validateName(name, context) {
        // First check against NameValidator
        const basicValidation = NameValidator.validate(name);
        if (!basicValidation.valid) {
            return basicValidation;
        }

        const normalized = name.toLowerCase();

        // Boost confidence if in known names
        if (this.knownNames.has(normalized) || this.commonEnslavedNames.has(normalized)) {
            return {
                valid: true,
                confidence: Math.max(basicValidation.confidence, 0.9),
                reason: 'Known enslaved name'
            };
        }

        // Check if African day-name used in date context (false positive)
        if (this.africanDayNames.has(normalized) || this.africanMonthNames.has(normalized)) {
            // Check context for date patterns
            const datePattern = /\d{1,2}\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;
            if (context && datePattern.test(context)) {
                return {
                    valid: false,
                    confidence: 0,
                    reason: 'Day/month name in date context'
                };
            }
            // Otherwise it's likely a valid name
            return {
                valid: true,
                confidence: 0.85,
                reason: 'African day-name'
            };
        }

        return basicValidation;
    }

    /**
     * Check if a name is likely a slaveholder (not enslaved)
     */
    isLikelyOwner(name, context) {
        const normalized = name.toLowerCase();

        // Check if in known owners
        if (this.knownOwners.has(normalized)) {
            return true;
        }

        // Check for title prefixes in context
        const titlePattern = /(?:Mr\.|Mrs\.|Dr\.|Col\.|Capt\.|Hon\.|Esq)/i;
        if (titlePattern.test(context)) {
            return true;
        }

        // Check for two-part names (First Last) which are more common for owners
        if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(name)) {
            // But some enslaved people also have two-part names
            // Check if it's in a list context (likely enslaved)
            if (/^\s*-|\d+\.\s*/.test(context)) {
                return false;
            }
            return true; // Default to owner for two-part names
        }

        return false;
    }

    /**
     * Enrich person data with additional info from context
     */
    enrichPersonData(person, context) {
        // Extract age
        const ageMatch = context.match(/aged?\s*(\d+)/i);
        if (ageMatch) {
            person.age = parseInt(ageMatch[1], 10);
        }

        // Extract gender hints
        const femaleHints = ['she', 'her', 'woman', 'girl', 'wife', 'mother', 'daughter', 'nurse', 'cook'];
        const maleHints = ['he', 'his', 'man', 'boy', 'husband', 'father', 'son', 'driver', 'carpenter'];

        const contextLower = context.toLowerCase();
        if (femaleHints.some(h => contextLower.includes(h))) {
            person.gender = 'female';
        } else if (maleHints.some(h => contextLower.includes(h))) {
            person.gender = 'male';
        }

        // Extract occupation
        const occupations = [
            'driver', 'cook', 'nurse', 'carpenter', 'blacksmith', 'gardener',
            'watchman', 'seamstress', 'laundress', 'coachman', 'butler', 'maid'
        ];
        for (const occ of occupations) {
            if (contextLower.includes(occ)) {
                person.occupation = occ;
                break;
            }
        }

        // Check for physical descriptions
        const physicalMatch = context.match(/\(([^)]+)\)/);
        if (physicalMatch) {
            person.physicalDescription = physicalMatch[1];
        }
    }

    /**
     * Extract family relationships from text
     */
    extractFamilyRelationships(text, persons) {
        const familyGroups = [];
        const normalizedText = text.toLowerCase();
        const personsMap = new Map(persons.map(p => [p.name.toLowerCase(), p]));

        // Pattern: "[Name] and [his/her] [wife/children/etc]"
        const relationPatterns = [
            /\b([a-z]+)\s+(?:and\s+)?(?:his|her)\s+wife\s+([a-z]+)/gi,
            /\b([a-z]+)\s+(?:and\s+)?(?:his|her)\s+child(?:ren)?\s+([a-z]+)/gi,
            /\b([a-z]+)\s+mother\s+(?:of\s+)?([a-z]+)/gi,
            /\b([a-z]+)\s+(?:wife|husband)\s+(?:of\s+)?([a-z]+)/gi
        ];

        for (const pattern of relationPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const name1 = match[1];
                const name2 = match[2];

                // Determine relationship type from pattern
                const patternStr = pattern.source;
                let relationType = 'family';
                if (patternStr.includes('wife')) relationType = 'spouse';
                else if (patternStr.includes('child')) relationType = 'parent_child';
                else if (patternStr.includes('mother')) relationType = 'parent_child';

                // Create family group
                familyGroups.push({
                    members: [name1, name2],
                    relationType,
                    context: match[0]
                });

                // Update person records with relationship info
                if (personsMap.has(name1.toLowerCase())) {
                    const person = personsMap.get(name1.toLowerCase());
                    person.relationships = person.relationships || [];
                    person.relationships.push({ type: relationType, relatedTo: name2 });
                }
            }
        }

        return familyGroups;
    }

    /**
     * Extract monetary values from text
     */
    extractValues(text) {
        const values = [];

        // Dollar amounts: $XXX or $X,XXX
        const dollarPattern = /\$\s*([\d,]+(?:\.\d{2})?)/g;
        let match;
        while ((match = dollarPattern.exec(text)) !== null) {
            values.push({
                amount: match[1].replace(/,/g, ''),
                currency: 'USD',
                position: match.index,
                context: text.substring(Math.max(0, match.index - 50), match.index + 50)
            });
        }

        // British pounds: £XXX
        const poundPattern = /£\s*([\d,]+)/g;
        while ((match = poundPattern.exec(text)) !== null) {
            values.push({
                amount: match[1].replace(/,/g, ''),
                currency: 'GBP',
                position: match.index,
                context: text.substring(Math.max(0, match.index - 50), match.index + 50)
            });
        }

        return values;
    }

    /**
     * Associate monetary values with nearby names
     */
    associateValuesWithNames(persons, values, text) {
        for (const person of persons) {
            // Find person's position in text
            const personIndex = text.toLowerCase().indexOf(person.name.toLowerCase());
            if (personIndex === -1) continue;

            // Find nearest value (within 100 chars)
            let nearestValue = null;
            let nearestDistance = Infinity;

            for (const value of values) {
                const distance = Math.abs(value.position - personIndex);
                if (distance < nearestDistance && distance < 100) {
                    nearestDistance = distance;
                    nearestValue = value;
                }
            }

            if (nearestValue) {
                person.value = nearestValue.amount;
                person.currency = nearestValue.currency;
            }
        }
    }

    /**
     * Get extraction statistics
     */
    getStats() {
        return {
            ...this.stats,
            knownNamesCount: this.knownNames.size,
            knownOwnersCount: this.knownOwners.size,
            learnedPatternsCount: this.learnedPatterns.length
        };
    }
}

module.exports = UnifiedNameExtractor;
