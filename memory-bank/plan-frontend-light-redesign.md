# Plan — Frontend light redesign + RAG surfacing (frontend/light-redesign branch)

_Created 2026-07-07. Grounds the "Part 1" frontend-overhaul brief. Source of truth for this
workstream; update as builds land._

## STATUS (2026-07-11): a→e COMPLETE + DEPLOYED + integration-debt pass + runtime guardrails
Objectives (a) design system, (d) primitives+one-data-layer, (b) schema-driven fields, (c) zoomable
viewer+primary-sources-up, (e) RAG Ask surface — all built, deployed to gh-pages-react, smoke-verified
11/11. INTEGRATION-DEBT pass done: signature primitives (LedgerFigure/SealBadge/EvidenceBlock) wired,
`.table-scroll` applied, VersionGate/ErrorBoundary relit, SubmitWillPage relit. GUARDRAILS added:
`smoke-test-frontend.mjs` + `verify-deploy.mjs` (chained into deploy:gh-pages). STILL OPEN (non-loose-ends):
(1) RAG LIVE = Render OLLAMA_URL→Mini ops step ([[plan-rag-prod-wiring]]); (3) broaden RecordDetail beyond
PersonProfile; (6) thorough per-view responsive pass; (e+) embed-persons backfill on the Mini. Per-item
detail in the Status checklist at the bottom.

## Research grounding (what this plan is built on)

- **CLAUDE.md + memory index** re-read (RULE 0/0.5/0.6). **activeContext.md** current-state read:
  promotion reckoning, RULE 0.5 (RAG on every DB/search/modal step), RULE 0.6 (a canonical serves an
  image + is RAG-embedded), and the **settled RAG boundary** (RAG feeds OCR→embeddings + aids discovery;
  RAG ⊥ the COUNT, which stays pure SQL per audit Rule 1).
- **Full frontend inventory** (direct reads + a completed sub-agent sweep). See "Current state" below.
- **RAG/document backend contract** read directly (`src/api/routes/chat.js`, `rag.js`).
- **frontend-design skill** consulted for the aesthetic direction; every color pair WCAG-AA hand-verified.
- GAP (honest): the six memory-bank files were NOT all read in full this session (two recon agents died
  on a session API limit). `productContext.md` / `systemPatterns.md` / full `progress.md` still to skim.
  The person-profile + search endpoint RESPONSE shapes (`contribute.js`) are known only via how
  `PersonProfile.jsx` consumes them — CONFIRM against the handler before building (b)/(c).

## Current state (facts the plan must respect)

- **Stack:** Vite 6 + React 18 + react-router-dom 6 + d3 (LineageGraph only) + ethers (blockchain).
  No UI/state/data library. **One** stylesheet `frontend/src/styles/global.css`. **One** central API
  client `frontend/src/api/client.js` (`api.*` + `isVerified`/`filterVerified` verified-only gate).
- **Two deploys:** backend Express on Render (auto-deploy on push to `main`); frontend built manually via
  `cd frontend && npm run deploy:gh-pages` → `gh-pages-react` branch → GitHub Pages. Pushing `main` does
  NOT deploy the frontend. Frontend SOURCE lives in the working tree (this branch is off the audit branch).
- **Heaviest components:** PersonProfile (735), SubmitWillPage (763), DocumentViewer (582),
  ReparationsBreakdown (377). DocumentViewer has NO true zoom/pan (fit-width only).
- **Dead/dupe:** `Layout/StatsRibbon.jsx` is dead (superseded by LedgerSection); `PersonResult` and a
  `Field`/`Section` helper are re-implemented across Home/Search/PersonProfile/DocumentViewer/etc.;
  the wills flow (SubmitWillPage) bypasses the central client with 4 ad-hoc `fetch` calls.
- **Mobile:** ONE media query in the whole codebase (grid collapse < 768px). Layout is mostly inline
  `style={{}}` with fixed px sizes. Phone-first is a hard mandate → this is a real gap.
- **No RAG/chat UI exists** — objective (e) is net-new.
- **Hardcoded inline colors** (resist the token flip): SubmitWillPage (many, dark-theme), a few in
  PersonProfile (fixed this session) and DocumentViewer (its `#000` lightbox backdrop is intentional —
  keep). The 7-class taxonomy + `.badge` styles were dark-tuned → retuned to AA-on-paper this session.

## Design system — DONE (objective a) ✅

Committed: `feat(frontend): bright light 'archive/ledger' design system`. Rewrote the `global.css` token
layer + base elements to a bright, WCAG-AA light "archive/ledger" identity. Paper bg `#F4F3EE`, near-black
ink, three type voices (serif display / sans body / mono ledger), ink-blue accent `#14567A`, evidence
palette (seal/​debt/​flag), the "ledger spine" signature (`.provenance-chain`/`.evidence`). Legacy token
names kept as aliases so every component flips with no markup change. Build verified green.
**AA pairs (vs paper):** ink 15.7 · ink-soft 6.2 · accent 7.2 · seal 5.8 · debt 8.4 · err 5.9 · borders 3.1.

## Sequenced plan (remaining)

### (d) Consolidate primitives — do FIRST (unblocks b/c, low risk)
New `frontend/src/components/ui/` primitives, extracted from the duplicated markup:
`Field`, `Section`, `PersonCard` (folds the two `PersonResult`s), `Badge`/`SealBadge`, `EvidenceBlock`
(the ledger spine), `LedgerFigure` (the `.figure-ledger` amount), `Citation`, `EmptyState`/`ErrorState`.
Move the 4 wills `fetch` calls into `api.*`. Delete dead `StatsRibbon`. Add a `.table` style to global.css
(ReparationsBreakdown/LegalTopic reference an undefined `.table`). Acceptance: primitives used across all
main views; one API client; consistent loading/error/empty.

### (b) Schema-driven field layer (absorb a growing schema)
New `frontend/src/api/fieldRegistry.js`: one config object mapping DB columns →
`{label, group, priority, format, voice}` (voice = body|mono for IDs/figures). A `<RecordDetail>`
primitive renders any record from the registry sorted by priority, with progressive disclosure (top
fields first; the rest under "Show all fields"). Adding a DB column = a ~one-line registry entry.
Refactor PersonProfile's identity grid to consume it (keep the bespoke evidence/enslaved sections).
Acceptance: new column surfaces via one config line; nothing currently shown is lost; high-use fields first.

### (c) Primary sources higher + zoomable viewer
- Reorder PersonProfile so the **primary-source block (scan + its derived record, paired)** sits directly
  under the identity header, above secondary commentary. The pairing = the citation surface (e) reuses.
- Replace the fit-width image in DocumentViewer with **OpenSeadragon** (free, MIT, IIIF-capable → covers
  both tiled S3 scans and the Hamilton LoC IIIF cash books). Lazy-load it; thumbnails first, full on tap;
  pinch/pan on mobile. Always go through presigned URLs (`/api/documents/:id/access`,
  `/person-doc/:pdId/access`). **Verify rendering on mobile Safari** (known S3 image quirk). Keep the dark
  `#000` lightbox backdrop.
- Acceptance: on a person with a scanned primary source, scan + derived record appear high, open in a
  mobile zoomable viewer via presigned URLs.

### (e) RAG chat/search surface (net-new)
- Add `api.ragQuery(question, k)` → `POST /api/rag/query` and (optional) `api.chat(message)`.
- New `frontend/src/components/Chat/AskPanel.jsx` (mobile-first): a question box + streamed answer +
  a **Sources list** built from `citations[]`. Each citation is `{document_id, source_url, document_type}`
  → link to `/documents/:document_id` (opens the existing DocumentViewer) — the (c) pairing.
- **Drive it off `/api/rag/query`, not `/api/chat`** (the latter is a keyword router over LEADS with a
  hardcoded reparations formula — surfacing it raw would violate honesty + Rule 1). rag/query gives
  `grounded:false` / `degraded:true` → the UI says "No documents matched — nothing to ground an answer
  on" HONESTLY, never invents. Wire the same retrieval into search + person modal per RULE 0.5.
- Acceptance: NL question → grounded, cited answer with citations that OPEN the source; empty-retrieval
  handled honestly; no new paid dep; `/api/rag/query` contract respected.

### (e+) Records-level RAG — BACKEND workstream the frontend consumes
Today only ~51K `doc_ocr` embeddings exist (`GET /api/rag/health`); `canonical_persons` are NOT embedded,
so chat "over the records" is blind to them. Extend the embed pipeline (`embed-persons.mjs`/`embed-*`
pattern, nomic-embed-text on the Mini ollama) to embed canonicals + distinguishing evidence into
`embeddings`, idempotent/resumable. Index/retrieve at the CANONICAL layer (deduped by construction).
**Hard invariant (RULE 0.6 + audit): records-level RAG is candidate-generation ONLY — never an autonomous
merge/assert; the deterministic scorer + evidence gate stay sovereign.** Optional later: Postgres hybrid
retrieval (tsvector + vector, RRF k≈60) — propose before implementing.

### RAG eval harness
`scripts/eval-records-rag.mjs` + frozen `tests/fixtures/rag-eval/gold.json` (resolve gold canonical IDs
once at fixture-build, freeze — do NOT hardcode guesses). Cohorts 1–7 + metrics per the brief. Hard gates
(100%, never regress): identity precision/disambiguation, honest abstention, citation correctness, no
autonomous merges. Calibration bars: served-gold recall@k, stratified random-sample recall@k (the coverage
headline — expected ~0 before backfill), dedup candidate-recall-vs-blocking-keys delta, link-or-mint
accuracy. Baseline all numbers into activeContext.md.

## Constraints (every step)
Phone-first, test ~380px + mobile Safari. Free/low-cost only (no paid embed/vector/font). Don't break
Render/Neon/S3/Mini-RAG or the `/api/*` contracts. Honesty — no fabricated data, no fake retrieval, honest
empty states. Don't touch methodology / evidence gate / scrapers / blockchain. Commit in focused units;
`git pull` before large edits (parallel-session race). Manual deploy only (`npm run deploy:gh-pages`).

## Deeper grounding (full governing memory-bank read, 2026-07-07)

Read in full: projectbrief · productContext · systemPatterns · techContext · interpretive-framework ·
activeContext (current + relevant history) · progress (structure) · plan-phase2-rag · reckoning-retrieval-
epistemology · standard-{canonical-person-and-document-gate, external-source-ingest, deployment-and-versioning,
genealogical-edge-evidence} · promotion-layer-component-map · assessment-de-siloing-orphaning ·
plan-identity-resolution-completion · plan-96-person-status-model · finding-ny-probate-audit-jul01.
(Deferred as backend-ingest detail outside this presentation task: the ~28 source/methodology/ops topic
files — LBS, Suriname/enslaved.org, IPUMS, probate rebuild, freedmens, benchmark register, wealth-tracing,
deed-parcel, cuba, chrome-recovery, prompt-economics, obligation-calibration, etc. Read on demand.)

Constraints these add to the build (beyond the objectives above):

- **Dignity/terminology (interpretive-framework):** UI copy centers the enslaved; never normalize
  enslavers' language (preserve original terms only in quoted source text, with analytical framing).
  "1 of N"/count-derived rows are POPULATION PLACEHOLDERS, not assertable persons — never render a
  placeholder as a named individual. Empty/error states tell the truth (reckoning + brief honesty rule).
- **Reparations is a directed VECTOR, never a per-person net (plan-96, user-verbatim):** a dual-status
  person (enslaved-then-enslaver, e.g. William Ellison) sits on BOTH ledgers as TWO separate directed
  obligations to DIFFERENT counterparties. The UI must show them separately and MUST NEVER sum a person's
  credit against their debit. Reinforces audit Rule 1 (no model output aggregated/summed).
- **Status-as-facts (plan-96 P5):** person status lives in `person_facts` (time-bounded, cited,
  contestable) — the profile should surface these as the evidence layer; `person_type` is a lossy display
  summary only. The schema-driven field layer (b) should render `person.facts` grouped by fact_type.
- **Kinship-edge gate (standard-genealogical-edge-evidence):** family edges are gated tier-3 (navigable,
  NOT assertable) until a proposition-specific kinship doc; the profile may LINK a gated parent/child edge
  but must never render it as a proven "ancestor of." Show the edge's evidence tier / verified state.
- **RAG = core epistemic infrastructure, not a UI feature (reckoning, debt-registry #1):** objective (e)
  pays down the named debt "RAG built but adopted nowhere on the read surface." The AskPanel/grounded
  retrieval is the point, not decoration; every answer cites rows; RAG stays STRICTLY read/exploration —
  it must NEVER feed a DAA figure or any aggregated number (audit boundary).
- **(e+) is mostly RUN, not build:** `embed-persons.mjs` / `embed-documents.mjs` / `find-semantic-dup-
  candidates.mjs` already exist (report-only, Biscoe-safe). `embeddings` table = polymorphic
  `(subject_table, subject_id, content_kind∈{doc_ocr,person_profile}, model, vector(768), content_hash)`,
  HNSW cosine. Embed backend = nomic-embed-text on the Mini ollama (`EMBED_SOURCE=ollama` REQUIRED or it
  silently falls back to the 429-capped Gemini; CONC=1; OLLAMA_MAXCHARS=2000). Dedup dry-run PROVEN:
  key-clustering is NOT dedup (distinct same-name people dominate) → semantic NN is a RECALL lane into the
  scorer + gate, never an autonomous merge (Biscoe). Issue #63 (enslaved-lead resolver) is the real build.
- **Live query-embedding on Render:** Render is NOT on the tailnet → the live `/api/rag/query` path needs
  the Mini's ollama exposed via Tailscale Funnel (set Render `OLLAMA_URL`, or Funnel the RAG route off the
  Mini's own Express). Query space must match corpus space (nomic), never mix gemini-query with nomic-corpus.
- **Citations → `documents` table:** RAG `citations[].document_id` refer to the `documents` table (VARCHAR
  PK), which the frontend already opens via `api.getDocument`/`getDocumentAccess` → DocumentViewer. Person
  scans are `person_documents` (served via `/person-doc/:pdId/access`). Keep the two straight in the (c)↔(e) pairing.
- **Deploy discipline (standard-deployment-and-versioning):** VersionGate + `build <sha>` footer already
  ship and MUST be preserved (they were — design system kept both). Manual frontend deploy only.
- **Parity/selection-bias caveat (NY audit):** DB is ~97% perpetrator/victim; enslaved leads carry a flat
  0.85 confidence; connective free-person tissue is under-built. Browse/search UI should not over-imply
  completeness; confidence display should not present a flat 0.85 as a meaningful per-record signal.

## Status
- [x] (a) design system — committed, build-green, VALIDATED against the full read (preserves the gate-stub
      rendering, VersionGate, dignity framing; the ledger-spine signature mirrors the evidence-gate epistemology).
- [x] (d) primitives + client consolidation — committed, build-green. `components/ui/index.jsx`
      (PersonCard/DocumentCard/Section/states + evidence primitives); Home+Search consume them;
      wills fetch → api client (ingestWill/getWillCandidates/linkWill + requestMultipart); StatsRibbon
      → _archive; `.table` style added. FOLLOW-UP: migrate PersonProfile/DocumentViewer/CorporateEntity/
      BlockchainPanel/LegalTopic off their local `Field`/`Section` copies onto the shared primitives.
- [x] (b) schema-driven field layer — committed, build-green. `api/fieldRegistry.js` (PERSON_FIELDS) +
      `<RecordDetail>` primitive; PersonProfile Identity grid is now registry-driven (priority order +
      progressive disclosure + estimation badge). Adding a column = one registry line (demoed with
      primary_state/county/status). confidence_score deliberately omitted (flat-0.85 caveat).
      FOLLOW-UP: extend RecordDetail to the enslaved-persons list + owner block if useful.
- [x] (c) primary-sources-up + zoomable viewer — committed, build-green, DEPLOYED. `ZoomableImage`
      (OpenSeadragon 6, lazy-loaded → own 86KB-gzip chunk); pinch/pan cross-browser (Chrome/Chromium/
      Android/Edge/Safari/Firefox), no crossOrigin on presigned S3, <img> fallback, IIIF-capable via
      `tileSources`. Wired into DocEmbed + DocCollectionOverlay (PDF/external paths unchanged). PersonProfile
      now shows the PRIMARY source high (after Identity), secondary low. RUNTIME zoom + mobile-Safari/S3
      render need on-device verification now that it's live.
- [x] (e) AskPanel — committed, build-green (NOT yet deployed). `api.ragQuery` → POST /api/rag/query;
      `components/Ask/AskPanel.jsx` + `/ask` route + nav. Grounded answer + Sources (citation document_id →
      /documents/:id → zoomable viewer = the c↔e pairing). Honest states: not-grounded → "no answer given";
      degraded → "unavailable"; never fabricates. Read-only (no reparations figure).
      **OPS DEPENDENCY (blocks live answers):** Render isn't on the tailnet → /api/rag/query returns
      degraded until `OLLAMA_URL` (Tailscale Funnel to the Mini's nomic/ollama) is set on Render. Runbook:
      [[plan-rag-prod-wiring]]. CORRECTION (from code re-read): a gemini query-embed is NOT a valid
      shortcut — the corpus is nomic space; gemini vectors don't match it (would need a full re-embed).
      UI handles degraded honestly today.

## Follow-ups after a→e (done 2026-07-07)
- [x] Wire retrieval into search + person-modal (RULE 0.5): AskPanel reads ?q= and auto-runs; SearchPage
      has a grounded "Ask the archive about <query>" CTA; PersonProfile header has "Ask about <name>".
      Committed + build-green (deploy pending with this batch).
- [x] Migrated BlockchainPanel's specialized hex Field onto the shared primitive (shared Field →
      overflowWrap:anywhere). All 5 display-Field copies now consolidated (SubmitWillPage's is a
      form-input Field, different component, left).
- [~] RAG prod-wiring — RUNBOOK written ([[plan-rag-prod-wiring]]); code is ready (reads OLLAMA_URL).
      Needs Mini (`tailscale funnel 11434`) + Render env (`OLLAMA_URL`) + `embed-persons.mjs` on the Mini,
      then re-run the eval for baselines. Your lane (MacBook can't run the Mini).
- [x] SubmitWillPage relit onto the design tokens (all hex/rgba/monospace → tokens) — the contribute form
      was the last dark view; the WHOLE public UI is now light. Committed + DEPLOYED.
- [~] (e+) eval harness DONE + committed; Mini backfill DEFERRED (topology). `scripts/build-rag-eval-
      fixture.mjs` (resolves+freezes gold IDs from live DB, ambiguity flagged not guessed) →
      `tests/fixtures/rag-eval/gold.json`; `scripts/eval-records-rag.mjs` (hard gates + calibration
      baselines, degrades honestly). Verified end-to-end vs prod → degraded (Render not on tailnet).
      REMAINING: (1) OLLAMA_URL/Tailscale-Funnel so /api/rag/query works in prod; (2) run
      `embed-persons.mjs` on the Mini to embed canonicals; (3) re-run the harness for real baselines.
      DATA-QUALITY FINDINGS to act on: roster marquee enslavers serve scans but assertable=FALSE
      (Ward #828471/Jefferson #828182/Lee #828469); AR "George Washington" #452284 assertable=TRUE (#118
      wrong-human still live). Also: RECORDS-level recall needs person-embeddings (deferred) + a
      doc→canonical map before "correct canonical in top-k" is measurable.
