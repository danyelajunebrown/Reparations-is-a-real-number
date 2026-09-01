> **STATUS (2026-08-07):** **Bard College is COMPLETE** (LAND path — Samuel #907115 / William #907116 census
> canonicals, edge #8114 verified, Massena 15-link chain; see activeContext). **Amherst** and **Georgetown
> (GU272)** are APPLIED (CAPITAL path). **Harvard / UVA / Princeton / Brown** remain scoped-not-built below —
> build each on the Amherst template (`ingest-amherst-trask-endpoint.mjs`), user-vetted like Amherst was.

# plan-modern-endpoints-program.md — the reckoning-institution capital-path endpoints

> Scoping doc. Reckoning-institution *modern endpoints*: living institutions that HOLD enslaver wealth
> and have themselves produced a public reckoning (report + often a fund + often an organized descendant
> community). Each becomes a `corporate_entity` + `corporate_slavery_disclosure`, with the enslaver→
> institution wealth flow wired through PersonService leads, owner edges, and `research_findings`.
> **Every external fact below is marked with its source URL.** Where a specific is not yet verified it is
> flagged `TODO/UNVERIFIED` rather than asserted.
>
> Prior art (the templates):
> - **Bard College** — LAND path (`land_transfer_events`/`properties`, the Massena chain, migration 129).
> - **Amherst College** — CAPITAL path (`scripts/ingest-amherst-trask-endpoint.mjs`; Israel Trask's
>   $800 documented bequest + the Trask-250 descendant reconstruction). This program generalizes Amherst.
>
> AUDIT INVARIANTS carried from Amherst (non-negotiable for every endpoint here):
> 1. An enslaved **COUNT** (e.g. "272", "70+") is a documented count — it NEVER becomes fabricated rows.
>    Only individually-**named** people are minted, as SECONDARY-tier, review-flagged leads.
> 2. **Living descendants are NOT minted.** The descendant community (org, foundation, genealogist) is
>    CITED as the recipient side; their datasets are theirs — cite/collaborate, never scrape.
> 3. All persons route through PersonService (the mint gate). The institution + disclosure carry full
>    provenance, `source_tier='secondary'`, `max_evidence_tier='secondary'`, and review flags.
> 4. Compensation/proceeds TO the institution = EVIDENCE OF DEBT to descendants (dual-ledger), never credit.

---

## Ranking (cleanest → hardest to wire)

| # | Institution | Path | Enslaved evidence | Organized descendants | Institutional $ | Wiring effort |
|---|-------------|------|-------------------|-----------------------|-----------------|---------------|
| 1 | **Georgetown (GU272)** | capital (1838 sale proceeds) | 272 named on the articles of agreement (a documented roster) | **GU272 Descendants Assoc. + Descendants Truth & Reconciliation Foundation** | Jesuits $100M pledged toward $1B goal; +$27M (2023) | **LOW** |
| 2 | **Harvard** | direct-ownership + capital | 70+ enslaved by Harvard affiliates (report names some) | HLS Initiative + American Ancestors descendant-ID (in progress) | **$100M** Legacy of Slavery Fund (2022) | MEDIUM |
| 3 | **UVA** | direct-ownership / forced labor | 4,000+ enslaved laborers; ~half of names unrecovered (Memorial lists known names) | **Descendants of Enslaved Communities (DEC)** — on the President's Commission | No single reparations fund; memorial + programs | MEDIUM |
| 4 | **Princeton** | capital + direct-ownership | all 7 founding trustees + first 9 presidents enslavers; campus slave sale 1766 | diffuse — no single descendant org | no institutional fund | MEDIUM-HIGH |
| 5 | **Brown** | capital (transatlantic slave-**trade** fortunes) | trade-financed wealth, few named enslaved traceable to Brown | DeWolf descendants organized, but those are ENSLAVER descendants (Traces of the Trade) | $10M education endowment (not descendant-directed) | **HIGH** |

Georgetown is the clean first build (Deliverable 2): a single documented transaction, a named roster count,
a formally organized descendant community, and a funded reckoning — every axis is strong.

---

## 1. Georgetown University — GU272 (BUILD FIRST → Deliverable 2)

- **Wealth flow / what funded it.** The Maryland Province of the Society of Jesus (the Maryland Jesuits),
  who owned and operated Georgetown, sold 272 enslaved men, women, and children on **June 19, 1838** to
  Louisiana sugar-plantation owners for **$115,000** (~$3.3M in today's dollars) to rescue the debt-ridden
  college from insolvency. The sale was orchestrated by two Jesuits who each served as Georgetown
  president: **Rev. Thomas F. Mulledy, S.J.** (provincial superior) and **Rev. William McSherry, S.J.**
  Buyers: **Henry Johnson** (former LA governor, congressman, U.S. senator) and **Jesse Batey** — West Oak
  Plantation, Iberville Parish (Bayou Maringouin), and plantations near Maringouin / Ascension Parish.
  The Jesuits sold **314** people in all over 1838–1843; the **272** ("GU272") are those on the initial
  1838 census/articles. Sources:
  [georgetown.edu/slavery](https://www.georgetown.edu/slavery/) ·
  [Georgetown apology press release](https://www.georgetown.edu/news/georgetown-apologizes-for-1838-sale-of-272-slaves-dedicates-buildings/) ·
  [Georgetown Voice explainer](https://georgetownvoice.com/2020/08/28/georgetown-explained-the-gu272/) ·
  [Wikipedia: 1838 Jesuit slave sale](https://en.wikipedia.org/wiki/1838_Jesuit_slave_sale) ·
  [The Advocate (buyers/plantations)](https://www.theadvocate.com/baton_rouge/entertainment_life/descendants-of-272-slaves-sold-by-georgetown-priests-to-louisiana-later-founded-southern-university/article_76c3e3ba-468d-11ed-9254-cf84c0d42c74.html) ·
  [Georgetown Slavery Archive — the 1838 collection](https://slaveryarchive.georgetown.edu/collections/show/1).
- **Endpoint type:** CAPITAL (sale-proceeds funded operations). Institutional enslaver = the Maryland
  Jesuits; the college is the wealth-beneficiary endpoint.
- **Descendant reconstruction (already exists).** **GU272 Descendants Association**; the **Descendants
  Truth & Reconciliation Foundation** (DTRF, formed 2021 by Georgetown + the Jesuits + the GU272
  Descendants Association). Genealogists — Georgetown Memory Project (Richard Cellini) and NYT's Rachel
  Swarns — identified **10,000+** descendants; estimated **12,000–15,000** total descendants (living +
  deceased). Also the **Isaac Hawkins Legacy Group** (Hawkins' direct descendants). The **GU272 Memory
  Project** with **American Ancestors** hosts a searchable descendant database. Named descendant-activists:
  Patricia Bayonne-Johnson (uncovered the sale in 2004), Joseph M. Stewart. Sources:
  [descendants.org history](https://www.descendants.org/who-we-are/history) ·
  [GU272 Memory Project](https://gu272.americanancestors.org/) ·
  [globalchildren.georgetown.edu — Children of the GU272](https://globalchildren.georgetown.edu/responses/the-children-of-the-gu272).
- **Institutional $ committed.** Jesuit Conference of Canada & the US pledged **$100M (2021)** toward a
  **$1 billion** goal; an additional **$27M (2023)** to the DTRF; JPMorgan Chase Foundation gave $2.5M
  (2023) for DTRF operations. Sources:
  [CNN — Jesuits $100M](https://www.cnn.com/2021/03/16/us/georgetown-slavery-descendants-jesuits-100-million-trnd) ·
  [America Magazine — +$27M (2023)](https://www.americamagazine.org/politics-society/2023/09/13/jesuits-descendants-enslaved-georgetown-racism-healing-246062/) ·
  [NCR — $100M pledge](https://www.ncronline.org/news/jesuits-pledge-100-million-reparations-descendants-enslaved-people).
- **Named enslaved to mint (secondary, review-flagged):** **Isaac Hawkins** (first person listed on the
  1838 articles of agreement; Mulledy Hall renamed Isaac Hawkins Hall, 2017); **Cornelius Hawkins**;
  **Frank Campbell** (photographed; "sold by the Jesuits"). The 272 remain a documented COUNT.
- **Wiring effort: LOW.** One entity, one disclosure, one dated transaction with a dollar value, a named
  roster count, 3 verified named individuals, an organized descendant side. Direct clone of the Amherst
  script. → **Deliverable 2, built.**

## 2. Harvard University — Legacy of Slavery

- **Wealth flow.** The 130-page **"Harvard & the Legacy of Slavery"** report (2022) found that from Harvard's
  1636 founding until Massachusetts abolished slavery in 1783, Harvard leaders — including **five Harvard
  presidents** — enslaved **70+** people of African and Indigenous descent on and around campus, and that
  ~70 more donors/leaders were slaveholders. New England slave-trade wealth "powerfully shaped" the
  university (direct-ownership + capital). Sources:
  [legacyofslavery.harvard.edu/explore-report](https://legacyofslavery.harvard.edu/explore-report/) ·
  [Harvard Magazine](https://www.harvardmagazine.com/2022/04/harvard-legacy-of-slavery-report) ·
  [NPR](https://www.npr.org/2022/04/26/1094870357/harvard-university-has-committed-100-million-to-redress-its-early-ties-to-slaver).
- **Endpoint type:** direct-ownership (named enslaved on campus) + capital (slave-economy donors).
- **Descendants.** Harvard's HLS Initiative is running descendant identification (partnered with American
  Ancestors) to find and build relationships with direct descendants of the enslaved who labored at
  Harvard. No single external descendant *association* yet (in progress). Source: HLS Initiative pages
  (legacyofslavery.harvard.edu). `TODO/UNVERIFIED`: number of descendants identified to date.
- **Institutional $:** **$100M** Legacy of Slavery Fund / endowment (2022). Source: NPR/CNN above.
- **Named enslaved:** the report names some (e.g. Titus, Venus, Bilhah, Juba, Cicely, and others attached
  to specific Harvard figures). `TODO`: pull the exact named list from the report PDF before minting — do
  not assert names from memory.
- **Wiring effort: MEDIUM.** Report is well-structured and the fund is real; enslaved names must be
  extracted from the report itself; descendant side is institution-run and still forming.

## 3. University of Virginia — President's Commission on Slavery and the University

- **Wealth flow / labor.** UVA's **President's Commission on Slavery and the University** (founded 2013 by
  Pres. Teresa Sullivan; 5-year study) found slavery was "core" to the institution — **4,000+** enslaved
  people built and operated the university 1817–1865. This is a forced-LABOR / direct-ownership endpoint
  rather than a single capital transaction. Sources:
  [slavery.virginia.edu](https://slavery.virginia.edu/) ·
  [The Hill — "core to the institution"](https://thehill.com/blogs/blog-briefing-room/news/400691-university-of-virginia-commission-finds-slavery-was-core-to/) ·
  [Memorial to Enslaved Laborers — history](https://mel.virginia.edu/history).
- **Endpoint type:** direct-ownership / forced labor (construction + operation of the university).
- **Descendants.** **Descendants of Enslaved Communities (DEC) at UVA** — an organized descendant community
  seated on the Commission. The **Memorial to Enslaved Laborers** (dedicated April 2020) inscribes the
  known names and marks the many unrecovered ones. Sources:
  [mel.virginia.edu/community](https://mel.virginia.edu/community) ·
  [mel.virginia.edu/memorial](https://mel.virginia.edu/memorial).
- **Institutional $:** no single reparations fund; commemoration, scholarships, and community programs.
  `TODO/UNVERIFIED`: any dollar-quantified UVA descendant program.
- **Named enslaved:** the Memorial + the Commission recovered a partial name list (the majority remain
  unnamed — a documented COUNT, not rows). `TODO`: pull the recovered-names list from the Memorial before
  minting; mint only named individuals.
- **Wiring effort: MEDIUM.** Strong descendant org + strong labor documentation, but the wealth flow is
  diffuse labor value (no single dated $ transaction), so the disclosure's `documented_value_usd` is
  labor-valuation, not a sale price — flag accordingly.

## 4. Princeton University — Princeton & Slavery Project

- **Wealth flow.** The **Princeton & Slavery Project** (2013–2024, Prof. Martha Sandweiss + 50+ researchers)
  documented that **all seven founding trustees** of the College of New Jersey were slaveholders, the
  **first nine presidents** all owned slaves, a **slave sale took place on campus in 1766**, enslaved
  people lived at the President's House until at least 1822, and many benefactors' gifts derived from
  slavery wealth (capital + direct-ownership). Sources:
  [slavery.princeton.edu/about/overview](https://slavery.princeton.edu/about/overview) ·
  [Founding Trustees](https://slavery.princeton.edu/stories/founding-trustees) ·
  [Project History](https://slavery.princeton.edu/about/project-history).
- **Endpoint type:** capital (slavery-derived benefactions) + direct-ownership (presidents/trustees).
- **Descendants.** No single organized descendant association surfaced (the enslaved were dispersed
  household laborers, not one traceable community). `TODO/UNVERIFIED`: descendant reconstruction status.
- **Institutional $:** no dedicated reparations fund identified. `TODO/UNVERIFIED`.
- **Wiring effort: MEDIUM-HIGH.** Excellent enslaver-side documentation (many namable enslaver trustees/
  presidents → good enslaver leads), but diffuse enslaved side and no organized descendant recipient.

## 5. Brown University — Slavery and Justice Report

- **Wealth flow.** Brown's landmark **Slavery and Justice Report** (2006; Steering Committee appointed 2003
  by Pres. Ruth Simmons) documented Brown's ties to the **transatlantic slave TRADE** — the Brown family
  (incl. Nicholas Brown, namesake) and Rhode Island trading fortunes (the DeWolf trade) that seeded the
  university. This is a slave-trade CAPITAL path, the hardest to trace to specific named enslaved people or
  their descendants. Sources:
  [slaveryandjustice.brown.edu/report](https://slaveryandjustice.brown.edu/report) ·
  [2006 report of the steering committee](https://slaveryandjustice.brown.edu/report/2006-report) ·
  [report PDF](https://slaveryandjustice.brown.edu/sites/default/files/reports/SlaveryAndJustice2006.pdf).
- **Endpoint type:** capital (slave-trade fortunes → endowment/founding).
- **Descendants.** The trade-financing structure means few named enslaved trace cleanly to Brown; the
  organized descendant community that exists (Traces of the Trade / the DeWolf family) are descendants of
  the ENSLAVERS, not the enslaved — a different recipient logic. `TODO/UNVERIFIED`: any enslaved-descendant
  reconstruction tied to Brown.
- **Institutional $:** Brown's 2007 response created a **$10M** endowment for Providence public schools —
  education-directed, not descendant-directed. Source:
  [Brown's response](https://slaveryandjustice.brown.edu/report/2006-report/2007-response).
- **Wiring effort: HIGH.** Foundational report, but the trade-capital path resists named-enslaved + named-
  descendant wiring. Build last; may end up an entity+disclosure with no minted enslaved (count only).

---

## Shared wiring recipe (per endpoint, from the Amherst template)

1. **File-first archival** of the public reckoning source → S3 (`sources/<inst>/…`) + Wayback +
   `source_artifacts` row (rehostable flag, secondary notes).
2. **Enslaver leads** via PersonService (`sourceType:'secondary'`, `confidence≈0.65`,
   `dataQualityFlags.max_evidence_tier='secondary'`, `requires_human_review:true`), idempotent-resolved by
   `person_external_ids (id_system, external_id)`.
3. **Named enslaved leads** (secondary, review-flagged) + `enslaved_owner_relationships` owner edges. Counts
   stay counts.
4. **`corporate_entity`** (`entity_type='educational_institution'`, `involvement_category` text[] e.g.
   `{endowment,founding_bequest,capital_path}` or `{direct_ownership,forced_labor}`) — SELECT-first, no
   ON CONFLICT.
5. **`corporate_slavery_disclosure`** with the report facts: `enslaved_persons_count`, `documented_value_usd`,
   `disclosure_year`, `triggered_by`, `disclosure_document_url` + `_s3_key`, `has_names_list`,
   `formal_apology`, `remediation_funded`, `review_status='pending'`.
6. **`research_findings`** — log the wealth-flow finding, the descendant reconstruction (CITED, not
   extracted), and any NULL/partial searches (opt-in contacts are the RECIPIENT side, not minted).

Dry-run default; `--apply` is a deliberate, user-vetted mint step (as Amherst / Bard were).
