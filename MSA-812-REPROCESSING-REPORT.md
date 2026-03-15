# MSA Vol 812 + FamilySearch `ocr_scrape` — Reprocessing Report

Date: 2025-12-14

This report summarizes what data needed reprocessing after our development churn, what was reprocessed, and what still remains.

---

## 1) Executive Summary

### ✅ What was reprocessed

**A) MSA (Maryland State Archives) — Montgomery County Volume 812**
- Reprocessing is in progress and has reached **page 96** so far.
- Coverage rows exist for **95 distinct pages** (min=1, max=96).
- The system uses the new “No Person Left Behind” logic with per-row fingerprinting to prevent duplicate re-emissions.

**B) FamilySearch — Ravenel Papers `ocr_scrape` dataset**
- The previously deleted/broken `ocr_scrape` data was restored **without re-scraping** by re-inserting from a backup table.
- Restored rows: **1,355** (matches backup exactly).

### ⚠️ What remains

- **MSA Vol 812 is not yet complete** (target was 1–132, currently covered through page 96).
- We should resume `scripts/reprocess-montgomery.js` from page **97 → 132**.

---

## 2) MSA Volume 812 (Montgomery County) — Status & Metrics

Source table: `msa_reprocess_coverage` (volume_id = `'812'`)

### Coverage
- **Pages done:** 95
- **Min page:** 1
- **Max page:** 96

### Totals (current snapshot)
- **Detected rows:** 13,023
- **Emitted persons:** 8,263
- **Named persons:** 2,533
- **Placeholder persons:** 10,490
- **Avg OCR confidence:** 0.7288236413668439
- **Min OCR confidence:** 0.6319031047500001

### Data quality flags
- **Pages missing owner assignment:** 1
  - page **15** (detected_rows=118, emitted_persons=118, ocr_confidence≈0.839)

- **Pages with zero emitted persons:** 8
  - This is expected in some cases due to dedupe (rows already emitted in earlier runs). These pages still have detected rows.

---

## 3) FamilySearch `ocr_scrape` — Restoration

### Background
The `unconfirmed_persons` rows created by the original FamilySearch `ocr_scrape` pipeline were determined to be broken/unstable and were deleted.

Before deletion, they were backed up into `ocr_scrape_backup`.

### Backup inventory
- Backup rows: **1,355**
- Unique FamilySearch URLs: **522**
- URL pattern: `https://www.familysearch.org/ark:/61903/3:1:3QHV-R3G9-PBH9?i=<index>`

### Restoration action
We restored by copying records from `ocr_scrape_backup` back into `unconfirmed_persons`.

### Verification
- Current `unconfirmed_persons` rows with `extraction_method='ocr_scrape'`: **1,355**

---

## 4) Recommended Next Steps

### Immediate
1. **Finish MSA Vol 812**
   - Run: `node scripts/reprocess-montgomery.js 97 132`
   - Then regenerate this report with final counts.

2. **Fix owner assignment for page 15**
   - Determine the correct owner name (likely parse/OCR issue) and update coverage row + any associated emitted persons if needed.

### Optional (later)
- If we want higher-quality FamilySearch ingestion, build a deterministic/non-browser pipeline, but it is not required for restoring the dataset (backup restore was sufficient).

---

## 5) Notes / Constraints
- This report reflects a **mid-run snapshot** of MSA Vol 812.
- The FamilySearch portion is complete because it was restored from backup.
