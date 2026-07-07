# Plan — Vision-OCR Router + Reconciled Enslaved-Count Aggregation (issue #142)

**Date**: 2026-07-06 · **Status**: integration map from a full architecture re-read; build #1 in progress.
Both builds HEAL existing silos — they plug into three seams and remove a duplicate on the way in.

## Seam 1 — Vision-OCR router (BUILD 1)
The pluggable seam already exists: `OCRService.js:22` holds `this._transcribeImage = transcribeImage` (from
`src/services/probate/gemini-ocr.js`), signature **`transcribeImage(buf, {mimeType, prompt}) → string`**. Build the
router BEHIND that signature, mirroring `src/services/probate/probate-llm-extractor.js` `buildProviders()`/`callLLM`
(multi-provider, 429-fallthrough, env-reorderable), but with VISION models via OpenAI-compatible `image_url`:
- **`qwen/qwen2.5-vl-72b-instruct` (OpenRouter) — PRIMARY** (verified EXACT on 1860 cursive: Forrest ages
  [30,22,18,16,14,8,15]=7; UNCAPPED — OpenRouter has credit).
- `gemini-2.5-flash` via its OpenAI-compat endpoint (`…/v1beta/openai/chat/completions`) — secondary (accurate, daily-capped).
- `openai/gpt-4o` (OpenRouter) — tertiary.
- `VISION_PROVIDERS` env reorders/restricts (bake-offs).

**Consolidation:** `src/services/vision/vision-router.js` exports `transcribeImage`. `gemini-ocr.js` becomes a thin
delegate (keeps its probate default prompt, forwards to the router) → OCRService + probate + `reextract-hand-uploaded-wills`
all upgrade transparently. **Silos it heals:** `OCRProcessor.js` + `scripts/extract-census-ocr.js`/`test-fs-ocr.js` are
still Vision-primary → silently Tesseract-degraded since the Google Vision key was suspended (#126); repoint them too.
(Leave Document AI wrappers `document-ai-extractor.js`/`FreedmensBankProcessor.js` alone — structured extraction, different axis.)

## Seam 2 — Reconciled enslaved-count method (BUILD 2)
The real bug is a DIVERGENCE, not missing data:
- **DAA** (`DAAOrchestrator.js:276`) counts NAMED rows (`aggregateEnslavedData` unions `enslaved_individuals` +
  `family_relationships(enslaved_by)` + `unconfirmed_persons.relationships` + `enslaved_owner_relationships`, dedup by name)
  AND carries a **DEAD `enslaved_count` reference** (L1035/1062/1085/1106/1132 read `dbSlaveholder.enslaved_count` but the
  `documentedSlaveholders` query L915-933 never SELECTs it → always `undefined`).
- **`contribute.js:1741-1747`** is the ONLY consumer of `person_documents.enslaved_count`:
  `SUM(enslaved_count) … ; effectiveEnslavedCount = max(named.length, documented)`.

**Build one method** `enslavedCountFor(canonicalId) → {count, sources, partial}` that both DAA and contribute.js call:
`SUM(person_documents.enslaved_count)` (walk/OCR completeness) ∪ owner-lead aggregation (the **1.4M enslaved leads with
`relationships->>'owner'`**, matched via **PersonService blocking keys**, NOT raw `LOWER(owner_name)=` — handles
"Paul Cameron"/"Paul C Cameron" variants) ∪ named edges; reconciled (max/union). **Route all owner-name matching through
`PersonService.resolve`** — every current reader re-matches by raw lowercased name (the fragmentation). The
`enslaved_owner_relationships` writer (`build-enslaved-owner-edges.mjs`) already resolves owner→lead via
`PersonService.findOrCreateLead` but leaves owner-lead→canonical DEFERRED — that's the seam to finish.

## Seam 3 — Distributed-holding completeness (BUILD 3)
The index is PARTIAL: "Joshua J Ward" = only **71** owner-referenced enslaved leads vs his walked **1,130**. Big planters'
enslaved are distributed across counties/states on separate schedules (Hampton SC+MS; Cameron Person+Orange NC; Aiken
Jehossee). Reuse the climber's `searchFamilySearchRecords(person)` (familysearch-ancestor-climber.js:967 — already does
FS search-by-name) pointed at an owner → all their schedule ARKs → **vision-router OCR** → footer counts →
`person_documents.enslaved_count` per doc, deduped via blocking keys. This closes the 71→1,130 gap for distributed holders.

## Build order
1. Vision router (foundation the other two stand on). 2. `enslavedCountFor` (heals the DAA/contribute divergence).
3. Distributed walk (needs 1+2). See [[reference_familysearch_session_reauth]] for the FS-session op constraint.
