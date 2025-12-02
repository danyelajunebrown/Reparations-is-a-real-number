/**
 * Unified Scraper System
 *
 * A complete, working scraper that:
 * 1. Handles multiple site types dynamically
 * 2. Extracts owners (confirmed/suspected) and enslaved people
 * 3. Routes data to appropriate database tables
 * 4. Works with the contribute page flow
 *
 * Site Types Supported:
 * - beyondkin: Beyond Kin Enslaved Populations Directory
 * - civilwardc: DC Compensated Emancipation Petitions
 * - wikipedia: Wikipedia articles
 * - findagrave: FindAGrave memorials
 * - familysearch: FamilySearch pages (HTML)
 * - archive: Archive.org documents
 * - generic: Any other webpage
 */

const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

class UnifiedScraper {
    constructor(database, config = {}) {
        this.db = database;
        this.config = {
            timeout: config.timeout || 30000,
            userAgent: config.userAgent || 'Reparations Research Bot (Historical Genealogy Research)',
            ...config
        };
        this.browser = null;
    }

    /**
     * Main entry point - scrape a URL based on its category/type
     */
    async scrapeURL(url, options = {}) {
        const startTime = Date.now();
        const category = options.category || this.detectCategory(url);

        console.log(`\n${'='.repeat(60)}`);
        console.log(`🔍 UNIFIED SCRAPER`);
        console.log(`   URL: ${url}`);
        console.log(`   Category: ${category}`);
        console.log(`${'='.repeat(60)}`);

        const result = {
            url,
            category,
            success: false,
            owners: [],           // Confirmed or suspected slaveholders
            enslavedPeople: [],   // Confirmed or suspected enslaved people
            relationships: [],    // Owner-enslaved relationships
            documents: [],        // Found documents/images
            rawText: '',
            metadata: {},
            errors: []
        };

        try {
            // Choose scraping strategy based on category
            switch (category) {
                case 'beyondkin':
                    await this.scrapeBeyondKin(url, result, options);
                    break;
                case 'civilwardc':
                    await this.scrapeCivilWarDC(url, result, options);
                    break;
                case 'rootsweb_census':
                    await this.scrapeRootswebCensus(url, result, options);
                    break;
                case 'wikipedia':
                    await this.scrapeWikipedia(url, result, options);
                    break;
                case 'findagrave':
                    await this.scrapeFindAGrave(url, result, options);
                    break;
                case 'familysearch':
                    await this.scrapeFamilySearch(url, result, options);
                    break;
                case 'archive':
                    await this.scrapeArchive(url, result, options);
                    break;
                default:
                    await this.scrapeGeneric(url, result, options);
            }

            result.success = true;
            result.duration = Date.now() - startTime;

            // Save extracted data to database
            await this.saveResults(result, options);

            console.log(`\n✅ Scraping complete in ${result.duration}ms`);
            console.log(`   Owners found: ${result.owners.length}`);
            console.log(`   Enslaved found: ${result.enslavedPeople.length}`);
            console.log(`   Relationships: ${result.relationships.length}`);

        } catch (error) {
            result.success = false;
            result.errors.push({ stage: 'scraping', error: error.message });
            console.error(`\n❌ Scraping failed: ${error.message}`);
        } finally {
            await this.closeBrowser();
        }

        return result;
    }

    /**
     * Detect category from URL pattern
     */
    detectCategory(url) {
        const lower = url.toLowerCase();

        if (lower.includes('beyondkin.org')) return 'beyondkin';
        if (lower.includes('civilwardc.org')) return 'civilwardc';
        if (lower.includes('freepages.rootsweb.com') || lower.includes('rootsweb.com/~ajac')) return 'rootsweb_census';
        if (lower.includes('wikipedia.org')) return 'wikipedia';
        if (lower.includes('findagrave.com')) return 'findagrave';
        if (lower.includes('familysearch.org')) return 'familysearch';
        if (lower.includes('archive.org')) return 'archive';
        if (lower.includes('ancestry.com')) return 'ancestry';

        return 'generic';
    }

    /**
     * ========================================
     * BEYOND KIN SCRAPER
     * ========================================
     * Scrapes the Beyond Kin Enslaved Populations Directory
     * Source: https://beyondkin.org
     * Data: Suspected slaveholders and enslaved people
     */
    async scrapeBeyondKin(url, result, options) {
        console.log('\n📗 Scraping Beyond Kin...');

        const html = await this.fetchHTML(url);
        const $ = cheerio.load(html);
        result.rawText = $('body').text();

        // Beyond Kin entry detail page structure
        // Look for slaveholder info
        const slaveholderSection = $('.pdb-field-name, .field-name, [class*="slaveholder"]');
        const enslavedSection = $('.pdb-field-enslaved, .enslaved-list, [class*="enslaved"]');

        // Extract slaveholder name
        let slaveholderName = '';
        $('h1, h2, .title, .pdb-field-name').each((i, el) => {
            const text = $(el).text().trim();
            if (text && text.length > 2 && text.length < 100) {
                slaveholderName = text;
                return false; // break
            }
        });

        if (slaveholderName) {
            result.owners.push({
                fullName: slaveholderName,
                type: 'suspected_owner',
                source: 'beyondkin',
                sourceUrl: url,
                confidence: 0.7, // Beyond Kin is secondary source
                locations: this.extractLocations(result.rawText),
                notes: 'Extracted from Beyond Kin directory'
            });
        }

        // Extract enslaved people - look for patterns
        const enslavedPatterns = [
            /enslaved?(?:\s+person)?[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
            /(?:slave|servant)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
            /([A-Z][a-z]+)(?:\s*,\s*(?:age|aged)\s*(\d+))?/g
        ];

        // Look in specific sections or tables
        $('table, .enslaved-list, ul, ol').each((i, el) => {
            const text = $(el).text();
            this.extractNamesFromText(text).forEach(name => {
                if (name !== slaveholderName && !result.enslavedPeople.find(e => e.fullName === name)) {
                    result.enslavedPeople.push({
                        fullName: name,
                        type: 'suspected_enslaved',
                        source: 'beyondkin',
                        sourceUrl: url,
                        confidence: 0.6,
                        slaveholder: slaveholderName,
                        notes: 'Extracted from Beyond Kin entry'
                    });
                }
            });
        });

        // Create relationships
        if (slaveholderName && result.enslavedPeople.length > 0) {
            result.enslavedPeople.forEach(enslaved => {
                result.relationships.push({
                    type: 'enslaver-enslaved',
                    owner: slaveholderName,
                    enslaved: enslaved.fullName,
                    source: 'beyondkin',
                    confidence: 0.6
                });
            });
        }

        // Extract any linked documents/trees
        $('a[href*="tree"], a[href*="familysearch"], a[href*="ancestry"]').each((i, el) => {
            result.documents.push({
                url: $(el).attr('href'),
                type: 'linked_tree',
                text: $(el).text().trim()
            });
        });

        result.metadata = {
            pageType: 'beyondkin_entry',
            slaveholderName,
            enslavedCount: result.enslavedPeople.length
        };
    }

    /**
     * ========================================
     * CIVIL WAR DC SCRAPER
     * ========================================
     * Scrapes DC Compensated Emancipation Petitions
     * Source: https://civilwardc.org/texts/petitions/
     * Data: CONFIRMED slaveholders and enslaved people (primary source!)
     */
    async scrapeCivilWarDC(url, result, options) {
        console.log('\n📜 Scraping Civil War DC Petition...');

        const html = await this.fetchHTML(url);
        const $ = cheerio.load(html);
        result.rawText = $('body').text();

        // Civil War DC petition structure
        // These are PRIMARY SOURCES - high confidence!

        // Extract petitioner (slaveholder) name
        let petitionerName = '';
        $('h1, h2, .petitioner, .title').each((i, el) => {
            const text = $(el).text().trim();
            // Pattern: "Petition of [Name]" or just the name
            const match = text.match(/petition\s+of\s+(.+)/i) ||
                          text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/);
            if (match) {
                petitionerName = match[1].trim();
                return false;
            }
        });

        // Look for name in document metadata
        if (!petitionerName) {
            const metaText = $('meta[name="description"]').attr('content') || '';
            const match = metaText.match(/petition.*?by\s+(.+?)(?:,|$)/i);
            if (match) petitionerName = match[1].trim();
        }

        if (petitionerName) {
            result.owners.push({
                fullName: petitionerName,
                type: 'confirmed_owner', // Primary source!
                source: 'civilwardc',
                sourceUrl: url,
                confidence: 0.95, // Very high - primary government document
                locations: ['Washington, D.C.'],
                notes: 'Confirmed slaveholder from DC Compensated Emancipation Petition'
            });
        }

        // Extract enslaved people from petition
        // Petitions list each enslaved person with details
        const enslavedSection = $('table, .enslaved, .persons, [class*="slave"]');

        // Common patterns in petitions:
        // "Negro man named [Name], aged about [X] years"
        // "[Name], a [man/woman/boy/girl], aged [X]"
        const patterns = [
            /(?:negro|colored|slave|servant)\s+(?:man|woman|boy|girl|child)?\s*(?:named|called)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:aged?|about)?\s*(\d+)?/gi,
            /([A-Z][a-z]+)\s*,\s*(?:a\s+)?(?:negro|colored|slave)?\s*(?:man|woman|boy|girl)?\s*,?\s*(?:aged?|about)?\s*(\d+)?/gi
        ];

        const petitionText = result.rawText;
        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(petitionText)) !== null) {
                const name = match[1].trim();
                const age = match[2] ? parseInt(match[2]) : null;

                if (name && name.length > 1 && !result.enslavedPeople.find(e => e.fullName === name)) {
                    result.enslavedPeople.push({
                        fullName: name,
                        type: 'confirmed_enslaved', // Primary source!
                        source: 'civilwardc',
                        sourceUrl: url,
                        confidence: 0.95,
                        age: age,
                        slaveholder: petitionerName,
                        location: 'Washington, D.C.',
                        notes: 'Confirmed from DC Compensated Emancipation Petition'
                    });

                    // Create confirmed relationship
                    if (petitionerName) {
                        result.relationships.push({
                            type: 'enslaver-enslaved',
                            owner: petitionerName,
                            enslaved: name,
                            source: 'civilwardc',
                            confidence: 0.95,
                            confirmed: true
                        });
                    }
                }
            }
        });

        // Extract document images
        $('img[src*="petition"], img[src*="document"], a[href$=".pdf"], a[href$=".jpg"]').each((i, el) => {
            const src = $(el).attr('src') || $(el).attr('href');
            if (src) {
                result.documents.push({
                    url: src.startsWith('http') ? src : `https://civilwardc.org${src}`,
                    type: 'petition_scan',
                    isPrimary: true
                });
            }
        });

        result.metadata = {
            pageType: 'civilwardc_petition',
            petitionerName,
            enslavedCount: result.enslavedPeople.length,
            isPrimarySource: true
        };
    }

    /**
     * ========================================
     * ROOTSWEB CENSUS SCRAPER
     * ========================================
     * Scrapes Tom Blake's "Large Slaveholders of 1860" census data
     * Source: https://freepages.rootsweb.com/~ajac/genealogy/
     * Data: CONFIRMED slaveholders from 1860 Census (PRIMARY SOURCE!)
     *
     * This is census data - the gold standard for confirming slave ownership.
     * Format: "NAME, # slaves, Location, page #"
     */
    async scrapeRootswebCensus(url, result, options) {
        console.log('\n📊 Scraping Rootsweb Census Data (1860 Large Slaveholders)...');

        const html = await this.fetchHTML(url);
        const $ = cheerio.load(html);
        result.rawText = $('body').text();

        // Determine if this is the main index or a county page
        const isMainIndex = url.includes('genealogy/') && !url.match(/\.htm$/i);
        const isCountyPage = url.match(/\w+\.htm$/i);

        if (isMainIndex) {
            // Main index page - extract all county/state links for queue
            console.log('   📋 Processing main index page - extracting county links...');

            const countyLinks = [];
            $('a[href$=".htm"]').each((i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().trim();
                if (href && !href.includes('ancestry') && !href.includes('http')) {
                    const fullUrl = `https://freepages.rootsweb.com/~ajac/genealogy/${href}`;
                    countyLinks.push({
                        url: fullUrl,
                        text: text,
                        state: this.extractStateFromHref(href)
                    });
                }
            });

            result.metadata = {
                pageType: 'rootsweb_index',
                countyLinksFound: countyLinks.length,
                countyLinks: countyLinks,
                isPrimarySource: true,
                sourceYear: 1860
            };

            // Queue all county pages for processing
            if (this.db && countyLinks.length > 0) {
                console.log(`   📝 Queueing ${countyLinks.length} county pages for processing...`);
                for (const link of countyLinks) {
                    try {
                        await this.db.query(`
                            INSERT INTO scraping_queue (url, category, status, priority, metadata)
                            VALUES ($1, 'rootsweb_census', 'pending', 10, $2::jsonb)
                            ON CONFLICT (url) DO NOTHING
                        `, [link.url, JSON.stringify({ state: link.state, countyName: link.text })]);
                    } catch (err) {
                        // Ignore duplicates
                    }
                }
            }

        } else if (isCountyPage) {
            // County page - extract slaveholder data
            console.log('   📊 Processing county page - extracting slaveholder data...');

            // Extract county and state from title
            const title = $('title').text() || '';
            const h1 = $('p:contains("COUNTY")').first().text() || $('strong:contains("COUNTY")').first().text() || '';

            let county = '';
            let state = '';

            // Parse title like "Dallas County Alabama 1860 slaveholders..."
            const titleMatch = title.match(/(\w+)\s+County[,]?\s+(\w+)/i) ||
                               h1.match(/(\w+)\s+COUNTY,?\s+(\w+)/i);
            if (titleMatch) {
                county = titleMatch[1];
                state = titleMatch[2];
            }

            // Extract slaveholder entries
            // Format: "NAME, # slaves, Location, page #"
            const bodyText = $('body').html() || '';

            // Pattern for slaveholder entries in the HTML
            // They appear as: <P><FONT FACE="Times New Roman">ADAMS, John, 98 slaves, Athens, page 19</FONT></P>
            const slaveholderPattern = /([A-Z][A-Z]+(?:,?\s+(?:Est\.?|Dr\.?|Mrs\.?|Agt\.?)?)?),?\s+([A-Za-z][A-Za-z\s\.&]+),?\s+(\d+)\s+slaves?,\s+([^,]+),\s+page\s+(\d+[AB]?)/g;

            let match;
            const slaveholders = [];

            while ((match = slaveholderPattern.exec(bodyText)) !== null) {
                const lastName = match[1].trim();
                const firstNamePart = match[2].trim();
                const slaveCount = parseInt(match[3]);
                const location = match[4].trim();
                const pageRef = match[5].trim();

                // Construct full name
                let fullName = `${firstNamePart} ${lastName}`.replace(/\s+/g, ' ').trim();
                // Handle "Est." entries (estates)
                if (lastName.includes('Est') || firstNamePart.includes('Est')) {
                    fullName = fullName.replace(/Est\.?/g, '').trim() + ' (Estate)';
                }

                const slaveholder = {
                    fullName: fullName,
                    lastName: lastName.replace(/,.*/, '').trim(),
                    slaveCount: slaveCount,
                    location: location,
                    censusPage: pageRef,
                    county: county,
                    state: state,
                    year: 1860
                };

                slaveholders.push(slaveholder);

                // Add to result.owners as CONFIRMED (this is census data!)
                result.owners.push({
                    fullName: fullName,
                    type: 'confirmed_owner',
                    source: 'rootsweb_census_1860',
                    sourceUrl: url,
                    confidence: 0.98, // Census data = very high confidence
                    birthYear: null,
                    deathYear: null,
                    locations: [`${location}, ${county} County, ${state}`],
                    notes: `1860 Census: Held ${slaveCount} enslaved people. Census page ${pageRef}.`,
                    slaveCount: slaveCount,
                    censusReference: `1860 Slave Schedule, ${county} County, ${state}, page ${pageRef}`
                });
            }

            // Also extract surname match data (African Americans in 1870 census)
            // Format: "SURNAME, # in US, in State, in County, born in State, born and living in State, born in State and living in County"
            const surnameSection = bodyText.includes('SURNAME MATCHES') || bodyText.includes('1870 CENSUS');

            if (surnameSection) {
                const surnamePattern = /([A-Z]+),\s+(\d+),\s+(\d+),\s+(\d+),\s+(\d+),\s+(\d+),\s+(\d+)/g;

                while ((match = surnamePattern.exec(bodyText)) !== null) {
                    const surname = match[1];
                    const inUS = parseInt(match[2]);
                    const inState = parseInt(match[3]);
                    const inCounty = parseInt(match[4]);

                    // This suggests enslaved people who took slaveholder surnames
                    if (inCounty > 0) {
                        result.enslavedPeople.push({
                            fullName: `${surname} (Surname Group - ${inCounty} in county)`,
                            type: 'suspected_enslaved',
                            source: 'rootsweb_census_1870_surname',
                            sourceUrl: url,
                            confidence: 0.7, // Surname matching is suggestive but not definitive
                            location: `${county} County, ${state}`,
                            notes: `1870 Census surname match: ${inCounty} African Americans in county, ${inState} in state, ${inUS} nationwide with surname ${surname}. May indicate former enslaved people who took slaveholder's surname.`,
                            surnameData: {
                                surname,
                                inUS,
                                inState,
                                inCounty,
                                bornInState: parseInt(match[5]),
                                bornAndLivingInState: parseInt(match[6]),
                                bornInStateAndLivingInCounty: parseInt(match[7])
                            }
                        });
                    }
                }
            }

            console.log(`   ✅ Extracted ${slaveholders.length} confirmed slaveholders from ${county} County, ${state}`);

            result.metadata = {
                pageType: 'rootsweb_county',
                county: county,
                state: state,
                slaveholderCount: slaveholders.length,
                totalEnslaved: slaveholders.reduce((sum, s) => sum + s.slaveCount, 0),
                isPrimarySource: true,
                sourceYear: 1860,
                censusType: '1860 Slave Schedule'
            };
        }
    }

    /**
     * Helper to extract state abbreviation from href
     */
    extractStateFromHref(href) {
        const stateMap = {
            'al': 'Alabama', 'ar': 'Arkansas', 'fl': 'Florida', 'ga': 'Georgia',
            'la': 'Louisiana', 'md': 'Maryland', 'ms': 'Mississippi', 'nc': 'North Carolina',
            'sc': 'South Carolina', 'tn': 'Tennessee', 'tx': 'Texas', 'va': 'Virginia'
        };
        const prefix = href.substring(0, 2).toLowerCase();
        return stateMap[prefix] || 'Unknown';
    }

    /**
     * ========================================
     * WIKIPEDIA SCRAPER
     * ========================================
     * Scrapes Wikipedia articles about slaveholders
     * Data: Suspected owners (tertiary source)
     */
    async scrapeWikipedia(url, result, options) {
        console.log('\n📚 Scraping Wikipedia...');

        const html = await this.fetchHTML(url);
        const $ = cheerio.load(html);

        // Remove unwanted elements
        $('script, style, nav, footer, .mw-editsection, .reference').remove();
        result.rawText = $('#mw-content-text').text();

        // Get article title (person's name)
        const title = $('h1#firstHeading').text().trim();

        // Check if this is about a slaveholder
        const isSlaveRelated = result.rawText.toLowerCase().includes('slave') ||
                               result.rawText.toLowerCase().includes('enslaved') ||
                               result.rawText.toLowerCase().includes('plantation');

        if (title && isSlaveRelated) {
            // Extract birth/death years from infobox
            const bornText = $('.infobox th:contains("Born")').next().text();
            const diedText = $('.infobox th:contains("Died")').next().text();

            const birthYear = this.extractYear(bornText);
            const deathYear = this.extractYear(diedText);

            result.owners.push({
                fullName: title,
                type: 'suspected_owner',
                source: 'wikipedia',
                sourceUrl: url,
                confidence: 0.5, // Tertiary source - needs verification
                birthYear,
                deathYear,
                locations: this.extractLocations(result.rawText),
                notes: 'Extracted from Wikipedia - requires primary source verification'
            });

            // Try to extract enslaved people mentioned
            const enslavedMentions = result.rawText.match(
                /enslaved\s+(?:people|persons?|workers?|man|woman|men|women)\s*(?:named|including|such as)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)*)/gi
            );

            if (enslavedMentions) {
                enslavedMentions.forEach(mention => {
                    this.extractNamesFromText(mention).forEach(name => {
                        if (name !== title && !result.enslavedPeople.find(e => e.fullName === name)) {
                            result.enslavedPeople.push({
                                fullName: name,
                                type: 'suspected_enslaved',
                                source: 'wikipedia',
                                sourceUrl: url,
                                confidence: 0.4,
                                slaveholder: title,
                                notes: 'Mentioned in Wikipedia - requires verification'
                            });
                        }
                    });
                });
            }
        }

        result.metadata = {
            pageType: 'wikipedia_article',
            title,
            isSlaveRelated
        };
    }

    /**
     * ========================================
     * FIND A GRAVE SCRAPER
     * ========================================
     */
    async scrapeFindAGrave(url, result, options) {
        console.log('\n🪦 Scraping FindAGrave...');

        const html = await this.fetchHTML(url);
        const $ = cheerio.load(html);
        result.rawText = $('body').text();

        // Extract person info
        const name = $('h1[itemprop="name"]').text().trim() ||
                     $('#bio-name').text().trim();

        const birthDate = $('[itemprop="birthDate"]').attr('content');
        const deathDate = $('[itemprop="deathDate"]').attr('content');
        const birthPlace = $('[itemprop="birthPlace"]').text().trim();

        if (name) {
            // Check bio for slavery-related keywords
            const bio = $('#bio').text() || '';
            const isSlaveRelated = bio.toLowerCase().includes('slave') ||
                                   bio.toLowerCase().includes('enslaved') ||
                                   bio.toLowerCase().includes('plantation');

            if (isSlaveRelated) {
                result.owners.push({
                    fullName: name,
                    type: 'suspected_owner',
                    source: 'findagrave',
                    sourceUrl: url,
                    confidence: 0.5,
                    birthYear: birthDate ? new Date(birthDate).getFullYear() : null,
                    deathYear: deathDate ? new Date(deathDate).getFullYear() : null,
                    locations: birthPlace ? [birthPlace] : [],
                    notes: 'From FindAGrave memorial - requires verification'
                });
            }
        }

        result.metadata = {
            pageType: 'findagrave_memorial',
            name
        };
    }

    /**
     * ========================================
     * FAMILYSEARCH SCRAPER
     * ========================================
     */
    async scrapeFamilySearch(url, result, options) {
        console.log('\n🌳 Scraping FamilySearch...');

        // FamilySearch often requires JavaScript
        const html = await this.fetchHTMLWithBrowser(url);
        const $ = cheerio.load(html);
        result.rawText = $('body').text();

        // Extract person details
        const name = $('[data-testid="name"]').text().trim() ||
                     $('.personName').text().trim();

        if (name) {
            result.owners.push({
                fullName: name,
                type: 'suspected_owner', // Secondary source
                source: 'familysearch',
                sourceUrl: url,
                confidence: 0.6,
                notes: 'From FamilySearch - check attached records for confirmation'
            });
        }

        // Look for attached records (could be primary sources)
        $('a[href*="ark:/"]').each((i, el) => {
            result.documents.push({
                url: $(el).attr('href'),
                type: 'attached_record',
                text: $(el).text().trim()
            });
        });

        result.metadata = {
            pageType: 'familysearch_person',
            name
        };
    }

    /**
     * ========================================
     * ARCHIVE.ORG SCRAPER
     * ========================================
     */
    async scrapeArchive(url, result, options) {
        console.log('\n📁 Scraping Archive.org...');

        const html = await this.fetchHTML(url);
        const $ = cheerio.load(html);
        result.rawText = $('body').text();

        // Archive.org can contain primary sources
        const title = $('.item-title, h1').first().text().trim();

        // Check if it's a slavery-related document
        const isSlaveRelated = result.rawText.toLowerCase().includes('slave') ||
                               result.rawText.toLowerCase().includes('enslaved');

        if (isSlaveRelated) {
            // Extract names from document
            this.extractNamesFromText(result.rawText).forEach(name => {
                // Try to classify as owner or enslaved based on context
                const context = this.getContextAroundName(result.rawText, name);
                const isEnslaved = context.toLowerCase().includes('enslaved') ||
                                   context.toLowerCase().includes('slave named');

                if (isEnslaved) {
                    result.enslavedPeople.push({
                        fullName: name,
                        type: 'suspected_enslaved',
                        source: 'archive',
                        sourceUrl: url,
                        confidence: 0.7, // Archive can have primary sources
                        notes: `From archive document: ${title}`
                    });
                } else if (context.toLowerCase().includes('owner') ||
                           context.toLowerCase().includes('estate')) {
                    result.owners.push({
                        fullName: name,
                        type: 'suspected_owner',
                        source: 'archive',
                        sourceUrl: url,
                        confidence: 0.7,
                        notes: `From archive document: ${title}`
                    });
                }
            });
        }

        // Get downloadable documents
        $('a[href*="download"]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && (href.includes('.pdf') || href.includes('.jpg'))) {
                result.documents.push({
                    url: href.startsWith('http') ? href : `https://archive.org${href}`,
                    type: 'archive_document'
                });
            }
        });

        result.metadata = {
            pageType: 'archive_document',
            title,
            isSlaveRelated
        };
    }

    /**
     * ========================================
     * GENERIC SCRAPER
     * ========================================
     */
    async scrapeGeneric(url, result, options) {
        console.log('\n🌐 Scraping generic page...');

        const html = await this.fetchHTML(url);
        const $ = cheerio.load(html);

        // Remove navigation, scripts, etc
        $('script, style, nav, footer, aside').remove();
        result.rawText = $('body').text();

        // Look for slavery-related content
        const isSlaveRelated = result.rawText.toLowerCase().includes('slave') ||
                               result.rawText.toLowerCase().includes('enslaved');

        if (isSlaveRelated) {
            // Extract all potential names
            const names = this.extractNamesFromText(result.rawText);

            names.forEach(name => {
                const context = this.getContextAroundName(result.rawText, name);

                // Classify based on context
                if (context.toLowerCase().includes('enslaved') ||
                    context.toLowerCase().includes('slave named') ||
                    context.toLowerCase().includes('servant')) {
                    result.enslavedPeople.push({
                        fullName: name,
                        type: 'suspected_enslaved',
                        source: 'generic',
                        sourceUrl: url,
                        confidence: 0.4,
                        notes: 'Generic extraction - needs verification'
                    });
                } else if (context.toLowerCase().includes('owner') ||
                           context.toLowerCase().includes('estate') ||
                           context.toLowerCase().includes('plantation')) {
                    result.owners.push({
                        fullName: name,
                        type: 'suspected_owner',
                        source: 'generic',
                        sourceUrl: url,
                        confidence: 0.4,
                        notes: 'Generic extraction - needs verification'
                    });
                }
            });
        }

        result.metadata = {
            pageType: 'generic',
            isSlaveRelated
        };
    }

    /**
     * ========================================
     * HELPER METHODS
     * ========================================
     */

    async fetchHTML(url) {
        const response = await axios.get(url, {
            timeout: this.config.timeout,
            headers: { 'User-Agent': this.config.userAgent }
        });
        return response.data;
    }

    async fetchHTMLWithBrowser(url) {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }
        const page = await this.browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: this.config.timeout });
        const html = await page.content();
        await page.close();
        return html;
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    extractNamesFromText(text) {
        const names = [];
        // Pattern for capitalized names
        const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
        let match;

        while ((match = pattern.exec(text)) !== null) {
            const name = match[1];
            // Filter out common false positives
            if (!this.isCommonWord(name) && name.length > 3) {
                names.push(name);
            }
        }

        return [...new Set(names)]; // Deduplicate
    }

    isCommonWord(word) {
        const commonWords = [
            'The', 'This', 'That', 'These', 'Those', 'January', 'February', 'March',
            'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November',
            'December', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
            'Saturday', 'Sunday', 'County', 'State', 'City', 'United', 'States',
            'American', 'Civil', 'War', 'Act', 'Congress'
        ];
        return commonWords.includes(word);
    }

    extractLocations(text) {
        const locations = [];
        // US State patterns
        const statePattern = /(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)/gi;

        let match;
        while ((match = statePattern.exec(text)) !== null) {
            if (!locations.includes(match[0])) {
                locations.push(match[0]);
            }
        }

        return locations;
    }

    extractYear(text) {
        if (!text) return null;
        const match = text.match(/\b(1[789]\d{2})\b/);
        return match ? parseInt(match[1]) : null;
    }

    getContextAroundName(text, name) {
        const index = text.indexOf(name);
        if (index === -1) return '';
        const start = Math.max(0, index - 100);
        const end = Math.min(text.length, index + name.length + 100);
        return text.substring(start, end);
    }

    /**
     * ========================================
     * DATABASE METHODS
     * ========================================
     */

    async saveResults(result, options) {
        console.log('\n💾 Saving results to database...');

        try {
            // For confirmed owners from primary sources (census data), save directly to individuals table
            for (const owner of result.owners) {
                const isConfirmed = owner.type === 'confirmed_owner' && owner.confidence >= 0.9;

                if (isConfirmed) {
                    // Save directly to individuals table (confirmed slaveholder)
                    try {
                        const insertResult = await this.db.query(`
                            INSERT INTO individuals (
                                full_name, birth_year, death_year, locations,
                                source_documents, notes, created_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                            ON CONFLICT DO NOTHING
                            RETURNING individual_id
                        `, [
                            owner.fullName,
                            owner.birthYear || null,
                            owner.deathYear || null,
                            owner.locations || [],
                            JSON.stringify([{ url: owner.sourceUrl, type: owner.source, isPrimary: true }]),
                            owner.notes
                        ]);

                        if (insertResult.rows.length > 0) {
                            const individualId = insertResult.rows[0].individual_id;

                            // Also record in slaveholder_records if we have slave count
                            if (owner.slaveCount) {
                                await this.db.query(`
                                    INSERT INTO slaveholder_records (
                                        individual_id, census_year, state, county,
                                        total_enslaved, source_reference, created_at
                                    ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                                    ON CONFLICT DO NOTHING
                                `, [
                                    individualId,
                                    1860,
                                    owner.locations?.[0]?.split(',').pop()?.trim() || null,
                                    owner.locations?.[0]?.split(',')[1]?.replace('County', '').trim() || null,
                                    owner.slaveCount,
                                    owner.censusReference || owner.sourceUrl
                                ]).catch(() => {}); // Table might not exist yet
                            }

                            console.log(`   ✅ CONFIRMED owner saved to individuals: ${owner.fullName} (${owner.slaveCount || 'unknown'} enslaved)`);
                        }
                    } catch (err) {
                        // If individuals insert fails, fall back to unconfirmed_persons
                        console.log(`   ⚠️ Falling back to unconfirmed_persons for ${owner.fullName}: ${err.message}`);
                    }
                }

                // Always also save to unconfirmed_persons for tracking
                await this.db.query(`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, birth_year, death_year,
                        locations, source_url, source_type, confidence_score,
                        context_text, status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    ON CONFLICT DO NOTHING
                `, [
                    owner.fullName,
                    owner.type.includes('confirmed') ? 'owner' : 'suspected_owner',
                    owner.birthYear || null,
                    owner.deathYear || null,
                    owner.locations || [],
                    owner.sourceUrl,
                    owner.source,
                    owner.confidence,
                    owner.notes,
                    owner.confidence >= 0.9 ? 'confirmed' :
                    owner.confidence >= 0.7 ? 'reviewing' : 'pending'
                ]);
                console.log(`   ✓ Saved owner: ${owner.fullName} (${owner.type})`);
            }

            // Save enslaved people
            for (const enslaved of result.enslavedPeople) {
                await this.db.query(`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, birth_year, death_year,
                        locations, source_url, source_type, confidence_score,
                        context_text, relationships, status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT DO NOTHING
                `, [
                    enslaved.fullName,
                    enslaved.type.includes('confirmed') ? 'enslaved' : 'suspected_enslaved',
                    enslaved.birthYear || null,
                    enslaved.deathYear || null,
                    enslaved.location ? [enslaved.location] : [],
                    enslaved.sourceUrl,
                    enslaved.source,
                    enslaved.confidence,
                    enslaved.notes,
                    JSON.stringify([{ type: 'enslaved_by', name: enslaved.slaveholder }]),
                    enslaved.confidence >= 0.9 ? 'confirmed' :
                    enslaved.confidence >= 0.7 ? 'reviewing' : 'pending'
                ]);
                console.log(`   ✓ Saved enslaved: ${enslaved.fullName} (${enslaved.type})`);
            }

            // If category is beyondkin, also add to beyond_kin_review
            if (result.category === 'beyondkin' && result.owners.length > 0) {
                const owner = result.owners[0];
                await this.db.query(`
                    INSERT INTO beyond_kin_review (
                        source_url, slaveholder_name, enslaved_count,
                        status, created_at
                    ) VALUES ($1, $2, $3, 'pending', CURRENT_TIMESTAMP)
                    ON CONFLICT DO NOTHING
                `, [
                    result.url,
                    owner.fullName,
                    result.enslavedPeople.length
                ]).catch(() => {}); // Table might not exist
            }

            console.log(`   ✅ Saved ${result.owners.length} owners, ${result.enslavedPeople.length} enslaved`);

        } catch (error) {
            console.error(`   ❌ Database error: ${error.message}`);
            result.errors.push({ stage: 'database', error: error.message });
        }
    }
}

module.exports = UnifiedScraper;
