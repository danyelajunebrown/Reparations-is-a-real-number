/**
 * Intelligent Scraper - Dynamic Scraper Generator
 *
 * This system:
 * 1. Creates custom scrapers on-demand
 * 2. Adapts to new website structures
 * 3. Learns from previous sessions
 * 4. Combines pattern matching with ML analysis
 * 5. Provides intelligent scraping capabilities
 */

const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

class IntelligentScraper {
    constructor(database, knowledgeManager, mlAnalyzer) {
        this.db = database;
        this.knowledge = knowledgeManager;
        this.ml = mlAnalyzer;
        this.browser = null;
    }

    /**
     * Create a custom scraper for a specific URL
     */
    async createCustomScraper(url, metadata) {
        const domain = this.knowledge.extractDomain(url);
        const existingKnowledge = this.knowledge.getSiteKnowledge(url);

        // Create scraper configuration
        const scraperConfig = {
            url,
            domain,
            metadata: metadata || {},
            patterns: existingKnowledge?.patterns || this.getDefaultPatterns(),
            confidence: existingKnowledge?.confidence || this.ml.getBaseConfidence(url),
            strategies: this.determineStrategies(url, metadata),
            sourceType: this.ml.determineSourceType(url),
            documentType: this.ml.determineDocumentType('', url)
        };

        return new CustomScraper(this.db, scraperConfig, this.ml, this.knowledge);
    }

    /**
     * Get default patterns for unknown sites
     */
    getDefaultPatterns() {
        return {
            owner: /(owner|slaveholder|plantation)[\s\S]*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
            enslaved: /(enslaved|slave|servant)[\s\S]*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
            location: /(in|at|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
            date: /(born|died|date)\s+(\d{4})/gi,
            document: /href=[\"']([^\"']+\.(?:pdf|jpg|png))[\"']/gi
        };
    }

    /**
     * Determine scraping strategies based on URL and metadata
     */
    determineStrategies(url, metadata) {
        const strategies = ['html_parsing', 'text_extraction'];

        if (metadata?.isListingPage === 'yes') {
            strategies.push('link_extraction');
        }

        if (url.includes('archive.org') || url.includes('.pdf')) {
            strategies.push('document_download');
        }

        if (metadata?.dataTypes?.includes('documents')) {
            strategies.push('document_extraction');
        }

        return strategies;
    }

    /**
     * Close browser resources
     */
    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

class CustomScraper {
    constructor(database, config, mlAnalyzer, knowledgeManager) {
        this.db = database;
        this.config = config;
        this.ml = mlAnalyzer;
        this.knowledge = knowledgeManager;
        this.results = {
            owners: [],
            enslavedPeople: [],
            relationships: [],
            documents: [],
            metadata: config.metadata,
            analysis: null,
            success: false,
            errors: []
        };
    }

    /**
     * Main scraping method
     */
    async scrape() {
        const startTime = Date.now();
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🤖 INTELLIGENT SCRAPER`);
        console.log(`   URL: ${this.config.url}`);
        console.log(`   Domain: ${this.config.domain}`);
        console.log(`   Source Type: ${this.config.sourceType}`);
        console.log(`   Document Type: ${this.config.documentType}`);
        console.log(`${'='.repeat(60)}`);

        try {
            // Step 1: Fetch HTML content
            const html = await this.fetchHTML(this.config.url);
            const text = this.extractText(html);

            // Step 2: ML Analysis
            this.results.analysis = this.ml.analyzePageContent(text, this.config.url);

            // Step 3: Apply patterns and ML analysis
            this.applyPatterns(text, this.results.analysis);

            // Step 4: Apply ML entity extraction
            this.applyMLEntities(this.results.analysis);

            // Step 5: Extract documents if needed
            if (this.config.strategies.includes('document_extraction')) {
                await this.extractDocuments(html);
            }

            // Step 6: Extract links if listing page
            if (this.config.strategies.includes('link_extraction')) {
                await this.extractLinks(html);
            }

            this.results.success = true;
            this.results.duration = Date.now() - startTime;

            // Update knowledge base
            await this.updateKnowledge();

            console.log(`\n✅ Scraping complete in ${this.results.duration}ms`);
            console.log(`   Owners found: ${this.results.owners.length}`);
            console.log(`   Enslaved found: ${this.results.enslavedPeople.length}`);
            console.log(`   Documents found: ${this.results.documents.length}`);
            console.log(`   Confidence: ${this.results.analysis.confidence.toFixed(2)}`);

            return this.results;

        } catch (error) {
            this.results.success = false;
            this.results.errors.push({
                stage: 'scraping',
                error: error.message,
                timestamp: new Date().toISOString()
            });
            console.error(`\n❌ Scraping failed: ${error.message}`);
            return this.results;
        }
    }

    /**
     * Fetch HTML content from URL
     */
    async fetchHTML(url) {
        try {
            const response = await axios.get(url, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
                }
            });
            return response.data;
        } catch (error) {
            console.error(`❌ Failed to fetch ${url}:`, error.message);
            throw error;
        }
    }

    /**
     * Extract text from HTML
     */
    extractText(html) {
        const $ = cheerio.load(html);
        $('script, style, nav, footer, aside').remove();
        return $('body').text();
    }

    /**
     * Apply pattern matching
     */
    applyPatterns(text, analysis) {
        // Apply owner patterns
        Object.entries(this.config.patterns).forEach(([type, pattern]) => {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const name = match[1].trim();
                if (type === 'owner' && !this.results.owners.find(o => o.name === name)) {
                    this.results.owners.push({
                        name,
                        confidence: analysis.confidence,
                        source: 'pattern_matching',
                        evidence: this.getContextAroundName(text, name)
                    });
                } else if (type === 'enslaved' && !this.results.enslavedPeople.find(e => e.name === name)) {
                    this.results.enslavedPeople.push({
                        name,
                        confidence: analysis.confidence,
                        source: 'pattern_matching',
                        evidence: this.getContextAroundName(text, name)
                    });
                }
            }
        });
    }

    /**
     * Apply ML entity extraction
     */
    applyMLEntities(analysis) {
        // Add ML-extracted owners
        analysis.entities.owners.forEach(owner => {
            if (!this.results.owners.find(o => o.name === owner)) {
                this.results.owners.push({
                    name: owner,
                    confidence: analysis.confidence + 0.1,
                    source: 'ml_analysis',
                    evidence: `ML analysis identified as owner (confidence: ${analysis.confidence.toFixed(2)})`
                });
            }
        });

        // Add ML-extracted enslaved people
        analysis.entities.enslaved.forEach(enslaved => {
            if (!this.results.enslavedPeople.find(e => e.name === enslaved)) {
                this.results.enslavedPeople.push({
                    name: enslaved,
                    confidence: analysis.confidence + 0.1,
                    source: 'ml_analysis',
                    evidence: `ML analysis identified as enslaved (confidence: ${analysis.confidence.toFixed(2)})`
                });
            }
        });

        // Add ML-extracted relationships
        analysis.entities.relationships.forEach(relationship => {
            this.results.relationships.push({
                owner: relationship.owner,
                enslaved: relationship.enslaved,
                type: relationship.type,
                confidence: analysis.confidence,
                source: 'ml_analysis'
            });
        });
    }

    /**
     * Extract documents from page
     */
    async extractDocuments(html) {
        const $ = cheerio.load(html);

        // Extract document links
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && (href.includes('.pdf') || href.includes('.jpg') || href.includes('.png'))) {
                const fullUrl = href.startsWith('http') ? href : new URL(href, this.config.url).href;
                this.results.documents.push({
                    url: fullUrl,
                    type: 'linked_document',
                    text: $(el).text().trim()
                });
            }
        });
    }

    /**
     * Extract links for listing pages
     */
    async extractLinks(html) {
        const $ = cheerio.load(html);
        const links = [];

        // Extract all links that might be record pages
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && !href.includes('http') && !href.includes('#') && !href.includes('javascript:')) {
                const fullUrl = new URL(href, this.config.url).href;
                links.push({
                    url: fullUrl,
                    text: $(el).text().trim()
                });
            }
        });

        // Queue links for processing if this is a listing page
        if (links.length > 0 && this.config.metadata.isListingPage === 'yes') {
            await this.queueLinksForProcessing(links);
        }
    }

    /**
     * Queue links for background processing
     */
    async queueLinksForProcessing(links) {
        console.log(`📋 Found ${links.length} record links for queueing`);

        for (const link of links) {
            try {
                await this.db.query(
                    `INSERT INTO scraping_queue (url, category, status, priority, metadata)
                     VALUES ($1, $2, 'pending', $3, $4::jsonb)
                     ON CONFLICT (url) DO NOTHING`,
                    [
                        link.url,
                        'auto_queued',
                        5,
                        {
                            sourceUrl: this.config.url,
                            queuedBy: 'intelligent_scraper',
                            relationship: 'listing_page'
                        }
                    ]
                );
                console.log(`   ✓ Queued: ${link.url}`);
            } catch (error) {
                console.warn(`   ⚠️  Failed to queue ${link.url}:`, error.message);
            }
        }
    }

    /**
     * Get context around a name for evidence
     */
    getContextAroundName(text, name) {
        const index = text.indexOf(name);
        if (index === -1) return '';

        const start = Math.max(0, index - 100);
        const end = Math.min(text.length, index + name.length + 100);
        return text.substring(start, end);
    }

    /**
     * Update knowledge base with scraping results
     */
    async updateKnowledge() {
        const success = this.results.owners.length > 0 || this.results.enslavedPeople.length > 0;

        // Update success rate
        this.knowledge.updateSuccessRate(this.config.url, success);

        // If this was a successful scrape for an unknown site, add to knowledge
        if (success && !this.knowledge.getSiteKnowledge(this.config.url)) {
            const siteData = {
                type: this.results.analysis.documentType,
                patterns: this.config.patterns,
                confidence: this.results.analysis.confidence,
                sourceType: this.results.analysis.sourceType,
                description: `Auto-learned from ${this.config.domain}`,
                successRate: 1.0,
                attempts: 1,
                successes: 1
            };

            this.knowledge.addSiteKnowledge(this.config.url, siteData);
            console.log(`📚 Added new site knowledge for ${this.config.domain}`);
        }
    }

    /**
     * Format results for database saving
     */
    formatForDatabase() {
        return {
            owners: this.results.owners.map(owner => ({
                fullName: owner.name,
                type: owner.confidence >= 0.9 ? 'confirmed_owner' : 'suspected_owner',
                source: 'intelligent_scraper',
                sourceUrl: this.config.url,
                confidence: owner.confidence,
                locations: this.results.analysis.entities.locations,
                notes: owner.evidence || `Extracted by intelligent scraper (confidence: ${owner.confidence.toFixed(2)})`
            })),
            enslavedPeople: this.results.enslavedPeople.map(enslaved => ({
                fullName: enslaved.name,
                type: enslaved.confidence >= 0.9 ? 'confirmed_enslaved' : 'suspected_enslaved',
                source: 'intelligent_scraper',
                sourceUrl: this.config.url,
                confidence: enslaved.confidence,
                slaveholder: this.findSlaveholderForEnslaved(enslaved.name),
                location: this.results.analysis.entities.locations[0] || null,
                notes: enslaved.evidence || `Extracted by intelligent scraper (confidence: ${enslaved.confidence.toFixed(2)})`
            })),
            relationships: this.results.relationships.map(rel => ({
                type: rel.type,
                owner: rel.owner,
                enslaved: rel.enslaved,
                source: rel.source,
                confidence: rel.confidence
            }))
        };
    }

    /**
     * Find slaveholder for enslaved person
     */
    findSlaveholderForEnslaved(enslavedName) {
        // Check relationships first
        const relationship = this.results.relationships.find(r => r.enslaved === enslavedName);
        if (relationship) return relationship.owner;

        // Check if any owner name is similar
        for (const owner of this.results.owners) {
            if (this.areNamesSimilar(owner.name, enslavedName)) {
                return owner.name;
            }
        }

        return 'Unknown';
    }

    /**
     * Check if names are similar (same surname)
     */
    areNamesSimilar(name1, name2) {
        const surname1 = name1.split(' ').pop();
        const surname2 = name2.split(' ').pop();
        return surname1 === surname2;
    }
}

module.exports = IntelligentScraper;
