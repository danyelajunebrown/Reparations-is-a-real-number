# Entity Resolution for Historical Genealogical Records — Methodology Survey

_Deep-research synthesis, June 12 2026 (106 agents, 24 sources, 24/25 claims adversarially verified). Informs the scored person-disambiguation resolver. Companion to the Biscoe hand-resolution gold template._

## Verified findings (with sources)

1. **Genealogical Proof Standard (GPS) = the human-facing evidentiary frame.** Five components (exhaustive search, complete citations, analysis/correlation, conflict resolution, soundly-reasoned conclusion) map onto pipeline stages: source-coverage tracking → provenance metadata → similarity scoring → conflict-resolution logic → explainable score. Proof rests on the **cumulative sum of multi-source evidence** (never a single record); "reasonably exhaustive" is bounded by the research question (a stopping rule), and conclusions are **valid-but-revisable**. [BCG, FamilySearch Wiki]

2. **Fellegi–Sunter (FS) = the computational scoring core.** Score each candidate pair by matching weight **W(γ) = Σ log(m_i/u_i)** (log-likelihood ratio of the agreement pattern under match vs non-match). Two thresholds → three-way decision: **link** (W>T_high), **possible link / human review** (T_low<W≤T_high), **non-link** (W≤T_low); thresholds correspond to the two controlled error rates. [Binette & Steorts, Science Advances 2022]

3. **Production tools scale to our 1.68M records.** **Splink** implements FS with **unsupervised EM (no labeled data)** — u via random sampling, m via EM — links ~1M records in ~1 min on a laptop (DuckDB), 100M+ via Spark. **dedupe** is the supervised alternative (regularized logistic regression). Splink is the recommended core given our scale + lack of labels. [Splink GitHub, IJPDS 1794, dedupe docs]

4. **Blocking is mandatory and data-driven.** All-pairs is infeasible (1,000 recs → 499,500 pairs). Use predicate / post-hoc blocking (no labels needed) on birthplace+sex+phonetic-surname-code. [dedupe docs, McVeigh-Spahn-Murray 2019]

5. **Name handling: separate blocking from matching — this is the load-bearing rule.** Phonetic codes (Soundex/NYSIIS/Metaphone) for **BLOCKING ONLY** — relying on them for final matching yields **20–70% false-match rates** (NYSIIS treats John/James as identical). Use **Jaro–Winkler** string similarity for SCORING (Census Bureau, optimized for names; Winkler boost rewards agreeing beginnings). This is how Biscoe/Briscoe and A.M./Ann Maria are handled — graded similarity, not exact/phonetic equality. No single best algorithm; select per-field. [IPUMS WP2017-03, Christen ANU TR-CS-06-02]

6. **Hard constraints + over-merge defenses.** (a) **One-to-one via blocking BEFORE thresholding** (Jaro 1989) — encodes "two records in the same census enumeration can't be the same person." (b) Row/column-sum ≤1 regularization. (c) **Anti-transitivity**: never chain A~B,B~C ⇒ A~C; use hierarchical clustering with **centroid linkage** (pairwise probabilities are non-transitive). (d) **The single strongest false-match control (IPUMS): discard / route any record with >1 potential match** — never pick a "best match" (tie-breaking → 52–70% false rate). (e) **"Name commonness" as an explicit feature** — the encoded defense against over-merging shared names like "Ann Biscoe." [Binette & Steorts, McVeigh et al., dedupe, IPUMS]

7. **IPUMS = the transferable historical-linkage template.** Jaro-Winkler + SVM trained on hand-linked data; features = first/last-name spelling, initials, phonetic codes, **name commonness**, age; block on birthplace+sex. [IPUMS WP2017-03]

## Honest gaps the research flagged (where we extend beyond published work)
- **Kinship as PRIMARY evidence** (our decisive Biscoe signal): the literature has collective/relational ER (Bhattacharya-Getoor) but **no validated scoring weights** for using parent/spouse/child edges as the primary disambiguator, especially for first-name-only enslaved records. We pioneer here, justified by the Biscoe evidence.
- **Holding-trajectory / inheritance-event plausibility** (9-in-1860 → 47-in-1862 via a husband's death): literature covers one-to-one + transitivity constraints but **not** estate-transfer/life-event modeling. Our extension.
- **No project-specific Enslaved.org / Freedmen's Bureau / "Linking Lives" methodology survived verification** — targeted follow-up research needed.
- FS's conditional-independence assumption is a known weakness (don't assume it's harmless) — favor post-hoc one-to-one constraints / term-dependency awareness.

## Proposed resolver architecture (synthesis → our 5 rules)
A 4-stage probabilistic pipeline, **Splink-based**, extended with our rules:
1. **Block** (data-driven, no labels): phonetic surname code + state/birthplace + sex.
2. **Score** (FS, W=Σlog(m/u)): Jaro-Winkler given+surname · name-commonness down-weight · birth/death-year proximity (the 1799-vs-1844 separator) · place agreement w/ Georgetown⊂Washington⊂DC hierarchy · **kinship corroboration (very high weight — our primary)** · holding-trajectory soft penalty.
3. **Constrain (hard)**: census mutual-exclusion (one-to-one via blocking, Jaro 1989); within-source one-to-one.
4. **Decide + cluster**: two thresholds → auto-link / **review queue** (MatchVerifier) / separate; **route multi-match records to review** (IPUMS); centroid-linkage clustering (non-transitive).

**Rule validation:** census mutual-exclusion ✓ (Jaro 1989), relationship-graph completeness ✓ (collective ER + GPS), dual-side dedup ✓ (general ER). Parentage-primary + holding-trajectory = our extensions, calibrated against the hand-resolved Biscoe gold set (+ more as we resolve them).
