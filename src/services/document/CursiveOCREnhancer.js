/**
 * CursiveOCREnhancer - Improves OCR accuracy for historical handwritten documents
 *
 * Uses a cursive letter reference chart to:
 * 1. Validate questionable character parses
 * 2. Suggest corrections based on common cursive confusions
 * 3. Learn from previously corrected OCR results
 *
 * Common cursive confusions in 18th-19th century documents:
 * - Capital letters that look similar (S/L, F/T, J/I, etc.)
 * - Lowercase letters that blur together (e/c, n/u, m/n, etc.)
 * - Old-style letterforms (long s = f, etc.)
 */

class CursiveOCREnhancer {
    constructor(db = null) {
        this.db = db;

        // Cursive letter confusion matrix based on reference chart
        // Maps commonly misread characters to their likely correct forms
        this.confusionMatrix = {
            // Uppercase confusions
            'A': ['H', 'M', 'N'],
            'B': ['R', 'D', 'P'],
            'C': ['G', 'O', 'E'],
            'D': ['O', 'B', 'P'],
            'E': ['C', 'L', 'F'],
            'F': ['T', 'J', 'S'],
            'G': ['Y', 'S', 'C'],
            'H': ['K', 'N', 'M'],
            'I': ['J', 'T', 'L'],
            'J': ['I', 'T', 'G', 'Y'],
            'K': ['H', 'R', 'N'],
            'L': ['S', 'E', 'T', 'I'],
            'M': ['W', 'N', 'H'],
            'N': ['M', 'H', 'W'],
            'O': ['Q', 'D', 'C'],
            'P': ['R', 'B', 'D'],
            'Q': ['O', 'D', '2'],
            'R': ['P', 'B', 'K'],
            'S': ['L', 'F', 'G'],
            'T': ['F', 'I', 'J'],
            'U': ['V', 'W', 'N'],
            'V': ['U', 'W', 'N'],
            'W': ['M', 'N', 'U'],
            'X': ['K', 'H'],
            'Y': ['J', 'G', 'T'],
            'Z': ['3', '2'],

            // Lowercase confusions (much more common in cursive)
            'a': ['o', 'u', 'e', 'd'],
            'b': ['l', 'h', 'k', 'f'],
            'c': ['e', 'i', 'o', 'r'],
            'd': ['a', 'o', 'cl', 'dl'],
            'e': ['c', 'i', 'l', 'a'],
            'f': ['l', 't', 's', 'b'],  // Long s (ſ) looks like f
            'g': ['y', 'q', 'z', 'j'],
            'h': ['b', 'l', 'k', 'n'],
            'i': ['e', 'l', 'j', 't'],
            'j': ['i', 'y', 'g'],
            'k': ['h', 'l', 'b'],
            'l': ['i', 'e', 'b', 'h', 't'],
            'm': ['n', 'in', 'w', 'rn', 'nn'],  // 'm' often misread as 'rn' or 'nn'
            'n': ['u', 'm', 'r', 'h', 'ri'],
            'o': ['a', 'e', 'c', 'u'],
            'p': ['n', 'h', 'r'],
            'q': ['g', 'y', '9'],
            'r': ['n', 'v', 'i', 's'],
            's': ['r', 'e', 'a', 'f'],  // Old long s (ſ)
            't': ['l', 'i', 'f', 'e'],
            'u': ['n', 'a', 'v', 'ii', 'w'],
            'v': ['u', 'r', 'n'],
            'w': ['m', 'vv', 'uu'],
            'x': ['n', 'v'],
            'y': ['j', 'g', 'v'],
            'z': ['s', '3', '2'],

            // Common digit confusions
            '0': ['O', 'o', 'D', 'Q'],
            '1': ['l', 'I', 'i', '7'],
            '2': ['Z', '3', '7'],
            '3': ['8', 'B', 'E'],
            '4': ['9', 'A'],
            '5': ['S', 's'],
            '6': ['b', 'G'],
            '7': ['1', 'T', 't'],
            '8': ['3', 'B', '&'],
            '9': ['4', 'g', 'q'],

            // Special character confusions
            '&': ['8', 'B', 'Et'],
            '-': ['~', '_'],
            '.': [',', "'"],
            ',': ['.', "'"],
            "'": [',', '.', '`'],
        };

        // Common word patterns in slavery documents that help with context
        this.commonPatterns = {
            // Titles and prefixes
            titles: ['Mr', 'Mrs', 'Miss', 'Master', 'Col', 'Gen', 'Rev', 'Dr', 'Hon', 'Esq'],

            // Common first names in records
            maleNames: ['John', 'William', 'James', 'Thomas', 'George', 'Robert', 'Joseph', 'Charles', 'Henry', 'Samuel', 'Benjamin', 'Isaac', 'Abraham', 'Peter', 'Richard', 'Daniel', 'David', 'Jacob', 'Stephen', 'Andrew', 'Nathaniel', 'Christopher', 'Solomon'],
            femaleNames: ['Mary', 'Sarah', 'Elizabeth', 'Martha', 'Jane', 'Nancy', 'Hannah', 'Ann', 'Margaret', 'Grace', 'Ruth', 'Rebecca', 'Rachel', 'Eliza', 'Catherine', 'Susan', 'Lucy', 'Betsy', 'Dolly', 'Harriet', 'Celia', 'Phillis'],

            // Common enslaved person names (single names were typical)
            enslavedNames: ['Sam', 'Jack', 'Tom', 'Harry', 'Joe', 'Ben', 'Will', 'Jim', 'Bob', 'Peter', 'Frank', 'George', 'Bill', 'Dick', 'Daniel', 'Moses', 'Adam', 'Isaac', 'Jacob', 'Jerry', 'Solomon', 'Cato', 'Caesar', 'Pompey', 'Cuffy', 'Quash', 'Scipio', 'July', 'Monday', 'Friday',
                'Mary', 'Sally', 'Hannah', 'Betty', 'Lucy', 'Dinah', 'Nancy', 'Jane', 'Chloe', 'Venus', 'Violet', 'Rose', 'Jenny', 'Molly', 'Phoebe', 'Sukey', 'Patsy', 'Nelly', 'Priscilla', 'Charlotte'],

            // Common locations
            locations: ['County', 'Parish', 'District', 'Plantation', 'Estate', 'Farm', 'Town', 'City', 'State'],

            // States/Colonies
            states: ['Virginia', 'Maryland', 'Carolina', 'Georgia', 'Louisiana', 'Mississippi', 'Alabama', 'Tennessee', 'Kentucky', 'Missouri', 'Florida', 'Texas', 'Jamaica', 'Barbados', 'Trinidad', 'Antigua', 'Grenada', 'Dominica', 'Guiana'],

            // Document terms
            docTerms: ['deed', 'bill', 'sale', 'purchase', 'slave', 'negro', 'mulatto', 'bound', 'servant', 'property', 'estate', 'inventory', 'appraisal', 'will', 'testament', 'deceased', 'heirs', 'administrator', 'executor', 'witness', 'signed', 'sworn', 'court', 'petition', 'compensation', 'claim'],

            // Numbers (often written as words)
            numberWords: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'thousand', 'dollars', 'pounds', 'shillings', 'pence']
        };

        // Build lookup sets for fast validation
        this.validWords = new Set();
        Object.values(this.commonPatterns).forEach(list => {
            list.forEach(word => {
                this.validWords.add(word.toLowerCase());
                this.validWords.add(word);
            });
        });

        // Cache for learned corrections from database
        this.learnedCorrections = new Map();
    }

    /**
     * Enhance OCR text using cursive reference and context
     * @param {string} rawText - Raw OCR output
     * @param {number} confidence - OCR confidence score (0-1)
     * @param {Object} options - Enhancement options
     * @returns {Object} Enhanced text with corrections and confidence
     */
    async enhance(rawText, confidence = 0.5, options = {}) {
        if (!rawText || rawText.trim().length === 0) {
            return { text: '', corrections: [], confidence: 0 };
        }

        const corrections = [];
        let enhancedText = rawText;

        // Load learned corrections from database if available
        if (this.db && !options.skipLearned) {
            await this.loadLearnedCorrections();
        }

        // Step 1: Apply learned corrections (highest priority)
        if (this.learnedCorrections.size > 0) {
            const learnedResult = this.applyLearnedCorrections(enhancedText);
            enhancedText = learnedResult.text;
            corrections.push(...learnedResult.corrections);
        }

        // Step 2: Fix common OCR errors based on cursive confusion matrix
        const confusionResult = this.fixCursiveConfusions(enhancedText, confidence);
        enhancedText = confusionResult.text;
        corrections.push(...confusionResult.corrections);

        // Step 3: Validate and correct names using pattern matching
        const nameResult = this.validateNames(enhancedText);
        enhancedText = nameResult.text;
        corrections.push(...nameResult.corrections);

        // Step 4: Fix common historical abbreviations
        const abbrResult = this.expandAbbreviations(enhancedText);
        enhancedText = abbrResult.text;
        corrections.push(...abbrResult.corrections);

        // Calculate enhanced confidence
        const correctionPenalty = Math.min(corrections.length * 0.02, 0.2);
        const enhancedConfidence = Math.min(confidence + 0.1, 1) - correctionPenalty;

        return {
            text: enhancedText,
            originalText: rawText,
            corrections,
            confidence: Math.max(enhancedConfidence, 0.1),
            correctionCount: corrections.length,
            enhancementApplied: corrections.length > 0
        };
    }

    /**
     * Load learned corrections from database
     */
    async loadLearnedCorrections() {
        if (!this.db) return;

        try {
            // Query extraction_corrections for patterns
            const result = await this.db.query(`
                SELECT original_value, corrected_value, COUNT(*) as frequency
                FROM extraction_corrections
                WHERE corrected_value IS NOT NULL
                GROUP BY original_value, corrected_value
                HAVING COUNT(*) >= 2
                ORDER BY frequency DESC
                LIMIT 500
            `).catch(() => ({ rows: [] }));

            result.rows.forEach(row => {
                this.learnedCorrections.set(row.original_value, {
                    correction: row.corrected_value,
                    frequency: parseInt(row.frequency)
                });
            });

            console.log(`Loaded ${this.learnedCorrections.size} learned corrections`);
        } catch (error) {
            console.error('Failed to load learned corrections:', error.message);
        }
    }

    /**
     * Apply corrections learned from previous human edits
     */
    applyLearnedCorrections(text) {
        const corrections = [];
        let result = text;

        for (const [original, { correction, frequency }] of this.learnedCorrections) {
            if (result.includes(original)) {
                const regex = new RegExp(this.escapeRegex(original), 'g');
                result = result.replace(regex, correction);
                corrections.push({
                    type: 'learned',
                    original,
                    corrected: correction,
                    confidence: Math.min(0.8 + (frequency * 0.02), 0.99),
                    reason: `Learned from ${frequency} previous corrections`
                });
            }
        }

        return { text: result, corrections };
    }

    /**
     * Fix common cursive confusions
     */
    fixCursiveConfusions(text, ocrConfidence) {
        const corrections = [];
        let result = text;

        // Only apply aggressive corrections for low confidence text
        if (ocrConfidence > 0.9) {
            return { text: result, corrections };
        }

        // Common OCR errors in cursive handwriting
        const commonFixes = [
            // 'm' often read as 'rn' or 'in'
            { pattern: /\brn(?=[aeiou])/gi, replacement: 'm', reason: 'rn->m (cursive confusion)' },
            { pattern: /\biu(?=\w)/gi, replacement: 'in', reason: 'iu->in (cursive confusion)' },

            // Long s (ſ) confusion - common in 18th-19th century documents
            { pattern: /ſ/g, replacement: 's', reason: 'Long s (ſ) to modern s' },
            { pattern: /(?<=[a-z])f(?=[aeiou])/gi, replacement: 's', reason: 'f->s mid-word (long s)' },

            // Double letter confusions
            { pattern: /uu/g, replacement: 'w', reason: 'uu->w (archaic)' },
            { pattern: /vv/g, replacement: 'w', reason: 'vv->w (archaic)' },
            { pattern: /ii(?!\w)/g, replacement: 'u', reason: 'ii->u (cursive n/u)' },

            // Common word fixes
            { pattern: /\bthc\b/gi, replacement: 'the', reason: 'thc->the' },
            { pattern: /\baud\b/gi, replacement: 'and', reason: 'aud->and' },
            { pattern: /\bwas\b/gi, replacement: 'was', reason: 'normalize' },
            { pattern: /\bsaid\b/gi, replacement: 'said', reason: 'normalize' },

            // Common name corrections
            { pattern: /\bJno\b/gi, replacement: 'John', reason: 'Jno abbreviation' },
            { pattern: /\bWm\b/gi, replacement: 'William', reason: 'Wm abbreviation' },
            { pattern: /\bThos\b/gi, replacement: 'Thomas', reason: 'Thos abbreviation' },
            { pattern: /\bRobt\b/gi, replacement: 'Robert', reason: 'Robt abbreviation' },
            { pattern: /\bJas\b/gi, replacement: 'James', reason: 'Jas abbreviation' },
            { pattern: /\bSaml\b/gi, replacement: 'Samuel', reason: 'Saml abbreviation' },
            { pattern: /\bBenjn\b/gi, replacement: 'Benjamin', reason: 'Benjn abbreviation' },
            { pattern: /\bEliz\b/gi, replacement: 'Elizabeth', reason: 'Eliz abbreviation' },
            { pattern: /\bMargaret\b/gi, replacement: 'Margaret', reason: 'Margrt abbreviation' },

            // Quantity/document terms
            { pattern: /\bdoll?ars?\b/gi, replacement: 'dollars', reason: 'normalize dollars' },
            { pattern: /\bNegroe?s?\b/gi, replacement: (m) => m.includes('es') ? 'Negroes' : 'Negro', reason: 'normalize Negro/Negroes' },

            // Number/letter confusions
            { pattern: /(?<=\d)O(?=\d)/g, replacement: '0', reason: 'O->0 in number' },
            { pattern: /(?<=\d)l(?=\d)/g, replacement: '1', reason: 'l->1 in number' },
            { pattern: /(?<=\d)S(?=\d)/g, replacement: '5', reason: 'S->5 in number' },
        ];

        for (const fix of commonFixes) {
            const matches = result.match(fix.pattern);
            if (matches) {
                const replacement = typeof fix.replacement === 'function' ? fix.replacement : fix.replacement;
                result = result.replace(fix.pattern, replacement);
                matches.forEach(m => {
                    corrections.push({
                        type: 'cursive_fix',
                        original: m,
                        corrected: typeof replacement === 'function' ? replacement(m) : replacement,
                        confidence: 0.7,
                        reason: fix.reason
                    });
                });
            }
        }

        return { text: result, corrections };
    }

    /**
     * Validate and suggest corrections for names
     */
    validateNames(text) {
        const corrections = [];
        let result = text;

        // Find potential names (capitalized words)
        const namePattern = /\b[A-Z][a-z]+\b/g;
        const potentialNames = result.match(namePattern) || [];

        for (const name of potentialNames) {
            // Skip if it's already a valid known name
            if (this.validWords.has(name) || this.validWords.has(name.toLowerCase())) {
                continue;
            }

            // Check if it's close to a known name
            const suggestion = this.findClosestName(name);
            if (suggestion && suggestion.confidence > 0.75) {
                // Only auto-correct high-confidence matches
                if (suggestion.confidence > 0.9) {
                    result = result.replace(new RegExp(`\\b${this.escapeRegex(name)}\\b`, 'g'), suggestion.name);
                    corrections.push({
                        type: 'name_correction',
                        original: name,
                        corrected: suggestion.name,
                        confidence: suggestion.confidence,
                        reason: `Similar to known name (${suggestion.distance} edits)`
                    });
                } else {
                    // Add as suggestion but don't auto-correct
                    corrections.push({
                        type: 'name_suggestion',
                        original: name,
                        suggested: suggestion.name,
                        confidence: suggestion.confidence,
                        reason: `Possible: ${suggestion.name}`,
                        autoApplied: false
                    });
                }
            }
        }

        return { text: result, corrections };
    }

    /**
     * Find the closest matching known name
     */
    findClosestName(name) {
        let bestMatch = null;
        let bestDistance = Infinity;
        const nameLower = name.toLowerCase();

        // Check all name lists
        const allNames = [
            ...this.commonPatterns.maleNames,
            ...this.commonPatterns.femaleNames,
            ...this.commonPatterns.enslavedNames
        ];

        for (const knownName of allNames) {
            const distance = this.levenshteinDistance(nameLower, knownName.toLowerCase());

            // Only consider matches within 2 edits for short names, 3 for longer
            const maxDistance = name.length <= 4 ? 1 : (name.length <= 6 ? 2 : 3);

            if (distance < bestDistance && distance <= maxDistance) {
                bestDistance = distance;
                bestMatch = knownName;
            }
        }

        if (bestMatch) {
            // Calculate confidence based on edit distance and name length
            const confidence = 1 - (bestDistance / Math.max(name.length, bestMatch.length));
            return {
                name: bestMatch,
                distance: bestDistance,
                confidence
            };
        }

        return null;
    }

    /**
     * Expand common historical abbreviations
     */
    expandAbbreviations(text) {
        const corrections = [];
        let result = text;

        const abbreviations = {
            // Titles
            'Esqr': 'Esquire',
            'Esq': 'Esquire',
            'Honble': 'Honorable',
            'Revd': 'Reverend',
            'Majr': 'Major',
            'Capt': 'Captain',
            'Lieut': 'Lieutenant',
            'Genl': 'General',

            // Terms
            'Do': 'Ditto',
            'do': 'ditto',
            'viz': 'namely',
            'Viz': 'Namely',
            'Inst': 'Instant',
            'inst': 'instant',
            'Ult': 'Ultimo',
            'ult': 'ultimo',
            'Prox': 'Proximo',

            // Legal/Document
            'afsd': 'aforesaid',
            'aforesd': 'aforesaid',
            'sd': 'said',
            'abovemtd': 'abovementioned',
            'yr': 'year',
            'yrs': 'years',
            'mo': 'month',
            'mos': 'months',

            // Money (keep recognizable)
            '£': 'pounds',
            '₤': 'pounds'
        };

        for (const [abbr, expansion] of Object.entries(abbreviations)) {
            const pattern = new RegExp(`\\b${this.escapeRegex(abbr)}\\b`, 'g');
            if (pattern.test(result)) {
                result = result.replace(pattern, expansion);
                corrections.push({
                    type: 'abbreviation',
                    original: abbr,
                    corrected: expansion,
                    confidence: 0.95,
                    reason: 'Historical abbreviation'
                });
            }
        }

        return { text: result, corrections };
    }

    /**
     * Levenshtein distance for fuzzy matching
     */
    levenshteinDistance(s1, s2) {
        const m = s1.length;
        const n = s2.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,      // deletion
                    dp[i][j - 1] + 1,      // insertion
                    dp[i - 1][j - 1] + cost // substitution
                );
            }
        }

        return dp[m][n];
    }

    /**
     * Escape special regex characters
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Get possible alternatives for a questionable character
     * Useful for UI to show user possible corrections
     */
    getAlternatives(char) {
        return this.confusionMatrix[char] || [];
    }

    /**
     * Save a correction to the database for learning
     */
    async saveCorrection(original, corrected, context = null) {
        if (!this.db) return;

        try {
            await this.db.query(`
                INSERT INTO extraction_corrections
                (original_value, corrected_value, context_text, corrected_by, created_at)
                VALUES ($1, $2, $3, 'ocr_enhancer', CURRENT_TIMESTAMP)
            `, [original, corrected, context]);

            // Update local cache
            const existing = this.learnedCorrections.get(original);
            if (existing) {
                existing.frequency++;
            } else {
                this.learnedCorrections.set(original, {
                    correction: corrected,
                    frequency: 1
                });
            }
        } catch (error) {
            console.error('Failed to save correction:', error.message);
        }
    }

    /**
     * Batch process multiple OCR results for consistency
     */
    async batchEnhance(ocrResults) {
        // First pass: collect all unique words for cross-referencing
        const wordFrequency = new Map();

        for (const result of ocrResults) {
            const words = result.text.match(/\b[A-Za-z]+\b/g) || [];
            words.forEach(word => {
                const lower = word.toLowerCase();
                wordFrequency.set(lower, (wordFrequency.get(lower) || 0) + 1);
            });
        }

        // Second pass: enhance with cross-document consistency
        const enhanced = [];
        for (const result of ocrResults) {
            const enhancedResult = await this.enhance(result.text, result.confidence, {
                wordFrequency
            });
            enhanced.push(enhancedResult);
        }

        return enhanced;
    }
}

module.exports = CursiveOCREnhancer;
