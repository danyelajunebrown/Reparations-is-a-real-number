# Active Context — Reparations Platform

_Last updated: 2026-05-12 (Session 52 — Hopewell Physical Scan OCR + Will Ingestion Audit)_

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
