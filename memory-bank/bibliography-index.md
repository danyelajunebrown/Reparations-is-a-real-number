# Bibliography Index

**Last Updated:** December 4, 2025
**Status:** Active tracking

This document maintains an index of all intellectual sources, databases, archives, researchers, and contributors to the Reparations Is A Real Number project.

---

## Quick Statistics

| Category | Count | Notes |
|----------|-------|-------|
| Government Archives | 5 | Primary sources |
| Genealogy Databases | 3 | Secondary sources |
| Research Compilations | 3 | Curated data |
| Technologies | 20+ | OCR, blockchain, NLP |
| Named Researchers | 2 | Scholars contributing data |
| Pending Citations | 0 | Sources needing full citation |

---

## Primary Sources (Government Archives)

### Maryland State Archives (MSA)
- **URL:** https://msa.maryland.gov/
- **Location:** Annapolis, MD
- **Collections Used:**
  - Slavery Resources
  - Slave Statistics
  - Probate Records
  - County Records (Montgomery, St. Mary's, Charles, Prince George's)
- **Source Type:** Primary
- **Integration:** Scraper patterns, iframe handling for PDFs
- **Confidence:** 95%
- **Citation ID:** `bib_maryland_state_archives`

### Civil War Washington (GWU)
- **URL:** http://civilwardc.org/
- **Institution:** George Washington University
- **Location:** Washington, DC
- **Collections Used:**
  - DC Compensated Emancipation Petitions (1862)
- **Document Types:** Petitions with names, ages, descriptions, valuations
- **Source Type:** Primary
- **Confidence:** 95%
- **Citation ID:** `bib_civil_war_dc`

### National Archives and Records Administration (NARA)
- **URL:** https://www.archives.gov/
- **Location:** Washington, DC
- **Collections Used:**
  - Census Records
  - Slave Schedules
  - Military Records
  - Freedmen's Bureau Records
- **Source Type:** Primary
- **Citation ID:** `bib_nara`

### Library of Virginia
- **URL:** https://www.lva.virginia.gov/
- **Location:** Richmond, VA
- **Collections Used:**
  - Probate Records
  - Wills
  - Estate Inventories
  - County Court Records
- **Source Type:** Primary
- **Citation ID:** `bib_library_of_virginia`

### St. Mary's County Historical Society
- **Location:** St. Mary's County, Maryland
- **Collections Used:**
  - Estate Records
  - Church Registers
- **Source Type:** Primary
- **Citation ID:** `bib_st_marys_historical`

---

## Secondary Sources (Genealogy Databases)

### FamilySearch
- **URL:** https://www.familysearch.org/
- **Operator:** The Church of Jesus Christ of Latter-day Saints
- **Location:** Salt Lake City, UT
- **Integration:** API (requires FAMILYSEARCH_API_KEY)
- **Implementation Files:**
  - `familysearch-reparations-integration.js`
  - `frontend/public/familysearch-integration.js`
- **Source Type:** Secondary
- **Confidence:** 75%
- **Citation ID:** `bib_familysearch`

### Ancestry.com
- **URL:** https://www.ancestry.com/
- **Location:** Lehi, UT
- **Collections Referenced:**
  - Census Records
  - Slave Schedules
  - Wills & Probate
- **Source Type:** Secondary
- **Note:** Referenced in citation tracker for research guidance
- **Citation ID:** `bib_ancestry`

### Find A Grave
- **URL:** https://www.findagrave.com/
- **Owner:** Ancestry.com Operations, Inc.
- **Source Type:** Secondary (Crowdsourced)
- **Evidence Types:** Headstone photos, burial locations
- **Citation ID:** `bib_find_a_grave`

---

## Research Compilations

### Tom Blake's Large Slaveholders of 1860
- **Author:** Tom Blake
- **URL:** http://freepages.rootsweb.com/~ajac/
- **Host:** RootsWeb
- **Content:** 1860 slave schedule census data for slaveholders with 10+ enslaved
- **Structure:** Name, enslaved count by age/gender, location, page reference
- **Confidence:** 98%
- **Pattern Recognition:** Implemented in `memory-bank/scraping-knowledge.json`
- **Citation ID:** `bib_tom_blake_1860`

### Beyond Kin Enslaved Populations Directory
- **URL:** https://www.beyondkin.org/
- **Content:** Database connecting enslaved individuals with slaveholders
- **Records:** 2,461+ entries
- **Confidence:** 70% (requires primary source verification)
- **Scraper Status:** Fully automated (`BeyondKinScraper.js`)
- **Citation ID:** `bib_beyond_kin`

### Wikipedia (Tertiary Reference)
- **URL:** https://en.wikipedia.org/
- **Usage:** Starting points for research, context
- **Confidence:** 50% (always verify with primary sources)
- **Citation ID:** `bib_wikipedia`

---

## Technologies

### OCR & Document Processing
| Technology | License | Role | Confidence |
|------------|---------|------|------------|
| Google Cloud Vision API | Commercial | Primary OCR | 90-95% |
| Tesseract.js | Apache 2.0 | Fallback OCR | 60-80% |
| Sharp | Apache 2.0 | Image processing | - |
| PDF-lib | MIT | PDF manipulation | - |

### Blockchain & Smart Contracts
| Technology | License | Role |
|------------|---------|------|
| OpenZeppelin Contracts | MIT | Smart contract security |
| Web3.js | MIT | Ethereum integration |
| IPFS | MIT | Immutable document storage |
| Truffle | MIT | Development framework |
| Ganache | MIT | Local blockchain |

### NLP & Text Processing
| Technology | License | Role |
|------------|---------|------|
| Natural | MIT | NLP library |
| OpenRouter API | Commercial | LLM integration |

---

## Named Researchers & Contributors

### Tom Blake
- **Role:** Genealogist & Data Compiler
- **Contribution:** Compiled "Large Slaveholders of 1860" database
- **States Covered:** Maryland, Virginia, DC, others
- **Participant ID:** `participant_tom_blake`

### Danyela Brown
- **Role:** Project Creator & Lead Developer
- **Contribution:** Platform conception and development
- **Participant ID:** `participant_danyela_brown`

---

## Pending Citations (To Be Completed)

*No pending citations at this time.*

When content is copy/pasted or referenced without full citation:
1. The IP Tracker flags it automatically
2. Entry appears in `/api/bibliography/pending`
3. Appears on `bibliography.html` under "Pending Citations" tab
4. User can complete citation details later

---

## How to Add New Sources

### Via API:
```bash
POST /api/bibliography
{
  "title": "Source Title",
  "sourceType": "primary|secondary|tertiary|technology",
  "category": "archives|databases|researchers|technologies|participants",
  "url": "https://...",
  "archiveName": "Archive Name",
  "description": "What this source provides",
  "addedBy": "username"
}
```

### Via UI:
1. Navigate to `/bibliography.html`
2. Use "Flag Source for Citation" for quick flags
3. Use "Add Contributor/Participant" for people

### Via Code:
```javascript
const BibliographyManager = require('./src/utils/bibliography-manager');
const bibManager = new BibliographyManager(pool);

await bibManager.addEntry({
  title: 'Source Title',
  sourceType: 'primary',
  url: 'https://...',
  // ... other fields
});
```

---

## Source Type Definitions

| Type | Description | Confidence Baseline |
|------|-------------|---------------------|
| Primary | Original documents, firsthand accounts | 90-95% |
| Secondary | Compiled data, digitized collections | 70-80% |
| Tertiary | Reference works, encyclopedias | 50% |
| Technology | Software libraries, APIs | 100% (version-specific) |
| Intellectual | Researchers, scholars | Based on work cited |

---

## Files Related to Bibliography System

| File | Purpose |
|------|---------|
| `bibliography.html` | Frontend UI |
| `src/utils/bibliography-manager.js` | Core management class |
| `src/utils/ip-tracker.js` | Copy/paste detection |
| `src/api/routes/bibliography.js` | API endpoints |
| `migrations/add-bibliography-tables.sql` | Database schema |
| `memory-bank/bibliography-index.md` | This file |

---

*This document is auto-updated when bibliography entries are added or modified.*
