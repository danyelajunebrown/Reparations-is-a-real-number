# Active Context — Reparations Platform

_Last updated: 2026-05-08 (Session 43)_

## Current Focus: Person Modal Data Disconnections — COMPLETED (Session 43)

### What Was Done (Session 43)

Full audit and repair of all "visible blocks" (empty UI fields) on person modals that had
available ground-truth data but were not connected to it. Diagnosed by category, not just
spot-checked. 26 specific canonical_persons examined/updated, 142 updated via backfill.

#### Backend — `src/api/routes/contribute.js`
- **W1:** Enslaved person cards now carry correct `id` (uses `enslaved_id` fallback) and
  `table_source` field — was root cause of every 404 on enslaved person links
- **W1b:** Descendants normalized (`descendant_name` → `full_name`)
- **W2:** Birth year inferred from notes text (age + document year) for `enslaved_individuals`;
  returns `birth_year_source`, `birth_year_confidence`, `birth_year_formula`
- **W3:** Location assembled from `primary_plantation + primary_county + primary_state`
- **W4:** Freedmen's Bank owner resolved via `last_master`/`last_mistress` JSONB keys;
  `branch` → location; `account_number` and `plantation` surfaced
- **W6:** `person_external_ids` queried for FamilySearch, WikiTree, Ancestry links
- **W7:** `historical_reparations_petitions` queried via `petitioner_canonical_id`;
  DC petition data (claimant_name, petition_date, enslaved_claimed, compensation, source_url)
  surfaced on enslaved person modals under "Enslaved by"
- **W7b:** `person_relationships_verified` queried for inherited/bequeathed/transferred chain

#### Frontend
- **`frontend/src/api/format.js`:** Added `formatYearWithEstimation(year, source, confidence, formula)` —
  returns plain string for primary-source years, `{yearStr, isEstimate, tooltip}` for estimated
- **`frontend/src/components/PersonModal/PersonProfile.jsx`:**
  - New `YearDisplay` component: dashed-underline year with `(est.)` badge + native title tooltip
  - Enslaved person links now use `ep.table_source` (was hardcoded `enslaved_individuals`)
  - Identity grid: Freedom year + Plantation fields added
  - New Family section: parents + children from `data.familyMembers`
  - DC petition block rendered under "Enslaved by"
  - Inheritance/provenance chain rendered under "Enslaved by"
  - Ancestry link added to External references
- **`frontend/src/styles/global.css`:** Added `.estimate-badge`, `.estimate-badge-year`,
  `.estimate-badge-label`, `.provenance-chain`, `.provenance-step` classes

#### DB backfills applied directly
- **Ann Maria Biscoe** (`canonical_persons id=141015`):
  - `canonical_name = 'Ann Maria Biscoe'` (was "Ann M. Biscoe")
  - `first_name = 'Ann'`, `middle_name = 'Maria'`, `last_name = 'Biscoe'`
  - `sex = 'Female'`, `primary_state = 'DC'` (was "District"), `primary_county = 'Georgetown'`
  - `ancestor_climb_matches id=138`: `slaveholder_id = 141015` (was null)
  - `historical_reparations_petitions cww.00430`: `claimant_canonical_id = 141015` (was null)
- **8 other Biscoe family members:** `primary_state = 'Maryland'`, `primary_county = 'Charles County'`
- **142 canonical_persons** via `backfill-climb-data-to-canonical.js`:
  `birth_year_estimate` and/or `primary_state`/`primary_county` from `ancestor_climb_matches`

#### New scripts
- `scripts/backfill-climb-data-to-canonical.js` — reads `ancestor_climb_matches` direct columns
  (`slaveholder_birth_year`, `slaveholder_location`), backfills canonical_persons. `--dry-run` safe.
- `scripts/backfill-biscoe-dc-petition.js` — targeted Biscoe repair script (documents the
  lookup logic; actual fixes were applied inline this session)

#### Commits
- `f25151249` — W1-W8: Fix person modal data disconnections (4 files)
- `9b36d9d64` — W5a/W5b: Backfill climb data + Ann Maria Biscoe DC petition (2 scripts)

### Actual schema notes (discovered this session — IMPORTANT for future code)
```
canonical_persons:
  id, canonical_name, first_name, middle_name, last_name,
  birth_year_estimate, death_year_estimate,   ← NOT birth_year / death_year
  sex,                                         ← NOT gender
  primary_state, primary_county, primary_plantation,
  person_type, verification_status, confidence_score

ancestor_climb_matches:
  slaveholder_id,       ← FK to canonical_persons.id (was often null)
  slaveholder_name,
  slaveholder_birth_year,  ← direct integer column (NO match_data JSONB)
  slaveholder_location,    ← text, parse with comma-split
  verification_status, classification

historical_reparations_petitions:
  petition_id, petition_type, jurisdiction,
  claimant_name, claimant_canonical_id, claimant_residence,
  enslaved_persons_claimed (JSONB array),
  total_claimed_usd, total_approved_usd,
  source_document_url, docket_number

unconfirmed_persons:
  lead_id, full_name, person_type, birth_year, death_year,
  gender, locations (array), relationships (JSONB), status
```

### Ann Maria Biscoe DC petition data (for reference)
- Petition cww.00429 (Ann M. Biscoe) — 33 enslaved persons, $15,275 claimed,
  verified `tei_thorough`, confidence 0.95, `claimant_canonical_id = 141015`
- Petition cww.00430 (Ann Maria Biscoe) — 14 enslaved persons (Jenifer family),
  NOW linked `claimant_canonical_id = 141015`
- Source: civilwardc.org, National Archives RG 217.6.5, Microcopy 520, Reel 4

## Previous Focus: Front Page — LedgerSection deployed (Session 42) — COMPLETED

### What Was Done (Session 42)
- **LedgerSection.jsx** created: unified component replacing the old `StatsRibbon` + hardcoded
  "What's in this ledger" box. Makes ONE `api.stats()` call; renders:
  - Live stats grid: enslaved persons, slaveholders, DC petitions (civilwardc_records),
    MSA Certificates of Freedom (msa_records), unique sources
  - Collections list: Freedmen's Bank 61K+ (static, links /depositors),
    doc types (links /documents), 11 corporate disclosures (links /corporate),
    blockchain (links /pay)
  - Cold-start UX: after 8s loading → yellow advisory "database waking up (Render free tier)";
    on error → red "database unavailable — live counts not loaded"
- **HomePage.jsx** updated: imports LedgerSection, removes StatsRibbon + hardcoded box
- Built clean (779 modules, 0 errors), committed to main (`3e507d801`),
  deployed to gh-pages-react

### Previous: S3 Preservation Archival — COMPLETED
## Current Focus: S3 Preservation Archival — COMPLETED

### What Was Asked
Otho Brown's profile was linking to an external MSA URL instead of serving the PDF from S3.
User asked: (1) survey the entire DB for URL-only records, (2) download and preserve all
MSA PDFs in S3 so original-site outages don't break document access.

### What Was Done (this session)

**Migration 063 applied (`person_documents.enslaved_individual_id` + `title` columns):**
- `enslaved_individual_id VARCHAR(50)` — direct FK from person_documents to enslaved_individuals
- `title TEXT` — human-readable document title
- Index: `idx_person_documents_enslaved_individual_id`
- Applied automatically by `scripts/archive-msa-sc2908-to-s3.js` on first run

**132 MSA SC 2908 PDFs archived to S3:**
- Collection: "Certificates of Freedom for Blacks, 1806–1864" (Maryland State Archives)
- URL pattern: `https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/pdf/am812--{N}.pdf`
- S3 prefix: `s3://reparations-them/msa/sc2908/am812--{N}.pdf`
- Result: 132/132 uploaded, 0 failed. Average ~1.5 MB each.
- Script: `scripts/archive-msa-sc2908-to-s3.js` (Phase 1)

**17,876 person_documents rows created linking enslaved_individuals to S3 PDFs:**
- Each `enslaved_individuals` row with an MSA URL in `notes` now has a corresponding
  `person_documents` row with `s3_key`, `s3_url`, `enslaved_individual_id`, and `title`
- Bulk INSERT via single SQL `INSERT INTO ... SELECT` query (one DB round-trip)
- Script: `scripts/insert-msa-person-documents.js`
- Document type: `certificate_of_freedom`

**4 other downloadable PDFs archived to S3:**
- CA DOI Slavery Era Insurance Registry (×2 rows, same PDF) → `person-documents/backfill/25-Slavery-Report.pdf` / `26-...` (118 KB)
- JPMorgan Chase Philadelphia CTO Disclosure 2024 → `person-documents/backfill/27-cto-slavery-era-disclosure-jp-morgan-2024.pdf` (1366 KB)
- Brattle Group Quantification of Reparations 2023 → `person-documents/backfill/28-Quantification-of-Reparations-for-Transatlantic-Chattel-Slavery.pdf` (2303 KB)

**Otho Brown confirmed:**
```
name_as_appears: "Otho Brown"
s3_key:   msa/sc2908/am812--97.pdf
s3_url:   https://reparations-them.s3.amazonaws.com/msa/sc2908/am812--97.pdf
source_url: https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/pdf/am812--97.pdf
```

### Final DB State (person_documents)

| Category | Count |
|----------|-------|
| Total rows | 24,975 |
| S3-backed (s3_key IS NOT NULL) | 22,076 |
| URL-only total | 2,899 |
| └ FamilySearch tree_profile HTML | 2,891 |
| └ Non-downloadable external (datasets/portals) | 8 |
| MSA SC 2908 rows | 17,876 |

**8 remaining URL-only (non-FamilySearch) — legitimately non-downloadable:**
| ID | Type | URL |
|----|------|-----|
| 22,23,24 | insurance_register(_index) | digihum.libs.uga.edu/items/show/42 (HTML embedded viewer) |
| 30 | evacuation_roll | data.novascotia.ca/... Book of Negroes 1783 (data portal) |
| 31 | enslaved_census_brazil | doi.org/10.7910/DVN/GBDHNC (Harvard Dataverse dataset) |
| 32 | probate_enslaved_records | doi.org/10.7910/DVN/LSZJDQ (Harvard Dataverse dataset) |
| 33,34 | freedmens_bank | familysearch.org/en/search/collection/1417695 (collection search page) |

These render correctly as `<a target="_blank">` external links in PersonProfile.jsx.

### Bug Fixed in backfill-source-url-docs-to-s3.js
`CONCURRENCY = parseInt(process.argv[process.argv.indexOf('--concurrency') + 1] || 3)` —
when `--concurrency` not passed, `indexOf` returns -1 so `process.argv[0]` = node path →
`parseInt('node')` = `NaN` → `slice(0, NaN)` = empty batch → 0 uploads.
**Fix:** Always pass `--concurrency 3` flag, OR set a proper default:
```bash
AWS_S3_BUCKET=reparations-them AWS_REGION=us-east-2 \
  node scripts/backfill-source-url-docs-to-s3.js --limit 20 --concurrency 3
```

### New Scripts Created
- `scripts/archive-msa-sc2908-to-s3.js` — Phase 1: download 132 MSA PDFs → S3 (idempotent, --dry-run support)
- `scripts/insert-msa-person-documents.js` — Phase 2: bulk INSERT person_documents via single SQL query

## Document Pipeline Architecture (Current State)

**Backend (`src/api/routes/contribute.js`) — 3-tier lookup for enslaved_individuals:**
1. `person_documents` WHERE `enslaved_individual_id = ei.enslaved_id` (NEW — direct FK, most precise)
2. `person_documents` WHERE `canonical_person_id = enslaved_by_individual_id AND name_as_appears ILIKE full_name`
3. Fallback: all `person_documents` for that enslaver
4. Extract `Source: https://...` URL from `notes` field → primary_source doc (legacy)
5. Legacy: `confirming_documents` (filters out beyondkin.org BK-Header images)

**Frontend (`frontend/src/components/PersonModal/PersonProfile.jsx`) — 3-way rendering:**
- S3 doc (s3_key set) → inline DocViewer with PDF rendering
- External URL only (source_url, no S3) → `<a target="_blank">` with domain shown
- No URL → greyed metadata-only box

## Deployments
- **Backend (Render):** `main` branch at `https://reparations-platform.onrender.com`
  - Auto-deploys on push to main
- **Frontend (GitHub Pages):** `gh-pages-react` branch
  - URL: `https://danyelajunebrown.github.io/Reparations-is-a-real-number/`
  - Deploy: `cd frontend && npm run deploy:gh-pages`
- **DB (Neon):** serverless HTTP via `@neondatabase/serverless`
- **S3:** `reparations-them` bucket, `us-east-2` region

## Key API Routes
- `GET /api/contribute/person/:id?table=enslaved_individuals` — full person profile
- `GET /api/contribute/person/:id?table=canonical_persons` — slaveholder profile
- `GET /api/contribute/search/:query` — cross-table search
- `GET /api/contribute/stats` — platform stats (cached 5min)

## Known Issues / Next Steps
1. `confirming_documents` table (209 rows, all beyondkin.org header images) — consider deprecating
2. FamilySearch tree_profile docs (2,891) — correctly render as external links, no action needed
3. 8 non-downloadable URL-only records — correctly render as external links, no action needed
4. `scripts/backfill-source-url-docs-to-s3.js` default bucket/region doesn't read `S3_BUCKET`/`S3_REGION` — minor bug, always pass env vars explicitly
5. Backend not yet deployed to Render with migration 063 schema changes — auto-deploys on next push to main
