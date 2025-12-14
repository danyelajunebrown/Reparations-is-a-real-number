/**
 * WikiTreeScraper.js
 * 
 * Scrapes genealogy data from WikiTree.com using Puppeteer
 * Handles person profiles, children relationships, and tree traversal
 * 
 * Features:
 * - Fetch person profile data (name, birth, death, WikiTree ID)
 * - Extract children relationships
 * - Navigate to descendant profiles
 * - Parse dates and handle privacy indicators
 * - Rate limiting and error handling
 */

const puppeteer = require('puppeteer');

class WikiTreeScraper {
    constructor(options = {}) {
        this.browser = null;
        this.page = null;
        this.baseUrl = 'https://www.wikitree.com';
        this.rateLimit = options.rateLimit || 2000; // 2 seconds between requests
        this.headless = options.headless !== undefined ? options.headless : true;
        this.cache = new Map(); // Cache scraped profiles
    }

    /**
     * Initialize browser instance
     */
    async init() {
        if (this.browser) {
            console.log('Browser already initialized');
            return;
        }

        console.log('Initializing Puppeteer browser...');
        this.browser = await puppeteer.launch({
            headless: this.headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1280, height: 800 });
        
        // Set reasonable timeouts
        this.page.setDefaultNavigationTimeout(30000);
        this.page.setDefaultTimeout(30000);

        console.log('✓ Browser initialized');
    }

    /**
     * Close browser instance
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            console.log('Browser closed');
        }
    }

    /**
     * Scrape a WikiTree profile by ID
     * @param {string} wikiTreeId - WikiTree ID (e.g., "Hopewell-183")
     * @returns {Object} Profile data
     */
    async scrapeProfile(wikiTreeId) {
        // Check cache first
        if (this.cache.has(wikiTreeId)) {
            console.log(`Using cached data for ${wikiTreeId}`);
            return this.cache.get(wikiTreeId);
        }

        if (!this.browser) {
            await this.init();
        }

        const url = `${this.baseUrl}/wiki/${wikiTreeId}`;
        console.log(`Scraping profile: ${url}`);

        try {
            await this.page.goto(url, { waitUntil: 'networkidle2' });

            // Extract profile data
            const profileData = await this.page.evaluate(() => {
                const data = {
                    success: true,
                    wikiTreeId: window.location.pathname.split('/wiki/')[1]
                };

                // Name
                const nameEl = document.querySelector('h1[itemprop="name"]');
                data.name = nameEl ? nameEl.textContent.trim() : null;

                // Birth info
                const birthEl = document.querySelector('#Birth');
                if (birthEl) {
                    data.birthInfo = birthEl.textContent.trim();
                    
                    // Try to extract birth year
                    const birthDateEl = birthEl.querySelector('[itemprop="birthDate"]');
                    if (birthDateEl) {
                        const datetime = birthDateEl.getAttribute('datetime');
                        if (datetime) {
                            data.birthYear = parseInt(datetime.split('-')[0]);
                        }
                    }
                    
                    // Extract birth location
                    const birthPlaceEl = birthEl.querySelector('[itemprop="birthPlace"]');
                    if (birthPlaceEl) {
                        data.birthPlace = birthPlaceEl.textContent.trim();
                    }
                }

                // Death info
                const deathEl = document.querySelector('#Death');
                if (deathEl) {
                    data.deathInfo = deathEl.textContent.trim();
                    
                    // Try to extract death year
                    const deathDateEl = deathEl.querySelector('[itemprop="deathDate"]');
                    if (deathDateEl) {
                        const datetime = deathDateEl.getAttribute('datetime');
                        if (datetime) {
                            data.deathYear = parseInt(datetime.split('-')[0]);
                        }
                    }
                    
                    // Extract death location
                    const deathPlaceEl = deathEl.querySelector('[itemprop="deathPlace"]');
                    if (deathPlaceEl) {
                        data.deathPlace = deathPlaceEl.textContent.trim();
                    }
                }

                // Check if person is private/living
                data.isPrivate = document.body.textContent.includes('Private');
                data.isLiving = !data.deathYear && !data.deathInfo;

                return data;
            });

            // Extract children
            profileData.children = await this.extractChildren();

            // Cache the result
            this.cache.set(wikiTreeId, profileData);

            console.log(`✓ Scraped ${profileData.name} (${profileData.children.length} children)`);

            return profileData;

        } catch (error) {
            console.error(`Error scraping ${wikiTreeId}:`, error.message);
            return {
                success: false,
                wikiTreeId,
                error: error.message
            };
        }
    }

    /**
     * Extract children from current page
     * @returns {Array} Array of child data objects
     */
    async extractChildren() {
        try {
            const children = await this.page.evaluate(() => {
                const childrenData = [];
                
                // Find children section
                const childrenSection = document.querySelector('#Children');
                if (!childrenSection) {
                    return childrenData;
                }

                // Get all child spans with itemprop="children"
                const childSpans = childrenSection.querySelectorAll('[itemprop="children"]');
                
                childSpans.forEach(span => {
                    const link = span.querySelector('a[href*="/wiki/"]');
                    if (link) {
                        const href = link.getAttribute('href');
                        const name = link.textContent.trim();
                        const wikiTreeId = href.split('/wiki/')[1];

                        childrenData.push({
                            name,
                            wikiTreeId,
                            url: href
                        });
                    }
                });

                return childrenData;
            });

            return children;

        } catch (error) {
            console.error('Error extracting children:', error.message);
            return [];
        }
    }

    /**
     * Parse date string from WikiTree format
     * Handles formats like "about 1817", "between 1800 and 1810", "[date unknown]"
     * @param {string} dateString - Date string from WikiTree
     * @returns {Object} { year, isApproximate, isUnknown }
     */
    parseDate(dateString) {
        if (!dateString || dateString.includes('[date unknown]') || dateString.includes('[unknown]')) {
            return { year: null, isApproximate: false, isUnknown: true };
        }

        // Extract year from various formats
        let year = null;
        let isApproximate = false;

        // "about YYYY" or "abt YYYY"
        if (dateString.includes('about') || dateString.includes('abt')) {
            const match = dateString.match(/\d{4}/);
            year = match ? parseInt(match[0]) : null;
            isApproximate = true;
        }
        // "between YYYY and YYYY"
        else if (dateString.includes('between') && dateString.includes('and')) {
            const matches = dateString.match(/\d{4}/g);
            if (matches && matches.length >= 2) {
                // Use midpoint
                year = Math.floor((parseInt(matches[0]) + parseInt(matches[1])) / 2);
                isApproximate = true;
            }
        }
        // Just a year "YYYY"
        else {
            const match = dateString.match(/\d{4}/);
            year = match ? parseInt(match[0]) : null;
        }

        return { year, isApproximate, isUnknown: year === null };
    }

    /**
     * Estimate if person is living based on dates
     * @param {number} birthYear - Birth year
     * @param {number} deathYear - Death year (null if unknown)
     * @returns {boolean} Estimated living status
     */
    estimateLiving(birthYear, deathYear) {
        if (deathYear) {
            return false; // Has death year = not living
        }

        if (!birthYear) {
            return null; // Unknown
        }

        const currentYear = new Date().getFullYear();
        const age = currentYear - birthYear;

        // Definitely deceased if over 120 years old
        if (age > 120) {
            return false;
        }

        // Likely living if under 100
        if (age < 100) {
            return true;
        }

        // Between 100-120: uncertain, default to possibly living
        return true;
    }

    /**
     * Validate parent-child relationship based on age gap
     * @param {number} parentBirthYear - Parent's birth year
     * @param {number} childBirthYear - Child's birth year
     * @returns {boolean} Whether relationship is plausible
     */
    validateRelationship(parentBirthYear, childBirthYear) {
        if (!parentBirthYear || !childBirthYear) {
            return null; // Can't validate without data
        }

        const ageDiff = childBirthYear - parentBirthYear;

        // Plausible parent-child age gap: 15-60 years
        return ageDiff >= 15 && ageDiff <= 60;
    }

    /**
     * Rate limiting: wait before next request
     */
    async wait() {
        return new Promise(resolve => setTimeout(resolve, this.rateLimit));
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        console.log('Cache cleared');
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            size: this.cache.size,
            entries: Array.from(this.cache.keys())
        };
    }
}

module.exports = WikiTreeScraper;
