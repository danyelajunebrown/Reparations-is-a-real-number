/**
 * Corporate Succession Tracer
 *
 * Traces the documented succession chains from slavery-era entities
 * to their present-day corporate successors. Uses SEC EDGAR API
 * for current entity data and the corporate_succession table for
 * historical chain documentation.
 *
 * This addresses the question: "Where is slavery wealth today?"
 * For the 17 Farmer-Paellmann defendants, succession chains are
 * partially documented. For individual slaveholder families,
 * tracing requires manual research (40-80 hours per family).
 *
 * The intake form should collect: "Do you or your family have any
 * connection to the following companies?" to help identify corporate ties.
 *
 * CITATIONS:
 * - Farmer-Paellmann v. FleetBoston (N.D. Ill. 2002): 17 corporate defendants
 * - JPMorgan Chase Philadelphia CTO Disclosure (2024): Citizens Bank → Canal Bank → JPMorgan
 * - California Slavery Era Insurance Registry (SB 2199, 2002): insurance companies
 * - SEC EDGAR: https://efts.sec.gov/LATEST/search-index?q=
 */

class CorporateSuccessionTracer {
    constructor(db) {
        this.db = db;

        // Known succession chains for Farmer-Paellmann defendants
        // These are DOCUMENTED — not speculative
        this.KNOWN_CHAINS = {
            'jpmorgan': {
                modern: 'JPMorgan Chase & Co.',
                ticker: 'JPM',
                predecessors: [
                    { name: 'Citizens Bank of Louisiana', year: 1831, role: 'predecessor bank' },
                    { name: 'Canal Bank (New Orleans Canal & Banking Co.)', year: 1831, role: 'predecessor bank' },
                    { name: 'Lexington Branch, 2nd Bank of Kentucky', year: 1835, role: 'predecessor bank' },
                    { name: 'J. Pierpont Morgan / George Peabody & Co.', year: 1871, role: 'Peabody Firms' },
                    { name: 'Bowery Savings Bank (via Washington Mutual)', year: 1834, role: 'acquired 2008' }
                ],
                documentation: {
                    primary: 'Philadelphia CTO Disclosure (2024)',
                    enslavedAsCollateral: 21055,
                    enslavedOwned: 1300,
                    url: 'storage/corporate-disclosures/banking/jpmorgan-philadelphia-cto-disclosure-2024.pdf'
                }
            },
            'aetna': {
                modern: 'CVS Health Corporation (Aetna successor)',
                ticker: 'CVS',
                predecessors: [
                    { name: 'Aetna Life Insurance Company', year: 1853, role: 'insured enslaved persons' }
                ],
                documentation: {
                    primary: 'CA DOI Slavery Era Insurance Registry (2002)',
                    policies: 7,
                    enslavedNames: 16,
                    url: 'storage/corporate-disclosures/insurance/ca-doi-slavery-era-insurance-registry-2002.pdf'
                }
            },
            'new_york_life': {
                modern: 'New York Life Insurance Company',
                ticker: null, // Mutual company, not publicly traded
                predecessors: [
                    { name: 'Nautilus Insurance Company', year: 1845, role: 'wrote slave life policies' }
                ],
                documentation: {
                    primary: 'CA DOI Slavery Era Insurance Registry (2002)',
                    policies: 339,
                    enslavedNames: 484,
                    slaveholderNames: 233,
                    url: 'storage/corporate-disclosures/insurance/ca-doi-slavery-era-insurance-registry-2002.pdf'
                }
            },
            'bbh': {
                modern: 'Brown Brothers Harriman & Co.',
                ticker: null, // Private partnership
                predecessors: [
                    { name: 'Brown Brothers & Co.', year: 1818, role: 'cotton factor, plantation owner' }
                ],
                documentation: {
                    primary: 'Beckert, Empire of Cotton (2015), p.223; Louisiana court records',
                    enslaved: 346,
                    plantations: 3,
                    acres: 4614
                }
            },
            'csx': {
                modern: 'CSX Corporation',
                ticker: 'CSX',
                predecessors: [
                    { name: '36 predecessor railroad lines', year: 1830, role: 'enslaved labor in construction' }
                ],
                documentation: {
                    primary: 'Kornweibel, Railroads in the African American Experience (2010)',
                    predecessorCount: 36
                }
            },
            'norfolk_southern': {
                modern: 'Norfolk Southern Corporation',
                ticker: 'NSC',
                predecessors: [
                    { name: '39 predecessor railroad lines', year: 1827, role: 'enslaved labor' },
                    { name: 'South Carolina Canal and Rail Road Company', year: 1827, role: 'earliest predecessor' }
                ],
                documentation: {
                    primary: 'Kornweibel (2010)',
                    predecessorCount: 39
                }
            }
        };
    }

    /**
     * Get the succession chain for a Farmer-Paellmann defendant.
     */
    getChain(entityKey) {
        return this.KNOWN_CHAINS[entityKey] || null;
    }

    /**
     * List all documented succession chains.
     */
    listAllChains() {
        return Object.entries(this.KNOWN_CHAINS).map(([key, chain]) => ({
            key,
            modernEntity: chain.modern,
            ticker: chain.ticker,
            predecessorCount: chain.predecessors.length,
            earliestYear: Math.min(...chain.predecessors.map(p => p.year)),
            primarySource: chain.documentation.primary
        }));
    }

    /**
     * Look up current market cap for a publicly traded successor.
     * Uses a simple SEC EDGAR search. For real-time data, would need
     * a financial data API (Chainlink oracle, Alpha Vantage, etc.)
     */
    async lookupCurrentValue(ticker) {
        if (!ticker) return { error: 'No ticker — entity is private or mutual' };

        try {
            // SEC EDGAR company search
            const axios = require('axios');
            const res = await axios.get(
                `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&dateRange=custom&startdt=2026-01-01&enddt=2026-12-31&forms=10-K`,
                { headers: { 'User-Agent': 'ReparationsProject/1.0 (research)' }, timeout: 10000 }
            );
            return {
                ticker,
                edgarResults: res.data?.hits?.total?.value || 0,
                note: 'SEC EDGAR search — for real-time market cap, integrate financial data API'
            };
        } catch (e) {
            return { ticker, error: e.message };
        }
    }

    /**
     * Generate a research lead for per-family wealth tracing.
     * This is the 40-80 hour manual research that can't be automated,
     * but we can generate the research plan.
     */
    generateFamilyResearchPlan(enslaverName, state, county) {
        return {
            enslaver: enslaverName,
            location: `${county || '?'}, ${state || '?'}`,
            steps: [
                {
                    step: 1,
                    description: `Search FamilySearch for probate/will records: ${enslaverName}, ${county}, ${state}`,
                    url: `https://www.familysearch.org/search/catalog/results?count=20&query=%2Bplace%3A%22${encodeURIComponent((county || '') + ', ' + (state || ''))}%22%20%2Bsubject%3A%22Probate%22`,
                    estimatedHours: '2-4',
                    automatable: false
                },
                {
                    step: 2,
                    description: 'Identify heirs from probate records — who inherited the estate?',
                    estimatedHours: '4-8',
                    automatable: false
                },
                {
                    step: 3,
                    description: 'Search 1870-1900 Census for heirs — where did they go? What property did they hold?',
                    url: `https://www.familysearch.org/en/search?q.surname=${encodeURIComponent(enslaverName.split(' ').pop())}&q.residencePlace=${encodeURIComponent(state || '')}`,
                    estimatedHours: '4-8',
                    automatable: true // FamilySearch scraper could do this
                },
                {
                    step: 4,
                    description: 'Trace land records — did heirs sell, develop, or retain the property?',
                    estimatedHours: '8-16',
                    automatable: false
                },
                {
                    step: 5,
                    description: 'Check for corporate formation — did any heir start a business from estate proceeds?',
                    url: `https://opencorporates.com/companies?q=${encodeURIComponent(enslaverName.split(' ').pop())}&jurisdiction_code=us_${(state || '').toLowerCase().substring(0, 2)}`,
                    estimatedHours: '4-8',
                    automatable: true
                },
                {
                    step: 6,
                    description: 'Identify modern descendants — do any living descendants hold identifiable wealth?',
                    estimatedHours: '8-16',
                    automatable: false
                }
            ],
            totalEstimatedHours: '40-80',
            note: 'Per-family wealth tracing cannot be fully automated. Steps 3 and 5 can be partially automated with scrapers.'
        };
    }
}

module.exports = CorporateSuccessionTracer;
