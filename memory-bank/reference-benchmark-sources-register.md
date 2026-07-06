# REFERENCE — Benchmark-source citation register (national slave-population denominators)

_Citation discipline for the reference-class benchmark layer ([[assessment-macgregor-cuba-source-and-benchmark-scope]],
GitHub #116). **Rule (owner):** cite the PRIMARY actor; a tertiary/secondary conduit (a digest, a
transcription site, an encyclopedia) is named ONLY where its figures enter the reference-class
formulation — never as the primary source. Every benchmark row in the DB must carry provenance to the
primary (source, tier, citation) + register its conduit in `secondary_source_compilations` (M090).
This file is the "outside" record; the schema mandates the "inside" per-row provenance._

## Confidence tiers (per DATA_SOURCE_INTEGRATION_CONTRACT)
0.95+ government primary · 0.85–0.94 scholarly-verified · 0.70–0.84 cross-referenced secondary · lower = unverified.

---

## 1. Cuba — 1830 balance sheet + 1841 population
- **PRIMARY:** Ramón de la Sagra, official statistical returns of the Cuban colonial administration
  (Captain-general Vives; Superintendent-general Conde de Villanueva), and the Cuban colonial
  **censuses of 1775, 1791, 1817, 1827, 1841**; consolidated in la Sagra, *Historia económico-política
  y estadística de la isla de Cuba* (Havana, 1831). Tier ~0.95 (colonial-government census) — read
  against the grain (the colonial state undercounts; [[interpretive-framework]] §2).
- **CONDUIT (tertiary, cite for figures only):** John MacGregor, M.P., *Commercial Statistics: A Digest…
  of All Nations*, 2nd ed., **Vol. IV**, London: Whittaker & Co., 1850, Sec. XVIII (Cuba), pp. ~19–70.
  HathiTrust `hvd.hb35mk` (Google-digitized from Harvard). Public domain.
- **Figures:** enslaved **436,495** (1841, by W/C/E department + sex); by sector 1840 — 138,701 on 1,238
  sugar estates, 114,760 on 1,838 coffee plantations, 393,993 on 42,549 farms. 1830 capital: enslaved
  **$41,694,600** (138,982 × $300) within **$507,088,002** total (Lands 94.4M · Plants 276.8M · Bldgs
  54.6M · Slaves 41.7M · Animals 39.6M). Output: sugar 8,091,837 arrobas; coffee 2,883,528 arrobas.

## 2. Jamaica — 1788 parish return
- **PRIMARY:** "Return of the number of White Inhabitants, Free People of Colour and Slaves in the Island
  of Jamaica," Spanish Town, November 1788 — **The National Archives (UK), CO 137/87, p. 173.** Tier
  ~0.95 (colonial governor's return).
- **CONDUIT:** Jamaican Family Search (jamaicanfamilysearch.com), transcription.
- **Figures:** enslaved **226,432** + white 18,347 + free-coloured 9,405 + **maroons 1,326** = 255,510,
  across **19 parishes** (St. Catherine … Trelawny) + maroon towns (Trelawny/Accompong/Scots' Hall/
  Charles/Moore).

## 3. British & French West Indies — 1773–1788 (Privy Council Slave-Trade inquiry)
- **PRIMARY:** **Minutes of the Committee of [the] Privy Council on the Slave Trade** (British government;
  the 1789 Report of the Lords of the Committee of Council). Tier ~0.95 (parliamentary/government inquiry).
  Sub-source for the French islands: **M. Necker**, *De l'administration des finances de la France* (1784).
- **CONDUIT:** reproduced in the **1790 Jamaica Almanac**, transcribed by Jamaican Family Search.
- **Figures (per-island white / free-negro / enslaved, last-return year):** Jamaica 1787: 23,000 /
  4,093 / **256,000**; Antigua 1774: 2,590 / – / 37,808; Barbadoes 1786: 16,167 / 838 / 62,115; Grenada
  1785: 996 / 1,115 / 23,926; St. Vincent 1787: 1,450 / 1,138 / 11,853; Dominica 1788: 1,236 / 445 /
  14,967; St. Christopher's 1774: 1,900 / – / 23,462; + Montserrat, Nevis, Virgin Is., Bahamas, Bermudas.
  **French W.I. (Necker):** St. Domingue 1779: 32,650 / 7,055 / **249,098**; Martinique 1776: 71,286
  enslaved; Guadaloupe 1779: 85,327; St. Lucia, Cayenne, Île de France, Bourbon.
- **Trade series (extraction flows):** annual African slave export by carrier nation (British 38,000 /
  French 20,000 / Portuguese 10,000 / Dutch 4,000 / Danish 2,000 = **74,000**) and **by African coastal
  region** (Bonny/New Calabar 14,500; Loango/Malimba/Cabinda 13,500; Gold Coast 10,000; …). Ships-from-
  Africa + Negroes-imported per island, 1783–1787 (per Inspector General of Imports & Exports).

## 4. Brazil — 1872 imperial census
- **PRIMARY:** *Recenseamento Geral do Império do Brasil de 1872*, **Diretoria Geral de Estatística (DGE)**
  (Decree No. 4,676 / Law No. 1,829). Reference date 1 Aug 1872. Tier ~0.95. Modern critical edition:
  Rodarte, Paiva & Godoy, "Publicação Crítica do Recenseamento… de 1872," UFMG (2012); housed at IBGE.
- **CONDUIT:** Wikipedia, "1872 Brazilian census" (cites the DGE / UFMG edition) — tertiary; cite DGE.
- **Figures:** enslaved **1,510,806** (15.2%) + free 8,419,672 = 9,930,478, across **20 provinces** +
  Neutral Municipality (e.g. Minas Gerais 370,459; Rio de Janeiro 292,637 = 37.4%; Bahia 167,824).

---

## Licensing / redistribution caveats (must respect)
- **Jamaican Family Search:** "limited license… personal, non-commercial use… **Posting of materials on
  other Web Sites is strictly prohibited.**" → we cite the PRIMARY (CO 137/87; Privy Council minutes;
  public-domain government records) and store the FIGURES with provenance; do NOT republish JFS's
  transcription text wholesale on any public surface.
- **IPUMS** (US census, separate): microdata non-redistribution; aggregates safer (see [[plan-ipums-census-benchmark]]).
- **Wikipedia:** CC BY-SA — attribute; but cite the underlying DGE primary, not the article.
- **MacGregor / la Sagra:** public domain (pre-1900).

## How this feeds the build (#116 / #117)
- Each figure lands as an aggregate benchmark row (`polity` discriminator), `source_tier` + primary
  citation + conduit FK in `secondary_source_compilations`. Aggregates only — never person rows.
- The SlaveVoyages named cohort (#117) is the NUMERATOR inside these denominators (e.g. ~9,531 Cuba
  disembarkations within Cuba's 436,495).

---

## PERSON-LEVEL SCRAPE TARGETS (their own pipelines — beyond aggregate benchmarks)
These are PRIMARY, person-level sources: they yield the numerator (named enslaved) AND named
enslavers AND transfers — not just denominators. Each needs its own scrape (Mini, not MacBook).

### A. British Caribbean Slave Registers, 1817–1834 — **TIER-1 target** (numerator + denominator + dual ledger)
- **PRIMARY:** The National Archives (UK) record group **T 71** — Office of Registry of Colonial Slaves
  & Slave Compensation Commission. UNESCO **Memory of the World** register (2009, +Bermuda addendum 2011):
  "Registry of Slaves of the British Caribbean 1817–1834." Tier ~0.95 (government registry; Higman rates
  it "generally standing up to quite strict tests of reliability").
- **Scope (TNA T 71 volume counts):** Jamaica 249 vols + 6 indexes · Barbados 37 + 7 · Grenada 67 + 2 ·
  Demerara 37 + 6 · Trinidad 8 + 10 (surnames indexed) · Tobago 30 · Berbice 8 + 2 · Dominica 26 ·
  St Vincent 6 + 2 · St Lucia 12 + 2 (from 1815) · St Kitts 8 · Antigua 7 · Nevis 6 · Montserrat 5 ·
  Anguilla 3 · Bahamas 5 · Bermuda 4 · Honduras/Belize 2. (Higman 1995, p.8.) Also island archives
  (Bahamas, Belize, Dominica, Jamaica, St Kitts, Trinidad).
- **Fields (per enslaved person):** name (rarely surnames), sex, age, colour, place of birth
  (Creole/African + sometimes ethnic origin — Ebo/Mande/Bambara/Fulani/Congo/Senegal), physical
  condition, occupation, manumission; subsequent triennial returns record births/deaths/manumissions/
  sales/marronage. **Also names ENSLAVERS** (+ gender, white/free-person-of-colour status).
- **Why Tier-1:** closes denominators for a whole cluster of British colonies, IS the numerator (every
  enslaved person named), AND pairs with the **1834 Slave Compensation** (£20M paid to owners = dual
  ledger, compensation-to-enslavers = evidence of debt). Maps to enslaved leads + enslaver canonicals +
  `chattel_transfer_events` (sales in the returns). We already touch **UCL Legacies of British Slave-
  ownership** (`ucl_lbs`, 861 leads) — underexploited.
- **Access:** TNA T 71 microfilmed; **Ancestry** licensed to digitize (ancestry.co.uk). No copyright
  restriction on the records themselves (gov records); respect Ancestry's ToS for their images.
- **Note:** few slave INDEXES exist in T 71 (owners/plantations indexed at front, but "pages of Williams
  and Marys" made slave indexes impractical) → scrape the registers themselves, not an index.

### B. Brazil — Pombos (Pernambuco) slave deeds, 1863–1890 (chattel transfers)
- **PRIMARY:** District notary registrations, municipality of **Pombos, Pernambuco, Brazil** —
  "Slave deeds 1863–1890 (without index)." FamilySearch **DGS 4144740** (film 1532441 Item 2; filmed by
  the Genealogical Society of Utah 1988, Granite Mountain Record Vault). Portuguese. Tier ~0.95 (notarial
  primary). Part of the Brazil, Pernambuco civil-registration collection.
- **Content:** notarial slave-deed registrations (escrituras de escravos) — **CHATTEL TRANSFERS** (sales,
  transfers of enslaved persons) → `chattel_transfer_events` + named enslavers/enslaved. Late-slavery
  Brazil (post-1850 trade ban, pre-1888 abolition).
- **Access:** FamilySearch (film may be Family-History-Center/affiliate restricted — check). Its own
  scrape; a template for other Brazilian notarial-district slave-deed films.

## See also
[[assessment-macgregor-cuba-source-and-benchmark-scope]] · [[plan-ipums-census-benchmark]] ·
[[interpretive-framework]] · [[wealth-tracing-framework]] · [[bibliography-index]] ·
`migrations/090-secondary-source-compilations.sql`

## Colonial-trade-value sources BY COLONIAL POWER (2026-07-06) — dual-ledger extraction aggregates
"Value of imports/trade from the colonies" from each power's own vantage — the extraction side of the
dual ledger (what each metropole drew from its slave colonies = evidence of debt). All feed
`slave_economy_benchmarks` (#116) as CITED colony/power-level AGGREGATES (never person rows); cite the
PRIMARY (conduits/blogs named only where figures enter the class). Pairs with the MacGregor 5-vol map
(assessment-macgregor-cuba-source-and-benchmark-scope.md) + BPP compensation totals (#131).

- **FRENCH** — Wante, *Importance de nos colonies occidentales…Saint-Domingue* (Paris 1805) = the
  haitidoi.com blog transcription (1789 French colonial imports; SD > 2x any other colony; France +120.9M
  livres colonial-product preponderance over England). Cite Wante 1805, not the blog. + Necker,
  *De l'administration des finances de la France* (1784, already in register); Moreau de Saint-Méry;
  Peuchet's *Dictionnaire… commerçante*.
- **BRITISH** — **Bryan Edwards, *History Civil & Commercial of the British Colonies in the West Indies***
  (1793, Internet Archive, PUBLIC DOMAIN — per-island trade/production/value tables); **MacGregor Vol V**
  (British WI + 150-yr British trade summary + colonial customs); **Colonial Office Blue Books** (per-colony
  annual trade returns 1787+; British Online Archives "Caribbean Colonial Statistics 1824-1950");
  Privy Council Slave-Trade Committee 1789 (in register); Lord Sheffield, *Observations on the Commerce…*.
- **SPANISH** — **Humboldt, *Political Essay on the Island of Cuba*** (~1826, English PD — Cuba trade/pop/
  value); **Balanzas de comercio** (1792, 1827; Cuba *Balanza general* 1852) via la Sagra (already used
  through MacGregor Vol IV); John Fisher, "Statistics of Spain's Colonial Trade 1792-1820" (HAHR 1981).
- **PORTUGUESE/BRAZIL** — MacGregor Vol IV Brazil section (HAVE the file); Brazilian *Balança geral do
  commercio*; Alden. **DUTCH** — MacGregor Vol I (Holland & colonies); Postma Dutch slave-trade data.
  **DANISH** — MacGregor Vol I (Denmark & colonies); Rigsarkivet DWI customs (#141 research).
- **CROSS-POWER MODERN SCHOLARLY (comparative aggregations)** — Inikori, *Africans and the Industrial
  Revolution in England* (2002, per-power trade-value tables); O'Brien & Engerman (1991); Patrick O'Brien,
  "European Economic Development: The Contribution of the Periphery" (1982); Rönnbäck, "Sweet Business:
  Quantifying the Value Added in the British Colonial Sugar Trade"; Eltis & Engerman on slave-trade value.
  → use for cross-checking/benchmarking the primary-derived per-power figures (calibration #90 style).
