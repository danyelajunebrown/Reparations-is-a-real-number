# Data Source Integration Contract

Every data source imported into the Reparations ∈ ℝ database **must satisfy** these requirements before records are considered production-ready. This contract exists because we discovered (Mar 23, 2026) that 58% of known enslavers were invisible to the matching pipeline due to incomplete integration.

---

## The Problem This Solves

Data enters through multiple scripts, scrapers, and manual imports. Without a contract, records land in different tables with inconsistent fields, missing cross-references, and no guarantee the matching pipeline can find them. Example failures:

- **James Hopewell** — known enslaver since Dec 2025, FamilySearch ID in `notes` text field but not in `person_external_ids`. Walked past during a 3,922-ancestor climb.
- **Joseph Miller** — Louisiana slave buyer (1820), in canonical_persons as enslaver but with NULL birth year and no external ID. Invisible to Tier 1 and Tier 2 matching.
- **2,386 DC slaveholders** — stuck in `unconfirmed_persons` for months with no promotion to canonical_persons.
- **Biscoe family** — manually uploaded compensated emancipation claims, partially promoted, most records orphaned.

---

## Current Data Sources (14 identified, Mar 23 2026)

| Source | Records | Landing Table | Enslavers in canonical_persons? | External IDs linked? | Status |
|--------|---------|--------------|-------------------------------|---------------------|--------|
| FamilySearch pre-indexed | 1,690,808 | unconfirmed_persons | N/A (enslaved records) | N/A | ✅ Complete |
| FamilySearch ancestor climber | ~3,000/climb | canonical_persons | As "descendant" | Via migration 033 + backfill | ✅ Complete |
| Louisiana Slave DB | 180,419 | unconfirmed + canonical | 69,799 enslavers | No (no FS IDs in source) | ✅ Complete |
| SlaveVoyages API | 58,636 | canonical_persons | Runtime API matching | 51,111 SV IDs | ✅ Complete |
| CivilWarDC petitions | 73,095 | unconfirmed + canonical | 2,276 promoted Mar 23 | No (no FS IDs in source) | ✅ Fixed |
| MSA Archive | 7,901 | unconfirmed_persons | Not promoted | No | ⚠️ Gap |
| Census OCR | 20,380 | unconfirmed_persons | N/A (enslaved records) | N/A | ✅ Complete |
| UCL LBS | 862 | unconfirmed_persons | Not promoted | No | ⚠️ Gap |
| WikiTree | 0 | Not integrated | — | — | ❌ Planned |
| FindAGrave | 0 | Not integrated | — | — | ❌ Planned |
| IPUMS Census | 0 | Schema only | — | — | ❌ Planned |
| Underwriting Souls | 5 | unconfirmed_persons | No | No | ⚠️ Minimal |
| User Contributions | 1 | unconfirmed_persons | No | No | ⚠️ Minimal |
| FamilySearch OCR | 1,128 | unconfirmed_persons | N/A | N/A | ✅ Complete |

---

## The Contract

### 1. LANDING — Where does the data go?

- [ ] Raw records land in `unconfirmed_persons` with `status='pending'`
- [ ] `source_type` is set to a unique, documented identifier for this source
- [ ] `extraction_method` identifies how data was extracted (scraper name, API, manual)
- [ ] `source_url` preserves the original URL/reference
- [ ] `confidence_score` is assigned with documented justification:
  - 0.95+ = Government primary source (DC petitions, census)
  - 0.85-0.94 = Scholarly verified database (Louisiana Slave DB)
  - 0.70-0.84 = Cross-referenced secondary source
  - 0.50-0.69 = Single-source, unverified
  - <0.50 = OCR/ML extraction needing review

### 2. PROMOTION — Enslaver names MUST reach canonical_persons

- [ ] Every identified enslaver/slaveholder/owner is inserted into `canonical_persons` with:
  - `person_type = 'enslaver'`
  - `first_name`, `last_name` parsed from full name
  - `birth_year_estimate` (NULL if unknown — Tier 2b handles this)
  - `death_year_estimate` (NULL if unknown)
  - `primary_state` populated (CRITICAL for Tier 2/2b matching)
  - `verification_status` set appropriately
  - `created_by` identifies the import script
- [ ] Promotion happens IN THE SAME SCRIPT that imports the data, not as a separate manual step
- [ ] If promotion is deferred, a tracking ticket/TODO is created with the count of unpromoted records

### 3. EXTERNAL ID LINKAGE — FS IDs go in person_external_ids, not notes

- [ ] Any FamilySearch ID → `person_external_ids` with `id_system='familysearch'`
- [ ] Any SlaveVoyages ID → `person_external_ids` with `id_system='slavevoyages'`
- [ ] Any WikiTree ID → `person_external_ids` with `id_system='wikitree'`
- [ ] NEVER store external IDs only in the `notes` field
- [ ] `confidence` and `discovered_by` populated on every row

### 4. DEMOGRAPHICS — Populate what you have

- [ ] `birth_year` / `birth_year_estimate` — even approximate decades help
- [ ] `death_year` / `death_year_estimate`
- [ ] `primary_state` — CRITICAL for matching. Use "District of Columbia" for DC.
- [ ] `primary_county` when available
- [ ] `gender` / `sex`
- [ ] `racial_designation` when source provides it (census race codes, etc.)
- [ ] `occupation` when available (helps distinguish free POC from enslaved)

### 5. RELATIONSHIPS — Link enslaved to enslavers

- [ ] Enslaver-enslaved relationships → `family_relationships` with `relationship_type='enslaved_by'`
- [ ] Parent-child, spouse relationships extracted when available
- [ ] Bidirectional: if A enslaved B, B is enslaved_by A

### 6. TEMPORAL VALIDATION

- [ ] Birth year < death year (when both present)
- [ ] Enslaver birth year < 1870 (post-Civil War enslavers are errors)
- [ ] Enslaved person documented before 1865 (US) or appropriate date for jurisdiction
- [ ] No future dates

### 7. DEDUPLICATION

- [ ] Before inserting into `canonical_persons`, check for existing record with same name + similar demographics
- [ ] Use Soundex/Metaphone columns for fuzzy matching when available
- [ ] Document duplicates found (835 duplicates identified in Mar 23 backfill)

### 8. VERIFICATION READINESS

- [ ] Records tagged with `verification_status` reflecting their evidence level
- [ ] High-confidence records from primary sources can be auto-verified
- [ ] Low-confidence records flagged for human review
- [ ] MatchVerifier pipeline can process the records (temporal checks, race checks work)

---

## Pre-Import Validation Query

Run this after any import to verify integration:

```sql
-- Count new enslavers without external IDs
SELECT count(*) as orphaned_enslavers
FROM canonical_persons cp
WHERE cp.person_type = 'enslaver'
AND cp.created_by = 'YOUR_SCRIPT_NAME'
AND NOT EXISTS (
  SELECT 1 FROM person_external_ids pei
  WHERE pei.canonical_person_id = cp.id
);

-- Count enslavers without state (blocks Tier 2b)
SELECT count(*) as stateless_enslavers
FROM canonical_persons cp
WHERE cp.person_type = 'enslaver'
AND cp.created_by = 'YOUR_SCRIPT_NAME'
AND cp.primary_state IS NULL;

-- Count unconfirmed slaveholders not yet promoted
SELECT count(*) as stuck_slaveholders
FROM unconfirmed_persons
WHERE person_type IN ('slaveholder', 'owner')
AND status IN ('pending', 'needs_review')
AND extraction_method = 'YOUR_METHOD';
```

All three queries should return 0 for a fully integrated source.

---

## History

- **Mar 23, 2026:** Contract created after discovering 69,941 enslavers (58%) invisible to matching pipeline. Backfilled 2,464 external IDs, promoted 2,276 DC slaveholders, added Tier 2b matching (name + state, NULL birth year), enabled Tier 3 saving with human review flags.
