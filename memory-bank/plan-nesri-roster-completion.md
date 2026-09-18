# PLAN — NESRI enslaver-roster completion (Dutchess → NY-state) — data request first, sliced scrape fallback

_Our NESRI Dutchess data is TRUNCATED: the scrape capped alphabetically ~A–B (~474 leads / 115 families of
~2,569 Dutchess records), so major Hudson-Valley enslaver families (Livingston, Van Rensselaer, Roosevelt,
Verplanck, Beekman, Ten Broeck) are missing. Completing the roster unblocks candidate identification for the
modern-endpoint program. Builds on [[assessment-dutchess-calibration-case-study-jul19]] §6, [[plan-dutchess-full-ingest]]
Phase 1, [[standard-external-source-ingest]] (Rule 8 dual-archive, provenance-to-lead)._

## Source facts (carried — do not re-derive)
- **NESRI = Northeast Slavery Records Index**, CUNY Graduate Center. Public scholarly project (presents to the
  NY State Legislature). Sites: `nesri.commons.gc.cuny.edu`, `nyslavery.commons.gc.cuny.edu`, `nesri.us`.
- **Delivery:** a **Caspio** search DataPage (searchable by owner last name, county, record type, year, 9-state
  radio). **38-field schema** incl. genealogy fields (Parent/Sibling ID Codes) that are **empirically EMPTY for
  Dutchess** — so NESRI is the **enslaved→ENSLAVER attribution layer + enslaver roster**, NOT a maternal-genealogy
  source.
- **Volume:** ~2,569 Dutchess · ~38,000 NY · ~94,000 across 9 NE states.
- **Export cap:** the results page's "Download Data" (`a.cbResultSetDownloadLink`) gives a native 38-column CSV,
  but **Caspio caps each export at ~250 rows** → full Dutchess needs SLICED searches.
- **Courtesy:** rate-limited public scholarly infrastructure; the project's own note **prefers a DATA REQUEST over
  scraping**. No confirmed bulk CSV/API is published.

## PART 1 — DATA REQUEST (preferred first move)

Ready-to-send email (fill the `[TBD]` placeholders — contact + our identity — before sending):

> **To:** [NESRI / CUNY-GC contact — from the NESRI Contact/About page or the NY.gov deck's credited team; else the
> general project inbox, ask to be routed]
> **From:** [OUR PROJECT NAME] · [requester name + role] · [affiliation] · [reply-to email] · [project URL]
> **Subject:** Data-export request — Northeast Slavery Records Index (Dutchess County / New York State) for a
> non-commercial reparations-accountability research project
>
> Dear [CONTACT / NESRI Project Team],
>
> I am writing on behalf of [OUR PROJECT NAME], a **non-commercial, scholarly reparations-accountability research
> project**. We are building a county-scale, records-based reconstruction of enslavement in Dutchess County, NY —
> pairing enslaver-side records (colonial censuses, probate wills, manumissions) with enslaved-person records to
> support a documented, reference-class-honest accounting. The work is public-interest; **it is not commercial and
> will not be resold.**
>
> NESRI is the most complete compiled index of the enslaver-attribution records we need, and we would much rather
> work **with** your infrastructure than around it. We ask whether the project would share a **data export**, and
> under what terms.
>
> **Requesting (in order of preference):** (1) **Dutchess County, NY** — the full set (~2,569 records, all record
> types), with the complete ~38-column field set incl. Source Document + record year + name/code fields; (2)
> ideally the **full NY-state set** (~38,000); (3) any subset — even the Dutchess Enslaver + Enslaved-Persons types
> alone unblock us. **Format:** whatever is easiest (CSV/Excel/dump/one-time bulk access); we map your native schema
> ourselves.
>
> **Why we ask rather than scrape:** NESRI is served through a Caspio search page whose export is row-capped, so
> completing the county via the public interface means many sliced queries against your servers. A single export is
> far gentler and gives cleaner, more citable data. If a share isn't possible we'll fall back to a strictly
> rate-limited retrieval — but we wanted to ask first, out of courtesy and per your own stated preference.
>
> **Attribution:** we cite the Northeast Slavery Records Index (CUNY-GC) on every record; please share your
> preferred citation string. Each record retains its NESRI unique ID + Source Document provenance in our system;
> we do not re-host your data publicly without permission. **Licensing/terms:** please tell us any restrictions on
> redistribution/derivative use and whether you'd like a data-use agreement or acknowledgment. We'll work within
> whatever conditions you set and share findings back.
>
> With gratitude and respect for the project,
> [REQUESTER NAME · ROLE · PROJECT · affiliation · email · project URL]

**On receipt (if yes):** ingest via `scripts/ingest-nesri-csv.mjs` (idempotent on externalId = NESRI Enslaver/
Enslaved Person Code); Rule-8 provenance (`source_artifacts` + `ensureSnapshot()` → `wayback_url`; link-only re-host
unless permission granted); record the agreed citation + license.

## PART 2 — FALLBACK: sliced-scrape completion (ONLY with explicit user go)

Trigger only if the request is declined/unanswered (~2–3 wk) or the user chooses not to wait. Scraping a public
scholarly source requires explicit user approval.

- **Slice key:** surname-initial (the truncation is itself alphabetical — natural resumable axis); sub-slice any
  over-250 letter by record year / record type. Keep a **slice manifest** (letter/year → row count → CSV → ingested?)
  as the resumable cursor (probing sizes is slow — ~15s/search).
- **Infra:** dedicated **Chrome :9223** (isolated from the FS/climb :9222):
  `open -na "Google Chrome for Testing" --args --remote-debugging-port=9223 --user-data-dir=/tmp/nesri-chrome`
  (no login; `protocolTimeout: 240000`; rate-limited cadence).
- **Per slice:** `scripts/scrapers/nesri-scraper.js` drives the Caspio form for the slice → confirm <250 rows →
  "Download Data" CSV (CDP `Page.setDownloadBehavior`) → `scripts/ingest-nesri-csv.mjs <slice>.csv --apply`
  (idempotent; Enslaver→enslaver leads, Enslaved→enslaved leads + owner edges, Census→benchmark denominators NOT
  rows, Ship/Site skipped; all via `PersonService.findOrCreateLead`, id_system 'nesri', secondary 0.85).
- **After the full pull:** re-run `scripts/nesri-crossref-dutchess-enslavers.js` so NESRI enslavers cross-link to
  our census/will enslavers (Livingston/Van Rensselaer/Roosevelt/Verplanck/Beekman/Ten Broeck finally land) →
  `linkage_verdicts`. Rule-8 dual-archive; EMBED per RULE 0.5; Biscoe-safe dedup.

## PART 3 — WHICH FIRST
1. **DATA REQUEST FIRST** — the project's own preference, gentlest on Caspio, cleaner/more-citable data, opens the
   licensing/attribution channel we need regardless.
2. **SCRAPE ONLY AS FALLBACK, WITH EXPLICIT USER GO** after a ~2–3 week wait (or the user's decision not to wait).
3. **Both routes converge:** the complete Dutchess (ideally NY) roster ingested, the missing Hudson-Valley families
   present, cross-source verdicts re-run, Rule-8 provenance recorded → candidate ID for the modern-endpoint program
   unblocked.

## Guardrails
No fabricated persons from counts (census → benchmarks, not rows) · Biscoe dedup (flag, never auto-merge) ·
secondary-tier 0.85 ceiling until manuscript originals · Rule-8 dual-archive (Wayback non-optional; S3/link-only for
this scholarly source) + honor CUNY-GC's data-use terms · NESRI courtesy (rate-limited, dedicated :9223, request first).
