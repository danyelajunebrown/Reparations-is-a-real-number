# Comprehensive DAA Generation System

## Overview

This system orchestrates the complete Debt Acknowledgment Agreement (DAA) generation process by connecting the **Ancestor Climber** with the **DAA Generator** to create comprehensive documents that include ALL slaveholders and ALL documented enslaved persons from a descendant's ancestry.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Comprehensive DAA Generation                    │
│                                                             │
│  Input: FamilySearch ID (e.g., Nancy Brown: G21N-4JF)      │
│  Output: Complete DOCX with ALL slaveholders & enslaved    │
└─────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────┴─────────────────────┐
        ↓                                           ↓
┌──────────────────┐                    ┌─────────────────────┐
│  STEP 1: CLIMB   │                    │  STEP 2: AGGREGATE  │
│  Ancestor Climber│  →  DB Storage  →  │  Data Collection    │
│  (existing)      │                    │  DAAOrchestrator    │
└──────────────────┘                    └─────────────────────┘
                                                    ↓
                                        ┌─────────────────────┐
                                        │  STEP 3: GENERATE   │
                                        │  DAA + DOCX         │
                                        │  DAADocumentGen     │
                                        └─────────────────────┘
```

## Components

### 1. DAAOrchestrator (`src/services/reparations/DAAOrchestrator.js`)

**Purpose:** Coordinates the entire DAA generation process.

**Key Methods:**
- `generateComprehensiveDAA()` - Main entry point
- `ensureClimbComplete()` - Validates ancestor climb data
- `getDocumentedSlaveholders()` - Retrieves all slaveholders with primary sources
- `aggregateEnslavedData()` - Collects enslaved persons per slaveholder
- `calculateTotalDebt()` - Computes total debt across all slaveholders
- `createDAARecord()` - Generates database record

### 2. DAADocumentGenerator (`src/services/reparations/DAADocumentGenerator.js`)

**Purpose:** Creates professional DOCX documents for DAAs.

**Key Features:**
- Title page with agreement details
- Legal framework with recitals per slaveholder
- Debt acknowledgment with per-slaveholder breakdown table
- Payment terms (2% of annual income)
- Escrow and disbursement terms
- Legal waivers
- Annual re-petition clause (Belinda Sutton model)
- Exhibits with primary sources per slaveholder
- Signature page

### 3. CLI Script (`scripts/generate-comprehensive-daa.js`)

**Purpose:** Command-line interface for DAA generation.

**Usage:**
```bash
node scripts/generate-comprehensive-daa.js \
  --fs-id G21N-4JF \
  --name "Nancy Brown" \
  --email "nancy@example.com" \
  --income 65000
```

## Complete Workflow

### Step 1: Run Ancestor Climb

**First time for a person:**
```bash
FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js G21N-4JF --name "Nancy Brown"
```

**What it does:**
- Logs into FamilySearch
- Climbs through ALL ancestors (both maternal and paternal lines)
- Finds ALL slaveholder matches in the database
- Stores results in `ancestor_climb_sessions` and `ancestor_climb_matches`

**Expected output:**
- Session ID created
- N slaveholders found and recorded
- All matches saved to database

### Step 2: Generate Comprehensive DAA

```bash
node scripts/generate-comprehensive-daa.js \
  --fs-id G21N-4JF \
  --name "Nancy Brown" \
  --email "nancy@example.com" \
  --income 65000
```

**What it does:**
1. Checks for completed climb session (from Step 1)
2. Retrieves all documented slaveholders from climb results
3. For each slaveholder, queries enslaved persons with primary sources
4. Calculates debt per slaveholder and total debt
5. Creates DAA database record
6. Generates professional DOCX document

**Expected output:**
```
═══════════════════════════════════════════════════════════════
   ✅ SUCCESS
═══════════════════════════════════════════════════════════════

Generated Files:
   • DOCX: /path/to/DAA-2026-001-Nancy_Brown.docx

Database Records:
   • DAA ID: uuid-here
   • Agreement Number: DAA-2026-001

Summary:
   • Slaveholders: 5
   • Enslaved Persons: 47
   • Total Debt: $450,000,000,000.00
   • Annual Payment: $1,300.00
```

## Database Schema

### Tables Used

**ancestor_climb_sessions**
- Tracks climb sessions for resume capability
- Stores: person info, status, matches found, queue state

**ancestor_climb_matches**
- Individual slaveholder matches from climbs
- Links: modern person → slaveholder with generation distance

**enslaved_owner_relationships**
- Links enslaved persons to owners
- Includes: relationship type, dates, source documentation

**person_documents**
- Links persons to primary source documents
- Stores: FamilySearch ARKs, S3 URLs, document types

**debt_acknowledgment_agreements**
- Main DAA records
- Stores: acknowledger info, debt calculation, status

**daa_enslaved_persons**
- Individual enslaved persons per DAA
- Stores: name, years enslaved, individual debt calculation

## Query Strategy

### 1. Get Documented Slaveholders

```sql
SELECT DISTINCT
    acm.slaveholder_id,
    acm.slaveholder_name,
    acm.generation_distance,
    cp.primary_state,
    cp.primary_county
FROM ancestor_climb_matches acm
LEFT JOIN canonical_persons cp ON acm.slaveholder_id = cp.id
WHERE acm.session_id = $1
  AND acm.slaveholder_id IS NOT NULL
ORDER BY acm.generation_distance ASC;
```

### 2. Get Enslaved Persons with Primary Sources

```sql
SELECT DISTINCT
    eor.enslaved_name,
    eor.start_year,
    eor.end_year,
    pd.familysearch_ark,
    pd.document_type,
    pd.collection_name
FROM enslaved_owner_relationships eor
LEFT JOIN person_documents pd ON eor.owner_canonical_id = pd.canonical_person_id
WHERE eor.owner_canonical_id = $1
  AND pd.familysearch_ark IS NOT NULL
ORDER BY eor.enslaved_name ASC;
```

## Document Structure

### Generated DOCX Includes:

1. **Title Page**
   - Agreement title
   - Acknowledger name
   - Document number
   - Date

2. **Part I: Legal Framework**
   - Parties (Obligor & Beneficiary Class)
   - Recitals (one per slaveholder with primary source references)
   - Academic citations (Ager/Boustan/Eriksson 2021, etc.)

3. **Article I: Acknowledgment of Debt**
   - Principal acknowledgment
   - Calculation methodology
   - **Debt breakdown table:**
     - Slaveholder | Enslaved Persons | Subtotal Debt
     - Row per slaveholder
     - Total row

4. **Article II: Payment Terms**
   - 2% of annual income obligation
   - Current payment calculation
   - Duration (30 years or federal legislation)

5. **Article III: Escrow and Disbursement**
   - Blockchain escrow terms
   - Disbursement triggers

6. **Article IV: Legal Effect and Waivers**
   - Voluntary waiver of defenses
   - Class formation
   - Corporate fraud reservation

7. **Article V: Annual Re-Petition**
   - Belinda Sutton precedent
   - Government petition targets

8. **Exhibits (one per slaveholder)**
   - Exhibit A: Slaveholder 1
     - List of enslaved persons with dates
     - Primary sources (FamilySearch ARKs, document types)
   - Exhibit B: Slaveholder 2
     - (same structure)
   - ...

9. **Signature Page**
   - Execution clause
   - Signature lines
   - Document number

## Testing

### Test Case: Nancy Brown (G21N-4JF)

**Expected Behavior:**
1. Ancestor climb finds ALL slaveholders in Nancy's ancestry (both maternal and paternal)
2. For each slaveholder, system retrieves ALL documented enslaved persons
3. DAA includes complete lineage with primary sources
4. Document has one exhibit per slaveholder
5. Total debt = sum of all slaveholder debts

**Validation Criteria:**
- ✅ All slaveholders from Nancy's ancestry included
- ✅ Each slaveholder has enslaved persons with verified sources
- ✅ Debt calculation uses correct methodology (compound interest, multipliers)
- ✅ DOCX opens correctly with all sections
- ✅ Primary source links work (FamilySearch ARKs clickable)
- ✅ Database record created correctly

## Error Handling

### Common Errors and Solutions

**Error: "Ancestor climb required"**
- **Cause:** No completed climb session exists
- **Solution:** Run the ancestor climber first:
  ```bash
  FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js G21N-4JF --name "Nancy Brown"
  ```

**Error: "No documented slaveholders found"**
- **Cause:** Climb found matches but they lack primary sources
- **Solutions:**
  1. Check `ancestor_climb_matches` table
  2. Verify `enslaved_owner_relationships` is populated
  3. Ensure `person_documents` has FamilySearch ARKs
  4. Run: `SELECT * FROM ancestor_climb_matches WHERE modern_person_fs_id = 'G21N-4JF';`

**Error: "Climb session in progress"**
- **Cause:** Incomplete climb session exists
- **Solution:** Resume the climb:
  ```bash
  FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js --resume <session_id>
  ```

## Future Enhancements

### Multi-Slaveholder Schema (Migration 029)

Currently, the system stores all slaveholders in one DAA record. Future enhancement:

```sql
CREATE TABLE daa_slaveholders (
  id SERIAL PRIMARY KEY,
  daa_id UUID REFERENCES debt_acknowledgment_agreements(daa_id),
  slaveholder_canonical_id INTEGER REFERENCES canonical_persons(id),
  slaveholder_name VARCHAR(255),
  generation_distance INTEGER,
  subtotal_debt DECIMAL(20,2),
  enslaved_count INTEGER
);

ALTER TABLE daa_enslaved_persons 
ADD COLUMN daa_slaveholder_id INTEGER REFERENCES daa_slaveholders(id);
```

This will enable:
- Better per-slaveholder tracking
- Easier querying of specific lineages
- More granular debt attribution

## File Locations

```
src/services/reparations/
├── DAAOrchestrator.js          # Orchestration logic
├── DAADocumentGenerator.js     # DOCX generation
├── DAAGenerator.js             # Core DAA logic (existing)
└── index.js                    # Module exports

scripts/
└── generate-comprehensive-daa.js  # CLI interface

generated-daas/                 # Output directory for DOCX files
└── DAA-2026-001-Nancy_Brown.docx

docs/
└── COMPREHENSIVE-DAA-GENERATION.md  # This file
```

## Dependencies

- **docx** - Professional DOCX document generation
- **pg** - PostgreSQL database connection
- **dotenv** - Environment variable management

## References

### Academic Sources
- Ager, Boustan & Eriksson (AER 2021) - Wealth multiplier research
- Darity & Mullen (2020) - Comprehensive reparations framework
- Dagan (BU Law Review 2004) - Unjust enrichment theory

### Legal Precedents
- Belinda Sutton (1783) - First successful reparations claim
- Farmer-Paellmann (2002) - Consumer fraud/unjust enrichment

### Data Sources
- FamilySearch - Genealogy and primary source documents
- 1860 Slave Schedules - Enslaved person documentation
- Wills, Deeds, Probate Records - Ownership documentation

## Support

For issues or questions:
1. Check error messages for specific guidance
2. Review database tables for data completeness
3. Verify ancestor climb completed successfully
4. Ensure primary sources are linked in database
