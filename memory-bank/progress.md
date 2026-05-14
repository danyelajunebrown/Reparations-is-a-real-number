# Development Progress: Reparations Is A Real Number

**Project Start:** 2024
**Current Phase:** Hynson DC case book pipeline Day 1 deployed. M068 compilation tracking live. Frontend 429 rate-limit bug fixed. Awaiting Hynson PDF uploads, then Day 2 OCR.
**Last Updated:** May 14, 2026 (Session 54 — Frontend bug fix)

---

## Session 54 — Frontend 429 / Rate-Limit Bug Fix (May 14, 2026) ✅ COMPLETE

### What Was Done

Fixed three console errors caused by `GET /api/contribute/stats` being rate-limited by the global `generalLimiter` (100 req / 15 min). All GitHub Pages → Render traffic shares the same egress IP, so the limit was regularly exhausted.

### Files Changed

| File | Change |
|------|--------|
| `middleware/rate-limit.js` | Added `statsLimiter` (500 req/15 min, `skipFailedRequests: true`); added `skip: (req) => req.path === '/contribute/stats'` to `generalLimiter`; exported `statsLimiter` |
| `src/server.js` | Imported `statsLimiter`; registered `app.use('/api/contribute/stats', statsLimiter)` before the contribute router |
| `frontend/src/components/Layout/StatsRibbon.jsx` | Replaced raw `useApi` with `sessionStorage` cache (5-min TTL, key `reparations.stats_cache`). At most 1 network call per 5 min per browser session. |

### Key Lesson
`express-rate-limit` stacks additively — adding a second limiter does NOT replace the first. Must add `skip` to the general limiter AND register the path-specific limiter separately. `req.path` inside `app.use('/api', limiter)` is relative to the mount: `/contribute/stats` not `/api/contribute/stats`.

---

## Session 53 — Hynson Compilation Tracking + Multi-Doc Pipeline (May 14, 2026) ✅ DEPLOYED

### What Was Done

Day 1 of the Hynson DC Runaway/Fugitive Slave Case Books intake pipeline. Infrastructure layer complete; PDF upload + OCR + fanout scripts are Day 2–3.

### Migrations Applied
| Migration | Tables Affected | Result |
|-----------|----------------|--------|
| M068 `068-compilation-source-tracking.sql` | `regional_source_registry` (+4 cols), `enslaver_evidence_compendium` (+2 cols), `estimation_methodology_registry` (INSERT) | ✅ Applied to Neon |

### Key Schema Additions (M068)
- `regional_source_registry.is_compilation BOOLEAN` — flags compiled/transcribed sources
- `regional_source_registry.max_evidence_tier TEXT` — ceiling on evidence strength from this source
- `enslaver_evidence_compendium.verification_status TEXT` — tracks upgrade path: `unverified_compilation` → `original_located` → `original_verified`
- Hynson 1848-1863 + 1862-1863: both registered as `is_compilation=TRUE`, `max_evidence_tier='secondary'`, `record_type='court_record'`
- New methodology: `hynson_dc_runaway_fugitive_cases_compilation` (Tier C, v1.0.0, `relationship_type='possessed'`)

### Code Changes Deployed
| File | Change | Commit |
|------|--------|--------|
| `src/api/routes/wills.js` | 75MB cap, 5 doc types, S3 prefix routing, type-aware nextSteps | `9d47d0acc` |
| `frontend/src/components/Intake/SubmitWillPage.jsx` | Radio doc-type selector, register fields, Tier C amber warning | `9d47d0acc` |

### Pending (Day 2–4)
- [ ] Upload Hynson PDFs at `/contribute/will` → select "Case Register" → note `person_documents.id`
- [ ] Day 2: `scripts/ocr-register-document.mjs` — generalize Hopewell OCR script for any register
- [ ] Day 3: `scripts/parse-hynson-case-entries.js` — parse claimant/enslaved/date/outcome
- [ ] Day 3: `scripts/fanout-hynson-cases.js` — write `unconfirmed_persons` + `slaveholding_relationships` (type=possessed) + `enslaver_evidence_compendium` (strength=secondary)
- [ ] Day 4: Cross-reference claimants vs `civilwardc_petitions` (Tier C → Tier B upgrade)

---

## Session 52 — Hopewell Physical Scan OCR + Will Ingestion Audit (May 12, 2026) ✅ COMPLETE

### What Was Done

Ran `scripts/ocr-hopewell-physical-scans.mjs --apply` (1610 lines) to OCR all 4 St. Mary's County Register of Wills physical PDFs via Google Vision DOCUMENT_TEXT_DETECTION and write full evidence graph into Neon DB.

### DB Changes Made

| Table | Operation | Detail |
|-------|-----------|--------|
| `will_extractions` | INSERT ×3 + UPDATE ×1 | Doc 1 id=08a21999 (UPDATE), Doc 2 (INSERT), Doc 4 (INSERT). Doc 3 SKIPPED — OCR FAILED |
| `person_documents` | INSERT ×2 | Doc 2 and Doc 4 (Doc 1 id=19 UPDATE only; Doc 3 SKIPPED — OCR FAILED) |
| `person_documents` id=19 | UPDATE | collection metadata only; ocr_text NOT touched |
| `canonical_persons` | INSERT ×1 | Hugh Hopewell VI, b.1758 d.1785, type=enslaver |
| `canonical_persons` id=193376 | UPDATE | person_type: 'descendant' → 'enslaver' (Hugh V, confirmed by 1777 will) |
| `person_relationships_verified` | INSERT | Hugh V→James, Hugh VI↔James (sibling), Hugh V→Hugh VI (parent), others |
| `unconfirmed_persons` | INSERT ≤38 | 30 enslaved (James 1817) + 2 (Jacob/Haney) + 6 (Barbara Burroughes) |
| `enslaver_evidence_compendium` | INSERT ×2 | cp=Hugh V, cp=Hugh VI |

### OCR Quality Summary
| Doc | Classification | Quality | Notes |
|-----|---------------|---------|-------|
| James Hopewell 1817 (Will 1) | CONFIRMED | MEDIUM | 30 enslaved persons extracted |
| Composite 1848 (Will 2) | UNKNOWN | MEDIUM | "יזי" artifact on p.1; composite non-ancestor |
| Hugh V 1777 (Will 3) | **OCR FAILED (EPIPE)** | N/A | 27MB PNGs exceed Vision API 10MB inline limit. 0 chars. person_documents/will_extractions NOT written. See §4.8 |
| Composite 1785 (Will 4) | UNKNOWN | MEDIUM | 7,800 chars, 3 pages. First lines: "se har lay out" / "(10)" / "Bognorth." |

### New Files
- `scripts/ocr-hopewell-physical-scans.mjs` — OCR + DB ingestion script (1610 lines)
- `docs/will-ingestion-audit-2026-05-12.md` — full pipeline audit (§1 gap analysis, §2 OCR quality, §3 readiness, §4 known debt)

### Key Bugs Fixed (all in the script)
1. Q6 person_type filter removed — id=193376 (type=descendant) now correctly returned
2. Q9 `migration_id` → `filename` — schema_migrations column name corrected
3. Hugh V Phase 4 UPDATE vs INSERT — id=193376 updated, not duplicated
4. verifyState false match — Agnes Hopewell (id=193559) notes have `mother_fs_id:GX1Q-ZMD`; fixed to match `"familysearch_id":"GX1Q-ZMD"` exactly
5. `insertUnconfirmedPerson` missing `source_url` — `unconfirmed_persons.source_url TEXT NOT NULL` violated; added to INSERT + all 3 call sites

### Known Debt (from audit doc)
1. **HIGH**: `test-daa-hopewell.js` assigns Sarah to Ann Maria Biscoe — WRONG. Sarah is Joe's wife → Angelica. Such → Ann Maria.
2. **HIGH**: `backfill-inheritance-edges-from-will-extractions.js` — 3 schema bugs: (a) `pd.will_extraction_id` missing, (b) `we.enslaved_persons_count` missing from M048, (c) `heir_id NOT NULL` vs null heir
3. **HIGH**: Will 3 (Hugh V 1777) OCR FAILED — EPIPE, 27MB PNG > Vision API 10MB inline limit. Fix: lower DPI to 150 in `ocrDocument()`. 5 DB writes outstanding (person_documents, will_extractions, 2 relationships, Jacob+Haney unconfirmed, enslaver_evidence).
4. **MEDIUM**: M063-M067 applied to Neon but NOT tracked in `schema_migrations`
5. **LOW**: S3 IAM missing `s3:GetBucketLocation` (non-blocking)
6. **LOW**: `person_documents` id=19 `title` column is NULL

### Next Steps
1. Fix Will 3 EPIPE: change `-r 300` → `-r 150` in `ocrDocument()`, re-run `--apply` for Will 3 only
2. Fix `test-daa-hopewell.js` Sarah/Such assignment error
3. Fix `backfill-inheritance-edges-from-will-extractions.js` 3 schema bugs
4. Backfill M063-M067 into `schema_migrations`

---

## Session 51 — Weaver Family Edges + Full Deploy (May 11, 2026) ✅ COMPLETE

### What Was Done
- Created `canonical_persons` id=609494 (Mary Ann Weaver, d.1883, type=enslaver)
- Inserted `canonical_family_edges` id=2: Henry Weaver (196747) ↔ Mary Ann Weaver (609494), tier=1, verified=true
- Deployed frontend to GitHub Pages (`npm run deploy:gh-pages` — MANUAL step confirmed)
- Commits: `4e9c8b8cc`

---


---

## Session 49 — Family Edges Audit + Ancestor Climb Contamination Fixes (May 11, 2026) ✅ COMPLETE

### What Was Asked
Family/genealogy data not connected to profiles. Could not navigate from Henry Weaver → Mary Ann Weaver. Descendants appearing in search. FS profile URLs shown as primary source documents. Need family edges audit + inheritance edges audit.

### Root Cause Analysis

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| 1 – Family nav broken for canonical_persons | `getPerson` only queried `enslaved_individuals` array columns for family; canonical_persons branch returned empty `familyMembers` always | Added `else if (tableSource === 'canonical_persons')` block querying `canonical_family_edges` (M066) |
| 2 – Descendants in public search | `canonical_persons` WHERE clause only excluded `merged`; `descendant`/`modern_person` rows from ancestor_climb_sessions leaked through | Added `AND person_type NOT IN ('descendant', 'modern_person', 'participant', 'merged')` to both search endpoints |
| 3 – FS profile URLs as primary docs | `person_documents` query had no filter for FS/WikiTree-URL-only rows (`s3_key IS NULL`) written by climb pipeline | Added `AND NOT (pd.s3_key IS NULL AND source_url ILIKE '%familysearch.org%'...)` to both UNION sides |
| 4 – No inheritance_edges table | Table didn't exist; will_extractions data not linked to wealth transmission graph | Created M067, backfill script written |

### New Files

| File | Purpose |
|------|---------|
| `migrations/066-canonical-family-edges.sql` | Navigable family relationship graph for canonical_persons (spouse/parent_of/child_of/sibling_of, evidence_tier 1-3) |
| `migrations/067-inheritance-edges.sql` | Documentary wealth transmission: testator → heir per will/deed, feeds enslaver_lineage_ledger |
| `scripts/audit-family-edges.js` | Read-only diagnostic — all 4 bug classes + Weaver/Biscoe family checks |
| `scripts/backfill-family-edges-from-spouse-names.js` | Reads canonical_persons.spouse_name, name-resolves to canonical ID, writes tier-3 edges |
| `scripts/backfill-inheritance-edges-from-will-extractions.js` | Reads will_extractions, extracts bequests from structured_extraction_jsonb, writes inheritance_edges |
| `scripts/audit-climb-contamination.js` | Full contamination report: descendant types, FS URL docs, proposed remediation SQL, --fix-descendants flag |

### Files Changed

| File | Change |
|------|--------|
| `src/api/routes/contribute.js` | Fix 1: FS URL filter in person_documents query; Fix 2: canonical_family_edges block; Fix 3: descendant exclusion in both search endpoints |

### Next Steps to Run

```bash
# 1. Apply migrations to Neon DB (run on Mac Mini or this MacBook)
psql $DATABASE_URL -f migrations/066-canonical-family-edges.sql
psql $DATABASE_URL -f migrations/067-inheritance-edges.sql

# 2. Audit current state
node scripts/audit-family-edges.js
node scripts/audit-climb-contamination.js

# 3. Backfill family edges from existing spouse_name text
node scripts/backfill-family-edges-from-spouse-names.js --dry-run
node scripts/backfill-family-edges-from-spouse-names.js

# 4. Backfill inheritance edges from will extractions
node scripts/backfill-inheritance-edges-from-will-extractions.js --dry-run
node scripts/backfill-inheritance-edges-from-will-extractions.js

# 5. Clean up FS/WikiTree profile URL rows from person_documents
#    (review audit-climb-contamination output first, then apply):
node scripts/audit-climb-contamination.js --fix-descendants
```

---

**Previous phase (Session 48):**

---

## Session 48 — Pipeline State Audit + Mac Mini Runbook (May 11, 2026) ✅ COMPLETE

### What Was Asked
Clean up the process, verify what data exists, understand remaining work. All future scraping on Mac Mini only.

### New Files
| File | Purpose |
|------|---------|
| `scripts/audit-pipeline-state.js` | Read-only Neon audit — 1860 counts, DocAI enrichment %, person_documents S3 coverage |
| `MAC-MINI-RUNBOOK.md` | Exact Mac Mini commands for all remaining scraping work, with real row counts |

### Verified Data State (2026-05-11T16:12Z)

**1860 Slave Schedule:**
| Metric | Count |
|--------|-------|
| person_documents (census_slave_schedule) | **139,995** |
| person_documents with s3_key | 139,995 (all backed) |
| unconfirmed_persons 1860 rows (garbled ML artifacts) | 696 (not actionable — cleanup only) |
| person_documents joined via unconfirmed_person_id | 0 (backfill needed post-Mac Mini confirmation) |

**Freedman's Bank DocAI:**
| Metric | Count |
|--------|-------|
| Total depositors | **416,136** |
| Enriched | **2,550** (0.61%) |
| Remaining | **413,586** |
| Branches with partial work | 3 (DC 814, Charleston 1247, Richmond 489) |
| Branches at 0% | 26 |
| S3 screenshots in person_documents | **0** |

### Key Decisions
- **MacBook = code + deploy only.** No scraping here.
- `MAC-MINI-RUNBOOK.md` is the single source of truth for what to run on Mac Mini.
- `scripts/audit-pipeline-state.js` is safe to run anywhere — re-run after each Mac Mini branch to track progress.

### Known Issues Found
- `parse_failure_queue` has no `source_table` column (migration 044 schema mismatch)
- 696 `unconfirmed_persons` rows have garbled `locations[1]` from old ML pass — data cleanup, not scraping
- Freedman's Bank has 0 `person_documents` rows — enricher only writes to `relationships` JSONB; need `backfill-freedmens-to-person-documents.js` post-enrichment

---

## Session 47 — Document Coverage Survey + Gap Remediation (May 11, 2026) ✅ COMPLETE

### What Was Asked
1. Survey the entire database for S3 document inconsistencies and inaccessible person profiles.
2. Complete all medium-to-critical priority gaps found in the survey.

### Survey Results — 5 Gaps Identified

| Gap | Description | Severity | Action |
|-----|-------------|----------|--------|
| 1 | `unconfirmed_persons` confirmed to a canonical person but `person_documents` still points only to `unconfirmed_person_id` — canonical profile shows no docs | High | SQL UPDATE with `::integer` cast; 33,804 rows backfilled |
| 2 | MSA SC 2908 certificates of freedom (17,876 rows) stored via `enslaved_individual_id` FK only — enslaved person profiles showed no docs | High | New query block 2b added to `contribute.js` — dedup-merged into `documents[]` |
| 3 | Orphan `person_documents` rows where both `canonical_person_id` AND `unconfirmed_person_id` are NULL (enslaved_individual_id only) | Low/Design | Documented as "by design" — MSA certs link via enslaved_individual_id, not person |
| 4 | `audit-document-coverage.js` reported 2,899 "needs_backfill" rows — audit script was counting `tree_profile` and `freedmens_bank` types which are intentionally URL-only | Medium | Fixed audit script: added `AND document_type NOT IN ('tree_profile','freedmens_bank')` — real gap = ~8 rows |
| 5 | 27 stale `confirming_documents` rows with `document_url ILIKE '%beyondkin%'` — Beyond Kin shut down; dead links | Medium | Deleted via `DELETE … RETURNING id` |

### Post-Fix FK Coverage (person_documents)

| FK Bucket | Before | After |
|-----------|--------|-------|
| `canonical_person_id` set | baseline | +33,804 rows promoted |
| `unconfirmed_only` (no canonical_id) | 139,995 | 106,191 |
| Real actionable backfill gap | ~2,899 (inflated) | ~8 rows |
| Dead beyondkin links | 27 | 0 (deleted) |

### Files Changed (Session 47)

| File | Change |
|------|--------|
| `scripts/audit-document-coverage.js` | Fixed `needs_backfill` metric — excludes `tree_profile` and `freedmens_bank` |
| `src/api/routes/contribute.js` | Added query block 2b: `person_documents` via `enslaved_individual_id` for enslaved person profiles |
| `scripts/fix-document-coverage-gaps.js` | NEW — rerunnable script with `--dry-run` for Gaps 1, 3, and 5 |

### Key Technical Notes

**Neon HTTP driver DML quirk (permanent note):**
`rowCount` always reports 0 for UPDATE/DELETE via `@neondatabase/serverless` HTTP adapter.
Use `RETURNING id` + `result.rows.length` for accurate affected-row counts.
Confirmed: `unconfirmed_only` bucket dropped 139,995→106,191 (33,804 rows updated) despite `rowCount=0`.

**Type mismatch resolved:**
`unconfirmed_persons.confirmed_individual_id` is `VARCHAR` — requires `::integer` cast when writing to `person_documents.canonical_person_id` (integer).

---

## Session 45 — Freedmen's Bank Integration Audit + DocAI Enrichment (May 8, 2026) 🔄 IN PROGRESS

### What Was Asked
1. Analyze how well Freedmen's Bank depositors are integrated across the system.
2. Run `scripts/enrich-freedmens-docai.js` on this machine while 1860 scrape runs on Mac Mini.

### Findings (Freedmen's Bank Integration Audit)

| Metric | Count |
|--------|-------|
| Total depositors in `unconfirmed_persons` | 416,136 |
| All status = 'pending' | 416,136 |
| With `confirmed_individual_id` set | 89,459 |
| Marked as duplicates | **0** — deduplication has NOT been run |
| person_documents with freedmens-bank S3 key | **0** — DocAI has never run |
| canonical_persons with "freedmen" in notes | 78,212 |

### Actions Taken (Session 45)
- Backfill applied: `node scripts/backfill-document-collections.js --apply`
  - 17,876 rows received correct `collection_page_count`; 100% `collection_name` coverage
- DocAI dry-run verified (3 records, 0 nav errors, 116KB/116KB/52KB screenshots)
- First live attempt (PID 92727): Chrome was on Google sign-in page → conf=0.00 on all records
  → Killed immediately; 4 contaminated records cleaned (review_notes + relationships.docai_fields)
- Backend deployed: commit `dcddc2f4e` pushed to main → Render auto-deploy
- Frontend deployed: published to `gh-pages-react`
- **Washington DC live run started (PID 94253)** — 2:05 PM May 8, 2026
  - FamilySearch session verified active: tab on `familysearch.org/en/tree/pedigree/portrait/G21N-HD2`
  - Screenshots 288-300 KB (real ledger content)
  - conf=0.95-1.00 across all records processed ✅
  - Data writing correctly to `unconfirmed_persons.relationships` as array with `docai_fields` object
  - "(no critical fields)" on DC records is historically expected — large free Black population in DC pre-war
  - Log: `/tmp/freedmens-docai-washington.log`

### DB Data Structure (confirmed live)
`relationships` column is a JSONB **array**:
```json
[
  { "docai_fields": {} },   ← old contaminated run (cleaned, empty)
  { "docai_fields": {       ← current live enrichment
    "residence": "District of Columbia, United States",
    "account_number": "10",
    "depositor_name": "Maria Louisa",
    "residence_confidence": 1,
    "account_number_confidence": 1,
    "depositor_name_confidence": 0.96
  }}
]
```
Query pattern: use `relationships->1->'docai_fields'` or unnest/array indexing.

### Pending
- Washington DC run: ~500 records, ~70-80 min total, running in background (PID 94253)
- After DC completes:
  ```bash
  nohup node scripts/enrich-freedmens-docai.js --branch-like "Richmond" --limit 500 > /tmp/freedmens-docai-richmond.log 2>&1 &
  nohup node scripts/enrich-freedmens-docai.js --branch-like "Charleston" --limit 500 > /tmp/freedmens-docai-charleston.log 2>&1 &
  nohup node scripts/enrich-freedmens-docai.js --branch-like "New Orleans" --limit 500 > /tmp/freedmens-docai-neworleans.log 2>&1 &
  nohup node scripts/enrich-freedmens-docai.js --branch-like "Memphis" --limit 500 > /tmp/freedmens-docai-memphis.log 2>&1 &
  ```
- Richmond/Charleston/Memphis expected to have more `last_master` fields (enslaved communities)
- After batches complete: run `crossref-freedmens-to-canonical.mjs` for deduplication

### Monitor command
```bash
tail -20 /tmp/freedmens-docai-washington.log
grep -c "conf=" /tmp/freedmens-docai-washington.log   # records processed so far
```

---

## Session 44 — Document Collection Grouping + S3 Presigned URL Fix (May 8, 2026) ✅ COMPLETE

### What Was Asked
1. Ann Maria Biscoe's profile shows anonymous pages with no grouping — pages from the same physical source document should be grouped into a collection viewer.
2. 500 errors on all person searches (broken depositors page + all person profiles).
3. S3 "no permission" error on document images — bucket not public.
4. Apply collection grouping across all primary source types.

### Root Causes Found
1. **500 errors:** `let documentCollections = []` was scoped inside `if (person.person_type === 'slaveholder')` block but referenced in `res.json()` outside it. For enslaved/unconfirmed persons → `ReferenceError` → 500. Fixed by moving to outer scope.
2. **S3 no-permission:** `DocCollectionOverlay` was using `page.s3_url` directly — raw S3 URL without presigning. Bucket requires presigned URLs.

### Delivered

**Migration 064 applied to Neon** — 5 new columns on `person_documents`:
- `collection_name`, `collection_key`, `collection_page_number`, `collection_page_count`, `source_type_label`

**Backend (`src/api/routes/contribute.js`):**
- Moved `documentCollections = []` to outer scope (500 fix)
- Collection-expanded UNION query fetches all pages in the same collection
- Inline grouping builds `documentCollections` array: `{ collection_key, collection_name, source_type_label, doc_type, page_count, pages[] }`
- `documentCollections` added to `res.json()` response

**New backend endpoint (`src/api/routes/documents.js`):**
- `GET /api/documents/person-doc/:pdId/access`
- Queries `person_documents.s3_key` by id, generates presigned URL via `S3Service.getViewUrl`
- Falls back to `source_url` for external links
- Returns `{ viewUrl, downloadUrl, filename, presigned }`

**Frontend (`frontend/src/api/client.js`):**
- `getPersonDocAccess: (pdId, signal) => request('/api/documents/person-doc/${pdId}/access', { signal })`

**Frontend (`frontend/src/components/DocumentViewer/DocumentViewer.jsx`):**
- New `DocCollectionOverlay` export: fullscreen multi-page viewer
- Per-page presigned URL via `useEffect` + `AbortController` + `api.getPersonDocAccess`
- Loading state while presigning, keyboard ←/→ navigation, Escape to close

**Frontend (`frontend/src/components/PersonModal/PersonProfile.jsx`):**
- Collection cards replacing flat document list
- `viewCollection` state + `DocCollectionOverlay` mounted at bottom

**New script (`scripts/backfill-document-collections.js`):**
- Backfills `collection_key`, `collection_name`, `collection_page_number`, etc. for all existing `person_documents` rows by pattern-matching S3 keys

### Files Changed (Session 44)
| File | Change |
|------|--------|
| `migrations/064-person-documents-collection-grouping.sql` | NEW |
| `scripts/backfill-document-collections.js` | NEW |
| `src/api/routes/contribute.js` | 500 fix + collection grouping |
| `src/api/routes/documents.js` | New `/person-doc/:pdId/access` endpoint |
| `frontend/src/api/client.js` | `getPersonDocAccess` added |
| `frontend/src/components/DocumentViewer/DocumentViewer.jsx` | `DocCollectionOverlay` with presigned URLs |
| `frontend/src/components/PersonModal/PersonProfile.jsx` | Collection card rendering |

### Remaining Before Deploy
- Run `scripts/backfill-document-collections.js` against Neon (populates collection_key for existing rows)
- `cd frontend && npm run deploy:gh-pages`
- Push `main` → Render auto-deploy

---

---

## Session 43 — Person Modal Metadata Enrichment (May 8, 2026) ✅ COMPLETE

### What Was Asked
User audited person modals across the platform for "visible blocks" — empty UI fields not connected to available ground-truth data. Ann Maria Biscoe was provided as the primary example: no birth year despite FamilySearch climb data, no location despite DC compensated emancipation petition, and 404 errors on enslaved person links. User asked for: (1) 15-20 additional examples identified across diverse datasets/locations/time periods, (2) a robust plan to resolve all inferable metadata disconnections, (3) estimated values clearly labeled with hover tooltip showing calculation methodology.

### Audit Findings (before fixes)
- **Enslaved person links → 404 universally:** `enslaved_id` field never used to build URLs → all links resolved to `/person/enslaved_individuals/undefined`
- **Birth years blank for 142+ canonical persons** despite `ancestor_climb_matches` containing `slaveholder_birth_year` data
- **Location blank for Ann Maria Biscoe** despite DC petition in Georgetown (`primary_state` truncated to `'District'`)
- **Freedmen's Bank owner blank** because backend looked for `owner` field; actual JSONB keys were `last_master`/`last_mistress`
- **Schema mismatches:** `canonical_persons` uses `canonical_name`, `birth_year_estimate`, `sex` — not `full_name`, `birth_year`, `gender`. `ancestor_climb_matches` uses direct columns, not a `match_data` JSONB.
- **Ann Maria Biscoe petition:** `claimant_canonical_id` was NULL in `historical_reparations_petitions` cww.00430; `slaveholder_id` was NULL in her `ancestor_climb_matches` row (id=138)

### Delivered — Work Items W1–W8

#### Backend (`src/api/routes/contribute.js`) — Commits `f25151249`
| Item | Change |
|------|--------|
| W1 | Normalize enslaved persons: `id = ep.enslaved_id \|\| ep.id`, add `table_source` field |
| W1b | Normalize descendants: `descendant_name → full_name` |
| W2 | Infer `birth_year` from notes text (age + document year) with `birth_year_source`, `birth_year_confidence`, `birth_year_formula` fields |
| W3 | Assemble location from `primary_plantation + primary_county + primary_state` |
| W4 | Freedmen's Bank: expose `last_master`/`last_mistress` + `branch` location + `account_number`/`plantation` |
| W6 | Query `person_external_ids` for FamilySearch/WikiTree/Ancestry links |
| W7 | Query `historical_reparations_petitions` for DC petition data |
| W7b | Query `person_relationships_verified` for inheritance chain (inherited/bequeathed/transferred) |

#### Frontend (`frontend/src/api/format.js`) — COMPLETED
Added `formatYearWithEstimation(year, source, confidence, formula)` returning either a plain year string or `{ yearStr, isEstimate: true, tooltip }`.

#### Frontend (`frontend/src/components/PersonModal/PersonProfile.jsx`) — COMPLETED
- New `YearDisplay` component: dashed underline + `(est.)` badge + native `title` tooltip
- Enslaved person links: `to={/person/${ep.table_source || 'enslaved_individuals'}/${ep.id}}` (fixes 404s)
- Identity grid adds `freedom_year` and `primary_plantation` fields (conditional)
- New Family section (parents/children from `data.familyMembers`)
- DC petition block under "Enslaved by"
- Inheritance/provenance chain under "Enslaved by"
- Ancestry link in External references

#### Frontend (`frontend/src/styles/global.css`) — COMPLETED
- `.estimate-badge`, `.estimate-badge-year` (dashed underline, cursor:help), `.estimate-badge-label`
- `.provenance-chain` (left border, padding), `.provenance-step`

#### New Scripts
| Script | Description |
|--------|-------------|
| `scripts/backfill-climb-data-to-canonical.js` | Reads `ancestor_climb_matches` (direct columns), updates NULL `birth_year_estimate`/`primary_state`/`primary_county` on `canonical_persons`. `--dry-run` mode. **Ran live: 142 records updated.** |
| `scripts/backfill-biscoe-dc-petition.js` | Targeted Ann Maria Biscoe repair: documents lookup logic, links petition `claimant_canonical_id`, fixes `slaveholder_id` on climb match. |

#### Direct DB Repairs Applied (Ann Maria Biscoe)
- `canonical_name` corrected: `'Ann M. Biscoe'` → `'Ann Maria Biscoe'`
- `primary_state` fixed: `'District'` → `'DC'`; `primary_county` set: `'Georgetown'`
- `historical_reparations_petitions` cww.00430: `claimant_canonical_id` set to `141015`
- `ancestor_climb_matches` id=138: `slaveholder_id` set to `141015`

### Commits
| Commit | Contents |
|--------|---------|
| `f25151249` | W1–W8 backend enrichment, frontend YearDisplay + provenance CSS, format.js |
| `9b36d9d64` | backfill-climb-data-to-canonical.js, backfill-biscoe-dc-petition.js, DB backfill applied (142 records) |

### Schema Notes Verified Live This Session
| Table | Key columns |
|-------|-------------|
| `canonical_persons` | `canonical_name`, `birth_year_estimate`, `death_year_estimate`, `sex`, `primary_state`, `primary_county`, `primary_plantation` |
| `ancestor_climb_matches` | `slaveholder_id` (FK→canonical_persons), `slaveholder_birth_year`, `slaveholder_location` — **direct columns, no match_data JSONB** |
| `historical_reparations_petitions` | `claimant_name`, `claimant_canonical_id` — **not `petitioner_name`** |
| `unconfirmed_persons` | `full_name`, `lead_id` — **not `id`** |

---

## Session 41 — MSA SC 2908 S3 Preservation Archive (May 8, 2026) ✅ COMPLETE

### What Was Asked
Otho Brown's profile linked to an external MSA URL (am812--97.pdf) instead of S3. User asked to survey the entire DB for URL-only records and preserve all downloadable PDFs in S3.

### Survey (start of session)
| Table | Finding |
|-------|---------|
| person_documents | 7,099 rows; 4,196 S3-backed; 2,891 FamilySearch HTML (URL-only, correct); 10 other URL-only |
| enslaved_individuals.notes | 18,203 rows with Source: URLs; 132 unique MSA PDFs; 0 in S3 |
| documents (slaveholder) | 1 row, in S3 |

### Delivered

**Migration 063 applied to Neon:**
- person_documents.enslaved_individual_id VARCHAR(50) — direct FK to enslaved_individuals
- person_documents.title TEXT
- Index: idx_person_documents_enslaved_individual_id

**132 MSA SC 2908 PDFs → S3 (reparations-them/msa/sc2908/):**
- Collection: Certificates of Freedom for Blacks, 1806-1864 (Maryland State Archives, AM 812)
- 132/132 uploaded, 0 failed, avg ~1.5 MB each
- Script: scripts/archive-msa-sc2908-to-s3.js

**17,876 person_documents rows created:**
- One row per enslaved_individual pointing to S3 PDF
- Bulk INSERT via single SQL INSERT ... SELECT (one DB round-trip)
- document_type = certificate_of_freedom
- Script: scripts/insert-msa-person-documents.js

**4 other PDFs → S3:**
- CA DOI Slavery Era Insurance Registry (x2 rows) — 118 KB
- JPMorgan Chase Philadelphia CTO Disclosure 2024 — 1366 KB
- Brattle Group Quantification of Reparations 2023 — 2303 KB

### Final DB State (person_documents)
| | Count |
|-|-------|
| Total rows | 24,975 |
| S3-backed | 22,076 |
| URL-only (FamilySearch HTML) | 2,891 |
| URL-only (non-downloadable datasets/portals) | 8 |
| MSA SC 2908 rows | 17,876 |

### Otho Brown Confirmed
- s3_key: msa/sc2908/am812--97.pdf
- s3_url: https://reparations-them.s3.amazonaws.com/msa/sc2908/am812--97.pdf

### New Scripts
- scripts/archive-msa-sc2908-to-s3.js — Phase 1: download 132 MSA PDFs to S3 (idempotent, --dry-run, --skip-download, --limit, --concurrency)
- scripts/insert-msa-person-documents.js — Phase 2: bulk INSERT 17,876 person_documents via single SQL query

### Bug Found in backfill-source-url-docs-to-s3.js
CONCURRENCY silently becomes NaN when --concurrency not passed (indexOf=-1 reads process.argv[0]=node path). Fix: always pass --concurrency N AND AWS_S3_BUCKET=reparations-them AWS_REGION=us-east-2 explicitly.

---

## Session 40 — Raspberry Pi Kiosk Reintegration: Intake Form Kiosk (May 7, 2026) ✅ COMPLETE

### What was asked
The Raspberry Pi was poorly integrated (GA→MD→MS→LA→TX→VA queued). DocAI pilot ready — run after 1860 finishes.
**Last Updated:** May 7, 2026 (Session 40 — COMPLETE)

---

## Session 40 — Raspberry Pi Kiosk Reintegration: Intake Form Kiosk (May 7, 2026) ✅ COMPLETE

### What was asked
The Raspberry Pi was poorly integrated — it ran a dead ancestor-climb kiosk that had been silently broken since the climb workload moved to the Mac Mini (Session 23, March 2026). The Pi needed to be reworked to present the standard React frontend with a REQUEST INTAKE button below the search bar, opening the Google Intake Form and returning to the platform upon submission.

A secondary concern: `launch-kiosk.sh` existed only on the Pi's filesystem (not in the repo). Requested: audit the codebase for similar off-repo mission-critical scripts, file a GitHub issue, and delete the old kiosk code.

### New files
| File | Purpose |
|------|---------|
| `scripts/pi/launch-kiosk.sh` | Chromium kiosk launcher with retry loop, proper Chrome flags |
| `scripts/pi/reparations-kiosk.service` | systemd unit for auto-start on Pi boot |
| `frontend/src/components/Intake/IntakeButton.jsx` | REQUEST INTAKE button + full-screen iframe overlay for Google Form + post-submit confirmation |

### Files modified
| File | Changes |
|------|---------|
| `frontend/src/pages/HomePage.jsx` | Added `?mode=kiosk` detection; renders IntakeButton only in kiosk mode |
| `frontend/src/styles/global.css` | Added intake button, overlay, iframe, confirmation CSS classes |

### Files deleted
- `kiosk.html`, `js/kiosk.js`, `styles/kiosk.css` — obsolete ancestor-climb kiosk

### GitHub issue filed
- **Issue #47** — "Audit off-repo scripts — mission-critical files exist only on machine-specific paths"
  - 6 shell scripts hardcoding Mac Mini path `$HOME/Desktop/Reparations-is-a-real-number`
  - 3 files referencing Pi path `/home/danyelicafish`
  - Hardcoded GCP key path in `document-ai-extractor.js`

### How the kiosk works
1. Pi boots → systemd launches `launch-kiosk.sh`
2. Chromium opens in kiosk mode at `https://danyelajunebrown.github.io/Reparations-is-a-real-number/?mode=kiosk`
3. React detects `mode=kiosk` → shows REQUEST INTAKE button below search bar
4. User taps REQUEST INTAKE → full-screen iframe overlay opens Google Form
5. After submission, overlay detects redirect (or 5-min safety timeout) → confirmation screen with "Return to Platform"
6. User taps Return → back to front page
7. If Chrome crashes, `launch-kiosk.sh` restarts it after 10s

### Frontend build
- `cd frontend && npm run build` — 0 errors, successful

---

## Session 37 — 1860 Pipeline Debugging + ntfy Wiring (May 6, 2026) ✅ COMPLETE

### Commits pushed
| Commit | Contents |
|--------|---------|
| `9e9be89fa` | Bug 1 (1860 headless) + Bug 2 (DocAI neon crash) |
| `3fc53a257` | ntfy wired into finish-1860-remaining.sh; memory bank update |

### What was fixed

Two bugs diagnosed and patched (commit `9e9be89fa`):

| File | Bug | Fix |
|------|-----|-----|
| `finish-1860-remaining.sh` | `CHROME_REMOTE_PORT=9222` used in loop → `browser.close()` kills Chrome after first state → all subsequent states run headless with no visible window | Changed to `FAMILYSEARCH_INTERACTIVE=true` — each state launches its own headed Chrome, loads `fs-cookies.json`, auto-logs in |
| `scripts/enrich-freedmens-docai.js` | `const result = await sql.query(); return result.rows;` → older neon package returns rows array directly → `result.rows` is `undefined` → Fatal crash on `.length` | `const raw = await sql.query(); return Array.isArray(raw) ? raw : raw.rows;` |

### ntfy wired into finish-1860-remaining.sh

Added fire-and-forget `ntfy_post()` helper that sources `OPS_NOTIFY_WEBHOOK` from `.env` and curl-posts (backgrounded) to ntfy.sh. Notifications fire on:
- Script start (lists all states)
- Each state start (state name + location limit)
- Each state success (`done at HH:MM`)
- Each state error (exit code, high priority)
- All states complete

Cookie behavior **CONFIRMED WORKING**: `fs-cookies.json` auto-logs in for every state. Chrome window opens, login page flashes briefly, script proceeds automatically. User must NOT interact with the Chrome window.

### 1860 current state (May 6)
| State | Status |
|-------|--------|
| Washington DC | ✅ Done (0 locations) |
| South Carolina | ✅ Done (0 locations) |
| Georgia | 🔄 Running (20 locations, ~2 images processed before prior interruption; now restarted) |
| Maryland | ⏳ Queued |
| Mississippi | ⏳ Queued |
| Louisiana | ⏳ Queued |
| Texas | ⏳ Queued |
| Virginia | ⏳ Queued |

### DocAI status
- Neon crash fixed. 500 Washington DC records in queue.
- **REQUIRES** Chrome on port 9222 + FS login before running.
- Run AFTER 1860 completes (one FS scraper at a time).

### After 1860 — DocAI pilot sequence
```bash
# 1. Launch Chrome with remote debugging
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/familysearch-docai

# 2. Sign into FamilySearch (username/password, NOT Google OAuth)

# 3. Washington DC pilot
node scripts/enrich-freedmens-docai.js --branch-like "Washington" --limit 500

# 4. Then expand: Richmond VA → Charleston SC → New Orleans LA → Memphis TN
```

---

## Session 35 — Freedmens Bank DocAI Pipeline + Mac Mini Watchdog (May 5, 2026) ✅ CODE COMPLETE

### What was asked
User asked what it would take to complete the Freedmens Bank enrichment through Document AI to S3, and the 1860 slave schedule scrape on the Mac Mini. All missing code was identified, written, and pushed.

### Files Shipped

| File | Commit | Description |
|------|--------|-------------|
| `scripts/enrich-freedmens-docai.js` | `040506c5e` | NEW: Layer 2 DocAI enrichment batch runner |
| `scripts/run-freedmens-complete.sh` | `9e8275ef3` | NEW: Single-command pipeline wrapper |
| `scripts/agents/PipelineWatchdogAgent.js` | `1ac859472` | NEW: 4-phase autonomous pipeline monitor |
| Bug fix: Phase 4 crash recovery logic | `5b0d3b1eb` | Fix operator precedence in PM2 restart condition |
| FP validator added to enrichment script | `6720b5d59` | 17-category false-positive detection layer |

### enrich-freedmens-docai.js

For each `unconfirmed_persons` row with `extraction_method = 'freedmens_bank_index'`:
1. Navigates Chrome (9222) to the ARK URL (handwritten ledger image)
2. Screenshots at 2800×1700
3. Calls `freedmens-bank-ledger-v1` via `us-documentai.googleapis.com` (regional endpoint REQUIRED)
4. Runs `validateFields()` false-positive validator (17 checks, see below)
5. Upserts into `relationships` JSONB as `docai_fields`; tags `review_notes` with `'docai_enrichment'`
6. Archives screenshot to S3: `freedmens-bank/{branch-slug}/docai/{id}.png`
7. Low-conf / missing critical fields / FP warnings → `parse_failure_queue` (M044)

Flags: `--branch`, `--limit`, `--start-id`, `--dry-run`, `--reprocess`, `--min-confidence`
Fully resumable (idempotent).

### validateFields() — 17 false-positive check categories

**Field-level rejections (value nulled before DB write):**
1. Empty / < 2 chars
2. Punctuation-only strings
3. Numeric-only in name fields (account# bled into last_master)
4. > 80 chars (multi-field OCR capture)
5. Exact junk words: `unknown`, `none`, `freed`, `free`, `same`, `deceased`, `n/a`, `himself`, `herself`, `don't know`, `not given`, `-`, `--`, `?`, `0`
6. Near-junk: starts with junk word + tiny suffix
7. Page/column header text: `savings and trust`, `last master or mistress`, `plantation where`, `signature of depositor`, `branch at`, `account number`, etc.
8. City/state name in enslaver field (all 27 branch cities + US states)
9. Single short all-lowercase token in name field (stray OCR word)
10. Account number pattern (`No. 1234`, `# 567`)
11. Depositor name verbatim in enslaver field

**Cross-field rejections:**
12. `last_master == depositor_name` → hard reject
13. `last_mistress == depositor_name` → hard reject
14. `last_master` overlaps `plantation` → field boundary warning

**Soft flags (kept, queued for review):**
15. `last_master == last_mistress` same string → column bleed warning
16. `old_title` lacks title prefix at confidence < 0.70

All FP records stored with `failure_reason = 'false_positive_detected'`, `training_eligible = true`. Full audit trail in `_fp_warnings` / `_fp_rejected_fields` inside `docai_fields` JSONB.

### run-freedmens-complete.sh
Chains: git pull → Layer 1 → Layer 2 → S3 backfill → pm2 start slave-schedule-1860
Flags: `--skip-layer1`, `--skip-layer2`, `--skip-1860`, `--dry-run-docai`

### PipelineWatchdogAgent.js
4-phase autonomous orchestrator + monitor:
- **Phase 1**: DB poll every 90s, stall detection (10 min no growth) → restart Layer 1 (max 3x)
- **Phase 2**: DocAI progress poll, quality check every ~500 records, stall → respawn
- **Phase 2b**: Targeted `--reprocess` on branches with avg master_conf < 0.35
- **Phase 3**: S3 backfill
- **Phase 4**: PM2 start 1860, poll every 2 min, crash → restart (max 10x), stop at queue = 0
Log: `debug/logs/watchdog-YYYYMMDD.log`

### Mac Mini state
- Repo path: `/Users/danyelica/Desktop/Reparations-is-a-real-number`
- Has NOT yet done `git pull` — watchdog not yet running
- To start: `cd ~/Desktop/Reparations-is-a-real-number && git pull origin main && node scripts/agents/PipelineWatchdogAgent.js &`
- 1860 remaining: ~2,022 locations (VA 315, MS 218, LA 205, KY 201, MO 201)

---

## Session 34 — Comprehensive Audit + Critical Pipeline Fixes (May 5, 2026) ✅ COMPLETE

Comprehensive audit of every file in the codebase against the five core functionalities.
All critical issues identified and resolved. No blocking bugs remain in the primary pipeline.

### Issues Fixed

| File | Issue | Fix |
|------|-------|-----|
| `middleware/auth.js` | Hardcoded `'your-secure-jwt-secret-here'` fallback — tokens silently signed with public string | Fail-fast FATAL at startup if JWT_SECRET env missing |
| `ReparationsEscrow.sol` | `.transfer()` 2300-gas DOS vector in distributePayments + emergencyWithdraw | Replaced with `.call{value:}`. CEI enforced. remainingDebt cap. PaymentFailed event. |
| `scripts/agents/BaseAgent.js` | DATABASE_URL validated deep in agent execution — cryptic Neon error | Validate at module load; FATAL with clear message |
| `scripts/agents/FamilySearchClimberAgent.js` | Did not exist — no agent bridge from DAAOrchestrator to Puppeteer scraper | NEW FILE: Extends BaseAgent, spawns scraper child process, polls DB, supports CLIMB_TIMEOUT_MS |
| `src/services/reparations/DAAOrchestrator.js` | Step 4a/4b/5b not wired — M037 wealth fingerprint never loaded from DB, lineage ledger never updated | wired all three steps + both missing methods |
| `DAAOrchestrator.upsertLineageLedger` | Property path bug — iterated `data.slaveholder?.slaveholder_id` on flat array items | Fixed to `sh.slaveholder_id`, `sh.slaveholder_name`, `sh.generation_distance`; calc lookup uses `c.slaveholder?.slaveholder_id` and field `.debt`; uses `debtCalculation.wealthGapObligation` |
| `migrations/027` | Internal header said "Migration 024" | Corrected to "Migration 027" |
| `migrations/041` | Ambiguous relationship to migration 011 | Header updated: ACTIVE migration, not a no-op; explains 011→041 relationship |
| Numbering gaps | Migrations 046, 054-055, 057-059 missing | 6 placeholder stubs created |

### What Still Works (Verified Not Broken)
- Ancestor climb BFS (FamilySearch Puppeteer scraper)
- Probate gate (three-tier documentary evidence check)
- Match verification (7 disqualification checks, 4 confidence tiers)
- Tiered payment calculation (TieredPaymentCalculator, WealthGapCalculator, CorporateSuccessionTracer)
- Craemer 2015 compound interest formula
- DAA document generation (DOCX)
- ReparationsEscrow Base mainnet contract (0x914846ceA07e57d848d9d60C8238865D83d9ab1E)

### Next Session Priorities
1. Base blockchain smoke-test — Adrian Brown DAA end-to-end → submit hash to ReparationsEscrow
2. Run M037 on Neon (participants wealth fingerprint columns)
3. Run M040 on Neon (enslaver_lineage_ledger) — needed for upsertLineageLedger
4. Document AI fine-tune deploy + wire into production Freedmens batch
5. 1870 Census pilot DC/MD/SC/NY/GA
6. Transfer ReparationsEscrow ownership to fresh wallet (deployer key exposed, Session 27)
7. **May 10: pivot to LLM/neural-network development phase** (user noted this is coming)


---

## Session 32 — civilwardc TEI + Hopewell OCR + Corporate slavery evidence + Document AI (Apr 20-21, 2026) 🟡 IN PROGRESS

### Delivered

- **Civilwardc.org TEI bulk ingest (100% coverage):** 1,041 petitions, 1,698 enslaved persons indexed, $352,598 in claimed valuations, 1,983 family_relationships edges, 4,174 S3-archived images. Date-variant + bad-href parser hardening. Unique constraint on docket_number added.
- **Hopewell 1817 will OCR** (orphan PDF sitting in S3 since Dec 2025): Angelica Hopewell identified as wife (married surname — NameResolver missed her under Chesley maiden), bequeathed Lewis; enslaved distributed to daughter Ann Maria Biscoe. 3 `person_relationships_verified` edges created.
- **DAA probate gate expansion** (src/services/reparations/DAAOrchestrator.js): added compensated_emancipation_petition doc type; per-origin scope CTE traversing spouse/parent/child. Adrian Brown 3/16 → 6/16 passing.
- **Canonical merges** (person_merge_log populated for first time): Maria Biscoe/Chew (6 dupes→141014), Hopewell (2→1070), Chesley (2→140299). FK references redirected across 24 tables.
- **Corporate slavery evidence (migration 043):** 3 tables + architectural reframe that every DAA is a class obligation. CA SEIR 675 policies (419 enslaved + 147 slaveholder auto-linked), 11 Philly 2024 bank disclosure PDFs archived, 15 corporate_slavery_disclosures rows total.
- **Climber data quality:** 390 implausible birth years nulled, HISTORICAL_CUTOFF_YEAR 1450→1600, LX39-1MY relabeled as Gwendolyn Louise Fagan (Eli Neal's grandmother), 2,593 civilwardc ML-misclassified rejected.
- **Human review UI** at `/review`: 6 queues (enslaver_candidates, unresolved_petitions, pending_climb_matches, ambiguous_unconfirmed, duplicate_canonicals, parse_failures).
- **Document AI processor** `freedmens-bank-ledger-v1` (ID 30049eebf8debcf4): 31-field schema defined, service account authenticated, regional endpoint `us-documentai.googleapis.com`. Training batch of 36 diverse edge cases staged at ~/Desktop/docai-training-batch/. User labeling, Fine-tune in progress.
- **Parse failure queue** (migration 044) + `FreedmensBankProcessor.extractWithQueueing()` closes the human-in-loop training cycle.

### Civilwardc extraction gap (audit Apr 21)

| | Count |
|---|---|
| Petitions ingested | 1,041 ✓ |
| Image pages archived to S3 | 4,174 ✓ |
| **Images OCR'd** | **0 / 4,174** — orphan pattern (narrative prose unextracted) |
| Enslaved persons in JSONB | 1,698 ✓ |
| Distinct enslaved names | 1,408 |
| Linked to canonical_persons | 672 (48%) |
| **NOT linked (JSONB + edges only, no canonical row)** | **736 (52%)** |
| Claimants linked to canonical_persons | 947 / 1,041 (91%) |
| **Unresolved claimants → review queue** | **94** |
| **Petitions with 0 enslaved extracted (no table, no narrative match)** | **459 / 1,041 (44%)** — JPG OCR will recover these |

### May 4 operational target — priority list

**By Thursday Apr 23 (form release blockers):**
1. Intake form checklist updated with 25+ corp/uni options
2. validate-intake-form.js tested on live-form CSV export
3. /review UI running for curator (admin token + deployed server)
4. Server reachable by form submission pipeline

**By May 4 (full operational):**
5. Document AI fine-tune deployed + wired into production batch
6. 736 unlinked civilwardc enslaved names promoted to canonical_persons
7. OCR pass on 4,174 civilwardc JPGs (narrative prose → more canonicals + family_relationships)
8. OCR pass on 11 Philly bank PDFs → corporate_debt_acknowledgments
9. DAA smoke test for Adrian/Ryan/Drew/Eli (probate pass → PDF → on-chain ack)
10. Blockchain contract wired to DAAOrchestrator output
11. land_transfer_events seeded for participants (Shirley Plantation, Ball Hill, etc.)
12. 1870 Census pilot DC/MD/SC/NY/GA
13. Participant communication flow (submit → notify → review → sign → publish)
14. Legal/disclosure copy on form + DAA PDF

### Thought experiments (documented, not implemented)

- **Shirley Plantation / Charles Carter III + Lauren:** 11-gen continuous Hill-Carter ownership 1638-present. Identified methodology gap — continuous-enterprise descendants need a "continuous enterprise" flag; current DAA math double-counts across generations. Estimated per-descendant obligation ~$400M-$600M (1000× typical) because wealth stayed concentrated.
- **Morgan family (Chauncey, John Jr, Caroline, Quincy):** Institutional trace through Aetna (Joseph III 1820s) + Peabody cotton + Confederate bonds (J.S. Morgan London) + 1871+ railroads/steel. Brattle constants already in DAAGenerator ($134,467/person-year ceiling).

---

## Session 31 — Freedmen's Bank Parser + Wealth Tracing Pivot + Security Audit (April 18-19, 2026) ✅ DELIVERED

Kernel panic on 8GB laptop triggered a full review of memory pressure, which
unblocked the Freedmen's Bank enslaver-field extractor rewrite. Separately,
user rejected the project's long-standing aggregate-statistics framing for
wealth tracing and directed a pivot to specific-asset land-primary tracing.
Security inventory surfaced a committed production DB password.

### Completed
- ✅ **Memory-safe runner** (`scripts/run-all-freedmens.sh`) — Node heap cap, Chrome restart between branches, swap abort
- ✅ **Audit duplicate-detection fix** (`scripts/audit-freedmens-quality.js`) — 1,225 false-positive "duplicates" → 20 real (0.033% issue rate)
- ✅ **Enslaver field extraction rewrite** (`scripts/extract-freedmens-fields.js`) — Google Vision bounding-box parser, catchment-area value extraction, handles both Charleston-R21 numbered single-record form AND Baltimore/Huntsville unnumbered multi-record form
- ✅ **Parser verified across 31 branches** via random-sample sweep — 29 success, 2 graceful-zero (Mobile faded, Philadelphia organizational)
- ✅ **Full-collection runner started** (`scripts/run-freedmens-field-extraction.sh`) — overnight run Apr 18-19, 28 branches, 300 depositor cap per branch with 30-min timeout
- ✅ **Wealth tracing framework doc** (`memory-bank/wealth-tracing-framework.md`) — academic-quality methodology, 3-claim thesis, two-pillar approach, working bibliography
- ✅ **Land-tracing schema migration** (`migrations/038-land-tracing-and-flagrant-assets.sql`) — 4 new tables: land_transfer_events, modern_parcel_links, top_landholder_flags, flagrant_heirloom_assets + enslaver_material_footprint view
- ✅ **Safari scareware fix** — push notifications from homphitiomiring.com diagnosed + removed

### Live data extracted (Session 31)
- Charleston Roll 21 branch 1: 50 depositors with full-field extraction, 32 with enslaver (master/mistress), 26 with enslaved-name (old title), 0 garbage

### Open / pending
- [x] **URGENT:** Rotate leaked Render DB password (committed in 5 files on public repo) — tracked as task #17. **Done 2026-04-25:** Render db deleted, files scrubbed, history rewritten via git filter-repo, force-pushed. Google Vision key + FamilySearch password rotated in parallel.
- [ ] Re-run Charleston Roll 23 (crashed on FS rate-limit mid-branch; no DB corruption)
- [ ] Run migration 038 on Neon
- [ ] Ingest user's 5 DC ancestor probate/deed/administration/guardianship records when they arrive
- [ ] Seed top_landholder_flags with 1860 Agricultural Census top-1% per state
- [ ] Parser accuracy refinement: cross-label value bleed ("Charleston." showing up in both old_title and slave_residence on Charleston R21) — acceptable for MVP
- [ ] Orphaned "Comet" login item (30-second fix)

---

## Session 30 — Wealth Fingerprint & Calculator Wiring (April 15/16, 2026) ✅

Fixed the dead-data problem: intake form collected 7 financial fields but only
annual_income was used (flat 2%). Now all fields feed real calculators.

### Completed
- ✅ **Migration 037** — 15 new `participants` columns: corporate_connections, trust/estate, family business, inherited land, exec history, pre-1865 continuity, wealth flag
- ✅ **validate-intake-form.js** — COLUMN_MAP expanded +11 fields, auto-computes wealth_flag_elevated + corporate_connection_type
- ✅ **DAAOrchestrator** — calculateTotalDebt() wired to TieredPaymentCalculator + WealthGapCalculator + CorporateSuccessionTracer. Dual methodology (Craemer vs D&M), uses higher as obligation floor. Backward-compatible (still accepts bare number).
- ✅ **CorporateSuccessionTracer** — reverseLookup() added. "Citizens Bank" → jpmorgan (0.8 confidence).
- ✅ **index.js** — CorporateSuccessionTracer exported
- ✅ Integration test: $250K/$3M/$800K/50 enslaved/direct corp → tiered $15,240/yr (was $5K flat), wealth-gap $1.6M obligation

### Remaining
- [ ] Paste Section 3b (corporate/trust/land questions) into actual Google Form
- [ ] Run migration 037 on Neon
- [ ] Push code to Mac Mini

---

## Session 29 — Frontend Reintegration (April 11, 2026) ✅ SCAFFOLD COMPLETE

After months of backend work (scrapers, identity system, match verification,
reparations calculators, blockchain deployment, 1860 slave schedule extraction),
the Dec 2025 frontend was severely out of sync. This session rebuilt it from
scratch as a React + Vite application at `frontend/`.

### Framework Choice
- React 18 + Vite 6 (user approved — "Using a framework is genius, take your time to do it right")
- Terminal aesthetic: black background, white monospace, no decoration
- GitHub Pages hosting (static build) → Render API backend → Neon DB
- TypeScript not adopted yet (deferred to reduce scope; JS with JSDoc types as needed)

### Seven Phases — ALL COMPLETE
| Phase | Status | Key Output |
|-------|--------|-----------|
| 1. Scaffold + terminal aesthetic + search | ✅ | Vite project, global.css, API client with strict verified filter, App shell, SearchBar, SearchPage, StatsRibbon |
| 2. Person modal + reparations calculators | ✅ | PersonProfile component, ReparationsBreakdown with 6 methodology views (wealth gap, ICHEIC, tiered, insurance, banking, railroad), each with citations |
| 3. Lineage graph visualization | ✅ | D3 SVG zoomable graph. Zoom out = all participant lineages side by side. Verified-only matches. |
| 4. Document viewer + corporate debts + legal framework | ✅ | PDF/image viewer with OCR, Farmer-Paellmann defendants, Triangle Trade jurisdictions |
| 5. Blockchain payment panel | ✅ | useBlockchain hook, MetaMask auto-switch to Base 8453, submit DAA, USDC approve+deposit, ETH deposit |
| 6. Kiosk update + admin | ✅ | styles/kiosk.css rewritten terminal; 4 admin routes (Home, Review, DataQuality, Participants) |
| 7. Cleanup + dependency-safe removals | ✅ | Deleted contribute-v2.html, debt-river.js/css; fixed broken refs in index.html/app.js/server.js |

### Files Created (37 in frontend/)
```
frontend/
  package.json, vite.config.js, .env.example, .gitignore, index.html
  src/
    main.jsx, App.jsx
    api/client.js, api/format.js
    hooks/useApi.js, hooks/useBlockchain.js
    styles/global.css
    pages/ — 9 page files
    components/
      Layout/StatsRibbon.jsx
      Search/SearchBar.jsx
      PersonModal/PersonProfile.jsx
      Reparations/ReparationsBreakdown.jsx
      LineageGraph/LineageGraph.jsx
      DocumentViewer/DocumentViewer.jsx + DocumentList.jsx
      CorporateDebts/CorporateDebts.jsx + CorporateEntity.jsx
      LegalFramework/LegalFramework.jsx + LegalTopic.jsx
      BlockchainPanel/BlockchainPanel.jsx
      Admin/AdminHome.jsx + ReviewQueue.jsx + DataQuality.jsx + ParticipantManagement.jsx
```

### Files Removed
- `contribute-v2.html` (git rm)
- `js/debt-river-animation.js` (git rm)
- `styles/debt-river.css` (git rm)

### Files Modified
- `index.html` — removed 3 debt-river references
- `js/app.js` — removed 2 dead `window.debtRiver.onSearch()` branches
- `src/server.js` — removed contribute-v2 route + dead `/api/process-individual-metadata` stub
- `styles/kiosk.css` — full rewrite to terminal aesthetic with 7-class taxonomy badges
- `memory-bank/activeContext.md` — Session 29 documented
- `memory-bank/progress.md` — this entry

### Dependency Analysis (Pre-Cleanup)
Three parallel sub-agent sweeps traced every reference before removal:
- `enslaved_people` table → production (34 files), NOT removed
- Beyond Kin → active scraper with 2,461 records, NOT removed
- Legacy redirect endpoints → callers exist (Orchestrator.js, reprocess script), NOT removed
- `/api/chat` → kept alive for old index.html fallback
- `dashboard.html`, `review.html` → kept dormant (not linked from React app, server routes still work)

### Pending Before Premiere (as of Apr 11)
1. ✅ `cd frontend && npm install && npm run build` — done Apr 13, 777 modules, 0 errors
2. ✅ Live API shape verification — done Apr 13 via static cross-check + live Render sweep Apr 13/14
3. ✅ Admin auth gate — committed Apr 13, deployed Apr 13/14, ADMIN_TOKEN set on Render, verified 401 on wrong token
4. ✅ Connection pool fix — 17 endpoints in contribute.js switched to sharedPool, 19 pool.end() calls removed
5. ✅ Stats caching — already existed, no change needed
6. 🟡 `/api/participants` endpoint — still not implemented, ParticipantManagement.jsx falls back to grouping ancestor-climb sessions (flagged for Apr 14 as Eli Neal visibility bug)
7. ✅ Legal framework detail view structure — LegalTopic.jsx rewritten with topic-specific structured rendering per real API shape
8. ✅ GitHub Pages deploy — `gh-pages-react` branch published Apr 13, GitHub Pages source switched Apr 13/14, site live

---

## Session 29 Close — Apr 13/14, 2026 ✅ DEPLOYED, SITE LIVE

### Final push sequence
1. Applied migration 031 to Neon (7 jurisdictions, 4 doctrines, 4 mechanisms, UK 1833, Haiti, Farmer-Paellmann seed data)
2. Applied defendants_by_sector view (migration 021 missing piece)
3. Set ADMIN_TOKEN on Render (user accidentally pasted in chat → advised rotation → rotated)
4. Pushed 3 commits to origin/main → Render auto-deployed
5. Switched GitHub Pages source to gh-pages-react branch
6. Verified live: site loads, aesthetic correct, stats accurate

### Commits pushed this session
- `40afc1759` feat(frontend): React+Vite rebuild for May 2026 premiere (47 files)
- `81c69d349` fix(server): admin auth gate, connection pool fix, stats query fix (4 files)
- `ae9b6a414` docs(memory-bank): Session 29 — frontend reintegration (2 files)

### Stats after deploy
- Frontend: https://danyelajunebrown.github.io/Reparations-is-a-real-number/ ✅
- Backend: https://reparations-platform.onrender.com ✅
- All /api/legal/* endpoints returning 200 with rich structured data
- Corporate debts by-sector working (5 insurers, 4 railroads, 4 tobacco, 2 banks, 1 cotton, 1 factor)
- Admin auth gate working (401 on wrong token, not 503)
- Stats slaveholder count: 55 → **399,578** (canonical_persons promotion now counted)
- Total records: 1.97M → 2.46M

### 🔴 Known issue for tomorrow (Apr 14)
**Eli Neal not appearing in UI** despite completed climb. Most likely the participant model gap: climbs indexed by grandparent FS IDs, not participant name. Need /api/participants endpoint + participant-grouped lineage view. Full investigation hypotheses in activeContext.md.

---

## Development Phases

### Phase 1: Foundation (2024 Q1-Q2) ✅
**Goal:** Build core infrastructure for document processing and genealogy tracking

**Completed Features:**
- ✅ Express.js API server with RESTful endpoints
- ✅ PostgreSQL database with complete schema
- ✅ Document upload pipeline (Multer)
- ✅ Local filesystem storage adapter
- ✅ OCR integration (Tesseract.js)
- ✅ Basic database schema (documents, enslaved_people, families)
- ✅ Database initialization script
- ✅ Health check endpoint

---

### Phase 2: Blockchain Integration (2024 Q3) ✅
**Goal:** Implement Ethereum smart contracts for payment distribution

**Completed Features:**
- ✅ ReparationsEscrow.sol smart contract (Solidity 0.8.19)
- ✅ ReparationsLedger.sol smart contract
- ✅ Truffle development framework setup
- ✅ Local Ganache blockchain for testing
- ✅ OpenZeppelin security patterns
- ✅ Web3.js integration in frontend
- ✅ MetaMask wallet connection

---

### Phase 3: Genealogy & Calculations (2024 Q4) ✅
**Goal:** Integrate genealogical APIs and implement reparations calculation engine

**Completed Features:**
- ✅ FamilySearch API integration
- ✅ Reparations calculation engine
- ✅ Descendant distribution algorithm
- ✅ Debt inheritance tracking
- ✅ Family relationship mapping

---

### Phase 4: Production Readiness (2025 Q1-Q4) ✅
**Goal:** Deploy to production and fix critical issues

**Completed Features:**
- ✅ Deployed backend to Render.com
- ✅ PostgreSQL database on Render
- ✅ S3 persistent storage migration
- ✅ Google Cloud Vision API integration
- ✅ Memory Bank documentation system
- ✅ Server refactoring with modular routes
- ✅ Full-screen document viewer

---

### Phase 5: Unified Scraping System (Dec 2025) ✅
**Goal:** Build working scraping pipeline from contribute page to database

**Completed Features:**
- ✅ UnifiedScraper.js with 8 site-type handlers
- ✅ Rootsweb census scraper (1860 Large Slaveholders)
- ✅ Auto-queue county pages from index
- ✅ Dual-table saving (individuals + unconfirmed_persons)
- ✅ Full backlog processing endpoint
- ✅ Contribute page with metadata fields
- ✅ 5,105+ persons extracted in first run

---

### Phase 6: Conversational Contribution Pipeline (Dec 2025) ✅
**Goal:** Build human-guided contribution flow with content-based confirmation

**Completed Features:**
- ✅ ContributionSession.js - Conversational service with 7 stages
- ✅ OwnerPromotion.js - Content-based confirmation with confirmatory channels
- ✅ API routes for full contribution flow
- ✅ contribute-v2.html - Chat-based UI
- ✅ Database tables (contribution_sessions, extraction_jobs, etc.)
- ✅ End-to-end test suite (test-contribution-pipeline-e2e.js)
- ✅ Natural language parsing for document descriptions
- ✅ Column header extraction from quoted text

**Critical Design Decision:**
Source domain (.gov, etc.) provides CONTEXT, not confirmation. Confirmation can ONLY come from:
1. Human transcription
2. OCR + human verification
3. High-confidence OCR (>= 95%)
4. Structured metadata (user confirmed)
5. Cross-reference with existing confirmed records

---

### Phase 7: Bibliography & Intellectual Property System (Dec 2025) ✅
**Goal:** Track all intellectual sources, databases, archives, researchers, and contributors

**Completed Features:**
- ✅ BibliographyManager (`src/utils/bibliography-manager.js`) - Core citation management
- ✅ IP Tracker (`src/utils/ip-tracker.js`) - Copy/paste and reference detection
- ✅ Bibliography API routes (`src/api/routes/bibliography.js`) - Full CRUD + analysis
- ✅ Frontend page (`bibliography.html`) - Comprehensive UI with search/filter/export
- ✅ Database tables (bibliography, pending_citations, participants, etc.)
- ✅ Memory bank index (`memory-bank/bibliography-index.md`)
- ✅ Pre-populated with 14 sources (archives, databases, technologies, participants)
- ✅ Citation formatting (APA, Chicago, MLA, BibTeX)

---

### Phase 8: Reparations Financial System (Dec 10, 2025) ✅ NEW
**Goal:** Build financial tracking system for reparations debt evidence and payments

**Completed Features:**
- ✅ CompensationTracker (`src/services/reparations/CompensationTracker.js`)
  - Records historical compensation payments TO owners as debt evidence
  - British Abolition 1833 claim import
  - DC Compensated Emancipation 1862 claim import
  - Historical currency conversion (GBP 1834, USD 1862)
  - Links to DebtTracker for unified debt tracking
- ✅ ReparationsSystem (`src/services/reparations/index.js`)
  - Unified module combining Calculator, DebtTracker, CompensationTracker
  - System state reporting
  - Blockchain export functionality
- ✅ DebtTracker fixes (removed smart quotes causing syntax errors)

**Key Financial Principle:**
Compensation TO owners PROVES debt owed TO descendants:
- Owner received £X → Enslaved received $0
- Minimum debt = Modern value of what owner received
- Additional damages for human dignity violations
- Compound interest for delayed justice (~2%/year)

**Test Results (Sample Data):**
- Lord Harewood: £26,309 for 1,277 enslaved → **$2.69 billion proven debt**
- John Smith: £4,500 for 250 enslaved → **$527.8M proven debt**
- James Williams (DC): $4,500 for 15 enslaved → **$19M proven debt**

---

### Phase 9: Data Source Expansion (Dec 10, 2025) ✅

### Phase 27: Methodology Overhaul + Blockchain + Data Promotion (Mar 31 – Apr 5, 2026) 🔄 IN PROGRESS
**Goal:** Audit all financial calculations for integrity, deploy blockchain escrow, promote 400K slaveholders, build premiere intake system

**Completed:**
- ✅ Comprehensive codebase audit: 24 GitHub issues filed (#2-#25)
- ✅ **All 17 code issues resolved (#2-#18):** canonical formula (Craemer 2015), no fabricated data, no misattributed research, legal language disclaimed, blockchain claims updated, philosophical language fixed
- ✅ Deep research: Craemer, Darity/Mullen, Brattle Group, ICHEIC, South African TRC, Japanese internment, CARICOM, Ager/Boustan/Eriksson, Farmer-Paellmann
- ✅ Corporate calculator data updated with verified primary sources (CA DOI, JPMorgan Philadelphia 2024, Kornweibel, Southern Mutual UGA)
- ✅ 7 corporate disclosure PDFs downloaded + registered in person_documents
- ✅ Southern Mutual Insurance extraction: 37 enslaved persons, 27 enslavers in canonical_persons, OCR pipeline functional
- ✅ **ReparationsEscrow deployed to Base mainnet:** `0x914846ceA07e57d848d9d60C8238865D83d9ab1E`
  - 12/12 tests passing, USDC configured, revisable DAA amounts, 7-day timelock withdrawals
  - Owner: `0xD20a3CF9101948bE150C1ca3fa9a9bA60b3cfB3f` (MetaMask)
  - API route wired (`/api/blockchain/*`), document generators updated with live contract address
- ✅ Google Form intake structure designed + `scripts/validate-intake-form.js` + wealth fingerprint (Section 3b) + calculator wiring
- ✅ Piper diagnosed: living person ID insufficient without tree sharing — need grandparent IDs
- ✅ **Eli Neal climb launched:** Fagan line running (Gen 7+, 12 matches), Schwehr auto-queued

**Running (leave overnight Apr 5):**
- [ ] Slaveholder promotion: Louisiana DONE (15,840), Kentucky ~70% (24K+), 13 states queued. ~272K total.
- [ ] Eli Fagan climb: Gen 7, 12 matches, 75 ancestors queued
- [ ] Eli Schwehr climb: auto-starts after Fagan

**Remaining for Premiere (May 8-9):**
- [ ] Frontend: MetaMask → view DAA → deposit USDC flow (js/app.js contract interaction)
- [ ] Google Form: paste Section 3b (wealth fingerprint) into actual Google Form + run migration 037 on Neon
- [ ] Mac Mini: push all code changes, restart PM2
- [ ] Piper: get grandparent FS IDs from participant, run climbs
- [ ] Post-promotion verification: re-evaluate existing climb matches against new ~400K enslavers
- [ ] Transfer contract ownership to fresh wallet (security — deployer key exposed in chat)
- [ ] Research issues #19-#25 remain open (Darity/Mullen, wealth tracing, tiered payments, legal framework, ICHEIC, Brattle, revisable blockchain DAAs)

**Key Findings:**
- The Ager/Boustan/Eriksson 2.5x "wealth multiplier" does not exist in the cited paper
- DAAGenerator, DAADocumentGenerator, and generate-daa-pdf.js produce numbers differing by 37x
- Compound interest + inflation multiplier + wealth multiplier = triple-counting
- No attorney has reviewed the legal language in generated documents
- Corporate calculators use placeholder data to produce specific dollar amounts
- Brattle Group ($100-131T) is the macro ceiling — useful as sanity check
- Darity & Mullen model is superior but population-level — adaptation needed for individual DAAs
- Consider direct consultation with Darity/Mullen

---

### Phase 26: Name-Only Climbing Fixes (Mar 24-26, 2026) ✅
**Goal:** Fix name-only climbing for participants without FamilySearch IDs

**Completed:**
- ✅ Ryan Mills climb: first successful name-only climb, Gen 6+, 5 enslaver matches, deep Irish lineage
- ✅ Commit a86c51b: page recovery, session tracking, garbage detection overhaul
- ✅ Fix NOT NULL constraint on modern_person_fs_id for name-only sessions
- ✅ Fix session creation for name-only climbs
- ✅ Fix living person detection: check UNKNOWN before Person Not Found
- ✅ Match quality overhaul for name-only climbs

**Remaining:** CensusHousehold parser bug, circular result detection

---

### Phase 25: Enslaver Matching Gap + Mac Mini Deploy (Mar 20-23, 2026) ✅
**Goal:** Fix the 58% enslaver matching gap and deploy to Mac Mini

**Completed:**
- ✅ Backfilled 2,464 FS IDs from notes → person_external_ids
- ✅ Promoted 2,276 CivilWarDC slaveholders to canonical_persons
- ✅ Migration 035: Tier 2b matching (name + state when birth year NULL, confidence 0.60-0.70)
- ✅ 72,201 enslavers now matchable
- ✅ Adrian Brown climb COMPLETED (P4RF-PFQ): 3,922 ancestors, 9 matches
- ✅ Mac Mini deployed: git pulled e728c71, PM2 reconfigured, Chrome relaunched with port 9222
- ✅ Full stack verified: Pi kiosk → Mac Mini Express → FS climber → Neon DB
- ✅ Data Source Integration Contract (DATA_SOURCE_INTEGRATION_CONTRACT.md)

---

### Phase 24: Match Quality Overhaul — Race-Aware Verification (Mar 19, 2026) ✅ NEW
**Goal:** Eliminate false-positive slaveholder matches by adding race awareness, temporal validation, and common-name detection

**Completed:**
- ✅ Migration 034: verification columns on ancestor_climb_matches (verification_status, verification_evidence JSONB, confidence_adjusted, requires_human_review, review_reason)
- ✅ MatchVerifier service (`src/services/match-verification.js`): 7 disqualification checks + corroboration checks + priority-based verdict assembly
- ✅ Classification taxonomy: confirmed_slaveholder, enslaved_ancestor, free_poc, free_poc_slaveholder, temporal_impossible, common_name_suspect, ambiguous_needs_review, unverified
- ✅ SlaveVoyages API tightened: removed first-initial matching, threshold 0.55→0.65, temporal validation, exact whole-word surname
- ✅ Climber: race/occupation extraction from FS pages, MatchVerifier wired into match flow, registerRaceEvidence() learning loop
- ✅ Kiosk UI: 7 new classification badge CSS classes on tree nodes, cards view, lineage overlay
- ✅ API routes: kiosk.js + ancestor-climb.js return new verification columns
- ✅ Re-evaluation script (`scripts/re-evaluate-matches.js`): 131 matches → 76 temporal_impossible, 10 common_name_suspect, 45 unverified
- ✅ Integration tests: 6/6 pass (Amos Brown, John Smith, Paul Paynter, Angelica Chesley, Robert Wilson, Charles Brown)
- ✅ Commit e728c71 pushed to main

**Pending:** Mac Mini deploy + fresh test climb with live FS browser

---

### Phase 23: Distributed Ancestor Climber — Pi Kiosk → Mac Mini (Mar 11–16, 2026) ✅
**Goal:** Move Chrome/Puppeteer workload off Raspberry Pi to Mac Mini; Pi becomes touchscreen kiosk only

**Architecture:**
- **Raspberry Pi** → Kiosk UI (touchscreen input, status display)
- **Mac Mini (studio)** → Express server (0.0.0.0:3000), Chrome, climber processes
- **Neon PostgreSQL** → Session/match persistence (shared by all machines)
- **Machines connected via SSH over LAN**

**Completed Features:**
- ✅ Express binds `0.0.0.0` for LAN access from Pi and other devices
- ✅ Kiosk API (`src/api/routes/kiosk.js`): start-climb, climb-status endpoints
- ✅ Process orphaning: `nohup` + `spawn(detached:true)` + `proc.unref()` survives PM2 restarts
- ✅ macOS Chrome launch via `open -a "Google Chrome"` (SSH/PM2 can't access window server)
- ✅ Concurrent climbs: each climb gets own Chrome tab via `browser.newPage()`
- ✅ Confidence filtering: matches < 65% excluded (common name false positives)
- ✅ Virtual on-screen keyboard for touchscreen Pi input
- ✅ Kiosk auto-reset after 90s inactivity
- ✅ Mac Mini setup scripts (`scripts/mac-mini-setup/install.sh`, `install-services.sh`, `run-genealogy-suite.sh`)
- ✅ LaunchAgent plist for auto-start on Mac Mini login

**Files Added/Modified:**
- `src/api/routes/kiosk.js` — NEW: kiosk-specific endpoints
- `kiosk.html`, `js/kiosk.js`, `styles/kiosk.css` — NEW: touchscreen kiosk UI
- `src/api/routes/ancestor-climb.js` — process detachment fixes
- `scripts/scrapers/familysearch-ancestor-climber.js` — concurrent tabs, macOS launch, confidence filtering
- `src/server.js` — 0.0.0.0 binding, kiosk route mount
- `scripts/mac-mini-setup/*` — NEW: Mac Mini provisioning scripts

---

### Phase 22: Ancestor Climber Debugging & Scale Testing (Mar 11, 2026) ✅
**Goal:** Fix broken ancestor climb, verify working at scale on Mac, plan Pi optimization

**Root Causes Found & Fixed:**
- `launchBrowser()` was killing ALL Chrome instances via `pkill -9` — including logged-in sessions. Fixed to reuse existing Chrome with remote debugging on port 9222; only kills climber-specific temp profile instances.
- FamilySearch React SPA not rendering before data extraction — "Sign In" text extracted as person name. Added `waitForFunction` for page title pattern before extraction.
- FamilySearch redirecting `/tree/person/details/{ID}` to `/tree/pedigree/portrait/{ID}`. Added redirect detection + re-navigation, plus fallback portrait view parsing (Methods 4 & 5 in `extractPersonFromPage`).
- Session expiration mid-climb unhandled. Added re-login detection with 3-minute manual login window in BFS loop.
- Reduced excessive wait times (was 5–12s per ancestor, now 2–3s adaptive).

**Test Results (Mac):**
- Successfully climbed 20+ ancestors through 4+ generations
- Both parents found consistently for most ancestors
- Reaching 1860s-era ancestors (slavery period) by generation 4
- API endpoint (POST /api/ancestor-climb/start) spawns background process correctly
- Sessions trackable via GET /api/ancestor-climb/sessions and /session/:id

**Files Modified:**
- `scripts/scrapers/familysearch-ancestor-climber.js` — launchBrowser(), ensureLoggedIn(), BFS loop, extractPersonFromPage()

---

### Phase 21: Ancestor Climber Operationalization (Feb 28, 2026) ✅
**Goal:** Enable in-person sessions to trace a participant's ancestors to slaveholders using the FamilySearch workaround (no OAuth approval), with UI and API support.

**Completed Features:**
- ✅ Added backend API for climbs (work with existing v2 climber):
  - POST `/api/ancestor-climb/start` – launches local Chrome + climber script
  - GET `/api/ancestor-climb/sessions?fsId=...` – list climb sessions
  - GET `/api/ancestor-climb/session/:id` – session + matches
  - GET `/api/ancestor-climb/pending-verification` – review queue (unverified)
- ✅ Mounted routes in `src/server.js` and created `src/api/routes/ancestor-climb.js`
- ✅ Frontend “Trace Ancestors” panel + “Climb” nav in index.html
- ✅ js/app.js functions: `startAncestorClimbUI()`, `loadAncestorSessions()`, `loadAncestorSessionMatches()`, `loadPendingVerification()`
- ✅ Uses climber v2 strengths: ALL matches (no early stop), 1450 cutoff, session persistence, DocumentVerifier integration, diagnostics capture

**Operator Flow (Local Mac, Assisted Login):**
1. Ensure server is running on port 3000 (if EADDRINUSE, one is already running).
2. Visit http://localhost:3000 → “Trace Ancestors” → enter FamilySearch ID → Start Climb
3. Chrome opens locally; participant logs in to FamilySearch (first-time per machine/profile)
4. Monitor “Climb Sessions” and click a session to view live matches
5. Triage items in “Pending Verification”; classification remains UNVERIFIED until documents confirm

**Next Steps:**
- Background job/queue for multi-session concurrency on Mac minis
- Reviewer UI for document-backed verification and classification
- Headless mode trials with authenticated cookies (respecting ToS)
- Pipe verified matches to DAAOrchestrator for DAA generation

**Goal:** Add major historical data sources to scraping queue

**Completed:**
- ✅ Louisiana Slave Database (ibiblio.org/laslave) - 32 parish URLs queued
- ✅ UCL Legacies of British Slavery - 16 URLs queued (British compensation claims)
- ✅ Underwriting Souls - 23 URLs queued (insurance/financial enablers)
- ✅ FamilySearch Catalog - SC Probate records queued
- ✅ Created migration 009 for British colonial slavery data model

---

### Phase 20: Comprehensive Script Infrastructure (Dec 22-23, 2025) ✅ NEW
**Goal:** Build complete extraction, family linking, and descendant tracking infrastructure

**Completed Features:**

#### Civil War DC Genealogy Extraction Scripts
1. **`scripts/extract-civilwardc-genealogy.js`** (825 lines)
   - Extracts FULL genealogical data from 1,051 DC Emancipation petitions
   - Parses semantic HTML markup (`<span class="persName">`, `<span class="placeName">`)
   - Extracts: petitioners, enslaved persons, demographics, family relationships
   - Detects inheritance chains and previous owners from wills

2. **`scripts/reextract-civilwardc-families.js`** (590 lines)
   - Family-aware re-extraction for missed relationships
   - Detects patterns: "children of", "daughter/son of", "wife/husband of"
   - Dry run results: 467 relationships, 366 parent-child, 10 spouse links
   - Includes garbage name filtering

#### FamilySearch Pre-Indexed Extraction
3. **`scripts/extract-preindexed-data.js`** (509 lines)
   - Extracts volunteer-transcribed data from FamilySearch "Image Index" panel
   - Bypasses OCR errors by using pre-indexed (95% confidence) data
   - Puppeteer with stealth plugin for authenticated access
   - Supports interactive mode for cookie refresh

4. **`scripts/check-preindexed-coverage.js`**
   - Checks which pages have pre-indexed data vs need OCR fallback
   - Tests 15+ FamilySearch URLs from different states
   - Logs coverage statistics for data quality planning

#### WikiTree Descendant Tracking Suite
5. **`scripts/wikitree-batch-search.js`** (16KB)
   - Lightweight background process for continuous WikiTree searching
   - Rate-limited (1 search per 3 seconds)
   - Tries WikiTree IDs: `LastName-1` through `LastName-200`
   - Resumable via database queue
   - Modes: `--queue`, `--test`, `--stats`

6. **`scripts/wikitree-descendant-scraper.js`** (20KB)
   - Scrapes descendants from WikiTree profiles of confirmed enslavers
   - Max 8 generations, 500 descendants per profile (safety limits)
   - Parses GEDCOM descendant data from WikiTree HTML
   - Stores in `slave_owner_descendants_suspected`

#### Automation & Testing
7. **`scripts/run-census-scraper-resilient.sh`**
   - Shell wrapper for long-running census scraping
   - Auto-restarts on crash (10 max retries)
   - 30-second delay between retry attempts
   - Logs to `/tmp/arkansas-alabama-1860.log`

8. **`scripts/test-family-pattern.js`**, **`scripts/test-preindexed-batch.js`**, **`scripts/test-wikitree-debug.js`**
   - Testing and validation scripts for each system

---

### Phase 19: Descendant Tracking & WikiTree Integration (Dec 22, 2025) ✅
**Goal:** Build enslaved descendant credit tracking and systematic WikiTree search

**Completed Features:**

#### Enslaved Descendants CREDIT Schema
- ✅ `enslaved_descendants_suspected` - Private genealogy research (mirrors slaveholder schema)
- ✅ `enslaved_descendants_confirmed` - Opt-in verified descendants who are OWED credits
- ✅ `enslaved_credit_calculations` - Calculates reparations based on stolen labor value
- ✅ `wikitree_search_queue` - Lightweight queue for background WikiTree processing

**Migration:** `025-enslaved-descendant-credits.sql`

#### WikiTree Batch Search System
- ✅ Created `scripts/wikitree-batch-search.js` - Background-friendly search script
- ✅ Rate-limited profile checking (500ms between requests)
- ✅ Tries WikiTree ID patterns `LastName-1` through `LastName-200`
- ✅ Validates by checking name + location in profile HTML
- ✅ Queue-based with database persistence for resume capability
- ✅ Tested: Hopewell-1, Ravenel-5, multiple Coffin profiles found
- ✅ 20 high-confidence enslavers queued for processing

**Usage:**
```bash
node scripts/wikitree-batch-search.js --queue 100    # Queue enslavers
node scripts/wikitree-batch-search.js --test "Name"  # Test single name
node scripts/wikitree-batch-search.js               # Run continuously
```

#### Arkansas 1860 Slave Schedule Progress
- ✅ Pre-indexed extraction working (7,620 records at 95% confidence)
- ✅ 62/728 locations processed
- ✅ Data quality: 92% at 90%+ confidence
- 🔄 666 locations remaining

#### OCR Garbage Filter Fix
- ✅ Identified website UI text being extracted as person names
- ✅ Added garbage words: `genealogies`, `catalog`, `full`, `text`, `browse`, etc.
- ✅ Added garbage phrase detection: "genealogies catalog", "full text", etc.
- ✅ Cleaned 659 existing garbage records from database
- ✅ OCR fallback now properly filters UI artifacts

**Garbage Types Cleaned:**
| Type | Count | Issue |
|------|-------|-------|
| "Genealogies Catalog" | ~400 | FamilySearch navigation |
| "July" | ~250 | Date fragments |
| "Full Text" | ~9 | Button text |

**Files Created:**
- `migrations/025-enslaved-descendant-credits.sql`
- `scripts/wikitree-batch-search.js`
- `scripts/test-wikitree-debug.js`

**Files Modified:**
- `scripts/extract-census-ocr.js` - Enhanced `parseSlaveSchedule()` garbage filtering

---

### Phase 18: Data Quality & Ancestor Climber (Dec 20, 2025) ✅
**Goal:** Fix Civil War DC data quality issues and improve ancestor climber verification

**Completed Features:**

#### Civil War DC Data Fix
- ✅ Created `scripts/fix-civilwardc-data.js` - Template script for fixing petition data
- ✅ Extracts birth years from ages in context (1862 - age)
- ✅ Fixes locations to "Washington, D.C." (12,686 records had garbage data)
- ✅ Links enslaved persons to owners via relationships
- ✅ Cross-references table records with text records (handles Selina/Salina variants)
- ✅ Applied to 1,051 petitions, 35,944 records updated
- ✅ Williams family (cww.00035) verified: All 9 members now have birth years

#### Ancestor Climber Verification Improvements
- ✅ Disabled unreliable credit/debt classification (too many false positives)
- ✅ Added stricter verification requirements (document evidence + date matching)
- ✅ All matches now flagged as "UNVERIFIED - requires manual review"
- ✅ Fixed Lydia Williams false positive (user's ancestor 1746-1829 FREE ≠ DC enslaved 1838)

**Key Data Quality Issue Identified:**
- Civil War DC records had garbage single-word locations (e.g., `['Williams']` instead of `['Washington, D.C.']`)
- 53,349 records had garbage single-word names
- Many records missing birth years despite age being in context_text

**Files Created:**
- `scripts/fix-civilwardc-data.js` - Template data fix script

**Files Modified:**
- `scripts/scrapers/familysearch-ancestor-climber.js` - Stricter verification

---

### Phase 17: Corporate Entity & Farmer-Paellmann Integration (Dec 18, 2025) ✅
**Goal:** Track corporate entities involved in slavery and calculate their reparations debt

**Legal Reference:** In re African-American Slave Descendants Litigation, 304 F. Supp. 2d 1027 (N.D. Ill. 2004)

**Completed Features:**

#### Database Schema
- ✅ `corporate_entities` table - 17 Farmer-Paellmann defendants seeded
- ✅ `corporate_succession` table - Historical predecessor → modern successor chains
- ✅ `corporate_financial_instruments` table - Insurance policies, loans, mortgages
- ✅ `corporate_slaveholding` table - Direct ownership (BBH: 4,614 acres, 346 enslaved)
- ✅ `ipums_census_records` table - Ready for IPUMS Full Count data import
- ✅ `fips_states` table - 16 slave states seeded with FIPS codes

#### Sector-Specific Calculators
- ✅ `InsuranceCalculator.js` - Aetna, New York Life, Lloyd's, Southern Mutual, AIG
- ✅ `BankingCalculator.js` - FleetBoston, JP Morgan, Brown Brothers Harriman, Lehman
- ✅ `RailroadCalculator.js` - CSX, Norfolk Southern, Union Pacific, Canadian National

#### Enhanced DebtTracker
- ✅ Corporate debt tracking alongside individual slaveholders
- ✅ `addCorporateDebt()` method for sector calculator integration
- ✅ `getFarmerPaellmannDebts()` for all 17 defendants
- ✅ `getCombinedLeaderboard()` - Individuals + corporations ranked
- ✅ `calculateCombinedSystemDebt()` - System-wide totals

#### API Endpoints (`/api/corporate-debts/`)
- ✅ GET `/farmer-paellmann` - All 17 defendants
- ✅ GET `/farmer-paellmann/calculate` - Calculate all defendant debt
- ✅ GET `/entity/:id/debt` - Individual entity calculation
- ✅ GET `/leaderboard` - Corporate debt ranking
- ✅ GET `/sector/insurance|banking|railroads` - Sector calculations
- ✅ GET `/brown-brothers-harriman` - Most documented case

**Farmer-Paellmann Defendants (17 Total):**

| Sector | Count | Key Defendants |
|--------|-------|----------------|
| Banking | 4 | Bank of America, JP Morgan, Brown Brothers Harriman, Barclays |
| Insurance | 5 | CVS/Aetna, NY Life, Lloyd's, Southern Mutual, AIG |
| Railroads | 4 | CSX, Norfolk Southern, Union Pacific, Canadian National |
| Tobacco | 4 | RJ Reynolds, British American, Vector Group, Loews |

**Test Results (Dec 18, 2025):**
- Lloyd's of London: $1.8 quadrillion (insured entire Trans-Atlantic trade 1688-1807)
- CSX Corporation: $6.4 trillion (12 predecessor lines, 15,000 enslaved workers)
- Norfolk Southern: $4.1 trillion (10 predecessor lines, 12,000 enslaved)
- Brown Brothers Harriman: Direct slaveholding of 346 enslaved (4,614 acres Louisiana)

**IPUMS Census Status:**
- Request submitted to ipumsres@umn.edu for restricted slaveholder names
- 1850 Slave Schedule: 3,203,109 enslaved in 358,095 holdings
- 1860 Slave Schedule: 3,936,602 enslaved in 400,898 holdings
- Total: 7.1 million enslaved + ~395,000 named slaveholders (pending access)

**Files Created:**
- `migrations/021-corporate-entities-farmer-paellmann.sql`
- `migrations/022-ipums-census-integration.sql`
- `src/services/reparations/InsuranceCalculator.js`
- `src/services/reparations/BankingCalculator.js`
- `src/services/reparations/RailroadCalculator.js`
- `src/api/routes/corporate-debts.js`

---

### Phase 16: FamilySearch Census OCR Extraction (Dec 18, 2025) ✅
**Goal:** Extract enslaved persons from 1850/1860 Slave Schedule census images via OCR

**Completed Features:**

#### Location Crawler
- ✅ Enumerated 25,041 locations across FamilySearch collections
- ✅ 1850 Slave Schedule: 16,573 locations stored
- ✅ 1860 Slave Schedule: 8,468 locations stored
- ✅ All locations have waypoint URLs for image access

#### OCR Extraction Pipeline (`scripts/extract-census-ocr.js`)
- ✅ Puppeteer with stealth plugin for authenticated FamilySearch access
- ✅ Waypoint API integration (fetches from authenticated browser context)
- ✅ Drills down from County → District → Images hierarchy
- ✅ Google Vision OCR for census page text extraction
- ✅ Slave schedule format parser (Owner at top, enslaved by Age/Sex/Color)
- ✅ Owner-enslaved relationship linking via context_text
- ✅ Neon serverless database storage

**Test Results (20-County Batch):**
- Locations processed: 20
- Images processed: 100
- Owners extracted: 82
- Enslaved extracted: 170
- Errors: 0
- Elapsed time: 18m 41s

**Technical Fixes:**
- Fixed 403 Forbidden from waypoint API (use `page.evaluate()` with `credentials: 'include'`)
- Fixed location data ("county" → "district" in FamilySearch hierarchy)
- Fixed person endpoint using Neon serverless HTTP instead of pg Pool TCP
- Fixed owner linkage format: `"Name | Owner: OwnerName | County, State (Year)"`

**Files Created:**
- `scripts/extract-census-ocr.js` - Comprehensive OCR extraction script

---

### Phase 15: Production-Ready Refactoring (Dec 17, 2025) ✅
**Goal:** Comprehensive codebase refactoring, multi-table search, all tests passing

**Completed Features:**

#### Frontend Decomposition
- ✅ Split `index.html` from 2,765 lines to 346 lines
- ✅ Extracted `styles/main.css` (1,093 lines)
- ✅ Extracted `js/app.js` (1,331 lines)
- ✅ Updated `src/server.js` to serve new static directories

#### Codebase Cleanup
- ✅ Archived 89 obsolete files to `_archive/` directory
- ✅ Removed duplicate files (server.js, familysearch-integration.js, etc.)
- ✅ Organized into subdirectories by type (tests, html, js, docs, frontend, logs)

#### Chat Multi-Table Search
- ✅ Chat now searches ALL entity tables (was only `unconfirmed_persons`)
- ✅ Includes `enslaved_individuals` and `canonical_persons`
- ✅ Shows `[Confirmed]` and `[Canonical]` tags for verified records
- ✅ Fixed natural language parsing ("records about X", "people documented")

#### Search API Bug Fix
- ✅ Fixed UUID parsing error on `/api/contribute/search`
- ✅ Added explicit `/search` route before `/:sessionId` dynamic routes

#### Contribute.js Modularization
- ✅ Created `src/api/routes/contribute/` directory structure
- ✅ Added `shared.js` and `index.js` for future module composition

**Test Results:**
- Chat: 45/45 (100%)
- Documents: 8/8 (100%)
- Refactoring: 12/12 (100%)

**Files Created:**
- `styles/main.css` - Extracted CSS
- `js/app.js` - Extracted JavaScript
- `src/api/routes/contribute/shared.js` - Shared utilities
- `src/api/routes/contribute/index.js` - Module composition

**Files Modified:**
- `src/server.js` - Static file serving for new directories
- `src/api/routes/chat.js` - Multi-table search, improved NLP
- `src/api/routes/contribute.js` - Added `/search` route with query params
- `index.html` - Reduced to HTML structure only

---

### Phase 14: Document Viewer & Deduplication System (Dec 14, 2025) ✅
**Goal:** Fix document viewer S3 access, consolidate James Hopewell documents, add deduplication

**Completed Features:**

#### Document Viewer Fix
- ✅ Fixed `ecosystem.config.js` to load from `.env` (was using hardcoded old Render credentials)
- ✅ Added `/api/documents/archive/presign` endpoint for S3 presigned URLs
- ✅ Updated `openArchiveViewer()` in `index.html` to fetch presigned URLs before displaying

#### James Hopewell Documents
- ✅ Uploaded 2-page will to S3: `owners/James-Hopewell/will/page-1.pdf` and `page-2.pdf`
- ✅ Created unified document record with `ocr_page_count: 2`
- ✅ Added to `canonical_persons` (id: 1070) with descendant tracking notes
- ✅ Context: Slave owner (d. 1817, St. Mary's County, MD) with descendants traced to Nancy Miller Brown (Gen 8)

#### Document Deduplication System (Migration 017)
- ✅ New columns on `documents`: `document_group_id`, `page_number`, `is_primary_page`, `content_hash`
- ✅ `potential_duplicate_documents` view - finds suspicious document pairs
- ✅ `check_document_duplicates()` function - pre-insert duplicate check
- ✅ `merge_document_pages()` function - consolidates pages into single logical document
- ✅ `trg_warn_duplicate_document` trigger - logs warning on potential duplicates

#### Person Documents Index (Migration 016)
- ✅ `person_documents` junction table linking persons to S3 archived documents
- ✅ Views: `person_documents_with_names`, `person_document_counts`, `document_persons`
- ✅ Function: `get_person_documents(search_name)` for fuzzy search
- ✅ FamilySearch scraper updated to index documents during extraction

**Files Modified:**
- `ecosystem.config.js` - Now loads environment from `.env`
- `src/api/routes/documents.js` - Added presign endpoint
- `index.html` - Updated archive viewer
- `migrations/016-person-documents-index.sql` - New
- `migrations/017-document-deduplication.sql` - New

---

### Phase 13: Neon Database Migration & Search Fixes (Dec 14, 2025) ✅
**Goal:** Migrate to Neon serverless PostgreSQL and fix critical search bugs

**Completed Features:**
- ✅ Full database migration from Render PostgreSQL to Neon
  - 214,159 unconfirmed_persons
  - 1,401 enslaved_individuals
  - 1,068 canonical_persons
  - 726 confirming_documents
  - 4,192 scraping_queue
  - 2,887 scraping_sessions
- ✅ Fixed search returning unrelated names (OR→AND logic)
- ✅ Search now includes enslaved_individuals table (UNION query)
- ✅ Updated Render DATABASE_URL to use Neon

**Neon Database Credentials:**
```
Host: ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech
Database: neondb
User: neondb_owner
Connection: postgresql://neondb_owner:npg_2S8LrhzkZmad@ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
```

**Search Bug Fixes:**
1. "Grace Butler" was returning 50 unrelated names → Now returns 3 correct results
2. "Adjua D'Wolf" returned 0 results → Now returns 1 result from enslaved_individuals

**Frontend URL:** https://danyelajunebrown.github.io/Reparations-is-a-real-number/

---

### Phase 10: Name Resolution System (Dec 14, 2025) ✅
**Goal:** Build identity resolution system to link OCR name variants to canonical persons

**Problem:** The same person appears with different spellings across documents due to OCR errors and historical spelling variations (e.g., "Sally Swailes" vs "Sally Swailer" vs "Sally Swales").

**Completed Features:**
- ✅ NameResolver Service (`src/services/NameResolver.js`)
  - Soundex phonetic matching algorithm
  - Metaphone phonetic matching algorithm
  - Levenshtein distance fuzzy matching
  - Name parsing (first, middle, last, suffix)
  - Confidence thresholds (≥0.85 auto-match, 0.60-0.84 queue for review, <0.60 create new)
- ✅ Database Migration (`migrations/010-name-resolution-system.sql`)
  - `canonical_persons` table - TRUE identity of a person
  - `name_variants` table - Different spellings linking to canonical
  - `name_match_queue` table - Ambiguous matches for human review
- ✅ API Endpoints (`src/api/routes/names.js`)
  - POST /api/names/analyze - Analyze a name (parsing, phonetic codes)
  - POST /api/names/compare - Compare two names for similarity
  - POST /api/names/resolve - Resolve name to canonical or queue for review
  - GET /api/names/search/:name - Find similar names
  - GET /api/names/stats - System statistics
- ✅ Automatic Scraper Integration
  - FamilySearch scraper now auto-processes names through NameResolver
  - Each extracted name is resolved/linked/queued during save

**Key Design Decisions:**
- Soundex codes enable phonetic matching (Swailes → S420, Swailer → S420)
- Multiple match methods combined for confidence scoring
- Human review queue for ambiguous matches prevents false merges
- Canonical person represents TRUE identity, variants track appearances

**Test Results:**
- "Sally Swailes" vs "Sally Swailer" → 83% confidence (queued for review)
- "Sally Swailes" vs "Sally Swales" → Soundex match
- "William Key" vs "William Frey" → No match (different phonetic codes)

---

### Phase 11: Historical Reparations Petitions & Broken Promises (Dec 14, 2025) ✅ NEW
**Goal:** Track historical reparations petitions and measure the gap between promised and actual payments

**Problem:** The system only tracked future payments via blockchain, not historical successful (or failed) reparations awards. Cases like Belinda Sutton's 1783 petition prove systemic failure: awarded but only 23% paid.

**Completed Features:**
- ✅ Database Migration (`migrations/011-historical-reparations-petitions.sql`)
  - `historical_reparations_petitions` - Petition details, awards, decisions
  - `historical_reparations_payments` - Actual payments made (or not made)
  - `petition_fulfillment_analysis` - "Wrap around check" comparing promises vs payments
  - `petition_documents` - Multi-purpose evidence docs (proves enslavement + broken promises)
  - Views: `broken_promises_summary`, `comprehensive_debt_with_broken_promises`
- ✅ PetitionTracker Service (`src/services/reparations/PetitionTracker.js`)
  - Records petitions, awards, payments, and fulfillment analysis
  - Calculates broken promise penalties (50% on unpaid amounts)
  - Compound interest on delayed payments (2% annual)
  - Auto-calculates fulfillment percentage (promised vs paid)
  - Belinda Sutton case import function
- ✅ Smart Contract Updates (`contracts/contracts/ReparationsEscrow.sol`)
  - Added `historicalPaymentsReceived` field to AncestryRecord struct
  - Added `recordHistoricalPayment()` function
  - Added `verifyHistoricalPayment()` function
  - Added `getNetDebtOwed()` - accounts for historical + blockchain payments
  - Added `isDebtFullySettled()` - checks both payment sources

**Belinda Sutton Case (1783):**
- Petition filed: Feb 14, 1783
- Award granted: £15 annually + £12 back payment (lifetime)
- Payments made: Only 2 (£27 total)
- Fulfillment rate: 23%
- Status: BROKEN PROMISE
- Modern value unpaid: $76,500
- Broken promise penalty: $38,250
- Total additional debt: $114,750+

**Multi-Purpose Evidence:**
Documents like Belinda's petition prove MULTIPLE things simultaneously:
- Enslavement occurred (Isaac Royall owned her 50 years)
- Debt was recognized (Legislature granted award)
- Government broke promise (Only 23% paid)

**S3 Storage Structure:**
```
s3://reparations-documents/
├── documents/                    # Existing enslaved evidence
└── multi-purpose-evidence/       # NEW: Petitions/awards/failures
    └── belinda-sutton-case/
        ├── 1783-02-petition-original.pdf
        ├── 1783-02-legislative-grant.pdf
        ├── 1783-03-payment-voucher-1.pdf
        ├── 1784-03-payment-voucher-2.pdf
        └── 1787-follow-up-petition.pdf
```

---

### Phase 12: Business Proceeds Calculation System (Dec 14, 2025) ✅ NEW
**Goal:** Correct the reparations formula and create system for calculating enslaved person's portion of business proceeds

**CRITICAL CONCEPTUAL CORRECTION:**

**INCORRECT (Previous):**
```
Total Debt = Original Debt + Compensation TO Owners + Broken Promises
```

**CORRECT (Updated):**
```
Total Reparations = Wage Theft + Portion of Business Proceeds + Damages
```

**Key Insight:** Compensation TO owners is NOT added to debt directly. It is EVIDENCE of business value at time of emancipation. We use it to CALCULATE what portion of that business value belonged to the enslaved person.

**Completed Features:**
- ✅ Database Migration (`migrations/012-business-proceeds-calculations.sql`)
  - `business_asset_records` - Store business/asset data and valuations
  - `proceeds_calculation_methods` - Methodologies for calculating proceeds portion
  - `proceeds_research_needed` - Track historical research requirements
  - `calculated_reparations` - Final calculations with corrected formula
  - Views: `complete_reparations_breakdown`, `research_priority_summary`
- ✅ ProceedsCalculator Service (`src/services/reparations/ProceedsCalculator.js`)
  - PLACEHOLDER service with structure for future improvement
  - Multiple calculation methodologies (labor hours, human capital, productivity)
  - Research guidance by business type (plantation, factory, shipping, etc.)
  - Integration with calculated_reparations table
- ✅ Comprehensive Documentation (`REPARATIONS-FORMULA-CORRECTED.md`)
  - Complete explanation of corrected formula
  - Component breakdown (Wage Theft, Business Proceeds, Damages)
  - Research requirements by business type
  - Belinda Sutton example with corrected calculations

**The Corrected Formula Components:**

1. **Component 1: Wage Theft**
   - Unpaid wages for labor performed
   - Years × Fair market wage rate
   - Example: 50 years @ £20/year = $850,000 modern

2. **Component 2: Portion of Business Proceeds**
   - Enslaved person's share of business value/proceeds
   - Calculated by researching: Owner's assets → Determine enslaved contribution → That portion belongs to them
   - Compensation TO owner tells us business value; we calculate their percentage
   - Example: 30% of £10,000 estate = $2,550,000 modern

3. **Component 3: Damages**
   - Human rights violations, family separation, lost freedom
   - Base amount + compound interest for delayed justice
   - Example: $100,000 base × 146 (compound over 242 years) = $14,600,000

**Research Requirements:**
Each enslaved person's business proceeds calculation requires specific historical research:
- Owner's business assets and reports from the time period
- Business type (plantation, factory, shipping, banking, etc.)
- Labor organization, workforce composition, productivity metrics
- Revenue/profit data, cost structure
- Enslaved person's role, skill level, years of service

**Status:** System ready to hold and refine proceeds calculations with future research. ProceedsCalculator is a PLACEHOLDER with methodology structure awaiting specific historical research per case.

---

## Recent Achievements

### Week of Dec 10, 2025 ✅ NEW
**Focus:** Financial System & Data Source Expansion

**Completed:**
1. ✅ Built CompensationTracker for tracking historical payments TO owners
2. ✅ Created ReparationsSystem unified module
3. ✅ Fixed DebtTracker syntax errors (smart quotes)
4. ✅ Tested financial system with sample British and DC claims
5. ✅ Added 32 Louisiana Slave Database URLs to queue
6. ✅ Created migration 009 for British colonial slavery data

**Files Created:**
- `src/services/reparations/CompensationTracker.js`
- `src/services/reparations/index.js`
- `migrations/009-british-colonial-slavery.sql`
- `scripts/scrapers/familysearch-catalog-scraper.js`

**Key Technical Achievement:**
Dual-ledger financial model where compensation TO owners is treated as EVIDENCE of debt, not credit against it. The enslaved received $0 - their descendants are owed at minimum what the owners received.

---

### Week of Dec 9, 2025 ✅
**Focus:** FamilySearch Document Processing

**Completed:**
1. ✅ Processed Thomas Porcher Ravenel Papers (970 images)
2. ✅ Extracted 1,355 enslaved persons from plantation records
3. ✅ Reached 212,002 total database records
4. ✅ Built FamilySearch tile viewer scraper with Google OAuth support

---

## Feature Status Tracker

### Financial System ⭐ NEW

| Feature | Status | Notes |
|---------|--------|-------|
| ReparationsCalculator | ✅ Complete | Wage theft, damages, interest |
| DebtTracker | ✅ Complete | Ancestor debts, inheritance chains |
| CompensationTracker | ✅ Complete | British 1833, DC 1862 claims |
| ReparationsSystem | ✅ Complete | Unified interface |
| Blockchain Export | ✅ Complete | Ready for smart contract integration |

### Scraping System

| Feature | Status | Notes |
|---------|--------|-------|
| UnifiedScraper.js | ✅ Complete | 8 site-type handlers |
| Rootsweb Census | ✅ Complete | Primary source, 0.98 confidence |
| Civil War DC | ✅ Complete | Primary source, 0.95 confidence |
| Beyond Kin | ✅ Complete | Secondary source, 0.60 confidence |
| FamilySearch Scraper | ✅ Complete | Tile viewer + OCR |
| MSA Archive Scraper | ✅ Complete | PDF + OCR pipeline |
| LA Slave DB | ⏳ Queued | 32 parish URLs pending |
| UCL LBS | ⏳ Queued | 16 claim URLs pending |
| Underwriting Souls | ⏳ Queued | 23 URLs pending |

---

## Metrics & Statistics

### Production Stats (Dec 14, 2025) - UPDATED
- **Database:** Neon PostgreSQL (migrated from Render)
- **Total unconfirmed_persons:** 214,159
- **Total enslaved_individuals:** 1,401 (confirmed)
- **Total canonical_persons:** 1,068
- **Confirming documents:** 726
- **Scraping queue:** 4,192
- **Scraping sessions:** 2,887
- **FamilySearch Ravenel Papers:** 1,355 records (970 images)
- **MSA Montgomery County:** ~5,367 records
- **Target Slaveholders:** 393,975

### Financial System Test Results
- **British Claim Example:** £26,309 → $2.69B proven debt
- **DC Claim Example:** $4,500 → $19M proven debt
- **Conversion Rates:** GBP 1834 = $50/£, USD 1862 = $30/$

---

## Data Sources

### Primary Sources (Census-Level Evidence)
| Source | Confidence | Status | Records |
|--------|------------|--------|---------|
| 1860 Slave Census (Rootsweb) | 0.98 | ✅ Complete | 11,000+ |
| DC Emancipation Petitions | 0.95 | ✅ Complete | 1,089 |
| FamilySearch Ravenel | 0.85 | ✅ Complete | 1,355 |
| MSA Montgomery County | 0.90 | ✅ Complete | 5,367 |

### Financial/Economic Sources
| Source | Status | Data Type |
|--------|--------|-----------|
| UCL LBS | ⏳ Queued | British compensation claims |
| Underwriting Souls | ⏳ Queued | Insurance policies on enslaved |
| DC Compensation Records | ⏳ Ready | 1862 emancipation payments |

### Regional Sources
| Source | Status | Coverage |
|--------|--------|----------|
| Louisiana Slave DB | ⏳ Queued | 32 Louisiana parishes |
| SC Probate Catalog | ⏳ Queued | Estate/will records |

---

## Roadmap

### Q4 2025 🎯

#### December 2025 (Remaining)
**Focus:** Complete Active Extraction & WikiTree Processing

**In Progress:**
- [ ] Complete Arkansas 1860 Slave Schedule (~400 locations remaining)
- [ ] Finish MSA Vol 812 reprocessing (pages 97-132)
- [ ] Run WikiTree batch search continuously
- [ ] Execute Civil War DC family re-extraction

**Completed This Month:**
- [x] Built comprehensive script infrastructure (8 major scripts)
- [x] Enslaved descendant credit tracking schema (migration 025)
- [x] WikiTree batch search + descendant scraper
- [x] Pre-indexed data extraction (95% confidence)
- [x] Civil War DC genealogy extraction
- [x] Family relationship pattern detection
- [x] OCR garbage filtering improvements
- [x] Data quality fixes for 35,944 DC records
- [x] CompensationTracker financial system
- [x] Corporate entity Farmer-Paellmann integration

### Ph
**Goal:** Build comprehensive legal infrastructure for reparations claims across ALL Triangle Trade jurisdictions

**Completed Features:**
- ✅ Migration 031: Triangle Trade Legal Framework
  - Legal jurisdictions table (UK, France, Haiti, US, Spain, Netherlands, Portugal)
  - Legal texts and statutes table with key provisions
  - UK 1833 loan data (paid off 2015 - PRIMARY PRECEDENT)
  - Haiti independence debt ($21B inverse reparations)
  - Farmer-Paellmann failure analysis with changed circumstances
  - Legal doctrines (unjust enrichment, constructive trust, successor liability, badges/incidents)
  - Garnishment mechanisms with Mullen/Darity assessment
  - Escrow tracking for when "somebody bites"
- ✅ LegalPrecedentService.js - Query service for all legal data
- ✅ API routes (/api/legal/*) for:
  - GET /precedents - All precedents ranked by strength
  - GET /uk-1833 - Primary precedent
  - GET /haiti - Counter-precedent (inverse reparations)
  - GET /farmer-paellmann - Strategic lessons from 2004 failure
  - GET /jurisdictions - All Triangle Trade jurisdictions
  - GET /doctrines - Legal theories applicable to reparations
  - GET /mechanisms - Garnishment approaches by defendant type
  - GET /daa-citations/:jurisdiction/:defendantType - Build DAA citations

**Key Strategic Decisions:**
1. **Individual DAAs (A)** = Our way in (avoids Farmer-Paellmann standing issues)
2. **Class action (B)** = Secondary, always thinking class action
3. **Government taxation (C)** = ONLY ethical mechanism per Mullen/Darity - ultimate goal
4. **Escrow strategy** = Credit distribution when payments arrive, not before

**Legal Texts Added:**
- Slavery Abolition Act 1833 (UK)
- Code Noir 1685 & Louisiana 1724 (France)
- Treaty of Utrecht / British Asiento 1713 (Spain)
- Moret Law 1870 & Cuba Abolition 1886 (Spain)
- Netherlands 2023 Apology & €200M Fund

---

### Q2 2026 🔮 (Updated Apr 4, 2026)

#### April 2026 — Methodology Integrity Overhaul
**Focus:** Fix all critical/high/medium issues before premiere
- [ ] Issue #2: Establish ONE canonical formula with sourced constants
- [ ] Issue #3: Stop fabricating "Unnamed enslaved person(s)"
- [ ] Issue #4: Remove misattributed Ager 2.5x multiplier
- [ ] Issue #5: Fix triple-counting (compound interest + inflation + wealth multiplier)
- [ ] Issue #6: Legal review of document language
- [ ] Issue #7: Gate corporate calculators behind "research in progress" flag
- [ ] Issue #8: Remove TODO markers from generated documents
- [ ] Issues #9-14: Fix inconsistent rates, calibrate scores, source conversions, remove unsourced constructs
- [ ] Issues #15-18: Fix header, stale percentage, language, dead code
- [ ] Re-run Piper's climb (LTVZ-D9S) with confirmed FS session
- [ ] Fix climber to fail loudly when living person yields 0 parents
- [x] Build intake validation pipeline (validate-intake-form.js + wealth fingerprint + calculator wiring)
- [ ] Paste final form into Google Forms + run migration 037 on Neon

#### May 2026 — Premiere
- **May 8-9:** Film premiere with participant intake
- [ ] Google Form live and accepting submissions
- [ ] Validation script processing responses
- [ ] Ancestor climbs queued from validated grandparent FS IDs
- [ ] DAA generation with defensible methodology (or transparent "research in progress" framing)
- [ ] MetaMask collection (if blockchain architecture is ready; if not, be transparent)

#### Research Agenda (Ongoing)
- [ ] Issue #19: Operationalize Darity & Mullen for individual DAAs — consider direct consultation
- [ ] Issue #20: Methodology for tracing antebellum wealth to present-day holdings
- [ ] Issue #21: Tiered payment structure
- [ ] Issue #22: Legal framework for DAA enforceability
- [ ] Issue #23: Adapt ICHEIC methodology for trans-Atlantic slavery
- [ ] Issue #24: Harvest Brattle Group forensic economics data
- [ ] Issue #25: Blockchain architecture for revisable DAAs

---

## Current Active Scripts Reference

| Script | Purpose | Status |
|--------|---------|--------|
| `familysearch-ancestor-climber.js` | BFS ancestor climbing from FS IDs | Active (Mac Mini) |
| `validate-intake-form.js` | Google Form CSV validation + wealth flag | Updated Apr 16 |
| `extract-preindexed-data.js` | FamilySearch pre-indexed extraction | Active |
| `extract-census-ocr.js` | 1860 Slave Schedule OCR extraction | Active |
| `re-evaluate-matches.js` | Match verification re-evaluation | Ready |
| `generate-comprehensive-daa.js` | DAA generation from climb data | Needs overhaul (Issue #2) |

---

## Lessons Learned

### December 10, 2025 - Financial System
**Key Insights:**
1. **Compensation ≠ Credit** - Payments TO owners prove debt, they don't reduce it
2. **Dual-ledger model** - Separate evidence tracking from payment tracking
3. **Historical conversion** - Currency values must account for inflation + interest
4. **Damages compound** - Delayed justice adds ~2%/year to debt

**What Went Well:**
1. Clean integration with existing DebtTracker
2. Flexible import methods for different data sources
3. Comprehensive test coverage with sample data

---

## Success Stories 🎉

### 7. Financial System Architecture (Dec 10, 2025) ⭐ NEW
**Challenge:** Integrate compensation TO owners into debt system TO descendants
**Solution:** Dual-ledger model - compensation as EVIDENCE of debt
**Impact:** Can now calculate proven debt from historical records
**Key Insight:** £26,309 British claim → $2.69B modern debt

### 6. FamilySearch Document Processing (Dec 9, 2025)
**Challenge:** Extract names from handwritten plantation records
**Solution:** Tile viewer scraper + Google Vision OCR
**Impact:** 1,355 enslaved persons from 970 images

### 5. Unified Scraping System (Dec 2, 2025)
**Challenge:** Fragmented scrapers with broken dependencies
**Solution:** Created UnifiedScraper.js with 8 site handlers
**Impact:** 5,105+ persons extracted, backlog processing automated

---

## Next Milestone

**Target Date:** May 8, 2026

**Goal:** Premiere-Ready System with Defensible Methodology

**Deliverables:**
- [ ] ONE canonical calculation formula with every constant sourced
- [ ] No fabricated data in any generated document
- [ ] No misattributed research citations
- [ ] Generated documents reviewed for legal language appropriateness
- [ ] Google Form live and accepting participant intake (Section 3b needs pasting)
- [x] Validation pipeline processing and queuing climbs (+ wealth fingerprint + calculator wiring)
- [ ] Transparent "research in progress" framing where methodology is still developing
- [ ] 1,800,000+ total database records

---

### April 4, 2026 - Methodology Integrity
**Key Insights:**
1. **Every constant needs a citation** — if the research doesn't exist, we don't use the number
2. **The genealogical pipeline is solid** — the climber + match verification is the project's strength; lean on it
3. **The financial calculation code is not ready** — three formulas producing 37x divergence is not acceptable
4. **Build iteratively** — we will not get the methodology right on the first try
5. **The Ager/Boustan/Eriksson finding** is about social capital ↔ financial capital conversion, not a numerical multiplier
6. **Living descendants inherit an unpaid debt** — they are not being debited retroactively for crimes they weren't party to. The architecture must consistently reflect this.
7. **Brattle Group $100-131T** is the macro ceiling — individual DAA methodology should not exceed this when extrapolated

---

*This document tracks development progress and is updated regularly as features are completed.*
