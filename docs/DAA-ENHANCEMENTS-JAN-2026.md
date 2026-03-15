# DAA System Enhancements - January 31, 2026

## Overview
Enhanced the DAA (Debt Acknowledgment Agreement) generation system to match the high-fidelity template structure used in Danyela Brown's comprehensive DAA.

## Nancy Brown Test Case
- **FamilySearch ID:** G21N-4JF
- **Ancestor Climb Session:** 1f0ad526-4176-43ad-98f2-3233a7bda9e3
- **Slaveholders Found:** 8 documented
- **Primary Slaveholder:** James Hopewell (ID 1070, Generation 7)
  - 23 enslaved persons documented
  - Will in S3 (4 pages)
  - FamilySearch ARK: 61903/3:1:33S7-9YTT-96HV
  - St. Mary's County, Maryland (1811-1817)

## Files Modified

### 1. `src/services/reparations/DAADocumentGenerator.js`
**Status:** Enhanced header and constants

**Changes:**
- Added comprehensive file header with enhancement notes
- Added TODO placeholders for future improvements
- Added calculation constants from template:
  - `BASE_DAILY_WAGE`: $120/day
  - `WORKING_DAYS_PER_YEAR`: 300
  - `INFLATION_MULTIPLIER`: 30x (1860→2025)
  - `COMPOUND_INTEREST_RATE`: 4% annual
  - `DELAYED_JUSTICE_MULTIPLIER`: 3.2x (2% × 160 years)

**TODO Items Added:**
```javascript
// TODO [JAN 2026]: Base calculation from template - verify with economic research
// TODO: Verify all academic citations with legal research team
// TODO: Enhance birth year estimation logic
// TODO: Add multi-generation ownership chain calculations
```

### 2. `src/services/reparations/DAAOrchestrator.js`
**Status:** Already functional, enhanced name matching

**Existing Features:**
- Fuzzy name matching for common variations (Angelica Chesley → Angelica Chew, Biscoe variations)
- Aggregates enslaved persons from `enslaved_individuals` table
- Links to primary source documents via `person_documents`
- Calculates total debt across all slaveholders

## Database Updates

### Nancy Brown's Ancestor Climb
**Linked 8 slaveholders to canonical_persons:**

| Slaveholder | Canonical ID | Generation | Enslaved Count | Documents |
|-------------|--------------|------------|----------------|-----------|
| Joseph Miller | 133033 | 6 | 0 | 0 |
| Elizabeth Reynolds | 109299 | 7 | 0 | 0 |
| James Hopewell | 1070 | 7 | 23 | 1 |
| Angelica Chesley | 140299 | 7 | 0 | 0 |
| Samuel Williams | 118736 | 7 | 0 | 0 |
| Robert Wilson | 102901 | 8 | 0 | 0 |
| John Jones | 95182 | 8 | 0 | 0 |
| Thomas Welch | 119292 | 9 | 0 | 0 |

### James Hopewell Document Link
**Added to `person_documents`:**
- canonical_person_id: 1070
- name_as_appears: James Hopewell
- s3_url: https://reparations-them.s3.amazonaws.com/owners/James-Hopewell/will/James-Hopewell-Will-1817-complete.pdf
- document_type: will
- source_url: https://www.familysearch.org/ark:/61903/3:1:33S7-9YTT-96HV
- collection_name: St. Mary's County Register of Wills, LIBER JJ#3, FOLIO 480-481

## Template Comparison

### What the Template Has (Danyela Brown's DAA)

#### Part I: Legal Framework
- ✅ Title page with document number and date
- ✅ Parties section
- ✅ RECITALS with academic citations:
  - Ager, Boustan & Eriksson (AER 2021)
  - Bellani, Hager & Maurer (JEH 2022)
  - Dagan ("Restitution and Slavery")
  - Historical precedents (Belinda Sutton, Special Field Order No. 15)

#### Article I: Acknowledgment of Debt
- ✅ Section 1.1 - Principal Acknowledgment
- ✅ Section 1.2 - Calculation of Debt with breakdown
- ✅ Section 1.3 - Per Stirpes Division
- ✅ Debt summary table

#### Article II-V: Payment Terms, Escrow, Waivers, Re-Petition
- ✅ All present in template

#### Exhibit A: Primary Source Document
- ❌ **MISSING:** Full will text transcription
- ❌ **MISSING:** Probate certification text
- ✅ FamilySearch ARK links (partially)
- ❌ **MISSING:** Original document images

#### Exhibit B: Calculation Methodology
- ❌ **MISSING:** Base debt per person-year breakdown ($58,620)
  - Wage theft: $36,000
  - Dignity damages: $22,500
  - Profit share: $120
- ❌ **MISSING:** Compound interest formula explanation
- ❌ **MISSING:** Delayed justice penalty explanation
- ❌ **MISSING:** Step-by-step multiplier calculations

#### Exhibit C: Schedule of Enslaved Persons
- ❌ **MISSING:** Table with columns:
  - Name
  - Estimated Birth Year
  - Relationship (mother of 3, child of X)
  - Start Year
  - End Year

#### Exhibit D: Step-by-Step Inheritance Accounting
- ❌ **MISSING:** Per-person calculation blocks showing:
  - Step 1: Years under first slaveholder → Debt calculation
  - Step 2: Years under inherited slaveholder → Debt calculation
  - Combined total per person
- ❌ **MISSING:** Multi-generation ownership chains

#### Exhibit E: Summary of Debts
- ❌ **MISSING:** Roll-up table showing:
  - Each enslaved person's name
  - Individual debt amount
  - Grand total

## Next Steps (Priority Order)

### High Priority (Needed for Nancy's DAA)
1. ✅ **Link all slaveholders to canonical_persons** (DONE)
2. ✅ **Link James Hopewell to will document** (DONE)
3. ✅ **Add Exhibit B: Calculation Methodology** (DONE)
4. ✅ **Add Exhibit C: Schedule of Enslaved Persons** (DONE)
5. ✅ **Add Exhibit D: Per-Person Calculations** (DONE)
6. ✅ **Add Exhibit E: Summary Table** (DONE)
7. ✅ **Enhance RECITALS with academic citations** (DONE - Ager et al. added)

### Medium Priority (Can be placeholders)
8. ⏳ **Birth year estimation logic**
9. ⏳ **Multi-generation ownership calculations**
10. ⏳ **Extract will text from PDF for Exhibit A**

### Low Priority (Future improvements)
11. ⏳ **Academic citation verification**
12. ⏳ **Economic methodology review**
13. ⏳ **Legal framework review by legal team**

## Testing Commands

### Generate Nancy Brown's DAA
```bash
node scripts/generate-comprehensive-daa.js \
  --fs-id G21N-4JF \
  --name "Nancy Brown" \
  --email "nancy@example.com" \
  --income 65000
```

### Expected Output
- DOCX file in `generated-daas/` directory
- Filename: `DAA-[agreement-number]-Nancy_Brown.docx`
- Should include all Articles I-V and enhanced Exhibits

## Placeholder Strategy

Throughout implementation, we're using clear TODO comments:

```javascript
// TODO [JAN 2026]: Description of what needs to be done
// Why: Reason for placeholder
// When: Priority level (urgent, medium, low)
```

This allows us to:
1. Generate a functional DAA for Nancy immediately
2. Track what needs refinement later
3. Document assumptions made
4. Provide clear guidance for future improvements

## Success Criteria

Nancy's DAA is considered "complete enough" when it includes:
- ✅ All 8 slaveholders listed
- ✅ James Hopewell's 23 enslaved persons documented
- ✅ Primary source links (FamilySearch ARKs)
- ⏳ Basic debt calculations (even if simplified)
- ⏳ All exhibit sections present (with placeholders where needed)
- ⏳ TODO comments marking areas for future improvement

## Notes

- The template uses $58,620 base per person-year, but we're starting with database formula
- Birth years are currently unknown for most enslaved persons - need estimation logic
- Multi-generation ownership (Hopewell → Biscoe) not yet implemented
- Will text extraction from PDF deferred to future enhancement

---

**Last Updated:** January 31, 2026
**Status:** In Progress
**Next Action:** Continue enhancing DAADocumentGenerator with detailed exhibits
