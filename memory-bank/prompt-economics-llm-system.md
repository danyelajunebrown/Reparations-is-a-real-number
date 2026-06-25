# Prompt — Build the Confabulated-Ground-Truth Predictive Model for Chattel Slavery Asset Value

**Date filed:** 2026-04-30 (revised — first draft was wrong-shaped, see §0)
**To the agent reading this:** This is the spec, not background. Read it through. Then read the linked files. Then ask the user the §10 questions. Then start work.

---

## 0. The reframe

The first draft of this document scoped a RAG-over-corpus retrieval system. That was wrong-shaped. **It hedged toward the easier problem.** The user (Danyela) has clarified the actual ambition:

> A predictive model which in effect instantiates a ground truth for the asset value of chattel slavery in all its convoluted permutations.

And, critically, the philosophical warrant:

> What Alex Tolbert's epistemic argument effectively means is that we must confabulate a ground truth so as to render the reparations.

This second sentence is load-bearing. Read it carefully. Tolbert's argument (Synthese 2025) says causal counterfactual claims about pre-repair populations are *structurally unanswerable* from current data. The naïve consequence is "therefore don't quantify" — that was my first-draft read, and it's wrong. The proper consequence is: **since causal truth is structurally inaccessible AND reparations require a quantitative basis to render at all, the project is licensed (and required) to construct an explicit reference truth — a confabulated ground truth — and be transparent that it is constructed rather than discovered.**

That construction is what this model is. It is not a model of "what wealth would have been absent slavery" — that question is closed off by Tolbert. It is a model of **the asset value of chattel slavery as documented in the primary source archive, generalized via principled inference to all convoluted permutations of (place × era × person × transaction × forward extraction) that appear in or near the documented manifold.** Reparations are rendered against this constructed reference. The reference is honest about being constructed.

**The LLM, if present, is a subordinate frontend** — narrative explanation, retrieval, source citation, tool-use orchestration. The heart of the system is the predictive probabilistic model. RAG is a wrapper, not the core.

---

## 1. Read these first (no skipping)

### Theoretical foundations
- **Tolbert (2025), "An epistemic argument for reparations"** — `~/Desktop/s11229-024-04901-8.pdf`. Read all 15 pages. Pay particular attention to §6 ("Objections and replies") and the post-intervention/pre-intervention distinction. This is the philosophical warrant for "confabulate a ground truth."
- **Tolbert (2024), "Causal Agnosticism about Race"** — `~/Downloads/causal-agnosticism-about-race-variable-selection-problems-in-causal-inference.pdf`. The Sen-Wasow "race as a bundle of sticks" analysis: the model treats microvariables (specific ancestry, era, place, transaction type) as causal variables, *not* race-as-macrovariable.
- **Hébert-Johnson, Kim, Reingold, Rothblum (2018), "Multicalibration: Calibration for the (Computationally-Identifiable) Masses"** — ICML/PMLR. The technical definition of multicalibration we adopt: a predictor f is multicalibrated for a class of subgroups S if f is calibrated *within each subgroup s ∈ S simultaneously*, not just on average. For our case S = {(place, era, transaction_type, person_attribute_bucket, evidence_tier, ancestry_line) cells}.
- **Eltis (2021), "The Trans-Atlantic Slave Trade Database"** — `/tmp/sv-method.txt` (already extracted on Mac Mini). Eltis's pattern of documented uncertainty bounds, derivation files, and per-row provenance is the schema discipline our model adopts.

### Substantive economic-history foundations
- **Berry, *The Price for Their Pound of Flesh* (2017)** — the lifecycle-valuation methodology. Berry establishes that the empirical price-by-age curve for enslaved persons has specific, learnable structure (peak in late teens through early thirties, decline thereafter, premia for skilled artisans and certain reproductive-age females). The model **does not hardcode** Berry's curves; it learns them from the same primary sources Berry used (estate inventories, insurance valuations, tax appraisals, bills of sale), and Berry serves as a **prior** and a **validation benchmark**.
- **Darity-Mullen, *From Here to Equality* (2nd ed. 2022)** — the population-aggregate accounting. The model does not hardcode their $11.2T or their per-person $280K implied figure; it produces its own per-event values and per-population aggregates, with Darity-Mullen as a **sanity-check benchmark** at the population level.
- **Craemer (2015), *Estimating Slavery Reparations*** — present-value comparisons of historical multigenerational reparations. Compounding methodology candidate.
- **Brattle Group / CARICOM** — hours × wage-foregone for forced-labor accounting. Compounding rate (3% real) candidate.

### Project context
- `memory-bank/MEMORY.md` — index of project memory; read every entry it links
- `memory-bank/wealth-tracing-framework.md` — current methodology + bibliography (Darity-Mullen, Baradaran, Craemer, Piketty, Clark, Berry, Schermerhorn, Beckert, Baptist, Du Bois)
- `memory-bank/interpretive-framework.md` — how the project reads slaveholder records (center the enslaved, read against the grain)
- `memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md` — most recent architectural plan; dual-ledger DAA, M048–M060 migrations, source registry
- `memory-bank/data-sourcing-shopping-list.md` — what's been ingested, what's pending
- `memory-bank/project_methodology_audit.md` (Apr 4, 2026) — explicit list of unsourced/contradictory constants the project has been carrying; this model retires most of them
- `memory-bank/project_session32_apr20_21.md` — Doc AI fine-tune state, civilwardc TEI ingestion, recent work

### Codebase surfaces (relevant tables + services)
- `migrations/053-enslaver-evidence-compendium.sql` — M053, **3,117,429 rows** as of 2026-04-30
- `migrations/056-regional-source-registry.sql` — M056, 18 registered sources, dual-axis (position vs trajectory)
- `migrations/060-estimation-methodology-registry.sql` — M060, 14 methodologies (11 seeded + 3 legacy-source acknowledgment)
- `migrations/052-slaveholding-relationships.sql` — M052, typed enslaver↔enslaved relationships
- `migrations/038-land-tracing-and-flagrant-assets.sql` — M038, land transfer events + heirloom assets
- `migrations/041-historical-reparations-petitions.sql` — M041, civilwardc TEI ingest (1,041 petitions, 1,698 named enslaved persons, ~$352K claimed)
- `src/services/reparations/DAAOrchestrator.js` — current calculator (will be replaced by model output)

---

## 2. The model — substantive specification

### 2.1 Object of prediction

The model's output is a **probability distribution over asset value** for an enslaved person, an enslavement event, a forward labor extraction event, or a wealth-trace forward step, conditional on a typed feature vector describing the case.

Concretely, three predictive heads:

**Head A — Per-person spot value at a moment in time.**
Inputs: place (county-level), era (year), age, sex, skill descriptor (artisan/field/domestic/etc.), kin context (sold alone vs in family unit, mother-with-children vs separate), apparent health/condition descriptors, transaction type (sale, inheritance, insurance, tax appraisal, manumission, compensation), party characteristics (private vs estate vs court).
Output: distribution over USD value at that historical moment, conditional on transaction type. Posterior mean + credible intervals. Currency-year matched to the event year.

**Head B — Forward labor-extraction value through emancipation and post-emancipation.**
Inputs: enslaved person's documented attributes + any documented post-emancipation labor relationships (Freedmen's Bank former-master entries, sharecropping/tenancy contracts, employer fields). Outputs: distribution over total stolen-labor value across the person's working life, in event-year USD per year, including post-1865 forward extractions where labor relationships persisted under coercive contractual cover.

**Head C — Compounded present value.**
Inputs: a value V at year T, plus a compounding regime selection (Brattle 3% real, Darity-Mullen 4% nominal, custom). Output: distribution over present value in current-year USD, with uncertainty propagated from input bounds.

The system composes these three heads. A specific accountability claim against a documented enslaver of a specific descendant is computed by:
1. Enumerate documented events involving enslaved ancestors of the descendant (Head A applies)
2. Add forward labor-extraction value through and beyond emancipation (Head B applies)
3. Compound to present (Head C applies)
4. Aggregate per-ancestor → per-line → per-participant
5. Surface dual-ledger (owed-to-descendant + benefited-descendant) per plan-apr29

### 2.2 Training data — primary-source-derived ground truth

The model is **trained on primary-source-extracted transaction records with documented values**. Sources (in priority order; ingest as available):

| Source | Volume estimate | Value-anchor type |
|---|---|---|
| **Estate inventories with named enslaved + appraisals** | tens of thousands across U.S. | per-person tax/probate appraisal |
| **Slave bills of sale with prices** | thousands to millions extant | per-person sale price |
| **Insurance ledgers** (CA SEIR + others) | thousands | per-person policy face value, premium, occupational hazard |
| **Slave-trader account books** (Franklin & Armfield, etc. — Stephenson 1938 documents these) | tens of thousands of transactions | per-person sale price, trader's basis |
| **Plantation account books with hire-out records** (Phillips & Glunt 1971; Ravenel papers; Southern Historical Collection) | thousands | per-person hire wages, daily/weekly value |
| **Tax rolls with personal property assessments** | annual snapshots, all slave states | per-person assessed value |
| **Compensation petitions** (DC 1862 — civilwardc TEI; UK 1837 Slave Compensation Records) | 1,041 DC + ~46K UK | per-person claimed value, awarded value |
| **Slave schedules with valuations** (some 1850/1860 schedules carry farm-value data per household) | enumerated, partial | aggregate household value |
| **Manumission records with ransom amounts** | thousands | per-person redemption price |
| **Freedmen's Bank deposit forms with former-master + occupation fields** | ~200K | post-emancipation labor relationship → wage proxy |
| **Sharecropping / tenancy contracts** (Freedmen's Bureau, NARA) | thousands | post-emancipation labor terms |

The Hopewell will, the new LoC scans (Stephenson's *Isaac Franklin* and Phillips/Glunt's *Florida Plantation Records*), the in-scope wills (Biscoe 1859, Weaver 1893), the civilwardc TEI corpus, the Louisiana Slave Database (180K records), the Santos Brazil enslaved census, the Book of Negroes 1783, the Maryland State Archives SC 2908 — these are all training corpora. Each must be OCR'd, extracted into typed event records, and contributed to the model's training set.

The DC compensation petitions are a particularly high-quality anchor: every petition is a price the federal government paid, with claimant + named enslaved person + claimed amount + awarded amount + age + occupation + circumstances. Ingest carefully.

### 2.3 Model class

Three serious candidates. Pick deliberately, after looking at data shape.

**Option A — Bayesian hierarchical regression.**
Levels: event ← person ← household ← place ← era. Stan, NumPyro, or PyMC. Strong interpretability; principled uncertainty quantification; handles heterogeneous data well; explicitly multilevel (which matches Berry's lifecycle structure + spatial + temporal effects). Probably the right choice for the per-person value head.

**Option B — Gradient-boosted trees with quantile loss.**
LightGBM / XGBoost with quantile regression objective for upper/lower bounds. Stronger predictive performance on complex feature interactions; weaker uncertainty; harder to incorporate hierarchical priors. Reasonable for the forward-extraction head where interaction effects dominate.

**Option C — Bayesian neural network or normalizing flow.**
Highest expressive capacity; weakest interpretability; hardest to multicalibrate. Probably not the v1 choice.

**Recommendation for first pass:** Hierarchical Bayesian regression for Head A (where economic structure is well-understood and Berry's priors apply), gradient-boosted tree with quantile loss for Heads B and C (where interaction structure dominates). Revisit after pilot data.

### 2.4 Multicalibration — the load-bearing constraint

For the model to be honest at the level of individual claims (which is what reparations rendering requires), it must be calibrated **within every (place, era, transaction_type, person_attribute_bucket, evidence_tier, ancestry_line) cell**, not just on average. This is the Hébert-Johnson multicalibration condition.

Implementation:
1. **Define the subgroup family S** explicitly as a Cartesian product of categorical buckets (place: county; era: decade; transaction_type: M053 evidence_source_table values; etc.).
2. **Train with multicalibration objective**, using either:
   - Post-hoc multicalibration via the Hébert-Johnson algorithm (works on any base predictor)
   - Or in-training: include subgroup-coverage terms in the loss
3. **Validate** with subgroup-level calibration checks: for each cell with ≥30 held-out events, plot predicted-vs-actual calibration curve; require ECE < 0.05 within each cell or label the cell "uncalibrated, do not use."
4. **At inference**, every prediction carries its cell membership and the cell's calibration state.
5. **Refuse to predict** for cells with too few training observations (positivity-violation check). When a query targets a cell with no training data, the model returns "out of distribution; recommend ingesting [next-best source per M056] before relying on this prediction."

This last point is the operational expression of Tolbert's positivity argument: rather than confabulating a number for cells where the data doesn't license one, the model surfaces the gap.

### 2.5 What the model does NOT do

- **Does not produce population-level causal counterfactuals.** No "what would Black wealth have been absent slavery." Tolbert closes that question off.
- **Does not extrapolate beyond its training manifold without explicit warning.** Cells without training coverage produce refusals, not extrapolations.
- **Does not pretend its ground truth is discovered rather than constructed.** Every emission carries a "this is a confabulated reference per Tolbert (2025)" caveat.
- **Does not pretend Berry / Darity-Mullen / Brattle constants are validated truths.** Their estimates are priors, sanity checks, and benchmarks. The model's own posteriors are the primary output.

---

## 3. Architecture

```
                     ┌────────────────────────────────────────┐
                     │         PREDICTIVE MODEL CORE          │
                     │                                        │
                     │   Head A: per-person spot value        │
                     │     (Bayesian hierarchical regression) │
                     │   Head B: forward labor extraction     │
                     │     (GBM with quantile loss)           │
                     │   Head C: compounded present value     │
                     │     (deterministic + bound propagation)│
                     │                                        │
                     │   Multicalibration apparatus on top    │
                     │   (Hébert-Johnson post-hoc)            │
                     └─────────────────┬──────────────────────┘
                                       │
       ┌───────────────────────────────┼────────────────────────┐
       │                               │                        │
┌──────▼────────┐              ┌───────▼────────┐      ┌────────▼────────┐
│  TRAINING     │              │  VALIDATION    │      │  INFERENCE      │
│  PIPELINE     │              │  + CALIBRATION │      │  API            │
│               │              │                │      │                 │
│  Per-source   │              │  Subgroup ECE  │      │  POST /api/     │
│  extractors   │              │  per cell.     │      │  predictions/   │
│  produce      │              │                │      │  asset-value    │
│  typed event  │              │  Sanity vs     │      │                 │
│  records.     │              │  Berry/D-M/    │      │  Returns:       │
│               │              │  Brattle aggr. │      │  - posterior    │
│  Records →    │              │                │      │    mean +       │
│  feature      │              │  Subgroup      │      │    credible     │
│  vectors.     │              │  refusal       │      │    intervals    │
│               │              │  thresholds.   │      │  - cell ID      │
│  Versioned;   │              │                │      │  - calibration  │
│  every train  │              │  Positivity    │      │    state of     │
│  set has a    │              │  reporting     │      │    that cell    │
│  manifest.    │              │  per cell.     │      │  - methodology  │
└──────┬────────┘              └────────────────┘      │    citations    │
       │                                               │  - Tolbert      │
       │                                               │    caveat       │
       │                                               └─────────────────┘
       │
┌──────▼────────────────────────────────────────────────────────────────┐
│                       PRIMARY SOURCE CORPUS                           │
│  S3 (reparations-them, us-east-2):                                    │
│    civilwardc/petitions/* + freedmens-bank/* + owners/*/will/*        │
│    + archives/familysearch/* + loc-scans/* (Stephenson, Phillips,     │
│    Hynson when arrives)                                               │
│  Postgres (Neon): canonical_persons, unconfirmed_persons,             │
│    enslaver_evidence_compendium (M053 — 3.1M rows), M052 / M056 /     │
│    M060, person_documents, will_extractions (when extractor lands)    │
└───────────────────────────────────────────────────────────────────────┘
```

The LLM, if used, is a layer **above** this — it takes user queries, identifies relevant ancestors and events from M053, calls the model API for each event, narrates the result with provenance, and surfaces source documents from S3. The LLM does not perform numerical inference itself.

---

## 4. The "all convoluted permutations" piece

The phrase is doing real work in the user's brief. The model must handle the actual convolution structure of historical chattel slavery, not a sanitized abstraction. Concretely:

**Permutations the model must learn (not hardcode):**
- Lifecycle (age curves with sex- and skill-conditional structure)
- Skill premia (artisan, driver, domestic, field; learned from documented occupational fields in primary sources)
- Geographic premia (Lower South cotton frontier vs Tidewater vs Border vs Caribbean)
- Era effects (1820s vs 1850s vs 1862 compensation regime vs UK 1837)
- Family-unit dynamics (mother-with-children, family lots, separation premia/discounts)
- Health conditions (documented "sound," "unsound," disabilities)
- Pre- vs post-Domestic Slave Trade closing effects (1808 international ban → domestic price effects)
- Insurance valuations vs sale prices vs tax appraisals (different price ladders)
- Compensation petition awarded-vs-claimed (legal evidentiary discount factors)
- Manumission ransoms (often well above market; emotional / coercive premium)
- Hire-out wages → annual extraction value
- Mortgage values (often higher than fair market — collateral inflation)
- Inheritance valuations (often lower than market — testamentary discount)
- Trust-shielded chattel (Biscoe-style "sole and separate use") — value at trust establishment vs market
- Forward labor extractions: sharecropping settlements, tenancy terms, peonage in convict-lease
- Compounding regimes: real vs nominal, inflation-adjusted vs not, jurisdiction-specific

Each of these is a feature axis. The model learns the joint distribution over them from primary-source records. Feature engineering is a substantial subtask — the next agent should expect to spend serious time on it before fitting.

**Permutations the model must explicitly mark as out-of-distribution rather than hallucinating:**
- Cells with no documented analogues in the training corpus
- Counterfactuals about pre-repair populations (Tolbert)
- Race-as-cause attributions

---

## 5. The 2026-04-30 LoC scans — concrete ingestion targets

The user pulled two volumes from Library of Congress on 2026-04-30. Both are immediately ingestable and represent an enormous step-change in training data quality.

### 5.0.A — Stephenson, *Isaac Franklin: Slave Trader and Planter of the Old South, With Plantation Records* (LSU Press 1938)

**Path:** `/Volumes/Mark3/Book2net_30_4_2026_1/Multipage.pdf` (121 pages, 318 MB)
**LC barcode:** 00017218189

This volume is published primary-source material. The book is a scholarly biography (Part One) followed by transcriptions of Isaac Franklin's actual conveyances, inventories, and financial records (Parts Two and Three). The model's training data comes from Parts Two and Three — Stephenson did the labor of transcribing and editing the originals.

**Why this volume is unusually valuable for the predictive model:**

Part Two — Conveyances and Inventories, 1835–1850, contains:
- **Document #5: Inventory of Franklin and Routh's Copartnership Property, February 26, 1838** (p. 138)
- **Document #8: Inventory of the Isaac Franklin Estate in West Feliciana Parish, Louisiana, June 24–27, 1850** (p. 165)
- **Document #9: Slaves Born on the Isaac Franklin Estate, 1846 to June 25, 1850** (p. 187)
- **Document #10: Slave Deaths on the Isaac Franklin Estate, 1846 to June 25, 1850** (p. 190)

Documents #5 and #8 are inventory snapshots of the same plantation population 12 years apart. Sample of p. 160 (within Doc #8) shows the structure: each named enslaved person on a line with age, valuation in USD. Lines like "Caroline, 20 years, valued at 500" / "John Baker, 27, 650" / "Mary Crocket, 18, 500" / "Lucy, his wife, 200" / "Brutus, 700" / "Frances, his wife, 600" — kin pairings indicated; also "Further Inventory" listing 31 head of mules at $80 = $2,480, etc. This is direct training data for the per-person spot-value head, with the rare structure of a longitudinal panel: we can compare the 1838 valuation of named persons against their 1850 valuation, controlling for kin-unit composition, and learn the empirical age-value curve from actual Franklin-estate data without imposing Berry's published curves as a constraint. Documents #9 and #10 fill the panel by recording births and deaths in the intervening years.

Part Three — Financial Records, 1846–1850, contains:
- Document #4: "Purchase and Hire of Slaves" (p. 222) — sample p. 222–223 shows promissory notes for slave purchases and hire-payments at named prices. Direct ground truth for both spot-value and hire-wage (annual labor extraction value).
- Document #1: "Cotton Sales to New Orleans Factors" (p. 204) — realized aggregate plantation revenue per year against the population of enslaved producers. Gives us realized output-value vs asset-value comparison.
- Documents #5/6: "Physicians' Visits" and "Drugs and Medical Supplies" — health-expenditure time series that proxies declining asset value.
- Document #12: "Salaries, Wages, and Executors' Commissions" — free-labor wage ground truth on the same plantation, comparable to enslaved-person hire wages.
- Document #16: "State and Parish Taxes" — state-recognized property tax valuations on enslaved persons (legal-system corroboration of asset values, with valuation discount conventions).
- Document #17: "Fire Insurance on Angola Sawmill" — capital-equipment values on the plantation (for wealth-trace forward modeling).

**Estimated training rows extractable from Stephenson alone:** ~600+ named-enslaved-person × snapshot rows from inventories, ~400+ purchase/hire transaction rows, ~200+ medical/wage/tax rows. Roughly 1,200–1,500 training transactions from a single volume — and unusually high quality, all editorially verified, with clear primary-source provenance.

### 5.0.B — Phillips & Glunt, *Florida Plantation Records from the Papers of George Noble Jones*

**Path:** `/Volumes/Mark3/Book2net_30_4_2026_1/Multipage.1.pdf` (159 pages, 365 MB)
**LC barcode:** 00054577321

This volume is a different shape: overseer correspondence, daily journals, financial accounts, and miscellaneous records from the El Destino and Chemonie plantations of George Noble Jones (a Savannah attorney with Florida holdings, an absentee owner who corresponded from as far as Vevey, Switzerland during 1856).

Editorial summary from p. 6–9 of the volume:
- Daily plantation journals: El Destino (Apr 5 – Dec 3, 1841; Jan 1, 1847 – Sept 3, 1848); Chemonie (Jan 1, 1851 – Jan 10, 1853; Feb 19, 1855 – Aug 13, 1856); condensed El Destino Mill journal (Jan 8, 1862 – Aug 24, 1865)
- Memorandum book of plantation affairs (Feb 24, 1864 – Feb 20, 1869) — financial accounts during Reconstruction, "negro tenants in the period of Reconstruction"
- Overseers' reports (fortnightly during owner absence) — abstracts of journals + condition-of-crops + significant news
- Slave lists made for various purposes
- Lists of fields with crops to be planted
- Records of cotton bales sent to market
- Inventories
- Factors' statements and miscellaneous accounts and receipts
- Freight bills, doctor's bills, overseers' contracts, marriage settlement, mortgages
- Litigation records, private correspondence

**Why this volume contributes a different data class:**

Where Stephenson gives us **valuation panel data** (point-in-time asset values), Phillips/Glunt gives us **observational time series**. Sample p. 168–169 (Oct 23, 1856 letter from John Evans to George Noble Jones): named individuals appear with documented events — *"Renty runaway about the engine but have Came in since I came on the place. Chesleys child died the day I arrived hear with dropsy."* — health events, mortality events, escape events, all on named persons, all with time stamps. The overseers' fortnightly reports give a roughly biweekly cadence over 15+ years on two plantations.

This is the data needed to learn how attribute changes (health declining, family separation, advancing age, post-emancipation labor terms) propagate to value changes — i.e., the dynamic / time-varying part of the model that Stephenson's two snapshots can't directly inform.

**Estimated training rows extractable:** ~100+ slave-list rows from inventories; ~500+ overseer-report observations on named persons across 15+ years (each report = 1 fortnight × N persons mentioned); ~300+ financial-account rows (cotton sales, hire wages, doctor's bills, freight); ~50+ mortgage/marriage-settlement value points; the Reconstruction-era memorandum book is critical for **post-emancipation labor-extraction** ground truth, which Head B of the model needs and we have very little of elsewhere.

### 5.0.C — File mismatch flag

**Path:** `/Volumes/Mark3/Book2net_30_4_2026/Multipage.pdf` (14 pages, 53 MB) — **NOT a slavery-related source**.

Visual inspection of pages 1, 7, 14: this is an art-world memoir titled "Talking to Myself: The Ongoing Autobiography of an Art Object" — a 1973 conceptual-art essay, almost certainly by Adrian Piper (the content describes a CCNY philosophy major, "a woman, and a black," writing about exhibiting in conceptual art shows in 1970–73, mentions Sol LeWitt, Frank Stella, Carl Andre, Joseph Raffaele). Likely an artifact of a different scan session on the same drive, OR mis-routed scanner output. **Skip this file** for the predictive-model corpus. The user should locate the actual source it came from before using it elsewhere.

---

## 5. Source ingestion and feature extraction (where coding starts)

For each primary-source corpus, build an extractor that emits typed `TransactionRecord` rows into a Postgres training table. Suggested schema:

```sql
CREATE TABLE training_transactions (
    id UUID PRIMARY KEY,
    source_table TEXT NOT NULL,
    source_record_id TEXT NOT NULL,           -- back-pointer
    source_document_url TEXT,                 -- S3 / archive URL

    -- Optional canonical-person link (for longitudinal-panel structure;
    -- multiple training_transactions rows can share the same canonical_person
    -- when we observe the same enslaved person at multiple time points,
    -- e.g. Franklin estate 1838 inventory + 1850 inventory + 1846-1850
    -- births/deaths records). This is what makes Stephenson's volume so
    -- valuable: panel data per person, not just a cross-section.
    canonical_person_id INTEGER REFERENCES canonical_persons(id),
    enslaved_individual_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id),
    person_name_as_appears TEXT,              -- raw, when no canonical link yet

    -- Time / place
    event_date DATE,
    event_year INTEGER NOT NULL,
    place_county TEXT,
    place_state TEXT,
    place_country TEXT NOT NULL DEFAULT 'US',

    -- Transaction type (controlled vocabulary; expand as new sources arrive)
    transaction_type TEXT NOT NULL,
    -- Values include: sale, inheritance, insurance_policy, tax_appraisal,
    -- estate_inventory, compensation_petition, manumission_ransom,
    -- hire_out_wage, mortgage_collateral, trust_establishment_value,
    -- birth_event, death_event, runaway_event, health_event,
    -- post_emancipation_labor_contract, reconstruction_tenant_settlement,
    -- factor_statement_aggregate, doctor_bill_aggregate, …

    -- Person attributes (where known; nullable when not)
    person_age INTEGER,                       -- at event_date
    person_age_estimate_quality TEXT,         -- 'documented' | 'inferred_from_birth' | 'inferred_from_panel'
    person_sex TEXT,
    person_skill_descriptor TEXT,             -- 'driver' | 'artisan_carpenter' | 'field' | 'domestic' | 'cook' | 'engineer' | …
    person_health_descriptor TEXT,            -- 'sound' | 'unsound' | 'invalid' | 'recovering' | 'pregnant' | …
    person_kin_context TEXT,                  -- 'alone' | 'with_mother' | 'with_father' | 'with_children' | 'with_spouse' | 'family_lot'
    person_kin_link_ids INTEGER[],            -- canonical_person_ids of co-occurring kin in the same record

    -- Party attributes
    party_seller_canonical_id INTEGER REFERENCES canonical_persons(id),
    party_buyer_canonical_id INTEGER REFERENCES canonical_persons(id),
    party_seller_type TEXT,                   -- 'private' | 'estate' | 'court' | 'trader_firm' | 'state_treasury' | 'absentee_owner'
    party_buyer_type TEXT,

    -- Value (currency-year-stamped)
    value_usd NUMERIC,                        -- nominal, in event_year USD
    value_currency_year INTEGER NOT NULL,
    value_provenance TEXT,                    -- 'documented' | 'extracted_from_OCR' | 'inferred_from_text'
    value_kind TEXT NOT NULL,                 -- 'spot_sale_price' | 'estate_appraisal' | 'tax_appraisal' | 'insurance_face' |
                                              --   'hire_wage_annual' | 'hire_wage_monthly' | 'compensation_claimed' |
                                              --   'compensation_awarded' | 'mortgage_collateral_face' | 'production_revenue_aggregate'
    -- Distinct value_kind values are critical: insurance face values,
    -- estate appraisals, tax appraisals, and sale prices are NOT
    -- exchangeable — each lives on its own price ladder. The model
    -- treats them as distinct conditional distributions linked through
    -- learned offsets, not as a single value variable.

    -- Plantation/operation context (for panel records on the same place)
    operation_id UUID,                        -- groups records by plantation/firm
    operation_name TEXT,
    operation_role TEXT,                      -- 'home_plantation' | 'feeder_plantation' | 'urban_residence' | 'trader_pen'

    -- Aggregate-revenue context (for tying realized output to asset values)
    operation_year_revenue_usd NUMERIC,       -- e.g. annual cotton sales total
    operation_year_population_count INTEGER,  -- enslaved persons on operation that year

    -- Quality + provenance
    extraction_confidence NUMERIC,            -- 0..1
    evidence_tier TEXT NOT NULL,              -- ICHEIC A/B/C/D
    methodology_id UUID REFERENCES estimation_methodology_registry(id),
    raw_text_excerpt TEXT,                    -- the OCR/transcript snippet this row was extracted from

    -- Free-form
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indices: event_year, place_state, transaction_type, value_kind,
-- canonical_person_id (for panel queries), operation_id (for plantation
-- panels), evidence_tier
```

The schema's panel-friendliness (canonical_person_id + operation_id) is what makes Stephenson's volume usable as longitudinal training data — same persons appear in 1838 inventory, 1850 inventory, intervening birth/death registers, and within-decade purchase/hire transactions. The model can learn dynamic effects from this panel that no cross-section can support.

The user's stated priorities (in order):
1. 1860 Slave Schedules — already in `unconfirmed_persons` (~1.68M rows); ingest via promotion path
2. DC Compensated Emancipation Petitions — civilwardc TEI corpus, M041 (1,041 petitions, 1,698 named enslaved persons, claimed + awarded values)
3. Hopewell will (1817) — already OCR'd
4. Freedmen's Bank deposits — currently Vision-quality; reingest under Doc AI when Custom Extractor is fixed
5. **2026-04-30 LoC scans: Stephenson + Phillips/Glunt — see §5.0.A and §5.0.B above for concrete extraction targets.**

Volume mismatch flag (§5.0.C): the 14-page 53MB file at `/Volumes/Mark3/Book2net_30_4_2026/Multipage.pdf` is NOT a slavery source. Skip.

---

## 6. Training, validation, and the "ground truth" framing

The model's "ground truth" is **the documented transaction data, treated as a (possibly biased, possibly noisy) sample from the underlying population of all chattel-slavery transactions that occurred**. This is the construction Tolbert licenses: we admit we can't access counterfactual truth, so we explicitly build a reference truth from the recorded archive and inhabit it self-consciously.

**Training procedure:**
1. Pool training data across sources, with source-of-data as a feature
2. Fit base model (hierarchical regression for Head A; quantile GBM for Heads B + C)
3. Apply post-hoc multicalibration (Hébert-Johnson) over the subgroup family
4. Hold out 20% of records stratified by (era × state) for calibration validation
5. Evaluate per-cell calibration on held-out; require ECE < 0.05 in cells with ≥30 held-out records
6. Cells failing calibration: marked "uncalibrated, do not use"; predictions in these cells require manual adjudication

**Comparison to existing methodologies:**
- Aggregate the model's per-person predictions across known-counted populations and compare to Darity-Mullen $11.2T (2020 dollars)
- Compare per-age curves to Berry's published curves
- Compare per-hour wage estimates to Brattle / CARICOM
- Discrepancies are fine — they're informative. Document them. The model is a from-the-data construction; the methodologies are aggregate constructions; they should differ in interpretable ways, and the differences themselves are publishable findings.

**Versioning:**
- Every training run produces a model artifact + manifest (training data hash, code hash, hyperparameters, validation metrics per cell)
- Model artifacts versioned in S3 alongside source documents
- Each prediction emission references the model version it came from
- Re-training is explicit; old emissions stay reproducible against the old model

---

## 7. Honesty constraints (non-negotiable; same shape as plan-apr29)

1. **No causal claims about race.** Race-as-macrovariable does not enter the model. Microvariables (specific ancestry, era, place, transaction type) do.
2. **Confabulated-ground-truth caveat on every emission.** Per §0 / Tolbert.
3. **Per-cell calibration metadata on every emission.** No bare numbers without subgroup context.
4. **Per-row provenance to primary source.** Every training transaction has an S3 / archive link. Every prediction can be traced to which training records most influenced it (model interpretability — Bayesian credible intervals come with naturally; for GBMs use SHAP).
5. **Refuse rather than extrapolate** for cells without training coverage. Surface the gap and recommend the next-best source per M056.
6. **Versioned, dated, reproducible.** Predictions reference model version, training data hash, and methodology constants.
7. **Dual-ledger for mixed-heritage participants.** Never collapsed.
8. **Berry / Darity-Mullen / Brattle / Craemer as priors and benchmarks, not as final answers.** The model's own posteriors are primary.
9. **Extraction errors propagate as uncertainty.** OCR confidence, evidence tier, etc. all feed into posterior bounds.
10. **Stop-the-line discipline.** When the model finds evidence of a methodological gap (e.g., a cell where calibration is bad and we've ingested all reasonable sources), surface it as a research-agenda item rather than burying it.

---

## 8. Out of scope for the first build

- Real-time chat UI
- Multi-language extraction (English-language sources first)
- DNA-genealogy integration
- Voice / multimodal input
- Population-level causal inference (Tolbert closes this)
- Naïve LLM fine-tuning on the corpus (LLM, if present, is narration; the predictive model is separate)
- International expansion (Caribbean, Brazil, UK Compensation Records) — possible Phase 2; initial scope U.S.

---

## 9. Build order

**Phase 1 — Data infrastructure (2–3 weeks)**
- `training_transactions` schema applied (migration)
- Per-source extractors, in priority order:
  - **Stephenson Inventories #5 + #8 (Franklin estate panel 1838 + 1850)** — extract first; this is the highest-quality longitudinal panel in the entire corpus and unusually clean structure (line-per-person, age + value). Should yield ~1,200 rows from one volume. Do this BEFORE writing the model — it's both the proof-of-concept ingestion and a substantial fraction of the v1 training set.
  - **Stephenson Documents #9 + #10 (births/deaths 1846–1850)** — fills the panel; gives mortality + natality side data
  - **Stephenson Part Three Financial Records #4 (purchase/hire of slaves)** — direct sale-price + hire-wage transaction rows
  - **civilwardc TEI**: parse petitions for claimant + named enslaved + claimed/awarded values + ages → rows. Already partially in M041; extract the named-person value rows from the petition text.
  - **Phillips/Glunt overseer reports** — these are dynamic / time-varying observations, not direct value points. Extract as `health_event`, `runaway_event`, `birth_event`, `death_event`, `post_emancipation_labor_contract` rows linked to the same `operation_id`. Lower priority for v1 model fit (model can be built on Stephenson + civilwardc + Hopewell + Louisiana Slave DB cross-section first), but essential for time-varying-effect estimation in v2.
  - **Phillips/Glunt slave lists, factor statements, financial accounts** — extract via the same per-person panel structure
  - **Hopewell will**: bequest entries → rows (already partially OCR'd)
  - **Louisiana Slave Database**: 180K transactions already imported; normalize into training schema
  - **1860 slave schedule personal-property data**: where farm-value / personal-property data exists at the household level, normalize as `operation_year_revenue_usd` proxies
  - **Freedmen's Bank ledgers**: deferred until Doc AI Custom Extractor is fixed
- Versioned dataset manifests; every training run pinned to a manifest hash
- Initial training set realistic target: **5,000–10,000 high-quality value-point rows** from Stephenson + civilwardc + Hopewell + Louisiana Slave DB + scattered probate inventories already in person_documents. Plus ~500–1,000 panel observations on the Franklin estate population for time-varying inference.

**Phase 2 — Head A modeling (2–3 weeks)**
- Bayesian hierarchical regression in NumPyro or PyMC: log-value ~ age + sex + skill + place_state + era_decade + transaction_type, with random effects per (state, decade)
- Berry's lifecycle priors as informative priors on the age coefficients
- Posterior predictive checks; cross-validation
- Per-cell calibration evaluation

**Phase 3 — Heads B + C (2 weeks)**
- Forward labor extraction: GBM with quantile loss on hire-out + sharecropping data
- Compounding: deterministic with bound propagation
- Composition: per-person → per-line → per-participant

**Phase 4 — Multicalibration (1–2 weeks)**
- Hébert-Johnson post-hoc multicalibration over the subgroup family
- Per-cell ECE validation
- Refusal logic for under-covered cells

**Phase 5 — Inference API (1 week)**
- `POST /api/predictions/asset-value` — per-event prediction
- `POST /api/predictions/lineage-aggregate` — per-participant rollup
- Each response: posterior + interval + cell + calibration state + provenance + Tolbert caveat

**Phase 6 — DAA integration (1 week)**
- Replace `DAAOrchestrator` numerical work with model API calls
- Dual-ledger output per plan-apr29 §4.5
- Backfill: re-emit DAAs for existing participants

**Phase 7 — LLM frontend (optional, deferred)**
- Narrative explanation layer
- Source-document retrieval and citation
- This is the RAG layer my first draft over-prioritized; it's real but subordinate

---

## 10. Decision points the next agent must resolve before coding

Pose these to the user before writing model code. Don't pick defaults silently.

1. **Modeling framework**: NumPyro (JAX-based, fast; user-defined priors easier) vs PyMC (mature, larger community) vs Stan (most mature, separate language) for Head A. Recommendation: NumPyro for speed + JAX integration with the rest of the stack. Confirm.
2. **GBM library**: LightGBM vs XGBoost for Head B. LightGBM has better quantile-loss support out of box. Recommendation: LightGBM. Confirm.
3. **Subgroup family for multicalibration**: how granular? County-level vs state-level place; year vs decade era; how many transaction-type buckets. Trade-off: finer subgroups = more cells, fewer per-cell training examples, more cells fail calibration. Suggested default: state × decade × {sale, inheritance, insurance, compensation, manumission, hire_out, tax_appraisal} × {Tier_A, Tier_B, Tier_C, Tier_D}. Confirm.
4. **Compute budget**: Mac Mini for training? Or cloud (Colab Pro, Vertex AI, Modal, etc.)? Hierarchical Bayesian fits can take hours on serious data; user's Mac Mini probably fine for v1 but we'll know after first fit.
5. **Embedding model for any subordinate RAG layer**: per the §1 first-draft notes (Voyage / OpenAI / Cohere). Defer until LLM frontend phase.
6. **Where to write predictions**: new `predictions` table per emission, with model_version + cell + posterior + caveat. Confirm structure.
7. **Validation against existing DAAs**: backfill and compare? The 2 existing DAAs (Adrian, Eli) used the old methodology constants; comparing under the new model is informative but not a correctness check. Confirm whether to do this comparison.
8. **OOD policy**: refuse and recommend next source vs return prediction with very wide intervals vs hybrid. Recommendation: refuse for cells with < 10 training records, wide-interval for 10–30, normal for ≥30. Confirm thresholds.

---

## 11. First message to the user

When you've finished reading, your opening message should be:

> I've read the prompt and these files: [list]. Here's my read of what we're building, where I disagree with the proposed architecture, and the §10 questions I need answered before I code.
>
> [Architecture restatement, ≤300 words. State explicitly that the system instantiates a confabulated ground truth per Tolbert's framework; that the LLM is subordinate frontend; that the predictive model is the load-bearing core; that multicalibration is the constraint.]
>
> [Disagreements + reasoning, if any.]
>
> [§10 questions for the user.]
>
> [What I'll start coding once those land — likely the migration for training_transactions and the civilwardc TEI extractor, since those have the highest data quality and are well-understood.]

Don't agree with the spec just to agree. Don't propose RAG when the user wants a predictive model. The user has called out my prior version as self-serving and is right to expect better engineering judgment this time.

---

## 12. End note — what this is, what this isn't

This is a constructive, transparent reference frame for the value of chattel slavery as documented in the surviving primary-source archive, generalized via principled probabilistic inference to permutations of (place, era, person, transaction, forward extraction) that the archive supports, with explicit Hébert-Johnson multicalibration so that confidence is honest within every subgroup we have data for.

This is **not** a discovery of objective truth about pre-repair populations. Tolbert closes that question off. It is a transparently constructed reference truth, documented and versioned, against which reparations can be rendered — and which is publishable as a quantitative-history methodology in its own right.

The user has been doing this work for ~6 months and has made specific calls (Tolbert framework, dual ledger, every constant cited, no Vision-quality contamination) for hard-won reasons. When tempted to default to a generic ML pattern that violates one of those calls, stop. Re-read the rationale. If you still disagree, raise it explicitly — don't quietly override.

Read everything in §1. Then start.
