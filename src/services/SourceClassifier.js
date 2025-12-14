/**
 * Source Classifier
 *
 * Analyzes URLs and document sources to determine:
 * 1. Source type (primary, secondary, tertiary)
 * 2. Whether records should go directly to confirmed tables
 * 3. Recommended extraction method
 * 4. Expected data types (enslaved persons, slaveholders, etc.)
 */

class SourceClassifier {
    constructor() {
        // Primary sources - direct evidence of slavery (census, deeds, court records, plantation papers)
        this.primaryPatterns = [
            // Government archives
            { pattern: /msa\.maryland\.gov/i, source: 'Maryland State Archives', confidence: 0.95, type: 'primary' },
            { pattern: /archives\.gov/i, source: 'National Archives', confidence: 0.95, type: 'primary' },
            { pattern: /\.gov.*slave|slave.*\.gov/i, source: 'Government Archive', confidence: 0.90, type: 'primary' },
            { pattern: /civilwardc\.org/i, source: 'Civil War DC', confidence: 0.95, type: 'primary' },

            // University special collections
            { pattern: /library\..*\.edu.*special/i, source: 'University Special Collections', confidence: 0.85, type: 'primary' },
            { pattern: /digitalcollections\..*\.edu/i, source: 'University Digital Collections', confidence: 0.85, type: 'primary' },

            // Historical societies
            { pattern: /historicalsociety/i, source: 'Historical Society', confidence: 0.85, type: 'primary' },
            { pattern: /hsp\.org/i, source: 'Historical Society of Pennsylvania', confidence: 0.90, type: 'primary' },

            // FamilySearch with plantation/slave indicators
            { pattern: /familysearch\.org.*plantation|familysearch\.org.*slave|familysearch\.org.*ravenel/i, source: 'FamilySearch Plantation Records', confidence: 0.90, type: 'primary' },
            { pattern: /familysearch\.org.*catalog\/559181/i, source: 'Ball/Ravenel Papers', confidence: 0.95, type: 'primary' },
        ];

        // Secondary sources - compiled or indexed data
        this.secondaryPatterns = [
            { pattern: /familysearch\.org/i, source: 'FamilySearch', confidence: 0.65, type: 'secondary' },
            { pattern: /ancestry\.com/i, source: 'Ancestry', confidence: 0.60, type: 'secondary' },
            { pattern: /findagrave\.com/i, source: 'Find A Grave', confidence: 0.50, type: 'secondary' },
            { pattern: /rootsweb/i, source: 'Rootsweb', confidence: 0.70, type: 'secondary' },
            { pattern: /beyondkin\.net/i, source: 'Beyond Kin', confidence: 0.60, type: 'secondary' },
            { pattern: /fold3\.com/i, source: 'Fold3', confidence: 0.65, type: 'secondary' },
        ];

        // Tertiary sources - encyclopedic or synthesized
        this.tertiaryPatterns = [
            { pattern: /wikipedia\.org/i, source: 'Wikipedia', confidence: 0.40, type: 'tertiary' },
            { pattern: /encyclopediavirginia/i, source: 'Encyclopedia Virginia', confidence: 0.50, type: 'tertiary' },
            { pattern: /blogs?\./i, source: 'Blog', confidence: 0.30, type: 'tertiary' },
        ];

        // Keywords that indicate primary plantation/slavery documents
        this.primaryKeywords = [
            'slave schedule', 'slave census', 'slave manifest',
            'deed of sale', 'bill of sale', 'inventory',
            'plantation journal', 'plantation record', 'overseer',
            'emancipation petition', 'manumission',
            'court record', 'probate', 'estate inventory'
        ];
    }

    /**
     * Classify a source URL and optional metadata
     */
    classify(url, metadata = {}) {
        const result = {
            url: url,
            sourceType: 'unknown',
            sourceName: 'Unknown',
            confidence: 0,
            isPrimarySource: false,
            shouldAutoConfirm: false,
            recommendedMethod: 'manual',
            expectedDataTypes: [],
            analysis: []
        };

        // Check primary patterns first (higher priority)
        for (const pattern of this.primaryPatterns) {
            if (pattern.pattern.test(url)) {
                result.sourceType = pattern.type;
                result.sourceName = pattern.source;
                result.confidence = pattern.confidence;
                result.isPrimarySource = true;
                result.shouldAutoConfirm = pattern.confidence >= 0.90;
                result.analysis.push(`URL matches primary source pattern: ${pattern.source}`);
                break;
            }
        }

        // If not matched as primary, check secondary
        if (result.sourceType === 'unknown') {
            for (const pattern of this.secondaryPatterns) {
                if (pattern.pattern.test(url)) {
                    result.sourceType = pattern.type;
                    result.sourceName = pattern.source;
                    result.confidence = pattern.confidence;
                    result.analysis.push(`URL matches secondary source pattern: ${pattern.source}`);
                    break;
                }
            }
        }

        // Check tertiary last
        if (result.sourceType === 'unknown') {
            for (const pattern of this.tertiaryPatterns) {
                if (pattern.pattern.test(url)) {
                    result.sourceType = pattern.type;
                    result.sourceName = pattern.source;
                    result.confidence = pattern.confidence;
                    result.analysis.push(`URL matches tertiary source pattern: ${pattern.source}`);
                    break;
                }
            }
        }

        // Check for primary keywords in URL or metadata
        const textToSearch = `${url} ${metadata.title || ''} ${metadata.description || ''}`.toLowerCase();
        for (const keyword of this.primaryKeywords) {
            if (textToSearch.includes(keyword)) {
                result.analysis.push(`Contains primary source keyword: "${keyword}"`);
                if (result.sourceType === 'secondary') {
                    result.sourceType = 'primary';
                    result.isPrimarySource = true;
                    result.confidence = Math.min(0.95, result.confidence + 0.20);
                    result.shouldAutoConfirm = result.confidence >= 0.90;
                }
            }
        }

        // Determine recommended extraction method
        result.recommendedMethod = this.getRecommendedMethod(url, result);

        // Determine expected data types
        result.expectedDataTypes = this.getExpectedDataTypes(url, textToSearch);

        return result;
    }

    /**
     * Get recommended extraction method based on URL
     */
    getRecommendedMethod(url, classification) {
        // FamilySearch catalog pages need catalog processor
        if (url.includes('familysearch.org') && url.includes('catalog/')) {
            return 'familysearch_catalog';
        }

        // FamilySearch film viewer needs browser automation + OCR
        if (url.includes('familysearch.org') && (url.includes('ark:') || url.includes('/film/'))) {
            return 'familysearch_ocr';
        }

        // MSA archives - direct PDF download + OCR
        if (url.includes('msa.maryland.gov')) {
            return 'msa_ocr';
        }

        // Rootsweb - HTML table parsing
        if (url.includes('rootsweb')) {
            return 'html_table';
        }

        // Primary sources generally need OCR
        if (classification.isPrimarySource) {
            return 'ocr_with_verification';
        }

        // Default to manual for unknown
        return 'manual';
    }

    /**
     * Get expected data types from URL and content
     */
    getExpectedDataTypes(url, textContent) {
        const types = [];

        // Check for enslaved persons indicators
        if (/slave|enslaved|negro|bondsmen|bondswomen/i.test(textContent)) {
            types.push('enslaved_persons');
        }

        // Check for slaveholder indicators
        if (/owner|slaveholder|master|plantation/i.test(textContent)) {
            types.push('slaveholders');
        }

        // Check for manumission/emancipation
        if (/emancipat|manumit|free|libertat/i.test(textContent)) {
            types.push('emancipation_records');
        }

        // Check for sale records
        if (/sale|auction|sold|deed/i.test(textContent)) {
            types.push('sale_records');
        }

        // Default to both if unclear
        if (types.length === 0) {
            types.push('enslaved_persons', 'slaveholders');
        }

        return types;
    }

    /**
     * Check if a classification should auto-confirm records
     */
    shouldAutoConfirm(classification) {
        // Auto-confirm if:
        // 1. Primary source with high confidence (>= 0.90)
        // 2. OR specific known primary sources
        return classification.shouldAutoConfirm ||
               classification.confidence >= 0.90 ||
               (classification.isPrimarySource && classification.confidence >= 0.85);
    }

    /**
     * Get target tables based on classification
     */
    getTargetTables(classification) {
        if (this.shouldAutoConfirm(classification)) {
            return {
                enslaved: 'enslaved_individuals',
                slaveholder: 'individuals',
                staging: 'unconfirmed_persons' // Also keep in staging for audit
            };
        } else {
            return {
                enslaved: 'unconfirmed_persons',
                slaveholder: 'unconfirmed_persons',
                staging: 'unconfirmed_persons'
            };
        }
    }

    /**
     * Format classification for display
     */
    formatForDisplay(classification) {
        const badge = {
            primary: '🟢 PRIMARY',
            secondary: '🟡 SECONDARY',
            tertiary: '🟠 TERTIARY',
            unknown: '⚪ UNKNOWN'
        };

        return {
            badge: badge[classification.sourceType] || badge.unknown,
            confidence: `${Math.round(classification.confidence * 100)}%`,
            autoConfirm: classification.shouldAutoConfirm ? 'YES - Direct to confirmed' : 'NO - Requires review',
            method: classification.recommendedMethod,
            dataTypes: classification.expectedDataTypes.join(', ')
        };
    }
}

module.exports = SourceClassifier;
