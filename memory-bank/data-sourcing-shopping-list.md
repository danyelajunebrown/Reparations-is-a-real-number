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
