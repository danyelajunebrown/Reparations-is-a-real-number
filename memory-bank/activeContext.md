# Active Context — Reparations Platform

_Last updated: 2026-05-15 (Session 57 — Georgia Probate Scraper full rewrite + confirmed working on Mac Mini)_

---

## Session 57 — Georgia Probate Scraper Full Rewrite — ✅ COMMITTED & CONFIRMED WORKING (2026-05-15)

### What Was Done (4 major fixes + 1 bonus)

**Fix 1 — `buildSitemap()` stores `rollIndexUrl` per roll**
Each roll entry now carries the pre-computed URL:
`https://www.familysearch.org/search/image/index?owc=groupId:dgs?cc=1999178`

**Fix 2 — `buildImageUrl(arkId)` simplified**
Single-parameter helper; returns the fullText reference URL only (not used for navigation).

**Fix 3 — `scrapeOneRoll()` completely rewritten**
Old approach used `groupId:dgs` image index URL directly and a fragile multi-param `page.goto()`.
New approach:
1. Navigate to `roll.rollIndexUrl`
2. Click the first `a[href*="/ark:/61903/3:1:"]` thumbnail → viewer opens on image 1
3. Read image-1 ARK from `page.url()` (each image has a unique ARK, not the group ARK)
4. Advance images 2…N via viewer number-input field (`advanceViewerToImage` helper) — extracts per-image ARK from `page.url()` each time

**Fix 4 — `processImage()` streamlined**
- Removed `page.goto()` and `dgsEncoded` param — caller has already navigated
- 2s wait → `div[data-testid="full-text-transcript"]` extraction (unchanged from Session 56)
- Returns `status='no_transcript'` for empty/short text

**Bonus fix — `ensureLoggedIn` try/catch**
FamilySearch redirects `familysearch.org/` → `/en/home/portal/` during `sleep()`, destroying the page execution context. Added try/catch around `page.evaluate()`:
```js
const checkLoggedIn = async () => {
    try {
        const url = page.url();
        if (url.includes('/home/portal/') || url.includes('familysearch.org/home')) return true;
        return await page.evaluate(() =>
            document.querySelector('button[data-testid="user-menu-button"]') !== null ||
            document.querySelector('[data-testid="header-profile"]') !== null ||
            document.querySelector('a[href*="/account/"]') !== null
        );
    } catch (_) {
        const url = page.url();
        return url.includes('/home/portal/') || url.includes('familysearch.org/home');
    }
};
```

### Commits
| Commit | Description |
|--------|-------------|
| `0526ef8e8` | Session 56: data-testid selector fix |
| `9c00e32c3` | Session 57: full rewrite — rollIndexUrl sitemap, advanceViewerToImage, per-image ARK from page.url(), ensureLoggedIn try/catch, M078 auto-apply |

### Mac Mini Confirmed Working Output (commit `9c00e32c3`)
```
Starting Georgia Probate Scraper (multi-county/multi-roll)...
Found 131 county entries on waypoints page.
Found 71 rolls in Liberty.
Roll: "Wills, appraisements and bonds 1790-1850 vol B" [9SYT-PT5] in Liberty
Image count: 689
Image 1 ARK: 3QSQ-G93L-GHFK  ← real image-specific ARK
Image 2 ARK: 3QSQ-G93L-GHJ2 → status=parsed, rawText: "T ┃ S ┃ Swede"
Image 3 ARK: 3QS7-L93L-GH2J → status=parsed, rawText: "LIBERTY COUNTY STATE OF GEORGIA COURT BOOK..."
Image 4 ARK: 3QSQ-G93L-P9R2 → status=parsed, rawText: "AND DATE FILMED AUGED 1958 EXPOSURE..."
Image 5 ARK: 3QSQ-G93L-PSZZ → status=no_transcript
Scraping complete. Total images processed: 5
```

### Key Technical Facts (permanent notes)
- **FamilySearch SPA**: always `waitUntil: 'domcontentloaded'`; NEVER `networkidle0`
- **Per-image ARK**: extracted from `page.url()` after viewer navigation — NOT from the group ARK `9SYT-PT5`
- **Viewer input navigation**: triple-click `input[aria-label*="mage"]` / `input[class*="image-number"]` / `input[type="number"]`, type number, Enter, 6s sleep
- **puppeteer.connect()** to port 9222; fallback to `open -na "Google Chrome"` system launch; NEVER `puppeteer.launch()` (crashes on Intel Mac Sonoma)
- **`probate_scrape_progress`** UNIQUE constraint: `(collection_id, roll_group_id, image_number)` — migration 078
- **Sitemap**: `tmp/georgia-probate-sitemap.json`

### Files Changed
| File | Change |
|------|--------|
| `scripts/scrapers/georgia-probate-scraper.js` | Full rewrite — 4 major fixes + ensureLoggedIn try/catch |
| `migrations/078-probate-scrape-progress-roll-column.sql` | Adds `roll_group_id TEXT`, replaces UNIQUE constraint |

### Next Steps — Mac Mini
**Step 3 — Write to DB (limit 10, one roll)**
```bash
node scripts/scrapers/georgia-probate-scraper.js \
  --county Liberty \
  --roll-title "Wills, appraisements and bonds 1790" \
  --limit 10 --apply --verbose
```

**Step 4 — Full Liberty County**
```bash
node scripts/scrapers/georgia-probate-scraper.js --county Liberty --apply --resume
```

**Step 5 — All counties (only after Step 4 verified)**
```bash
node scripts/scrapers/georgia-probate-scraper.js --apply --resume
```

---

## Session 55 — Georgia Probate Scraper Schema Bug Fixes — ✅ COMMITTED (2026-05-15)

### What Was Built
`scripts/scrapers/georgia-probate-scraper.js` — Puppeteer scraper for Liberty County GA probate records (FamilySearch collection 1999178, group 9SYT-PT5, 555 images, 1858-1867). `migrations/069-georgia-probate-pipeline.sql` — pipeline infrastructure (progress table, source registry, methodology entries).

### Schema Bugs Fixed (commit 6bcdea8fa, pushed to origin main)
1. **`person_documents` INSERT**: Removed non-existent columns `extraction_method`, `title`. Added `source_url`, `source_type`, `image_number`. Used `ON CONFLICT DO NOTHING` with null-row guard.
2. **`inheritance_edges` asset_type**: `'general_bequest'` → `'unspecified'` (valid CHECK value per M067).
3. **`canonical_persons` INSERT**: No unique constraint on canonical_name column. Replaced `ON CONFLICT` clause with fuzzy-match SELECT-first, plain INSERT if no match (Levenshtein ≤ 2 + county + year window).
4. **`person_relationships_verified`**: Removed — `person_id` FK requires `canonical_persons(id)`, but enslaved persons live in `unconfirmed_persons`. Relationship stored in `unconfirmed_persons.relationships` JSONB instead.
5. **`estimation_methodology_registry` query**: Column is `name`, not `methodology_name`. Added `AND version = 'v1.0.0'` filter.
6. **Migration 069**: Rewrote both INSERTs with correct column names matching actual `regional_source_registry` (no `state`/`county`/`is_compilation`/`collection_id` columns) and `estimation_methodology_registry` (columns: `name`, `version`, `description`, `role_tags`, `assumptions_jsonb`, `citations`, `known_failure_modes`).

### Schema Facts Confirmed This Session
- `canonical_persons`: **NO UNIQUE** constraint on `canonical_name` — use SELECT-first approach
- `inheritance_edges.asset_type` valid values: `'real_property','enslaved_persons','personal_estate','monetary_bequest','residual_estate','trust_interest','business_interest','mixed','unspecified'`
- `inheritance_edges.confidence` NUMERIC(4,3) — column EXISTS (confirmed)
- `person_relationships_verified.person_id` → FK to `canonical_persons(id)` only
- `regional_source_registry` columns: `source_name, citation, jurisdiction_text, era_start, era_end, record_type, axis_role, access_method, coverage_notes, methodology_id` — NOT state/county/is_compilation/external_url/collection_id
- `estimation_methodology_registry` UNIQUE on `(name, version)` — conflict target for ON CONFLICT

### Next Steps — Mac Mini
```bash
cd ~/Reparations-is-a-real-number && git pull origin main

# Test transcript extraction on image 141 (known-transcribed):
node scripts/scrapers/georgia-probate-scraper.js \
  --county Liberty --state GA --collection 1999178 \
  --group-id 9SYT-PT5 --dgs "267679901,268032901" \
  --ark 3QS7-893L-P9FS --dry-run --verbose

# If transcript found, dry-run first 5:
node scripts/scrapers/georgia-probate-scraper.js \
  --county Liberty --state GA --collection 1999178 \
  --group-id 9SYT-PT5 --dgs "267679901,268032901" \
  --start-image 1 --limit 5 --dry-run --verbose

# Apply first 10:
node scripts/scrapers/georgia-probate-scraper.js \
  --county Liberty --state GA --collection 1999178 \
  --group-id 9SYT-PT5 --dgs "267679901,268032901" \
  --start-image 1 --limit 10 --apply
```

_Last updated: 2026-05-14 (Session 54 — Frontend 429 / Rate-Limit Bug Fix)_

---

## Session 54 — Frontend 429 / Rate-Limit Bug Fix — ✅ DEPLOYED (2026-05-14)

### What Was Done

Fixed three console errors (`429 × 2` + "You do not have permission") caused by the `GET /api/contribute/stats` endpoint being double-limited by the tight `generalLimiter` (100 req / 15 min). All users share the same upstream IP (GitHub Pages → Render reverse proxy), so the budget was regularly exhausted under normal page-load traffic.

### Files Changed

| File | Change |
|------|--------|
| `middleware/rate-limit.js` | Added `statsLimiter` (500 req/15 min, `skipFailedRequests: true`); added `skip: (req) => req.path === '/contribute/stats'` to `generalLimiter` so the two limiters don't stack; exported `statsLimiter` |
| `src/server.js` | Imported `statsLimiter`; registered `app.use('/api/contribute/stats', statsLimiter)` before the contribute router mounts |
| `frontend/src/components/Layout/StatsRibbon.jsx` | Replaced raw `useApi` call with `sessionStorage` cache (`CACHE_KEY='reparations.stats_cache'`, 5-min TTL matching server-side cache). Component reads from cache on remount / React StrictMode double-invocations — at most 1 network call per 5 min per browser session. Private-mode `sessionStorage` failures caught silently. |

### Root Cause Summary

- `app.use('/api', generalLimiter)` applied the 100 req/15 min limit to **all** API routes including stats.
- Since the frontend (GitHub Pages) calls Render from a shared egress IP, all users were counted against a single IP bucket.
- `express-rate-limit` stacks additively — adding a second limiter doesn't replace the first. The fix required both: (a) skip the stats path in `generalLimiter`, and (b) register `statsLimiter` for that path.
- The third console error ("You do not have permission") was Render's infrastructure responding to blocked requests after the rate limit was exhausted.

### Pattern to Remember
- `req.path` inside `app.use('/api', limiter)` is relative to the mount point: `/contribute/stats`, NOT `/api/contribute/stats`.
- Always add `skip` to the general limiter when exempting a path — don't just add a second limiter on top.

---

## Session 53 — Hynson Compilation Tracking + Multi-Doc Pipeline — ✅ DEPLOYED (2026-05-14)

### What Was Done

Full Day 1 of Hynson DC Runaway/Fugitive Slave Case Books intake pipeline. Three files written, M068 applied to Neon, all layers deployed (commit `9d47d0acc`).

#### M068 — `migrations/068-compilation-source-tracking.sql`
- Adds `is_compilation BOOLEAN`, `compiles_from_description TEXT`, `original_location_text TEXT`, `max_evidence_tier TEXT CHECK(IN 'direct_primary','indirect_primary','secondary','inferred')` to `regional_source_registry`
- Adds `original_document_location TEXT`, `verification_status TEXT DEFAULT 'not_applicable' CHECK(IN 'not_applicable','unverified_compilation','original_sought_not_found','original_located','original_verified')` to `enslaver_evidence_compendium`
- Updates Hynson 1848-1863 registry entry: `record_type='court_record'`, `is_compilation=TRUE`, `max_evidence_tier='secondary'`, originals at NARA RG 21
- Inserts new Hynson 1862-1863 registry entry (same flags)
- Updates MSA S1431 + Glover Park History / Carlton Fletcher to `is_compilation=TRUE`
- Inserts `hynson_dc_runaway_fugitive_cases_compilation` methodology row (Tier C, v1.0.0) into `estimation_methodology_registry`
- **Applied to Neon:** 4×ALTER TABLE, 2×UPDATE, 1×INSERT (registry), 1×INSERT (methodology)

#### `src/api/routes/wills.js` — fully rewritten
- File size cap: 25MB → **75MB** (Heritage Books PDFs can be 30-80MB)
- 5 document types: `will`, `case_register`, `deed`, `estate_inventory`, `other`
- S3 prefix routing by docType: `wills/`, `case-registers/`, `deeds/`, `estate-inventories/`, `archival-docs/`
- `person_documents.document_type` uses passed docType (not hardcoded 'will')
- Name resolution + `will_extractions` INSERT: **only for `docType === 'will'`**
- Candidate auto-linking: **only for `docType === 'will'`**
- `nextSteps` for `case_register` returns exact OCR + parse + fanout script commands with `person_documents.id`

#### `frontend/src/components/Intake/SubmitWillPage.jsx` — fully rewritten
- 5-option radio doc-type selector (will / case_register / deed / estate_inventory / other)
- Context-aware fields by type: registers show `documentTitle`, `eraStart`, `eraEnd`, `compiledBy` + **amber Tier C warning box**
- File size display: KB → MB
- Success screen: register type shows "Evidence tier: Tier C (secondary compilation)" + NARA upgrade note
- `result.nextSteps` rendered as `<code>` list

#### Deploy status
| Layer | Status |
|-------|--------|
| Neon DB (M068) | ✅ Applied (4 ALTERs, 2 UPDATEs, 1+1 INSERTs) |
| Backend (Render) | ✅ Auto-deploying from `9d47d0acc` push |
| Frontend (GitHub Pages) | ✅ Published `gh-pages-react` |

### Evidence Tier Architecture (Hynson)
- **Source ceiling**: Hynson 1999 Heritage Books = `max_evidence_tier='secondary'` (Tier C). Cannot be promoted to Tier A/B without locating NARA RG 21 originals.
- **Relationship type**: Always `possessed` (not `owned`) — claimant retained custody claim against enslaved person's movement, not ownership title.
- **verification_status upgrade path**: `unverified_compilation` → `original_located` → `original_verified` (update `enslaver_evidence_compendium.verification_status` when NARA originals are inspected)

### Next Steps — Day 2+ (Hynson pipeline)
1. **Upload Hynson PDFs** at `https://danyelajunebrown.github.io/Reparations-is-a-real-number/contribute/will`
   - Select "Case Register (runaway / fugitive cases)"
   - Fill: Document Title, Era Start, Era End, Compiled By = "Roger D. Hynson"
   - **Copy the `person_documents.id` from the success screen** — needed for Day 2 OCR
2. **Day 2 — OCR**: Generalize `scripts/ocr-hopewell-physical-scans.mjs` → `scripts/ocr-register-document.mjs` (accept `--doc-id`, page-chunked Vision API, write to `person_documents.ocr_text`)
3. **Day 3 — Parse**: `scripts/parse-hynson-case-entries.js` — regex case entry parser (claimant name, enslaved name, date, case outcome)
4. **Day 3 — Fanout**: `scripts/fanout-hynson-cases.js` — writes:
   - `unconfirmed_persons` (enslaved individuals)
   - `slaveholding_relationships` (`relationship_type='possessed'`, not 'owned')
   - `enslaver_evidence_compendium` (`evidence_strength='secondary'`, `verification_status='unverified_compilation'`, `methodology_id` = hynson methodology UUID)
5. **Day 4 — Cross-reference**: Hynson claimants ↔ `civilwardc_petitions` for dual-corroboration (upgrades Tier C → Tier B if matched)

### Still Pending from Session 52
1. Fix Will 3 EPIPE: change `-r 300` → `-r 150` in `ocrDocument()`, re-run `--apply` for Hugh Hopewell V only
2. Fix `test-daa-hopewell.js` Sarah/Such assignment error (audit §4.1)
3. Fix `backfill-inheritance-edges-from-will-extractions.js` 3 schema bugs (audit §4.2)
4. Backfill M063-M067 into `schema_migrations` table (audit §4.3)

---

## Session 52 — Hopewell Physical Scan OCR + Will Ingestion Audit — ✅ COMPLETE (2026-05-12)

### What Was Done

Ran `scripts/ocr-hopewell-physical-scans.mjs --apply` (Run 2, PID 40058) to OCR four St. Mary's County Register of Wills physical PDFs and write all evidence into the DB. APPLY COMPLETE confirmed at 1:37 AM UTC-4.

#### PDFs Processed (Run 2 confirmed)
| Slug | File | Pages | Status |
|------|------|-------|--------|
| james-hopewell-1817 | saint mary's will 1.pdf (11.3MB) | 3 | Classification: CONFIRMED, MEDIUM, 6518 chars |
| composite-1848 | saint mary's will 2.pdf (6.6MB) | 2 | Classification: UNKNOWN, MEDIUM, 6811 chars |
| hugh-hopewell-v-1777 | saint mary's will 3.pdf (23.7MB) | 6 rendered | OCR FAILED — write EPIPE (27MB PNG > 10MB Vision limit) |
| composite-1785 | saint mary's will 4.pdf (9.8MB) | 3 | Classification: UNKNOWN, MEDIUM, 7801 chars |

#### Phase 0 DB Pre-flight Results (live Neon, 2026-05-12 00:46 UTC-4)
- **Q1** — `person_relationships_verified` for cp 1070/140299/141015: 4 rows (ids 1788-1791). Spouse + parent edges confirmed.
- **Q2** — `will_extractions` for doc_id=19: 0 rows before run → INSERT on --apply
- **Q3** — `enslaver_evidence_compendium` cp=1070: 7 rows (person_documents + person_external_ids + 5x debt_acknowledgment_agreements)
- **Q4** — `inheritance_edges` table: EXISTS ✓
- **Q5** — `person_documents.will_extraction_id` column: MISSING ❌ (backfill script will fail)
- **Q6** — Hugh Hopewell canonical_persons (any type): id=193376 "Hugh Hopewell IV" born=1725 died=1777 type=descendant → UPDATE to enslaver
- **Q7** — cp=1070 James Hopewell: EXISTS ✓
- **Q8** — 4 will rows in person_documents (ids 19, 44165, 184161, 184162)
- **Q9** — 17 schema_migrations applied M040-M062; M063-M067 applied to Neon but NOT tracked

#### Phase 1 State Verification (--apply run, correct)
- James↔Angelica spouse edge: ✓ EXISTS
- James→Ann Maria parent edge: ✓ EXISTS
- will_extractions doc_id=19: ✗ MISSING — INSERT
- **Hugh V (GX1Q-ZMD, d.1777): ✓ EXISTS id=193376** (Bug 4 fixed — was falsely matching id=193559 Agnes Hopewell)
- Hugh VI (b.1758, d.1785): ✗ MISSING — INSERT

#### Bugs Fixed in Session 52 (all 5 in script)
1. **Q6 person_type filter** — removed `AND person_type IN ('enslaver',...)`. id=193376 (type=descendant) now returned.
2. **Q9 `migration_id` → `filename`** — schema_migrations uses `filename` column.
3. **Hugh V Phase 4 UPDATE vs INSERT** — `else` branch UPDATEs id=193376 to `person_type='enslaver'` instead of INSERT.
4. **verifyState false match** — id=193559 "Agnes Hopewell" has `mother_fs_id:GX1Q-ZMD` in notes (not a direct match). Fixed to check `"familysearch_id":"GX1Q-ZMD"` exactly → correctly finds id=193376.
5. **`insertUnconfirmedPerson` missing `source_url`** — `unconfirmed_persons.source_url TEXT NOT NULL` violated. Added `source_url` as 10th column/value in both INSERT variants + all 3 call sites.

#### DB Writes — Run 2 Actuals (confirmed 2026-05-12 01:37 UTC-4)
- `will_extractions` UPDATE × 1 — id=`08a21999-7236-4525-b478-78ddbd71831e` (doc=19, cp=1070, Will 1)
- `will_extractions` INSERT × 2 — id=`c40ee851-fd53-4518-9aa2-d0982de5d776` (doc=184163, cp=609495, Will 4); id=`9e6581f2-bf36-4446-8ba3-0f8fc203ab32` (doc=184164, cp=NULL, Will 2)
- `person_documents` INSERT × 2 — id=184163 (Hugh VI, cp=609495); id=184164 (composite 1848, cp=NULL)
- `person_documents` UPDATE × 1 — id=19 (collection metadata only, ocr_text preserved)
- `canonical_persons` INSERT × 1 — cp=609495 "Hugh Hopewell" (Hugh VI, b.1758, d.1785)
- `canonical_persons` UPDATE × 1 — cp=193376 person_type 'descendant' → 'enslaver'
- `person_relationships_verified` INSERT × 2 — id=1796 sibling_of (609495→1070); id=1797 parent_of (193376→609495)
- `unconfirmed_persons` INSERT × 36 — lead_ids 2790306–2790335 (30 × James 1817 enslaved); lead_ids 2790336–2790341 (6 × Burroughes enslaved)
- `enslaver_evidence_compendium` INSERT × 1 — cp=609495, source=will_extractions/`c40ee851-fd53-4518-9aa2-d0982de5d776`
- **Will 3 (Hugh V 1777) — 5 writes NOT performed** (EPIPE; see audit §4.8)

#### New Files (Session 52)
- `scripts/ocr-hopewell-physical-scans.mjs` — 1610-line OCR + DB ingestion script (5 bugs fixed)
- `docs/will-ingestion-audit-2026-05-12.md` — pipeline gap analysis + OCR quality findings + Run 2 confirmed IDs

### Remaining Next Steps (post-commit)
1. Fix Will 3 EPIPE: change `-r 300` → `-r 150` in `ocrDocument()`, re-run `--apply` for Will 3 only
2. Fix `test-daa-hopewell.js` Sarah/Such assignment error (audit §4.1)
3. Fix `backfill-inheritance-edges-from-will-extractions.js` 3 schema bugs (audit §4.2)
4. Backfill M063-M067 into `schema_migrations` table (audit §4.3)

---

## Session 51 — Weaver Family Edges + Full Deploy — COMPLETED (2026-05-11)

### What Was Fixed
1. **Mary Ann Weaver created** — `canonical_persons` id=609494. Washington DC, d.1883. person_type=enslaver, confidence=0.95, verification_status=verified.
2. **Henry Weaver ↔ Mary Ann Weaver spouse edge** — `canonical_family_edges` id=2. tier=1, verified=true, confidence=1.0.
3. **Frontend deployed to GitHub Pages** — `npm run deploy:gh-pages` (push to `gh-pages-react`). Deploy run 25687609071 succeeded.

### API Verification (live)
```
GET /api/contribute/person/196747?table=canonical_persons  (Henry Weaver)
familyMembers.spouse = {"id":609494,"full_name":"Mary Ann Weaver","death_year":1883,"evidence_tier":1,"verified":true}
```

### Commits
- `4e9c8b8cc` — create Mary Ann Weaver (id=609494) + spouse edge to Henry Weaver (id=196747)

---

## Session 50 — Spouse Field Fix + DB Deployment — COMPLETED (2026-05-11)

### What Was Fixed
1. **SPOUSE field showing "—"** — `PersonProfile.jsx` rendered `p.spouse_name` (nonexistent column). Fixed to `spouseFromFamily` from `data.familyMembers.spouse`.
2. **FamilySearch URL filter deployed**
3. **Descendant exclusion deployed**

### DB Changes
- M066 (`canonical_family_edges`) — applied to Neon ✅
- M067 (`inheritance_edges`) — fixed UUID FK types, applied ✅
- Spouse edge: Angelica Chew (141014) ↔ Frisby Freeland Chew I (193163), tier=1, verified=true

### Key DB Schema Facts
- `canonical_persons` does NOT have `spouse_name`. Spouse data via `canonical_family_edges`.
- `will_extractions.id` is UUID (not INTEGER)
- `land_transfer_events` PK is `transfer_id UUID`

### Commits
- `cf68b9b46` — PersonProfile.jsx spouse field + contribute.js 3 fixes + M066/M067 + scripts
- `ed44c5d5b` — fix M067 UUID FK types
- `d3a0a6a9d` — fix backfill script graceful exit for missing column

---

## Critical Schema Facts (always needed)

```
canonical_persons columns:
  id, canonical_name, first_name, middle_name, last_name,
  birth_year_estimate, death_year_estimate,   ← NOT birth_year / death_year
  sex,                                         ← NOT gender
  primary_state, primary_county, primary_plantation,
  person_type, verification_status, confidence_score, notes
  ← NO spouse_name column (use canonical_family_edges)

unconfirmed_persons columns:
  lead_id, full_name, person_type, birth_year, death_year,
  gender, locations (text[]), source_url, source_page_title,
  extraction_method, scraped_at, context_text, confidence_score,
  relationships (JSONB), status, reviewed_by, reviewed_at,
  rejection_reason, confirmed_enslaved_id, confirmed_individual_id,
  duplicate_of_lead_id, created_at, updated_at, source_type,
  review_notes, data_quality_flags
  ← NO branch_name column; branch is in locations[0]
  ← NO docai_data column; enrichment in relationships.docai_fields
  ← NO canonical_person_id; use confirmed_individual_id

// Freedman's Bank Specific Notes:
// - `last_master` IS NULL is NOT a reliable indicator of "always free" until the DocAI URL bug is fixed and all records are reprocessed against the 3:1: film images.
// - ALL Freedman's Bank depositors are legally free at the time of deposit.
// - Lexington, KY records may be stored under "Louisville, KY" in FamilySearch data due to upstream labeling errors.
// - Total entries in FamilySearch data table: 480,597 (includes primary + associated records). Our `unconfirmed_persons` count of 416,136 likely represents primary account holders.

person_relationships_verified columns:
  id, person_id, related_person_id, relationship_type,
  evidence_source_ids (ARRAY), evidence_strength (INT),
  has_conflicts (BOOL), verified_by, verified_at, created_at
  ← NOT person1_id/person2_id

will_extractions columns (M048):
  id (UUID), document_id (INT), canonical_person_id (INT),
  raw_pages_jsonb (JSONB), structured_extraction_jsonb (JSONB),
  extractor_version (TEXT), status (TEXT),
  review_sections_jsonb (JSONB), created_at, updated_at
  ← NO enslaved_persons_count / document_date / document_year columns

enslaver_evidence_compendium columns (M053):
  id (UUID), canonical_person_id (INT), evidence_source_table (TEXT),
  evidence_source_id (TEXT), evidence_strength (TEXT), claim_summary (TEXT),
  methodology_id (UUID), ingested_at (TIMESTAMPTZ), ingested_by (TEXT)
  ← ingested_at/ingested_by NOT created_at/created_by

schema_migrations: uses 'filename' column (NOT migration_id / migration_name)
```

## Key Person IDs
| Person | ID | Notes |
|--------|-----|-------|
| James Hopewell (enslaver, d.1817) | cp=1070 | FamilySearch MTRV-Z72 |
| Angelica Chesley (wife) | cp=140299 | née Chesley; married name Hopewell |
| Ann Maria Biscoe (daughter) | cp=141015 | née Hopewell |
| Hugh Hopewell V (father, d.1777) | cp=193376 | FamilySearch GX1Q-ZMD; was type=descendant, updated to type=enslaver in Session 52 |
| Hugh Hopewell VI (brother, d.1785) | cp=609495 | b.1758, wife Hannah; inserted Session 52; person_documents id=184163; will_extractions id=c40ee851 |
| Henry Weaver | cp=196747 | Washington DC enslaver, d.1847 |
| Mary Ann Weaver | cp=609494 | Henry's wife, d.1883 |
| Angelica Chew | cp=141014 | DC Emancipation petition |
| Frisby Freeland Chew I | cp=193163 | Angelica's husband, enslaver |

## Deployments
- **Backend (Render):** `main` branch → `https://reparations-platform.onrender.com` (auto-deploy on push)
- **Frontend (GitHub Pages):** `gh-pages-react` branch → `https://danyelajunebrown.github.io/Reparations-is-a-real-number/`
  - Deploy: `cd frontend && npm run deploy:gh-pages` (MANUAL — does NOT auto-deploy on push to main)
- **DB (Neon):** pg.Pool directly (`DATABASE_URL`) — NOT Neon serverless HTTP. rowCount works correctly.
- **S3:** `reparations-them` bucket, `us-east-2` region (IAM: `reparations-app` user, missing s3:GetBucketLocation but non-blocking)

## OCR / Probate Pipeline Facts
- **Google Vision DOCUMENT_TEXT_DETECTION** via `pdftoppm -r 300 -png` → base64 → Vision API
- **CONSTRAINT**: Do NOT overwrite `person_documents.ocr_text` for id=19 (FamilySearch transcription is higher quality)
- **person_documents.will_extraction_id** column MISSING — `backfill-inheritance-edges-from-will-extractions.js` will fail
- **WillPipeline.js** does NOT exist — `POST /api/wills/ingest` is a stub
