# PLAN — IPUMS 1790–1840 complete-count census as a BENCHMARK layer (not lead-table fuel) — Jul 2 2026

_User instinct (Jul 2): "now that we have a lead table I wonder if we can more voraciously
intake census data… won't mint canonicals until we get the documents… but having that
structured data already inside would solidify the future scrape." Correct instinct; the
specific dataset routes to a different door than the lead table. Decision: **both tracks,
benchmark first.**_

## The decisive fact about this dataset
The IPUMS USA **1790–1840 household complete-count** files are **household-level AGGREGATE
TALLIES**, not individual records. The variable list is `SERIAL + COUNTYICP/CITY/CITYPOP`
plus count buckets (`NSM10` = male slaves 10–23, `NWMLT5` = white males under 5, `NSLAVE`
= total slaves in household, `NTOTAL`, …). **There is no `NAMEFRST`/`NAMELAST` in the
household file.** Two consequences bind hard:

1. **No enslaved persons are named** — the census never named them pre-1850 (nor on the
   1850/1860 slave schedules; only tallied under the owner). Materializing "5 male slaves
   under 10 in household #4471" as person rows is exactly the **"No 'Unnamed enslaved
   person(s)' placeholder rows"** violation (CLAUDE.md audit rule 5, "real or absent").
2. **The slaveholder isn't named in THIS file either.** The head-of-household name is a
   **restricted IPUMS variable** (separate names-use agreement) = the CLAUDE.md
   "Aspirational (do not pre-build): *IPUMS Census slaveholder names — request pending with
   ipumsres@umn.edu*." That is Track B, not this download.

So piping the household file into `unconfirmed_persons` would produce nameless or fabricated
rows. It does **not** enter the lead table. Its correct home is a **benchmark/denominator
reference layer** — aggregate, so identity resolution / dedup / the person gate never apply
(a different door entirely from `findOrCreateLead`).

## Why this is an ACTIVE need, not a side quest
- **Calibration #90 (scoped-benchmark)** is the NEXT item in
  [[project_calibration_first_architecture]] — the Deville–Särndal/SAE benchmarking layer
  wants control totals. County×year enslaved/free counts ARE those control totals.
- **The person-lead parity deficiency** (activeContext, Jul 1 NY-probate audit: "97%+ of
  persons are perpetrator/victim classes, connective tissue under-built") gets a *measure*:
  documented persons vs. census population per county-year → an honest coverage metric
  instead of a guess.
- **Scrape prioritization** — holding density tells the Mini where the named 1850/1860
  schedules + population-schedule images are densest. This is the user's "solidify the
  future scrape" instinct, delivered without fabricating persons.

## TRACK A — Benchmark ingest (BUILD FIRST; no restricted access needed)

### Landing
A new benchmark table (proposed `census_holding_benchmarks`), keyed **`year × countyicp`
(+ optional `city`)**, storing the aggregate buckets we care about:
- enslaved: per-sex age-bucket counts + `nslave` total (the reparations-relevant core)
- free black / white / other-free totals (population context / denominator)
- `numperhh`, `ntotal`, household count per county-year
- provenance: `secondary_source_compilation_id` FK → an IPUMS row in
  `secondary_source_compilations` (M090), `max_evidence_tier='secondary'`, IPUMS citation
  (YEAR + COUNTYICP + IPUMS-USA extract id).

### Rules it obeys
- **No person rows. Ever.** Aggregate only. Not `unconfirmed_persons`, not `canonical_persons`.
- **No summing model output** (audit rule 1) — this is deterministic ETL over published
  government-aggregate data; every stored number traces to a `(year, countyicp)` cell in a
  cited IPUMS extract. Fine.
- **Secondary-tier ceiling** (0.85–0.94 band): IPUMS is a scholarly transcription/
  aggregation of the census, not the primary image. The primary doc is the NARA microfilm /
  FamilySearch population-schedule image — located later, per county, by the scrape this
  benchmark prioritizes.
- **No dedup / identity / gate** — those doors are for persons; aggregates skip them.

### Consumers
1. Calibration #90 control totals.
2. A coverage metric: `documented_enslaved(county,year) / census_nslave(county,year)`.
3. Scrape targeting: rank un-scraped county-years by `nslave` density.

### Data dependency (BLOCKER for the ingest step only)
The 1790–1840 household CSVs must be **downloaded** (freely, after IPUMS registration —
distinct from the restricted names). Either the combined **"1790-1840 Household .csv"** or
the per-year files. Drop locally OUTSIDE the repo (it's large; and IPUMS terms bar
redistribution — see Licensing). The ingest script reads from there. **The schema/migration
+ this plan can be built now; the load waits on the file.**

## TRACK B — Named-head extract → enslaver LEADS (DESIGN NOW, build later)

Gated behind the pending `ipumsres@umn.edu` names access. When it lands:
- Named heads of slaveholding households → **enslaver leads** via
  `PersonService.findOrCreateLead({... sourceType:'ipums_census_names', externalId, ...})` —
  the ONE door (activeContext Jul 1: all 7 bypass writers now routed through it). Resolve-
  first (link, don't duplicate), write blocking keys, **never a canonical**.
- Register the source under M090; leads carry `secondary_source_compilation_id`.
- **Assert only by resolved identity** — the [[finding-census-namematch-falsepositives-jun30]]
  rule binds absolutely: census→person links assert on identity resolution
  (`find_person_match`/`person_blocking_keys`), **never name string**. (33,791 name-only
  census links, 0 human-verified, Elizabeth-Parker-dead-in-1793-in-an-1860-schedule.)
- The household-size tally becomes a **holding-size attribute** on that enslaver lead (the
  Biscoe rule: "holding-size is a trajectory") — evidence attached to a lead, not persons.
- **Still ZERO enslaved-person leads** — never named. Pre-1850 census cannot yield them.

Track B is one more `findOrCreateLead` consumer — do NOT fork a parallel intake path (same
lesson as the climb-as-second-door reckoning, [[assessment-climb-architecture-gap-jun30]]).

## Licensing (both tracks)
IPUMS prohibits redistributing microdata; **names carry an additional agreement**. A private
research DB is permitted; exposing individual-level extracts on the public GitHub Pages /
search / API would breach it. Aggregate benchmark counts (Track A) are far safer to surface
than any named extract (Track B). Keep raw CSVs out of the repo (now gitignored pattern-wise
via the worksheets/scratch cleanup, but add an explicit ignore for the IPUMS drop dir).

## Sequencing / dependencies
- **Track A** has NO dependency on the de-siloing program — it's a separate aggregate door.
  Buildable immediately: migration (benchmark table + M090 IPUMS source row) → ingest script
  (dry-run row/county counts → apply) → coverage-metric + #90 wiring.
- **Track B** rides the already-built `findOrCreateLead` door + M090 registry; blocks only on
  IPUMS names access. Assertion discipline inherited from the census-namematch finding.

## Open decisions to surface
1. Benchmark table name/grain: `census_holding_benchmarks` keyed `(year, countyicp, city)`?
   Store all age buckets, or collapse to enslaved-by-sex + totals + free-context totals?
2. COUNTYICP → our geography: do we map ICPSR county codes to `primary_county`/state now, or
   store ICPSR verbatim + map at query time? (ICPSR crosswalk is a known artifact.)
3. Where does the IPUMS CSV drop live locally, and which file (combined vs per-year)?
4. Track B: wait for `ipumsres` access, or is the household file sufficient for the
   benchmark and Track B stays purely aspirational per CLAUDE.md until access lands?

## INGEST LOG

### 1790 — DONE (Jul 2 2026), M113 applied
`migrations/113-census-holding-benchmarks.sql` (table + IPUMS source row in M090) applied &
tracked. `scripts/ingest-ipums-census-benchmark.mjs` aggregated `H_1790.csv` (419,627
households) → **292 county-year rows** upserted to `census_holding_benchmarks`. Result:
**300,402 enslaved, 43,710 slaveholding households (10.4%), Σpop 2,639,562.** Top county =
Charleston District SC (st48/co190, 60,307 enslaved, max single holding 695) — historically
exact. All 292 rows carry the provenance FK.

**Validation design (learned the hard way):** the first dry-run's national control total
(300k vs published 697,681, −57%) looked like an ETL bug but is **genuine census loss** — the
1790 schedules for **VA (~293k enslaved), GA, KY, DE, NJ, TN were destroyed** (War of 1812 /
courthouse fires); IPUMS complete-count 1790 holds only surviving schedules (167 substantive
+ 125 fragmentary <100-hh county-years). So the script now gates on the TRUE ETL invariant
(`pop_total == free_total + enslaved_total`, 0/292 violations) and treats the national-total
comparison as INFORMATIONAL for 1790, STRICT (>5% blocks) only for 1800–1840 (intact census).

**⚠ Audit-critical downstream caveat:** the coverage metric
(`documented / enslaved_total`) **must not treat a missing 1790 denominator as OUR gap.**
There is no 1790 VA/GA/KY denominator because the census itself is gone — VA coverage starts
1800. Consumers must read `household_count` (fragmentary <100 = lost/partial schedule), not
assume every state×1790 exists. This is exactly the benchmark earning its keep: it records
what the census actually holds, so absence-of-source is attributed correctly.

### ⚠⚠ MAJOR FINDING — `stateicp` is UNUSABLE for 1810–1840; 1830/1840 ROLLED BACK
The pre-built "complete-count household" CSVs carry a `stateicp` column that **IPUMS's own
availability table marks as NOT available for any year.** Empirically it is corrupt from 1810
on: **Virginia (the largest slave state) systematically bleeds into stateicp=40 ("Tennessee")**
across 1810/1820/1830/1840. Verified in the applied DB rows:
| Year | VA (st54) ours / published | st40 "TN" ours / published |
|------|---------------------------|----------------------------|
| 1830 | 139,604 / 469,757 (−70%)  | 445,995 / 141,603 (+215%)  |
| 1840 | 182,782 / 449,087 (−59%)  | 430,586 / 183,059 (+135%)  |
| 1810 | 2,803 / 392,518 (−99%)    | 302,313 / 44,535 (+579%)   |
Other states match published closely (SC/MD/KY/GA within a few %), so the ICPSR scheme is
right — it is specifically the VA labeling that is broken, and it is NOT a clean VA↔TN swap
(relabeling doesn't reconcile either side), so it can't be remapped without the county codebook.

**Why this was nearly missed (the trap):** a VA↔TN mislabel CONSERVES the national total, so
1840's −0.3% national "match" looked perfect while the strata were 60–200% wrong. The strict
national-total gate is **necessary but not sufficient** — per-state sanity is the real check,
and the benchmark's entire purpose is the geographic stratification (#90 reference classes),
so wrong strata = the exact poison to avoid.

**Actions taken:** 1830 (989) + 1840 (1,276) were applied before the state-check and are now
**ROLLED BACK** (2,265 rows DELETEd — corrupt denominators are worse than absent ones). 1820
and 1810 were blocked by the gate and never applied. **1790 (292 rows) STANDS** — verified
uncorrupted (st40/st54 both 0 enslaved; its VA is destroyed-schedule empty, present states
match published). It is the ONLY trustworthy year right now, and it is total-only.

**The pipeline itself is sound — it CAUGHT this.** Schema (M113), ingest, integrity gate, and
state-sanity probe all work; the fault is the SOURCE geography variable. Cost was low: rolled
back cleanly, nothing downstream consumed the corrupt rows.

### PATH FORWARD (geography must be fixed before re-ingesting 1810–1840)
1. **Re-pull via the IPUMS extract builder** selecting a VALIDATED geography — `STATEFIP`
   (FIPS, certified) + `COUNTYICP` with the codebook — instead of these pre-built household
   CSVs whose `stateicp` is uncertified. Preferred fix.
2. OR obtain the ICPSR county→state crosswalk/codebook and remap the VA-coded st40 counties
   (forensic; only if a re-pull isn't possible).
3. Re-ingest 1810–1840 keyed on the validated state var; **run the state-sanity probe as a
   MANDATORY pre-apply gate** (fold VA/TN + a few control states into the script itself).
4. 1800 CSV: do NOT apply on a national-total pass alone — same state-check first.

**Script hardening TODO:** add the per-state control-total check (VA/TN/SC/MD vs published)
INTO `ingest-ipums-census-benchmark.mjs` as a blocking pre-apply gate, so "national total OK"
can never again wave through scrambled strata.

## See also
[[project_calibration_first_architecture]] · [[finding-census-namematch-falsepositives-jun30]] ·
[[assessment-climb-architecture-gap-jun30]] · [[plan-climb-as-gated-lead-source]] ·
`migrations/090-secondary-source-compilations.sql` · `standard-canonical-person-and-document-gate.md`
