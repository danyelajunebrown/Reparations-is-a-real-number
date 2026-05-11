# Active Context — Reparations Platform

_Last updated: 2026-05-11 (Session 48 — Pipeline Audit + MAC-MINI-RUNBOOK.md generated)_

## Current Focus: Pipeline State Audit + Mac Mini Runbook — COMPLETED (Session 48)

### What Was Done (Session 48)

Ran a live read-only audit (`scripts/audit-pipeline-state.js`) against Neon DB to get
exact current counts for both active scraping pipelines. Generated `MAC-MINI-RUNBOOK.md`
with all exact commands and real numbers. Established rule: **this MacBook is code+deploy
only — all scraping runs exclusively on Mac Mini.**

#### Live Audit Results (2026-05-11T16:12Z)

**1860 Slave Schedule:**
- `person_documents` has **139,995** rows with `document_type = 'census_slave_schedule'`
  — this IS the scraped 1860 output. S3-backed (162,074/164,973 rows have s3_key).
- 696 rows in `unconfirmed_persons` matched 1860 context filters, but these have garbled
  `locations[1]` values (word fragments like "County", "Dallas", etc.) from an old ML pass
  (`extraction_method = 'ml'`). These are **not additional scraping work** — data cleanup only.
- `person_documents.unconfirmed_person_id` → 1860 join returns 0 rows (FK not linked).
  Real backfill needed after Mac Mini run is confirmed complete.
- **Action:** Run `node check-state-progress.js` on Mac Mini to confirm which states remain;
  then run `bash finish-1860-remaining.sh` for any incomplete states.

**Freedman's Bank DocAI:**
- 416,136 total depositors; only **2,550 enriched (0.61%)** — 413,586 remain.
- 3 branches partially enriched: Washington D.C. (814), Charleston SC (1,247), Richmond VA (489).
- 26 branches at 0% — largest: Augusta GA (45,493), Savannah GA (45,394), Atlanta GA (44,213).
- S3 screenshots: **0 rows** in `person_documents` with `s3_key LIKE 'freedmens-bank/%'`.
  The DocAI enricher writes to `unconfirmed_persons.relationships` JSONB only; a
  `backfill-freedmens-to-person-documents.js` script is needed post-enrichment.
- **Action:** Mac Mini runs all branches per `MAC-MINI-RUNBOOK.md` (finish partials first).

**person_documents overall (164,973 rows):**
| document_type | count |
|---|---|
| census_slave_schedule | 139,995 |
| certificate_of_freedom | 17,876 |
| compensated_emancipation_petition | 4,177 |
| tree_profile | 2,891 |
| freedmens_bank | 2 |

#### New Files (Session 48)
- `scripts/audit-pipeline-state.js` — read-only Neon audit, safe to run anywhere
- `MAC-MINI-RUNBOOK.md` — exact Mac Mini commands for all remaining scraping work

#### Known Issues Discovered
- `parse_failure_queue` does not have a `source_table` column (migration 044 schema mismatch)
- `unconfirmed_persons` 1860 rows have garbled `locations` (ML extraction artifact, not scraper)
- Freedman's Bank `person_documents` link is missing — needs post-enrichment backfill script

---

## Previous Focus: Document Coverage Audit + Remediation — COMPLETED (Session 47)

### What Was Done (Session 47)

Full database survey of `person_documents` (164,973 rows) and all connected tables.
All medium-to-critical gaps identified and fixed. S3 coverage was already strong (98.2%);
the real problem was FK link coverage: large populations of rows were invisible on every
profile page because the API never queried the relevant FK column.

#### Gap 4 — `scripts/audit-document-coverage.js` fix
- `needs_backfill` metric now excludes `tree_profile` and `freedmens_bank` document types
  (intentionally not in S3 — collection-level pages). Real actionable gap: ~8 rows.

#### Gap 2 — `src/api/routes/contribute.js` code fix (enslaved_individual_id path)
- Added query block "2b" in the `enslaved_individuals` profile branch:
  `SELECT ... FROM person_documents pd WHERE pd.enslaved_individual_id = $1`
- Merges results with existing docs, deduplicating by id.
- Surfaces 996 MSA certificate_of_freedom rows that were previously invisible on every
  enslaved person profile because the API only queried `canonical_person_id`.

#### Gap 1 — SQL backfill: 33,804 census rows → canonical_person_id
- `scripts/fix-document-coverage-gaps.js` (new) ran:
  ```sql
  UPDATE person_documents
  SET canonical_person_id = up.confirmed_individual_id::integer
  FROM unconfirmed_persons up
  WHERE person_documents.unconfirmed_person_id = up.lead_id
    AND up.confirmed_individual_id IS NOT NULL
    AND person_documents.canonical_person_id IS NULL
  ```
- `unconfirmed_only` FK bucket: 139,995 → 106,191 (33,804 rows backfilled) ✅

#### Gap 5 — Deleted 27 beyondkin.org stub rows from confirming_documents
- `confirming_documents` had 27 rows pointing to BeyondKin site header image (NOT a document).
- `document_url` has NOT NULL constraint — rows deleted (not nulled).
- Count confirmed 0 after deletion. ✅

#### Gap 3 — 31 true orphan rows documented as "by design"
- Confirmed 31 rows (plantation_record=18, government_disclosure=2, insurance_register=2, etc.)
- These are collection-level reference documents, intentionally not linked to any individual.
- Future: surface as browsable reference collection in UI.

### Post-Fix FK Coverage (verified in production Neon DB)
| Bucket | Count |
|--------|-------|
| Both canonical + enslaved_individual | 16,880 |
| canonical_person_id only | 7,071 |
| enslaved_individual_id only | 996 |
| unconfirmed_person_id only | 106,191 (was 139,995) |
| No FK / true orphans (by design) | 31 |

### New Files
- `scripts/fix-document-coverage-gaps.js` — rerunnable gap-fix script (dry-run supported)
- `scripts/audit-document-coverage.js` — updated needs_backfill metric

### Important: Neon HTTP Driver DML rowCount Quirk
`UPDATE`/`DELETE` via the Neon serverless HTTP driver returns `rowCount: 0` in debug output
even when rows ARE affected. To get accurate affected-row counts, use `RETURNING id` and
check `result.rows.length`. Verify DML success by re-running a SELECT after.

---

## Previous Focus: Public Will Ingestion Pipeline — COMPLETED (Session 46)

_Last updated: 2026-05-08 (Session 46 — Public Will Ingestion Pipeline COMPLETE)_

## Previous Focus: DocAI Enrichment — Washington DC Run (Session 45)

> **Status:** DocAI run was launched but Chrome session required manual FamilySearch login.
> Resume with: `node scripts/enrich-freedmens-docai.js --branch-like "Washington" --limit 500`
> Ensure Chrome at `localhost:9222` is logged into FamilySearch before running.
> If conf=0.00 on all records → session expired again.

## Current Focus: Public Will Ingestion Pipeline — COMPLETED (Session 46)

### What Was Done (Session 46)

The will/document ingestion feature was moved from behind the admin password wall to the
public-facing frontend. End-to-end pipeline verified: upload → S3 → DB → profile page.

#### Migration 065 — APPLIED TO NEON
File: `migrations/065-person-documents-filename-columns.sql`
Added columns to `person_documents`:
- `filename TEXT`, `file_size BIGINT`, `mime_type TEXT`, `s3_url TEXT`
- Index on `s3_url`

#### Backend — `src/api/routes/wills.js`
Fixed the INSERT to include all required fields:
- Added `filename`, `file_size`, `mime_type`, `s3_url` to column list
- Added `name_as_appears` (NOT NULL, no default) — uses `testatorName || file.originalname` fallback
- Removed duplicate `document_type` column that caused a DB error
- Route is mounted with NO auth middleware → fully public

#### No Frontend Changes Needed
- `frontend/src/components/Intake/SubmitWillPage.jsx` already existed as a public form
- `frontend/src/App.jsx` already had public route `/contribute/will`
- "Contribute" nav link already present — no auth guard

#### Henry Weaver Will — Manually Backfilled
Real will PDF: `wills/henry-weaver/Henry Weaver 1893.pdf` → `person_documents` id=44165
```sql
UPDATE person_documents
SET canonical_person_id = 196747
WHERE s3_key LIKE 'wills/henry-weaver/%' AND canonical_person_id IS NULL;
-- Linked 3 rows; test duplicates (ids 44163, 44164) then deleted
```

#### Verified Final State via API
```
GET /api/contribute/person/196747?table=canonical_persons
ownerDocuments: 4
  id=5871 type=compensated_emancipation_petition — DC Emancipation Petition (p.001)
  id=5872 type=compensated_emancipation_petition — DC Emancipation Petition (p.002)
  id=5873 type=compensated_emancipation_petition — DC Emancipation Petition (p.003)
  id=44165 type=will — Will of Henry Weaver (1847) — Washington DC
documentCollections: 2
  key=cww.00786  DC Emancipation Petition  3 pages
  key=None       Will of Henry Weaver      1 page
```

#### GitHub Issue Filed
Issue #50: https://github.com/danyelajunebrown/Reparations-is-a-real-number/issues/50
Documents what's built and what's next (OCR pipeline, auto-link by name, status tracking page).

#### Known Gap — Future Work (Issue #50)
- `canonicalPersonId` must be passed manually in the form OR looked up by name in `wills.js`
  (currently uploads have `canonical_person_id = NULL` until manually backfilled)
- Build `src/services/probate/WillPipeline.js` — Google Vision OCR → structured extraction → fanout
- Add `/contribute/status/:extractionId` tracking page
- Add name-based auto-lookup: match `testatorName` → `canonical_persons.canonical_name`

---

## Previous Focus: DocAI Enrichment — Washington DC Run (Session 45)

### Freedmen's Bank Integration Audit Results

**416,136 depositors** exist in `unconfirmed_persons` with `extraction_method = 'freedmens_bank_index'`.

| Metric | Count |
|--------|-------|
| Total depositors | 416,136 |
| Status = 'pending' (all of them) | 416,136 |
| With `confirmed_individual_id` set (linked to canonical) | 89,459 |
| Marked as duplicates (`duplicate_of_lead_id` set) | **0** |
| person_documents with freedmens-bank S3 key | **0** |
| canonical_persons with "freedmen" in notes | 78,212 |

**Key finding:** 89,459 depositors have been linked to `canonical_persons` via `confirmed_individual_id`,
but ALL remain status='pending' and ZERO have been deduplicated. ZERO ledger page screenshots exist
in `person_documents` — the DocAI enrichment has never been run on this machine or the Mac Mini.

The user had anticipated: "i would anticipate that a good deal of those persons should have been
deduplicated and if that hasn't happened pending the doc ai enrichment we should just go ahead
and run that script on this computer."  → Confirmed: deduplication hasn't happened; DocAI launched.

### DocAI Enrichment Launch (Session 45)

**Dry-run verified:** 3 records processed, 0 nav errors, screenshots captured (116KB, 116KB, 52KB).
Chrome 147 is running on port 9222.

**First live attempt (PID 92727):** Chrome was on `accounts.google.com` Google sign-in page.
All 4 records processed got conf=0.00 because DocAI was seeing login-page screenshots, not ledgers.
→ Immediately killed. 4 contaminated records (Maria Louisa, Thomas Ball, Hannah Carr, Betsey) cleaned:
  - `review_notes` docai_enrichment tag removed
  - `relationships.docai_fields` removed

**FamilySearch session requirement:** Chrome at `localhost:9222` must be logged into FamilySearch.
After user logs in manually, re-run:
```bash
# In a terminal (foreground so you can see progress):
cd /Users/danyelabrown/Desktop/danyelajunebrown\ GITHUB/Reparations-is-a-real-number-main
node scripts/enrich-freedmens-docai.js --branch-like "Washington" --limit 500

# Or background with log:
nohup node scripts/enrich-freedmens-docai.js --branch-like "Washington" --limit 500 \
  > /tmp/freedmens-docai-washington.log 2>&1 &
```

**After Washington DC completes, expand to:**
```bash
node scripts/enrich-freedmens-docai.js --branch-like "Richmond" --limit 500
node scripts/enrich-freedmens-docai.js --branch-like "Charleston" --limit 500
node scripts/enrich-freedmens-docai.js --branch-like "New Orleans" --limit 500
node scripts/enrich-freedmens-docai.js --branch-like "Memphis" --limit 500
```

**What to watch for in logs (healthy run):**
- `conf=0.XX` where XX > 0.00 — DocAI is reading actual ledger content
- `last_master="..."` appearing in the output — critical fields being extracted
- FP warnings are normal and expected (validator cleaning bad OCR)
- If ALL records show `conf=0.00 (no critical fields)` → session has expired again

**Note on `DOCUMENT_AI_FREEDMENS_PROCESSOR_ID`:** The .env has two processor IDs:
- `DOCUMENT_AI_PROCESSOR_ID` — used by `enrich-freedmens-docai.js`
- `DOCUMENT_AI_FREEDMENS_PROCESSOR_ID` — may be a dedicated Freedmen's processor
If results are all conf=0.00 even with a good session, try overriding:
```bash
DOCUMENT_AI_PROCESSOR_ID=$DOCUMENT_AI_FREEDMENS_PROCESSOR_ID \
  node scripts/enrich-freedmens-docai.js --dry-run --limit 3
```

### Deduplication Next Steps

After DocAI enrichment populates `relationships.docai_fields.last_master` etc., run:
```bash
node scripts/crossref-freedmens-to-canonical.mjs   # cross-reference with canonical enslaver names
node scripts/crossref-freedmens-enslavers.js        # enslaver crossref
```

Then promote well-linked depositors by setting `status = 'confirmed'` and using confirmed IDs.

---

## Previous Focus: Document Collection Grouping + Presigned URL Fix (Session 44) — COMPLETED

### What Was Done (Session 44)

Multi-page primary source documents (e.g., Ann Maria Biscoe's 12-page DC Emancipation Petition)
were showing as anonymous flat pages with no grouping. Fixed end-to-end:

#### Migration 064 — APPLIED TO NEON (backfill also complete)
Added columns to `person_documents`:
- `collection_name TEXT`, `collection_key TEXT`, `collection_page_number INTEGER`
- `collection_page_count INTEGER`, `source_type_label TEXT`

**Backfill result:** 17,876 rows received correct `collection_page_count`; 24,974/24,975 rows (100%)
have `collection_name` populated. 22,053 rows are part of multi-page collections.

#### Backend — `src/api/routes/contribute.js`
1. **500 error fix (CRITICAL):** `let documentCollections = []` was inside `if (person_type === 'slaveholder')` block but referenced outside. Moved to outer scope.
2. **Collection UNION query** + inline grouping → `documentCollections` array in response.

#### Backend — `src/api/routes/documents.js`
New `GET /api/documents/person-doc/:pdId/access` endpoint — presigns S3 key from `person_documents`.

#### Frontend — `frontend/src/api/client.js`
`getPersonDocAccess: (pdId, signal) => ...`

#### Frontend — `frontend/src/components/DocumentViewer/DocumentViewer.jsx`
`DocCollectionOverlay` — multi-page viewer, per-page presigned URL via `useEffect`, keyboard nav.

#### Frontend — `frontend/src/components/PersonModal/PersonProfile.jsx`
Collection cards + `viewCollection` state + `DocCollectionOverlay` mounted.

### Commit + Deployment (Session 44/45)
- Commit: `dcddc2f4e` — "feat: document collection grouping + presigned URL endpoint" (9 files, 1136 insertions)
- Backend pushed to `main` → Render auto-deploy triggered
- Frontend built (779 modules, 1.96s) + published to `gh-pages-react`

---

## Previous Focus: Person Modal Data Disconnections — COMPLETED (Session 43)

(See prior session entries for full details.)

### Actual schema notes (IMPORTANT for future code)
```
canonical_persons:
  id, canonical_name, first_name, middle_name, last_name,
  birth_year_estimate, death_year_estimate,   ← NOT birth_year / death_year
  sex,                                         ← NOT gender
  primary_state, primary_county, primary_plantation,
  person_type, verification_status, confidence_score, notes

unconfirmed_persons columns (confirmed Session 45):
  lead_id, full_name, person_type, birth_year, death_year,
  gender, locations (text[]), source_url, source_page_title,
  extraction_method, scraped_at, context_text, confidence_score,
  relationships (JSONB), status, reviewed_by, reviewed_at,
  rejection_reason, confirmed_enslaved_id, confirmed_individual_id,
  duplicate_of_lead_id, created_at, updated_at, source_type,
  review_notes, data_quality_flags
  ← NOTE: NO branch_name column; branch is in locations[0]
  ← NOTE: NO docai_data column; enrichment goes in relationships.docai_fields
  ← NOTE: NO canonical_person_id; use confirmed_individual_id
```

## Key API Routes
- `GET /api/contribute/person/:id?table=enslaved_individuals` — full person profile
- `GET /api/contribute/person/:id?table=canonical_persons` — slaveholder profile
- `GET /api/contribute/search/:query` — cross-table search
- `GET /api/contribute/stats` — platform stats (cached 5min)
- `GET /api/documents/person-doc/:pdId/access` — NEW presigned URL for person_documents row

## Deployments
- **Backend (Render):** `main` branch at `https://reparations-platform.onrender.com`
- **Frontend (GitHub Pages):** `gh-pages-react` branch
  - URL: `https://danyelajunebrown.github.io/Reparations-is-a-real-number/`
  - Deploy: `cd frontend && npm run deploy:gh-pages`
- **DB (Neon):** serverless HTTP via `@neondatabase/serverless`
- **S3:** `reparations-them` bucket, `us-east-2` region (NOT public — always presign)
