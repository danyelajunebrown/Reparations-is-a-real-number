# ASSESSMENT — Dutchess County calibration case study (investigation, Jul 19 2026)

_Investigate-and-report-first response to the user's Dutchess calibration prompt (Roth & Tolbert 2025,
"Resolving the Reference Class Problem at Scale"). NO code/schema/scraping — reporting only, per the
prompt's constraint. Related: [[finding-land-nonclaim-and-dutchess-audit-jul17]] · [[plan-climb-as-gated-lead-source]] · [[assessment-climb-architecture-gap-jun30]]_

## 0. CORRECTION — the prompt's file map is stale

- `src/utils/reparations-calculator.js` and `descendant-calculator.js` **do not exist.** The calc was
  refactored into `src/services/reparations/` (Calculator.js, DAAGenerator, WealthGapCalculator,
  TieredPaymentCalculator, DisgorgementCalculator). The named free parameters live in
  **`src/services/reparations/Calculator.js`** (`inflationRate 0.035:27`, `dailyWageBase 120:30`,
  `humanDignityValue 15000:34`, `compoundInterestRate 0.04:42`).
- **CAVEAT on those params:** `Calculator.js` is required by DAAOrchestrator + index.js, but the DAA's
  actual labor figure is **Craemer $0.80/day** (DAAGenerator, per CLAUDE.md audit-rule #4), NOT
  `$120 dailyWageBase`. `Calculator.js` looks like a legacy wage-theft/dignity calculator whose live
  role needs confirmation before treating its params as the binding free parameters. The prompt's
  concern is right in spirit; the specific numbers may target a partly-superseded calculator.
- Files that DO exist and were read: `OwnerPromotion.js` (533L), `generate-climb-accuracy-audit.mjs`
  (171L, read full), `wikitree-descendant-scraper.js` (549L). Memory bank read this session:
  projectbrief (full), activeContext + progress (extensive), CLAUDE.md, many plan/standard docs.
  systemPatterns/techContext/bibliography-index: grepped, not full-read (flagged for depth if needed).
- **Roth & Tolbert / multicalibration / reference-class / Reconcile: ZERO hits anywhere in the memory
  bank or code.** No prior art in the project; this framework is entirely new here.

## 1. ACTUAL STATE (Task 1 — measured, live DB)

### Dutchess records
| table | Dutchess rows | note |
|---|---|---|
| canonical_persons | **0** | census leads not promoted (RULE 0.6: no per-person image) |
| unconfirmed_persons | **173** | 135 census + wills + a few; leads only |
| enslaved_individuals | **0** | the OLD enslaved table has NO Dutchess data |
| person_documents | **1,229** | colonial wills + census district docs (imaged + RAG) |
| enslaved_owner_relationships | **84** | the 1755-census owner→enslaved edges (Dutchess) |

### Climb
- `ancestor_climb_sessions` = **14** total. `ancestor_climb_matches` = **852** total.
- **Dutchess-touching climb matches = 0.** No climb has ever run for a Dutchess lineage. The climb is
  orthogonal to the Dutchess corpus we just built.

### match_confidence distribution (852 matches)
| conf bin | n | |
|---|---|---|
| 0.6–0.7 | **719 (84%)** | the bulk — low |
| 0.7–0.8 | 38 | |
| 0.8–0.9 | 91 | |
| 0.9–1.0 | 4 | only 4 matches above 0.9 |

### classification (852)
`temporal_impossible` **408 (48%)** · `common_name_suspect` 168 (20%) · `unverified` 161 ·
**`enslaved_ancestor` 113 (13%)** · free_poc_slaveholder 1 · rejected_by_human 1.
→ Nearly half the climb's own matches are temporally impossible; only **13% are plausible
enslaved-ancestor links**. `match_type`: **719/852 (84%) are `name_only_match`** — the weakest tier;
only 36 are name+date+location, 2 external-id.

### Ground truth recorded? — essentially NO
- `verified = FALSE` on **all 852**. "auto_verified" (510) is a pipeline flag, not a human verdict.
- `verified_by` non-null on **1 row** ('admin'); 1 `human_rejected`. **≈2 human verdicts exist in the
  entire DB.** The audit packet (`generate-climb-accuracy-audit.mjs`) prints verdicts on PAPER for
  participants to fill in and **never writes them back** (the script only READS matches). There is no
  verdict table.

### Complete chains — the real n
- `enslaved_individuals` = 18,279 rows but **0 have child_ids, 0 have parent_ids** — the genealogy
  columns are empty. No enslaved→descendant chain can be built from this table.
- `inferred_parent_links` = 7,234 edges / 9 sessions — climb's DESCENDANT-side parent inferences,
  session-scoped, none Dutchess.
- The climb runs modern→**enslaver**, not modern→**enslaved**. So even its 852 matches are the wrong
  direction for "named enslaved person → living person."
- **Complete, unbroken, named-enslaved → modern chains: effectively 0. For Dutchess: 0.** Say it
  plainly (the prompt asked): the ground-truth n the case study needs does not exist yet — not 750,
  not 75, ~0.

## 2. VIABILITY (Task 2 — honest, "do not talk me into it")

**The national participant-verification route is not close** — ~2 human verdicts, 750 needed per bin,
recruitment slow + self-selected. The prompt is right to abandon it.

**The Dutchess documentary route is VIABLE IN PRINCIPLE and uniquely well-positioned — but it is a
BUILD, not a query.** What makes it viable that wasn't true a week ago: we now hold near-population
**enslaver-side** coverage for colonial/antebellum Dutchess (1714 census, 1755 census, ~1,225 imaged
colonial wills, 84+ owner→enslaved edges) — the *closed population's holder side* is largely in hand.

**But the binding gap is the FORWARD linkage the case study actually calibrates:** from a named 1755/
1799-era enslaved person → through NY gradual-abolition records (1799 birth registrations of children
born to enslaved women, manumissions, 1790–1830 federal census "all other free persons"/slave columns,
church + probate) → to a modern person. **None of that forward-linkage data is ingested**, and the
climb (the only linkage engine we have) goes the wrong direction and has 0 Dutchess coverage. So:

- **VIABLE** as a multi-month build: Dutchess is the right closed population (NY abolition bounds it in
  time; holdings 1–5 people; continuous records), and the reference class genuinely *can be* the
  population rather than a biased sample.
- **NOT viable as a near-term read on `p` (per-link accuracy)** without first (a) ingesting the
  abolition-era forward-linkage records and (b) building a record-linkage model that runs
  enslaved→descendant. Today there is nothing to calibrate.

**Honest bottom line:** the county is the right choice and the enslaver side is unusually complete, but
the descendant-linkage substrate — the thing `f` scores and `F(e)` verifies — is empty. The case study
is reachable, but Stage 1 is "create the linkage data + a second model," not "measure existing chains."

## 3. DESIGN (Task 3 — conditional on the Stage-1 build)

- **Population + bounds:** persons enslaved in Dutchess County, 1755 census cohort through the 1799
  Gradual Abolition Act to full emancipation 1827; forward tracing to living persons. The 1755 census
  (85 named enslaved) + post-1799 birth registrations are the spine.
- **`f`:** AGREE with the prompt — `f(e) = P(person X descends from named enslaved person Y | evidence)`,
  a [0,1] linkage probability, NOT a dollar figure. The dollar calc is deterministic downstream and
  must not be the calibration target (that would bake the free-parameter problems of §4 into the
  probability). One refinement: calibrate the **per-link** posterior P(child_of | evidence), because
  whole-chain p^n is the binding quantity and per-link is where the failure compounds (see §4).
- **`F(e)` ground truth + storage:** NEEDS A NEW TABLE (flagged, not built): `linkage_verdicts`
  (subject refs polymorphic, verdict ∈ confirmed/refuted/uncertain, basis ∈ document/participant/
  researcher, evidence_doc_id, verifier, confidence, created_at). This is the thing the audit packet
  should have written back and never did. Documentary `F(e)`: a birth registration naming an enslaved
  mother + child, a manumission naming a person, a will bequest — each a recorded verdict on a specific
  link.
- **Second model `f₂` for Reconcile — evaluated:**
  - *Two climber thresholds:* cheap but WEAK — same engine, same features, correlated errors; Reconcile
    needs models that can actually disagree. Marginal.
  - *FamilySearch-derived vs WikiTree-derived:* the better option. `wikitree-descendant-scraper.js`
    already builds enslaver→descendant trees (BFS, stored in `slave_owner_descendants_suspected`) —
    genuinely independent tree source from FS. BUT note the DIRECTION mismatch: FS-climb goes
    modern→enslaver, WikiTree scraper goes enslaver→descendant. For Reconcile on the enslaved→descendant
    `f`, BOTH need to be run enslaved-forward; the WikiTree engine is closer (already forward). Viable,
    needs a forward-FS counterpart.
- **Reference classes + the ε/2 mass floor:** candidate strata = town × decade × holding-size. At the
  realistic Stage-1 population (85 named enslaved 1755 + whatever 1799-registration linkage yields —
  order 10²–10³ persons, NOT 34,000), **almost no stratum clears the ε/2 = 2.5% mass floor at ε=0.05**,
  and the whole population is far below the ~34,000 sample requirement (E≤0.1) the prompt cites. So
  **certified multicalibration is out of reach at county scale**; what Dutchess CAN deliver is an honest
  estimate of **E and per-link p** on a near-complete population — which is the prerequisite the prompt
  itself says gates everything (Stage 1).

## 4. WHAT SAMPLE SIZE CANNOT FIX (Task 4)

- **Descendant-share dilution (bias #1, CONFIRMED):** `1.0 / numLivingDescendants`
  (`WealthGapCalculator.js:136`) and `1.0 / estDescendants` (`DAAOrchestrator.js:1982`). Conserves
  credit only if the descendant set is COMPLETE. Every unfound descendant inflates every found one's
  share, and it compounds per generation. Magnitude: if descendant discovery recall is r per
  generation over g generations, found shares are inflated by ~ (1/r)^g — at r=0.7, g=6 that is a ~8×
  over-statement of the found descendants' individual shares. Sample size cannot fix a recall bias.
- **Self-selection (bias #2, CONFIRMED):** `MIN_VISITED = 3` (`generate-climb-accuracy-audit.mjs:33`)
  drops failed climbs to a "re-run, do not verify" appendix. Failed climbs are disproportionately
  people with unshared/nonexistent FS trees — plausibly the descendants with the STRONGEST claims
  (least documented lineages). They are invisible in every accuracy metric we compute. Dutchess's
  documentary route partly mitigates this (population-based, not tree-sharing-based) — a real argument
  FOR the county approach.
- **Free parameters (each its own reference-class problem, CONFIRMED present):** `Calculator.js`
  `inflationRate 0.035`, `dailyWageBase 120`, `humanDignityValue 15000`, `compoundInterestRate 0.04` —
  all `config.X || <const>` defaults, asserted not derived. `humanDignityValue 15000` and
  `dailyWageBase 120` in particular are pure stipulations; the Craemer $0.80/day path (the CLAUDE.md
  canonical) at least cites a source. Any of these materially moves the dollar output but NOT the
  linkage `f` — another reason to keep `f` probabilistic and separate from the dollar calc.
- **Promotion thresholds asserted, not validated (CONFIRMED):** `OwnerPromotion.js` promotes at
  per-channel `minConfidence` 0.80/0.85/0.90/0.95 (lines 37–61) — the prompt's "as low as 0.80" is
  exact. None validated against outcomes. At p=0.80 per link, an 8-link chain is 0.80^8 = **17%**
  likely whole-chain-correct; to reach 0.95 whole-chain over 8 links needs p ≥ 0.9936 — far above any
  threshold in use. This is the prompt's central point and the DB confirms the raw material is worse
  than the thresholds imply (84% of matches are name-only at 0.6 confidence).

## 5. STAGED PLAN (Task 5 — real numbers, Stage 1 = first honest read on p)

**Stage 0 (done / in hand):** enslaver-side Dutchess corpus — 1714 + 1755 censuses (441 leads, 84
edges), ~1,225 imaged wills, RAG live. n(named enslaved, 1755) ≈ 85.

**Stage 1 — FIRST READ ON p (the gate). Effort: ~1–2 wk build + data.**
Ingest the forward-linkage records for a SINGLE town (e.g. Rhinebeck/Fishkill — highest 1755 density):
NY 1799+ birth registrations of children of enslaved women (town clerk books), manumissions, 1800–1830
federal census. Build the `linkage_verdicts` table. Hand-link ~20–40 enslaved persons one generation
forward from DOCUMENTS (not the climb). Deliverable: a first empirical per-link p on documented links —
if p < 0.99, STOP and fix the linker before scaling (the prompt's own stop condition). n(links) ≈ 20–40.

**Stage 2 — second model + per-link E. Effort: ~2–4 wk.** Stand up a forward FS-linkage run and the
WikiTree forward run over the same town; record both `f` and `f₂` on the Stage-1 verdicted links;
compute E and the Reconcile disagreement. n ≈ 100–300 links.

**Stage 3 — county extension IF Stage 1–2 show p≥~0.99.** Extend to all 12 Dutchess towns; population
order 10²–10³ enslaved persons. Enough for an honest E on a near-complete population; NOT enough for
certified multicalibration (below the 34k floor and the 2.5% stratum mass floor). Report it as
"population-level E on one county," not "calibrated."

**Do NOT scale nationally until Stage 1 returns p.** Per the prompt: if per-link accuracy is below
~0.99 nothing downstream is meaningful.

## Open items to confirm before building (all flagged, none done)
1. Is `Calculator.js` live on the DAA path or legacy? (params targeting matters).
2. Do NY 1799 birth-registration books survive for the target town + are they digitized/reachable?
   (This is the load-bearing assumption; if the forward records aren't there, Dutchess is not viable
   and we pick the next-best bounded population.)
3. `linkage_verdicts` schema + a forward (enslaved→descendant) linkage runner: both NET-NEW.
