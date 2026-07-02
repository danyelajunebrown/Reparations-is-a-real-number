# FINDING — NY probate exhaustive validity/consistency audit (Jul 1 2026)

_Read-only audit of the live NY probate scrape (FS collection 1920234) run from the MacBook
against Neon, independent of scrape progress. Tool: `scripts/audit-ny-probate-quality.js`
(committed, reusable; sibling of `audit-liberty-county-quality.js`). Full output:
`worksheets/ny-probate-audit-2026-07-01.txt`. Supersedes the Jun 17 partial-findings snapshot
in [[project_ny_probate_run]]. Scrape has grown 39k→**71,944 written** (1 failed) since then._

## Headline: acquisition is excellent, REFINEMENT/VALIDITY is where the debt sits
S3 archival 100% (0 unarchived), OCR 95.3%, 0 count/extraction mismatches, dedup blocking-key
coverage 99.3% on built testators. The enslavers that DO get built are built well (99%+ have
death_year + state + keys). The problems are all downstream of acquisition.

## NEW high-severity findings (not previously filed)

### 1. External-assertion GATE is effectively OPEN for NY probate (violates THE standard)
`standard-canonical-person-and-document-gate.md`: never externally assert someone was a
slaveowner/enslaved until a **proposition-specific** corroborating S3 document exists.
Reality on NY: **4,910 / 5,301** NY testators have `assertable_slaveowner=TRUE` **AND**
`assertable_enslaved=TRUE` (all 4,910 carry BOTH; 0 carry just one) — logically impossible
for one person. Only **9** of the 4,910 have ANY enslaved-person evidence (a doc with
`enslaved_count>0`). So `recomputeGate` is setting both booleans from **document-type
membership** (a will/probate page ∈ both prop-sets) rather than from proposition content.
Effect: a plain will with no enslaved persons makes the testator publicly assertable as a
slaveowner. The audit's own "assertable owners with NO S3 doc = 0 (gate sound)" is misleading
— the doc exists, but it doesn't prove the proposition. **This is the exact failure the gate
was built to prevent. Highest priority.** Fix: `recomputeGate` must require an enslaved-linked
proposition doc (enslaved_count>0 / will-naming-enslaved), not any probate page; and never set
`assertable_enslaved` on an enslaver testator.

### 2. Junk / non-person entities minted as assertable enslavers
Testator extraction minted place-words and legal boilerplate as `person_type='enslaver'`,
most `assertable_slaveowner=true`: **"Albany"×5, "New York"×3, "Cayuga", "Sole"×4 (from
"sole executor"), "Deceased"×5, "Late", "Estate"**. These pollute the enslaver class and,
via finding #1, are externally assertable. Root: the carry-forward testator parser accepts
county/city names + boilerplate as decedent names. Needs the `name_suspect` filter (already
computed in `probate_estate_index` — 2,015/7,898 ≈ 25% flagged) applied at mint time, Biscoe
rule intact (flag/quarantine, never auto-delete a real person).

### 3. #67 year-extraction is REGRESSING on live scrape (was reported "fixed")
The Jun-21 backfill fixed OLD docs, but NEWLY-scraped docs are getting worse, by created-week:
`31.8% → 29.6% → 74.7% (wk Jun 22) → 93.3% NULL (wk Jun 29)`. Overall NY `document_year` NULL
is **54.2%** (39,020/71,944). Not just untyped pages: **wills 43.9% NULL, inventories 89.8%
NULL**. Almost certainly the **running Mini scraper is the stale pre-#67 checkout** (memory:
"Mini repo still on stale main + untracked scp'd scripts") — the widened `/1[6-9]\d{2}/` regex
never deployed to the live process, so every new page NULLs its year. Gates the 1827 cutoff,
antebellum-first drip, and era assignment for the majority of new data. Also 18 docs > 1971
(max observed 1998) = OCR-noise years. **Fix: deploy the #67 scraper fix to the Mini + re-run
the backfill over all 72k.**

## Re-measured known issues (#68/#69/#70) — smaller than feared, still open
- **#69 post-1827 enslaved flags:** 218 docs flagged `enslaved_count>0` → 89 pre-abolition
  (plausible), **16 post-1827 (SUSPECT), 113 null-year**. ~129 need /review quarantine.
- **#68 index-page contamination:** of the 218, **7 match 20th-c surrogate/index tokens**
  (LETTERS ISSUED / FILE NUMBER / TAXABLE TRANSFER) and **18 (8.3%) have NO slavery token in
  OCR at all** — unsupported flags (e.g. doc 570868 y=1605 n=8 [INDEX], doc 570552 y=1926).
- **#70 name noise:** 293 enslaved leads on NY docs, only **1.4% junk** now ("Indian"×2,
  "Likewife", "On") — the flag-junk + stopword work helped. BUT **confidence is 100% uniform
  0.85** — enslaved leads are un-scored (every one gets 0.85 regardless of evidence). Recurring
  first-names Jack×14/Tom×8/Sam×5 are DISTINCT people (Biscoe: never auto-merge).

## Structural: 89% orphan rate + the person-lead PARITY deficiency (user's Jul-1 concern)
- **89.2%** of NY documents (64,278/72,039) link to NO person of any kind; only 10.8% link to
  a canonical. 6,502 written docs carry a testator_name that never became a person.
- **Parity check (user's wonder — CONFIRMED):** the ONLY roles built from NY probate are
  **enslaver** (5,301 canonical testators), **enslaved** (293 leads), and **heir** (3,558
  distinct, via `inheritance_edges` — better than expected). ZERO leads for witnesses,
  executors, administrators, appraisers, or **non-enslaving decedents**. DB-WIDE the bias is
  systemic: canonical_persons = **97.2% enslaver/enslaved/freedperson**, only 1.4% descendant;
  unconfirmed = **98.6%** enslaver/enslaved/freedperson, 0.1% descendant. Rigorous entity
  construction is reserved for perpetrator+victim classes; the connective free-person tissue
  (heirs who didn't own slaves, their lines, business counterparties, neighbors) that the
  **continuity-of-holding thesis depends on** is structurally under-built. This is not a NY
  bug — it's an architecture-wide selection bias. Ties to [[project_direction_identity_over_payment]]
  (tracing wealth FORWARD needs the non-slaveholding intermediaries) and the de-siloing arc.

## Forensic financial extraction has barely reached NY
`probate_estate_extractions` = **182 estates across 1 roll** of ~176 NY rolls ($119,738
appraised, 22 enslaved / 8 valued). `probate_estate_index` (the cheap deterministic spine) has
**7,898 NY rows** but **0** have a forensic extraction attached. The financial product — the
core deliverable — is ~absent for NY. Matches the Jun-21 note (drip only recently generalized
off Liberty-only). Blocked further by #67 (era prioritization inoperative while years are NULL).

## Recommended fix order (highest leverage first)
1. **Deploy #67 to the Mini + re-backfill years** (unblocks era gate, drip priority, valuation).
2. **Fix `recomputeGate`** proposition-specificity + stop setting `assertable_enslaved` on
   testators → re-run gate recompute (removes ~4,900 false external assertions).
3. **Apply `name_suspect` at testator mint** + sweep existing junk enslaver entities (Albany/
   Sole/Deceased/…) to a review quarantine (Biscoe rule).
4. **Quarantine the 16 post-1827 + 113 null-year enslaved flags** (#69) and the ~18 no-token
   flags (#68).
5. **Score enslaved-lead confidence** instead of a flat 0.85 (#70).
6. Point the forensic drip at NY rolls; build out non-enslaver person leads (parity) as a
   deliberate producer, not a byproduct.
