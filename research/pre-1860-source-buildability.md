# Pre-1860 & International Slavery Source Buildability Map

_Deep-research pass, 2026-06-23 (24 sources fetched, 25 claims verified 3-vote adversarial, 22 confirmed / 3 killed). For the pre-1860 document-coverage expansion: ingest BOTH structured data AND source files into our S3 + Internet Archive/Wayback backup, strict provenance._

## Headline finding (reframes source strategy)

**The entire U.S. census stack does NOT name the enslaved.** The 1850 & 1860 Slave Schedules (NARA Form 14125, 8 columns) and the 1790–1840 population schedules record enslaved people **only as counts/demographics under the slaveholder's name** — no enslaved-person name column ("The slave schedules do not give the name of the slave"). A FamilySearch indexing project surfaced only ~4,287 enumerator-written-in names across the 1850 **and** 1860 schedules combined (deviations, not a feature).

So the census set serves **slaveholder identity + enslaved counts** (continuity/attribution + countrywide time-series) — NOT named-enslaved coverage. Named-enslaved coverage lives elsewhere (SlaveVoyages PAST, manifests, FOTM, T71 registers).

1790 schedules are **lost entirely** for Delaware, Georgia, Kentucky, New Jersey, Tennessee, Virginia (1814 Capitol fire) — rely on 1800–1840 for early coverage there.

## Per-source map

| Source | Access | Named? | License / re-host | Format | Effort |
|---|---|---|---|---|---|
| **1850 Slave Schedule** | FamilySearch/Ancestry scrape (login) | **No** (owner + age/sex/color) | Federal scans public-domain | Page-image scans → OCR | **Low** (reuses 1860 pipeline) |
| **1790–1840 population schedules** | FamilySearch/Ancestry/IPUMS | **No** (owner + counts) | Public-domain | Tabular household schedules | Medium (new parse); 1790 lost in 6 states |
| **SlaveVoyages PAST — African Origins** | **Bulk download** | **Yes — ~95,153 named** liberated Africans (1808–1862) | CC BY-NC 3.0 → **S3 OK** (attribution) | Structured, machine-readable | **Very low** |
| **SlaveVoyages PAST — Oceans of Kinfolk** | **Bulk download** | **Yes — ~63,562 named** (New Orleans coastwise, 1818–1860; + enslaver links) | CC BY-NC 3.0 → **S3 OK** | Structured | **Very low** |
| **SlaveVoyages Intra-American DB** | Bulk download | **No** (voyage-level, 5 age/sex categories; ~27K voyages) | CC BY-NC 3.0 | Structured | Low (but not named) |
| **Freedom on the Move** | API / permissioned (NO free bulk download — refuted 0-3) | **Yes** (~27K+ transcribed runaway ads; enslaver-given first name) | Terms unconfirmed for re-host | Machine-readable transcriptions + coded metadata | Medium (per-record/API friction) |
| **NARA New Orleans manifests (M1895)** | Archives.gov + Ancestry (online; NOT microfilm-only — refuted 0-3) | **Yes** (name/age/sex/height/color + owner; 1820–1860) | Federal public-domain → **scans S3 OK** | Page-image scans; structured data best via Oceans of Kinfolk (same population — don't double-count) | Medium |
| **UCL Legacies of British Slave-ownership** | UCL repo (ReShare doesn't host file) | **No** — names slaveOWNERS (~40K claims / ~47K individuals, ~8K estates, 1740–1839, British Caribbean) | **No stated redistribution license → clarify; link/Wayback-only for now** | Structured | Low data / license risk |
| **British Caribbean T71 registers (1817–1834)** | Ancestry (TNA owns image IP) | **Yes — names enslaved** (Jamaica, Trinidad, etc.) | **OGL v3.0 → images S3 OK** (attribution; TNA license to Ancestry is non-exclusive) | Page-image scans; transcription state unknown | High (OCR burden unresolved) |
| **Iberian-Atlantic (Brazil/Cuba/Spanish)** | Slave Societies Digital Archive (Vanderbilt), liberatedafricans.org, BARDSS | Mixed/named | Per-source | Mixed | Unresolved — needs its own pass |

## Ranked recommendation (named-or-attributable coverage per unit of ingest effort)

1. **SlaveVoyages PAST (African Origins + Oceans of Kinfolk)** — ~158K named enslaved, structured/machine-readable, bulk-downloadable, **S3-re-hostable (CC BY-NC 3.0)**, zero scrape/login contention. Highest yield per effort by far.
2. **Freedom on the Move** — ~27K+ named, machine-readable, but no free bulk download (API/permission).
3. **NARA New Orleans manifests** — ~63K named but **same population as Oceans of Kinfolk** (take structured data from SlaveVoyages; treat scans as provenance backup).
4. **British Caribbean T71 registers** — large named coverage, OGL-re-hostable images, but transcription/OCR burden unresolved.

**Re-hostable to our S3:** SlaveVoyages structured+imputed data (CC BY-NC 3.0); NARA manifest scans (public domain); T71 images (OGL v3.0). **Link/Wayback-only (do NOT auto-store):** SlaveVoyages externally-sourced images/essays (third-party rights); **UCL LBS** (no stated redistribution license — clarify first). **Descope for *named* coverage:** all U.S. census schedules (owner + counts only — but still valuable for the countrywide slaveholder+count time-series).

## Build order & directives (updated 2026-06-23)

1. **SlaveVoyages PAST** (named enslaved) — pipeline built (M100 + `source_artifacts` + ingest + wayback); acquisition pending (auth-gated API / SPA).
2. **Census FREE population schedules with estate-value columns** — *user directive: this comes BEFORE the 1850 slave-schedule rescrape.* The **estate-value columns are gold-standard wealth data** for the valuation/DAA methodology, and the page images go to S3 alongside the structured values.
   - Accuracy nuance: estate-value columns exist only from **1850 (Value of Real Estate)** and **1860 (Real + Personal Estate)** free population schedules — **1790–1840 have none** (counts only). 1860 *personal* estate capitalized enslaved people as property → the slaveholding-wealth gold. We hold the 1860 *slave* schedule but likely **not** the 1860 *free* population schedule with these value columns.
3. **1850 Slave Schedule rescrape** (slaveholder + counts time-series).

Each census/manifest image-ingest reuses `source_artifacts` (M100) for the S3 + Wayback provenance of the page image.

## Open questions
- T71: does a clean machine-readable transcription exist, or OCR from scratch?
- UCL LBS: exact redistribution license basis (file S3 vs link-only)?
- FOTM: exact API / permissioned-export mechanism + re-host terms?
- Which SlaveVoyages-served images are third-party (Wayback-only) vs Consortium-owned (S3)?
- Iberian-Atlantic named sources (Slave Societies Digital Archive, parish registers) — produced no verified claims; needs a dedicated pass.

_Sources: archives.gov (1850 form, 1790, manifests), legacy.slavevoyages.org (downloads, legal), slavevoyages.org (intra-American), freedomonthemove.org, nationalarchives.gov.uk (FOI CAS-284035, OGL v3.0), reshare.ukdataservice.ac.uk/852209, jsdp.enslaved.org (CTNO article), unesco.org (T71 registry)._
