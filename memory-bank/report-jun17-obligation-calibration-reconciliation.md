# Obligation Calibration + Reconciliation Build — Report

Date: 2026-06-17
Branch: `audit/probate-classifier-and-source-documents`

Turns the per-lineage obligation from a crude max/sum combiner into a single-sourced,
benchmarked, reconciled one. Four code modules + one migration. Verified against the
live Neon DB throughout (the brief's description was corrected where the code disagreed —
see "Corrections to the brief").

---

## Corrections to the brief (followed the code, not the description)

1. **The rate is two parameters, not one `0.05` repeated.** DAAGenerator uses Craemer's
   `0.03` labor-value floor; the line-item methodology uses `0.05` (uniform on every
   `reparations_line_items.compound_rate`, and in 4 `calculation_method_registry` rows).
   They are different theoretical objects. Both are now single-sourced and kept distinct.
2. **There is no later ledger migration.** The live `enslaver_lineage_ledger` is exactly
   migration 040. `upsertLineageLedger` was writing to columns that **do not exist**
   (`enslaver_canonical_id`, `craemer_2015_total_usd`, `wealth_gap_share_usd`,
   `combined_obligation_usd`, `generation_from_enslaver`) with `ON CONFLICT` on a
   nonexistent key — so every write silently failed inside its `catch` and the table has
   **0 rows**. The writer was rewritten to the real columns.
3. **The disgorgement sources are nearly empty and partly unattributable.**
   `wealth_transfer_events` has `debtor_entity_id = NULL` on all 128 rows — no resolved
   canonical linkage — so its $7.47M non-chattel pool cannot be attributed to any lineage
   today. `land_transfer_events` implicating an enslaver = 1 row ($5); `flagrant_heirloom_assets`
   = 0 rows. The disgorgement predictor is wired but near-zero for almost all lineages;
   that sparsity is carried as **low confidence**, never imputed up.
4. **Model A is a flat $47,501 constant** (min = max = avg across 89,406 line items;
   per-person variation is only the *count* of harm categories, 1–8). ~7.4× below
   Darity's $350K. Unchanged by this build (Model A is the line-item predictor); the
   reconciler now treats it as one predictor rather than the whole answer.

---

## (1) Every hardcoded rate / macro constant — before → now

| Constant | Was hardcoded at | Now reads from |
|---|---|---|
| Craemer compound rate `0.03` | `DAAGenerator.js:74` | `MACRO.RATES.craemerCompound.value` |
| Line-item compound rate `0.05` | `reparations_line_items.compound_rate` (DB, uniform); `seed-reparations-framework.mjs` registry rows 121/122/124 (inline `(1+0.05)^…`) + `compound_rate_default`; `backfill-freedmans-line-items.mjs:110` | `MACRO.RATES.lineItemCompound.value` (module is now the canonical declaration; DB rows mirror it) |
| Darity per-capita `$350,000` (= 14e12 / 40e6) | `DAAOrchestrator.js:107-108` (inline); `global_indicator_targets` row; `targets.mjs` | `MACRO.DARITY.percapita_demographic.value` |
| Darity total `$14T`, eligible `40M` | `targets.mjs`; `WealthGapCalculator` descendants `40000000` | `MACRO.DARITY.*`, `MACRO.WEALTH_GAP.estimated_slaveholder_descendants` |
| Brattle US per-capita `$450,000` | `DAAOrchestrator.js:110` (was a wrong `36e12/80e6` guess) | `MACRO.BRATTLE.us_percapita_usd.value` |
| SCF wealth-gap `$8.41T`: `983400`, `142500`, `840900`, `10M` households, `$210,250` base | `WealthGapCalculator.js:50-67` (all inline) | `MACRO.WEALTH_GAP.*` + `MACRO.deriveWealthGap()` |

**Single source created:** `src/services/reparations/macro-config.js` (CJS, canonical, cited).
`src/services/calibration/targets.mjs` (ESM) now re-exports from it via `createRequire`, so
`$14T` / `$36T` / `$350k` / `$8.41T` can no longer drift between the calibration layer and
the calculators. `macro-config.assertConsistentWithDb()` is a drift guard against
`global_indicator_targets` (use in a test/cron).

The **two Darity operationalizations** ($14T demographic per-capita vs $8.41T SCF mean-gap)
that were floating unreconciled are now **both carried, explicitly labelled as distinct
targets** (`DARITY.percapita_demographic` vs `WEALTH_GAP`), neither silently canonical.

---

## (2) Theory disagreement on a sample lineage — reconciliation doing real work

**Charles Baird** (canonical id 63252; 39 dated enslaved; ~64 est. living descendants):

| Predictor | Value |
|---|---|
| Craemer (labor-value) | **$30,789,108** |
| Wealth-gap (SCF share) | **$13,454,400** |
| Disgorgement (traced) | $0 (evidence: none) |
| Line-item sum | (absent — no resolvable line items for this lineage) |

- **OLD rule** `max(Craemer, wealth-gap)` → **$30,789,108** (Craemer wins by fiat).
- **NEW reconciled** → **$23,566,313**, `confidence 0.37`, `spread_ratio 0.784`,
  flag `partial_predictor_coverage`.

The new figure is a confidence-weighted central estimate of the two modeled predictors —
it neither lets the largest theory win (max) nor rubber-stamps (it reports the ~78%
disagreement as **low confidence**, the audit signal a single max() destroys).

**George Washington Biscoe** (id 140301): Craemer absent, wealth-gap $13.45M,
disgorgement **$5 (traced)** → reconciled $13.45M; the disgorgement *floor* mechanism is
wired (here trivially small) so the obligation can never fall below documented taking.

**Population level** (3-unit demo, control total $50M): stratified benchmark factor
**2.33×**, a consistency report (per-era / per-state mean vs Darity-band targets), and a
20-step **reconcile trajectory** that iteratively patches the witnessing reference class
(GA) toward coherence — the disagreement-region audit trail the design requires. Runner:
`ObligationReconciler.reconcilePopulation(units, {classes, controlTotal})`.

---

## (3) Values choices the build forced (made explicit, surfaced in metadata)

Every reconciliation result and every `enslaver_lineage_ledger.reconciliation_metadata`
row carries these three keys so they are reviewable, not buried:

1. **`damages_theory = 'unjust_enrichment_floor_with_wealthgap_reconciliation'`** — the
   traced disgorgement is a **hard floor** (owed ≥ documented taking); the headline is the
   confidence-weighted reconciliation of the three *modeled* predictors (Craemer,
   wealth-gap, line-item), floored at disgorgement. Deliberately not `max()` (lets the most
   aggressive theory win) and not plain mean (rubber-stamp). **This is a choice — review it.**
2. **`darity_operationalization = 'carry_both'`** — $14T demographic per-capita ($350k) and
   $8.41T SCF mean-gap ($210k) are both kept as distinct benchmark targets; benchmarking
   uses the per-descendant **band [267k, 800k]**, not a single point. **Which (if either)
   should be canonical is unresolved and left as a parameter.**
3. **`missing_data_policy = 'explicit_low_confidence'`** — absent predictors are dropped
   (not imputed to 0-as-fact); no-evidence predictors carry low confidence so they
   down-weight rather than anchor; WealthGapCalculator emits an `imputations[]` array
   (income×12 capitalization proxy @0.4 conf; neutral tilt @0.15 conf) instead of the old
   silent `20×`-income and `0.5`-default. **The capitalization factor (12) and the
   generational fan-out (2/gen) are documented proxies awaiting better data.**

**Untouched, by directive:** `TieredPaymentCalculator` placeholder brackets (voluntary
ability-to-pay instrument, no ground truth); the probate gate; and historical awards
(Belinda Sutton / DC $300 / Washington-Randolph bequests) — these are **never** an obligation
input. The only hook for them is `combine({ amountAlreadyTransferred })`, an offset *credit*
against the owed total, never the owed magnitude.

---

## Wealth-gap allocation fixes (step 4)

Removed from `WealthGapCalculator.calculateIndividualShare`: the `0.2`-per-ancestor step +
`3.0` cap (`slaveholderMultiplier`), the `0.1` tilt floor, the `20×`-income imputation, and
the `0.5` no-data default. Replaced with a mean-preserving wealth tilt around the SCF
per-descendant base, with all imputations flagged. **The `descendantShare = 1.0` default
(the 100%-to-everyone bug migration 040 was built to fix) is gone**: per-individual division
is deferred to the lineage ledger's `estimated_living_descendants` (from
`inheritance_summary_by_testator.heir_count` when available, else a flagged 2/gen fan-out),
and `daa_lineage_contributions.share_fraction` is now `1/estDescendants`, not `1.0`.

---

## Files

- `migrations/093-lineage-ledger-disgorgement-and-reconciliation.sql` (applied to live DB)
- `src/services/reparations/macro-config.js` (new — single source)
- `src/services/reparations/DisgorgementCalculator.js` (new — predictor 3)
- `src/services/reparations/ObligationReconciler.js` (new — combination layer)
- `src/services/reparations/DAAGenerator.js`, `WealthGapCalculator.js`,
  `DAAOrchestrator.js`, `src/services/calibration/targets.mjs` (wired to the above)

## Not done / follow-ups

- `wealth_transfer_events` → canonical enslaver linkage (all `debtor_entity_id` NULL): until
  populated, that $7.47M non-chattel pool contributes 0 and is flagged
  `wealth_transfer_events_unattributed`.
- A batch `reconcilePopulation` run over all 123K enslaver lineages (writes the whole ledger)
  is wired but not executed here — it is a population write best run deliberately.
- Disgorgement sums are nominal-USD at documented year; not yet compounded to present.
