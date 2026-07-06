# ASSESSMENT — MacGregor *Commercial Statistics* Vol. IV as a Cuba source + Cuba benchmark scope (Jul 3 2026)

_User dropped 1,062 OCR'd HathiTrust pages (`hvd-hb35mk-1783039781`) asking how much rich
detail it holds on Cuba during slavery — "not just population/data/slavery but wealth, trade,
assets, and extraction as colonialism as operationalized in our architecture." Assessed via a
6-subagent fan-out over the full page range. Framed against [[interpretive-framework]] (financial
instruments as the economic machinery; imperial systems), [[wealth-tracing-framework]]
(`region_type='caribbean_colony'`), and the Session-61 extraction-as-colonialism schema
(chartered_companies / entity_successions / wealth_transfer_events / harm categories)._

## PART A — Source evaluation

**Identity:** John MacGregor, M.P., *Commercial Statistics: A Digest of the Productive Resources,
Commercial Legislation, Customs Tariffs, Navigation, Port, and Quarantine Laws… of All Nations*,
2nd ed., **Vol. IV of 5**, London: Whittaker & Co., 1850. English. Ex-Harvard (Baker/Google digitization),
public domain. NOT a Cuba monograph — a macro commercial/customs digest of all nations.

**Cuba footprint:** ~50 pages only (Section XVIII "Hayti and Foreign West Indies", files ~37–88).
Front third = Hayti/PR/French-Dutch-Danish WI + Brazil; **back two-thirds (files ~331–1062) = British
East Indies / "Oriental Commerce"** — zero Cuba. All 6 agents concur on the split.

**Two-sided verdict:**
- **Person-genealogy layer: ~ZERO.** No named enslavers, no named enslaved, no named estates, no
  individual transactions anywhere in 1,062 pages. Cannot mint a single `canonical_person`. Only names
  are colonial officials (Capt-gen Vives, Conde de Villanueva, statistician **Ramón de la Sagra**,
  British commissioner **David Turnbull**). Skip for the identity/continuity spine.
- **Macro wealth / benchmark / extraction layer: GENUINELY VALUABLE.** It is a cited, colony-scale
  balance sheet of the Cuban slave economy c.1830–1841.

**Key extractable figures (Cuba section, from la Sagra's official returns as digested by MacGregor):**
- **Enslaved population (control totals):** total **436,495** (1841; 275,382 M + 150,139 F "negroes" +
  ~11k coloured), by Western/Central/Eastern department. By sector (1840): **138,701** on 1,238 sugar
  estates; **114,760** on 1,838 coffee plantations; **393,993** on 42,549 farms. Town-level counts too.
- **Capitalized value of the enslaved (the dual-ledger standout, 1830):** 138,982 enslaved × **$300 =
  $41,694,600**, embedded in **total Cuban capital $507,088,002** (£101.6M): Lands $94.4M · Plants
  $276.8M · Buildings/engines $54.6M · **Slaves $41.7M** · Animals $39.6M.
- **Production/output:** sugar **8,091,837 arrobas**, coffee **2,883,528 arrobas**; gross produce
  **$43.65M**, net rent **$22.8M**; cigar exports 197,194 lb (1826) → 792,438 lb (1837).
- **Land:** by caballería (=32 acres): 15,300 cab. sugar @ $1,500, coffee @ $1,500, etc. Aggregate, **no
  named estates**.
- **Trade/customs:** Cuba's commerce with all nations 1826–1842 (imports/exports by country), customs
  duties & regulations — the extraction-as-colonialism apparatus (where slave-wealth flowed + Spanish
  colonial fiscal machinery).

**Provenance:** MacGregor is SECONDARY (a digest) → cites PRIMARY: la Sagra's official returns
(*Historia económico-política y estadística de la isla de Cuba*) and the **Cuban colonial censuses of
1775/1791/1817/1827/1841**. Tier ceiling = `secondary`; the la Sagra primary is the real target.

**Caveats:** table OCR is badly de-columnated (narrative clean, numeric tables mangled) → the ~6 key
figures are on clean narrative/recapitulation pages and should be **hand-keyed**, not bulk-OCR'd.
Numbers are la Sagra's (one compiler, official colonial administration — read against the grain; the
colonial state undercounts/euphemizes per [[interpretive-framework]] §2). Does NOT support
continuity-of-holding (no parcels/owners) or `chattel_transfer_events` (no transactions).

## PART B — Cuba benchmark layer SCOPE (design; not built)

**Goal:** a cited, aggregate Cuban slave-economy benchmark — the Spanish-colonial analog of
[[plan-ipums-census-benchmark]]'s `census_holding_benchmarks` — providing (1) enslaved-population
control totals by jurisdiction/sector/year and (2) a macro obligation anchor (the $41.7M capitalized-
enslaved / $507M total-capital figures). Feeds a future Cuba theatre + #90-style calibration. Aggregates
ONLY — never person rows (audit rule 5, "real or absent"), same discipline as the census work.

**Design decision (recommended): GENERALIZE, don't Cuba-fork.** The project is going multi-theatre
(triangle-trade vision). Rather than a one-off `cuba_*` table, generalize the benchmark to a
`slave_economy_benchmarks` with a `polity`/`theater` discriminator (e.g. `us_census`, `cuba_colonial`,
`brazil_colonial`) so US census cells and Cuba colonial cells live in one calibratable frame. Cuba-
specific table is the minimal fallback if generalizing is too much scope now.

**Proposed shape (per benchmark fact):** `polity`, `jurisdiction` (island/department/town), `year`,
`metric` (enslaved_count | capital_value | production | land), `sector` (sugar/coffee/farm/all),
`sex`/`age` where given, `value`, `unit` (persons/dollars/arrobas/caballerías), `bucket_detail` JSONB,
`secondary_source_compilation_id` FK, `primary_source_note` (la Sagra + census year). Keyed unique on
(polity, jurisdiction, year, metric, sector).

**Provenance wiring:** register MacGregor Vol. IV in `secondary_source_compilations` (M090 pattern,
`max_evidence_tier='secondary'`); each seeded fact notes the primary (la Sagra returns / census year).

**Seed content:** the ~6 hand-keyed la Sagra figures above (enslaved totals + sector split + the 1830
capital recapitulation + production). Hand-key from the clean narrative pages (files 38–42); do NOT bulk-
OCR the mangled trade matrices.

**How it feeds the architecture:**
- **#90 calibration:** Cuban enslaved denominators = control totals for a Cuba theatre (same role as US
  census cells).
- **Obligation anchor:** $41.7M capitalized-enslaved / $507M colonial capital = a documented Cuba-scale
  macro anchor (analog to Brattle/Darity for the US).
- **Extraction-as-colonialism:** customs/trade tables → wealth-outflow evidence; Spanish colonial fiscal
  apparatus → `harm_perpetrator_entities` context (Spanish Crown/administration) — but those PERPETRATOR
  ENTITY rows must enter via the contribute pipeline, NOT a seed script (established data-entry rule).

**Build steps (proposed, awaiting go):** (1) migration — generalized `slave_economy_benchmarks` table +
MacGregor `secondary_source_compilations` row; (2) tiny hand-keyed seed of the la Sagra figures (aggregate,
cited); (3) validation (internal consistency: capital line-items sum to total; sector counts vs island
total). Small — no person rows, no dedup, no gate.

**Open decisions for the user:** (a) generalize `slave_economy_benchmarks` vs Cuba-specific table;
(b) hand-key MacGregor's la Sagra digest now, or go straight to the la Sagra primary (better, non-English,
more work); (c) whether a Cuba obligation theatre is in scope yet or this is pure benchmark-substrate.

## See also
[[plan-ipums-census-benchmark]] · [[wealth-tracing-framework]] · [[interpretive-framework]] ·
[[project_calibration_first_architecture]] · `migrations/090-secondary-source-compilations.sql`

## MacGregor 5-VOLUME MAP (2026-07-06) — which volume holds which theatre
User re-dropped `hvd-hb35mk-1783310926.txt` (= SAME shelfmark hb35mk = **Vol IV**, re-download of the
already-assessed `-1783039781`; Cuba $41.7M/$507M already extracted — do NOT redo). The book's own
"Summary of Contents of the Five Volumes" maps directly onto our theatres — all public-domain HathiTrust:
- **Vol I** — Austria, Belgium, **Denmark & her Colonies (Danish WI)**, **France & her Colonies (French WI)**, **Holland & her Colonies (Dutch WI/Suriname)**, German Customs Union, Italy, Gibraltar/Malta/Ionian.
- **Vol II** — Ottoman, Greece, **African States/sea-ports**, Russia, Sweden/Norway, **Spain & her Colonies (Cuba/PR)**, **Portugal & her Colonies (Brazil-adjacent)**.
- **Vol III** — **United States** (agriculture/productions/trade/finances/revenues/debts per state), Texas, Mexico, … **British/French/Dutch Guyana**, Peru…Patagonia.
- **Vol IV** (THIS FILE) — **Foreign West Indies** (Hayti/Cuba/PR/French/Dutch/Danish WI) · **Brazil** · British East Indies & Oriental Commerce · Ceylon/Singapore/Malacca. Cuba DONE.
- **Vol V** — Chinese Empire · **British Possessions in Africa, Asia, Australasia (incl. Mauritius, Cape)** · **British North American Colonies** · **BRITISH WEST INDIES** · Falklands/Sandwich Is. · **British & Colonial Customs Tariffs & Regulations** · UK sea-port dues · **Summary of British Navigation & Trade for 150 Years** · Supplements.
**→ For British-colony financial/trade data (the user's ask) get VOL V** (British WI + British N. America +
British Africa/Asia incl. Mauritius/Cape + 150-yr British trade summary). Vol I = Danish/French/Dutch WI;
Vol II = Spain(Cuba/PR)+African states; Vol III = US + Guyana. Each feeds `slave_economy_benchmarks`
(#116) as CITED colony-level aggregates (dual-ledger, per-stratum control totals, cite MacGregor→la Sagra/
official returns), never person rows. STILL EXTRACTABLE IN VOL IV (not yet done): the **Brazil** macro
trade/slave-economy section (Brazil = major slave economy) + foreign-WI (French/Dutch/Danish) trade tables.
