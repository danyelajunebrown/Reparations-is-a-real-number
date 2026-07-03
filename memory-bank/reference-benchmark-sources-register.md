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

## See also
[[assessment-macgregor-cuba-source-and-benchmark-scope]] · [[plan-ipums-census-benchmark]] ·
[[interpretive-framework]] · [[bibliography-index]] · `migrations/090-secondary-source-compilations.sql`
