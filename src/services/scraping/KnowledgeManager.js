/**
 * Knowledge Manager - Memory Banking System for Web Scraping
 *
 * This system:
 * 1. Stores and retrieves scraping knowledge
 * 2. Tracks success rates for different websites
 * 3. Learns from previous scraping sessions
 * 4. Adapts to new website structures
 * 5. Maintains a knowledge base of patterns and strategies
 */

const fs = require('fs');
const path = require('path');

class KnowledgeManager {
    constructor() {
        this.knowledgeFile = path.join(__dirname, '..', '..', '..', 'memory-bank', 'scraping-knowledge.json');
        this.knowledge = this.loadKnowledge();
        this.ensureDefaultStructure();
    }

    /**
     * Load knowledge from JSON file
     */
    loadKnowledge() {
        try {
            const data = fs.readFileSync(this.knowledgeFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.warn('📚 Knowledge file not found, creating default structure');
            return this.createDefaultKnowledge();
        }
    }

    /**
     * Create default knowledge structure
     */
    createDefaultKnowledge() {
        return {
            sites: {},
            generalPatterns: {
                ownerNames: ["slaveholder", "owner", "estate", "plantation", "master", "proprietor"],
                enslavedNames: ["enslaved", "slave", "servant", "negro", "colored", "bondsperson"],
                locationPatterns: [
                    "in\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*)",
                    "at\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*)",
                    "from\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*)",
                    "County,\\s*([A-Z]{2})"
                ],
                datePatterns: [
                    "born\\s+(\\d{4})",
                    "died\\s+(\\d{4})",
                    "date\\s+(\\d{4})",
                    "(\\d{1,2})\\s+(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{4})"
                ],
                relationshipPatterns: [
                    "owned\\s+by\\s+([A-Z][a-z]+)",
                    "enslaved\\s+by\\s+([A-Z][a-z]+)",
                    "servant\\s+of\\s+([A-Z][a-z]+)"
                ]
            },
            metadataSchema: {
                sourceType: ["primary", "secondary", "tertiary"],
                dataTypes: ["owners", "enslaved", "relationships", "locations", "dates", "documents"],
                listingPage: ["yes", "no"],
                confidenceLevels: {
                    primary: 0.9,
                    secondary: 0.7,
                    tertiary: 0.5,
                    generic: 0.4
                },
                documentTypes: ["petition", "census", "directory", "article", "memorial", "archive"],
                priorityLevels: {
                    high: 10,
                    medium: 5,
                    low: 1
                }
            },
            learningStatistics: {
                totalSitesLearned: 0,
                totalPatternsLearned: 0,
                averageSuccessRate: 0,
                lastUpdate: new Date().toISOString()
            }
        };
    }

    /**
     * Ensure knowledge has required structure
     */
    ensureDefaultStructure() {
        if (!this.knowledge.sites) this.knowledge.sites = {};
        if (!this.knowledge.generalPatterns) this.knowledge.generalPatterns = this.createDefaultKnowledge().generalPatterns;
        if (!this.knowledge.metadataSchema) this.knowledge.metadataSchema = this.createDefaultKnowledge().metadataSchema;
        if (!this.knowledge.learningStatistics) this.knowledge.learningStatistics = this.createDefaultKnowledge().learningStatistics;
    }

    /**
     * Save knowledge to file
     */
    saveKnowledge() {
        try {
            fs.writeFileSync(this.knowledgeFile, JSON.stringify(this.knowledge, null, 2));
            return true;
        } catch (error) {
            console.error('❌ Failed to save knowledge:', error.message);
            return false;
        }
    }

    /**
     * Get knowledge for a specific site
     */
    getSiteKnowledge(url) {
        const domain = this.extractDomain(url);
        return this.knowledge.sites[domain] || null;
    }

    /**
     * Add or update knowledge for a site
     */
    addSiteKnowledge(url, siteData) {
        const domain = this.extractDomain(url);
        if (!domain) return false;

        const existing = this.knowledge.sites[domain] || {};

        this.knowledge.sites[domain] = {
            ...existing,
            ...siteData,
            lastUpdated: new Date().toISOString(),
            firstSeen: existing.firstSeen || new Date().toISOString()
        };

        // Update statistics
        this.knowledge.learningStatistics.totalSitesLearned = Object.keys(this.knowledge.sites).length;
        this.knowledge.learningStatistics.lastUpdate = new Date().toISOString();

        // Calculate average success rate
        const successRates = Object.values(this.knowledge.sites)
            .map(site => site.successRate || 0)
            .filter(rate => rate > 0);

        this.knowledge.learningStatistics.averageSuccessRate =
            successRates.length > 0
                ? successRates.reduce((sum, rate) => sum + rate, 0) / successRates.length
                : 0;

        return this.saveKnowledge();
    }

    /**
     * Update success rate for a site
     */
    updateSuccessRate(url, success) {
        const domain = this.extractDomain(url);
        if (!domain || !this.knowledge.sites[domain]) return false;

        const site = this.knowledge.sites[domain];
        site.attempts = (site.attempts || 0) + 1;
        site.successes = (site.successes || 0) + (success ? 1 : 0);
        site.successRate = site.successes / site.attempts;

        // Update statistics
        this.knowledge.learningStatistics.totalSitesLearned = Object.keys(this.knowledge.sites).length;
        this.knowledge.learningStatistics.lastUpdate = new Date().toISOString();

        return this.saveKnowledge();
    }

    /**
     * Extract domain from URL
     */
    extractDomain(url) {
        try {
            const hostname = new URL(url).hostname;
            return hostname.replace('www.', '');
        } catch (error) {
            console.warn(`⚠️ Invalid URL for domain extraction: ${url}`);
            return null;
        }
    }

    /**
     * Get general patterns for all sites
     */
    getGeneralPatterns() {
        return this.knowledge.generalPatterns;
    }

    /**
     * Get metadata schema
     */
    getMetadataSchema() {
        return this.knowledge.metadataSchema;
    }

    /**
     * Get learning statistics
     */
    getLearningStatistics() {
        return this.knowledge.learningStatistics;
    }

    /**
     * Add a new pattern to general patterns
     */
    addGeneralPattern(patternType, pattern) {
        if (!this.knowledge.generalPatterns[patternType]) {
            this.knowledge.generalPatterns[patternType] = [];
        }

        if (!this.knowledge.generalPatterns[patternType].includes(pattern)) {
            this.knowledge.generalPatterns[patternType].push(pattern);
            this.knowledge.learningStatistics.totalPatternsLearned++;
            return this.saveKnowledge();
        }

        return true;
    }

    /**
     * Get base confidence for a URL
     */
    getBaseConfidence(url) {
        const domain = this.extractDomain(url);
        if (!domain) return 0.4; // Default for invalid URLs

        const siteKnowledge = this.getSiteKnowledge(url);
        if (siteKnowledge && siteKnowledge.confidence) {
            return siteKnowledge.confidence;
        }

        // Fallback to general confidence levels
        if (url.includes('rootsweb.com') || url.includes('civilwardc.org')) {
            return 0.8;
        } else if (url.includes('beyondkin.org') || url.includes('familysearch.org')) {
            return 0.6;
        } else if (url.includes('wikipedia.org') || url.includes('britannica.com')) {
            return 0.5;
        } else {
            return 0.4;
        }
    }

    /**
     * Get all known sites
     */
    getAllSites() {
        return this.knowledge.sites;
    }

    /**
     * Get sites by type
     */
    getSitesByType(type) {
        return Object.entries(this.knowledge.sites)
            .filter(([_, site]) => site.type === type)
            .map(([domain, site]) => ({ domain, ...site }));
    }

    /**
     * Get sites by source type
     */
    getSitesBySourceType(sourceType) {
        return Object.entries(this.knowledge.sites)
            .filter(([_, site]) => site.sourceType === sourceType)
            .map(([domain, site]) => ({ domain, ...site }));
    }

    /**
     * Get top performing sites
     */
    getTopPerformingSites(limit = 5) {
        return Object.entries(this.knowledge.sites)
            .map(([domain, site]) => ({ domain, ...site }))
            .sort((a, b) => (b.successRate || 0) - (a.successRate || 0))
            .slice(0, limit);
    }

    /**
     * Get sites needing improvement
     */
    getSitesNeedingImprovement(threshold = 0.6) {
        return Object.entries(this.knowledge.sites)
            .map(([domain, site]) => ({ domain, ...site }))
            .filter(site => (site.successRate || 0) < threshold);
    }
}

module.exports = KnowledgeManager;
