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
                case 'ucl_lbs':
                    await this.scrapeUCLLBS(url, result, options);
                    break;
                case 'la_slave_database':
                    await this.scrapeLouisianaSlaveDB(url, result, options);
                    break;
                case 'underwriting_souls':
                    await this.scrapeUnderwritingSouls(url, result, options);
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
        if (lower.includes('ucl.ac.uk/lbs')) return 'ucl_lbs';
        if (lower.includes('ibiblio.org/laslave')) return 'la_slave_database';
        if (lower.includes('underwritingsouls.org')) return 'underwriting_souls';
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
     * ========================================
     * UCL LEGACIES OF BRITISH SLAVERY SCRAPER
     * ========================================
     * Scrapes the UCL Legacies of British Slavery database
     * Source: https://www.ucl.ac.uk/lbs/
     * Data: CONFIRMED compensation claims, British slave owners, estates
     *
     * URL Patterns:
     * - /lbs/claim/[claim_id] - Compensation claims
     * - /lbs/person/[person_id] - Person profiles
     * - /lbs/estate/[estate_id] - Estate pages
     * - /lbs/legacy/[legacy_id] - Legacy pages
     *
     * This is PRIMARY SOURCE data from the Slave Compensation Commission records.
     */
    async scrapeUCLLBS(url, result, options) {
        console.log('\n📜 Scraping UCL Legacies of British Slavery...');

        // Determine page type from URL
        const urlLower = url.toLowerCase();
        let pageType = 'unknown';
        let entityId = null;

        // URL patterns: /lbs/claim/view/123 or /lbs/claim/123
        if (urlLower.includes('/lbs/claim/')) {
            pageType = 'claim';
            // Match the numeric ID at the end of the URL
            entityId = url.match(/\/claim\/(?:view\/)?(\d+)/)?.[1] || url.match(/\/claim\/([^\/\?]+)/)?.[1];
        } else if (urlLower.includes('/lbs/person/')) {
            pageType = 'person';
            entityId = url.match(/\/person\/(?:view\/)?(\d+)/)?.[1] || url.match(/\/person\/([^\/\?]+)/)?.[1];
        } else if (urlLower.includes('/lbs/estate/')) {
            pageType = 'estate';
            entityId = url.match(/\/estate\/(?:view\/)?(\d+)/)?.[1] || url.match(/\/estate\/([^\/\?]+)/)?.[1];
        } else if (urlLower.includes('/lbs/legacy/')) {
            pageType = 'legacy';
            entityId = url.match(/\/legacy\/(?:view\/)?(\d+)/)?.[1] || url.match(/\/legacy\/([^\/\?]+)/)?.[1];
        } else if (urlLower.includes('/lbs/search') || urlLower.includes('/lbs/')) {
            pageType = 'search';
        }

        console.log(`   Page type: ${pageType}, Entity ID: ${entityId || 'N/A'}`);

        // UCL LBS requires JavaScript, use Puppeteer
        const html = await this.fetchHTMLWithBrowser(url);
        const $ = cheerio.load(html);
        result.rawText = $('body').text();

        switch (pageType) {
            case 'claim':
                await this.extractLBSClaim($, url, result, entityId);
                break;
            case 'person':
                await this.extractLBSPerson($, url, result, entityId);
                break;
            case 'estate':
                await this.extractLBSEstate($, url, result, entityId);
                break;
            case 'legacy':
                await this.extractLBSLegacy($, url, result, entityId);
                break;
            case 'search':
                await this.extractLBSSearchResults($, url, result);
                break;
            default:
                console.log('   Unknown UCL LBS page type, attempting generic extraction...');
                await this.extractLBSGeneric($, url, result);
        }

        result.metadata.pageType = `ucl_lbs_${pageType}`;
        result.metadata.entityId = entityId;
        result.metadata.isPrimarySource = true;
        result.metadata.sourceYear = 1834;
    }

    /**
     * Extract compensation claim from UCL LBS
     *
     * UCL LBS page structure (discovered by inspection):
     * - H1: "Colony ClaimNumber" (e.g., "Antigua 585")
     * - Summary line: "Date | X Enslaved | £X Xs Xd"
     * - Colony field in claim details
     * - Associated Individuals section with claimant names as links
     */
    async extractLBSClaim($, url, result, claimId) {
        console.log('   Extracting compensation claim data...');

        const bodyText = $('body').text();

        // Parse H1: "Antigua 585" -> colony + claim number
        const h1Text = $('h1').first().text().trim();
        let colony = '';
        let claimNumber = '';

        if (h1Text) {
            const h1Match = h1Text.match(/^(.+?)\s+(\d+)$/);
            if (h1Match) {
                colony = h1Match[1].trim();
                claimNumber = h1Match[2];
            } else {
                claimNumber = h1Text;
            }
        }

        // Parse summary line: "2nd Nov 1835 | 1 Enslaved | £16 19s 11d"
        const summaryMatch = bodyText.match(/(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})\s*\|\s*(\d+)\s*Enslaved\s*\|\s*(£[\d,]+(?:\s+\d+s)?(?:\s+\d+d)?)/i);
        let awardDate = '';
        let enslavedCount = 0;
        let awardedAmount = '';
        let awardedPounds = 0;

        if (summaryMatch) {
            awardDate = summaryMatch[1];
            enslavedCount = parseInt(summaryMatch[2]) || 0;
            awardedAmount = summaryMatch[3];
            const poundsMatch = awardedAmount.match(/£([\d,]+)/);
            awardedPounds = poundsMatch ? parseInt(poundsMatch[1].replace(/,/g, '')) : 0;
        }

        // Get colony from claim details if not from H1
        if (!colony) {
            const colonyMatch = bodyText.match(/Colony\s*\n\s*([A-Za-z\s]+?)(?:\n|Claim)/);
            if (colonyMatch) colony = colonyMatch[1].trim();
        }

        // Extract Associated Individuals - these are the CLAIMANTS (slave owners)
        const claimants = [];
        const seenNames = new Set();

        // Find person links - these are the actual claimant names
        $('a[href*="/person/"]').each((i, el) => {
            const href = $(el).attr('href') || '';
            const name = $(el).text().trim();

            // Only process actual person view links, skip navigation
            if (href.includes('/person/view/') && name.length > 2) {
                // Skip common non-name text
                if (name.includes('Visit') || name.includes('section') ||
                    name.includes('Project') || name.includes('overview')) return;

                if (seenNames.has(name)) return;
                seenNames.add(name);

                // Determine role from surrounding text
                const parent = $(el).parent();
                const parentText = parent.text();
                let role = 'claimant';
                if (parentText.includes('1st claimant')) role = '1st claimant';
                else if (parentText.includes('2nd claimant')) role = '2nd claimant';
                else if (parentText.includes('awardee')) role = 'awardee';

                claimants.push({ name, role, personUrl: href });
            }
        });

        console.log(`   Found ${claimants.length} claimants: ${claimants.map(c => c.name).join(', ') || 'none'}`);

        // Add each claimant as a confirmed owner
        for (const claimant of claimants) {
            result.owners.push({
                fullName: claimant.name,
                type: 'confirmed_owner',
                source: 'ucl_lbs',
                sourceUrl: url,
                confidence: 0.98,
                locations: [colony].filter(Boolean),
                notes: `UCL LBS Claim ${colony} ${claimNumber}. Role: ${claimant.role}. ${enslavedCount} enslaved. Amount: ${awardedAmount}`,
                lbsClaimId: claimNumber,
                lbsPersonUrl: claimant.personUrl,
                compensationReceived: awardedPounds,
                enslavedCount: enslavedCount,
                claimantRole: claimant.role,
                awardDate: awardDate
            });

            result.relationships.push({
                type: 'compensation_claim',
                owner: claimant.name,
                enslaved: `${enslavedCount} enslaved people`,
                source: 'ucl_lbs',
                confidence: 0.98,
                confirmed: true,
                colony: colony,
                claimId: claimNumber
            });
        }

        // Queue linked estate pages
        $('a[href*="/estate/view/"]').each((i, el) => {
            const estateUrl = $(el).attr('href');
            const fullUrl = estateUrl.startsWith('http') ? estateUrl : `https://www.ucl.ac.uk${estateUrl}`;
            result.documents.push({
                url: fullUrl,
                type: 'linked_estate',
                name: $(el).text().trim()
            });
        });

        result.metadata = {
            ...result.metadata,
            h1: h1Text,
            colony,
            claimNumber,
            awardDate,
            enslavedCount,
            awardedAmount,
            awardedPounds,
            claimantsFound: claimants.length,
            claimantNames: claimants.map(c => c.name)
        };
    }

    /**
     * Extract person profile from UCL LBS
     */
    async extractLBSPerson($, url, result, personId) {
        console.log('   Extracting person profile...');

        const fullName = $('h1, .person-name, [class*="name"]').first().text().trim();
        const title = this.extractLBSField($, ['Title', 'Honorific']);
        const gender = this.extractLBSField($, ['Gender', 'Sex']);
        const birthYear = parseInt(this.extractLBSField($, ['Born', 'Birth']) || '0') || null;
        const deathYear = parseInt(this.extractLBSField($, ['Died', 'Death']) || '0') || null;
        const occupation = this.extractLBSField($, ['Occupation', 'Trade', 'Profession']);
        const residence = this.extractLBSField($, ['Residence', 'Address', 'Location']);
        const mpInfo = this.extractLBSField($, ['MP', 'Parliament', 'Constituency']);

        // Get total compensation
        const totalCompensation = this.parseBritishPounds(
            this.extractLBSField($, ['Total compensation', 'Compensation received', 'Total awarded'])
        );
        const totalEnslaved = parseInt(this.extractLBSField($, ['Total enslaved', 'Enslaved owned']) || '0');

        if (fullName) {
            result.owners.push({
                fullName: fullName,
                title: title,
                type: 'confirmed_owner',
                source: 'ucl_lbs',
                sourceUrl: url,
                confidence: 0.98,
                birthYear: birthYear,
                deathYear: deathYear,
                occupation: occupation,
                locations: residence ? [residence] : [],
                memberOfParliament: !!mpInfo,
                parliamentInfo: mpInfo,
                notes: `UCL LBS Person ID: ${personId}. ${totalEnslaved ? `Held ${totalEnslaved} enslaved people.` : ''} ${totalCompensation ? `Total compensation: £${totalCompensation.toLocaleString()}` : ''}`,
                lbsPersonId: personId,
                totalCompensationReceived: totalCompensation,
                totalEnslavedOwned: totalEnslaved,
                gender: gender
            });
        }

        // Extract all claims associated with this person
        $('a[href*="/claim/"]').each((i, el) => {
            const claimUrl = $(el).attr('href');
            result.documents.push({
                url: claimUrl.startsWith('http') ? claimUrl : `https://www.ucl.ac.uk${claimUrl}`,
                type: 'associated_claim',
                text: $(el).text().trim()
            });
        });

        // Extract estates
        $('a[href*="/estate/"]').each((i, el) => {
            result.documents.push({
                url: $(el).attr('href').startsWith('http') ? $(el).attr('href') : `https://www.ucl.ac.uk${$(el).attr('href')}`,
                type: 'owned_estate',
                name: $(el).text().trim()
            });
        });

        result.metadata = {
            ...result.metadata,
            fullName,
            title,
            gender,
            birthYear,
            deathYear,
            occupation,
            residence,
            mpInfo,
            totalCompensation,
            totalEnslaved
        };
    }

    /**
     * Extract estate data from UCL LBS
     */
    async extractLBSEstate($, url, result, estateId) {
        console.log('   Extracting estate data...');

        const estateName = $('h1, .estate-name, [class*="estate"]').first().text().trim();
        const colony = this.extractLBSField($, ['Colony', 'Island']);
        const parish = this.extractLBSField($, ['Parish', 'District']);
        const estateType = this.extractLBSField($, ['Type', 'Crop', 'Production']);
        const enslaved1817 = parseInt(this.extractLBSField($, ['1817', 'enslaved 1817']) || '0');
        const enslaved1832 = parseInt(this.extractLBSField($, ['1832', 'enslaved 1832', 'at abolition']) || '0');

        // Get compensation info for the estate
        const compensationAmount = this.parseBritishPounds(
            this.extractLBSField($, ['Compensation', 'Award', 'Awarded'])
        );

        if (estateName) {
            // Store estate-related info
            result.metadata = {
                ...result.metadata,
                estateName,
                colony,
                parish,
                estateType,
                enslaved1817,
                enslaved1832,
                compensationAmount,
                lbsEstateId: estateId
            };
        }

        // Extract owners/claimants linked to estate
        $('a[href*="/person/"]').each((i, el) => {
            const ownerName = $(el).text().trim();
            const ownerUrl = $(el).attr('href');

            if (ownerName && ownerName.length > 2) {
                result.owners.push({
                    fullName: ownerName,
                    type: 'confirmed_owner',
                    source: 'ucl_lbs_estate',
                    sourceUrl: url,
                    confidence: 0.95,
                    locations: [colony, parish, estateName].filter(Boolean),
                    notes: `Owner/claimant for estate: ${estateName}. Colony: ${colony}.`,
                    linkedEstates: [estateName],
                    lbsPersonUrl: ownerUrl
                });
            }
        });

        // Record enslaved count (we don't have individual names from estates)
        if (enslaved1832 > 0 || enslaved1817 > 0) {
            result.enslavedPeople.push({
                fullName: `${enslaved1832 || enslaved1817} enslaved people at ${estateName}`,
                type: 'confirmed_enslaved',
                source: 'ucl_lbs_estate',
                sourceUrl: url,
                confidence: 0.95,
                location: `${estateName}, ${parish || ''}, ${colony || ''}`,
                notes: `Estate: ${estateName}. Enslaved count 1817: ${enslaved1817}, 1832: ${enslaved1832}.`,
                isAggregate: true,
                count: enslaved1832 || enslaved1817
            });
        }
    }

    /**
     * Extract legacy data from UCL LBS
     */
    async extractLBSLegacy($, url, result, legacyId) {
        console.log('   Extracting legacy data...');

        const legacyName = $('h1, .legacy-name').first().text().trim();
        const legacyType = this.extractLBSField($, ['Type', 'Category']);
        const institutionName = this.extractLBSField($, ['Institution', 'Organisation', 'Organization']);
        const description = this.extractLBSField($, ['Description', 'Details', 'Summary']);

        // Find associated persons
        $('a[href*="/person/"]').each((i, el) => {
            const personName = $(el).text().trim();
            const personUrl = $(el).attr('href');

            if (personName) {
                result.owners.push({
                    fullName: personName,
                    type: 'confirmed_owner',
                    source: 'ucl_lbs_legacy',
                    sourceUrl: url,
                    confidence: 0.90,
                    notes: `Associated with legacy: ${legacyName || institutionName}. ${description || ''}`,
                    lbsPersonUrl: personUrl
                });
            }
        });

        result.metadata = {
            ...result.metadata,
            legacyName,
            legacyType,
            institutionName,
            description,
            lbsLegacyId: legacyId
        };
    }

    /**
     * Extract search results from UCL LBS (for batch processing)
     */
    async extractLBSSearchResults($, url, result) {
        console.log('   Extracting search results...');

        // Queue all found claims/persons/estates for individual processing
        const linksToQueue = [];

        $('a[href*="/lbs/claim/"]').each((i, el) => {
            const claimUrl = $(el).attr('href');
            const fullUrl = claimUrl.startsWith('http') ? claimUrl : `https://www.ucl.ac.uk${claimUrl}`;
            if (!linksToQueue.includes(fullUrl)) {
                linksToQueue.push({ url: fullUrl, type: 'claim' });
            }
        });

        $('a[href*="/lbs/person/"]').each((i, el) => {
            const personUrl = $(el).attr('href');
            const fullUrl = personUrl.startsWith('http') ? personUrl : `https://www.ucl.ac.uk${personUrl}`;
            if (!linksToQueue.includes(fullUrl)) {
                linksToQueue.push({ url: fullUrl, type: 'person' });
            }
        });

        $('a[href*="/lbs/estate/"]').each((i, el) => {
            const estateUrl = $(el).attr('href');
            const fullUrl = estateUrl.startsWith('http') ? estateUrl : `https://www.ucl.ac.uk${estateUrl}`;
            if (!linksToQueue.includes(fullUrl)) {
                linksToQueue.push({ url: fullUrl, type: 'estate' });
            }
        });

        // Queue all found links
        if (this.db && linksToQueue.length > 0) {
            console.log(`   📝 Queueing ${linksToQueue.length} UCL LBS pages for processing...`);
            for (const link of linksToQueue) {
                try {
                    await this.db.query(`
                        INSERT INTO scraping_queue (url, category, status, priority, metadata)
                        VALUES ($1, 'ucl_lbs', 'pending', 15, $2::jsonb)
                        ON CONFLICT (url) DO NOTHING
                    `, [link.url, JSON.stringify({ subType: link.type })]);
                } catch (err) {
                    // Ignore duplicates
                }
            }
        }

        result.metadata = {
            ...result.metadata,
            linksFound: linksToQueue.length,
            claimsFound: linksToQueue.filter(l => l.type === 'claim').length,
            personsFound: linksToQueue.filter(l => l.type === 'person').length,
            estatesFound: linksToQueue.filter(l => l.type === 'estate').length
        };
    }

    /**
     * Generic extraction for unknown UCL LBS pages
     */
    async extractLBSGeneric($, url, result) {
        console.log('   Generic UCL LBS extraction...');

        // Extract any names that appear with compensation/enslaved context
        const bodyText = result.rawText;

        // Pattern for names with compensation amounts
        const compensationPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[:\-–]?\s*£([\d,]+)/g;
        let match;

        while ((match = compensationPattern.exec(bodyText)) !== null) {
            const name = match[1].trim();
            const amount = parseInt(match[2].replace(/,/g, ''));

            if (name && amount > 0 && !result.owners.find(o => o.fullName === name)) {
                result.owners.push({
                    fullName: name,
                    type: 'confirmed_owner',
                    source: 'ucl_lbs',
                    sourceUrl: url,
                    confidence: 0.90,
                    notes: `Compensation: £${amount.toLocaleString()}`,
                    compensationReceived: amount
                });
            }
        }

        // Queue any links found
        await this.extractLBSSearchResults($, url, result);
    }

    /**
     * Helper: Extract field value from UCL LBS page structure
     */
    extractLBSField($, fieldNames) {
        for (const fieldName of fieldNames) {
            // Try various selectors
            const selectors = [
                `dt:contains("${fieldName}") + dd`,
                `th:contains("${fieldName}") + td`,
                `label:contains("${fieldName}") + span`,
                `[class*="${fieldName.toLowerCase()}"]`,
                `.field-${fieldName.toLowerCase()}`,
                `[data-field="${fieldName.toLowerCase()}"]`
            ];

            for (const selector of selectors) {
                const element = $(selector).first();
                if (element.length && element.text().trim()) {
                    return element.text().trim();
                }
            }

            // Fallback: look for pattern in text
            const regex = new RegExp(`${fieldName}[:\\s]+([^\\n<]+)`, 'i');
            const textMatch = $('body').html()?.match(regex);
            if (textMatch) {
                return textMatch[1].trim();
            }
        }
        return null;
    }

    /**
     * Helper: Parse British pounds from text
     */
    parseBritishPounds(text) {
        if (!text) return 0;
        // Match patterns like "£1,234", "1234", "£1234.5.6" (pounds.shillings.pence)
        const match = text.match(/£?([\d,]+)/);
        if (match) {
            return parseInt(match[1].replace(/,/g, ''));
        }
        return 0;
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
     * LOUISIANA SLAVE DATABASE SCRAPER
     * ========================================
     * Scrapes the Afro-Louisiana History and Genealogy database
     * Source: https://www.ibiblio.org/laslave/
     * Data: CONFIRMED enslaved people from Louisiana records (PRIMARY SOURCE!)
     *
     * This database contains over 100,000 records of enslaved people from:
     * - French period (1719-1769)
     * - Spanish period (1770-1803)
     * - Early American period (1804-1820)
     *
     * URL Patterns:
     * - Main page: /laslave/
     * - Parish pages: /laslave/[parish].php
     * - Search: /laslave/fields.php
     * - Downloads: /laslave/downloads/
     */
    async scrapeLouisianaSlaveDB(url, result, options) {
        console.log('\n📜 Scraping Louisiana Slave Database...');

        const urlLower = url.toLowerCase();

        // Determine page type from URL
        let pageType = 'main';
        let parish = null;

        if (urlLower.includes('/downloads')) {
            pageType = 'downloads';
        } else if (urlLower.includes('fields.php')) {
            pageType = 'search';
        } else if (urlLower.match(/\/([a-z-]+)\.php$/)) {
            pageType = 'parish';
            const match = url.match(/\/([a-z-]+)\.php$/i);
            if (match) parish = match[1];
        }

        console.log(`   Page type: ${pageType}, Parish: ${parish || 'N/A'}`);

        const html = await this.fetchHTML(url);
        const $ = cheerio.load(html);
        result.rawText = $('body').text();

        if (pageType === 'downloads') {
            // Downloads page - note available data files
            console.log('   📦 Found downloadable database files');

            result.metadata = {
                pageType: 'la_slave_downloads',
                availableFiles: [
                    { name: 'Slave.zip', size: '18.03 MB', description: 'Louisiana slave records database' },
                    { name: 'Free.zip', size: '1.28 MB', description: 'Louisiana free blacks database' }
                ],
                note: 'Full database files available for download - contains 100,000+ records',
                formats: ['dbf', 'mdb', 'sav', 'mdx']
            };

            result.documents.push({
                url: 'https://www.ibiblio.org/laslave/downloads/Slave.zip',
                type: 'database_download',
                name: 'Louisiana Slave Records Database',
                size: '18.03 MB'
            });

        } else if (pageType === 'parish') {
            // Parish-specific page
            console.log(`   📍 Processing ${parish} parish page...`);

            // Extract parish name from title or heading
            const title = $('title').text() || '';
            const parishName = title.replace(/Afro-Louisiana/i, '').replace(/History.*$/i, '').trim() ||
                               parish.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

            // Look for any table data
            const tables = $('table');
            let recordsFound = 0;

            tables.each((i, table) => {
                const rows = $(table).find('tr');
                rows.each((j, row) => {
                    const cells = $(row).find('td');
                    if (cells.length >= 2) {
                        const text = $(row).text().trim();
                        // Look for enslaved person patterns
                        if (text.length > 5) {
                            recordsFound++;
                        }
                    }
                });
            });

            // Queue the downloads page if we're on a navigation page
            if (this.db && recordsFound === 0) {
                try {
                    await this.db.query(`
                        INSERT INTO scraping_queue (url, category, status, priority, metadata)
                        VALUES ($1, 'la_slave_database', 'pending', 20, $2::jsonb)
                        ON CONFLICT (url) DO NOTHING
                    `, ['https://www.ibiblio.org/laslave/downloads/', JSON.stringify({ type: 'downloads' })]);
                } catch (err) {
                    // Ignore
                }
            }

            result.metadata = {
                pageType: 'la_slave_parish',
                parishName,
                parish,
                note: 'Parish navigation page - actual records require database download',
                isPrimarySource: true,
                sourceYears: '1719-1820'
            };

        } else if (pageType === 'search') {
            // Search form page
            console.log('   🔍 Processing search interface...');

            // Document available search fields
            const searchFields = [];
            $('select, input[type="text"]').each((i, el) => {
                const name = $(el).attr('name');
                if (name) searchFields.push(name);
            });

            result.metadata = {
                pageType: 'la_slave_search',
                searchFields,
                note: 'Search interface available - database download recommended for bulk processing',
                isPrimarySource: true
            };

        } else {
            // Main page
            console.log('   📋 Processing main page...');

            // Extract key statistics from the page
            const statsMatch = result.rawText.match(/(\d{2,3},?\d{3})\s*(?:records?|entries|enslaved)/i);
            const recordCount = statsMatch ? parseInt(statsMatch[1].replace(/,/g, '')) : null;

            result.metadata = {
                pageType: 'la_slave_main',
                databaseName: 'Afro-Louisiana History and Genealogy',
                estimatedRecords: recordCount || '100,000+',
                coverage: {
                    french: '1719-1769',
                    spanish: '1770-1803',
                    earlyAmerican: '1804-1820'
                },
                isPrimarySource: true,
                note: 'This database contains primary source records from Louisiana. Use downloads page for bulk access.'
            };

            // Queue downloads page
            if (this.db) {
                try {
                    await this.db.query(`
                        INSERT INTO scraping_queue (url, category, status, priority, metadata)
                        VALUES ($1, 'la_slave_database', 'pending', 25, $2::jsonb)
                        ON CONFLICT (url) DO NOTHING
                    `, ['https://www.ibiblio.org/laslave/downloads/', JSON.stringify({ type: 'downloads', priority: 'high' })]);
                } catch (err) {
                    // Ignore
                }
            }
        }

        result.metadata.isPrimarySource = true;
        result.metadata.sourceType = 'louisiana_colonial_records';
    }

    /**
     * ========================================
     * UNDERWRITING SOULS SCRAPER
     * ========================================
     * Scrapes the Lloyd's of London slave trade insurance archive
     * Source: https://underwritingsouls.org/
     * Data: Insurance policies for enslaved people and slave ships (PRIMARY SOURCE!)
     *
     * This archive contains:
     * - Life insurance policies for enslaved individuals
     * - Ship policies for slave trading vessels
     * - Bills of lading
     * - Underwriter risk books
     *
     * These are PRIMARY SOURCES documenting the financial infrastructure of slavery.
     */
    async scrapeUnderwritingSouls(url, result, options) {
        console.log('\n📜 Scraping Underwriting Souls (Lloyd\'s Archive)...');

        const html = await this.fetchHTMLWithBrowser(url);
        const $ = cheerio.load(html);
        result.rawText = $('body').text();

        const urlLower = url.toLowerCase();

        // Determine document type from URL
        let docType = 'unknown';
        if (urlLower.includes('life-insurance')) {
            docType = 'life_insurance';
        } else if (urlLower.includes('policy-for-the-ship')) {
            docType = 'ship_policy';
        } else if (urlLower.includes('bill-of-lading')) {
            docType = 'bill_of_lading';
        } else if (urlLower.includes('risk-book')) {
            docType = 'risk_book';
        } else if (urlLower.includes('deed')) {
            docType = 'deed';
        } else if (urlLower.includes('certificate')) {
            docType = 'certificate';
        } else if (urlLower.includes('digitized-corpus') && !urlLower.match(/digitized-corpus\/[a-z]/)) {
            docType = 'index';
        }

        console.log(`   Document type: ${docType}`);

        if (docType === 'index') {
            // Index/listing page - queue all individual documents
            await this.extractUnderwritingSoulsIndex($, url, result);
        } else {
            // Individual document page
            await this.extractUnderwritingSoulsDocument($, url, result, docType);
        }

        result.metadata.pageType = `underwriting_souls_${docType}`;
        result.metadata.isPrimarySource = true;
        result.metadata.archiveSource = "Lloyd's of London Archive";
    }

    /**
     * Extract individual document from Underwriting Souls
     */
    async extractUnderwritingSoulsDocument($, url, result, docType) {
        console.log('   Extracting document data...');

        const bodyText = result.rawText;
        const title = $('h1, .entry-title, .document-title').first().text().trim();

        // Extract common fields
        const referenceMatch = bodyText.match(/Reference(?:\s*Number)?[:\s]+([A-Z0-9]+)/i);
        const dateMatch = bodyText.match(/Date(?:\s*Issued)?[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
        const valueMatch = bodyText.match(/(?:Insurance\s+)?Value[:\s]+[\$£]?([\d,]+)/i);
        const premiumMatch = bodyText.match(/(?:Annual\s+)?Premium[:\s]+[\$£]?([\d,.]+)/i);

        const reference = referenceMatch ? referenceMatch[1] : null;
        const date = dateMatch ? dateMatch[1] : null;
        const value = valueMatch ? parseInt(valueMatch[1].replace(/,/g, '')) : null;
        const premium = premiumMatch ? parseFloat(premiumMatch[1].replace(/,/g, '')) : null;

        if (docType === 'life_insurance') {
            // Extract enslaved person and owner info
            const enslavedMatch = bodyText.match(/(?:Insured\s+Person|Name)[:\s]+([A-Za-z]+)/i);
            const ownerMatch = bodyText.match(/(?:Policy\s+Owner|Owner|Master)[:\s]+([A-Za-z\s]+?)(?:\n|Location|Occupation)/i);
            const locationMatch = bodyText.match(/Location[:\s]+([A-Za-z\s,]+?)(?:\n|Policy)/i);
            const occupationMatch = bodyText.match(/Occupation[:\s]+([A-Za-z\s]+?)(?:\n|Location)/i);

            const enslavedName = enslavedMatch ? enslavedMatch[1].trim() : null;
            const ownerName = ownerMatch ? ownerMatch[1].trim() : null;
            const location = locationMatch ? locationMatch[1].trim() : null;
            const occupation = occupationMatch ? occupationMatch[1].trim() : null;

            if (enslavedName) {
                result.enslavedPeople.push({
                    fullName: enslavedName,
                    type: 'confirmed_enslaved',
                    source: 'underwriting_souls',
                    sourceUrl: url,
                    confidence: 0.98,
                    locations: location ? [location] : [],
                    notes: `Life insurance policy ${reference || ''}. Value: $${value || 'unknown'}. Policy holder: ${ownerName || 'unknown'}.`,
                    insuranceValue: value,
                    insuranceDate: date,
                    insuranceReference: reference
                });
            }

            if (ownerName) {
                result.owners.push({
                    fullName: ownerName,
                    type: 'confirmed_owner',
                    source: 'underwriting_souls',
                    sourceUrl: url,
                    confidence: 0.98,
                    locations: location ? [location] : [],
                    occupation: occupation,
                    notes: `Insured enslaved person ${enslavedName || 'unknown'}. Policy value: $${value || 'unknown'}.`,
                    insurancePolicyHolder: true,
                    insuranceValue: value
                });

                if (enslavedName) {
                    result.relationships.push({
                        type: 'enslaver-enslaved',
                        owner: ownerName,
                        enslaved: enslavedName,
                        source: 'underwriting_souls',
                        confidence: 0.98,
                        confirmed: true,
                        evidenceType: 'insurance_policy'
                    });
                }
            }

            result.metadata = {
                ...result.metadata,
                title,
                reference,
                date,
                value,
                premium,
                enslavedName,
                ownerName,
                location
            };

        } else if (docType === 'ship_policy') {
            // Extract ship and voyage info
            const shipMatch = title.match(/ship\s+([A-Za-z\s]+)/i) || bodyText.match(/Ship\s*Name[:\s]+([A-Za-z\s]+)/i);
            const shipName = shipMatch ? shipMatch[1].trim() : null;
            const voyageMatch = bodyText.match(/Voyage[:\s]+([A-Za-z\s,]+?)(?:\n|Date)/i);
            const captainMatch = bodyText.match(/Captain[:\s]+([A-Za-z\s]+?)(?:\n|Voyage)/i);
            const enslavedCountMatch = bodyText.match(/(\d+)\s*enslaved/i);

            result.metadata = {
                ...result.metadata,
                title,
                reference,
                date,
                value,
                shipName,
                voyage: voyageMatch ? voyageMatch[1].trim() : null,
                captain: captainMatch ? captainMatch[1].trim() : null,
                enslavedCount: enslavedCountMatch ? parseInt(enslavedCountMatch[1]) : null,
                documentType: 'slave_ship_policy'
            };

            // Record aggregate enslaved count if present
            if (enslavedCountMatch) {
                result.enslavedPeople.push({
                    fullName: `${enslavedCountMatch[1]} enslaved people on ${shipName || 'ship'}`,
                    type: 'confirmed_enslaved',
                    source: 'underwriting_souls',
                    sourceUrl: url,
                    confidence: 0.95,
                    notes: `Ship: ${shipName || 'unknown'}. Insurance policy ${reference || ''}.`,
                    isAggregate: true,
                    count: parseInt(enslavedCountMatch[1])
                });
            }

        } else if (docType === 'bill_of_lading') {
            // Bills of lading for enslaved people
            const enslavedCountMatch = bodyText.match(/(\d+)\s*enslaved/i);
            const portMatch = bodyText.match(/(?:Port|Destination)[:\s]+([A-Za-z\s,]+?)(?:\n|Date)/i);

            if (enslavedCountMatch) {
                result.enslavedPeople.push({
                    fullName: `${enslavedCountMatch[1]} enslaved people (bill of lading)`,
                    type: 'confirmed_enslaved',
                    source: 'underwriting_souls',
                    sourceUrl: url,
                    confidence: 0.98,
                    notes: `Bill of lading ${reference || ''}. ${portMatch ? 'Destination: ' + portMatch[1].trim() : ''}`,
                    isAggregate: true,
                    count: parseInt(enslavedCountMatch[1])
                });
            }

            result.metadata = {
                ...result.metadata,
                title,
                reference,
                date,
                enslavedCount: enslavedCountMatch ? parseInt(enslavedCountMatch[1]) : null,
                port: portMatch ? portMatch[1].trim() : null
            };

        } else if (docType === 'risk_book') {
            // Underwriter risk books - may contain multiple policies
            const underwriterMatch = title.match(/of\s+([A-Za-z\s]+?)(?:\s*$|\s*-)/i) ||
                                    bodyText.match(/Underwriter[:\s]+([A-Za-z\s]+?)(?:\n|Date)/i);

            if (underwriterMatch) {
                result.owners.push({
                    fullName: underwriterMatch[1].trim(),
                    type: 'confirmed_owner', // Underwriters profited from slavery
                    source: 'underwriting_souls',
                    sourceUrl: url,
                    confidence: 0.95,
                    notes: 'Underwriter who profited from insuring the slave trade',
                    role: 'underwriter'
                });
            }

            result.metadata = {
                ...result.metadata,
                title,
                underwriter: underwriterMatch ? underwriterMatch[1].trim() : null,
                documentType: 'underwriter_risk_book'
            };

        } else {
            // Generic document extraction
            result.metadata = {
                ...result.metadata,
                title,
                reference,
                date,
                value
            };
        }

        // Extract any document/image links
        $('a[href*=".pdf"], a[href*=".jpg"], a[href*=".png"], img[src*="archive"]').each((i, el) => {
            const src = $(el).attr('src') || $(el).attr('href');
            if (src) {
                result.documents.push({
                    url: src.startsWith('http') ? src : `https://underwritingsouls.org${src}`,
                    type: 'primary_document_scan',
                    name: title
                });
            }
        });
    }

    /**
     * Extract index page from Underwriting Souls - queue all documents
     */
    async extractUnderwritingSoulsIndex($, url, result) {
        console.log('   Extracting document index...');

        const documentsToQueue = [];

        // Find all document links
        $('a[href*="/digitized-corpus/"]').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();

            // Skip the main index page itself
            if (href && !href.endsWith('/digitized-corpus/') && text.length > 3) {
                const fullUrl = href.startsWith('http') ? href : `https://underwritingsouls.org${href}`;
                if (!documentsToQueue.find(d => d.url === fullUrl)) {
                    documentsToQueue.push({
                        url: fullUrl,
                        title: text
                    });
                }
            }
        });

        console.log(`   Found ${documentsToQueue.length} documents to queue`);

        // Queue all documents
        if (this.db && documentsToQueue.length > 0) {
            for (const doc of documentsToQueue) {
                try {
                    await this.db.query(`
                        INSERT INTO scraping_queue (url, category, status, priority, metadata)
                        VALUES ($1, 'underwriting_souls', 'pending', 15, $2::jsonb)
                        ON CONFLICT (url) DO NOTHING
                    `, [doc.url, JSON.stringify({ title: doc.title })]);
                } catch (err) {
                    // Ignore duplicates
                }
            }
        }

        result.metadata = {
            ...result.metadata,
            documentsFound: documentsToQueue.length,
            documentTitles: documentsToQueue.map(d => d.title)
        };
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

        // Set realistic user agent to avoid bot detection
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto(url, { waitUntil: 'networkidle2', timeout: this.config.timeout });

        // Wait for dynamic content to load
        await new Promise(r => setTimeout(r, 2000));

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
