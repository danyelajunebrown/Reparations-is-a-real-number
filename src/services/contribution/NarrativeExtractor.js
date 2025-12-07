/**
 * NarrativeExtractor - AI-powered extraction from narrative text
 *
 * This service extracts structured slavery-related data from prose/narrative text.
 * It identifies slaveholders, enslaved persons, dates, relationships, and other
 * relevant information even when the source is not in tabular format.
 */

const natural = require('natural');
const logger = require('../../utils/logger');

class NarrativeExtractor {
    constructor() {
        // Initialize NLP tools
        this.tokenizer = new natural.WordTokenizer();
        this.sentenceTokenizer = new natural.SentenceTokenizer();
        this.tfidf = new natural.TfIdf();

        // Slavery-related keywords for context detection
        this.slaveryKeywords = {
            ownership: ['slave', 'slaves', 'enslaved', 'owned', 'owner', 'slaveholder', 'slaveowner',
                       'master', 'mistress', 'property', 'chattel', 'bondsman', 'bondwoman'],
            transaction: ['sold', 'purchased', 'bought', 'inherited', 'bequeathed', 'manumit',
                         'manumission', 'freed', 'emancipated', 'compensation', 'deed'],
            description: ['negro', 'negroe', 'colored', 'mulatto', 'black', 'african'],
            gender: ['male', 'female', 'man', 'woman', 'boy', 'girl'],
            relationship: ['wife', 'husband', 'child', 'children', 'son', 'daughter', 'mother',
                          'father', 'family'],
            legal: ['will', 'testament', 'estate', 'inventory', 'census', 'record', 'register']
        };

        // Patterns for extracting specific data types
        this.patterns = {
            // Date patterns
            year: /\b(1[6-8]\d{2})\b/g,
            fullDate: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
            monthYear: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi,

            // Age patterns
            age: /\b(?:aged?|age)\s*(\d{1,3})\b/gi,
            ageRange: /\b(\d{1,2})\s*(?:to|-)\s*(\d{1,2})\s*years?\b/gi,

            // Quantity patterns
            slaveCount: /\b(\d+)\s*(?:slaves?|negroes?|enslaved)\b/gi,

            // Name patterns (Title + Name)
            titleName: /\b(Mr\.|Mrs\.|Miss|Dr\.|Col\.|Gen\.|Capt\.|Rev\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g,

            // Compensation/money
            money: /\$\s*[\d,]+(?:\.\d{2})?|\b\d+\s*dollars?\b/gi
        };
    }

    /**
     * Extract structured data from narrative text
     * @param {string} text - Raw narrative text
     * @param {Object} context - Context about what to look for
     * @returns {Object} Extracted entities and relationships
     */
    async extractFromNarrative(text, context = {}) {
        logger.info('NarrativeExtractor: Starting extraction', {
            textLength: text?.length,
            contextKeys: Object.keys(context)
        });

        const results = {
            slaveholders: [],
            enslavedPersons: [],
            transactions: [],
            relationships: [],
            dates: [],
            locations: [],
            statistics: {},
            rawSentences: [],
            confidence: 0
        };

        if (!text || text.trim().length === 0) {
            return results;
        }

        // Split into sentences for analysis
        const sentences = this.sentenceTokenizer.tokenize(text);

        // Find relevant sentences (those containing slavery-related keywords)
        const relevantSentences = this.findRelevantSentences(sentences);
        results.rawSentences = relevantSentences.map(s => s.text);

        logger.info('NarrativeExtractor: Found relevant sentences', {
            total: sentences.length,
            relevant: relevantSentences.length
        });

        // Extract entities from relevant sentences
        for (const sentence of relevantSentences) {
            // Extract slaveholders
            const slaveholders = this.extractSlaveholders(sentence.text, sentence.context);
            results.slaveholders.push(...slaveholders);

            // Extract enslaved persons
            const enslaved = this.extractEnslavedPersons(sentence.text, sentence.context);
            results.enslavedPersons.push(...enslaved);

            // Extract transactions/events
            const transactions = this.extractTransactions(sentence.text);
            results.transactions.push(...transactions);

            // Extract dates
            const dates = this.extractDates(sentence.text);
            results.dates.push(...dates);
        }

        // Look for specific people mentioned in context
        if (context.targetNames && context.targetNames.length > 0) {
            const targetResults = this.findTargetNames(text, context.targetNames);
            results.targetMatches = targetResults;
        }

        // Deduplicate and consolidate
        results.slaveholders = this.deduplicateEntities(results.slaveholders);
        results.enslavedPersons = this.deduplicateEntities(results.enslavedPersons);
        results.dates = [...new Set(results.dates)];

        // Build relationships between entities
        results.relationships = this.buildRelationships(results, relevantSentences);

        // Calculate statistics
        results.statistics = this.calculateStatistics(results);

        // Calculate overall confidence
        results.confidence = this.calculateConfidence(results, relevantSentences.length);

        logger.info('NarrativeExtractor: Extraction complete', {
            slaveholders: results.slaveholders.length,
            enslaved: results.enslavedPersons.length,
            transactions: results.transactions.length,
            confidence: results.confidence
        });

        return results;
    }

    /**
     * Find sentences that contain slavery-related content
     */
    findRelevantSentences(sentences) {
        const relevant = [];

        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const lower = sentence.toLowerCase();
            const context = [];

            // Check each category of keywords
            for (const [category, keywords] of Object.entries(this.slaveryKeywords)) {
                for (const keyword of keywords) {
                    if (lower.includes(keyword)) {
                        context.push(category);
                        break;
                    }
                }
            }

            // Include if it has slavery-related context
            if (context.length > 0) {
                relevant.push({
                    text: sentence,
                    index: i,
                    context: [...new Set(context)],
                    // Include surrounding sentences for context
                    prevSentence: i > 0 ? sentences[i-1] : null,
                    nextSentence: i < sentences.length - 1 ? sentences[i+1] : null
                });
            }
        }

        return relevant;
    }

    /**
     * Extract slaveholder names from text
     */
    extractSlaveholders(text, context = []) {
        const slaveholders = [];

        // Look for ownership patterns - ordered from most specific to least
        const ownershipPatterns = [
            // "X owned [at least] N slaves" - very reliable pattern
            /([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+(?:\s+(?:Jr\.|Sr\.|I{1,3}|IV|V))?)\s+owned\s+(?:at\s+least\s+)?(?:\d+|some|several|many)\s+slaves?/gi,
            // "X's household included N slaves"
            /([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+(?:\s+(?:Jr\.|Sr\.|I{1,3}|IV|V))?)'s\s+household\s+included\s+(?:\d+|some|several|many)\s+slaves?/gi,
            // "X divided his/her slaves"
            /([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+(?:\s+(?:Jr\.|Sr\.|I{1,3}|IV|V))?)\s+divided\s+(?:his|her|their)\s+slaves?/gi,
            // "X's slaves" when followed by activity
            /([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+(?:\s+(?:Jr\.|Sr\.|I{1,3}|IV|V))?)'s\s+slaves?\s+(?:who|worked|were)/gi,
            // Original patterns
            /([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+(?:\s+(?:Jr\.|Sr\.|I{1,3}|IV|V))?)\s*(?:'s?\s+)?(?:slaves?|owned|enslaved|property)/gi,
            /(?:owned by|belonging to|estate of|property of)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/gi,
            // Title + name near slavery context
            /(?:Mr\.|Mrs\.|Col\.|Gen\.|Dr\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g
        ];

        for (const pattern of ownershipPatterns) {
            let match;
            const regex = new RegExp(pattern.source, pattern.flags);
            while ((match = regex.exec(text)) !== null) {
                const name = match[1]?.trim();
                if (name && name.length > 2 && this.isLikelyName(name)) {
                    // Extract slave count if present
                    const countMatch = match[0].match(/(\d+)\s+slaves?/i);
                    const slaveCount = countMatch ? parseInt(countMatch[1]) : null;

                    slaveholders.push({
                        name: name,
                        role: 'slaveholder',
                        slaveCount: slaveCount,
                        context: context,
                        source: text.substring(Math.max(0, match.index - 20), match.index + match[0].length + 20),
                        confidence: this.calculateNameConfidence(name, text)
                    });
                }
            }
        }

        return slaveholders;
    }

    /**
     * Extract enslaved persons from text
     */
    extractEnslavedPersons(text, context = []) {
        const enslaved = [];
        const lower = text.toLowerCase();

        // Common words that should NOT be extracted as names
        const notNames = ['a', 'an', 'the', 'his', 'her', 'their', 'with', 'from', 'to',
                         'of', 'by', 'for', 'and', 'or', 'was', 'were', 'been', 'being',
                         'buy', 'sell', 'sold', 'bought', 'owned', 'free', 'freed',
                         'freeing', 'divided', 'born', 'died', 'living', 'worked'];

        // Patterns for enslaved persons - these should be specific
        const patterns = [
            // "slave named X" or "negro named X" - most reliable
            /(?:slave|negro|negroe|enslaved\s+(?:person|man|woman|child))\s+(?:named|called)\s+([A-Z][a-z]+)/gi,
            // "X, a slave" or "X, his slave" - name must be a proper name
            /\b([A-Z][a-z]{2,}),?\s+(?:a|his|her|their)\s+(?:slave|negro)/gi,
            // Names followed by age/gender descriptors
            /\b([A-Z][a-z]{2,}),?\s+(?:aged?\s+)?\d{1,2},?\s+(?:male|female|negro|colored)/gi
        ];

        for (const pattern of patterns) {
            let match;
            const regex = new RegExp(pattern.source, pattern.flags);
            while ((match = regex.exec(text)) !== null) {
                const name = match[1]?.trim();

                // Validate the name is reasonable
                if (!name || name.length < 3) continue;
                if (notNames.includes(name.toLowerCase())) continue;
                if (!/^[A-Z][a-z]+$/.test(name)) continue; // Must be properly capitalized single word

                // Extract additional details
                const surrounding = text.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50);

                enslaved.push({
                    name: name,
                    role: 'enslaved',
                    age: this.extractAge(surrounding),
                    gender: this.extractGender(surrounding),
                    context: context,
                    source: surrounding,
                    confidence: 0.7
                });
            }
        }

        return enslaved;
    }

    /**
     * Extract transactions (sales, manumissions, inheritances)
     */
    extractTransactions(text) {
        const transactions = [];
        const lower = text.toLowerCase();

        const transactionTypes = {
            sale: ['sold', 'purchased', 'bought', 'sale of'],
            manumission: ['manumit', 'freed', 'emancipat', 'set free', 'liberty'],
            inheritance: ['inherited', 'bequeathed', 'will', 'estate'],
            compensation: ['compensation', 'compensated', 'paid for']
        };

        for (const [type, keywords] of Object.entries(transactionTypes)) {
            for (const keyword of keywords) {
                if (lower.includes(keyword)) {
                    // Extract the full context
                    const idx = lower.indexOf(keyword);
                    const context = text.substring(Math.max(0, idx - 100), idx + 100);

                    transactions.push({
                        type: type,
                        keyword: keyword,
                        date: this.extractDates(context)[0] || null,
                        amount: this.extractMoney(context),
                        context: context,
                        confidence: 0.6
                    });
                    break;
                }
            }
        }

        return transactions;
    }

    /**
     * Extract dates from text
     */
    extractDates(text) {
        const dates = [];

        // Full dates
        let match;
        while ((match = this.patterns.fullDate.exec(text)) !== null) {
            dates.push(match[0]);
        }
        this.patterns.fullDate.lastIndex = 0;

        // Month + Year
        while ((match = this.patterns.monthYear.exec(text)) !== null) {
            if (!dates.some(d => d.includes(match[0]))) {
                dates.push(match[0]);
            }
        }
        this.patterns.monthYear.lastIndex = 0;

        // Just years (1600-1899 range)
        while ((match = this.patterns.year.exec(text)) !== null) {
            const year = match[1];
            if (!dates.some(d => d.includes(year))) {
                dates.push(year);
            }
        }
        this.patterns.year.lastIndex = 0;

        return dates;
    }

    /**
     * Extract age from text
     */
    extractAge(text) {
        const match = /(?:aged?|age)\s*(\d{1,3})/i.exec(text);
        return match ? parseInt(match[1]) : null;
    }

    /**
     * Extract gender from text
     */
    extractGender(text) {
        const lower = text.toLowerCase();
        if (lower.includes('female') || lower.includes('woman') || lower.includes('girl')) {
            return 'female';
        }
        if (lower.includes('male') || lower.includes('man') || lower.includes('boy')) {
            return 'male';
        }
        return null;
    }

    /**
     * Extract money amounts
     */
    extractMoney(text) {
        const match = this.patterns.money.exec(text);
        this.patterns.money.lastIndex = 0;
        return match ? match[0] : null;
    }

    /**
     * Find specific target names in text
     */
    findTargetNames(text, targetNames) {
        const results = [];
        const lower = text.toLowerCase();

        for (const target of targetNames) {
            const targetLower = target.toLowerCase();
            let index = 0;

            while ((index = lower.indexOf(targetLower, index)) !== -1) {
                const context = text.substring(Math.max(0, index - 100), index + target.length + 100);
                results.push({
                    name: target,
                    position: index,
                    context: context,
                    // Analyze what role this person plays
                    role: this.determineRole(context)
                });
                index += target.length;
            }
        }

        return results;
    }

    /**
     * Determine if someone is a slaveholder or enslaved based on context
     */
    determineRole(context) {
        const lower = context.toLowerCase();

        const slaveholderIndicators = ['owned', 'his slave', 'her slave', 'their slave',
                                       'slaveholder', 'slaveowner', 'plantation', 'estate'];
        const enslavedIndicators = ['was enslaved', 'slave of', 'enslaved by', 'owned by',
                                    'negro named', 'servant'];

        let slaveholderScore = 0;
        let enslavedScore = 0;

        for (const ind of slaveholderIndicators) {
            if (lower.includes(ind)) slaveholderScore++;
        }
        for (const ind of enslavedIndicators) {
            if (lower.includes(ind)) enslavedScore++;
        }

        if (slaveholderScore > enslavedScore) return 'slaveholder';
        if (enslavedScore > slaveholderScore) return 'enslaved';
        return 'unknown';
    }

    /**
     * Build relationships between extracted entities
     */
    buildRelationships(results, sentences) {
        const relationships = [];

        // For each slaveholder, find associated enslaved persons
        for (const slaveholder of results.slaveholders) {
            const slaveholderName = slaveholder.name.toLowerCase();

            for (const sentence of sentences) {
                const lower = sentence.text.toLowerCase();
                if (lower.includes(slaveholderName)) {
                    // Find any enslaved persons mentioned in same context
                    for (const enslaved of results.enslavedPersons) {
                        if (lower.includes(enslaved.name.toLowerCase())) {
                            relationships.push({
                                slaveholder: slaveholder.name,
                                enslaved: enslaved.name,
                                type: 'ownership',
                                context: sentence.text,
                                confidence: 0.6
                            });
                        }
                    }
                }
            }
        }

        return relationships;
    }

    /**
     * Calculate statistics from extracted data
     */
    calculateStatistics(results) {
        return {
            totalSlaveholders: results.slaveholders.length,
            totalEnslaved: results.enslavedPersons.length,
            totalTransactions: results.transactions.length,
            transactionTypes: this.countByProperty(results.transactions, 'type'),
            dateRange: results.dates.length > 0 ? {
                earliest: Math.min(...results.dates.filter(d => /^\d{4}$/.test(d)).map(Number)),
                latest: Math.max(...results.dates.filter(d => /^\d{4}$/.test(d)).map(Number))
            } : null
        };
    }

    /**
     * Count occurrences by property
     */
    countByProperty(arr, prop) {
        return arr.reduce((acc, item) => {
            const val = item[prop];
            acc[val] = (acc[val] || 0) + 1;
            return acc;
        }, {});
    }

    /**
     * Check if a string is likely a person's name
     */
    isLikelyName(str) {
        // Filter out common non-name words and historical document noise
        const nonNames = ['the', 'and', 'his', 'her', 'their', 'this', 'that', 'with',
                         'from', 'were', 'have', 'been', 'such', 'some', 'other',
                         'contents', 'chapter', 'page', 'figure', 'table', 'notes',
                         'african', 'africanized', 'maryland', 'virginia', 'chesapeake',
                         'american', 'colonial', 'historical', 'challenging', 'making'];
        const words = str.toLowerCase().split(/\s+/);

        // Must start with capital letter
        if (!/^[A-Z]/.test(str)) return false;

        // Should not be a common word
        if (nonNames.includes(words[0])) return false;

        // Should have reasonable length
        if (str.length < 3 || str.length > 50) return false;

        // Should not be all caps (headers/titles)
        if (str === str.toUpperCase() && str.length > 3) return false;

        // Should not contain newlines (broken parsing)
        if (str.includes('\n')) return false;

        // Should have at least 2 name parts for slaveholder (first + last)
        // Single words like "Marsham" are less reliable
        const nameParts = str.split(/\s+/);
        if (nameParts.length < 2) {
            // Single word - check if it looks like a last name (ends with common suffixes)
            if (!/(?:son|ton|ham|field|wood|land|man|ell|ord|ard|er|or|on|ing|ey)$/i.test(str)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Calculate confidence for a name extraction
     */
    calculateNameConfidence(name, context) {
        let confidence = 0.5;

        // Boost for titles
        if (/(?:Mr\.|Mrs\.|Col\.|Dr\.|Gen\.)/.test(context)) confidence += 0.2;

        // Boost for multiple name parts
        if (name.split(/\s+/).length >= 2) confidence += 0.15;

        // Boost for Jr/Sr/III suffix
        if (/(?:Jr\.|Sr\.|I{1,3}|IV|V)$/i.test(name)) confidence += 0.1;

        return Math.min(confidence, 0.95);
    }

    /**
     * Calculate overall extraction confidence
     */
    calculateConfidence(results, relevantSentenceCount) {
        if (relevantSentenceCount === 0) return 0;

        let confidence = 0.3; // Base confidence

        // More relevant sentences = more confidence
        confidence += Math.min(relevantSentenceCount / 50, 0.3);

        // Found entities = more confidence
        if (results.slaveholders.length > 0) confidence += 0.15;
        if (results.enslavedPersons.length > 0) confidence += 0.15;
        if (results.transactions.length > 0) confidence += 0.1;

        return Math.min(confidence, 0.95);
    }

    /**
     * Deduplicate entities by name
     */
    deduplicateEntities(entities) {
        const seen = new Map();

        for (const entity of entities) {
            const key = entity.name.toLowerCase();
            if (!seen.has(key)) {
                seen.set(key, entity);
            } else {
                // Merge contexts and take higher confidence
                const existing = seen.get(key);
                existing.confidence = Math.max(existing.confidence, entity.confidence);
                if (entity.context && !existing.context.includes(entity.context[0])) {
                    existing.context = [...existing.context, ...entity.context];
                }
            }
        }

        return Array.from(seen.values());
    }

    /**
     * Convert extracted data to standard row format for database
     */
    toRowFormat(extractionResults) {
        const rows = [];

        // Create rows for enslaved persons with their slaveholders
        for (const enslaved of extractionResults.enslavedPersons) {
            // Find associated slaveholder
            const relationship = extractionResults.relationships.find(
                r => r.enslaved.toLowerCase() === enslaved.name.toLowerCase()
            );

            rows.push({
                rowIndex: rows.length,
                columns: {
                    'Enslaved Name': enslaved.name,
                    'Sex': enslaved.gender || '',
                    'Age': enslaved.age || '',
                    'Owner/Slaveholder': relationship?.slaveholder || '',
                    'Date': extractionResults.dates[0] || '',
                    'Source Context': enslaved.source?.substring(0, 200) || ''
                },
                confidence: enslaved.confidence,
                rawText: enslaved.source || '',
                extractionType: 'narrative'
            });
        }

        // Create rows for slaveholders with slave counts
        for (const slaveholder of extractionResults.slaveholders) {
            // Check if already represented in enslaved rows
            const hasEnslaved = extractionResults.relationships.some(
                r => r.slaveholder.toLowerCase() === slaveholder.name.toLowerCase()
            );

            // Always add slaveholders with counts or unique sources
            rows.push({
                rowIndex: rows.length,
                columns: {
                    'Owner/Slaveholder': slaveholder.name,
                    'Slave Count': slaveholder.slaveCount || '',
                    'Date': extractionResults.dates[0] || '',
                    'Source Context': slaveholder.source?.substring(0, 200) || ''
                },
                confidence: slaveholder.confidence,
                rawText: slaveholder.source || '',
                extractionType: 'narrative'
            });
        }

        return rows;
    }
}

module.exports = NarrativeExtractor;
