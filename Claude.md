# CLAUDE.md

> Loaded at the start of every session. Keep under 220 lines. Prune ruthlessly when adding.
> Last reviewed: 2026-06-30.

## RULE 0 — Read the memory bank BEFORE doing anything (non-negotiable)

Before acting on ANY task, **re-read the relevant `memory-bank/` files** (start with `activeContext.md`,
the relevant `plan-*.md` / `standard-*.md`, and `interpretive-framework.md`). **The memory bank is the
source of truth.** Do NOT decide from immediate context or from model/training knowledge — ground every
decision in the memory bank, and write project knowledge back to `memory-bank/` (not `~/.claude`). This
file is only a pointer; the memory bank governs.

## What this project actually is

An aggregated database of digitized slavery records, indexed to **enslaved persons**, **enslavers**, and **opted-in descendants of both classes**. The output that justifies the work is the **Debt Acknowledgment Agreement (DAA)** — a generated, signed legal instrument that names every documented slaveholder ancestor of a descendant and every documented enslaved person owned, with primary-source citations (FamilySearch ARKs, MSA certificates, civilwardc petitions, etc.), and that grounds annual government petitions under an Article V framework. DAAs are settled via the `ReparationsEscrow` contract on Base mainnet.

The README at repo root is out of date and describes an older “document upload pipeline” scope. The scope above is canonical.

## Audit-grade rules (non-negotiable)

1. **No model output gets aggregated, totaled, or summed.** The model orchestrates; deterministic code computes; humans review. Any number that appears on a DAA must trace to a row, a citation, and a methodology version.
1. **Every external claim has provenance.** `confidence_score` is real; the 4-tier model below is enforced at write time, not annotated after.
1. **Compensation TO enslavers is evidence of debt, not credit against it.** The dual-ledger model. The enslaved received $0; descendants are owed at minimum what was paid for the labor.
1. **The Craemer 2015 formula is the canonical reparations calculation.** Do not introduce new formulas or constants without a citation. The Ager/Boustan/Eriksson “2.5x multiplier” does not exist in the cited paper; do not reintroduce it.
1. **No fabricated data.** No “Unnamed enslaved person(s)” placeholder rows. Real or absent.

## Confidence tier model (from DATA_SOURCE_INTEGRATION_CONTRACT.md)

|Range    |Meaning                                                                      |
|---------|-----------------------------------------------------------------------------|
|0.95+    |Government primary source (DC petitions, census, MSA certificates of freedom)|
|0.85–0.94|Scholarly verified database (Louisiana Slave DB, UCL LBS)                    |
|0.70–0.84|Cross-referenced secondary source                                            |
|0.50–0.69|Single-source, unverified                                                    |
|<0.50    |OCR/ML extraction needing human review                                       |

Hynson DC Runaway Cases and other Heritage Books compilations have a `max_evidence_tier='secondary'` ceiling until NARA RG 21 originals are located.

## Database identity model (current)

Data flows: `unconfirmed_persons` → (promotion in same script as import) → `canonical_persons`. External identifiers go in `person_external_ids` (FamilySearch / WikiTree / SlaveVoyages / Ancestry), **never in `notes`**. Family relationships go in `person_relationships_verified` and `canonical_family_edges`. Wealth transmission goes in `inheritance_edges`.

**Identity fingerprint status:** broken. Migration 033 created `identity_fingerprint` and the trigger but the formula requires `last_name + birth_year_estimate + primary_state` all non-NULL. Birth year is NULL on ~99% of rows. 157/559,984 rows have fingerprints. See `memory-bank/plan-identity-resolution-completion.md` — tiered fingerprint (Tier 1 birth year, Tier 2 county, Tier 3 soundex) is scoped, not built.

## Critical schema facts

```
canonical_persons:
  canonical_name (NOT full_name)
  birth_year_estimate / death_year_estimate (NOT birth_year / death_year)
  sex (NOT gender)
  primary_state, primary_county, primary_plantation
  person_type ∈ {enslaver, enslaved, descendant, modern_person, participant, merged, unknown}
  NO spouse_name column — use canonical_family_edges
  NO unique constraint on canonical_name — use SELECT-first dedup, not ON CONFLICT

unconfirmed_persons:
  lead_id (NOT id), full_name, locations text[] (branch lives in locations[0])
  confirmed_individual_id is VARCHAR — cast to ::integer when copying to canonical_person_id
  relationships is JSONB array — docai_fields lives at relationships->1->'docai_fields'
  NO canonical_person_id column

person_relationships_verified:
  person_id, related_person_id (NOT person1_id / person2_id)

will_extractions:  id is UUID, not INTEGER
schema_migrations: column is filename (NOT migration_id)
inheritance_edges.asset_type: real_property | enslaved_persons | personal_estate |
                              monetary_bequest | residual_estate | trust_interest |
                              business_interest | mixed | unspecified
```

## DB driver trap

Two drivers are installed. Both are in use. They behave differently:

- `@neondatabase/serverless` (HTTP) — `rowCount` always returns 0 for UPDATE/DELETE. **Always use `RETURNING id` and count `result.rows.length`.**
- `pg.Pool` (TCP) — `rowCount` works correctly.

Production runtime uses `pg.Pool` (Session 50). Scripts vary. Check before assuming.

## FamilySearch rules

- **`puppeteer.connect()` to `http://127.0.0.1:9222` only.** Never `puppeteer.launch()` — crashes Intel Mac Sonoma.
- **macOS Chrome launch:** `open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/familysearch-ancestor-climber`. SSH/PM2 cannot directly spawn Chrome (no window server access).
- **Wait strategy:** `waitUntil: 'domcontentloaded'`, never `networkidle0`/`networkidle2`. FS is an SPA; networkidle never fires.
- **Per-image ARK** is extracted from `page.url()` after viewer navigation. Never use the group ARK (e.g., `9SYT-PT5`) as an image ARK.
- **`ensureLoggedIn` redirects** `familysearch.org/` → `/en/home/portal/` during sleep, which destroys the page execution context. Always wrap `page.evaluate()` in try/catch and fall back to `page.url()` check.
- **JSONB cast unicode trap:** FS transcripts contain U+2300-23FF / U+2500-257F / U+2100-214F which Postgres rejects when casting to JSONB. Sanitize before any DB write.
- **Aborted-transaction trap:** a failed cast inside an open transaction leaves the Neon connection in “aborted” state — every subsequent query silently fails. Always wrap risky queries in `SAVEPOINT` so rollback is scoped.

## Google Vision / Document AI rules

- **Regional endpoint required:** `apiEndpoint: 'us-documentai.googleapis.com'`. Global endpoint returns PERMISSION_DENIED.
- **10MB inline limit on Vision.** PDFs OCR’d at `pdftoppm -r 300` produce >10MB pages. Use `-r 150` for large scans (Session 52 Hugh V will, EPIPE).
- **False-positive validator** lives at `scripts/enrich-freedmens-docai.js` (validateFields, 200 lines). When extracting from any new DocAI processor, reuse this logic — do not re-derive. It should be promoted to `src/services/extraction/fp-validator.js` (Tier B work).

## Topology

|Where                               |Role                                                                                             |
|------------------------------------|-------------------------------------------------------------------------------------------------|
|MacBook (this machine)              |Code, deploy, schema work. **No scraping.**                                                      |
|Mac Mini (studio)                   |Chrome + all Puppeteer scrapers (FS, probate, DocAI enrichment).                                 |
|Raspberry Pi                        |Intake-form kiosk only (touchscreen → `?mode=kiosk` → Google Form iframe).                       |
|Neon (Postgres)                     |Shared by all three. `DATABASE_URL` end-to-end.                                                  |
|Render                              |Backend API, auto-deploys on push to `main`.                                                     |
|GitHub Pages                        |Frontend at `gh-pages-react` branch. **Manual deploy:** `cd frontend && npm run deploy:gh-pages`.|
|Base mainnet                        |`ReparationsEscrow` at `0x914846ceA07e57d848d9d60C8238865D83d9ab1E`.                             |
|S3 (`reparations-them`, `us-east-2`)|All source-document images. Presigned URLs only for browser access.                              |

Render and GitHub Pages share a single egress IP — rate limits need `skip:` for high-traffic paths like `/api/contribute/stats`. Don’t stack two limiters; `express-rate-limit` adds, doesn’t replace.

## Test fixtures (always available)

|Person                            |canonical_persons.id|Use                                           |
|----------------------------------|--------------------|----------------------------------------------|
|James Hopewell (enslaver, d.1817) |1070                |Will-OCR + DAA E2E                            |
|Angelica Chesley/Hopewell (wife)  |140299              |Spouse edge testing                           |
|Ann Maria Biscoe (daughter)       |141015              |Inheritance edge testing                      |
|Hugh Hopewell V (father, d.1777)  |193376              |Promote-to-enslaver flow                      |
|Hugh Hopewell VI (brother, d.1785)|609495              |Sibling edge testing                          |
|Henry / Mary Ann Weaver (DC)      |196747 / 609494     |DC compensation petition flow                 |
|Nancy Brown (descendant)          |climb test target   |`G21N-4JF` for `generate-comprehensive-daa.js`|

## Active workstreams (June 2026)

1. **Probate data-quality rebuild** — Liberty County GA (1 of ~130). Branch `audit/probate-classifier-and-source-documents`, 8 commits unpushed.
1. **Identity resolution completion** — tiered fingerprint, scoped not built.
1. **Land transfer extraction** — `land_transfer_events` has 1 row. Wills bequeath land; not extracted. Blocker for the wealth-tracing pivot.
1. **MSA Archive + UCL LBS promotion** — both at “unconfirmed only” gap in DATA_SOURCE_INTEGRATION_CONTRACT.

## Aspirational (do not pre-build)

- Private-dollar tracing (bank lineages, county land records, stock transfers across mergers/successors)
- Corporate calculators with real data (currently gated behind “research in progress” per Issue #7)
- IPUMS Census slaveholder names (request pending with `ipumsres@umn.edu`)

When these become active, see `memory-bank/wealth-tracing-framework.md` for the methodology and `Phase 17` of `memory-bank/progress.md` for the seed corporate work.

## How to behave in this codebase

- **Read first.** Check `memory-bank/activeContext.md` for what session is currently active. Check `memory-bank/progress.md` for what’s been done.
- **Do not propose alternative formulas, methodologies, or “improvements” to the financial calculation layer** without reading Issues #2–#25 and Craemer 2015 first. Three formulas producing 37x divergence is what we already cleaned up.
- **Do not write new scrapers that talk directly to FamilySearch DOM** without going through the same connection lifecycle that `scripts/scrapers/familysearch-ancestor-climber.js` uses. When a `FamilySearchClient` module exists (Tier B), use it.
- **Do not introduce new dependencies** without confirming. We have two PG drivers, two browser-automation libs, two Web3 libs, and two smart-contract toolkits already — that’s enough.
- **When in doubt about a column name, query the live DB.** Don’t guess from old migrations.
- **For any DAA-touching code, assume an auditor will read it.** Comments explaining *why* a number is what it is are not optional.

## Pruning discipline

This file is read by every session. If you add to it, remove or relocate something of equal or greater length. Things that belong elsewhere:

- Per-session work logs → `memory-bank/activeContext.md`
- Historical decisions → `memory-bank/progress.md` (already 2,500+ lines, fine)
- Long-form methodology → `memory-bank/wealth-tracing-framework.md` and `memory-bank/plan-*.md`
- Static project trees → never (they go stale; let the OS show them)
- Lists of every MCP tool / schema column / library version → never (the model can ask)
