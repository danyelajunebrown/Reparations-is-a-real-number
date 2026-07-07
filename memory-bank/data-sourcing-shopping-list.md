# Document Sourcing Shopping List

**Date**: 2026-04-29
**Purpose**: Concrete checklist for what I (Claude) need from you to build out the document-ingestion pipeline. Prioritized so your library/archive visits are efficient.

---

## How to read this list

Each row has a **status**:
- 🟢 **I'm pulling this myself** — public web source, I'll fetch automatically. No action needed from you.
- 🔵 **Already requested** — you've put in a Library of Congress request. Bring it back when ready.
- 🟡 **Easy fetch — when convenient** — public source but easier for you to grab (paywalled, login-walled, or PDF-too-large for my fetch tools).
- 🔴 **High priority — please prioritize** — needed before downstream work can start; or rare/restricted source.

Each row has an **effort** estimate for you (5 min / 30 min / hours / multi-visit).

Each row says **what we want** — sometimes one sample is enough to build an extractor; sometimes a full corpus is the goal.

---

## Already in flight from your LoC request

| Status | Source | Document class | What we want | Priority |
|---|---|---|---|---|
| 🔵 | **Hynson, *DC Runaway and Fugitive Slave Cases 1848-1863*** (Willow Bend Books, 1999) | custody_event_register | Full book scan. ~15 years of dated DC Department of Corrections + US District Court fugitive slave entries. Multi-thousand entries; trajectory data. | High — drives Mac Mini Henry Weaver test case (closes Patrick & Cato 1849 custody trail) |
| 🔵 | **Hanover Parish Roll, March 28, 1817** ("a roll of land, slaves, stock, wheels, and persons saving deficiency, for the parish of Hanover") | multi_entry_parish_roll | Full document scan. Aggregated tabular records: per-slaveholder land + enslaved persons + livestock + wheels + tax-deficient persons. | High — first parish-roll-class test case |
| 🔵 | **Stephenson, *Isaac Franklin, slave trader and planter of the Old South; with plantation records*** (Louisiana State University Press, 1938) | published_compilation_of_primary_records | Scan the **plantation records appendix** (the embedded primary-source ledgers). The editorial/biographical portion is lower priority but worth scanning if time permits. | High — Franklin & Armfield were the largest US domestic slave traders; massive named-person yield |
| ⚠️ | ~~Hosmer, *The Cornell plantations*~~ (1947) | (NOT slavery-related) | **Verify on-site** — "plantations" here refers to Cornell's agricultural land, not slavery. If campus history only, **skip** to save your time. | Skip unless content surprises |
| ⚠️ | ~~Moody, *The Londonderry plantation 1609-41*~~ | (Colonial Ulster, not US slavery) | **Skip** unless you specifically want global-scope colonial-dispossession data layered in. Different ontology. | Skip for now |

**At LoC, also ask the reference desk**:
- *Florida Plantation Records from the Papers of George Noble Jones* (Phillips & Glunt, 1971) — same class as Stephenson. **Check HathiTrust first** (https://catalog.hathitrust.org) before scanning by hand; if a digital copy is available there, save your scanning time for the rare items.

---

## I'm pulling these myself (no action needed)

| Status | Source | Document class | Notes |
|---|---|---|---|
| 🟢 | **Chronicling America** (LoC newspaper digitization) | newspaper_runaway_ad, newspaper_sale_notice, newspaper_committed_to_jail | Public JSON API. Pulling 20–30 representative ads across 1810s–1860s, multiple states. |
| 🟢 | **LoC Born in Slavery / WPA Federal Writers' Project** | wpa_slave_narrative | Fully digitized at LoC. 2,300 narratives. Pulling 5 samples for narrative extractor. |
| 🟢 | **Documenting the American South (UNC)** | manumission, deed, narrative | https://docsouth.unc.edu — fully digitized. Pulling samples per class. |
| 🟢 | **Last Seen / Information Wanted (Villanova)** | post_emancipation_search_ad | https://informationwanted.org — open structured corpus. Pulling 10 samples. |
| 🟢 | **Internet Archive / HathiTrust** | various published primary-source compilations | Searching for digitized editions of plantation records, slave-trade firm books, abolition society annual reports. Pulling 1–2 samples per format type. |

---

## When convenient (no rush)

| Status | Source | Document class | What we want | Effort | Why |
|---|---|---|---|---|---|
| 🟡 | **Freedmen's Bureau records, NARA Microfilm M1875 / M816 / M1903** | freedmens_labor_contract, freedmens_marriage_record, freedmens_complaint | A few sample contracts and marriage records from 1865–1872. NARA has digitized many on FamilySearch. | 30 min on FamilySearch | Critical for kinship inference methodology; also feeds dual-ledger Black-ancestry work for participants. |
| 🟡 | **A SC / VA / GA county will book** (any one) | will + estate_inventory | One sample multi-page estate that includes: a will + a paired estate inventory listing enslaved persons by name and value. Many are on FamilySearch behind login. | 30 min on FamilySearch | Tests will-extractor against South Carolina format (different from DC). Also: estate inventories often have richer per-enslaved-person valuations than wills. |
| 🟡 | **One bill of sale image** (slave bill of sale, antebellum) | bill_of_sale | Single-page document, two parties + chattel transferred + price + date. Many on Lowcountry Digital Library, NARA, state archives. | 15 min | Atomic chain-of-custody record. Tests bill_of_sale extractor. |
| 🟡 | **One 19th-c personal letter mentioning enslaved persons** | personal_letter | Single document. Easy: Library of Congress Manuscripts has many digitized planters' papers. | 30 min | Letters reveal sales / runaways / plantation events that don't appear in formal records. |
| 🟡 | **Brattle Group reports for CARICOM Reparations Commission** | published_methodology | If you have access (you mentioned the methodology audit) — a PDF of any one Brattle report. Most are public via CARICOM site or news archives. | 15 min web search | Validates our M060 methodology citations. |

---

## Future / nice-to-have (not blockers)

| Source | Document class | Notes |
|---|---|---|
| Quaker Yearly Meeting manumission records | quaker_manumission | Systematic, well-preserved. Friends Historical Library Swarthmore has digitized portions. |
| American Colonization Society records (NARA) | acs_record | Sometimes documents specific persons relocated to Liberia. |
| Insurance ledgers beyond CA SEIR (e.g., AIG, NY Life, Aetna disclosures) | insurance_policy_ledger | Some came out via Illinois SB-1003-equivalent state laws. Mostly already in our corporate disclosures. |
| Charleston Vendue Master records | auction_register | Charleston was the major U.S. slave port; Vendue Master records list all slave sales. State Archives of SC has microfilm. |
| Slave-ship captain logs (where extant) | ship_log | Most pulled into SlaveVoyages already, but some uningested ones may exist in regional maritime archives. |

---

## What this list does NOT include

- **Wills already scanned**: Biscoe 1859, Weaver 1893, Hopewell 1817 — already in your Downloads / our pipeline.
- **Civilwardc compensation petitions**: 4,174 already in S3.
- **Slave schedules 1850/1860**: 1.68M unconfirmed_persons already ingested.
- **SlaveVoyages voyages**: integrated via API.
- **Louisiana Slave Database**: 180K already imported.
- **Maryland State Archives SC 2908 Vol. 812**: provenance already cited in M053; underlying volume can wait until we want to expand to other Maryland counties.

---

## How I want you to deliver scans

When you bring back a scanned document from LoC, the simplest path is:
1. Save the file in `~/Downloads/` with a recognizable name (e.g., `hynson-dc-runaway-cases-1999.pdf` or `hanover-parish-roll-1817.pdf`).
2. Tell me in chat: "I have [source] in Downloads."
3. I'll handle ingestion: run OCR, build the extractor, run end-to-end test, write to S3 + DB, surface results.

For multi-volume scans (Hynson is ~600 pages), break into ~50-page chunks if your scanner timeouts. I'll stitch them. Or if LoC has the volume on FamilySearch / HathiTrust already digitized, fetch the digital first and save yourself the scanning time.

---

## Outstanding questions

If any of the items I marked "skip" actually contain unexpected slavery content when you see them on-site, override and grab. The classifications above are my best read from titles; you'll know better when the book is in front of you.

## British-Caribbean slaveholder lead-source queue (2026-07-05, user-supplied)
Same theatre family as UCL LBS / T71 (#119) / British-WI benchmark (#131). Ingest ORDER:
1. **UCL LBS** (1834 compensation) — IN PROGRESS (Wayback path; commit 4c67365ed; dedup fix + validation pending). CC BY-NC-SA → re-hostable.
2. **Jamaican Family Search** (Jamaica Almanacs: slave-owners + enslaved counts; wills/inventories) — **#132**. **NO-REPOST** license → extract facts, cite the primary (PD almanacs), don't re-host.
3. **British Guiana Colonists** vc.id.au (Demerara/Essequibo/Berbice colonist/owner class) + `/edg` — **#134**. Static HTML, no Cloudflare (easy). Verify terms; treat as no-repost until confirmed → facts + cite primary (TNA CO/T71).
RULE 0.5: each MUST add an EMBED phase (→ `embeddings`) so leads reach RAG/search/modals. Each cross-source-links (#128) to LBS awardees + T71 owners.

## International slavery-source catalog — 6-agent research pass (2026-07-05, verified July 2026)
User supplied a ~25-source catalog; researched each thoroughly (access / DOCUMENT IMAGES / licensing /
fields / buildability). The make-or-break question per source = are freely-downloadable images available
(→ re-hostable to S3 = LIFTS the external-assertion gate) vs transcription-only (→ gated secondary lead).
DB ground-truth corrected the catalog: Freedman's Bank is NOT on the spine (0 external-ids, #73 silo);
only 5 id_system namespaces exist; `slavevoyages_enslaver` (51,111) is a coarse label needing re-tag.

### TIER 1 — BUILD NOW (open data + re-hostable/gate-lifting)
| Source | Yield | Docs re-hostable? | gate-class | id_system | Notes |
|---|---|---|---|---|---|
| **Enslaved.org LOD** | E O T | NO images (LOD only) | (secondary) | `enslaved_org_qid` + per-dataset native id | 731,500 people; RDF/JSON dumps no-auth; CC BY-NC-SA per-dataset; **event-centric role→person_type MAPPING needed**; **DEDUP vs our SlaveVoyages+Hall — do NOT re-ingest those**. Highest leverage, Medium complexity. |
| **Dutch: Suriname/Curaçao + 1863 emancipation** | E O T | **YES — CC0 scans** | slave_register / emancipation_register | `hdsc_suriname_slaveregister` / `hdsc_curacao_slaveregister` / `hdsc_emancipation` | Suriname downloadable structured (Radboud, CC-BY-SA); OAI-PMH bulk; mother's-name(from 1848)+owner+mutations; **1863 register = adopted SURNAME** (identity bridge, separate join). Dutch-only; Curaçao emanc ~60%. |
| **Puerto Rico 1872 (T1121)** | E O | **YES — public domain** | slave_register | `pr_registro_esclavos_1872` | Free FS coll 177782 / NARA; **both parents + master's name** (Moret's-Law compensation=dual-ledger); ~30K; harvest per-municipality (no bulk export). Cleanest. |
| **Freedom on the Move** | E O T | **YES — CC BY-NC-SA ad images** | runaway_ad | `fotm_runaway` | Free CSV export; ~32,254 ads pre-parsed into Ad/Runaway/Enslaver/Event, grouped per person. Exact E/O/T fit. |
| **Virginia Untold Free-Negro Registers** | E(freed) O(manumitter) T | **YES — LVA no restrictions** | register_of_free_blacks | `va_untold_free_negro` | Open CSV + CKAN API; 47,000+ names; manumitter+status fields. VA only; MD/DC manual. |
| **Réunion 1848/1832 registers** | E O T | **YES — AD Réunion+ANOM, UNESCO** | emancipation_register | `anom_reunion_affranchissement` | Free public-archive images; name+status+owner+manumission; ~20 registers indexed, rest transcribe. |
| **French Antilles registers (MQ/GP/ANOM images)** | E O T | **YES — public-domain, Licence Ouverte attrib.** | nouveaux_libres / slave_register | `anom_mq_individualite` / `ad971_nouveaux_libres` | Use the ARCHIVE IMAGES (patrimoines-martinique / earchives.archivesguadeloupe / ANOM caomec2), **NOT Anchoukaj** (CM98 proprietary, e-repro forbidden). matricule+assigned surname+habitation(=owner)+mother. OCR. GP Côte-sous-le-vent lost (1918 fire) except Bouillante; MQ ~near-complete. |

### TIER 2 — PERMISSION-FIRST (email agreement before bulk)
- **Danish West Indies (Rigsarkivet)** — E O T; 8M+ pages; **freedom certs + free-coloured lists NAME THE MANUMITTER** (dual-ledger); free browse but **bulk reuse needs written non-commercial agreement** (bars commercial resellers; our non-commercial status fits carve-out). OCR from images. `rigsarkivet_dwi_{series}`. gate-class: slave_register / emancipation_register / freedom_certificate.

### TIER 3 — OCR IMAGE CORPORA (free images, unindexed → existing DocAI pipeline)
- **Brazil: Pombos notarial deeds (FS DGS 4144740, VERIFY) + Catholic parish registers of enslaved** — free FS images; chattel/vital; `fs_pombos_notarial` / `fs_brazil_parish`.
- **Cape SO-series (FS 2739063)** — rich fields incl. mother's name but **images gated (not re-hostable)** → transcription only; + **capeslavesancestry.com CC-BY-NC-SA** transcriptions + TANAP/GLOBALISE entity-tagged corpus. `fs_cape_slave_register` / `capeslavesancestry` / `tanap_cape`.
- **NC Runaway Ads (DLAS/UNCG)** — request dataset ~5K, images confirm rights. `dlas_nc_runaway`.
- **Charleston Estate Inventories & Bills of Sale + Southern Claims** — Fold3 PAYWALLED → go to SCDAH/NARA/FS PD originals; fits `chattel_transfer_events`; targeted DocAI, not bulk. `scdah_charleston_inventory` / `nara_southern_claims`.
- **Mauritius — Nelson Mandela Centre DB** — free login-gated, no images. `mauritius_nmc`.

### TIER 4 — DEFER
Anchoukaj index (CM98 proprietary — use the registers instead) · Cuba ANC (fragmentary, permission-gated;
SSDA per-doc only) · SSDA images (permission-gated, no bulk) · Brazil 1872 Matrículas (destroyed 1890) ·
Indian Ocean + trans-Saharan (aggregate/not person-level digitized).

### CROSS-CUTTING DISCIPLINE
- **id_system PRODUCT-specific** per source (rule #4); re-tag the 51,111 coarse `slavevoyages_enslaver`.
- **Reference-class hygiene:** emancipation/manumission/nouveaux-libres = a DATED freed-status FACT, not "enslaved at place X" (same as Freetown/St Helena recaptives).
- **Gate:** re-hostable register images → S3 → lift the gate per source; transcription-only stay gated secondary.
- **Enslaved.org dedup vs our SlaveVoyages(169K)+Hall(100K)** is the main work — do not double-ingest federated slices we hold.
- **RULE 0.5:** every one of these gets an EMBED phase (→ `embeddings`) so leads reach RAG/search/modals.
- **Verify before scripting:** FS DGS 4144740; First Fifty Years (e-family.co.za) reachability.
- **Suggested build order:** Enslaved.org (leverage) → Dutch → PR-1872 → Freedom on the Move → Virginia Untold → Réunion/French → Danish(permission) → OCR corpora.
