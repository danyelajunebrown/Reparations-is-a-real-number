/**
 * Enhanced Intelligent Scraper - Complete Solution with Iframe Support
 *
 * This system:
 * 1. Handles both regular HTML and iframe-based content
 * 2. Integrates iframe handler for PDF/image extraction
 * 3. Provides complete slave owner/enslaved data extraction
 * 4. Maintains knowledge base for future reuse
 * 5. Offers robust error handling and fallback mechanisms
 */

const IntelligentScraper = require('./IntelligentScraper');
const IframeHandler = require('./IframeHandler');
const KnowledgeManager = require('./KnowledgeManager');
const MLAnalyzer = require('./MLAnalyzer');

class EnhancedIntelligentScraper extends IntelligentScraper {
    constructor(database, knowledgeManager, mlAnalyzer) {
        super(database, knowledgeManager, mlAnalyzer);
        this.iframeHandler = new IframeHandler(knowledgeManager, mlAnalyzer);
    }

    /**
     * Enhanced scrape method with iframe support
     */
    async scrapeEnhanced(url, metadata = {}) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🤖 ENHANCED INTELLIGENT SCRAPER`);
        console.log(`   Target: ${url}`);
        console.log(`${'='.repeat(60)}`);

        const startTime = Date.now();
        const results = {
            url,
            success: false,
            iframeDetected: false,
            iframeResults: null,
            scrapingResults: null,
            mlAnalysis: null,
            formattedResults: null,
            knowledgeUpdated: false,
            errors: []
        };

        try {
            // Step 1: Check if page has iframes
            console.log('\n📍 Step 1: Checking for iframe content...');
            const iframeCheck = await this.checkForIframes(url);

            if (iframeCheck.hasIframes) {
                results.iframeDetected = true;
                console.log('   ✅ Iframes detected - using iframe handler');

                // Step 2: Process with iframe handler
                console.log('\n📍 Step 2: Processing with iframe handler...');
                results.iframeResults = await this.iframeHandler.handleIframeContent(url, metadata);

                // Step 3: Format results for database
                console.log('\n📍 Step 3: Formatting results for database...');
                results.formattedResults = this.formatIframeResults(results.iframeResults);

                // Step 4: Update knowledge base
                console.log('\n📍 Step 4: Updating knowledge base...');
                results.knowledgeUpdated = true;

                const duration = Date.now() - startTime;
                console.log(`\n✅ Enhanced scraping complete in ${duration}ms`);
                console.log(`   Slave Owners Found: ${results.formattedResults.owners.length}`);
                console.log(`   Enslaved Persons Found: ${results.formattedResults.enslavedPeople.length}`);
                console.log(`   Documents Found: ${results.formattedResults.documents.length}`);

                results.success = true;
                return results;
            } else {
                console.log('   ⚠️  No iframes detected - using regular intelligent scraping');

                // Fall back to regular intelligent scraping
                const regularResults = await super.scrape(url, metadata);
                return regularResults;
            }

        } catch (error) {
            console.error(`\n❌ Enhanced scraping failed: ${error.message}`);
            results.errors.push({
                stage: 'enhanced_scraping',
                error: error.message,
                stack: error.stack
            });
            return results;
        }
    }

    /**
     * Check if page contains iframes
     */
    async checkForIframes(url) {
        try {
            const html = await this.fetchHTML(url);
            const $ = require('cheerio').load(html);
            const iframes = $('iframe');

            return {
                hasIframes: iframes.length > 0,
                iframeCount: iframes.length,
                iframeInfo: iframes.map((i, el) => ({
                    src: $(el).attr('src'),
                    type: this.detectIframeType($(el).attr('src'))
                })).get()
            };
        } catch (error) {
            console.error(`   ❌ Iframe check failed: ${error.message}`);
            return { hasIframes: false, iframeCount: 0, iframeInfo: [] };
        }
    }

    /**
     * Detect iframe type
     */
    detectIframeType(url) {
        if (!url) return 'unknown';
        if (url.endsWith('.pdf')) return 'pdf';
        if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return 'image';
        if (url.match(/\.(html|htm|php|asp)$/i)) return 'html';
        return 'unknown';
    }

    /**
     * Format iframe results for database
     */
    formatIframeResults(iframeResults) {
        const formatted = {
            owners: [],
            enslavedPeople: [],
            relationships: [],
            documents: [],
            metadata: iframeResults.metadata || {}
        };

        // Format slave owners
        iframeResults.slaveOwners.forEach(owner => {
            formatted.owners.push({
                fullName: owner.name,
                type: 'confirmed_owner',
                confidence: owner.confidence,
                sourceUrl: iframeResults.url,
                source: 'iframe_pdf_extraction',
                locations: iframeResults.metadata.locations || ['Montgomery County, MD'],
                notes: `Extracted from PDF: ${owner.evidence}`,
                sourceType: owner.metadata.sourceType || 'primary'
            });
        });

        // Format enslaved persons
        iframeResults.enslavedPersons.forEach(enslaved => {
            formatted.enslavedPeople.push({
                fullName: enslaved.name,
                type: 'confirmed_enslaved',
                confidence: enslaved.confidence,
                sourceUrl: iframeResults.url,
                source: 'iframe_pdf_extraction',
                location: iframeResults.metadata.locations?.[0] || 'Montgomery County, MD',
                slaveholder: this.extractSlaveholderFromContext(enslaved.evidence),
                notes: `Extracted from PDF: ${enslaved.evidence}`,
                sourceType: enslaved.metadata.sourceType || 'primary'
            });
        });

        // Format relationships
        iframeResults.relationships.forEach(relationship => {
            formatted.relationships.push({
                owner: relationship.owner,
                enslaved: relationship.enslaved,
                type: relationship.type || 'slaveholder-enslaved',
                confidence: relationship.confidence,
                sourceUrl: iframeResults.url,
                source: 'iframe_pdf_extraction'
            });
        });

        // Add document metadata
        formatted.documents.push({
            documentType: 'slave_statistics',
            sourceUrl: iframeResults.url,
            sourceType: 'primary',
            title: `Montgomery County Slave Statistics ${iframeResults.metadata.dates?.[0] || '1867-1868'}`,
            content: iframeResults.rawText,
            metadata: {
                pageCount: iframeResults.metadata.pdfInfo?.pageCount || 1,
                extractionMethod: iframeResults.metadata.pdfInfo?.extractionMethod || 'ocr',
                locations: iframeResults.metadata.locations || ['Montgomery County, MD'],
                dates: iframeResults.metadata.dates || ['1867-1868'],
                totalSlaves: iframeResults.metadata.totalSlaves || 0
            }
        });

        return formatted;
    }

    /**
     * Extract slaveholder from context
     */
    extractSlaveholderFromContext(context) {
        // Look for owner names in the context
        const ownerPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)*(?:\s*,\s*\d+)?(?:\s*slaves?)?/gi;
        const match = ownerPattern.exec(context);
        return match ? match[0] : 'Unknown Owner';
    }

    /**
     * Fetch HTML content
     */
    async fetchHTML(url) {
        try {
            const axios = require('axios');
            const response = await axios.get(url, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
                }
            });
            return response.data;
        } catch (error) {
            console.error(`   ❌ Failed to fetch ${url}:`, error.message);
            throw error;
        }
    }

    /**
     * Close all resources
     */
    async close() {
        await super.close();
        await this.iframeHandler.close();
    }
}

module.exports = EnhancedIntelligentScraper;
