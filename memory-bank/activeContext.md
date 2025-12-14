# Active Context: Current Development State

**Last Updated:** December 14, 2025 (Session 3)
**Current Phase:** Neon Migration Complete, Search Fixed
**Active Branch:** main

---

## Recent Major Changes (Dec 14, 2025 - Session 3)

### 23. Neon Database Migration ✅ (Dec 14, 2025)

**Problem:** Render PostgreSQL had connection issues and the frontend was depending on a backend that could be slow to respond.

**Solution:** Migrated entire database to Neon serverless PostgreSQL:
- Migrated 214,159 unconfirmed_persons
- Migrated 1,401 enslaved_individuals
- Migrated 1,068 canonical_persons
- Migrated 726 confirming_documents
- Migrated 4,192 scraping_queue
- Migrated 2,887 scraping_sessions

**Benefits:**
- Serverless - auto-scales, no cold start issues
- Better connection pooling via pooler endpoint
- No more "connection refused" errors
- Faster queries for frontend

**Action Required:** Update Render's DATABASE_URL environment variable to:
```
postgresql://neondb_owner:npg_2S8LrhzkZmad@ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
```

---

### 22. Search Bug Fixes ✅ (Dec 14, 2025)

**Problem 1:** Search for "Grace Butler" returned 50 unrelated names like "Co Maryland", "Gusty", "Sept".

**Root Cause:** Search used OR between words and searched context_text (entire documents), so any record containing "grace" OR "butler" anywhere matched.

**Fix:** Changed to AND logic and only search full_name field:
```javascript
// OLD (buggy): Returns any record with "grace" OR "butler"
WHERE full_name ILIKE '%grace%' OR context_text ILIKE '%grace%' OR ...

// NEW (fixed): Returns only records with BOTH words in name
WHERE full_name ILIKE '%grace%' AND full_name ILIKE '%butler%'
```

**Problem 2:** Search for "Adjua D'Wolf" returned 0 results.

**Root Cause:** Adjua D'Wolf was in enslaved_individuals table (confirmed records), but search only queried unconfirmed_persons.

**Fix:** Added UNION query to search both tables:
```sql
SELECT ... FROM unconfirmed_persons WHERE ...
UNION ALL
SELECT ... FROM enslaved_individuals WHERE ...
```

---

## Recent Major Changes (Dec 14, 2025 - Session 2)

### 21. FamilySearch Scraper LDS Ad Fix ✅ (Dec 14, 2025)

**Problem:** FamilySearch scraper was clicking on LDS Church promotional ads instead of document thumbnails. The scraper navigated to `churchofjesuschrist.org/comeuntochrist` instead of viewing plantation records.

**Root Cause:** The thumbnail selector was too broad - it would click any image meeting size criteria, including embedded LDS promotional banners on FamilySearch pages.

**Solution:** Added domain filtering to thumbnail selection in `scripts/scrapers/familysearch-scraper.js`:
```javascript
// CRITICAL: Only click images from FamilySearch domains, never external ads
const isFamilySearchImage = src.includes('familysearch.org') ||
                           src.includes('fs.net') ||
                           src.startsWith('data:') ||
                           src.startsWith('blob:');
// Exclude external/promotional images
const isExternal = src.includes('churchofjesuschrist') ||
                  src.includes('comeuntochrist') ||
                  src.includes('lds.org') ||
                  src.includes('churchnews');
```

**Status:** Film 7 scraper relaunched and running successfully.

---

### 20. Name Resolution System ✅ (Dec 14, 2025)

**Problem Solved:** The same person appears with different spellings across documents due to OCR errors and historical spelling variations (e.g., "Sally Swailes" vs "Sally Swailer" vs "Sally Swales"). Need to consolidate these to TRUE identities.

**Solution Implemented:**

#### 1. NameResolver Service (`src/services/NameResolver.js`)
New service providing:
- **Soundex Algorithm** - Phonetic matching (Swailes → S420, Swailer → S420)
- **Metaphone Algorithm** - Alternative phonetic encoding
- **Levenshtein Distance** - Character-by-character edit distance
- **Name Parsing** - Split into first, middle, last, suffix components
- **Confidence Scoring** - Combined metrics for match quality

**Confidence Thresholds:**
- ≥0.85: Auto-match to existing canonical person
- 0.60-0.84: Queue for human review
- <0.60: Create new canonical person

#### 2. Database Migration (`migrations/010-name-resolution-system.sql`)
Three new tables:
```sql
canonical_persons    -- TRUE identity of a person
name_variants        -- Different spellings linking to canonical
name_match_queue     -- Ambiguous matches awaiting human review
```

**Key Fields:**
- `first_name_soundex`, `last_name_soundex` - For phonetic search
- `first_name_metaphone`, `last_name_metaphone` - Alternative phonetic
- `confidence_score` - How confident we are this is a real person
- `verification_status` - auto_created, human_verified, confirmed

#### 3. API Endpoints (`src/api/routes/names.js`)
```javascript
POST /api/names/analyze      // Analyze a name (parsing, phonetic codes)
POST /api/names/compare      // Compare two names for similarity
POST /api/names/resolve      // Resolve name to canonical or queue
GET  /api/names/search/:name // Find similar names in database
GET  /api/names/stats        // System statistics
```

#### 4. Automatic Scraper Integration
FamilySearch scraper (`scripts/scrapers/familysearch-scraper.js`) now:
- Initializes NameResolver on database connection
- Processes each extracted name through `resolveOrCreate()`
- Logs resolution statistics: `🔗 Name resolution: X linked, Y queued, Z new`

**Current Database Stats (Dec 14, 2025):**
| Table | Count |
|-------|-------|
| canonical_persons | 4 |
| name_variants | 0 |
| name_match_queue | 1 |
| unconfirmed_persons | 213,740 |

---

### 19. CompensationTracker Financial System ✅ (Dec 10, 2025)

**Key Insight:** Compensation payments TO owners PROVE debt exists - they don't reduce it. The enslaved received $0.

**Test Results:**
- Lord Harewood: £26,309 for 1,277 enslaved → **$2.69 billion proven debt**
- James Williams (DC): $4,500 for 15 enslaved → **$19M proven debt**

---

## Name Resolution Architecture

### Data Flow
```
OCR Extraction → unconfirmed_persons table
                        ↓
              NameResolver.resolveOrCreate()
                        ↓
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
   HIGH CONF        MED CONF        LOW CONF
   (≥0.85)        (0.60-0.84)       (<0.60)
        ↓               ↓               ↓
   Link to          Queue for        Create new
   existing         human review     canonical
   canonical                         person
```

### Phonetic Matching Examples
| Name 1 | Name 2 | Soundex | Match? |
|--------|--------|---------|--------|
| Swailes | Swailer | S420 = S420 | Yes |
| Swailes | Swales | S420 = S420 | Yes |
| Key | Frey | K000 ≠ F600 | No |
| Johnson | Johnsen | J525 = J525 | Yes |

---

## Current Production Environment

### Render Services
- **Backend:** `reparations-platform.onrender.com` (Node.js)
- **Database:** Neon PostgreSQL (migrated Dec 14, 2025)

### Database Credentials (Neon PostgreSQL) - UPDATED
```
Host: ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech
Database: neondb
User: neondb_owner
Password: npg_2S8LrhzkZmad
Connection String: postgresql://neondb_owner:npg_2S8LrhzkZmad@ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
```

### Legacy Database (Render PostgreSQL) - DEPRECATED
```
Host: dpg-d3v78f7diees73epc4k0-a.oregon-postgres.render.com
Database: reparations
User: reparations_user
Password: hjEMn35Kw7p712q1SYJnBxZqIYRdahHv
```

### Database Statistics (Dec 14, 2025) - UPDATED
- **Database:** Neon PostgreSQL (migrated from Render)
- **Total unconfirmed_persons:** 214,159
- **Enslaved individuals (confirmed):** 1,401
- **Canonical persons:** 1,068
- **Confirming documents:** 726
- **Scraping queue:** 4,192
- **Scraping sessions:** 2,887

### Frontend
- **URL:** https://danyelajunebrown.github.io/Reparations-is-a-real-number/
- **Backend API:** https://reparations-platform.onrender.com

---

## Files Created/Modified This Session (Dec 14, 2025)

### New Files
- `src/services/NameResolver.js` - Name resolution service
- `src/api/routes/names.js` - API endpoints for name resolution
- `migrations/010-name-resolution-system.sql` - Database schema
- `scripts/test-name-resolver.js` - Test script

### Modified Files
- `scripts/scrapers/familysearch-scraper.js` - Added NameResolver integration
- `src/server.js` - Added /api/names routes

---

## NameResolver Service Methods

```javascript
// Core algorithms
soundex(name)           // Returns Soundex code (e.g., "S420")
metaphone(name)         // Returns Metaphone code
levenshtein(s1, s2)     // Returns edit distance
parseName(fullName)     // Returns {first, middle, last, suffix}

// Database operations
createCanonicalPerson(name, options)    // Create TRUE identity
addNameVariant(canonicalId, variant)    // Link variant spelling
findCandidateMatches(name, context)     // Find potential matches
resolveOrCreate(name, options)          // Main entry point

// Search & stats
searchSimilarNames(name, options)       // Find similar in DB
getStats()                              // System statistics
```

---

## Background Processes (Currently Running)

| Process | Status | Progress |
|---------|--------|----------|
| Film 5 Scraper | Running | Images 582-1012 |
| Film 6 Scraper | Running | Images 1-1012 |
| Film 7 Scraper | Running | Images 1-1045 (fixed) |

**Film 7 Notes:** Relaunched with LDS ad fix. Previously was clicking on `churchofjesuschrist.org/comeuntochrist` promotional banners instead of document thumbnails.

---

## Files Modified This Session (Dec 14, 2025 - Session 3)

### Modified
- `src/api/routes/contribute.js` - Fixed search logic (OR→AND), added UNION with enslaved_individuals
- `memory-bank/activeContext.md` - Updated with Neon credentials and search fixes
- `memory-bank/progress.md` - Added Phase 13 for Neon migration

### Database Migration
- Migrated 224,433 total records from Render PostgreSQL to Neon
- Updated Render DATABASE_URL environment variable to use Neon

---

## Files Modified (Dec 14, 2025 - Session 2)

### Modified
- `scripts/scrapers/familysearch-scraper.js` - Added domain filtering to prevent clicking LDS promotional ads

---

## Next Steps

### Immediate
1. ✅ ~~Migrate database to Neon~~ (COMPLETED Dec 14, 2025)
2. ✅ ~~Fix search returning unrelated names~~ (COMPLETED Dec 14, 2025)
3. ✅ ~~Add enslaved_individuals to search~~ (COMPLETED Dec 14, 2025)
4. Build human review UI for name_match_queue
5. Monitor Film 7 scraper progress (1045 images)

### Short Term
1. Create merge tools for duplicate canonical persons
2. Link canonical_persons to reparations calculation system
3. Download International Genealogy Index from FamilySearch
4. Add document viewer for Adjua D'Wolf tombstone (currently no S3 link)

---

*This document is updated frequently as development progresses. Always check the "Last Updated" timestamp.*
