# Interpretive Framework for Historical Slavery Records

**Last Updated:** December 7, 2025
**Purpose:** Critical guidelines for parsing, interpreting, and contextualizing OCR-extracted data from primary sources documenting slavery

---

## Core Principles

### 1. Center the Enslaved

Extract every available detail about enslaved individuals:
- **Names** - Given names, surnames (when present), nicknames, descriptive names
- **Skills** - Artisans, field workers, domestics, drivers, craftsmen
- **Movement** - Transfers between plantations, hiring out, forced relocations
- **Labor conditions** - Tasks, physical condition, health status
- **Punishments** - Documented violence, sentences, disciplinary actions
- **Negotiations** - Any evidence of agency, bargaining, self-advocacy
- **Family structures** - Parent-child relationships, marriages, separations

**Key insight:** Even brief mentions (e.g., "carrying Negroes," or a driver like Moses signing a receipt) are windows into lived experience, autonomy, and coerced responsibility.

### 2. Read Enslavers' Records Against the Grain

Recognize that documents authored by enslavers reflect **their perspective**, not objective truth.

**What to identify as omitted:**
- Violence (underreported or euphemized)
- Lack of consent (everything presented as transaction)
- Family separations (treated as business decisions)
- Coerced labor (presented as routine)
- Resistance (minimized or criminalized)

**Reconstruction approach:** Use patterns, gaps, and inconsistencies to infer what was deliberately obscured.

### 3. Track Financial Systems as Mechanisms of Violence

Understand these document types as **instruments of exploitation**:
- Leases
- Debt cases
- Overseer accounts
- Hiring-out receipts
- Inventories
- Tax assessments
- Estate valuations

**Analytical lens:** Note how enslaved people's bodies and labor appear as "units of value" - this reveals the economic machinery of slavery.

### 4. Pay Attention to Movement and Mobility

Document any:
- **Forced relocation** between plantations
- **Seasonal transport** (e.g., to/from Pine Ville in Ravenel papers)
- **Hiring-out** for public works, urban labor
- **Post-conviction sales** (after criminal proceedings)
- **Estate distributions** (inheritance transfers)

**Use movement patterns to understand:**
- Family disruption
- Labor demands and seasonal cycles
- Plantation logistics
- Fear of insurrection (dispersing "troublemakers")

### 5. Examine the Legal and Bureaucratic Machinery

Treat legal records as evidence of a **state apparatus built to protect slavery**:
- Debt suits
- Pardons and sentences
- Rewards for fugitives
- Militia mobilizations
- Cross-state cooperation (e.g., SC-GA pursuit of maroons)

### 6. Surface Evidence of Resistance

**Flag any reference to:**
- "Uprisings" or "conspiracies"
- "Runaways" or fugitives
- Unusual punishments
- Pardons tied to relocation
- Community formation (maroons, fugitive settlements)

**Reinterpretation:** Accusations of "rebellion" or "felony" should be viewed through the lens of self-emancipation and survival strategies.

### 7. Contextualize Fear and Surveillance

Evidence of enslaver anxiety reveals the constant threat slavery faced from those it oppressed:
- Letters about French-speaking enslaved people
- Post-Saint-Domingue/Haiti panic
- Militia formation
- Rumors of revolts
- Restrictions on movement, assembly, literacy

### 8. Highlight Hierarchies Within Enslaved Communities

Identify roles that suggest complexity:
- **Drivers** - Coerced authority, vulnerability to punishment from both sides
- **Artisans** - Skilled labor, potential mobility
- **Domestics** - Proximity to enslavers, complex negotiations
- **People entrusted with documentation** - Literacy, record-keeping
- **Resource management** - Allocations, distributions

**Interpretation:** These roles existed within constraints of coercion, vulnerability to punishment, and complex negotiation of survival.

### 9. Situate Local Records in Atlantic and Global Systems

Link records to broader networks:
- **Saint-Domingue/Haiti** - Fear of revolution, refugee influx
- **British Loyalists** - Post-Revolution migrations
- **Indigenous alliances** - Catawba, Cherokee interactions
- **Transatlantic trade** - Direct Africa connections, "New Negroes"
- **Imperial systems** - British, French, Spanish colonial structures

### 10. Avoid Normalizing Enslavers' Language

**When quoting:** Preserve original wording for accuracy.

**In analysis:**
- Accompany quotes with critical framing
- Use historically informed descriptors
- Replace dehumanizing terminology in analysis text

**Terminology guidance:**
| Historical Term | Analytical Alternative |
|----------------|----------------------|
| "Negroes" | Enslaved people, enslaved Africans |
| "New Negroes" | Recently arrived from Africa, newly enslaved |
| "Mulatto" | Person of mixed African and European ancestry |
| "Boy/Girl" (adults) | Man/Woman (with note about infantilizing language) |
| "Property" | Enslaved person (note: legally classified as property) |

---

## Parsing Implementation Notes

### Data Fields to Extract

For each enslaved person, attempt to capture:

```javascript
{
  // Identity
  given_name: string,
  surname: string | null,
  name_type: 'given_only' | 'full' | 'descriptive' | 'unknown',
  aliases: string[],

  // Demographics
  gender: 'Male' | 'Female' | 'Unknown',
  gender_source: 'explicit' | 'inferred_from_name',
  age: number | null,
  age_descriptor: 'child' | 'infant' | 'adult' | 'elderly' | null,
  racial_designation_historical: string,  // As recorded
  racial_designation_modern: string,       // Analytical term

  // Status & Condition
  physical_condition: string | null,  // "healthy", "unsound", etc.
  skills: string[],                   // Occupations, abilities
  role: string | null,                // "driver", "domestic", etc.

  // Relationships
  enslaver_name: string | null,
  family_relationships: [{
    relationship: string,
    person_name: string
  }],

  // Movement & Location
  location: string | null,
  property_name: string | null,
  movement_events: [{
    type: 'transfer' | 'hiring_out' | 'relocation' | 'sale',
    date: string | null,
    from: string | null,
    to: string | null
  }],

  // Resistance & Agency
  resistance_indicators: string[],  // Flags for further analysis

  // Source
  source_page: number,
  source_citation: string,
  raw_text_context: string,
  confidence: number
}
```

### Resistance Indicator Patterns

Flag text containing:
- `runaway`, `fugitive`, `absconded`, `escaped`
- `conspiracy`, `uprising`, `revolt`, `insurrection`
- `punish`, `whip`, `sold for`, `transported`
- `pardon`, `sentence`, `convicted`
- `maroon`, `outlying`
- `refuse`, `resist`, `trouble`

### Family Relationship Patterns

Look for:
- "child of [Name]"
- "mother [Name]"
- "son/daughter of"
- "wife of", "husband of"
- "with her children"
- Groupings by surname or owner

### Skill/Role Patterns

Extract:
- `driver`, `overseer` (coerced authority)
- `blacksmith`, `carpenter`, `cooper` (skilled artisan)
- `cook`, `nurse`, `domestic` (household labor)
- `field hand`, `laborer` (agricultural)
- `seamstress`, `spinner`, `weaver` (textile)

---

## FamilySearch Ravenel Papers: Specific Considerations

**Collection:** Thomas Porcher Ravenel papers - diaries, daybooks, slave lists, 1731-1867
**Location:** South Carolina (Low Country plantations)
**Film:** 008891444 (970 images)

### Document Types Expected

1. **Diaries** - Personal observations, weather, deaths, family events
2. **Daybooks** - Daily accounts, labor records, provisions
3. **Slave lists** - Inventories, valuations, distributions
4. **Correspondence** - Letters about plantation management
5. **Legal documents** - Wills, deeds, contracts

### Names to Watch For (from sample transcript)

From image 117:
- "Quashed" (possibly "Cudjoe" variant - Akan day name)
- "Colton" - enslaved person mentioned re: cotton crop

### Contextual Markers in Ravenel Papers

- **Pine Ville** - Seasonal residence (inland, healthier in summer)
- **Weather records** - Agricultural context, labor conditions
- **Family deaths** - Rene Ravenel (1762-1822), Charlotte I. Ravenel (d. 1827)
- **Crop references** - Cotton damage from frost/storms = labor implications

### OCR Challenges

18th-19th century handwriting presents:
- Inconsistent spelling
- Abbreviations
- Faded ink
- Crossed-out text
- Marginal notes

**Approach:** Use FamilySearch's existing transcripts as baseline, verify against image, enhance with our OCR when transcript is poor.

---

## Citation Standards

### For Extracted Records

```
[Name], enslaved person.
Source: [Archive], [Collection], [Volume/Film], p. [page].
[Document description], [date range].
Archived: [S3 URL]
Extraction confidence: [percentage]
```

### Example

```
Quashed, enslaved person.
Source: FamilySearch, Thomas Porcher Ravenel papers, Film 008891444, image 117.
Daybook entry, c. 1826-1828.
Extraction confidence: 65%
Note: Name possibly variant of "Cudjoe" (Akan day name for Monday-born male)
```

---

## Quality Assurance

### Confidence Scoring

| Score | Meaning |
|-------|---------|
| 90-100% | Clear text, unambiguous parsing |
| 75-89% | Good quality, minor OCR artifacts |
| 60-74% | Readable but with gaps or corrections needed |
| 40-59% | Partial extraction, human verification required |
| <40% | Poor quality, flagged for manual review |

### Human Review Flags

Auto-flag for review when:
- Confidence < 70%
- Resistance indicators detected
- Family relationships found
- Unusual names or roles
- Movement/transfer events
- Violence or punishment references

---

*This framework should be referenced by all parsing functions and integrated into extraction documentation.*
