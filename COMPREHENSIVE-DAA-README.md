# Comprehensive DAA Generation - Quick Start

## What This System Does

Generates complete Debt Acknowledgment Agreements (DAAs) that include **ALL slaveholders** and **ALL documented enslaved persons** from a descendant's ancestry, with primary source documentation.

Previously, DAAs were created manually for individual slaveholders. This system **automates the complete process** by:
1. Using the ancestor climber to find ALL slaveholders in ancestry
2. Aggregating ALL enslaved persons with primary sources
3. Generating professional DOCX documents with full documentation

## Quick Start Guide

### For Nancy Brown (Test Case)

#### Step 1: Run Ancestor Climb (if not already done)
```bash
FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js G21N-4JF --name "Nancy Brown"
```

This will:
- Open Chrome with FamilySearch
- Log in (you'll do this manually)
- Climb through ALL ancestors
- Find ALL slaveholder matches
- Save results to database

**Wait for it to complete** (shows "CLIMB RESULTS" at end).

#### Step 2: Generate Comprehensive DAA
```bash
node scripts/generate-comprehensive-daa.js \
  --fs-id G21N-4JF \
  --name "Nancy Brown" \
  --email "nancy@example.com" \
  --income 65000
```

This will:
- Check climb session completed
- Retrieve all documented slaveholders
- Get enslaved persons with primary sources per slaveholder
- Calculate total debt
- Generate DOCX document
- Create database records

#### Step 3: Review the Document
```bash
open generated-daas/DAA-2026-001-Nancy_Brown.docx
```

### Expected Output

The generated DOCX will include:
- **Title page** with Nancy's name
- **Legal framework** with recitals per slaveholder
- **Debt breakdown table** showing each slaveholder's contribution
- **Payment terms** (2% of $65,000 = $1,300/year)
- **Exhibits** - one per slaveholder with:
  - List of enslaved persons
  - Primary source documentation (FamilySearch ARKs)

### Test Validation

✅ **The system is working correctly if:**
1. Document includes multiple slaveholders (not just 1-2)
2. Each slaveholder has enslaved persons listed
3. Primary sources (FamilySearch ARKs) are included
4. Total debt = sum of all slaveholder debts
5. DOCX opens and displays properly

❌ **System needs debugging if:**
- "No documented slaveholders found" error
- Only 1-2 slaveholders shown (should be more)
- Missing primary sources in exhibits
- Document doesn't open

## Architecture Overview

```
User Input (FS ID)
       ↓
Ancestor Climber  →  Finds ALL slaveholders
       ↓
Database Storage  →  ancestor_climb_matches
       ↓
DAAOrchestrator   →  Aggregates data
       ↓
   • Queries slaveholders
   • Gets enslaved persons per slaveholder
   • Calculates debts
       ↓
DAADocumentGen    →  Creates DOCX
       ↓
Output: Complete DAA with ALL data
```

## Key Files

| File | Purpose |
|------|---------|
| `src/services/reparations/DAAOrchestrator.js` | Orchestration logic |
| `src/services/reparations/DAADocumentGenerator.js` | DOCX generation |
| `scripts/generate-comprehensive-daa.js` | CLI interface |
| `docs/COMPREHENSIVE-DAA-GENERATION.md` | Full documentation |

## Database Tables Used

| Table | Purpose |
|-------|---------|
| `ancestor_climb_sessions` | Climb session tracking |
| `ancestor_climb_matches` | Slaveholder matches found |
| `enslaved_owner_relationships` | Enslaved → Owner links |
| `person_documents` | Primary sources (ARKs) |
| `debt_acknowledgment_agreements` | Generated DAAs |
| `daa_enslaved_persons` | Enslaved persons per DAA |

## Common Issues

### "Ancestor climb required"
**Cause:** No completed climb session exists  
**Fix:** Run Step 1 above

### "No documented slaveholders found"
**Cause:** Matches found but no primary sources linked  
**Fix:** Check database:
```sql
SELECT * FROM ancestor_climb_matches WHERE modern_person_fs_id = 'G21N-4JF';
SELECT * FROM enslaved_owner_relationships WHERE owner_canonical_id IN (
  SELECT slaveholder_id FROM ancestor_climb_matches WHERE modern_person_fs_id = 'G21N-4JF'
);
```

### "Climb session in progress"
**Cause:** Incomplete climb exists  
**Fix:** Resume it:
```bash
FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js --resume <session_id>
```

## For Other People (Not Nancy)

Same process, just change the FamilySearch ID and name:

```bash
# Step 1: Climb
FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js <FS_ID> --name "<Full Name>"

# Step 2: Generate DAA
node scripts/generate-comprehensive-daa.js \
  --fs-id <FS_ID> \
  --name "<Full Name>" \
  --email "<email>" \
  --income <income>
```

## Output Location

Generated documents are saved to:
```
generated-daas/DAA-YYYY-NNN-Name.docx
```

Where:
- `YYYY` = Year
- `NNN` = Sequential number (001, 002, etc.)
- `Name` = Acknowledger's name

## Dependencies

The system requires:
- ✅ Node.js packages (already installed)
- ✅ docx library (installed via npm)
- ✅ PostgreSQL database (existing)
- ✅ Ancestor climber (existing)
- ✅ DAA Generator (existing)

## Next Steps After Generation

1. **Review DOCX** - Verify all slaveholders and enslaved persons included
2. **Check primary sources** - Ensure FamilySearch ARK links work
3. **Validate calculations** - Debt totals should match methodology
4. **Sign document** - Electronic or physical signature
5. **Submit petitions** - Annual government petitions (Article V)

## Full Documentation

See `docs/COMPREHENSIVE-DAA-GENERATION.md` for:
- Complete architecture details
- Query strategies
- Error handling
- Future enhancements

## Support

Issues? Check:
1. Error message guidance (script provides specific fixes)
2. Database completeness queries
3. Ancestor climb session status
4. Primary source linkage

---

**System Status:** ✅ Ready for Testing with Nancy Brown (G21N-4JF)
