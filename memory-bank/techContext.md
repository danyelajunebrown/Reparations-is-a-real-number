# Technical Context: Reparations Is A Real Number

> **SUPERSEDED IN PLACE (reconciled 2026-07-31).** The authoritative current sources are
> `activeContext.md`, `standard-canonical-person-and-document-gate.md`,
> `standard-file-first-document-archival.md`, and `CLAUDE.md`. This file is kept for the
> salvageable operational facts below; the obsolete schema/blockchain sections have been gutted.

**Last Updated:** July 31, 2026 (heavy reconciliation of a Dec 23, 2025 draft that described a dead
schema and a deleted blockchain subsystem)

## Technology Stack

### Backend
- **Runtime:** Node.js 18+ (CommonJS modules)
- **Framework:** Express.js 4.18.2
- **Language:** JavaScript (ES6+)
- **Process Manager:** Render platform (production), PM2 on the Mac Mini (scrapers), nodemon (dev)

### Database
- **Primary Database:** PostgreSQL on **Neon** (shared by all three machines via `DATABASE_URL`;
  pooler host `ep-still-glade-ad8qq83f-pooler…`). Render is the API host, **not** the DB host.
- **TWO drivers are installed and both are in use — they behave differently:**
  - `@neondatabase/serverless` (HTTP) — **`rowCount` is always 0 for UPDATE/DELETE**. Always use
    `RETURNING id` and count `result.rows.length`. A failed JSONB cast inside a transaction leaves
    the connection "aborted" (every later query silently fails) — scope risky casts with `SAVEPOINT`.
  - `pg.Pool` (TCP) — `rowCount` works correctly. **Production runtime uses `pg.Pool`.** Scripts vary;
    check before assuming.
- **Schema Management:** numbered SQL files in `migrations/` (tracked in `schema_migrations`, column
  is `filename`). Now past migration 129.

### Storage
- **Cloud Storage:** AWS S3 (SDK v3: @aws-sdk/client-s3)
- **S3 Bucket:** `reparations-them`
- **S3 Region:** **us-east-2** (IMPORTANT: NOT us-east-1 — the bucket lives in us-east-2 and a client
  defaulting to us-east-1 gets an S3 `PermanentRedirect` on every request). Presigned URLs only for
  browser access. All source-document images live here (dual-archived S3 + Wayback per the
  file-first archival standard).

### File Processing
- **File Upload:** Multer (50MB limit)
- **OCR Primary:** Google Cloud Vision / Document AI (regional endpoint
  `us-documentai.googleapis.com` required; global returns PERMISSION_DENIED). Gemini OCR is the
  fallback after the Vision key suspension (see probate memory).
- **OCR Fallback:** Tesseract.js
- **PDF Parsing:** pdf-parse; `pdftoppm -r 150` for large scans (>10MB pages blow the Vision inline limit)
- **Image Processing:** Sharp

### Web Scraping
- **HTTP Client:** Axios
- **HTML Parser:** Cheerio
- **Browser Automation:** Puppeteer — **`puppeteer.connect()` to `http://127.0.0.1:9222` only, never
  `puppeteer.launch()`** (crashes the Intel-Mac Mini). All scraping runs on the Mac Mini.

### Blockchain
- **OBSOLETE.** The Ethereum/Truffle/Web3/OpenZeppelin/Ganache/IPFS stack described in the Dec 2025
  draft is gone — those 11 packages were removed in the Jul-19 dependency audit. There are **no web3
  libraries in the tree.** The Base `ReparationsEscrow` contract still exists on-chain
  (`0x914846ceA07e57d848d9d60C8238865D83d9ab1E`), but the **PAYMENT layer is DORMANT / anachronistic**;
  the project's live purpose is identity + obligation (the DAA), not settlement.

### Frontend
- **UI Framework:** React + Vite (terminal aesthetic, verified-data-only), branch `gh-pages-react`
- **Static Hosting:** GitHub Pages (manual deploy: `cd frontend && npm run deploy:gh-pages`)
- **API Communication:** Native Fetch API

---

## Machine Topology (three machines, one Neon DB)

| Machine | Role |
|---------|------|
| MacBook (this machine) | Code, deploy, schema work. **No scraping.** |
| Mac Mini (studio) | Chrome `:9222` + all Puppeteer scrapers (FS, probate, DocAI), the climber, **and the ollama embed host** (`nomic-embed-text` on `:11434`). |
| Raspberry Pi | Intake-form kiosk only (touchscreen → `?mode=kiosk` → Google Form iframe). |
| Neon (Postgres) | Shared by all three via `DATABASE_URL`. |
| Render | Backend API, auto-deploys on push to `main`. |
| GitHub Pages | Frontend (`gh-pages-react` branch). |

Render and GitHub Pages share one egress IP → rate limits need `skip:` for high-traffic paths.

---

## Server Architecture

### Single Production Server
- **`src/server.js`** — Main production server, **~629 lines** (the old "~2,600 lines" figure was
  never true of this file; mounts modular routers and a handful of inline endpoints).
- **Render deployment:** `npm start` → `node src/server.js`, binds `0.0.0.0`.

### Route Structure (src/server.js)

Modular routers under `src/api/routes/` (documents, chat, contribute, health, errors, rag). The
`rag` router is new (RAG retrieval surface). Static assets are served from the repo root.

---

## Identity & Person Data Model (CURRENT — replaces the dead `individuals` schema)

> The Dec 2025 draft described `individuals` / `unconfirmed_persons` / `documents` / `scraping_queue`
> as the identity model. **That model is DEAD.** Do not use those tables as the source of truth.

**All identity flows through one door:** `src/services/PersonService.js` (~551 lines) —
`findOrCreateLead()` → `promoteToCanonical()`. Nothing should write person rows around it.

- **Leads** are the staging layer (polymorphic lead identity, migrations 101–105).
- **`canonical_persons`** is the confirmed layer. Key columns:
  `canonical_name` (NOT `full_name`), `birth_year_estimate` / `death_year_estimate`,
  `sex` (NOT `gender`), `primary_state` / `primary_county` / `primary_plantation`,
  `person_type ∈ {enslaver, enslaved, descendant, modern_person, participant, merged, unknown}`.
  There is **no unique constraint on `canonical_name`** — SELECT-first dedup, never `ON CONFLICT`.
- **`person_documents`** — the source-image layer, `s3_key`-backed (a canonical must *serve* an image).
- **`person_external_ids`** — polymorphic external identifiers (FamilySearch ARK / WikiTree /
  SlaveVoyages / Ancestry). External ids go here, **never in `notes`**.

### The canonical gate (governs every promotion)
- **RULE 0.6:** a lead becomes `canonical_persons` ONLY when it is (1) deduped/discrete (Biscoe rule),
  (2) serves a proposition-specific S3 document image (`person_documents.s3_key`, dual-archived), AND
  (3) is embedded in RAG (`embeddings`). "Every canonical serves an image and is in RAG."
- **RULE 0.5:** every ingest MUST add an EMBED phase (into `embeddings`, e.g. `embed-persons.mjs` /
  `embed-documents.mjs`). Unembedded data is a **retrieval silo** — invisible to RAG/search/modals.

### Relationships, land, and value
- **Family edges:** `canonical_family_edges` (M103 polymorphic; now carries `information_type` per
  **migration 127**). Supersedes the old `person_relationships_verified`-only story for canonical edges.
- **Wealth transmission:** `inheritance_edges`.
- **Land:** `properties` / `land_transfer_events` / `modern_parcel_links`.
- **Value:** `estate_valuations`.

---

## RAG Retrieval Layer (exists, largely orphaned)

`src/services/rag/RagService.js` + `scripts/rag-query.cjs` + `/api/rag/query`, backed by
`nomic-embed-text` on the Mac-Mini ollama (`:11434`) writing `embeddings` (pgvector, migrations
107/124/126). **Caveat:** RagService is imported by ~zero live read paths (chat.js and the new
rag.js route only) — live search/modals still run **ILIKE** against Postgres. RULE 0.5 exists to
close this gap ingest-by-ingest; treat RAG as the intended door, not yet the actual one.

---

## Environment Configuration

```bash
DATABASE_URL=postgresql://…@ep-still-glade-ad8qq83f-pooler…/…   # Neon, all three machines
S3_ENABLED=true
S3_BUCKET=reparations-them
S3_REGION=us-east-2                    # IMPORTANT: us-east-2, NOT us-east-1 (PermanentRedirect otherwise)
GOOGLE_VISION_API_KEY=…
PORT=3000
NODE_ENV=production
```

---

## Scraping Data Flow (CURRENT — gated leads, not a confidence shortcut)

> The Dec 2025 draft routed high-confidence scrapes "→ `individuals` if confidence ≥ 0.9". **That
> contradicts the canonical gate and is wrong.** Confidence alone never promotes anyone.

```
Scraper (Mac Mini, Chrome :9222)
         ↓
PersonService.findOrCreateLead()      # everything enters as a gated LEAD
         ↓
lead staging (polymorphic identity, migrations 101–105)
         ↓
promoteToCanonical()  — ONLY if RULE 0.6 is satisfied:
    (1) deduped/discrete  AND
    (2) serves an S3 person_documents image  AND
    (3) embedded in RAG (embeddings)
         ↓
canonical_persons + person_documents + person_external_ids
```

Confidence tiers still gate *evidence quality* (0.95+ government primary … <0.50 OCR/ML needing
review), but they do not substitute for the image + embed requirement.

---

## Descendant / Obligation Model (CURRENT — replaces the `enslaved_descendants_*` tables)

> The Dec 2025 draft's `enslaved_descendants_suspected` / `enslaved_descendants_confirmed` /
> `enslaved_credit_calculations` / `wikitree_search_queue` schema (a per-descendant "credit ledger"
> tied to `wallet_address`) is **superseded** and should not be treated as live.

The output is the **Debt Acknowledgment Agreement (DAA)** — a generated, cited legal instrument.
The computation lives in the DAA ledger model:
- **DAAOrchestrator** — assembles the instrument from documented ancestors + citations.
- **DisgorgementCalculator** — the debt computation (Craemer 2015 canonical formula; dual ledger —
  compensation TO enslavers is evidence of debt, not credit against it).
- **`land_transfer_events`** and **`indigenous_land_provenance`** (migration 125, non-claim) carry the
  land/wealth-tracing side.

No number that reaches a DAA is model-summed: the model orchestrates, deterministic code computes,
humans review, and every figure traces to a row + citation + methodology version.

---

## Extraction Scripts — salvaged operational facts (still load-bearing)

### FamilySearch OCR garbage filters (`scripts/extract-census-ocr.js`)
Full OCR pipeline for 1850/1860 Slave Schedules, with garbage filtering for FamilySearch **UI text**
that OCR otherwise ingests as person names:
```javascript
const ocrGarbage = new Set(['genealogies', 'catalog', 'full', 'text', ...]);
const garbagePhrases = new Set(['genealogies catalog', 'full text', ...]);
```

### Civil War DC extraction (`scripts/extract-civilwardc-genealogy.js`)
Parses **semantic HTML** from DC Emancipation petitions:
- `<span class="persName">` for names
- `<span class="placeName">` for locations
Extracts petitioners, enslaved, demographics, and inheritance chains — **467 relationships from
1,051 petitions**. (Caveat carried from project memory: civilwardc persons are currently tagged
`enslaver` though petitions were filed BY the enslaved — roles inverted; don't feature as
slaveholders and don't blind-flip.)

### Rootsweb "Large Slaveholders of 1860" (Tom Blake) parse format
County pages parse slaveholder entries in the format:
```
NAME, # slaves, Location, page #
Example: ADAMS, John, 98 slaves, Athens, page 19
```
Also extracts 1870 African-American surname-match data from the index.

### WikiTree scrapers — rate limits & caps (still enforced)
- **Batch search** (`scripts/wikitree-batch-search.js`): rate-limited **1 request per 3 seconds**;
  tries **LastName-1 through LastName-200**; resumable.
- **Descendant scraper** (`scripts/wikitree-descendant-scraper.js`): safety caps of **8 generations /
  500 descendants**; parses GEDCOM from WikiTree HTML.

*(The `slave_owner_descendants_suspected` / `wikitree_search_queue` sink tables these scripts wrote to
belong to the superseded descendant schema above — the scrapers' rate-limit and cap facts are what
remain load-bearing.)*

---

## Common Issues & Solutions (still current)

### Issue: S3 PermanentRedirect Error
**Cause:** S3 bucket is in us-east-2 but the client defaults to us-east-1.
**Solution:** `S3_REGION=us-east-2` in `.env` and the config default.

### Issue: Population progress
Progress is tracked toward the **393,975** population goal (`/api/population-stats`).

---

## Population Goal

The canonical population target is **393,975** documented persons.

---

*This document is a reconciled remnant. For anything not explicitly salvaged above, defer to
`activeContext.md`, the `standard-*.md` gates, and `CLAUDE.md`.*
