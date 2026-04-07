/**
 * Oracle Event Feed — What the Blockchain Should Listen To
 *
 * This service monitors external data sources for events that affect
 * reparations calculations and accountability tracking.
 *
 * Phase 1 (current): Poll-based monitoring of public APIs
 * Phase 2 (future): Chainlink oracle integration for on-chain data feeds
 *
 * WHAT WE LISTEN TO:
 *
 * 1. SEC EDGAR — Corporate filings for Farmer-Paellmann defendants
 *    When: 10-K, 10-Q, 8-K filings
 *    Why: Track corporate events that affect identified slavery wealth
 *    Example: Aetna acquired by CVS Health (2018) — claim follows the assets
 *
 * 2. Government Reparations Actions
 *    When: HR 40 progress, state/local reparations programs
 *    Why: DAA Section 2.3 termination clause: "enactment of federal reparations legislation"
 *
 * 3. Genealogical Discoveries
 *    When: New climb matches, new enslaved persons linked, new primary sources found
 *    Why: DAA amounts are revisable — blockchain contract has updateReparationsOwed()
 *
 * 4. Academic Research
 *    When: New methodology papers (Craemer updates, Brattle revisions, etc.)
 *    Why: Formula constants may need updating
 *
 * For Chainlink integration:
 *   - Chainlink Any API adapter for SEC EDGAR
 *   - Chainlink Functions for custom data processing
 *   - Base network supports Chainlink (https://docs.chain.link/data-feeds/price-feeds/addresses?network=base)
 *
 * CITATIONS:
 * - Chainlink Documentation: https://docs.chain.link/
 * - SEC EDGAR Full-Text Search API: https://efts.sec.gov/LATEST/
 * - Base Chainlink feeds: https://docs.chain.link/data-feeds/price-feeds/addresses?network=base
 */

class OracleEventFeed {
    constructor(db) {
        this.db = db;

        // Farmer-Paellmann defendant tickers to monitor
        this.MONITORED_TICKERS = [
            { ticker: 'JPM', name: 'JPMorgan Chase', entityKey: 'jpmorgan' },
            { ticker: 'CVS', name: 'CVS Health (Aetna)', entityKey: 'aetna' },
            { ticker: 'CSX', name: 'CSX Corporation', entityKey: 'csx' },
            { ticker: 'NSC', name: 'Norfolk Southern', entityKey: 'norfolk_southern' },
            { ticker: 'UNP', name: 'Union Pacific', entityKey: 'union_pacific' },
            { ticker: 'BAC', name: 'Bank of America (FleetBoston)', entityKey: 'fleetboston' },
            { ticker: 'CNI', name: 'Canadian National', entityKey: 'cn' }
            // BBH and NYL are private — no ticker monitoring
        ];

        // SEC EDGAR API
        this.EDGAR_BASE = 'https://efts.sec.gov/LATEST';
        this.EDGAR_HEADERS = { 'User-Agent': 'ReparationsProject/1.0 (reparations@danceplace.org)' };
    }

    /**
     * Check SEC EDGAR for recent filings from monitored companies.
     * This is the poll-based Phase 1 approach.
     * Phase 2 would use Chainlink Any API to put this on-chain.
     */
    async checkSECFilings(sinceDate = null) {
        const axios = require('axios');
        const since = sinceDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const events = [];

        for (const company of this.MONITORED_TICKERS) {
            try {
                const res = await axios.get(
                    `${this.EDGAR_BASE}/search-index?q=%22${company.ticker}%22&dateRange=custom&startdt=${since}&forms=10-K,10-Q,8-K`,
                    { headers: this.EDGAR_HEADERS, timeout: 10000 }
                );

                const hits = res.data?.hits?.hits || [];
                for (const hit of hits.slice(0, 5)) {
                    events.push({
                        type: 'sec_filing',
                        company: company.name,
                        ticker: company.ticker,
                        entityKey: company.entityKey,
                        formType: hit._source?.form_type || 'unknown',
                        filingDate: hit._source?.file_date || null,
                        description: hit._source?.display_names?.[0] || '',
                        url: hit._source?.file_url ? `https://www.sec.gov${hit._source.file_url}` : null,
                        relevance: 'Corporate event affecting identified slavery wealth'
                    });
                }
            } catch (e) {
                // SEC rate limit or network error — continue with other companies
            }

            // Rate limit
            await new Promise(r => setTimeout(r, 200));
        }

        return {
            checkedAt: new Date().toISOString(),
            companiesChecked: this.MONITORED_TICKERS.length,
            eventsFound: events.length,
            events,
            note: 'Phase 1: poll-based SEC EDGAR monitoring. Phase 2: Chainlink oracle for on-chain events.'
        };
    }

    /**
     * Check for genealogical events that should trigger DAA updates.
     * This runs against our own database — when new matches are found,
     * existing DAAs may need recalculation.
     */
    async checkGenealogyEvents(sinceDate = null) {
        const since = sinceDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const events = [];

        if (this.db) {
            // New climb matches since last check
            const newMatches = await this.db`
                SELECT acm.slaveholder_name, acm.match_type, acm.confidence_adjusted,
                       acs.modern_person_name
                FROM ancestor_climb_matches acm
                JOIN ancestor_climb_sessions acs ON acm.session_id = acs.id
                WHERE acm.found_at > ${since}
                AND acm.verification_status NOT IN ('temporal_impossible', 'common_name_suspect')
                ORDER BY acm.found_at DESC
                LIMIT 20
            `;

            for (const m of newMatches) {
                events.push({
                    type: 'new_match',
                    participant: m.modern_person_name,
                    slaveholder: m.slaveholder_name,
                    matchType: m.match_type,
                    confidence: m.confidence_adjusted,
                    action: 'Review for DAA update via updateReparationsOwed()'
                });
            }

            // New enslaved persons linked
            const newLinked = await this.db`
                SELECT COUNT(*) as cnt FROM family_relationships
                WHERE created_at > ${since}
            `;
            if (parseInt(newLinked[0].cnt) > 0) {
                events.push({
                    type: 'new_enslaved_linked',
                    count: parseInt(newLinked[0].cnt),
                    action: 'Existing DAAs may need recalculation with newly documented enslaved persons'
                });
            }
        }

        return {
            checkedAt: new Date().toISOString(),
            eventsFound: events.length,
            events
        };
    }

    /**
     * Generate Chainlink oracle configuration for Phase 2.
     * This would be used in a Chainlink Functions or Any API setup.
     */
    getChainlinkConfig() {
        return {
            network: 'Base Mainnet',
            chainId: 8453,
            contract: '0x914846ceA07e57d848d9d60C8238865D83d9ab1E',
            feeds: [
                {
                    name: 'SEC EDGAR Monitor',
                    type: 'Chainlink Functions',
                    schedule: 'Daily',
                    description: 'Check SEC filings for Farmer-Paellmann defendant companies',
                    tickers: this.MONITORED_TICKERS.map(t => t.ticker),
                    action: 'Emit event if significant filing detected (M&A, restructuring, bankruptcy)'
                },
                {
                    name: 'Reparations Legislation Monitor',
                    type: 'Manual multi-sig',
                    schedule: 'As needed',
                    description: 'Track HR 40 and state/local reparations legislation progress',
                    action: 'Could trigger DAA Section 2.3 termination clause'
                },
                {
                    name: 'ETH/USD Price Feed',
                    type: 'Chainlink Data Feed',
                    address: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', // Base mainnet ETH/USD
                    description: 'Convert ETH deposits to USD-equivalent for debt tracking'
                }
            ],
            implementation: 'Phase 2 — requires Chainlink subscription on Base. See https://docs.chain.link/chainlink-functions'
        };
    }
}

module.exports = OracleEventFeed;
