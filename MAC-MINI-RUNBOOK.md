# MAC MINI SCRAPING RUNBOOK
_Generated from live audit — 2026-05-11_  
_This machine (MacBook) is **code + deploy only**. All active scraping runs on Mac Mini._

---

## HOW TO GET INTO MAC MINI VIA TAILSCALE (SSH)

### Step 1 — Find Mac Mini's Tailscale address
You need one of these. Check whichever is easiest:

**Option A — Tailscale admin console (from any browser):**
```
https://login.tailscale.com/admin/machines
```
Look for the Mac Mini entry. Copy its IP (looks like `100.x.x.x`) or hostname (looks like `mac-mini.tailnet-name.ts.net`).

**Option B — If you're physically at Mac Mini right now, run in its Terminal:**
```bash
tailscale ip
```
That prints the `100.x.x.x` address. Use that.

---

### Step 2 — Ensure SSH (Remote Login) is on for Mac Mini
On Mac Mini: **System Settings → General → Sharing → Remote Login → ON**  
Allow access for: `danyelica` (or "All users")

If it was already on, skip this.

---

### Step 3 — SSH in from your MacBook Terminal
```bash
ssh danyelica@<MAC-MINI-TAILSCALE-IP>
```
Example: `ssh danyelica@100.71.42.88`  
Type `yes` on first connect. Enter danyelica's password when prompted.

---

### Step 4 — Launch Chrome on Mac Mini's display (from SSH)
The enrichment script needs Chrome running on the Mac Mini with remote debugging on port 9222.  
This command launches Chrome on Mac Mini's **local GUI display** even though you're SSH'd in:

```bash
launchctl asuser $(id -u danyelica) /usr/bin/open \
  -na "Google Chrome" \
  --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/familysearch-ancestor-climber
```

Wait 5 seconds for Chrome to open on Mac Mini.

---

### Step 5 — Verify Chrome is reachable on port 9222
Still in your SSH session:
```bash
curl -s http://localhost:9222/json/version | head -3
```
You should see JSON with Chrome version info. If you get "Connection refused", Chrome didn't start — retry Step 4.

---

### Step 6 — Check/restore FamilySearch session
The DocAI enricher navigates FamilySearch ARK URLs and screenshots them. If FamilySearch isn't logged in, screenshots will show a login page → conf=0.00 on everything.

**Option A — If you have Screen Sharing enabled on Mac Mini:**
From your MacBook:
```bash
open vnc://danyelica@<MAC-MINI-TAILSCALE-IP>
```
This opens Screen Sharing. You'll see Mac Mini's desktop. Switch to the Chrome window (it opened in Step 4), navigate to `familysearch.org`, and log in if needed.

**Option B — If fs-cookies.json is still valid from a prior session:**
The enricher does NOT use fs-cookies.json (that's the 1860 scraper). The enricher uses the Chrome session on port 9222 directly. So you just need FamilySearch to be logged in in that Chrome window.

To check quickly from SSH — run a quick 1-record dry-run and watch for conf > 0:
```bash
cd /Users/danyelica/Desktop/Reparations-is-a-real-number
node scripts/enrich-freedmens-docai.js \
  --branch-like "Washington" \
  --limit 1 \
  --dry-run
```
If output shows `conf=0.00` → FamilySearch not logged in. Need Screen Sharing to log in.  
If output shows `conf=0.XX` (any value > 0) → session is good, proceed.

---

---

## AUDIT SNAPSHOT  (2026-05-11T16:12Z)

### 1860 Slave Schedule
| Metric | Value |
|--------|-------|
| `person_documents` rows (census_slave_schedule) | **139,995** |
| `person_documents` with s3_key matching census/1860 | **139,995** |
| `unconfirmed_persons` rows matching 1860 context | 696 (garbled locations — data quality issue, not actionable) |
| `person_documents` linked via unconfirmed_person_id | 0 (backfill needed — see below) |

**Status**: The bulk of the 1860 scrape appears done (139,995 pages scraped + S3'd).  
The 696 `unconfirmed_persons` rows have garbled `locations[1]` (word fragments instead of state names) from a prior run — these need a targeted backfill/fix, not more scraping.  
**Run `check-state-progress.js` on Mac Mini to confirm which states still have remaining FamilySearch pages.**

### Freedman's Bank DocAI Enrichment
| Metric | Value |
|--------|-------|
| Total depositors | **416,136** |
| Enriched (docai_fields present) | **2,550** (0.61%) |
| **Remaining** | **413,586** |
| S3 screenshots in person_documents (freedmens-bank/) | 0 |

**3 branches partially enriched — resume these first:**
| Branch | Total | Enriched | Remaining |
|--------|-------|----------|-----------|
| Washington, D.C. | 22,684 | 814 | 21,870 |
| Charleston, South Carolina | 32,849 | 1,247 | 31,602 |
| Richmond, Virginia | 32,736 | 489 | 32,247 |

**26 branches at 0% — run these after:**
Augusta GA (45,493), Savannah GA (45,394), Atlanta GA (44,213), New York NY (30,779), Baltimore MD (17,556), Vicksburg MS (16,507), Memphis TN (13,272), New Orleans LA (13,080), Huntsville AL (12,085), Nashville TN (10,574), New Bern NC (9,796), Louisville KY (9,131), Norfolk VA (8,900), Lexington KY (8,149), Tallahassee FL (7,595), Beaufort SC (7,260), Shreveport LA (6,288), Mobile AL (6,212), Wilmington NC (4,600), Columbus MS (4,011), Little Rock AR (3,894), Natchez MS (1,911), St. Louis MO (628), Lynchburg VA (413), Philadelphia PA (122), Raleigh NC (4)

---

## MAC MINI PREREQUISITES

```bash
# Repo path on Mac Mini:
cd /Users/danyelica/Desktop/Reparations-is-a-real-number

# Always git pull first to get latest scripts
git pull origin main

# Verify .env has all required vars:
#   DATABASE_URL
#   GCP_PROJECT_ID
#   DOCUMENT_AI_PROCESSOR_ID
#   GOOGLE_APPLICATION_CREDENTIALS (path to GCP service account JSON)
#   S3_BUCKET
#   S3_REGION
cat .env | grep -E 'DATABASE_URL|GCP_|DOCUMENT_AI|GOOGLE_APP|S3_'
```

---

## TASK 1 — CONFIRM 1860 SCRAPE STATE

```bash
cd /Users/danyelica/Desktop/Reparations-is-a-real-number

# Check how many states are fully scraped
node check-state-progress.js
```

If any states show as incomplete, run only those states:

```bash
# Example: run just one state to completion
FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js \
  --state "Virginia" \
  --limit 320

# Or run all remaining states via the sequential runner:
bash finish-1860-remaining.sh
```

> ⚠️  Chrome must be open and signed into FamilySearch before running.  
> Chrome command: `open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/familysearch-ancestor-climber`  
> Do NOT run this at the same time as DocAI enrichment.

---

## TASK 2 — FREEDMAN'S BANK DOCAI ENRICHMENT

### Step 1 — Open Chrome (FamilySearch)

```bash
open -na "Google Chrome" \
  --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/familysearch-ancestor-climber
```

Sign into FamilySearch manually if the session has expired.

### Step 2 — Resume the 3 partial branches (finish these first)

Run each in a separate terminal session, or sequentially. Each is fully resumable — records with `docai_enrichment` in `review_notes` are skipped automatically.

```bash
cd /Users/danyelica/Desktop/Reparations-is-a-real-number

# 1. Washington D.C.  (~21,870 remaining)
node scripts/enrich-freedmens-docai.js \
  --branch-like "Washington" \
  --limit 25000

# 2. Charleston, South Carolina  (~31,602 remaining)
node scripts/enrich-freedmens-docai.js \
  --branch-like "Charleston" \
  --limit 35000

# 3. Richmond, Virginia  (~32,247 remaining)
node scripts/enrich-freedmens-docai.js \
  --branch-like "Richmond" \
  --limit 35000
```

### Step 3 — New branches (largest first)

After the partial branches are complete, run these in order. Each is idempotent — safe to stop and resume with `--start-id`.

```bash
# Augusta, Georgia  (45,493)
node scripts/enrich-freedmens-docai.js --branch-like "Augusta" --limit 50000

# Savannah, Georgia  (45,394)
node scripts/enrich-freedmens-docai.js --branch-like "Savannah" --limit 50000

# Atlanta, Georgia  (44,213)
node scripts/enrich-freedmens-docai.js --branch-like "Atlanta" --limit 50000

# New York, New York  (30,779)
node scripts/enrich-freedmens-docai.js --branch-like "New York" --limit 35000

# Baltimore, Maryland  (17,556)
node scripts/enrich-freedmens-docai.js --branch-like "Baltimore" --limit 20000

# Vicksburg, Mississippi  (16,507)
node scripts/enrich-freedmens-docai.js --branch-like "Vicksburg" --limit 20000

# Memphis, Tennessee  (13,272)
node scripts/enrich-freedmens-docai.js --branch-like "Memphis" --limit 15000

# New Orleans, Louisiana  (13,080)
node scripts/enrich-freedmens-docai.js --branch-like "New Orleans" --limit 15000

# Huntsville, Alabama  (12,085)
node scripts/enrich-freedmens-docai.js --branch-like "Huntsville" --limit 15000

# Nashville, Tennessee  (10,574)
node scripts/enrich-freedmens-docai.js --branch-like "Nashville" --limit 12000

# New Bern, North Carolina  (9,796)
node scripts/enrich-freedmens-docai.js --branch-like "New Bern" --limit 12000

# Louisville, Kentucky  (9,131)
node scripts/enrich-freedmens-docai.js --branch-like "Louisville" --limit 12000

# Norfolk, Virginia  (8,900)
node scripts/enrich-freedmens-docai.js --branch-like "Norfolk" --limit 12000

# Lexington, Kentucky  (8,149)
node scripts/enrich-freedmens-docai.js --branch-like "Lexington" --limit 10000

# Tallahassee, Florida  (7,595)
node scripts/enrich-freedmens-docai.js --branch-like "Tallahassee" --limit 10000

# Beaufort, South Carolina  (7,260)
node scripts/enrich-freedmens-docai.js --branch-like "Beaufort" --limit 10000

# Shreveport, Louisiana  (6,288)
node scripts/enrich-freedmens-docai.js --branch-like "Shreveport" --limit 8000

# Mobile, Alabama  (6,212)
node scripts/enrich-freedmens-docai.js --branch-like "Mobile" --limit 8000

# Wilmington, North Carolina  (4,600)
node scripts/enrich-freedmens-docai.js --branch-like "Wilmington" --limit 6000

# Columbus, Mississippi  (4,011)
node scripts/enrich-freedmens-docai.js --branch-like "Columbus" --limit 5000

# Little Rock, Arkansas  (3,894)
node scripts/enrich-freedmens-docai.js --branch-like "Little Rock" --limit 5000

# Natchez, Mississippi  (1,911)
node scripts/enrich-freedmens-docai.js --branch-like "Natchez" --limit 2500

# St. Louis, Missouri  (628)
node scripts/enrich-freedmens-docai.js --branch-like "St. Louis" --limit 1000

# Lynchburg, Virginia  (413)
node scripts/enrich-freedmens-docai.js --branch-like "Lynchburg" --limit 600

# Philadelphia, Pennsylvania  (122)
node scripts/enrich-freedmens-docai.js --branch-like "Philadelphia" --limit 200

# Raleigh, North Carolina  (4)
node scripts/enrich-freedmens-docai.js --branch-like "Raleigh" --limit 10
```

### Resuming after a crash / interrupt

```bash
# Find the last successfully processed id in the logs, then:
node scripts/enrich-freedmens-docai.js \
  --branch-like "Augusta" \
  --start-id 123456 \
  --limit 50000
```

### Dry-run / sanity check

```bash
node scripts/enrich-freedmens-docai.js \
  --branch-like "Augusta" \
  --limit 5 \
  --dry-run
```

---

## TASK 3 — VERIFY ENRICHMENT PROGRESS

After each branch (or any time), run the audit from Mac Mini:

```bash
cd /Users/danyelica/Desktop/Reparations-is-a-real-number
node scripts/audit-pipeline-state.js
```

Or from this machine (code-only):

```bash
node scripts/audit-pipeline-state.js
```

---

## KNOWN ISSUES / DATA NOTES

### 1860 unconfirmed_persons — garbled locations
- 696 rows in `unconfirmed_persons` matched the 1860 filter but have garbled `locations[1]` values (word fragments like "County", "Dallas", "Peter" instead of state names).  
- `extraction_method = 'ml'` — these were stored by a prior ML extraction pass, not the FamilySearch scraper.  
- These are NOT additional scraping work. They need a targeted cleanup/backfill, not re-scraping.  
- The real 1860 scrape output lives in `person_documents` (139,995 `census_slave_schedule` rows).

### Freedman's Bank — zero person_documents links
- `person_documents` currently has only 2 rows with `document_type = 'freedmens_bank'`.  
- The DocAI enricher writes results to `unconfirmed_persons.relationships` JSONB and S3, but does NOT yet write a `person_documents` row.  
- A backfill script (`backfill-freedmens-to-person-documents.js`) should be written after enrichment is complete to create proper `person_documents` rows for all enriched depositors.

### parse_failure_queue column mismatch
- The `parse_failure_queue` table does not have a `source_table` column (migration 044 may have used a different schema). Failures from the DocAI enricher go to this table — check actual column names before querying.

---

## DO NOT DO ON THIS MACHINE (MacBook)

- ❌ `node scripts/enrich-freedmens-docai.js` — requires Chrome + FamilySearch session
- ❌ `bash finish-1860-remaining.sh` — requires Chrome + FamilySearch session
- ❌ `node scripts/extract-census-ocr.js` — requires Chrome + FamilySearch session
- ❌ `node scripts/scrape-freedmens-bank-indexed.js` — requires Chrome + FamilySearch session
- ✅ Code changes, migrations, `git push` → Render auto-deploy
- ✅ `node scripts/audit-pipeline-state.js` — read-only, safe anywhere
- ✅ `node scripts/e2e-link-checker.js` — safe, hits live API
