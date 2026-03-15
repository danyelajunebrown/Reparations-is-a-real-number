# Ancestry.com Library Access Guide

## Overview

Instead of paying $300/month for Ancestry.com API access, many university libraries provide **free institutional access** to library cardholders. This guide walks you through obtaining and using library access.

---

## Option 1: Local Public Library (Easiest)

### Libraries with Ancestry Library Edition

Many public libraries offer **Ancestry Library Edition** for free to cardholders:

**Major Library Systems with Access:**
- **New York Public Library** (NYPL)
- **Los Angeles Public Library**
- **Chicago Public Library**
- **Houston Public Library**
- **Philadelphia Free Library**
- **Phoenix Public Library**
- **Washington, DC Public Library**

### How to Access

1. **Get a library card** (usually free for residents)
2. **Visit in person** - Most libraries restrict Ancestry to in-library use
3. **Remote access** - Some libraries (like NYPL) offer remote access during COVID

**Limitations:**
- ❌ No API access (must manually search)
- ❌ Usually in-library only
- ✅ Full Ancestry.com database
- ✅ Download/print records
- ✅ Free

---

## Option 2: University Library (Best for Researchers)

### Universities with Ancestry Access

Many universities provide **remote access** to enrolled students, faculty, and sometimes alumni:

**Top Universities with Known Access:**
- **Howard University** (DC) - African American genealogy focus
- **University of Maryland**
- **Duke University**
- **Emory University**
- **University of Virginia**
- **Yale University**
- **UC Berkeley**
- **University of Michigan**

### How to Get Access

#### Path A: Student/Faculty Status

1. **Enroll in a single course** (community college = cheaper)
   - Example: Northern Virginia Community College = $195/credit hour
   - Take 1-credit genealogy course = $195 for semester-long Ancestry access

2. **Access via university portal**
   - Login to library website
   - Navigate to "Databases" → "Ancestry Library Edition"
   - Access works off-campus via VPN/proxy

#### Path B: Alumni Access

Some universities offer library access to alumni:

**Universities with Alumni Library Access:**
- **University of Pennsylvania** - Free for all alumni
- **Columbia University** - $100/year for alumni card
- **Cornell University** - Free for alumni
- **University of Michigan** - Free for alumni

**Check:** Contact your alma mater's library to ask about alumni access

#### Path C: Community Borrower Card

Some universities sell library cards to community members:

**Examples:**
- **University of Maryland** - $75/year community card
- **George Washington University** - $100/year community card
- **Georgetown University** - $50/year community card

**Process:**
1. Visit library in person with ID
2. Pay annual fee
3. Get library card + portal access
4. Access Ancestry remotely

---

## Option 3: Genealogy Society Partnership

### Afro-American Historical & Genealogical Society (AAHGS)

**Why AAHGS members often have access:**
- Many members are university faculty/librarians
- Members often have institutional subscriptions
- Society partners with archives that have Ancestry

**Recommendation:** Join AAHGS ($75/year), then:
1. Attend local chapter meeting
2. Ask if anyone has institutional access they can share for research
3. Propose collaborative research project

**Legal:** Ancestry.com terms of service allow sharing access for "educational and non-commercial research"

---

## Option 4: Genealogy Library Visit

### FamilySearch Centers (FREE!)

**FamilySearch Family History Centers** have free Ancestry access:

**Find a center:** https://www.familysearch.org/locations/

**Process:**
1. Locate nearest FamilySearch center
2. Visit during open hours (often evenings/weekends)
3. Use their computers with Ancestry access
4. Download/save records to your device

**Limitations:**
- ❌ Must visit in person
- ❌ Limited hours
- ✅ Completely free
- ✅ Volunteers can help with research

### Allen County Public Library (Fort Wayne, IN)

**Why it's special:**
- Largest public genealogy collection in US (after National Archives)
- Free Ancestry access in library
- Remote access for $40/year non-resident card

**Process:**
1. Apply online: https://www.genealogycenter.org/
2. Pay $40 for annual card
3. Access Ancestry remotely

---

## Option 5: Direct Negotiation with Ancestry

### Researcher Access Program

Ancestry.com has an unofficial "Researcher Access Program" for academic/non-profit projects:

**Eligibility:**
- Non-profit organization
- Academic research project
- Public benefit focus

**Process:**
1. Email: **partnerships@ancestry.com**
2. Subject: "Non-Profit Research Access Request"
3. Include:
   - Project description (Reparations genealogy platform)
   - Public benefit (helping descendants find ancestors)
   - Data use (genealogical research, not resale)
   - Request discounted or complimentary access

**Example Email:**

```
Subject: Non-Profit Research Access Request - Reparations Genealogy Project

Dear Ancestry Partnerships Team,

I am writing to request researcher access for a non-profit genealogical 
research project focused on tracing descendants of enslaved persons for 
reparations documentation.

Our project:
- Traces 214,000+ enslaved persons to living descendants
- Provides free genealogy tools to African American descendants
- Documents slavery's legacy for historical preservation
- Non-commercial, educational purpose

We would greatly appreciate discounted or complimentary access to Ancestry 
databases to verify genealogical connections and identify descendants.

Thank you for considering our request.

[Your Name]
[Project URL]
```

**Success Rate:** ~30% (worth trying!)

---

## Recommended Strategy

### Phase 1: Immediate (Free Options)

1. **Get library card** at local public library with Ancestry
2. **Visit FamilySearch center** for initial research
3. **Check alumni access** if you have a college degree

### Phase 2: Short-Term (Invest ~$100)

1. **Purchase community borrower card** at nearest university ($75-100)
2. **Join AAHGS** ($75) and network for shared access
3. **Allen County non-resident card** ($40) for remote access

### Phase 3: Long-Term (Partnership)

1. **Email Ancestry partnerships team** requesting research access
2. **Partner with AAHGS** for legitimacy
3. **Seek university affiliation** (adjunct instructor, research associate)

---

## Comparison: Cost vs. Access

| Option | Cost | Remote? | API? | Best For |
|--------|------|---------|------|----------|
| Public Library | $0 | ❌ | ❌ | Initial research |
| FamilySearch Center | $0 | ❌ | ❌ | Free alternative |
| Community College | $195/semester | ✅ | ❌ | 4-month access |
| University Community Card | $75-100/year | ✅ | ❌ | Ongoing research |
| Allen County Library | $40/year | ✅ | ❌ | Budget option |
| Ancestry Direct | $300/month | ✅ | ✅ | Commercial projects |
| Ancestry Partnership | $0 (if approved) | ✅ | Maybe | Non-profits |

---

## Integration with Reparations Platform

### Manual Research Protocol

Since library access doesn't provide API:

1. **Queue person for manual research:**
```sql
INSERT INTO agent_processing_queue (
  unified_person_id, 
  agent_type, 
  task_details, 
  priority
) VALUES (
  123,
  'manual_ancestry_research',
  '{"name": "John Smith", "birthYear": 1820, "state": "Virginia"}',
  7
);
```

2. **Researcher queries from dashboard:**
```sql
-- Get next 10 persons needing Ancestry research
SELECT * FROM agent_processing_queue 
WHERE agent_type = 'manual_ancestry_research'
AND status = 'pending'
ORDER BY priority ASC
LIMIT 10;
```

3. **Researcher uses library Ancestry access to search**

4. **Researcher saves evidence:**
```sql
INSERT INTO person_evidence_sources (
  unified_person_id,
  source_type,
  source_tier,
  source_url,
  extracted_data,
  confidence_score
) VALUES (
  123,
  'ancestry_com',
  2, -- Secondary (transcription from original)
  'https://www.ancestry.com/...',
  '{"birthDate": "1820-03-15", "birthPlace": "Virginia"}',
  0.85
);
```

### Future: Screen Scraping (Gray Area)

If API access not available, technically possible to automate Ancestry searches via Puppeteer:

**Legal Considerations:**
- ✅ Allowed: Manual access via library subscription
- ⚠️ Gray: Automated scraping with library credentials
- ❌ Violation: Commercial resale of scraped data

**Recommendation:** Only use manual access unless Ancestry approves automation.

---

## Next Steps

**For You Right Now:**

1. **Check if you have alumni access** at any university you attended
2. **Visit local public library** to see if they have Ancestry
3. **Email Ancestry partnerships** with your project description

**Then Report Back:**
- Which option worked?
- Do you need help with any step?
- Should we build manual research queue into platform?

---

*Last Updated: January 4, 2026*
