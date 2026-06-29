# PLAN — Archive FamilySearch document images to S3 (scoping, Jun 29 2026)

_Triggered by the live "FamilySearch login wall shown as a document" bug (user screenshot,
person/canonical_persons/487165). The display half is fixed (DocumentViewer external-URL guard,
redeployed from main Jun 29 — gated/FS docs now show an "Open on FamilySearch ↗" link, not an
iframe). This plan scopes the DATA half: the documents that have no archived image._

## #3 finding (487165) — the login wall was the STALE DEPLOY, not missing data
person 487165 (Washington Chapman) HAS a properly archived doc — `doc#159581`
`census_slave_schedule`, real `s3_key` (`archives/slave-schedules/1860/florida/jackson/…png`),
correctly `assertable_slaveowner=true`. The live backend `/api/documents/person-doc/159581/access`
returns a WORKING presigned S3 URL (`presigned:true`). So the image was always there; the OLD
deployed frontend predated both the presigned-URL endpoint usage AND the iframe guard, so it fell
back to `source_url` (FamilySearch) → login wall. **#1's redeploy fixes the whole class** — every
doc that DOES have an `s3_key` (234,684 of them) now serves the S3 image. (My earlier "0 docs for
487165" was an audit query bug: selected `assertable_*` columns that live on canonical_persons, not
person_documents.) So the ONLY remaining gap is the docs with NO s3_key (below).

## The real numbers (audited)
- `person_documents` total **608,954**; with a real `s3_key` **234,684 (38.5%)**.
- FS docs with NO `s3_key`: **316,938** — but only **109,845 distinct `source_url`** (heavy dup).
- These split into TWO populations (both currently `document_type='familysearch_record'`):
  1. **Filmed-image ARKs (`ark:/61903/3:…`): 235,833 docs = ONLY 28,741 DISTINCT images.** These are
     genuine primary-source images (slave schedules, wills, etc.) → **ARCHIVE these to S3.** Tractable
     (~28.7K images, same order as the probate drip).
  2. **`/tree/` profile / record links (~81K docs):** NOT document images — FamilySearch tree
     references → **RELABEL, do not archive/embed** (they were never primary sources).

## Why archiving alone isn't enough — RECLASSIFY too
`recomputeGate` lifts the M102 assertion gate only when a stored doc's `document_type` is in
DOC_PROP_SLAVEOWNER/ENSLAVED. These docs are the generic `'familysearch_record'`, which substantiates
NOTHING. So an archived image won't un-gate a person unless its `document_type` is also corrected to
the real kind (census_slave_schedule / will / etc.). **Archiving + reclassification go together** —
the ARK / collection metadata usually identifies the record type.

## Approach (reuse, don't rebuild)
- Reuse the probate image→S3 path (`scripts/scrapers/georgia-probate-scraper.js` /
  `familysearch-scraper.js` + `src/services/storage/S3Service.js`).
- DRIP on the Mini, honoring: **one FS Puppeteer scraper at a time** ([[feedback_one_fs_scraper_at_a_time]]);
  FS session/index-wall caveats from the probate run ([[project_ny_probate_run]] — stale-cookie-jar,
  VNC re-login); ntfy progress.
- Per image: download → S3 (`s3_key`+`s3_url`) → set the corrected `document_type` →
  `PersonService.recomputeGate(canonical_person_id)` so any now-qualifying gate lifts.
- Dedup by the 28,741 distinct ARKs (fetch each once; fan out to all docs sharing it).

## Sequencing / size
- ~28,741 distinct images at an FS-safe drip rate (the probate run did ~thousands/week within
  rate+session limits) → on the order of WEEKS, not months. Prioritize by proposition value:
  census_slave_schedule / will / estate_inventory / DC-petition first (they lift gates).
- The ~81K `/tree/` docs: a cheap one-shot reclassification to a non-embeddable
  `document_type='familysearch_reference'` (or similar) so the viewer shows a link, never an iframe,
  and they never count as primary sources.

## Caveat / open question for the user
This is a FamilySearch re-scrape of ~28.7K images — real FS load + the same auth/index-wall
operational burden as the NY probate run. Worth confirming priority vs. other ingest, and whether to
gate it behind the existing probate drip (one-scraper rule).

See also: [[project_canonical_source_document_audit]] (the 7%→73% source-doc backfill — same
problem class), `standard-canonical-person-and-document-gate.md` (why s3_key matters).
