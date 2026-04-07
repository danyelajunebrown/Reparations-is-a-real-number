# Issue #20: Methodology for Tracing Antebellum Wealth to Present-Day Holdings

## Current Academic State of the Art

### The Core Finding: Wealth Persisted, But NOT Through Direct Inheritance

Ager, Boustan & Eriksson (AER, 2021) is the definitive study:
- The nullification of slave wealth after the Civil War was one of the largest wealth compressions in history
- Slaveholder families lost ~$3 billion in slave property (1860 dollars)
- **Sons of slaveholders fully recovered relative to comparable non-slaveholder sons by 1900**
- **Grandsons surpassed their counterparts in education and occupation by 1940**
- **The mechanism was SOCIAL CAPITAL, not financial inheritance:** sons married into other former slaveholding families, accessed elite education, maintained professional networks

This finding is crucial: it means you CANNOT trace a dollar from 1850 to a bank account in 2026. What you CAN trace is:
1. The INSTITUTIONAL pathways (corporate succession chains)
2. The PROPERTY pathways (land that stayed in families)
3. The SOCIAL pathways (family networks, educational access, political power)

### The UCL Legacies of British Slavery Database

The most successful existing model for this kind of tracing:
- Contains identities of ALL 46,000+ slave-owners in British colonies at abolition (1833)
- Traces how compensation money (~$20 billion in today's terms) was spent:
  - Education of sons and grandsons (including grand tours of Europe)
  - Consolidation of professional and political power
  - Direct investment in banks, railways, and colonial enterprises
- Links slave-owning families to modern institutions, properties, and cultural legacies
- Example: John Gladstone (largest single compensation recipient) was father of PM William Ewart Gladstone

### David Montero's "The Stolen Wealth of Slavery" (2024)

Montero's forensic journalism traces Northern corporate profits from slavery:
- Demonstrates that Northern banks (Citibank, Bank of New York, Bank of America predecessors) were critical financiers of slavery
- Calls it "the largest money-laundering operation in American history" -- Northern business leaders used slavery wealth to finance legitimate industries that became "the foundations of America's industrial revolution"
- Profiles Farmer-Paellmann's legal work tracing corporate succession

### What Records Exist for Tracing

The chain of records, from antebellum to present:

**Layer 1: Slaveholding Documentation (1790-1865)**
- Federal census slave schedules (your `unconfirmed_persons` table: ~1.68M records)
- Probate records / wills (FamilySearch, Ancestry, state archives)
- County deed records (enslaved persons recorded as property transfers)
- Tax records (personal property tax on enslaved persons)
- Plantation records (university special collections)

**Layer 2: Post-War Wealth Recovery (1865-1920)**
- Freedmen's Bureau records (National Archives)
- County land deeds (who kept the land after emancipation?)
- Corporate charters filed with state Secretaries of State
- Railroad land grants (connected to CSX, Norfolk Southern predecessors)
- Banking records (who got loans for Reconstruction-era enterprises?)

**Layer 3: Institutional Consolidation (1920-1970)**
- SEC filings begin 1934 (EDGAR database)
- Corporate merger/acquisition records
- State insurance commission records (California SB 2199 registry)
- University endowment records (Georgetown, Brown, Harvard, etc.)
- Property deed chains (county recorder offices, increasingly digitized)

**Layer 4: Modern Corporate Succession (1970-Present)**
- SEC EDGAR full-text search (free API)
- State Secretary of State corporate databases
- Bloomberg/Refinitiv corporate genealogy databases (paid)
- OpenCorporates.com (free, 200M+ companies)
- FDIC bank history database (free)
- Corporate slavery disclosure ordinances (Chicago 2003, Philadelphia, others)

## What a Case Study Would Look Like

### Example: The Hull Family of Athens, Georgia (1850 to Present)

**Step 1: 1850-1860 Census Documentation**
- Identify Hull family in 1850 and 1860 slave schedules (your existing data)
- Cross-reference with county tax digests for property valuation
- Identify specific enslaved persons from probate/will records

**Step 2: Post-War Land Retention**
- Search Clarke County GA deed records (many digitized via FamilySearch)
- Determine which Hull properties survived the war
- Identify any land that became UGA property or was developed commercially

**Step 3: Business Formation**
- Search Georgia Secretary of State corporate records
- Identify any businesses incorporated by Hull descendants
- Track banking relationships (Athens banks with Hull family ties)

**Step 4: Modern Holdings**
- County property records (Clarke County GIS is online)
- Any corporate successors still operating?
- University connections (UGA historical records)

**The honest assessment:** This is a 40-80 hour research project PER FAMILY, and it requires access to county-level records that are only partially digitized. No one has automated this.

## Databases and APIs That Could Support Automated Tracing

### Free/Public APIs:
| Source | What It Has | API? | URL |
|--------|-------------|------|-----|
| SEC EDGAR | Corporate filings since 1993, full-text search | Yes (free) | efts.sec.gov/LATEST/search-index |
| OpenCorporates | 200M+ company records globally | Yes (free tier) | api.opencorporates.com |
| FamilySearch | Probate, land, census records | Yes (free) | familysearch.org/developers |
| FDIC BankFind | Bank history, mergers, acquisitions | Yes (free) | banks.data.fdic.gov/api |
| BLM Land Records | Federal land patents (pre-1908) | Yes (free) | glorecords.blm.gov |
| NARA Catalog | National Archives digitized records | Yes (free) | catalog.archives.gov/api |
| SlaveVoyages.org | Trans-Atlantic slave trade database | Yes (free) | slavevoyages.org/api |
| UCL LBS Database | British slaveholder records | Web scrape | ucl.ac.uk/lbs |

### Paid/Restricted:
| Source | What It Has | Access |
|--------|-------------|--------|
| Ancestry.com | Largest genealogy record collection | Subscription (API retired ~2015) |
| Bloomberg Terminal | Corporate genealogy, M&A history | $24K/year |
| Refinitiv/LSEG | Corporate ownership chains | Enterprise license |
| PropertyShark/CoreLogic | Property ownership history | Subscription |

### State-Level Corporate Records:
Most state Secretaries of State have searchable corporate databases, but NO unified API. Would need per-state scrapers for: Georgia, Virginia, South Carolina, North Carolina, Louisiana, Mississippi, Alabama, Tennessee, Texas, Maryland, Kentucky, Missouri, Florida, Arkansas, Delaware (where most modern corps incorporate).

## What's Been Tried Before

### Worked:
- **UCL Legacies Database:** Gold standard. Took 10+ years of academic research with dedicated team. Covers British Empire only.
- **JPMorgan 2005 disclosure:** Revealed 13,000 enslaved persons taken as collateral, 1,250 seized after loan default by Citizens Bank and Canal Bank (Louisiana). This was forced by Chicago's 2003 disclosure ordinance.
- **California SB 2199 (Slavery Era Insurance Registry):** 677 records of life insurance policies on enslaved persons. Covers Georgia, Kentucky, Louisiana, Mississippi, NC, SC, Virginia. Insurers: Aetna predecessors, New York Life/Nautilus, AIG predecessors, Southern Mutual.
- **Philadelphia disclosure ordinance:** Produced slavery disclosures from JPMorgan and others doing business with the city.
- **Georgetown GU272 Memory Project:** Traced 272 specific enslaved persons and their descendants. Used combination of Jesuit archives + genealogical research.

### Failed/Incomplete:
- **Farmer-Paellmann's discovery process:** Her 2002 lawsuit (17 corporate defendants) was dismissed before substantive discovery could force open corporate archives. The Seventh Circuit reversed on consumer fraud claims but the case never produced the internal records that would have been the most valuable tracing data.
- **No one has built an automated pipeline** from slave schedule records through probate/land to modern corporate filings. This does not exist.
- **Ancestry.com API retirement (~2015):** The most comprehensive genealogical record source is now scrape-only, which they actively block.

## Concrete Next Steps for This Project

### Phase 1: Formalize the Known Corporate Chains (Low effort, high impact)
You already have the 17 Farmer-Paellmann defendants in your `corporate_entities` table. For each:
1. Document the complete succession chain (historical entity -> modern entity)
2. Add SEC CIK numbers for EDGAR lookups
3. Add current ticker symbols
4. Store modern market cap as a "wealth location" data point

Specific chains to document:
- Providence Bank -> FleetBoston -> Bank of America
- Citizens Bank/Canal Bank -> JPMorgan Chase
- Nautilus Insurance -> New York Life
- Aetna (slavery-era) -> Aetna Inc -> CVS Health (2018 merger)
- CSX predecessors (railroads built with enslaved labor)
- Norfolk Southern predecessors
- Brown Brothers -> Brown Brothers Harriman
- Lehman Brothers -> (dissolved 2008, assets to Barclays/Nomura)

### Phase 2: Build the EDGAR Integration
Create `scripts/scrapers/edgar-corporate-tracer.js`:
- Use SEC EDGAR full-text search API to find slavery-related disclosures
- Pull 10-K filings for the 17 defendants to extract current financials
- Store in a new `corporate_succession_chains` table linking historical entities to modern ones with source citations

### Phase 3: Property Record Pilot
Pick ONE county with good digitized records (suggestion: Clarke County GA, or Orleans Parish LA):
- Scrape county property records
- Cross-reference property owners against your `canonical_persons` (slaveholders)
- Determine if any properties are still held by descendants or successor entities
- This is a proof of concept for the visualization: "This land was worked by enslaved persons. Here is who owns it today."

### Phase 4: The Visualization Layer
The user's stated goal: "visualizing where ALL this alleged reparations money ACTUALLY IS today."
- Build a Sankey diagram: [Slaveholder 1850] -> [Probate 1870] -> [Corporation 1920] -> [Modern Entity 2026]
- For the 17 Farmer-Paellmann defendants, this is achievable because the succession is DOCUMENTED
- For individual families, this requires the per-family research described above

## Honest Assessment

**What IS possible now:** Trace the 17 Farmer-Paellmann defendants from historical slavery involvement to modern corporate entities, pull their current market capitalizations, and visualize where that specific wealth sits today.

**What is NOT possible to automate:** Tracing individual slaveholder family wealth forward 160 years to specific modern assets. The Ager/Boustan/Eriksson finding explains why -- the wealth transmitted through social capital (marriages, education, networks), not through traceable financial instruments. You can show that slaveholder families RECOVERED economically. You cannot show exactly where the dollars went.

**The middle ground:** For specific, well-documented cases (Georgetown GU272, JPMorgan/Citizens Bank, the De Wolf family), you can build detailed case studies that serve as proof-of-concept exemplars.

## Key Citations

- Ager, P., Boustan, L.P. & Eriksson, K. (2021). "The Intergenerational Effects of a Large Wealth Shock: White Southerners after the Civil War." *American Economic Review* 111(11): 3767-3794.
- Montero, D. (2024). *The Stolen Wealth of Slavery: A Case for Reparations*. Hachette.
- Hall, C. et al. (2014). *Legacies of British Slave-Ownership.* Cambridge University Press.
- UCL Centre for the Study of the Legacies of British Slavery. LBS Database. https://ucl.ac.uk/lbs
- California Department of Insurance. Slavery Era Insurance Registry. https://insurance.ca.gov/01-consumers/150-other-prog/10-seir/
- JPMorgan Chase (2005). Slavery Era Disclosure. Filed with City of Chicago/Philadelphia.
- DeWolf, T.N. (2008). *Inheriting the Trade.* Beacon Press.
