# Plan — Georgia Probate Scraper: Extraction Quality Rebuild

**Date:** 2026-05-20
**Status:** Plan, pending user review + Liberty County test-people website
**Scope:** `scripts/scrapers/georgia-probate-scraper.js` and a new probate extraction pipeline
**Relationship to prior plan:** Extends `plan-apr29-will-source-registry-dual-ledger-daa.md`.
That plan built the will-extractor architecture for *user-uploaded PDF wills*. The
FamilySearch bulk scraper never adopted it — it still uses a crude regex parser. This
plan brings the scraper up to the same standard.

---

## 0. Goal

For every probate document in the FamilySearch "Georgia Probate Records, 1742-1990"
collection (Liberty County first), reliably lift:

- **testator / decedent name**
- **document date** (signing / proving / inventory date)
- **accounting of the inheritance event** — heirs, bequests, estate value, and
  especially **enslaved persons and servants** named as assets

at **≥95% per-field success**, then **reliably link enslaved/servant persons to the
canonical ground-truth person records** (`canonical_persons`), and **verify the result
end-to-end on the frontend autonomously**.

## 1. Current state (verified 2026-05-20)

- Scraper reads FamilySearch **volunteer transcript text** (`data-testid=
  "full-text-transcript"`), not the scan image. Rotated pages / paper-note overlays are
  already resolved by the human transcriber — not the scraper's concern, EXCEPT for the
  ~3% of images with no volunteer transcript.
- `parseTranscript()` is a crude regex parser. Two structural defects:
  1. **One image = one record.** A will spanning 4 pages becomes 4 disconnected
     records; an inventory continued across a page break loses its enslaved-person list.
  2. **Regex-only field extraction.** 4 name patterns, keyword record-type detection.
     Will not reach 95% on mixed/messy documents.
- Already scraped: ~7,663 Liberty images, transcript text stored in
  `person_documents.ocr_text`. **This is a reusable corpus** — the rebuild operates on
  stored transcripts, no re-scrape needed.
- Migrations already in place: M048 `will_extractions`, M049 `estate_valuations`,
  M050 `trust_instruments`, M052 `slaveholding_relationships`, M053
  `enslaver_evidence_compendium`, M067 `inheritance_edges`, M069/078/079
  `probate_scrape_progress`.

## 2. Decisions (user, 2026-05-20)

- **Hybrid extractor:** regex fast-path for clean/simple single-page records; Claude
  JSON-schema extraction for ambiguous or multi-page documents.
- **Image-OCR fallback:** for the ~3% of images with no volunteer transcript, OCR the
  actual scan image (this is where rotation / paper-note handling matters).
- **Test fixtures:** user re-shares the Liberty County test-people website; saved as
  `tests/fixtures/probate/liberty/` — NOT hardcoded into the scraper.

## 3. Architecture

### Phase A — Document segmentation (`src/services/probate/document-segmenter.js`)

New table **M080 `probate_documents`**: a logical document = an ordered set of
`person_documents` image rows within one roll.

```
id (uuid pk),
collection_id, county, state, roll_group_id,
first_image_number, last_image_number,
page_count,
document_type,                 -- will | inventory | estate_account | guardian_account | letters | other
title,                         -- e.g. "Will of John Bacon, 1798"
person_document_ids integer[], -- ordered FK list into person_documents
segmentation_method,           -- 'heuristic' | 'claude' | 'manual'
segmentation_confidence numeric(3,2),
created_at, updated_at
```

Segmenter runs as a **post-process over stored `person_documents.ocr_text`**, grouped by
`roll_group_id` and ordered by `image_number`. Boundary signals:
- **Start:** "Last Will and Testament of", "In the name of God", "Inventory and
  appraisement of the estate of", a new testator name, an index/header page.
- **End:** proving / registry / "recorded" clause, oath form, then a new start signal.
- Continuation pages (no start signal, mid-sentence) attach to the open document.

Ambiguous boundaries escalate to Claude (a cheap classification call over the
window). Output: `probate_documents` rows. Idempotent, re-runnable.

### Phase B — Hybrid extractor (`src/services/probate/probate-extractor.js`)

Per `probate_documents` row, concatenate member transcripts in image order, then:
- **Regex fast-path** — single-image document, clear "Last Will and Testament of X" +
  unambiguous dates + no enslaved-asset language → existing regex logic. Cheap.
- **Claude path** — multi-page, ambiguous record type, OR any document with
  enslaved/servant asset language → Claude with the `WillExtraction` JSON schema from
  apr29 plan §3.3 (testator, dates, heirs, enslaved_persons[], estate value,
  inheritance accounting, raw_quotes_per_field for traceability).
- Output written to **`will_extractions` (M048)**: `raw_pages_jsonb` +
  `structured_extraction_jsonb` + `extractor_version`, `status='extracted'`.

Reuse `src/services/probate/will-extractor.js` from the apr29 plan if it exists;
otherwise build it here and the PDF pipeline inherits it.

### Phase C — Image-OCR fallback (`src/services/probate/probate-image-ocr.js`)

For `probate_scrape_progress.status='no_transcript'`:
- Fetch the actual FamilySearch high-res scan image (not the page screenshot).
- OCR via Google Vision `DOCUMENT_TEXT_DETECTION` (auto orientation detection handles
  rotated pages) with Document AI as the form-parser fallback.
- Detect & flag overlaid paper notes (a small region of distinct text) so the extractor
  can treat them separately.
- OCR'd text feeds the same Phase B extractor; mark `extraction_method='image_ocr'`.

### Phase D — Person linking (`src/services/probate/probate-fanout.js`)

Gated fanout from `will_extractions` → ground-truth tables:
- **Testator/decedent** → resolve against `canonical_persons` (fuzzy match + `match_tier`);
  create if new (`person_type='enslaver'` only via `enslaver_evidence_compendium`
  rollup, never directly).
- **Enslaved/servant persons** → `enslaved_individuals` + **`slaveholding_relationships`
  (M052)** with `relationship_type` ('owned', 'controlled_via_marriage', etc.), each
  row citing the `probate_documents` source. Name resolution against existing
  `canonical_persons` / `enslaved_individuals`; unresolved names stay in
  `unconfirmed_persons` with a `probate_document_id` back-reference.
- **Heirs/bequests** → `inheritance_edges` (M067), `estate_valuations` (M049).
- Every person row carries a FK back to its `probate_documents.id` — closes the
  document→person traceability gap.

### Phase E — Autonomous end-to-end frontend verification (`tests/e2e/probate-e2e.spec.js`)

- Add **Playwright** to `frontend/` devDependencies (no browser test framework exists yet).
- Test harness: start backend (`src/server.js`, :3000) + frontend (Vite, :5173), then
  drive a real browser:
  1. Search a known Liberty testator → open PersonProfile.
  2. Assert: document section shows the probate document; enslaved persons listed;
     each enslaved person links to a canonical/enslaved record; ReparationsBreakdown
     renders; no console errors.
- Automate the `tests/e2e/test-frontend-display.md` checklist as assertions.
- Runs unattended; exit code gates the build.

### Phase F — Accuracy measurement (`tests/integration/probate-extraction-accuracy.js`)

- Load Liberty County ground-truth fixtures (`tests/fixtures/probate/liberty/`).
- Run Phase A→B over the matching scraped transcripts; diff extracted vs. ground truth
  per field (testator, date, each enslaved person, each heir).
- Report per-field accuracy. **Gate: ≥95%.** Below that, surface the failing documents.

## 4. Build order

1. M080 `probate_documents` migration + apply.
2. Phase A segmenter; run over the 7,663 stored Liberty transcripts; spot-check.
3. Phase B hybrid extractor; wire to `will_extractions`.
4. Phase F accuracy harness; iterate extractor until ≥95% on the fixtures.
5. Phase D fanout; person linking with traceability.
6. Phase C image-OCR fallback for the no_transcript set.
7. Phase E Playwright e2e; autonomous frontend verification.
8. Backfill: re-run A→B→D over all already-scraped Liberty docs.
9. Wire segmenter+extractor into the live scraper so new images flow through it.

## 5. Open input needed from user

- **Liberty County test-people website / list** — needed for Phase F fixtures. Work on
  Phases A–E proceeds without it; F is gated on it.

## 6. Out of scope (for now)

- The live scrape currently running (`run7`, resume mode) continues untouched — it keeps
  filling `person_documents.ocr_text`, which is exactly the corpus this pipeline consumes.
- Dual-ledger DAA changes (covered by the apr29 plan).
