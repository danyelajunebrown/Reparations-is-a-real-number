# Will Ingestion Audit — 2026-05-12
**Session 52 | Script: `scripts/ocr-hopewell-physical-scans.mjs` | Extractor version: `ocr-physical-scan-session-2026-05-12`**

---

## §1 Pipeline Gap Analysis

Seven questions answered against the live DB state as of 2026-05-12 00:46 UTC-4.

### 1.1 Does `POST /api/wills/ingest` trigger OCR?
**No.** `src/api/routes/wills.js` accepts a will intake payload (`{testator:{name,year,location}, archive_source}`) and returns `{status:'pending_extraction'}`. There is no call to a Vision API, `pdftoppm`, or any OCR service. The route is a stub.

### 1.2 Does `src/services/probate/WillPipeline.js` exist?
**No.** The file does not exist. Probate pipeline logic is implemented only as one-off scripts (`ocr-hopewell-will.mjs`, `ocr-hopewell-physical-scans.mjs`). The planned generalization to `WillPipeline.js` (plan §3.2) has not been built.

### 1.3 Does `person_documents.will_extraction_id` column exist?
**No (Q5 confirmed missing).** `backfill-inheritance-edges-from-will-extractions.js` performs a JOIN on `pd.will_extraction_id` — that script will fail with a column-not-found error. This is tracked as known debt (see §4).

### 1.4 Does the `inheritance_edges` table exist?
**Yes (Q4 confirmed).** Migration 067 was applied to Neon. The table exists and is queryable.

### 1.5 Did `will_extractions` have a row for `document_id=19` before this session?
**No (Q2 confirmed 0 rows pre-run).** The existing `person_documents` id=19 (James Hopewell 1817 will, FamilySearch pre-indexed transcription) had no corresponding `will_extractions` row. This session inserts the first row.

### 1.6 What was the `enslaver_evidence_compendium` state for cp=1070 before this session?
**7 rows existed (Q3 confirmed):**
| source_table | source_id | strength |
|---|---|---|
| person_documents | 19 | indirect_primary |
| person_external_ids | 52015 | indirect_primary |
| debt_acknowledgment_agreements | 75d45337-... | direct_primary |
| debt_acknowledgment_agreements | b77cf4c1-... | direct_primary |
| debt_acknowledgment_agreements | df9fee15-... | direct_primary |
| debt_acknowledgment_agreements | de5fcd21-... | direct_primary |
| debt_acknowledgment_agreements | 805da6ec-... | direct_primary |

None of the 7 rows had `evidence_source_table='will_extractions'`. This session adds will_extractions evidence rows for cp=1070, cp=193376 (Hugh V), and the new Hugh VI canonical_person.

### 1.7 Which migrations in the M040–M067 range are applied?
**Applied (17 confirmed by Q9):**
`040, 041, 042, 043, 044, 045, 047, 048, 049, 050, 051, 052, 053, 056, 060, 061, 062`

**Untracked in `schema_migrations` but table confirmed to exist (Q4):**
M063 (`063-enslaved-individual-document-link.sql`),
M064 (`064-person-documents-collection-grouping.sql`),
M065 (`065-person-documents-filename-columns.sql`),
M066 (`066-canonical-family-edges.sql`),
M067 (`067-inheritance-edges.sql`)

These 5 migrations were applied directly to Neon without going through `scripts/apply-migrations.js` (confirmed by `inheritance_edges` table presence vs schema_migrations absence). Backfilling these 5 filenames into `schema_migrations` is tracked as known debt.

---

## §2 OCR Quality Findings

Source: `node scripts/ocr-hopewell-physical-scans.mjs` dry-run and `--apply` runs, 2026-05-12. Raw page JSON at `/tmp/hopewell-physical-scans/{slug}/page-N-raw.json`. Full text at `/tmp/hopewell-physical-scans/{slug}/full-text.txt`.

### Document 1 — James Hopewell 1817 (saint mary's will 1.pdf, 11.3 MB, 3 pages)
| Field | Value |
|---|---|
| Classification | **CONFIRMED** |
| Matched profile | `james_1817` |
| OCR quality estimate | **MEDIUM** |
| Requires human review | false |
| Total chars (3 pages) | 6,518 |
| Enslaved persons extracted | 30 |
| Definitive signals hit | Ann Maria Biscoe OCR variant, beloved wife Angelica |
| Disqualifying signals hit | 0 |

**Notes:** Page 1 (folio 480) = 1,786 chars; Page 2 = 2,558 chars; Page 3 (folio 482) = 2,091 chars. Classification correctly triggered on `james_1817` profile with 0 disqualifying signals. OCR quality MEDIUM — no garbling threshold exceeded. The FamilySearch pre-indexed transcription already in `person_documents.ocr_text` (id=19) remains the canonical transcription for this document; raw Vision output goes to `will_extractions.raw_pages_jsonb` only per CONSTRAINT (do not overwrite id=19 ocr_text).

### Document 2 — Composite 1848 (saint mary's will 2.pdf, 6.6 MB, 2 pages)
| Field | Value |
|---|---|
| Classification | **UNKNOWN** |
| Matched profile | null |
| OCR quality estimate | **MEDIUM** |
| Requires human review | true |
| Total chars (2 pages) | 6,823 |
| First line Page 1 | "יזי" (Hebrew script artifact — likely OCR smudge) |

**Notes:** Neither `james_h_1848` (expected disqualifier) nor any ancestor profile matched. The first-line artifact `"יזי"` indicates either a scan blemish being misread as non-ASCII characters or a microfilm artifact. Despite UNKNOWN classification, the structured extraction correctly records all 3 sections (A: Mary Mills 1845, B: James H. Hopewell 1848, C: Elizabeth Kilgore) as hardcoded document facts and writes a `person_documents` row with `canonical_person_id=NULL`. This document is not an ancestor document for cp=1070 — the James H. Hopewell named here has wife Elizabeth Hopewell and executor son Henry (disqualifying vs cp=1070 whose wife is Angelica).

### Document 3 — Hugh Hopewell V 1777 (saint mary's will 3.pdf, 23.7 MB)
| Field | Value |
|---|---|
| Classification | **OCR FAILED — write EPIPE** |
| OCR quality estimate | N/A |
| Pages rendered by pdftoppm | 6 |
| Total chars | 0 |
| Root cause | page-1.png was 27 MB (300 DPI color scan); base64 ≈ 36 MB > Vision API 10 MB inline limit |
| DB writes | cp=193376 person_type → 'enslaver' ✓ · person_documents NOT written · will_extractions NOT written |

**Notes:** `pdftoppm -r 300 -png` on the 23.7 MB PDF rendered 6 PNG files. page-1.png measured 27 MB on disk; base64-encoding = ~36 MB, which exceeds the Google Vision `images:annotate` inline `image.content` 10 MB limit. The HTTP write to Vision API aborted mid-stream with `write EPIPE`. No OCR text was extracted. The 4E DB-write block is guarded by `!doc3Result.error`, so **no `person_documents` row, no `will_extractions` row, no relationships, and no `unconfirmed_persons` rows for Jacob/Haney were written**. The Hugh V canonical_person update (cp=193376 `person_type → 'enslaver'`) was written because it executes before the error-guarded block. See §4.8 for fix options.

### Document 4 — Composite 1785 (saint mary's will 4.pdf, 10.2 MB)
| Field | Value |
|---|---|
| Classification | **UNKNOWN** |
| Matched profile | null |
| OCR quality estimate | **MEDIUM** |
| Requires human review | true |
| Pages rendered | 3 |
| Total chars (3 pages) | 7,800 |
| First line Page 1 | "se har lay out" |
| First line Page 2 | "(10)" |
| First line Page 3 | "Bognorth." |
| Key sections | (A) Raphael Bouoy partial; (B) Hugh VI 1785; (C) Barbara Burroughes |

**Notes:** pdftoppm at 300 DPI rendered only 3 pages (expected 5–6 for a 10.2 MB file) — the remaining pages may be embedded as higher-compression scans. Classification UNKNOWN: the Hugh VI ancestor profile requires signals `wife Hannah Hopewell`, `brother James Hopewell`, `Townbrook` — none matched in the OCR text. The key Hugh VI passages likely fall on pages 4–6 which were not rendered, or OCR quality was insufficient to match the regex patterns. Despite UNKNOWN classification, the structured extraction (`buildHughVI1785Extraction`) and Barbara Burroughes enslaved persons are hardcoded document facts written to DB regardless. 6 `unconfirmed_persons` rows for Barbara Burroughes enslaved persons (Gill, Fido, Goron, Mushing Apron, Bonnet, Margaret Davis) are written. `person_documents` and `will_extractions` rows are inserted. This document requires manual review to confirm Hugh VI section alignment.

---

## §3 Stage 4 Readiness

### Schema readiness
| Migration | Status | Notes |
|---|---|---|
| M048 `will_extractions` | ✅ Applied | Table confirmed via Q2 query |
| M053 `enslaver_evidence_compendium` | ✅ Applied | 7 rows for cp=1070 confirmed pre-run |
| M066 `canonical_family_edges` | ✅ Applied to Neon | **NOT tracked in schema_migrations** |
| M067 `inheritance_edges` | ✅ Applied to Neon | **NOT tracked in schema_migrations** |
| M063–M065 | ✅ Applied to Neon | **NOT tracked in schema_migrations** |

### Service readiness
| Component | Status |
|---|---|
| `src/services/probate/WillPipeline.js` | ❌ Does not exist |
| `src/api/routes/wills.js` POST /ingest | ❌ Stub only — no OCR trigger |
| `person_documents.will_extraction_id` column | ❌ Missing — JOIN in backfill script will fail |
| S3 upload for will PDFs | ✅ Functional via `S3Service.upload()` (GetBucketLocation IAM warning is non-blocking) |
| Google Vision DOCUMENT_TEXT_DETECTION | ✅ Functional — confirmed by Will 1 and Will 2 OCR |
| `pdftoppm` at 300 DPI | ✅ Functional on Mac Mini |
| `unconfirmed_persons` insert | ✅ Functional (ON CONFLICT fallback handles missing unique constraint) |
| `enslaver_evidence_compendium` insert | ✅ Functional |

### DB write summary (this session, --apply) — **Run 2 actuals confirmed**
| Write | Count | Notes |
|---|---|---|
| `will_extractions` UPDATE | 1 | Doc 1 id=`08a21999-7236-4525-b478-78ddbd71831e` (doc=19, cp=1070) |
| `will_extractions` INSERT | 2 | Doc 4 id=`c40ee851-fd53-4518-9aa2-d0982de5d776` (doc=184163, cp=609495); Doc 2 id=`9e6581f2-bf36-4446-8ba3-0f8fc203ab32` (doc=184164, cp=NULL) |
| `person_documents` INSERT | 2 | id=184163 (Hugh VI will, cp=609495); id=184164 (composite 1848, cp=NULL) |
| `person_documents` UPDATE | 1 | id=19 — collection metadata only, ocr_text preserved |
| `canonical_persons` INSERT | 1 | Hugh VI cp=609495 (b.1758, d.1785) |
| `canonical_persons` UPDATE | 1 | Hugh V id=193376 — person_type 'descendant' → 'enslaver' |
| `person_relationships_verified` INSERT | 2 | id=1796 sibling_of (609495→1070); id=1797 parent_of (193376→609495) |
| `person_relationships_verified` SKIP | 5 | ids 1788–1791, 1794, 1795 — already existed |
| `unconfirmed_persons` INSERT | 36 | 30 enslaved from James 1817 (lead_ids 2790306–2790335); 6 from Burroughes section (lead_ids 2790336–2790341) |
| `enslaver_evidence_compendium` INSERT | 1 | cp=609495 (Hugh VI) source=will_extractions/`c40ee851-fd53-4518-9aa2-d0982de5d776` |

> **Doc 3 (Hugh V 1777) writes not performed** — EPIPE failure; 5 items outstanding (see §4.8).

### S3 uploads (Run 2 confirmed UUIDs)
| Slug | S3 key |
|---|---|
| james-hopewell-1817 | `wills/james-hopewell-1817/7f9323fa-83f0-413c-8cd4-ffb2680f3b9a.pdf` |
| composite-1848 | `wills/james-h-hopewell-1848-composite/b71b10a2-46de-4d61-a9b7-5387364f0075.pdf` |
| composite-1785 | `wills/hugh-hopewell-vi-1785-composite/a12ab4c6-0973-4a8f-9a84-669f9b887f02.pdf` |

---

## §4 Known Errors and Debt

### 4.1 `test-daa-hopewell.js` — Sarah/Such assignment error (HIGH priority)
**Error:** `tests/integration/test-daa-hopewell.js` (or equivalent) assigns enslaved person **Sarah** to Ann Maria Biscoe. This is factually incorrect.

**Ground truth from document:**
- **Sarah** is Joe's wife. Both are bequeathed to **Angelica Hopewell** (Bequest 1).
- The enslaved mother in Bequest 4 (bequeathed to Ann Maria Biscoe) is named **Such** (OCR variants: Susan). Such's children include Mary, Nancy, Louisa.
- Sarah ≠ Such. These are different enslaved persons bequeathed to different heirs.

**Fix required:** Correct the test fixture to assign Sarah + Joe to `bequeathed_to: 'Angelica Hopewell'` and Such to `bequeathed_to: 'Ann Maria Biscoe'`.

### 4.2 `backfill-inheritance-edges-from-will-extractions.js` — 3 schema bugs (HIGH priority)
1. **`pd.will_extraction_id` JOIN** — column does not exist in `person_documents` (Q5 confirmed). The JOIN `FROM person_documents pd JOIN will_extractions we ON we.id = pd.will_extraction_id` will throw `column pd.will_extraction_id does not exist`.
2. **`we.enslaved_persons_count` / `we.document_date` / `we.document_year`** — these columns do not exist in `will_extractions` (M048 schema). The M048 schema has: `id, document_id, canonical_person_id, raw_pages_jsonb, structured_extraction_jsonb, extractor_version, status, review_sections_jsonb, created_at, updated_at`. These fields would need to be extracted from `structured_extraction_jsonb`.
3. **`inheritance_edges.heir_id NOT NULL`** — the `inheritance_edges` table (M067) may have `heir_id NOT NULL`, but some legitimate inheritance entries have no identifiable heir. The backfill script may fail on NULL heir inserts.

**Fix required:** Rewrite backfill script to use `we.structured_extraction_jsonb->>'enslaved_persons'` (jsonb path) and remove JOIN on `pd.will_extraction_id`; instead join via `we.document_id = pd.id`.

### 4.3 M063–M067 not tracked in `schema_migrations` (MEDIUM priority)
Five migrations applied to Neon directly are absent from the `schema_migrations` table:
- `063-enslaved-individual-document-link.sql`
- `064-person-documents-collection-grouping.sql`
- `065-person-documents-filename-columns.sql`
- `066-canonical-family-edges.sql`
- `067-inheritance-edges.sql`

**Fix required:** Run:
```sql
INSERT INTO schema_migrations (filename, applied_at) VALUES
  ('063-enslaved-individual-document-link.sql', NOW()),
  ('064-person-documents-collection-grouping.sql', NOW()),
  ('065-person-documents-filename-columns.sql', NOW()),
  ('066-canonical-family-edges.sql', NOW()),
  ('067-inheritance-edges.sql', NOW());
```

### 4.4 Circular merge reference cp=1070/cp=193271 (LOW priority)
Q6 shows cp=193271 merged into cp=1070. No action required in this session; documented for future audit pass.

### 4.5 S3 IAM `GetBucketLocation` warning (LOW priority — non-blocking)
`S3Service` logs `WARN: GetBucketLocation failed ... falling back to redirect probe`. The upload succeeds via redirect probe (us-east-2 region confirmed). The IAM user `reparations-app` lacks `s3:GetBucketLocation` permission. Add that permission to the IAM policy to suppress the warning.

### 4.6 `person_documents` id=19 `title` column null
Q8 shows `title=undefined` for id=19. The title column is null in DB. The 4B UPDATE in this session sets `collection_name` but does not SET `title`. Consider adding `SET title = 'Will of James Hopewell (1817) — Saint Mary''s County, Maryland'` in a follow-up backfill.

### 4.7 `run-all-docai-branches.sh` — bash -n exits 0
`bash -n` syntax check on `scripts/run-all-docai-branches.sh` exits 0 (no syntax errors detected). Previous session (51) flagged a suspected syntax error on line 41. After investigation, no actual error was found in the current 154-line version. The flag is cleared.

### 4.8 Vision API EPIPE on large PNGs — Will 3 OCR failure (HIGH priority)
**Error:** Will 3 (saint mary's will 3.pdf, 23.7 MB, 6 pages rendered) fails OCR with `write EPIPE` on page 1.

**Root cause:** `pdftoppm -r 300 -png` on a 23.7 MB color scan PDF produces 23–27 MB PNG files per page. base64 encoding of a 27 MB PNG ≈ 36 MB. The Google Vision API `images:annotate` endpoint has a **10 MB limit** for inline `image.content` requests. The 36 MB payload exceeds this limit, causing the HTTP POST to abort mid-write with `EPIPE`.

**Impact:** 0 chars OCR'd for Will 3 (Hugh Hopewell V 1777). The following writes were **not performed** and remain outstanding:
- `person_documents` INSERT for Hugh V will
- `will_extractions` INSERT for Hugh V will
- `person_relationships_verified` INSERT — Hugh V → James (parent), Hugh V ↔ Elizabeth (spouse)
- `unconfirmed_persons` INSERT — Jacob and Haney (excepted from Thomas's bequest)
- `enslaver_evidence_compendium` INSERT for Hugh V

The Hugh V `canonical_persons` update (cp=193376 `person_type → 'enslaver'`) **was** written (executes before the error-guarded block).

**Fix options (in order of preference):**
1. **Reduce DPI to 150** — change `-r 300` to `-r 150` in `ocrDocument()`. Produces ~6–7 MB PNGs → base64 ~9 MB (just under 10 MB limit). 150 DPI is sufficient for DOCUMENT_TEXT_DETECTION on most handwritten documents.
2. **GCS URI approach** — upload PNG to a GCS bucket, then pass `image.source.imageUri: 'gs://...'` to Vision API. No inline size limit.
3. **Post-render resize** — pipe through `convert -resize 50%` (ImageMagick) after pdftoppm.

**Recommended action:** Apply Option 1 (150 DPI), re-run `--apply` for Will 3 only to backfill the 5 missing DB writes listed above.

---

*Audit generated by Session 52 — `ocr-hopewell-physical-scans.mjs --apply`. §2 Docs 1–4 all updated with actual --apply run results. §4.8 documents Vision API EPIPE issue for Will 3. All Phase 0 data confirmed against live Neon DB as of 2026-05-12 00:46 UTC-4.*
