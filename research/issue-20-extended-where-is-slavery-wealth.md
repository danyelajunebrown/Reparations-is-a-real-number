# Issue #20 Extended: Where Is Slavery Wealth Today?

## The User's Framing

"An overarching goal for this project which I think has been occluded in development is actually visualizing where ALL this alleged reparations money ACTUALLY IS today."

This is the hardest question in reparations research. Nobody has answered it comprehensively. What follows is the most honest assessment of what is knowable, what is estimable, and what is genuinely unknowable.

## The $107.8T Brattle Estimate vs. Identifiable Assets

### What the $107.8T Represents
The Brattle Group's $107.8 trillion is NOT a claim that $107.8T in identifiable assets exists somewhere waiting to be reclaimed. It is a PRESENT VALUE CALCULATION of historical harms:
- Forgone earnings: $54.9T (wages never paid, compounded)
- Loss of liberty: $11.0T (value of freedom stolen)
- Personal injury: $6.0T
- Gender-based violence: $11.8T
- Mental pain and anguish: $24.0T

This is analogous to saying "if someone stole $1 from you in 1619 and you could have invested it at 2.5% annually, you would have $1.07 million today." The money does not sit in a vault labeled "slavery wealth." It was DIFFUSED through 400 years of economic activity into the entire fabric of American (and global) capitalism.

### What IS Identifiable

**Category 1: Named Corporate Successors (Most Traceable)**

These entities have ADMITTED or been DOCUMENTED as having slavery connections:

| Modern Entity | Historical Connection | Current Market Cap (approx.) | Source |
|---------------|----------------------|---------------------------|--------|
| JPMorgan Chase | Citizens Bank/Canal Bank (13,000 enslaved as collateral, 1,250 seized) | ~$700B | JPMorgan 2005 disclosure |
| CVS Health (via Aetna) | Wrote life insurance on enslaved persons | ~$90B | CA SB 2199 registry |
| New York Life | 339 of first 1,000 policies on enslaved persons | Mutual (no market cap) | CA SB 2199 registry |
| Bank of America (via FleetBoston/Providence Bank) | Loans to slave traders, customs duties on slave ships | ~$350B | Farmer-Paellmann litigation |
| Citibank predecessors | Financing of slavery (Montero 2024) | ~$130B | *Stolen Wealth of Slavery* |
| Brown Brothers Harriman | Direct plantation ownership, enslaved person ownership | Private | Farmer-Paellmann SCAC |
| CSX | Railroad predecessors built with enslaved labor | ~$70B | Farmer-Paellmann litigation |
| Norfolk Southern | Railroad predecessors built with enslaved labor | ~$55B | Farmer-Paellmann litigation |
| Union Pacific | Railroad predecessors built with enslaved labor | ~$140B | Farmer-Paellmann litigation |
| R.J. Reynolds (BAT) | Tobacco industry built on enslaved labor | ~$90B (BAT) | Farmer-Paellmann litigation |
| Lloyd's of London | Insured slave trade vessels | Market-making entity | Farmer-Paellmann SCAC |

**Combined identifiable corporate market cap: ~$1.6+ trillion**

This is roughly 1.5% of the $107.8T Brattle figure. The rest is diffused.

**Category 2: Real Property (Partially Traceable)**

Land that was worked by enslaved persons that is still in identifiable ownership:
- University endowments built on slavery wealth (Harvard, Georgetown, Brown, UVA, UNC, etc.)
- Plantation properties now owned by historical trusts, descendants, or corporate entities
- Government-owned land (federal, state, county) that was originally slave-worked

No comprehensive database exists. The closest:
- **Historic American Buildings Survey (HABS):** Documents plantation structures but not ownership chains
- **National Register of Historic Places:** Lists plantation sites but not current ownership
- **County GIS databases:** Can identify current owners of specific parcels

**Category 3: Family Wealth (Least Traceable)**

Per Ager/Boustan/Eriksson: slaveholder families recovered fully within 2 generations via social capital. But this wealth is now dispersed across:
- Millions of descendants (each slaveholder has potentially thousands of living descendants)
- Real estate (homes, investment properties)
- Financial assets (stocks, bonds, retirement accounts)
- Human capital (education funded by inherited advantage)
- Social capital (networks, professional connections)

**This category is fundamentally unknowable at the individual level** without either (a) mandatory wealth disclosure or (b) statistical inference from surname/geography/occupation correlations.

## Forensic Accounting Approaches

### Approach 1: Corporate Succession Tracing (Top-Down)

**What exists:**
- Farmer-Paellmann's SCAC (Second Consolidated Amended Complaint) identifies 17 defendants with specific documentary evidence
- California SB 2199 registry: 677 insurance records linking specific insurers to enslaved persons
- JPMorgan 2005 disclosure: 13,000 enslaved persons as collateral, 1,250 seized
- Philadelphia/Chicago disclosure ordinances: Forced corporate slavery disclosures
- David Montero (2024): Traces Northern corporate profits from slavery through "legitimate" industries

**What could be built:**
A `corporate_slavery_wealth_tracker` database:
1. Start with the 17 Farmer-Paellmann defendants
2. Add all companies identified in CA SB 2199 registry
3. Add companies identified by municipal disclosure ordinances
4. For each: current market cap, annual revenue, total assets (from SEC EDGAR 10-K)
5. Estimate "slavery-derived proportion" of current value (this is the hard part -- see below)

**The proportion problem:** JPMorgan's current $700B market cap is not 100% derived from slavery. But some portion of its early capital base came from Citizens Bank's slavery activities. What proportion? There is no rigorous academic methodology for this. Baptist (2014) argues slavery was responsible for roughly half of antebellum US economic output. Murphy (2023, *Banking on Slavery*) documents how Southern banking was inseparable from slavery. But translating this to a specific percentage of a modern corporation's value requires assumptions no one has been able to defend rigorously.

### Approach 2: UCL Legacies Model (Bottom-Up, British)

The UCL Legacies of British Slavery database is the gold standard:
- 46,000+ slave-owners identified with compensation amounts
- Traced how compensation money was invested: banks, railways, education, land
- Links to modern families, institutions, and properties
- Example: Barclays Bank predecessor Robert Cooper Lee Bevan was a slaveholder

**Why this hasn't been replicated for the US:**
- The UK had a SINGLE compensation event (1833) with records of exactly who received what
- The US has NO equivalent -- slavery ended state by state, with NO compensation to enslaved persons and NO systematic record of slaveholder wealth at emancipation
- The closest US analog: the 1860 census slave schedules (your database has ~1.68M records) combined with the 1860 census of wealth (free population schedules)

### Approach 3: Statistical Inference (Academic)

Several academic approaches estimate slavery's contribution to modern wealth without tracing specific dollars:

1. **Baptist, E. (2014). *The Half Has Never Been Told*:** Argues enslaved labor produced 50%+ of antebellum US economic output. Cotton alone was the largest US export and drove Northern industrial development (textile mills, shipping, banking, insurance).

2. **Beckert, S. & Rockman, S. (2016). *Slavery's Capitalism*:** Collection of essays documenting how slavery was NOT a pre-capitalist relic but a driving engine of modern capitalism. Financial instruments (securitized slave mortgages, cotton futures) were innovations of slave-based capitalism.

3. **Derenoncourt, E. & Montialoux, C. (2021). "Minimum Wages and Racial Inequality." *Quarterly Journal of Economics*:** Documents persistent wealth gap mechanisms from Reconstruction through present.

4. **Craemer's $18.6T estimate** represents the LABOR VALUE stolen. This is the most directly traceable: it went into the products of enslaved labor (cotton, tobacco, sugar, rice, indigo) and the businesses that processed, shipped, financed, and insured those products.

## Public Data Sources for Tracking

### Free/Public:
| Source | What It Reveals | Access |
|--------|----------------|--------|
| SEC EDGAR | Corporate financials, M&A, ownership changes | Free API: efts.sec.gov |
| FDIC BankFind | Bank mergers/acquisitions/failures since 1934 | Free API: banks.data.fdic.gov |
| ProPublica Nonprofit Explorer | 990 filings for nonprofits (university endowments, foundations) | Free API |
| Census Bureau | Demographic and wealth statistics by geography | Free API: data.census.gov |
| Bureau of Labor Statistics | Wage and employment data | Free API: bls.gov/developers |
| Federal Reserve FRED | Economic time series (wealth data, interest rates) | Free API: fred.stlouisfed.org |
| OpenCorporates | 200M+ company records | Free tier API |
| OpenSecrets | Political donations by corporations | Free API |
| County Assessor websites | Property ownership and values | Per-county (no unified API) |
| FamilySearch | Historical records (census, probate, deeds) | Free API |

### Paid/Restricted:
| Source | What It Reveals | Access |
|--------|----------------|--------|
| Bloomberg Terminal | Corporate genealogy, M&A history, ownership chains | $24K/year |
| CoreLogic/PropertyShark | Property ownership history, deed chains | Subscription |
| Dun & Bradstreet | Corporate linkage data | Enterprise license |
| LexisNexis | Legal filings, corporate records, people records | Subscription |

## What Could Actually Be Visualized

### Tier 1: Buildable Now (from your existing data + free APIs)

**"The 17 Defendants"** -- A visualization showing:
- Each Farmer-Paellmann defendant's historical slavery involvement (from your `corporate_entities` table)
- Their corporate succession chain to modern entity
- Current market cap (from SEC EDGAR)
- Combined value: ~$1.6T+
- Comparison bar: "$1.6T identified vs. $107.8T total estimated"

### Tier 2: Buildable with Moderate Effort

**"Where the Cotton Money Went"** -- A Sankey diagram:
- Enslaved labor (person-years) -> Cotton production (value) -> Export revenue -> Northern banks/mills/insurers -> Modern corporations
- Uses Baptist (2014) and Beckert/Rockman (2016) for the flow percentages
- Links to specific modern entities where possible

**"The Map"** -- Geographic visualization:
- Counties with slave schedule data (from your `familysearch_locations`)
- Current property values in those counties (from Census/county assessor data)
- Overlay: "This land was worked by N enslaved persons. Current total assessed value: $X."

### Tier 3: Requires Significant Research

**"Family Wealth Flows"** -- For specific, well-documented families:
- De Wolf family (12,000 enslaved, 2nd richest in US at death)
- Hull family of Athens GA (if you develop the case study)
- Gladstone family (UK, largest single compensation recipient)
- Shows the branching tree of descendants and, where knowable, their current economic status

### Tier 4: May Be Impossible

**"The Complete Map"** -- Every dollar of slavery wealth traced to its current location.
This is not achievable because:
- Wealth is fungible (a dollar from slavery and a dollar from farming are indistinguishable once mixed)
- 160+ years of compounding, inheritance, spending, loss, and reinvestment
- No mandatory disclosure mechanism exists for family wealth sources
- The statistical inference approach can estimate AGGREGATE flows but not trace INDIVIDUAL dollars

## Concrete Next Steps

1. **Build the "17 Defendants" visualization** as the proof of concept. This is achievable NOW with your existing `corporate_entities` table + SEC EDGAR API calls for current financials. Create `scripts/scrapers/edgar-corporate-financials.js`.

2. **Create a `slavery_wealth_locations` table:**
   ```sql
   CREATE TABLE slavery_wealth_locations (
       id SERIAL PRIMARY KEY,
       entity_type VARCHAR(50), -- 'corporation', 'university', 'government', 'family', 'property'
       entity_name VARCHAR(500),
       historical_connection TEXT,
       connection_type VARCHAR(100), -- 'direct_slaveholding', 'insurance', 'banking', 'railroad', 'land'
       estimated_current_value NUMERIC,
       value_source VARCHAR(500),
       value_date DATE,
       slavery_derived_proportion NUMERIC, -- 0.0 to 1.0, NULL if unknown
       proportion_methodology TEXT,
       evidence_sources JSONB,
       created_at TIMESTAMP DEFAULT NOW()
   );
   ```

3. **Seed with the 17 defendants** from your existing data, plus current market caps from EDGAR.

4. **Add the British abolition data** from UCL Legacies database. This provides the most complete "where did slavery wealth go" dataset in existence.

5. **Build the Sankey diagram frontend component.** Libraries: D3.js (already in your stack?) or Observable Plot. Show: [Enslaved Labor] -> [Products] -> [Corporations] -> [Modern Entities] -> [Current Value].

6. **Add an honest "what we don't know" section** to the visualization. Showing $1.6T identified out of $107.8T estimated is MORE powerful than pretending you can trace all of it. The gap itself IS the story.

## Key Citations

- Bazelon et al. (2023). "Quantification of Reparations for Transatlantic Chattel Slavery." Brattle Group.
- Baptist, E. (2014). *The Half Has Never Been Told: Slavery and the Making of American Capitalism.* Basic Books.
- Beckert, S. & Rockman, S. (2016). *Slavery's Capitalism: A New History of American Economic Development.* University of Pennsylvania Press.
- Montero, D. (2024). *The Stolen Wealth of Slavery: A Case for Reparations.* Hachette.
- Murphy, S.A. (2023). *Banking on Slavery: Financing Southern Expansion in the Antebellum United States.* University of Chicago Press.
- Hall, C. et al. (2014). *Legacies of British Slave-Ownership.* Cambridge University Press.
- UCL LBS Database. https://ucl.ac.uk/lbs
- JPMorgan Chase (2005). Slavery Era Disclosure.
- California Department of Insurance. Slavery Era Insurance Registry (SB 2199).
- Farmer-Paellmann. Second Consolidated Amended Complaint (SCAC), N.D. Ill.
- Ager, P., Boustan, L.P. & Eriksson, K. (2021). "The Intergenerational Effects of a Large Wealth Shock." *AER* 111(11): 3767-3794.
- Derenoncourt, E. & Montialoux, C. (2021). "Minimum Wages and Racial Inequality." *QJE* 136(1): 169-228.
