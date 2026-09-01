# FINDING — The land non-claim directive, and the Dutchess audit (Jul 17 2026)

_Session: full-codebase audit + Dutchess DAA readiness. User directive (2026-07-17):_
_**"end-to-end DAAs for enslavers and enslaved of Dutchess County NY, cognizant of wealth over_
_time, which make NO claim to the land of the Native peoples — that ought to be restituted_
_separately."** Supersedes nothing; ADDS a hard constraint the methodology does not currently have._
_Related: [[wealth-tracing-framework]] · [[finding-ny-probate-audit-jul01]] · [[plan-de-siloing-fixes]]_

---

## 0. NEW DUTCHESS SOURCES — the O'Callaghan slave censuses (user-supplied, 2026-07-17→18)

The user supplied two Dutchess census sources, **both SECONDARY** (published 19th-c transcriptions
of colonial manuscripts; the user explicitly corrected "though not primary"). Tier them like the
Hynson/Heritage compilations: confidence **0.85**, `max_evidence_tier='secondary'` until the NY State
Archives manuscript is located. Both are O'Callaghan, *Documentary History of the State of New-York*.

- **1714 Census of Dutchess County** (vol 1 p.240; USGenWeb/Andrle transcription). Household census —
  **COUNTS ONLY, no enslaved names.** 14 slaveholding households, 30 enslaved. → enslaver leads +
  documented count; **NO fabricated "unnamed enslaved" rows** (audit rule). Includes **Peck De Witt**
  and **Roger Brett** — both in the Rombout/Schuyler patent lineage (the Massena chain families).
- **1755 Census of Slaves** (the "Census of Slaves" pp.851-855). **NAMES the enslaved.** Dutchess =
  3 districts (Col. Martin Hoffman's; Rynebeck Pct/Knickerbacker; Rhinebeck Pct/Neher), ~37 enslavers,
  **~85 named enslaved**. User chose to ALSO ingest the Westchester half (Philipsburgh Manor,
  Morrisania/Lewis Morris, Borough of Westchester, Pelham, Mamaroneck/Scarsdale, Rye, North Castle) —
  count-only where the source is count-only. Same Dutchess families as the wills + Massena: **Ten
  Broeck, Van Benthuysen, Hoffman, Kip/Keip, Rutsen** — 1755 is a generation BEFORE the wills.

**Artifacts (this session):** faithful transcriptions `data/census/dutchess-1714.json`,
`census-of-slaves-1755.json`, `dutchess-1714-source.txt`; ingest `scripts/ingest-ny-slave-census.mjs`
(file-first: S3+Wayback+source_artifacts → per-district `person_documents` (ocr_text, RAG-embeddable) →
`PersonService.findOrCreateLead` DEDUP → `enslaved_owner_relationships`; `--apply`, dry-run default;
per-stratum sum validation per standard rule 2). **DEDUP IS THE POINT:** the DB already holds junk
enslaver rows for these families (`'"Hoffman"'` with literal quotes, `'Hoffman, ??'`, `'Rutsen,
Andries'` duplicated) — routing through `findOrCreateLead` repairs them (adds county+evidence) instead
of piling on more. **EMBED (RULE 0.5) is a queued follow-on** — needs nomic on the Mini ollama (offline).

## 0.5 RAG RETRIEVAL WAS SILENTLY BROKEN PLATFORM-WIDE — fixed (2026-07-18)

Surfaced while embedding the census docs (user asked "can we run RAG here?"). `RagService.retrieve`
returned **0 rows for EVERY query** ("No documents are indexed yet") despite 219k embeddings —
a total, silent RAG outage, NOT the "degraded" the memory bank attributed to `OLLAMA_URL`.

**Two stacked causes, both fixed:**
1. **`hnsw.ef_search` was unset.** On Neon `SHOW hnsw.ef_search → undefined`, and an unset ef_search
   makes the HNSW index return ZERO rows. `RagService.retrieve` never set it. Fix (commit ad8feb617):
   set `hnsw.ef_search` (default 400) on a dedicated pooled connection in a txn before the vector query.
2. **Full HNSW index + post-filter recall loss.** `idx_embeddings_hnsw` covered ALL content_kinds;
   the planner preferred it for the `ORDER BY <=>`, its ANN candidates were ~62% `person_profile`, and
   the `content_kind='doc_ocr'` filter removed all of them ("Rows Removed by Filter: 2111 → 0"). Fix
   (migration 124, commit fc304f274): add a PARTIAL hnsw index `WHERE content_kind='doc_ocr'` and DROP
   the full index (SAFE — person_profile has no vector reader per orphan-audit finding #2; REVERSIBLE).

**Verified** via this MacBook's local nomic: every test query now returns full top-6 across the whole
83k `doc_ocr` corpus (was 0). "Lewis Morris Morrisania enslaved" 0→6, Morrisania doc at 0.70.

**EMBED + RAG run LOCALLY on the MacBook now** — `nomic-embed-text` is on this machine's ollama
(:11434, 768d, the corpus model). `EMBED_SOURCE=ollama` runs the embed backlog (23k+ unembedded docs,
100% of canonicals) HERE — the "Mini offline" excuse for the RAG/embed debt is GONE. Caveat: the LLM
*answer* layer (`callLLM`) needs an API key I did not verify; RETRIEVAL (the broken part) is fixed.

---

## 1. HEADLINE — the system is ALREADY monetizing Native land into a reparations obligation

This is not a hypothetical risk to guard against. It is live, in the ledger, today.

**The path (verified by reading the code, not inferred):**

1. `DAAOrchestrator.js:1892` → `disgorgementCalc.forEnslaver(id)`
2. `DisgorgementCalculator.js:64-68`:
   ```sql
   SELECT consideration_usd AS usd, transfer_year AS year
   FROM land_transfer_events
   WHERE enslaver_person_id = $1 AND implicates_enslaver = TRUE
   ```
3. `:83/:85` compounded to present via RateResolver → `components.land` → `total_usd`
4. → `ObligationReconciler.combine` predictor 3 → `enslaver_lineage_ledger.disgorgement_component_usd`
5. → per-descendant `daa_lineage_contributions.contribution_usd` (`:1983`)

**Live data (measured 2026-07-17):**

| metric | value |
|---|---|
| `land_transfer_events` | 116 (**all** `implicates_enslaver=TRUE`) |
| …carrying `consideration_usd` | 38 |
| …whose description names acreage/tract/plantation | **88** |
| `enslaver_lineage_ledger` lineages with `disgorgement_component_usd > 0` | **74** / 248,924 |
| max lineage disgorgement | **$705,462,331,056** |

**The land being monetized includes land taken from Native peoples.** Sample rows:
- `"four hundred and fifty acres… on the forks of Altamaha river… called the Builtown tract"`
  — Georgia, **ceded Muscogee (Creek) land**
- `"lot of land in Plymouth, Massachusetts"` — **Wampanoag land**
- `"one third part of the plantation or tract of land formerly resided by James Wilson"` (1808, $500)

**Why it hasn't surfaced yet — and why that is NOT protection:** `calculateTotalDebt:1612`
hardcodes `disgorgement: { usd: 0 }`, so land value does not reach the DAA's headline number
*today*. **That is a stub, not a guardrail.** The moment anyone wires the disgorgement component
into the DAA total — which is the stated Phase-4 roadmap item in [[wealth-tracing-framework]] —
every DAA silently claims the value of Native land. The user's directive arrived before that
wiring, not after. That is the only reason this is a design decision and not an incident.

---

## 2. The directive collides with the framework, not just the code

[[wealth-tracing-framework]] is titled **"A Lineage-Specific, LAND-PRIMARY Methodology."**
Its Claim 3 is literally *"Land as primary trace."* Its stated purpose is to answer
*"who specifically owes whom, and **what specific assets underwrite that debt today**?"*
Its specified endpoint (`:178-180`) is **modern-parcel mapping** via plat overlay —
i.e. naming the present-day parcel that underwrites the claim.

**Grep of the ENTIRE codebase + the framework for:**
`indigenous|native_american|mohican|munsee|stockbridge|tribal|land_back|aboriginal`
→ **ZERO hits** in `migrations/`, `src/`, `scripts/`, `contracts/`, and in `wealth-tracing-framework.md`.

The methodology traces **forward** from the enslaver's holding and **never looks backward past the
patent**. It has no field, no table, and no sentence for the origin of the title. Its §8 "Explicit
limits" disclaims moral equivalence of modern holders — but says nothing about whether the land was
the enslaver's to hold in the first place.

**This is a memory-bank decision, not a patch.** The framework must be amended, not worked around.

## 3. The resolution the user specified (RECORDED DECISION, 2026-07-17)

> **Land is a VALUATION INSTRUMENT, never a claimed asset.**

- The chain of title is used to **value** enslaver wealth over time.
- The DAA claims the **value of stolen labor**, not the land.
- **No land parcel is ever named as a claimed asset** in a DAA.
- Restitution of the land is a **separate matter belonging to the Native nations** — the
  Muhheaconneok (Mohican) and Munsee/Sepasco-Esopus in Dutchess; today the
  **Stockbridge-Munsee Community**. The DAA must not settle, offset, extinguish, or
  prejudice that claim.

**Required build (none of it exists):**
1. A representation of the **Indigenous origin link** ("Link 0") — the fact that the chain does
   not bottom out in a legitimate title.
2. A **hard guardrail in the calculator** blocking land value from becoming a descendant's claim
   — code, not a comment. The current `disgorgement: {usd:0}` stub must be replaced by an
   *intentional* exclusion that cannot be silently switched on.
3. An amendment to [[wealth-tracing-framework]] reconciling "land-primary" with "land makes no claim."

## 4. The Massena chain of title — the reference instrument

User supplied `Massena_Chain_of_Title_PACKET.pdf` (Barrytown, Town of Red Hook, **Dutchess County**;
Bard College campus). **22 links, 1688 → 2024, ~336 years, continuous.**

Muhheaconneok (Mohican)/Munsee homeland → **1688 Schuyler Patent** → De Witt → **Beekman 1715** →
**Margaret Beekman Livingston 1776** → **John R. Livingston 1785/1800** (builds Massena 1796) →
Henry Dwight Jr 1853 → foreclosure → Stewart Brown 1858 → Aspinwall 1860 → Kip 1911 →
St. Joseph's 1928 → Unification Church 1974 → UTS 1987 → **Bard College 2024**.

**Why it matters here:**
- **Beekman and Livingston are exactly the Dutchess enslaver families.** This is not a tangent.
- It carries a real **wealth-over-time series**: $50,000 (1853) → $20,000 foreclosure (1858) →
  $1,150,000 (1974) → ~$14,000,000 (2024). Anchored to ONE parcel across 336 years.
- **It does what the framework never does: it includes Link 0.** The 1688 patent's own words —
  *"Purchased of and from the **Indyans, Naturall Owners & Possessors**"* — put the origin of the
  title **inside the instrument**. The 1686 Rhinebeck Indian deed (Aran Kee, Kreme Much, Korra Kee
  → Artsen/Rosa/Elton) traded the land for guns, kettles, blankets, 40 fathoms of wampum, and rum.

This is the model: **the chain proves the wealth AND proves the theft under it, simultaneously.**
Use it to value; never to claim.

## 5. "We have no good means of storing land" — FALSE. We do; it's empty and unwired.

| table | migration | rows | verdict |
|---|---|---|---|
| `properties` (parcel anchor) | **112** | **1** | deed-shaped, well-designed, never populated |
| `land_transfer_events` (chain of title) | **038** | **116** | schema good; feeding disgorgement (§1) |
| `modern_parcel_links` | 038 | **0** | never used |
| `top_landholder_flags` | 038 | **1** | never seeded |
| `flagrant_heirloom_assets` | 038 | 723 | sums alongside land in disgorgement |
| `inheritance_edges` | 067 | 10,236 | the one that IS populated |

`properties` (M112) is **deed-shaped** — `legal_description`, `lot`, `block`, `liber_folio`,
`metes_and_bounds`, `modern_parcel_apn`, `geometry_wkt` — and matches the Massena abstract almost
**field-for-field** ("Liber 99, p. 405-407" *is* `liber_folio`). M112's own header explains it was
written because `land_transfer_events.property_id` was "a bare, unpopulated UUID because the parcel
anchor never existed."

**So the gap is not storage. It is: (a) empty, (b) unwired to the DAA, (c) no Indigenous-origin
representation, (d) no non-claim guardrail.** (c) and (d) are the genuinely new build.

---

## 6. DUTCHESS — the data EXISTS. Earlier "no Dutchess data" was WRONG.

**Correction to this session's own first conclusion.** `primary_county ILIKE '%dutchess%'` = **0**
canonical persons. That query was right; the inference from it was wrong.

**There are 1,225 Dutchess documents. 100% have S3 images. 95% are RAG-embedded.**

They are **mislabeled as `albany`**, because the *"Albany County NY Probate Records — Wills
1629-1802"* series is **NOT Albany-only** — it is the **colonial New York province-wide prerogative
will books**, merely *filed* at Albany. Dutchess testators are inside it.

**Root cause of the mislabel:** `scripts/link-ny-probate-testators.mjs:54` mints every NY testator
with `primary_state='New York'` and **NO county at all** → the 14,666 county-NULL NY canonicals.
Albany's 13,990 is not dominance; **it is the only county that ever got labeled.**

| Dutchess docs | count |
|---|---|
| OCR mentions "Dutchess" | **1,225** |
| …with S3 image | **1,225 (100%)** |
| …embedded in RAG | 1,168 (95%) |
| …linked to any person | 94 (7.7%) |
| …**with NO `testator_name` extracted** | **1,099 (90%)** ← the blocker |
| …with a slavery token (slave/negro/wench/manumit) | 41 |
| **enslaved-person leads on Dutchess docs** | **0** |

### The smoking gun — doc #584493 (verified by direct query)

> *"A Just and true Acc. of the Personal Estate and Debts of **Israel Kniffen** Decd late of
> **Fishkill Township in the County of Dutchess** Geoman Viz **Negro Man Jack** … **Marry** —
> **301.0.0** — one Old Horse — 101.0.0…"*

A Dutchess enslaver. **Two enslaved people named** (Jack, Marry). **A valuation: £301** — appraised
above the horse, itemized in an estate inventory. Enslaver + enslaved + wealth figure, in Dutchess,
already imaged and already in RAG.

Its DB state: `testator_name` NULL · `canonical_person_id` NULL · `enslaved_count` NULL ·
`document_year` NULL. **Nothing was ever built from it.**

Others: #597606 Johannes Van Kleck "of the County of Dutchess" 1746 · #582869 Johannis Staats
"of **Rhinebeck** precinct" · #570275 Fredericksburgh inventory "Negro man, 24yrs".

### THE BOTTLENECK IS EXTRACTION, NOT ACQUISITION

**90% of already-imaged Dutchess docs have no decedent name** — the carry-forward testator parser
fails on colonial-book layout. Scraping more rolls adds documents to a pipeline that cannot parse
the ones it already holds. **Extraction-first is the decided path (user, 2026-07-17).**

### EXTRACTION PROVEN — `scripts/analyze-dutchess-colonial-wills.mjs` (dry-run, committed 71995d4fc)

Built + ran a colonial-book parser over all 1,225 docs, **read-only, zero writes** (prove-yield-
before-promoting). The shared `probate-entity-extractor.js` misses colonial wills because its
`I <NAME> of (county|state|town)` anchor excludes the colonial "I <NAME> of <PRECINCT> in the
County of Dutchess" shape (word after "of" is the precinct, not "county"). Added anchors:
`will_opening` (75) · `probate_proof` "will of the said <NAME>" (197) · `proof_sign` (24) ·
`inventory_of` "Estate and Debts of <NAME> Dec'd late of" (16). Reuses shared `isValidPersonName`.

**YIELD (1,225 docs):**
- **testator recovered: 312 (25.5%)** — 304 new/corrected over the carry-forward parser
- **Dutchess residence confirmed: 1,225 (100%)** — precinct/town on 255
- **NAMED enslaved: 13 docs → 26 people** (23 distinct), the enslaved-SIDE seeds that previously
  did not exist (was 0). After the SECOND pass (commit da26f713d): Kniffen → **Jack + Marry**;
  inventory 582869 → **Prince/Cato/Mill/Flora/Bas**; Cornelius Sebring → York/Nanny/Jean/Rose;
  John Potter → **Rachel/Eunice**; John Pine → Nanny/Isaac; William Butcher of Hynebeck →
  Dolly/Tom/Jack; Van Bunschoten → Haned/Ben; Adam Bither → Flora; Ross → Dina; Teller → Dine;
  plus August, Harry (testator not yet recovered on those inventories).
- residuary boilerplate ("Silver Plate Slaves Horses Cattle") correctly separated: 2, NOT minted.
- **ONE known FALSE POSITIVE, flagged not removed:** doc 581079 "Philip" = "Philip Field", a free
  person in a petition. Left in the review file deliberately — that judgment belongs to a human,
  and hacking it away would hide the class of error (surnamed → probably free) from review.

**Bugs the dry-runs surfaced + fixed:** (1) the named-enslaved regex was case-sensitive → "Negro
Man Jack" captured "Man", rejected it, never reached "Jack" — `/i` restores it. **This is a lesson
for the shared `probate-entity-extractor.js` `extractEnslaved` too — check it for the same trap.**
(2) Multi-person docs only yielded the FIRST person: estate inventories list the enslaved together
before the livestock, and wills use "the one named X and the other Y". Added a bounded inventory-run
scan (anchored names between "Negro" and the first livestock/goods word) + a paired-form pass. Key
regex lesson: run the "Named"/descriptor/ditto anchors as INDEPENDENT /g passes — a single
alternation lets the "do" ditto consume the "Named" that should anchor the next name (dropped Flora).

Output JSONL `worksheets/dutchess-colonial-yield.jsonl` (gitignored — names enslaved people)
awaits human review. **These 12 enslavers + 18 enslaved are the both-sides seed for a Dutchess DAA.**

**NOT YET BUILT (the promotion pipeline, in order):** (a) wire `isNameSuspect` into the mint (§8);
(b) fix `link-ny-probate-testators.mjs:54` to write `primary_county='Dutchess'` from the residence
parse; (c) write `person_documents.name_as_appears` + `enslaved_count`/`enslaved_demographics`
from the parse; (d) dedup (Biscoe) + promote image-backed canonicals; (e) EMBED (RULE 0.5/0.6);
(f) capture the £-valuations (Kniffen £301) as the wealth-over-time signal — via `estate_valuations`,
NOT `land_transfer_events`, to avoid the land-claim path entirely (§1, §3). Refinement: "Marry"
(Kniffen's 2nd enslaved) and post-descriptor list-names are missed; probate_proof is the workhorse.

## 7. The NY probate scrape — found, stopped, resumable, but NOT the bottleneck

- Collection **1920234** (NY Probate 1629-1971), run by `scripts/scrapers/georgia-probate-scraper.js`
  (misnamed — it is the **generic** collection-driven scraper).
- **Last activity 2026-07-09**; no process running. Died when the Mini went offline.
- **Covered exactly 3 of ~58 counties:** albany 50,228 · cayuga 21,080 · allegany 17,562.
  Canonical enslavers match exactly: Albany 6,331 · Allegany 691 · Cayuga 310. **Dutchess rolls:
  never scraped** (`collection_key ILIKE '%dutchess%'` = 0).
- **It supports `--county Dutchess`** — applied at sitemap-build time (`:508`) specifically to avoid
  crawling all counties. No need to wait for alphabetical order.
- **Resume state is in Neon** (`probate_scrape_progress`) → machine-independent. Local sitemap is
  absent (lived on the Mini); Phase 0 rebuilds it.
- **MacBook is ready NOW:** Chrome for Testing live on :9222 **and logged into FamilySearch**.
- **Running from the MacBook would FIX a live bug:** the Jul-1 audit found year-extraction
  *regressing* (93.3% NULL by wk Jun 29) because the Mini ran a **stale pre-#67 checkout**. This
  machine has the fixed widened-year regex.

**TRAP — `probate_scrape_progress.county` stores the FS GROUP ID (`9SYB-SPN`, `Q7TH-BZS`), not the
county name.** 176 of 178 distinct NY "counties" are ARK roll IDs. Only `Albany`/`Allegany` are real
names. Do not read that column as a county.

## 8. `isValidPersonName` vs `isNameSuspect` — the mint gap (root-caused)

The Jul-1 audit's finding #2 ("Albany"×5, "Sole"×4, "Deceased"×5 minted as assertable enslavers)
root-caused. **It is NOT that testators skip validation** — `upsertCanonicalPerson`
(`georgia-probate-scraper.js:1334`) DOES call `isValidPersonName` ("last line of defense").

**The two heuristics are different and complementary, and only one is wired to the mint:**

- `src/utils/person-name-validator.js` → `isValidPersonName` catches **phrase fragments**
  (`NON_NAME_TOKENS`, >5 tokens, no vowel). **Verified: it returns `true` for `Albany`, `Sole`,
  `Deceased`, `New York`** — a single capitalized word with a vowel sails through.
- `scripts/build-probate-estate-index.mjs:50` → `isNameSuspect` catches **single tokens + place
  words** (`toks.length < 2 → true`; `PLACE_WORDS`; digits). It catches all of the junk. **It is
  never called at mint** — only when building the estate index, after the fact.

`scripts/flag-junk-enslaver-entities.mjs:13` states the forward fix "is a separate change" —
**explicitly deferred, never done.**

**Fix:** promote `isNameSuspect` + `cleanName`/`normKey` into `person-name-validator.js` (whose own
docstring says it exists "so the rule cannot drift between them") and gate the **mint** with it.
**Biscoe rule:** do NOT delete — decline to mint the canonical; the name survives in
`probate_scrape_progress.testator_name` + `person_documents`, so nothing is lost and it can be
re-processed. Note the ESM/CJS boundary (validator is CJS; estate-index is ESM).

## 9. CORRECTION to [[finding-ny-probate-audit-jul01]] — the gate bug is FIXED

That doc's finding #1 ("**4,910/5,301** NY testators carry BOTH `assertable_slaveowner` AND
`assertable_enslaved`", flagged "Highest priority") **is now stale and actively misleading.**
Re-measured 2026-07-17, scoped through the `ny_probate_testator` namespace (NOT `primary_state`,
which is unreliable per §6):

| testators | both | owner | enslaved |
|---|---|---|---|
| 3,726 | **0** | 33 | 0 |

**The fix landed.** It is NOT a blocker to Dutchess promotion. Anyone reading the Jul-1 doc will
wrongly sequence a gate fix ahead of the extraction work. (Cost this session: one agent did exactly
that, citing the doc instead of measuring.)

---

## 10. DAA end-to-end — DOES NOT RUN TODAY

- **Hard blocker, reproduced:** `DAAOrchestrator.js:1581` `for (const key of corporateConnections)`.
  `loadParticipantWealthFingerprint:1762` returns `corporateConnections: … ?? false` → literal
  `false`. The destructuring default at `:1509` (`= []`) fires only on `undefined`, not `false`.
  → `TypeError: corporateConnections is not iterable`. **One-line fix.** API route
  (`daa.js:87`) passes a real array, so **only the CLI is dead — but the CLI is the documented
  entry point** (CLAUDE.md fixture table, COMPREHENSIVE-DAA-README).
- **Fixture missing:** no climb session for Nancy Brown / `G21N-4JF` exists.
- **Last DAA row written 2026-04-20.** `DAAOrchestrator` was rewritten Jul 6 — **no DAA has ever
  been generated against the current code.**
- **Line-item methodology is unreachable:** `USE_LINE_ITEM_METHODOLOGY=true` gates on
  `acknowledgerInfo.canonicalPersonId`, which **no caller ever sets**. 1.97M
  `reparations_line_items` rows never reach a DAA.
- **Confidence-scale collision (`:809`):** paths 1-3 assign `0.95/0.90/0.85`; the fuzzy fallback
  assigns `90/85/75`. Dedupe at `:1160` keeps "highest" → **a fuzzy 75 always beats an
  FS-external-ID 0.95.** The most reliable match type loses to the least.
- **Kinship gate can never pass:** tier-1 + verified + S3-backed `canonical_family_edges` = **0**
  of 4,922. Audit-only today; a hard block the moment `DAA_KINSHIP_GATE=enforce`.
- `daa_lineage_contributions` = **0 rows** — failures swallowed non-fatally at `:2002`.
- `scripts/generate-daa-pdf.js` is a **parallel divergent generator**: flat `income × 0.02`
  (`:52`), `totalDebt = null` always (`:76`), asserts **every** match is a SlaveVoyages trade
  participant (`:99` — factually wrong for probate-sourced matches), `puppeteer.launch()` (`:381`,
  violates the connect-only rule), **no probate gate, no kinship gate**. Anyone running it ships an
  ungated instrument.
- **Audit-rule-#1 violation:** `DAAOrchestrator:1540` pads documented-but-unnamed enslaved with
  **invented** `yearsEnslaved: 20, startYear: 1850` → feeds a money number on a legal instrument.
  Traceable to a documented *count*, never to a documented *date*. Needs a decision.

## 11. "Cognizant of wealth over time" — compounding YES, tracing NO

- **Craemer** (`DAAGenerator.js:128-139`): `$0.80/day × 300 × yearsEnslaved × 1.03^yearsToPresent`
  — a flat formula compounded forward. **No lineage input.**
- **WealthGap**: `TOTAL_GAP ÷ estimated_descendants` — a population constant. No tracing.
- **Disgorgement**: the only predictor reading real transfer rows — but as **point valuations
  compounded to present**, not as a chain. No parent→child propagation.
- **`inheritance_edges` (10,236) is used in exactly ONE place in the whole DAA path**:
  `_estimateLivingDescendants:2020` reads `heir_count` as a **denominator**, then projects
  `heirs × 2^(gen-1)`. **It never traces what wealth moved to whom.**
- `inheritance_edges.land_transfer_id` — the FK **designed for chain-of-title** — is **unpopulated**
  (`build-inheritance-land-transfers.mjs` never applied). Only 40 of 10,236 edges are
  `real_property`.

**So "wealth over time" is UNBUILT.** The Massena chain is the first real instrument for it — and
per §3 it must value, never claim.

**Contract violation:** `scripts/project-probate-to-disgorgement.js:19-24` states non-chattel value
"lives ONLY in `estate_valuations`" and that DisgorgementCalculator "only sums land/heirloom values
that are NOT probate-sourced." **The calculator does neither** — it never references
`estate_valuations` (550 live rows, **orphaned**) and applies **no source filter** to the
probate-sourced land rows it sums. **The documented double-count guard is unimplemented.**

## 12. Orphaned data (quantified)

- **757,308 / 757,313 canonicals (100.00%) have no embedding. EXACTLY 1 canonical satisfies
  RULE 0.6** (image + RAG).
- **137,013 of 219,231 embedding rows (62.5%) have NO READER.** `embed-persons.mjs`/`embed-leads.mjs`
  write `content_kind='person_profile'`; `RagService.retrieve` (`RagService.js:52-61`) filters
  `content_kind='doc_ocr'` only. **RULE 0.5's EMBED phase feeds a retrieval layer that ignores its
  output. This is a QUERY fix, not a re-embed.**
- 2,720,261 leads (86.1%) never promoted; 95.7% unembedded.
- 19,844 unkeyed canonicals — **the climb silo is CLOSED** (climb_name_resolver 2/992); the new #1
  is **`hall_ingest` 14,167 (71%)**. Update [[note-climb-resolution-producer-jun27]] accordingly.
- **The entire UCL LBS cluster (52,984 rows / 4 tables) is WRITE-ONLY** — no reader at all, worse
  than the "unconfirmed-only promotion gap" previously recorded.
- `enslaver_evidence_compendium` (**3,133,703 rows**, 2nd-largest table) — **no `src/` reader**, no
  live serving path.
- 81,913 `person_documents` (11.5%) attached to no person at all.
- `identity_fingerprint` 2,886/757,313 (0.38%). Trigger fires correctly; **the formula is simply
  unsatisfiable**. Confirms "deprecate, do not fix" per [[plan-identity-resolution-completion]].
- **FK integrity is clean** — zero dangling refs across every table checked.
- Correction: the debt registry's "no `/api/rag` route is mounted" is **stale** — it IS mounted
  (`src/server.js:152`).

## 13. Dependencies — DONE this session (commit `2920540ae`)

**It was a deletion problem, not a patching problem.** Removed 11 packages, all verified at **zero
import sites**: `web3` (sole source of every prod CRITICAL; `ethers` is the real one),
`ipfs-http-client` (**the `--force` blocker** — `--force` wanted to downgrade 60→39, a 2019 release
declaring `github:` deps resolved over **ssh** → `Permission denied (publickey)`; `hugomrdias/
concat-stream` was never in our lockfile, `--force` *introduced* it), `xlsx` (high, no fix, never
imported — only extension-filter string literals), `truffle`+`@truffle/hdwallet-provider`+
`ganache-cli` (53+30+3 vulns, no `truffle-config.js` exists; Hardhat is the real toolchain),
`@anthropic-ai/sdk`, `multihashes`, `csv-parser`, `node-dbf`, `mammoth`.

**Result: 1,468 packages removed. `npm audit` 191 → 49, 0 critical. `--omit=dev` → 8 moderate,
0 high, 0 CRITICAL.** Verified: server boots + connects to Neon; `hardhat compile` clean.
Resolves two of CLAUDE.md's four duplications (the removed one was unused in both).

- **NEVER run `npm audit fix --force`** — proposes `aws-sdk`→**1.18.0** (2012), `bull`→1.1.3,
  `ipfs-http-client`→39: destructive downgrades of packages mostly being deleted.
- **`multer` 1.x is the one REAL item audit UNDER-reports** — live in 5 routes, EOL upstream,
  **zero audit findings** so invisible in the count. 2.x has breaking error-handling changes.
- Remaining 49 are ~all dev-only hardhat tooling. Ignore.
- `@openzeppelin/contracts` 4.9.6 — **do not touch**; the deployed mainnet contract depends on it.

---

## RECOMMENDED ORDER (revised by the §6 correction)

1. **Fix `corporateConnections`** (`:1581`/`:1762`) — one line, unblocks every CLI DAA. (§10)
2. **Colonial-book testator + residence parser** over the 1,225 already-imaged Dutchess docs →
   derive `primary_county='Dutchess'` from the OCR residence phrase ("of Fishkill Township in the
   County of Dutchess"). This is THE blocker. (§6)
3. **Fix `link-ny-probate-testators.mjs:54`** to write `primary_county` at mint. (§6)
4. **Wire `isNameSuspect` into the mint** (Biscoe rule: decline to mint, never delete). (§8)
5. **Extract enslaved names + valuations** on the 41 slavery-token Dutchess docs — Kniffen/Jack/
   Marry/£301 is the reference case. **The enslaved side of a Dutchess DAA currently does not exist
   (0 leads); a DAA names BOTH parties or it is a half-instrument.** (§6)
6. **Build the Indigenous-origin representation + the non-claim guardrail** BEFORE any disgorgement
   wiring. (§1, §3)
7. **Amend [[wealth-tracing-framework]]** — reconcile "land-primary" with "land makes no claim". (§2)
8. Fix the RAG `person_profile` reader (query change, unlocks 137k embeddings). (§12)
9. `multer` 1.x → 2.x. (§13)

**Do NOT** resume the Dutchess roll scrape first. Acquisition is not the bottleneck; extraction is.
The scrape remains available (`--county Dutchess --apply --resume`, Chrome+FS live on :9222) and is
worth doing AFTER the parser proves out on the 1,225 — otherwise it deepens a corpus nothing can read.
