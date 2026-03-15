# Multi-Source Genealogy Integration Setup Guide

## Overview

The Multi-Source Genealogy System integrates evidence from multiple genealogical sources to build comprehensive family trees with legally-defensible documentation. The system automatically:

- Searches WikiTree for slaveholder profiles and extracts descendants
- Verifies evidence across sources (detecting conflicts, calculating confidence)
- Tracks source quality (primary, secondary, tertiary tiers)
- Runs continuously on Mac Mini via LaunchD

---

## Architecture

### Agent-Based System

Three agents run in parallel:

1. **WikiTree Genealogy Agent** - Finds slaveholder profiles, extracts descendants
2. **Cross-Verification Agent** - Compares evidence, detects conflicts, updates confidence scores
3. **FamilySearch Census Agent** - Extracts 1860 Slave Schedule data (existing)

### Database Schema (Migration 030)

- `unified_persons` - Consolidated person records from all sources
- `person_evidence_sources` - Documentary evidence with source tier tracking
- `person_relationships_verified` - Family relationships backed by evidence
- `evidence_verification_log` - Audit trail of cross-source verification
- `agent_processing_queue` - Work queue for agents

---

## Installation

### Step 1: Run Database Migration

```bash
# Connect to your Neon database
psql $DATABASE_URL

# Run migration 030
\i migrations/030-multi-source-genealogy-evidence.sql
```

**Note:** Migration creates all tables with `IF NOT EXISTS`, safe to run multiple times.

### Step 2: Install Node Dependencies

No new dependencies required - uses existing packages:
- `@neondatabase/serverless` (database)
- `https` (built-in, for WikiTree API)

### Step 3: Make Scripts Executable

```bash
chmod +x scripts/mac-mini-setup/run-genealogy-suite.sh
```

---

## Usage

### Manual Testing (Development)

Test individual agents:

```bash
# Test WikiTree agent
node scripts/agents/wikitree-genealogy-agent.js

# Test cross-verifier
node scripts/agents/cross-verifier-agent.js

# Test all agents in parallel
./scripts/mac-mini-setup/run-genealogy-suite.sh
```

### Production Deployment (Mac Mini)

#### Option 1: Manual Start
```bash
./scripts/mac-mini-setup/run-genealogy-suite.sh
```

Logs to: `logs/genealogy-suite-YYYYMMDD.log`

#### Option 2: Auto-Start via LaunchD

Update `install-services.sh` to use new runner:

```bash
# Edit scripts/mac-mini-setup/install-services.sh
# Change line 43 from:
#   <string>$PROJECT_DIR/scripts/mac-mini-setup/run-scraper.sh</string>
# To:
#   <string>$PROJECT_DIR/scripts/mac-mini-setup/run-genealogy-suite.sh</string>

# Then run:
./scripts/mac-mini-setup/install-services.sh
```

The service will:
- Start automatically on boot
- Restart automatically on crash
- Run all 3 agents in parallel

---

## Monitoring

### View Live Logs

```bash
# All agents
tail -f logs/genealogy-suite-$(date +%Y%m%d).log

# LaunchD logs
tail -f logs/launchd-stdout.log
tail -f logs/launchd-stderr.log
```

### Check Agent Status

```bash
# Check if service is running
launchctl list | grep reparations

# Check process IDs
cat logs/wikitree.pid
cat logs/verifier.pid
cat logs/familysearch.pid
```

### Database Queries

```sql
-- Persons needing verification
SELECT * FROM persons_needing_verification LIMIT 20;

-- High-confidence persons (90+ evidence strength)
SELECT * FROM high_confidence_persons LIMIT 20;

-- Recent evidence conflicts
SELECT * FROM evidence_conflicts ORDER BY verified_at DESC LIMIT 20;

-- Agent queue status
SELECT agent_type, status, COUNT(*) 
FROM agent_processing_queue 
GROUP BY agent_type, status;

-- Evidence strength distribution
SELECT 
  CASE 
    WHEN evidence_strength >= 90 THEN '90-100 (Court-admissible)'
    WHEN evidence_strength >= 70 THEN '70-89 (Strong)'
    WHEN evidence_strength >= 50 THEN '50-69 (Probable)'
    ELSE '0-49 (Weak)'
  END as strength_category,
  COUNT(*) as person_count
FROM unified_persons
WHERE evidence_strength > 0
GROUP BY strength_category
ORDER BY strength_category DESC;
```

---

## Source Tier System

### Tier 1: Primary Sources (30 points each)
Created at the time of the event by official entities:
- Birth certificates
- Death certificates
- Marriage licenses
- Census records (original enumeration)
- Probate records
- Tax records
- Court records

### Tier 2: Secondary Sources (15 points each)
Created after the event:
- Church records
- Cemetery records
- Family Bibles
- Newspapers
- City directories

### Tier 3: Tertiary Sources (5 points each)
Compiled information:
- FamilySearch user trees
- WikiTree profiles
- Ancestry.com trees
- FindAGrave transcriptions

**Rule:** Never cite Tier 3 as sole evidence. Always verify against Tier 1/2 sources.

---

## Evidence Strength Calculation

```
Base Score = (Primary Sources × 30) + (Secondary Sources × 15) + (Tertiary Sources × 5)

Agreement Bonus = +20 if multiple sources agree on facts
Conflict Penalty = -10 per conflict detected

Final Score = Min(100, Max(0, Base Score + Bonuses - Penalties))
```

**Confidence Levels:**
- **90-100:** Court-admissible (multiple primary sources agree)
- **70-89:** Strong evidence (primary + secondary sources)
- **50-69:** Probable (secondary sources only or single primary)
- **30-49:** Possible (tertiary only or significant conflicts)
- **0-29:** Speculative (insufficient evidence)

---

## Extending the System

### Adding New Agents

1. Create new agent file in `scripts/agents/`:

```javascript
const BaseAgent = require('./BaseAgent');

class MyNewAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'my_new_agent',
      rateLimit: 2000,
      batchSize: 10
    });
  }
  
  async processItem(item) {
    // Your processing logic
    return { success: true };
  }
}

module.exports = MyNewAgent;
```

2. Add to `run-genealogy-suite.sh`:

```bash
run_agent "MyAgent" "$PROJECT_DIR/scripts/agents/my-new-agent.js" 180 &
```

### Adding New Sources

1. Create evidence source:

```sql
INSERT INTO person_evidence_sources (
  unified_person_id,
  source_type,
  source_tier,
  source_id,
  source_url,
  provides_birth_date,
  provides_death_date,
  extracted_data,
  confidence_score,
  extraction_method
) VALUES (
  123,
  'my_new_source',
  1, -- or 2, or 3
  'external-id-123',
  'https://...',
  true,
  false,
  '{"birthYear": 1820}'::jsonb,
  0.95,
  'api'
);
```

2. Evidence strength automatically recalculated via trigger.

---

## Troubleshooting

### Agent Won't Start

```bash
# Check database connection
node -e "require('dotenv').config(); const { neon } = require('@neondatabase/serverless'); const sql = neon(process.env.DATABASE_URL); sql\`SELECT 1\`.then(() => console.log('OK')).catch(console.error);"

# Check for syntax errors
node --check scripts/agents/wikitree-genealogy-agent.js
```

### Queue Not Processing

```sql
-- Check for stuck items
SELECT * FROM agent_processing_queue 
WHERE status = 'processing' 
AND last_attempt < NOW() - INTERVAL '30 minutes';

-- Reset stuck items
UPDATE agent_processing_queue 
SET status = 'pending', next_attempt = NOW() 
WHERE status = 'processing' 
AND last_attempt < NOW() - INTERVAL '30 minutes';
```

### High Error Rate

```sql
-- Check error patterns
SELECT agent_type, error_message, COUNT(*) 
FROM agent_processing_queue 
WHERE status = 'error' 
GROUP BY agent_type, error_message 
ORDER BY COUNT(*) DESC;
```

---

## Performance Tuning

### Adjust Rate Limits

Edit agent constructors:

```javascript
super({
  rateLimit: 3000, // Increase = slower but safer
  batchSize: 5,    // Increase = more memory, faster processing
  maxRetries: 3    // Increase = more persistent on errors
});
```

### Adjust Agent Restart Delays

Edit `run-genealogy-suite.sh`:

```bash
run_agent "WikiTree" "$PROJECT_DIR/scripts/agents/wikitree-genealogy-agent.js" 180 &
#                                                                              ^^^
#                                                                              Seconds between restarts
```

### Database Indexes

Already created by migration 030. If queries are slow:

```sql
-- Check index usage
EXPLAIN ANALYZE SELECT * FROM unified_persons WHERE canonical_name LIKE '%Smith%';

-- Add custom indexes as needed
CREATE INDEX idx_custom ON table_name(column_name);
```

---

## Next Steps

### Tier 1 Expansion (Free APIs - Ready to Implement)

1. **FamilySearch Records API** (FREE)
   - Birth/death/marriage indexes
   - 10,000 requests/day limit
   - Requires FamilySearch developer account

2. **NARA Catalog API** (FREE)
   - Freedmen's Bureau records
   - U.S. Colored Troops military records
   - No authentication required

3. **Library of Congress Chronicling America** (FREE)
   - Historical newspapers 1836-1922
   - Birth/death/marriage announcements

### Tier 2 Expansion (Free Archives)

1. **Maryland State Archives** (expanded coverage)
2. **Library of Congress** (newspapers, rare books)
3. **National Archives** (Freedmen's Bureau, military)

### Tier 3 (Requires Access)

1. **IPUMS Full Count Census** (restricted, pending approval)
2. **Ancestry.com** (see University Library Access guide below)

---

## University Library Access for Ancestry.com

See separate guide: `docs/ANCESTRY-LIBRARY-ACCESS.md`

**TL;DR:** Many university libraries provide free Ancestry.com access to cardholders. This avoids $300/month API subscription.

---

## Support

- **Documentation:** `docs/` directory
- **Issues:** Check `logs/` files first
- **Database:** Query `evidence_verification_log` for debugging

---

*Last Updated: January 4, 2026*
