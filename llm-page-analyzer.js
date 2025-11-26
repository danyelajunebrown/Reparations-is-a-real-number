/**
 * LLM-Powered Page Analyzer
 *
 * Uses AI to intelligently analyze ANY webpage and determine:
 * - Is this a primary/secondary/tertiary source?
 * - What type of historical document is this?
 * - Are there confirming documents available?
 * - What relationships exist between people?
 *
 * NO HARDCODED RULES - Pure LLM intelligence
 */

const llmAssistant = require('./llm-conversational-assistant');

class LLMPageAnalyzer {
    constructor() {
        this.llmEnabled = !!process.env.OPENROUTER_API_KEY;

        if (!this.llmEnabled) {
            console.warn('⚠️  OpenRouter API key not configured - page analysis will be limited');
        }
    }

    /**
     * Analyze a webpage using LLM intelligence
     * @param {string} url - Page URL
     * @param {string} content - Raw text content
     * @param {string} html - Optional HTML for structural analysis
     * @returns {Promise<Object>} Analysis results
     */
    async analyzePage(url, content, html = null) {
        if (!this.llmEnabled) {
            return this.fallbackAnalysis(url, content);
        }

        try {
            console.log('  🧠 LLM analyzing page...');

            // Truncate content if too long (LLM token limits)
            const truncatedContent = this.truncateForLLM(content, 8000);

            const systemPrompt = `You are an expert historian and genealogist analyzing web pages to identify historical records related to slavery and genealogy in America (1600s-1800s).

Your task: Analyze the provided webpage content and classify it.

**CRITICAL DEFINITIONS:**

PRIMARY SOURCE = Original historical documents created at the time
- Examples: Wills, probate records, slave schedules, census records, compensation petitions, bills of sale, estate inventories, court records, original letters, parish records
- These documents CONFIRM historical facts about slavery and enslaved people
- Only primary sources can promote unconfirmed leads to confirmed records

SECONDARY SOURCE = Modern analysis/interpretation of primary sources
- Examples: History books, academic articles, genealogy research, museum exhibits, historical society publications
- Useful leads but require verification with primary sources

TERTIARY SOURCE = Compilations and summaries
- Examples: Wikipedia, encyclopedias, databases, indexes
- Good starting points but lowest reliability

**YOUR RESPONSE MUST BE VALID JSON:**

{
  "source_type": "primary" | "secondary" | "tertiary" | "unknown",
  "confidence": 0.0 to 1.0,
  "document_type": "will" | "petition" | "census" | "slave_schedule" | "estate_inventory" | "bill_of_sale" | "court_record" | "deed" | "letter" | "other" | null,
  "is_confirming_document": true | false,
  "has_downloadable_documents": true | false,
  "document_locations": ["description of where documents are, if found"],
  "relationships_detected": ["owner-enslaved", "parent-child", "spouse", etc.],
  "contains_slave_ownership_evidence": true | false,
  "reasoning": "brief explanation of classification"
}

**EXAMPLES:**

Example 1 - Compensation Petition:
Content: "Petition of John Smith, 1862. To the Commissioners under the act of Congress approved the 16th of April, 1862... I held a claim to service or labor against Sarah Brown..."
Response: {"source_type":"primary","confidence":0.98,"document_type":"petition","is_confirming_document":true,"has_downloadable_documents":true,"document_locations":["JPG images of original petition"],"relationships_detected":["owner-enslaved"],"contains_slave_ownership_evidence":true,"reasoning":"Original compensation petition filed with US government documenting slave ownership"}

Example 2 - Wikipedia Article:
Content: "From Wikipedia... George Washington (1732-1799) was the first President... He owned hundreds of enslaved people at Mount Vernon..."
Response: {"source_type":"tertiary","confidence":0.95,"document_type":null,"is_confirming_document":false,"has_downloadable_documents":false,"document_locations":[],"relationships_detected":["owner-enslaved"],"contains_slave_ownership_evidence":true,"reasoning":"Wikipedia article citing secondary sources - useful lead but not confirmation"}

Example 3 - Probate Record:
Content: "Last Will and Testament of James Hopewell, 1792... I bequeath to my son the following negroes: Caesar aged 30, Hannah aged 25..."
Response: {"source_type":"primary","confidence":1.0,"document_type":"will","is_confirming_document":true,"has_downloadable_documents":false,"document_locations":[],"relationships_detected":["owner-enslaved","parent-child","enslaved-enslaved"],"contains_slave_ownership_evidence":true,"reasoning":"Original last will and testament directly documenting slave ownership and bequests"}

ONLY return valid JSON, no other text.`;

            const userMessage = `URL: ${url}\n\nCONTENT:\n${truncatedContent}`;

            const llmResponse = await llmAssistant.callLLM(systemPrompt, userMessage);

            // Parse JSON from LLM response
            const analysis = this.parseJSONFromLLM(llmResponse);

            console.log(`  ✓ LLM Analysis: ${analysis.source_type} source (${Math.round(analysis.confidence * 100)}% confidence)`);
            if (analysis.is_confirming_document) {
                console.log(`    🎯 CONFIRMING DOCUMENT DETECTED: ${analysis.document_type}`);
            }

            return analysis;

        } catch (error) {
            console.error('  ⚠️  LLM analysis failed:', error.message);
            console.log('  📋 Falling back to heuristic analysis...');
            return this.fallbackAnalysis(url, content);
        }
    }

    /**
     * Analyze relationships between people on the page
     * @param {string} content - Text content
     * @param {Array} persons - List of person names already extracted
     * @returns {Promise<Array>} Detected relationships
     */
    async analyzeRelationships(content, persons) {
        if (!this.llmEnabled || persons.length === 0) {
            return [];
        }

        try {
            const personList = persons.map(p => p.fullName).join(', ');
            const truncatedContent = this.truncateForLLM(content, 6000);

            const systemPrompt = `You are analyzing historical documents for relationships between people, particularly slave ownership.

People mentioned: ${personList}

Identify ALL relationships between these people. Focus on:
- Slave ownership (who owned whom)
- Family relationships (parent-child, spouse, siblings)
- Inheritance (who bequeathed enslaved people to whom)
- Sales/transfers (who sold/bought enslaved people)

Return ONLY valid JSON array:
[
  {
    "person1": "name",
    "person2": "name",
    "relationship": "owner-enslaved" | "parent-child" | "spouse" | "sold-to" | "bequeathed-to",
    "confidence": 0.0 to 1.0,
    "evidence": "exact quote from text"
  }
]`;

            const userMessage = `CONTENT:\n${truncatedContent}`;

            const llmResponse = await llmAssistant.callLLM(systemPrompt, userMessage);
            const relationships = this.parseJSONFromLLM(llmResponse);

            return Array.isArray(relationships) ? relationships : [];

        } catch (error) {
            console.error('  ⚠️  Relationship analysis failed:', error.message);
            return [];
        }
    }

    /**
     * Truncate content to fit LLM token limits
     */
    truncateForLLM(content, maxChars) {
        if (content.length <= maxChars) return content;

        // Try to truncate at a sentence boundary
        const truncated = content.substring(0, maxChars);
        const lastPeriod = truncated.lastIndexOf('.');

        if (lastPeriod > maxChars * 0.8) {
            return truncated.substring(0, lastPeriod + 1);
        }

        return truncated + '...';
    }

    /**
     * Parse JSON from LLM response (handles markdown code blocks)
     */
    parseJSONFromLLM(llmResponse) {
        let jsonText = llmResponse.trim();

        // Remove markdown code blocks if present
        if (jsonText.includes('```json')) {
            jsonText = jsonText.split('```json')[1].split('```')[0].trim();
        } else if (jsonText.includes('```')) {
            jsonText = jsonText.split('```')[1].split('```')[0].trim();
        }

        return JSON.parse(jsonText);
    }

    /**
     * Fallback analysis when LLM is unavailable
     * Uses simple heuristics (better than nothing)
     */
    fallbackAnalysis(url, content) {
        const lower = url.toLowerCase() + ' ' + content.toLowerCase();

        // Check for obvious indicators
        const isPrimaryIndicators = [
            'national archives', 'nara.gov', 'loc.gov', 'census.gov',
            'probate', 'last will and testament', 'estate inventory',
            'compensation petition', 'commissioners', 'slave schedule'
        ];

        const isSecondaryIndicators = [
            '.edu', 'university', 'historical society', 'museum',
            'ancestry.com', 'familysearch.org', 'findagrave.com'
        ];

        const isTertiaryIndicators = [
            'wikipedia.org', 'britannica.com', 'encyclopedia'
        ];

        let source_type = 'unknown';
        let confidence = 0.5;

        if (isPrimaryIndicators.some(indicator => lower.includes(indicator))) {
            source_type = 'primary';
            confidence = 0.7;
        } else if (isSecondaryIndicators.some(indicator => lower.includes(indicator))) {
            source_type = 'secondary';
            confidence = 0.6;
        } else if (isTertiaryIndicators.some(indicator => lower.includes(indicator))) {
            source_type = 'tertiary';
            confidence = 0.8;
        }

        return {
            source_type,
            confidence,
            document_type: null,
            is_confirming_document: source_type === 'primary',
            has_downloadable_documents: false,
            document_locations: [],
            relationships_detected: [],
            contains_slave_ownership_evidence: lower.includes('slave') || lower.includes('enslaved'),
            reasoning: 'Fallback heuristic analysis (LLM unavailable)'
        };
    }
}

module.exports = LLMPageAnalyzer;
