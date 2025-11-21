# Automatic Lineage Tracing Strategies

## The Problem
Genealogy platforms (FamilySearch, Ancestry) don't export lineage as simple CSV tables.
We need **automated** ways to:
1. Fetch entire descendant trees from genealogy APIs
2. Parse genealogy files (GEDCOM)
3. Infer relationships from documents we already have
4. Allow users to build trees interactively

---

## ✅ BEST APPROACH: FamilySearch API Integration

### Why This Is The Best Option
- **Official API** with OAuth authentication
- **Fetch entire trees programmatically** (ancestors + descendants)
- **Real-time sync** - get updates when users add family members
- **Free for non-commercial use**
- **Handles James Hopewell's tree automatically**

### How It Works

```
User clicks "Import from FamilySearch"
  ↓
Authenticate via OAuth
  ↓
User selects ancestor (James Hopewell: MTRV-272)
  ↓
System fetches ALL descendants recursively
  ↓
Imports 342 descendants into database
  ↓
Calculates reparations distribution
```

### Implementation Plan

#### 1. FamilySearch OAuth Setup
- Register app at: https://www.familysearch.org/developers/
- Get Client ID and Secret
- Implement OAuth2 flow

#### 2. Fetch Descendant Tree
```javascript
// Pseudocode
async function fetchDescendantTree(personId, maxGenerations) {
  // Start with ancestor
  const person = await familySearchAPI.getPerson(personId);

  // Recursively fetch children
  for (let gen = 1; gen <= maxGenerations; gen++) {
    const children = await familySearchAPI.getChildren(currentPersonIds);
    // Import to database
    // Continue recursion
  }
}
```

#### 3. API Endpoints Needed
```
GET /platform/tree/persons/{personId}
GET /platform/tree/persons/{personId}/children
GET /platform/tree/persons/{personId}/spouses
GET /platform/tree/persons/{personId}/parents
```

---

## ✅ APPROACH 2: GEDCOM File Parser

### What is GEDCOM?
- **GE**nealogical **D**ata **COM**munication
- Universal genealogy file format (like CSV for family trees)
- Supported by ALL genealogy platforms
- Contains full tree structure with relationships

### How Users Get GEDCOM Files

**FamilySearch:**
1. Go to Family Tree
2. Click person → "Tree" → "Download GEDCOM"
3. Exports entire family tree as `.ged` file

**Ancestry.com:**
1. Go to "Trees"
2. Click tree name → "Tree Settings" → "Export tree"
3. Downloads `.ged` file

### GEDCOM Structure Example
```
0 @I1@ INDI
1 NAME James /Hopewell/
1 SEX M
1 BIRT
2 DATE 1780
2 PLAC Maryland
1 DEAT
2 DATE 1825
1 FAMS @F1@

0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I4@
```

### Implementation
- Use `gedcom` npm package to parse
- Extract all INDI (individual) records
- Extract all FAM (family) records
- Build relationship graph
- Import to database

---

## ✅ APPROACH 3: Smart Document Inference (Use What We Have!)

### The Insight
**You already have historical documents that mention relationships!**

Example from a will:
```
"I bequeath to my son James Robert Hopewell..."
"...to my daughter Anne Maria Hopewell..."
"...my wife Angelica Chesley..."
```

### How It Works

#### Step 1: Enhanced OCR Extraction
Parse documents for relationship keywords:
- "son", "daughter", "child", "children"
- "wife", "husband", "spouse", "married"
- "mother", "father", "parent"
- "grandson", "granddaughter", "grandchild"
- "heir", "descendant"

#### Step 2: Named Entity Recognition (NER)
Extract person names near relationship keywords:
```
"my son [James Robert Hopewell]" → parent-child relationship
"married [Angelica Chesley]" → spouse relationship
```

#### Step 3: Auto-Create Relationships
```javascript
Document mentions: "James Hopewell's son James Robert Hopewell"
  ↓
System automatically creates:
  - Person: James Hopewell (if doesn't exist)
  - Person: James Robert Hopewell
  - Relationship: parent-child (James → James Robert)
  - Confidence: 0.85 (from document evidence)
```

#### Step 4: Human Verification
- Show inferred relationships to user
- User confirms or corrects
- System learns from corrections

---

## ✅ APPROACH 4: Interactive Tree Builder UI

### Visual Family Tree Editor
Allow users to manually add family members through intuitive UI:

```
[James Hopewell 1780-1825]
    │
    ├─ [+ Add Child]
    ├─ [Anne Maria Hopewell 1799-1881]
    │   └─ [+ Add Child]
    └─ [James Robert Hopewell 1813-1872]
        ├─ [+ Add Child]
        └─ [Sarah Elizabeth 1835-1905]
```

### Features
- Drag-and-drop interface
- Auto-suggest from FamilySearch
- Import from clipboard (copy/paste from FamilySearch)
- Bulk add multiple children at once

---

## 🏆 RECOMMENDED IMPLEMENTATION ORDER

### Phase 1: GEDCOM Parser (QUICKEST WIN)
**Timeline**: 1-2 days
**Why First**: Users can export from FamilySearch/Ancestry TODAY and import

```javascript
// User workflow:
1. Go to FamilySearch → Export GEDCOM
2. Upload .ged file to your platform
3. System parses and imports entire tree
4. DONE - 342 descendants imported in 30 seconds
```

### Phase 2: Smart Document Inference (LEVERAGE EXISTING DATA)
**Timeline**: 3-5 days
**Why Second**: Extract relationships from documents you already have

```javascript
// Automatic workflow:
1. Re-process all existing documents with enhanced NER
2. Extract relationship mentions
3. Build relationship graph automatically
4. Present to user for verification
```

### Phase 3: FamilySearch API (BEST LONG-TERM)
**Timeline**: 1-2 weeks
**Why Third**: Most powerful but requires OAuth setup

```javascript
// User workflow:
1. Click "Connect FamilySearch"
2. Authorize access
3. Select ancestor
4. Auto-fetch entire tree
5. Sync updates automatically
```

### Phase 4: Interactive Tree Builder (USER FRIENDLY)
**Timeline**: 1 week
**Why Last**: Nice-to-have for manual corrections

---

## 🚀 Let's Start with GEDCOM Parser

### Implementation

#### 1. Install GEDCOM Parser
```bash
npm install gedcom
npm install parse-gedcom
```

#### 2. Create `gedcom-importer.js`
```javascript
const fs = require('fs');
const parse = require('parse-gedcom');

class GedcomImporter {
  async importGedcomFile(filePath) {
    // Read GEDCOM file
    const gedcomData = fs.readFileSync(filePath, 'utf8');

    // Parse to JSON structure
    const tree = parse(gedcomData);

    // Extract individuals
    const individuals = this.extractIndividuals(tree);

    // Extract families (relationships)
    const families = this.extractFamilies(tree);

    // Import to database
    await this.importToDatabase(individuals, families);
  }

  extractIndividuals(tree) {
    // Find all INDI records
    // Extract: name, birth, death, sex, etc.
  }

  extractFamilies(tree) {
    // Find all FAM records
    // Extract: husband, wife, children
  }
}
```

#### 3. Add Upload Endpoint
```javascript
// server.js
app.post('/api/genealogy/import-gedcom', upload.single('gedcom'), async (req, res) => {
  const gedcomFile = req.file.path;

  const importer = new GedcomImporter(pool);
  const result = await importer.importGedcomFile(gedcomFile);

  res.json({
    success: true,
    imported: result.personsCount,
    relationships: result.relationshipsCount
  });
});
```

#### 4. Add Frontend Upload Button
```html
<input type="file" accept=".ged" id="gedcomFile" />
<button onclick="uploadGedcom()">Import Family Tree</button>

<script>
async function uploadGedcom() {
  const file = document.getElementById('gedcomFile').files[0];
  const formData = new FormData();
  formData.append('gedcom', file);

  const response = await fetch('/api/genealogy/import-gedcom', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();
  alert(`Imported ${result.imported} people with ${result.relationships} relationships!`);
}
</script>
```

---

## 🎯 Which Approach First?

**My Recommendation**: Start with **GEDCOM Parser**

**Why?**
1. ✅ Works TODAY - users can export from FamilySearch immediately
2. ✅ No API keys needed
3. ✅ No OAuth complexity
4. ✅ Standard format (works with ANY genealogy platform)
5. ✅ Complete family trees in one file
6. ✅ Takes 1-2 days to implement

**Then Add**: Smart Document Inference (use what you have)
**Then Add**: FamilySearch API (best long-term solution)

---

## Example: James Hopewell GEDCOM Export

Tell me to build the GEDCOM parser first, and in 30 minutes you'll be able to:

1. Export James Hopewell's tree from FamilySearch as .ged
2. Upload to your platform
3. System imports all 342 descendants automatically
4. Ask "How many descendants does James Hopewell have?"
5. Get instant answer: "342 across 7 generations"

Should I build the GEDCOM parser now?
