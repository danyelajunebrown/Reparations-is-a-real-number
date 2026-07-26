# PLAN — Dutchess calibration, Stage 1 (enslaver-anchored f) — Jul 19 2026

_Design step after the viability probe ([[assessment-dutchess-calibration-case-study-jul19]]). User
decision (2026-07-19): **re-scope f to the enslaver-anchored edge** (the maternal micro-link is too
sparse in the surviving records — §6.4). This plan concretizes Tasks 3–5 of the calibration prompt
around the edge the records DO support. NOTHING here is applied — schema is PROPOSED (DDL below),
pending the user's go. Related: Roth & Tolbert 2025 (multicalibration + Reconcile)._

## Why re-scoped (one line)
The child→mother edge is sparse in BOTH civil registrations and church baptisms (§6.4); the
enslaved↔ENSLAVER edge is DENSE (1714/1755 census + wills + NESRI roster + owner-named registrations +
owner-named baptisms all converge on the same families). Calibrate on the dense edge.

## 1. The model `f` (re-defined)
**`f(X, E | e) = P( person X descends from a documented enslaved person held by enslaver E | evidence e )`**
— a per-CHAIN-to-enslaver posterior in [0,1], NOT a dollar figure, NOT the child→mother micro-link.
- The unit of calibration is the **(modern person X, enslaver E) attribution**, decomposed as the
  product of per-link posteriors along the traced chain, terminating at "enslaved by E" rather than at
  a named mother. This is exactly the quantity `ancestor_climb_matches.match_confidence` already tries
  to be (modern person → slaveholder), so the climb's output is the natural `f` — but currently
  asserted, never calibrated (that is the whole point).
- Binding quantity remains whole-chain `p^n`; we calibrate **per-link p**, because 1800→2026 is 7–9
  links and at p=0.90 an 8-link chain is 43% correct (prompt's math). Stage 1's job = a first honest p.

## 2. Ground truth `F(e)` + storage (PROPOSED schema — migration 126, NOT applied)
The audit packet prints verdicts on paper and never writes them back (assessment §1); there is no
verdict table. Propose:
```sql
-- migration 126 (PROPOSED — do not apply without sign-off)
CREATE TABLE IF NOT EXISTS linkage_verdicts (
  id                 SERIAL PRIMARY KEY,
  -- the asserted edge under test (polymorphic; a climb match, an owner-edge, or a person-pair)
  subject_kind       TEXT NOT NULL,          -- 'climb_match' | 'owner_edge' | 'parent_link' | 'attribution'
  subject_ref        TEXT NOT NULL,          -- e.g. ancestor_climb_matches.id, or 'lead:123->lead:456'
  modern_person_ref  TEXT,                   -- the living/modern endpoint (fs id / lead)
  enslaver_ref       TEXT,                   -- the enslaver endpoint (canonical/lead)
  enslaved_ref       TEXT,                   -- the documented enslaved person (lead), when known
  -- the verdict
  verdict            TEXT NOT NULL,          -- 'confirmed' | 'refuted' | 'uncertain'
  basis              TEXT NOT NULL,          -- 'document' | 'participant' | 'researcher'
  evidence_doc_id    INTEGER,                -- person_documents.id backing a documentary verdict
  evidence_note      TEXT,
  -- calibration bookkeeping
  model_confidence   NUMERIC,                -- f(X,E) at verdict time (to bin predicted-vs-actual)
  model_version      TEXT,
  reference_class    TEXT,                   -- town|decade|holding_size bucket (§4)
  verified_by        TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
```
`F(e)` sources, in order of density: (a) **documentary** — an owner-named baptism + owner-named
registration + will/census agreeing on the same enslaved person under the same enslaver (the dense
enslaver-edge corroboration); (b) **participant** — the climb-audit packet, verdicts finally written
HERE not just printed; (c) **researcher**. Every verdict stores `model_confidence` so predicted-vs-actual
bins are computable (that IS the calibration measurement).

## 3. Second model `f₂` for Reconcile
Reconcile needs two models that can genuinely DISAGREE. Evaluated (assessment §3):
- **REJECT** two climber thresholds — same engine, correlated errors.
- **USE** independent tree sources: **FamilySearch-climb `f`** vs **WikiTree-derived `f₂`**
  (`scripts/wikitree-descendant-scraper.js` already builds enslaver→descendant trees, independent of
  FS). For the enslaver-anchored `f` both must be run to the SAME endpoint (enslaved-person-of-E);
  WikiTree runs enslaver→descendant forward, the FS climb runs modern→enslaver backward — they MEET at
  the enslaver E. Agreement on "X attributable to E" from two independent tree corpora is the
  Reconcile signal. Cheapest viable f₂.

## 4. Reference classes + the ε/2 mass floor (HONEST numbers)
Candidate strata: **town × decade × holding-size** (holdings were 1–5 people — a real discriminator in
Dutchess). Population we actually hold (measured, Jul 19):
- Dutchess owner→enslaved edges: **84** (37 enslavers, 62 named enslaved, 1755) + 14 enslavers (1714,
  counts) + ~26 named enslaved from the wills → **~85–90 documented enslaved "descent seeds."**
- Forward-traced to living descendants, the calibration sample is (X, E) pairs seeded by these ~85.
**Reality check:** the prompt's sample requirement is ~34,000 at E≤0.1; the ε/2 = 2.5% mass floor at
ε=0.05 means no certifiable class below ~2.5% of the sample. At n ~ 10²–10³ (county scale), **certified
multicalibration is OUT OF REACH**, and town×decade×holding-size strata will mostly fail the mass
floor. What Dutchess CAN deliver: an honest **per-link p** and squared-error E on a NEAR-COMPLETE
documented population — which is the Stage-1 prerequisite the prompt says gates everything downstream.
Do not oversell it as "calibrated"; it is "population-level p/E on one county."

## 5. Staged plan (real numbers; Stage 1 = first honest p — the gate)
**Stage 0 (done):** enslaver-side Dutchess corpus in DB — 1714/1755 census (84 edges, 62+ named
enslaved), ~1,225 imaged wills, NESRI roster + census denominators (1790: 1,864 enslaved). RAG live.

**Stage 1 — FIRST READ ON p. Effort ~1–2 wk. n(links) ≈ 40–90.**
1. Apply migration 126 (`linkage_verdicts`) — on sign-off.
2. For the ~85 named enslaved seeds, assemble the DENSE enslaver-edge documentary verdicts: match each
   across census × will × NESRI × (owner-named) registration → `confirmed` attribution verdicts
   (enslaved person ↔ enslaver). This is documentary `F(e)` on the ATTRIBUTION link, available NOW.
3. Run the climb `f` for a handful of Dutchess-seeded lineages (needs FS climb on Dutchess — 0 today);
   score each asserted link's `model_confidence` and bin vs the verdicts.
4. **Deliverable: first empirical per-link p on the enslaver-attribution edge.** If p < ~0.99, STOP —
   fix the linker/thresholds (OwnerPromotion promotes at 0.80; assessment §4) before scaling.

**Stage 2 — second model + E. Effort ~2–4 wk. n ≈ 100–300.** Run WikiTree `f₂` over the same seeds;
record both f and f₂ per link; compute E + the Reconcile disagreement region.

**Stage 3 — county extension IF p ≥ ~0.99.** All 12 towns; population 10²–10³. Honest county-level
p/E; NOT certified multicalibration (below the floors).

## 6. What sample size cannot fix (carried from assessment §4 — still binding)
- `1.0/numLivingDescendants` share dilution (`WealthGapCalculator.js:136`, `DAAOrchestrator.js:1982`)
  — recall bias, ~ (1/r)^g inflation; enslaver-anchoring does NOT fix it (still needs complete
  descendant sets).
- `MIN_VISITED=3` self-selection (`generate-climb-accuracy-audit.mjs:33`) — Dutchess's documentary,
  population-based frame MITIGATES this (a real argument for the county approach).
- Free parameters in `Calculator.js` (0.035 / 120 / 15000 / 0.04) — confirm live-vs-legacy first;
  they move dollars, not `f`. Keep `f` probabilistic and separate from the dollar calc.

## Open items before building (unchanged + new)
1. Confirm `Calculator.js` is live vs legacy on the DAA path.
2. Migration 126 `linkage_verdicts` — sign-off to apply.
3. Dutchess FS climb has 0 coverage — Stage-1 step 3 needs the FS climb pointed at Dutchess seeds
   (FS-logged-in :9222 Chrome; scrapers approved).
4. The maternal micro-link stays a sparse, separately-scored layer (from DRC baptism image extraction),
   NEVER the calibration backbone.
