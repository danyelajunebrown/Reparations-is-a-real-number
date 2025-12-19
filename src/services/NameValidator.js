/**
 * NameValidator Service
 * Validates whether extracted text is plausibly a human name
 *
 * Critical for preventing garbage data from entering the database
 */

class NameValidator {
    // Common English words that are NOT names
    static COMMON_WORDS = new Set([
        // Articles & Pronouns
        'the', 'a', 'an', 'he', 'she', 'it', 'they', 'them', 'their', 'we', 'us',
        'me', 'my', 'your', 'you', 'his', 'her', 'its', 'our', 'who', 'what',
        'where', 'when', 'how', 'why', 'which', 'that', 'this', 'these', 'those',

        // Prepositions & Conjunctions
        'with', 'from', 'for', 'and', 'but', 'not', 'or', 'nor', 'yet', 'so',
        'to', 'of', 'in', 'on', 'at', 'by', 'as', 'into', 'onto', 'upon',
        'over', 'under', 'above', 'below', 'between', 'among', 'through',

        // Verbs & Auxiliaries
        'be', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
        'must', 'can', 'shall', 'being', 'having',

        // Adverbs & Other
        'no', 'yes', 'so', 'if', 'than', 'then', 'now', 'up', 'out', 'only',
        'also', 'very', 'just', 'even', 'more', 'most', 'other', 'some', 'any',
        'all', 'both', 'each', 'few', 'many', 'much', 'own', 'same', 'such', 'too'
    ]);

    // Form field headers from research databases
    static FORM_HEADERS = new Set([
        'participant info', 'researcher location', 'comments', 'beyond kin researcher',
        'research record', 'your petitioner', 'slaveholder', 'enslaved', 'owner',
        'descendant', 'locations', 'researcher', 'e-mail', 'email', 'website',
        'mailing list', 'on-line tree', 'online tree', 'source', 'notes',
        'contact', 'information', 'participant', 'submitted', 'contributor'
    ]);

    // Document/Census titles
    static DOCUMENT_TITLES = new Set([
        'slave statistics', 'federal census', 'baptist church', 'methodist church',
        'statistics', 'records', 'index', 'schedule', 'list', 'roll', 'register',
        'inventory', 'manifest', 'ledger', 'account', 'deed', 'will', 'estate',
        'census', 'tax list', 'property', 'appraisal'
    ]);

    // Column headers
    static COLUMN_HEADERS = new Set([
        'year', 'month', 'day', 'week', 'date', 'time', 'age', 'born', 'died',
        'death', 'birth', 'compensation', 'received', 'drafted', 'enlisted',
        'paid', 'owed', 'amount', 'total', 'number', 'none', 'male', 'female',
        'sex', 'gender', 'color', 'value', 'price', 'occupation', 'trade',
        'remarks', 'description', 'condition', 'status'
    ]);

    // Valid African day names (enslaved naming tradition)
    static AFRICAN_DAY_NAMES = new Set([
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
        'cudjoe', 'cudjo', 'quashee', 'quash', 'quaco', 'cuffee', 'cuffy',
        'juba', 'abba', 'phibbi', 'phoebe', 'amba', 'abena', 'adjua'
    ]);

    // Valid African month names
    static AFRICAN_MONTH_NAMES = new Set([
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december'
    ]);

    // Common enslaved names (classical, biblical, etc.)
    static COMMON_ENSLAVED_NAMES = new Set([
        'prince', 'pompey', 'caesar', 'scipio', 'cato', 'mingo', 'sambo', 'nero',
        'venus', 'flora', 'rose', 'dinah', 'lucy', 'hannah', 'jenny', 'nancy',
        'betty', 'molly', 'sarah', 'mary', 'tom', 'jack', 'harry', 'ben', 'sam',
        'joe', 'will', 'dick', 'peter', 'charles', 'george', 'john', 'james',
        'isaac', 'moses', 'abraham', 'daniel', 'jacob', 'david', 'solomon',
        'rachel', 'rebecca', 'ruth', 'esther', 'hagar', 'leah', 'martha', 'agnes'
    ]);

    /**
     * Check if a string is a valid human name
     * @param {string} name - The name to validate
     * @returns {boolean} - True if valid, false if garbage
     */
    static isValidName(name) {
        if (!name || typeof name !== 'string') return false;

        const normalized = name.trim().toLowerCase();

        // Too short (less than 3 chars)
        if (normalized.length < 3) return false;

        // Too long (probably a sentence or description)
        if (normalized.length > 50) return false;

        // All caps (likely a header) - unless it's a known name
        if (name === name.toUpperCase() && normalized.length > 3) {
            if (!this.isKnownValidName(normalized)) return false;
        }

        // Check against blacklists
        if (this.COMMON_WORDS.has(normalized)) return false;
        if (this.FORM_HEADERS.has(normalized)) return false;
        if (this.DOCUMENT_TITLES.has(normalized)) return false;
        if (this.COLUMN_HEADERS.has(normalized)) return false;

        // Check for patterns that indicate garbage
        if (this.hasGarbagePattern(normalized)) return false;

        return true;
    }

    /**
     * Check if a name is in our known valid names lists
     */
    static isKnownValidName(normalized) {
        return this.AFRICAN_DAY_NAMES.has(normalized) ||
               this.AFRICAN_MONTH_NAMES.has(normalized) ||
               this.COMMON_ENSLAVED_NAMES.has(normalized);
    }

    /**
     * Check for garbage patterns in the name
     */
    static hasGarbagePattern(normalized) {
        // Starts with common words
        if (/^(by the|the |a |an |in |on |at |to |for |from |with )/.test(normalized)) return true;

        // Contains @ or email patterns
        if (/@/.test(normalized)) return true;

        // Contains URLs
        if (/https?:|www\.|\.com|\.org|\.gov/.test(normalized)) return true;

        // Only numbers
        if (/^\d+$/.test(normalized)) return true;

        // County names (unless followed by a surname)
        if (/county$/i.test(normalized) && !/^[a-z]+ county$/i.test(normalized)) return true;

        // Contains multiple special characters
        if ((normalized.match(/[^a-z\s\-'\.]/g) || []).length > 2) return true;

        return false;
    }

    /**
     * Validate a name and return detailed result
     * @param {string} name - The name to validate
     * @returns {Object} - { valid: boolean, reason: string, confidence: number }
     */
    static validate(name) {
        if (!name || typeof name !== 'string') {
            return { valid: false, reason: 'Empty or invalid input', confidence: 0 };
        }

        const normalized = name.trim().toLowerCase();

        if (normalized.length < 3) {
            return { valid: false, reason: 'Too short', confidence: 0 };
        }

        if (normalized.length > 50) {
            return { valid: false, reason: 'Too long - likely a description', confidence: 0 };
        }

        if (this.COMMON_WORDS.has(normalized)) {
            return { valid: false, reason: 'Common English word', confidence: 0 };
        }

        if (this.FORM_HEADERS.has(normalized)) {
            return { valid: false, reason: 'Form field header', confidence: 0 };
        }

        if (this.DOCUMENT_TITLES.has(normalized)) {
            return { valid: false, reason: 'Document title', confidence: 0 };
        }

        if (this.COLUMN_HEADERS.has(normalized)) {
            return { valid: false, reason: 'Column header', confidence: 0 };
        }

        // Check if it's a known valid name
        if (this.isKnownValidName(normalized)) {
            return { valid: true, reason: 'Known enslaved name pattern', confidence: 0.9 };
        }

        // Standard name patterns
        if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name)) {
            return { valid: true, reason: 'Standard First Last format', confidence: 0.85 };
        }

        if (/^[A-Z][a-z]+$/.test(name) && name.length >= 4) {
            return { valid: true, reason: 'Single proper noun', confidence: 0.7 };
        }

        // All caps but not in blacklist
        if (name === name.toUpperCase() && name.length > 3) {
            return { valid: false, reason: 'All caps - likely header', confidence: 0.3 };
        }

        // Default: assume valid but low confidence
        return { valid: true, reason: 'No invalid patterns detected', confidence: 0.5 };
    }

    /**
     * Filter an array of names, returning only valid ones
     * @param {string[]} names - Array of names to filter
     * @returns {string[]} - Array of valid names
     */
    static filterValidNames(names) {
        return names.filter(name => this.isValidName(name));
    }

    /**
     * Get statistics on name validation for a set of names
     * @param {string[]} names - Array of names to analyze
     * @returns {Object} - Statistics about validation results
     */
    static getStats(names) {
        const results = names.map(name => this.validate(name));
        const valid = results.filter(r => r.valid);
        const invalid = results.filter(r => !r.valid);

        const reasonCounts = {};
        invalid.forEach(r => {
            reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
        });

        return {
            total: names.length,
            valid: valid.length,
            invalid: invalid.length,
            validPercent: Math.round(100 * valid.length / names.length),
            avgConfidence: valid.length > 0
                ? Math.round(100 * valid.reduce((sum, r) => sum + r.confidence, 0) / valid.length) / 100
                : 0,
            rejectionReasons: reasonCounts
        };
    }
}

module.exports = NameValidator;
