# Tracing Antebellum Wealth Forward: A Lineage-Specific, Land-Primary Methodology

**Status:** Draft v0.1 — Apr 18, 2026
**Authors:** Danyela June Brown; methodology scaffolded by project assistant
**Intended audience:** Project collaborators (internal) → scholarly peer review (eventual)
**Companion files:** `migrations/038-land-tracing-and-flagrant-assets.sql`, `memory/project_wealth_tracing_pivot.md`

---

## Abstract

Existing reparations wealth estimates aggregate across cohorts (Darity and Mullen 2020; Baradaran 2017), producing defensible top-line totals but leaving the question of *who now holds what* unanswered at the level of specific lineages. This document specifies a methodology for closing that gap, built around three claims: (1) the archive of enslaver-side property-holding is substantially intact, contrary to common assumption; (2) U.S. wealth has never been randomly redistributed across generations, so concentration from the antebellum tier persists into present holdings along traceable paths; (3) land, not corporate equity, is the most durable and best-documented category through which that persistence can be proven. The methodology pairs a top-holder reference layer with lineage-specific chain-of-title traces, and treats other heirloom assets (named trusts, stock certificates, art, jewelry, bearer notes) as supplementary documentary traces when they appear. A pilot application traces five slave-owning ancestors identified in the participant's own lineage through DC Recorder of Deeds, probate, and guardianship records.

---

## 1. Problem statement

Quantitative reparations estimates in the U.S. scholarly literature (Darity and Mullen 2020; Craemer 2015; Marketti 1990) operate at the aggregate level. They compute defensible totals — typically in the range of $10–$20 trillion for the Black-white wealth gap or for unpaid wages of enslaved labor — but do so by population-level arithmetic: enslaved person-hours × wage rates × compounding, or post-emancipation Black wealth shortfall × descendant population. These methods are robust to critique of individual cases but produce no answer to the question that any concrete reparations claim must eventually face: *who specifically owes whom, and what specific assets underwrite that debt today?*

The implicit assumption that has governed most empirical work on this question — including, until this revision, the default stance of this project's calculator layer — is that specific-asset tracing over 160+ years is infeasible because records are too sparse or too fragmentary. That assumption is demonstrably wrong, for two reasons.

**First**, the archival state of enslaver-side property records is substantially better than the archival state of enslaved-side records. County Recorder of Deeds offices in every U.S. state have maintained continuous grantor-grantee indexes since the colonial or early-statehood period; state archives preserve probate court records, equity court records, administration bonds, and guardianship accounts across the same arc. Federal land-patent records (Bureau of Land Management 2024; National Archives Record Group 49) cover the public domain. What is spotty in the wealth archive is not the documentation of white property holdings — it is the documentation of Black persons as anything other than chattel inventory items. Treating the enslaver's side as unknowable inverts the actual archival landscape.

**Second**, the concentration of wealth across U.S. history, far from randomizing across generations, shows high autocorrelation at the level of surname lineages. Clark (2014) demonstrates that elite surnames in England and the U.S. persist in top wealth quantiles across 8–10 generations — far longer than any individual's working life. Piketty (2014) offers the structural reason: when the return on capital exceeds the growth rate of the economy (r > g), inherited wealth compounds faster than earned wealth, and concentration intensifies rather than dissipating. This holds mechanically for land, where total supply is approximately fixed; it holds less reliably for corporate equity, which can be inflated, diluted, or destroyed.

The practical implication is that specific-lineage tracing is not only feasible; it is the only method that can close the gap between statistical wealth-gap estimates and concrete accountability claims. This document specifies how.

---

## 2. Thesis

Three claims structure the methodology:

**Claim 1 (Archival intactness):** The pre-1865 property archive of the U.S. enslaver class is, in aggregate, well-preserved. Inheritance transfers (wills, probate, administration), arms-length sales (deeds), and state actions (land patents, tax sales, eminent domain) were recorded contemporaneously in local and state court systems with continuity into the present. Gaps are real but localized — courthouse fires (e.g., the 1865 burning of Richmond, 1881 Fairfax fire) destroyed specific jurisdictions' records, and colonial-era records are sparser — but these gaps are known and bounded.

**Claim 2 (Concentration persistence):** U.S. wealth inequality does not redistribute across generations through neutral mechanisms. Intermarriage within propertied tiers, primogeniture survivals (retained informally in many Southern states through the mid-twentieth century), corporate consolidation through merger-and-acquisition cycles, and legally-entrenched racial exclusion from capital markets (redlining, FHA lending rules, restrictive covenants, GI Bill racial implementation) all operate to concentrate intergenerational wealth in a small set of family lineages. Baradaran (2017), Rothstein (2017), and Desmond (2019) document the mid-twentieth-century mechanisms; the continuity with pre-1865 concentration is visible in lineage-level surname persistence studies (Clark 2014).

**Claim 3 (Land as primary trace):** Among documented wealth categories, land is the most reliably traceable across the 160+-year span from the antebellum period to the present. The reasons are structural. (a) Total U.S. arable acreage is approximately fixed; parcels have been continuously subdivided and re-aggregated but not created ex nihilo except in narrow cases (federal land patents 1803–1912, Hawaii annexation, Alaska purchase). (b) Transfer documentation has been legally mandatory at the county level since the colonial era; recording is a prerequisite for legal title defense. (c) Parcels stay in families for longer periods than business equity because land does not experience the same market churn — IPOs, acquisitions, bankruptcies — that destroys corporate lineages. (d) Modern county GIS systems and assessor databases provide present-day parcel IDs that can be back-linked to historical deed records through metes-and-bounds or plat descriptions.

Other heirloom asset categories — named inter vivos trusts, individual stock certificates with traceable bearer chains, identifiable art and jewelry in probate inventories, family silver, bearer instruments, life insurance policies — are in scope as supplementary traces. They cannot serve as primary threads because their documentation is weaker and less continuous, but they corroborate land-based traces and occasionally substitute for them when courthouse records fail.

---

## 3. Literature review (working bibliography)

This section will expand with each revision. Initial core references:

**Reparations economics and methodology:**
- Darity Jr., William A., and A. Kirsten Mullen. *From Here to Equality: Reparations for Black Americans in the Twenty-First Century.* Chapel Hill: UNC Press, 2020.
- Baradaran, Mehrsa. *The Color of Money: Black Banks and the Racial Wealth Gap.* Cambridge: Harvard University Press, 2017.
- Craemer, Thomas. "Estimating Slavery Reparations: Present Value Comparisons of Historical Multigenerational Reparations Policies." *Social Science Quarterly* 96, no. 2 (2015): 639–55.

**Slave economy and capital formation:**
- Baptist, Edward E. *The Half Has Never Been Told: Slavery and the Making of American Capitalism.* New York: Basic Books, 2014.
- Beckert, Sven. *Empire of Cotton: A Global History.* New York: Knopf, 2014.
- Johnson, Walter. *River of Dark Dreams: Slavery and Empire in the Cotton Kingdom.* Cambridge: Belknap/Harvard, 2013.
- Johnson, Walter. *Soul by Soul: Life Inside the Antebellum Slave Market.* Cambridge: Harvard University Press, 1999.
- Rothman, Joshua D. *Flush Times and Fever Dreams: A Story of Capitalism and Slavery in the Age of Jackson.* Athens: University of Georgia Press, 2012.

**Landholding and rural property:**
- Gates, Paul W. *The Farmer's Age: Agriculture, 1815–1860.* New York: Harper, 1960.
- Roark, James L. *Masters Without Slaves: Southern Planters in the Civil War and Reconstruction.* New York: Norton, 1977.
- Oubre, Claude F. *Forty Acres and a Mule: The Freedmen's Bureau and Black Land Ownership.* Baton Rouge: LSU Press, 1978.

**Wealth persistence and inheritance:**
- Piketty, Thomas. *Capital in the Twenty-First Century*, translated by Arthur Goldhammer. Cambridge: Belknap/Harvard, 2014.
- Clark, Gregory. *The Son Also Rises: Surnames and the History of Social Mobility.* Princeton: Princeton University Press, 2014.

**Twentieth-century racial wealth gap mechanisms:**
- Rothstein, Richard. *The Color of Law: A Forgotten History of How Our Government Segregated America.* New York: Liveright, 2017.
- Desmond, Matthew. "In Order to Understand the Brutality of American Capitalism, You Have to Start on the Plantation." *The 1619 Project,* *The New York Times Magazine,* August 14, 2019.

**Foundational / classical:**
- Du Bois, W. E. B. *Black Reconstruction in America, 1860–1880.* New York: Harcourt, Brace, 1935.
- Berlin, Ira. *Many Thousands Gone: The First Two Centuries of Slavery in North America.* Cambridge: Belknap/Harvard, 1998.

**Methodological standards (for archive work):**
- Board for Certification of Genealogists. *Genealogy Standards.* 2nd ed. Nashville: Ancestry.com, 2019.
- Society of American Archivists. *Describing Archives: A Content Standard (DACS).* 2nd ed. Chicago: SAA, 2013.

---

## 4. Methodology: two pillars

### 4.1 Pillar 1 — Top-tier landholder reference layer

The first pillar seeds the database with a reference set of known top-tier historical landholders. Two concentric tiers:

**Top 1% tier.** Individuals in the top percentile of landholders in a given (year, state) context, sourced from the 1860 Agricultural Census aggregated tables, 1870 Agricultural Census tables, state-specific tax roll digitizations, and published scholarship (Gates 1960 provides state-level distributional analyses; Roark 1977 covers major planter families by region). Expected initial seed: approximately 200 persons per Southern state, lower counts for border and Northern states where large-scale slaveholding landowners were fewer but still existed (e.g., Hudson Valley manor families, Maryland Eastern Shore planters).

**Any-scale slaveholder tier.** Every individual appearing in any U.S. slave schedule at any scale (1 enslaved person through 1,000+). This layer is already partially operational in the project through the existing `canonical_persons` table and the `enslaved_by` family relationships. Approximately 393,000 slaveholders in 1860 (per the 1860 Census aggregate counts); the project has currently indexed roughly 123,000 (memory-bank project stats) with ongoing ingestion bringing the remainder.

These tiers are **weighting signals**, not exclusionary filters. Ancestor climbs surface high-priority traces when a lineage intersects either tier, but all touched-slavery lineages are processed.

### 4.2 Pillar 2 — Lineage-specific chain of title

For each identified enslaver ancestor of a participant, reconstruct the documentary chain from their property holdings forward to present-day holders. The canonical trace sequence:

1. **Identify holdings at death.** Primary source: probate court inventory and appraisal records, which enumerate real property and significant chattels at the moment of transfer. Secondary: will text (if testate), administrator's deed and account filings (if intestate).
2. **Enumerate heirs.** Primary: will text or administrator's division. Secondary: state intestacy statutes of the relevant year (these vary materially across jurisdictions and were often amended mid-nineteenth-century).
3. **Trace transfers from heirs forward.** Primary: Recorder of Deeds grantor-grantee index, searched by each heir's name across the years following the decedent's death. Each matching deed contributes a `land_transfer_events` row. Multiple transfers per parcel are common — a plantation tract typically passes through 3–8 hands between 1860 and present, through inheritance, subdivision, sale, and occasional foreclosure or tax sale.
4. **Project to present-day parcels.** The terminal transfer in the chain (the most recent deed) identifies the current owner of record, linkable to the county assessor's parcel database for modern location, assessed value, and present use.
5. **Validate.** Where the chain is ambiguous, cross-reference with: federal census schedules (each decennial census enumerates household real and personal property), tax rolls (annual), newspaper accounts of property sales (where digitized), and plat-book subdivision records. Confidence on each transfer is scored against the corroboration available.

The full chain is preserved in `land_transfer_events`, keyed to `properties.property_id` (migration 007) for the historical parcel identity and resolved to modern parcel via `modern_parcel_links` (migration 038). Every transfer row carries provenance fields (source document URL, archive name, page citation) sufficient for an academic reader or a court to locate the underlying document.

### 4.3 Supplementary traces: flagrant heirloom assets

Where probate inventories, estate auction catalogs, or litigation records document other heirloom assets with continuous provenance, they are recorded in the `flagrant_heirloom_assets` table (migration 038). These are not primary threads because their continuity is weaker; they serve as:

- **Corroboration** for a land trace that is otherwise documentation-thin.
- **Substitution** when land records fail (courthouse fires, colonial-era sparsity, urban renewal erasures).
- **Independent evidence** for wealth categories where the holding is in the asset itself rather than land — e.g., named inter vivos trusts, individual stock certificates identifiable by serial number and bearer chain, documented art provenance.

Categories tracked: named trusts; individual stock certificates; identifiable art and jewelry; family silver; heirloom instruments; manuscripts including plantation journals and slave bills of sale (as collectibles held by descendants); bearer notes; life insurance policies with documented beneficiary chains.

---

## 5. Data model

The data model is implemented in `migrations/038-land-tracing-and-flagrant-assets.sql` (see that file for field-level definitions) as an additive extension to the existing property model of `migrations/007-comprehensive-historical-data-model.sql`. Four new tables:

| Table | Purpose |
|---|---|
| `land_transfer_events` | Each documented grantor→grantee transfer for a parcel; chain of title |
| `modern_parcel_links` | Historical property → modern county-assessor parcel IDs |
| `top_landholder_flags` | Top-1% reference tier per (person, year, region) |
| `flagrant_heirloom_assets` | Non-land heirloom assets with continuous provenance |

Design principles:
- **Additive only.** No alterations to existing tables. Existing `properties` rows remain the canonical point-in-time holding record.
- **Canonical identity.** Person references go through `canonical_persons(person_id)` (UUID). Legacy `individuals(individual_id)` references are only used for backward compatibility where they already exist.
- **Provenance required.** Every row includes source document URL, archive name, and page citation, plus a confidence decimal in [0,1].
- **Review queue integration.** Every row includes `verification_status` and `requires_human_review`, matching the pattern established by `migrations/034-match-verification.sql` so the same human-review infrastructure applies.

A convenience view `enslaver_material_footprint` summarizes per-enslaver counts of transfer events, heirloom assets, and top-holder flags for fast DAAOrchestrator consumption.

---

## 6. Source priorities

Sources are sequenced by the amount of information each yields per unit of acquisition effort.

**Tier A (highest priority — local to the decedent):**
1. Probate court inventories and wills — enumerate all holdings at a moment of transfer
2. Recorder of Deeds grantor-grantee index — the authoritative transfer record
3. Administration bonds and guardian accountings — capture intermediate transfers especially for minor heirs
4. 1860 and 1870 U.S. Agricultural Census household schedules — acreage and farm value per person
5. Slave schedules 1850 and 1860 — establish enslaver status and scale

**Tier B (systemic / cross-reference):**
6. State tax rolls — annual snapshots of who held what valued at what
7. County GIS / modern assessor databases — establish modern parcel identity
8. Plat-book subdivision records — track partitioning of historical tracts
9. Federal land-patent records (BLM GLO database) — original grants from the public domain
10. Compensated emancipation petitions (DC 1862, UK 1837, etc.) — rare but definitive enslaver-asset declarations

**Tier C (corroborative):**
11. Chronicling America and other digitized newspaper archives — property sale notices, estate auctions, sheriffs' sales
12. Plantation account books and ledgers (Southern Historical Collection, Duke Rubenstein, Georgia Historical Society) — internal operations records
13. State historical society manuscript collections — family papers containing inter vivos transfers not reflected in public records
14. Litigation records — suits between heirs often produce the most detailed inventories

**DC-specific (for the pilot):**
- DC Recorder of Deeds (ongoing, digitized 1921–present; pre-1921 requires physical visit)
- National Archives Record Group 21, U.S. District Court for the District of Columbia — probate, equity, and administration records 1801–present
- Historical Society of Washington, DC (Washingtoniana Collection)
- DC Compensated Emancipation petition files (migration 011 already contemplates this, though the underlying table was never created in the production DB — see project memory)

---

## 7. Validation

The methodology is subject to several failure modes. Each must be tested and reported with its prevalence.

**Misidentification of parties.** Same-name confusions are the most common error. Mitigations: (a) require at least two corroborating identifiers (birth year, spouse name, county of residence, enslavement scale) before linking a transfer-record party to a `canonical_persons` row; (b) flag any link with only one corroborating identifier as `requires_human_review`; (c) report aggregate confusion rates against a held-out sample of hand-verified lineages.

**Transfer gaps.** If one step in a chain is missing, the whole chain is suspect. Mitigations: (a) record the gap explicitly in `land_transfer_events.source_notes` rather than bridging over it; (b) report aggregate gap density per chain; (c) never output a modern-parcel link from a gap-containing chain without flagging the confidence penalty.

**Modern-parcel mis-mapping.** Historical tracts were subdivided and consolidated. A metes-and-bounds description from 1850 maps to a modern parcel through plat overlay work that has its own error. Mitigations: (a) record `cardinality` (1-to-1, 1-to-many, many-to-1) explicitly; (b) report confidence per link based on trace method (continuous title > plat overlay > adjacency inference > attestation); (c) never merge subdivided tracts into a single modern descendant claim.

**Selection bias in the top-holder seed.** Published scholarship is uneven across states and periods. Northern and border-state top holders are under-represented in the historiography relative to Deep South planters. Mitigation: report seed coverage per state and year, and document known gaps explicitly.

**Aggregation error propagation.** When a chain-of-title trace succeeds for one parcel but fails for the other three parcels in a decedent's estate, the DAA calculator must not substitute the aggregate-statistical estimate for just the untraced parcels — that would double-count. Mitigations: calculator integration must explicitly reconcile specific-trace and aggregate-estimate contributions per lineage.

---

## 8. Explicit limits

This methodology does not claim:

- That every dollar of wealth gap is individually traceable. Most is not. Specific-asset traces cover the fraction of wealth that persisted as identifiable assets; aggregate-statistical estimates retain their role for the larger untraced remainder.
- That modern holders of historically-implicated parcels are morally equivalent to enslavers. The chain of title documents what it documents; interpretation is a separate layer.
- That this approach substitutes for political or legal remedies. Documentation is a necessary but not sufficient condition for any reparations program.
- That the four-continent scope of the transatlantic slave trade (Africa, Europe, Americas, Caribbean) is treated symmetrically here. The pilot is U.S.-focused. The data model (migration 038) does not encode assumptions that would prevent international extension, and `top_landholder_flags.region_type` includes `'caribbean_colony'` and `'country'` options for that reason.
- That OCR and extraction errors in source documents are negligible. The project's Freedmen's Bank parser, for example, extracts handwritten values with known error rates requiring human review (see `project_freedmens_bank_history.md` and MatchVerifier pipeline).

---

## 9. Pilot: Five DC slave-owning ancestors

In April 2026 the participant (project author Danyela June Brown) requested wills/probate records, Recorder of Deeds land transactions, administration cases, and guardianship/administrative bonds for five of her ancestors who died in the District of Columbia and owned enslaved persons. These five cases are the methodological pilot.

For each of the five, the protocol is:

1. Ingest the requested records as they arrive. Extract through the existing OCR + MatchVerifier pipeline (adapted for probate-court document structure).
2. Populate `properties` (migration 007) with each enumerated holding from the probate inventory.
3. Populate `land_transfer_events` with the initial transfers documented in the will or administration.
4. Manual trace forward: for each heir named in the will, query the DC Recorder of Deeds grantor-grantee index across the years following the decedent's death. Each matching deed becomes a `land_transfer_events` row.
5. Continue the trace until each parcel is resolved to a modern parcel ID or determined to be un-resolvable (courthouse gap, records destroyed, chain lost).
6. Document the full trace as a case study, including confidence annotations and explicit gap acknowledgment.
7. Cross-compare the five traces to identify common patterns (how often does antebellum land persist in family hands to 2026?) and to surface the parcel-level contribution to the aggregate wealth gap in this lineage.

The pilot's deliverable is a case study — internal first, submittable to peer review as a methodological validation paper — demonstrating the trace is feasible, documenting its failure modes empirically, and producing concrete parcel-level findings for five specific lineages.

---

## 10. Roadmap

**Phase 0 (tonight, Apr 18–19 2026):** Framework doc draft (this file), schema migration draft (038), project memory capture. Freedmen's Bank parser verified across all 28 branches and ready for full collection run (see companion parser verification sweep).

**Phase 1 (Apr 19–30):** Schema migration applied after review. Top-holder reference seed begun — initial target 200 persons per Southern state, sourced from Gates (1960), Roark (1977), and 1860 Agricultural Census aggregates. Freedmen's Bank parser full run across 28 branches, estimated 28 × 400 images × ~$0.0015 Vision = $17. Participant DC document requests returned and ingested.

**Phase 2 (May):** Pilot trace — run the five DC lineages end-to-end. Document failure modes empirically. Refine MatchVerifier to handle probate-document structure.

**Phase 3 (June):** Extend top-holder reference to Northern and border states. Begin systematic Recorder-of-Deeds digitization workflows for counties where digital indexes exist (Cook County IL, Fulton County GA, Fairfax County VA, and so on — prioritize counties with high enslaver-ancestor density per the participant population).

**Phase 4 (July+):** DAAOrchestrator integration — calculator prefers specific-trace contributions over aggregate-statistical estimates when available, without double-counting.

**Publication target:** submit methodology paper to *Journal of Economic History* or *Social Science Quarterly* by Q4 2026, referencing the DC pilot case study as the validation instance.

---

## Appendix A: Open methodological questions (flagged for future revision)

1. How should the framework handle jurisdictions where colonial-era records are entirely destroyed (several Virginia counties in 1865)? Partial reconstruction from state-level tax lists and probated parties' later-state records may be feasible but needs protocol.
2. How should intangible inherited advantage (legacy college admissions, business network access, social capital) be modeled? Currently out of scope; the limits section acknowledges it.
3. For enslavers who died intestate and left multiple undocumented heirs, what confidence penalty is appropriate vs. testate cases? Calibration needs pilot data.
4. Restitution to whom, specifically? The framework documents who holds what; it does not specify the distribution mechanism to descendants. That question belongs to a separate policy document.

---

*This is a working document. It will be revised as pilot data arrives and as the framework is stress-tested against edge cases.*
