# PLAN — Issue #63: enslaved owner-anchored cross-source dedup (Phase B)

_Prerequisite met Jul 1: `unconfirmed_persons` lead keying 0.13%→99.9% (backfill-unconfirmed-blocking-keys).
Gold-validation build: `scripts/resolve-enslaved-cross-source.mjs` (report-only), commit bf4fb41dc._

## What was built + validated (gold/report mode)
Owner-anchored resolver per the #63 design: block on **owner-surname + state + county** (deriveSurnames on
the OWNER, since the enslaved are first-name-only); **census mutual-exclusion** (same-source pair = same
schedule = provably distinct, Biscoe #2) applied before scoring; cross-source scoring on given-name (JW) +
age (±) + gender. Report-only — NO storage yet (needs a pairs table; see below).

## DECISIVE FINDING (gold validation — reshapes the approach)
1. **YEAR must be excluded from the block.** Owner+state+county+**year** → 0 cross-source blocks;
   owner+state+county → **399 blocks / 3,291 leads**. Cause: `pre_indexed` and `census_ocr_extraction`
   populate `year` inconsistently (both are the 1860 census, but different pipelines).
2. **The real overlap is `pre_indexed` ↔ `census_ocr_extraction`** — two pipelines ingesting the SAME 1860
   census. That IS genuine duplication worth removing.
3. **BUT the enslaved are mostly UNNAMED** (`"Unknown (Male, age 13)"`). Individual cross-source pairing
   then rests on age+gender alone → low precision (several same-age/gender people per owner-block). The
   gold run (Mallary P King, 76 leads) produced ONE weak pair (`Unknown male 13 ⇄ Unknown male 14`,
   score 4) and dropped 74. Scaling this naively would flood `/review` with unreviewable age+gender pairs.
   This is the Biscoe rule biting hard: you cannot identity-resolve unnamed people one-to-one.

## REFINED APPROACH (the split — do NOT scale the naive individual-pairer)
- **(A) Census-pipeline dedup by MULTISET reconciliation, not individual pairing.** For an owner-block
  where `pre_indexed` and `census_ocr_extraction` overlap, reconcile at the (age,gender) multiset /
  count level: "owner King has ~38 enslaved in each pipeline → the same 38, one pipeline is a duplicate
  ingest." Resolve the DUPLICATION at the block level (mark one pipeline's rows as dup-of-block) rather
  than asserting person-A = person-B. This is the honest, high-value win over the ~3,291 (likely more at
  full scale) overlapping leads.
- **(B) NAMED cross-source pairing** (schedule/Louisiana/CivilWarDC ↔ **probate inventories** that carry
  given names): where BOTH sides have a real given name, the existing scorer (given-name + age + gender
  + owner-block) is high-precision → route to review. Smaller, precise set. Keep the built resolver for this.
- **(C) Owner anchor → canonical enslaver** (#63 design step 4): block on the RESOLVED enslaver identity
  (via Phase A `cross_source_candidates`) instead of the raw owner string, to avoid common-owner-name
  ("John Smith") conflation across distinct enslavers.

## Storage decision (needed before persistence)
Neither existing table fits lead↔lead pairs: `dedup_candidate_pairs` is `person_a_id/person_b_id` INTEGER
(canonical-only, no table qualifier → id collision); `cross_source_candidates` is lead→canonical. →
**New migration: a polymorphic pairs table** `enslaved_candidate_pairs (a_table,a_id,b_table,b_id,score,
route,exclude_reason,evidence,status,...)`, OR a block-level `census_pipeline_dup_blocks` table for
approach (A). Decide when building persistence.

## Next steps (recommended order)
1. Build (A) census-pipeline multiset reconciliation — the real duplication win; block-level, no unnamed
   one-to-one claims.
2. Build (B) named-pairing persistence (new pairs table) + route to a `/review` queue; run gold → scale.
3. (C) re-anchor blocking on resolved enslaver identity.
4. Meanwhile: the lead keying already de-dupes FUTURE inflows via PersonService.resolve (realized now).

## Guardrails (unchanged)
Never auto-merge first-name-only enslaved (Biscoe); validate on a gold owner before scale; log deferred
clusters; no silent truncation.
