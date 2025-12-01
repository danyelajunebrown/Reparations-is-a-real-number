# 🧬 Roadmap: AI-Powered Genealogy Assistant

**Goal:** Make the research assistant smart enough to build verified lineages from natural language

---

## Current Limitations

### What Works Now ✅
- "James had two children Anne and Robert" → Adds flat list of children
- "Nancy's FamilySearch ID is LZDN-4B8" → Attaches ID to person
- "do you have James Hopewell?" → Searches database

### What Breaks ❌
- Nested structures: "Mary (who had children John, Sarah)"
- Multiple generations: Children → Grandchildren → Great-grandchildren
- Complex relationships: Step-children, adopted children, multiple spouses
- Dates with uncertainty: "circa 1820", "unknown–1888"
- Nicknames and titles: "Don Marcos", "The Commodore"

---

## Enhancement Phases

### **Phase 1: Structured Import (IMPLEMENTED)** ✅

**Solution:** Dedicated import scripts for complex data
- `import-dewolf-lineage.js` - Handles nested genealogy
- `add-james-hopewell-descendants.js` - Template for other families
- User provides data in JavaScript format
- Script validates and imports to database

**Pros:**
- Works now for any complexity
- Full control over data structure
- Easy to verify before import

**Cons:**
- Requires technical knowledge
- Not conversational
- Must edit script for each family

---

### **Phase 2: Conversational Tree Builder** (Next)

**Approach:** Multi-turn conversation to build trees

**Example Conversation:**
```
User: I want to add descendants for James DeWolf
AI: Great! Let's build James DeWolf's family tree. How many children did James have?
User: 5 children
AI: Perfect. Let's add them one by one. Who is child #1?
User: Mary Ann DeWolf Sumner, born 1795, died 1834
AI: ✓ Added Mary Ann. Did Mary Ann have children?
User: Yes, 3 children
AI: Who is Mary Ann's first child?
User: James DeWolf Perry, 1815-1876
AI: ✓ Added James DeWolf Perry as grandchild. Continue? (yes/no)
...
```

**Implementation:**
1. Add new intent: `build_family_tree`
2. Create multi-step conversation state machine
3. Guide user through tree construction
4. Validate at each step
5. Summarize and confirm before saving

**Technical Requirements:**
- Session state management (track current person, generation)
- Validation at each step (dates, names, gender)
- Ability to backtrack and correct
- Preview before final save

**Pros:**
- No coding needed
- Guided process
- Natural conversation

**Cons:**
- Slower than bulk import
- Many back-and-forth exchanges
- User must know full tree beforehand

---

### **Phase 3: Intelligent Parsing** (Future)

**Approach:** Parse complex natural language genealogy

**Example Input:**
```
"James DeWolf (1764-1837) married Nancy D'Wolf (1769-1850). They had 5 children:
1. Mary Ann (1795-1834) who married Sumner and had 3 children: James Perry (1815-1876), Nancy Lay (1819-1883), Alexander (1822-1888)
2. Mark Antony 'Don Marcos' D'Wolf IV (1799-1851) who had 1 child: Francis LeBaron (1826-1861)
..."
```

**AI Output:**
```
✓ Parsed family tree:
  • 2 parents
  • 5 children
  • 9 grandchildren
  • 16 relationships created

Would you like to import this? (yes/no)
```

**Technical Requirements:**
1. **Advanced NLP Parser:**
   - Named Entity Recognition (NER) for person names
   - Date extraction with multiple formats
   - Relationship extraction (married, had children, etc.)
   - Nested structure parsing (parentheses, indentation)

2. **Relationship Graph Builder:**
   - Build family tree from parsed entities
   - Detect parent-child, spouse, sibling relationships
   - Handle multiple generations
   - Resolve ambiguous references

3. **Data Validation:**
   - Check for logical errors (child born before parent)
   - Detect duplicate people
   - Flag uncertain data for review
   - Suggest missing information

4. **LLM Integration:**
   - Use GPT-4/Claude for entity extraction
   - Structured output format (JSON)
   - Few-shot learning with examples
   - Fallback to pattern matching

**Implementation Steps:**

1. **Create Genealogy Parser Module** (`genealogy-parser.js`)
   ```javascript
   class GenealogyParser {
       parseText(text) {
           // 1. Extract all people with dates
           // 2. Identify relationships
           // 3. Build tree structure
           // 4. Validate logical consistency
           return familyTree;
       }
   }
   ```

2. **Add LLM Endpoint for Structured Extraction**
   ```javascript
   async function extractGenealogyFromText(text) {
       const prompt = `Extract genealogy data from this text...`;
       const result = await callLLM(prompt);
       return JSON.parse(result);
   }
   ```

3. **Enhance Research Assistant**
   - New intent: `import_genealogy_text`
   - Pattern: Long multi-line text with names and dates
   - Use LLM to parse, then validate
   - Preview before saving

**Pros:**
- Fast bulk import
- Natural language input
- Handles complex structures

**Cons:**
- Requires LLM API (cost)
- Parsing errors possible
- Needs extensive testing

---

### **Phase 4: Interactive Verification** (Advanced)

**Approach:** AI suggests lineages, user verifies

**Example:**
```
AI: I found a potential descendant: "William D'Wolf Jr (1840-1902)"
    Based on:
    - Name similarity to William Bradford D'Wolf (1810-1852)
    - Age gap suggests parent-child (30 years)
    - Found in same census district

    Add as child of William Bradford D'Wolf? (yes/no/uncertain)

User: yes

AI: ✓ Added relationship. Confidence: 85%
    Would you like to see evidence? (yes/no)
```

**Technical Requirements:**
- Fuzzy name matching
- Age gap analysis
- Location-based inference
- Source citation tracking
- Confidence scoring

---

## Recommended Approach

### **For Now (Immediate):**
✅ **Use the import scripts** (`import-dewolf-lineage.js`)
- Fast and reliable
- Full control
- Works for any complexity

### **Short Term (1-2 months):**
🔨 **Implement Phase 2: Conversational Tree Builder**
- Add to research assistant
- Guide users through tree construction
- No coding required

### **Medium Term (3-6 months):**
🤖 **Implement Phase 3: Intelligent Parsing**
- Add LLM integration (GPT-4 or Claude)
- Parse complex genealogy text
- Validate and preview before saving

### **Long Term (6-12 months):**
🧠 **Implement Phase 4: Interactive Verification**
- AI suggests relationships from documents
- User verifies with evidence
- Build lineages semi-automatically

---

## Technical Architecture

### **Genealogy Data Model**

```javascript
{
    person: {
        id: 'unique_id',
        fullName: 'James DeWolf',
        birthYear: 1764,
        deathYear: 1837,
        gender: 'Male',
        confidence: 'HIGH', // HIGH, MEDIUM, LOW
        sources: ['document_id_1', 'census_1820']
    },
    relationships: [
        {
            type: 'parent-child',
            parent: 'james_dewolf_id',
            child: 'mary_ann_id',
            confidence: 'HIGH',
            source: 'will_probate_1837'
        }
    ]
}
```

### **Validation Rules**

1. **Age constraints:**
   - Parent must be 15-60 years older than child
   - Spouse age gap < 30 years (usually)

2. **Date constraints:**
   - Birth before death
   - Marriage after age 15
   - Children born during parent's lifetime

3. **Name constraints:**
   - Children often share parent's surname
   - Married women may change surname

### **Confidence Scoring**

| Evidence | Confidence |
|----------|-----------|
| Primary source (will, birth record) | HIGH |
| Census with matching ages/locations | MEDIUM |
| Name similarity + age gap | LOW |
| Web scraped data (unverified) | UNCONFIRMED |

---

## Testing Plan

### **Test Cases:**

1. **Simple lineage:** 1 parent, 3 children
2. **Multi-generation:** Parents → Children → Grandchildren
3. **Complex names:** Nicknames, titles, multiple surnames
4. **Uncertain dates:** "circa 1820", "unknown"
5. **Multiple spouses:** Remarriage, step-children
6. **Adopted children:** Non-biological relationships
7. **Errors:** Impossible dates, circular relationships

---

## Resources Needed

### **For Phase 2 (Conversational):**
- ✅ Existing database schema (relationships table)
- ✅ Session state management (already implemented)
- 🔨 Conversation flow state machine (2-3 days)
- 🔨 Input validation (1 day)

### **For Phase 3 (Intelligent Parsing):**
- 💰 LLM API access (OpenRouter/OpenAI)
- 🔨 Parser module (1 week)
- 🔨 Tree validation logic (3 days)
- 🧪 Extensive testing (1 week)

### **For Phase 4 (Interactive Verification):**
- 🔨 Fuzzy matching algorithm (1 week)
- 🔨 Confidence scoring system (3 days)
- 🔨 Evidence citation system (1 week)
- 🧪 Real-world testing (ongoing)

---

## Success Metrics

| Phase | Success Criteria |
|-------|-----------------|
| Phase 1 (Scripts) | ✅ Import 3+ families successfully |
| Phase 2 (Conversational) | User builds 10-person tree in <10 minutes |
| Phase 3 (Parsing) | 90%+ accuracy on test genealogies |
| Phase 4 (Verification) | 80%+ of AI suggestions accepted by users |

---

## Current Status

✅ **Phase 1 Complete** - Import scripts working
⏳ **Phase 2 Next** - Design conversation flow
📋 **Phase 3 Planned** - LLM parser design
💡 **Phase 4 Future** - Research phase

---

## Your Next Steps

1. **Run the DeWolf import:** `node import-dewolf-lineage.js`
2. **Test in carousel:** Click James/Nancy to see descendants
3. **Provide feedback:** What works? What's confusing?
4. **Prioritize phases:** Which enhancement do you want first?

---

**Ready to import the DeWolf lineage!** 🚀

Run: `node import-dewolf-lineage.js`
