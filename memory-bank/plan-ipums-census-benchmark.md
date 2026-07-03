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

### 1830 — DONE (989 county-year rows), 1840 — DONE (1,276 rows)
Both intact-census years, strict >5% gate live. 1840 matched published to **−0.3%**
(2,480,265 vs 2,487,355 enslaved); 1830 clean, integrity 0-violation. `bucket_sums` fills
out (age/sex enslaved buckets present 1830/1840; 1790 was total-only). Top cell both years =
Charleston District SC (~61k enslaved). These are the solid core of the frame.

### 1820 — QUARANTINED (state-code corruption; NOT ingested) ⚠
The strict gate BLOCKED 1820 (enslaved −6.9%, pop −7.4% vs published). Investigation
(temp state-breakdown probe) found it is NOT simple coverage loss:
- **Genuine missing states** (known 1820 losses): AL, MO, NJ, AR all −100%. Expected.
- **State-attribution corruption:** **Virginia −84%** (66,825 vs published 425,153) while
  **stateicp=40 ("Tennessee") +403%** (402,837 vs 80,107 — TN never exceeded ~275k in its
  history). The two nearly offset (~358k missing from VA ≈ ~322k excess in st40). County
  probe confirmed: st40 holds **81 counties** (TN had ~40) and VA-scale enslaved, while st54
  holds only 48 counties. **Virginia's 1820 households bled into stateicp=40.** Every other
  state matches published closely (MD 0%, SC −2%, KY −1%, GA −8%).
- **Why it matters / why quarantined:** the benchmark's entire value is the county×year
  GEOGRAPHIC stratification for reference-class calibration (#90). A ~93%-correct national
  total with scrambled VA/TN strata is worse than useless here — it would silently corrupt the
  reference classes. National-total-fine ≠ safe when the product IS the stratification.
- **To un-quarantine (follow-up, not done):** (a) check IPUMS's documented 1820 known-issues
  (the download page flagged "Known issues… are documented") — may be a documented STATEICP
  defect + a corrected extract; (b) re-pull 1820 and diff STATEICP against a second geo
  variable; (c) if only STATEICP is wrong, remap the VA-coded counties under st40 back to
  st54 by county-code identification (forensic; risky). Until one of these, 1820 stays OUT.

### 1800 / 1810 — PENDING (download remaining CSVs)
Same script. Given 1820's anomaly, **eyeball the state-level breakdown before applying** —
don't trust a passing national total alone. 1800/1810 are total-only (like 1790, no age/sex
enslaved buckets). The 1820 lesson: the strict national gate is necessary but not sufficient;
per-state sanity is the real check for the stratification's integrity.

## See also
[[project_calibration_first_architecture]] · [[finding-census-namematch-falsepositives-jun30]] ·
[[assessment-climb-architecture-gap-jun30]] · [[plan-climb-as-gated-lead-source]] ·
`migrations/090-secondary-source-compilations.sql` · `standard-canonical-person-and-document-gate.md`
