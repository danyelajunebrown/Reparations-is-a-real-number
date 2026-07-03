# PLAN — Harvest FamilySearch attached sources into kinship edges (scoping, Jul 3 2026)

_Mechanism step 1 of `standard-genealogical-edge-evidence.md`. The DAA chain-of-custody
gate (`DAAOrchestrator._enforceKinshipGate`, step 3) is BUILT and runs audit-only because
no edge yet carries a kinship document. This plan scopes the producer that earns edges out
of tier 3 so the gate can be flipped to `enforce` on a lineage. Build incrementally; the
live scrape is Mini-only (topology + FS connection lifecycle); MacBook builds the pure
classify/write modules + fixtures + tests._

## Goal
For each climbed person, read the records FamilySearch has **attached** to them, keep the
ones that substantiate a parent→child relationship, archive the image to S3, and write a
`canonical_family_edges` row at the earned `evidence_tier` with `source_document_id` set —
replacing `slice(0, 2)` tree-pointer trust and the discovery-method confidence constants
(0.90/0.70/0.75) as the basis for an ASSERTABLE edge.

## Current state (hook points, verified Jul 3)
- Climber visits `/tree/person/details/{FS_ID}` (`familysearch-ancestor-climber.js:83`,
  `extractPersonFromPage()` :598) and takes parents by `foundIds.slice(0, 2)` (:772/:793) —
  **never reads the person's Sources tab** (`/tree/person/sources/{FS_ID}`).
- It CAN already parse relationships off a record ARK page: `extractParentsFromRecord()`
  (:1500) and `extractHouseholdFromCensusRecord()` (:1236). The new work is
  CLASSIFY → TIER → ARCHIVE → WRITE-EDGE, not re-parsing record pages.
- Edges land in `inferred_parent_links` (heuristic constant confidence) — NOT in
  `canonical_family_edges` (the still-open item in `note-climb-resolution-producer-jun27.md`).
- Blocking-key write on mint already exists (`writeClimbKeys()` :55, the Jul-1 door-close).

## Hard dependency — S3 archiving (do not rebuild)
`plan-fs-image-archiving.md` already scoped the archive half: FS attached sources are
filmed-image ARKs (`ark:/61903/3:…`) = the real primary-source images (28,741 distinct);
`/tree/` links are NOT documents. Reuse `src/services/document/S3StorageAdapter.js` to store
the image and `PersonService` person_documents insert. **The gate requires `s3_key` present**
(a bare FS URL does not lift it), so harvest and archive are one pass, or harvest enqueues
the archive drip and writes the edge only once `s3_key` lands.

## Design

### A. Pure classifier (MacBook-buildable, fully testable) — `src/services/climb/kinship-source-classifier.js`
Input: one attached source `{ collectionTitle, recordType, arkUrl, indexedFields }`.
Output: `{ evidenceTier, documentType, evidences: 'parent_of'|'child_of'|null, kinConfidence }`
per the standard's tier table:
- **Tier 1 (0.95+):** will/probate naming X heir/son/daughter; death cert naming parents;
  birth/baptism naming parents; marriage naming parents. `evidences` set from indexed fields.
- **Tier 1 (0.85–0.94):** post-1850 US census with X co-resident in the household of a
  parent at plausible age/sex/place (needs the household parse — reuse `:1236`).
- **Tier 2 (0.70–0.84):** correlated indirect (land adjacency, naming, migration) — flagged
  for human review, never auto-verified.
- **Non-kin / pre-1850 head-only census / bare tree link:** `evidences=null` → drop.
Pure function; fixtures in `tests/fixtures/fs-sources/` (real anonymized source payloads);
unit test asserts each fixture → expected tier/proposition. **No DB, no network.**

### B. Edge writer (MacBook-buildable) — extend the climber's persistence / a `writeKinshipEdge()` helper
Given a classified source + resolved child/parent identities:
1. Resolve child_fs, parent_fs → canonical id via `person_external_ids(familysearch)`, or a
   lead subject via M103 polymorphic (`a_subject_table/a_subject_id`) if not yet canonical.
2. Ensure the source image is archived (S3StorageAdapter) → `person_documents` row with the
   classifier's `document_type` + `s3_key`.
3. Upsert `canonical_family_edges` (`relationship_type` parent_of/child_of, `evidence_tier`,
   `source_document_id`, `confidence`=kinConfidence). **Verified policy (D1, RESOLVED —
   split state-vs-infer):** set `verified=true` ONLY when the document STATES the kinship
   (will names heir; death/birth/marriage cert names parents — `documentType` in the
   STATED-KIN set). Census **co-residence** (0.85 tier-1, inferential) and all tier-2 stay
   `verified=false` → routed to the /review queue for human sign-off.
4. **Conflict handling (D3, RESOLVED — flag, never overwrite):** before writing, check for an
   existing tier-1 edge from the same child to a DIFFERENT parent. On contradiction, write the
   new edge `verified=false`, mark BOTH edges `notes='kinship_conflict'` + route to /review,
   and do NOT lift either. The DAA path gate then reads this as unproven → renders "lineage
   contested at generation N". Never auto-resolve by tier (no silent pick — GPS "resolution of
   conflicting evidence").
5. Keep the `inferred_parent_links` row as a navigation hint (do not delete) but it no longer
   feeds assertability.

### C. Live harvest (Mini-only) — new step in the climber's per-person loop
After `extractPersonFromPage()`, visit `/tree/person/sources/{FS_ID}`
(`waitUntil:'domcontentloaded'`), enumerate attached sources, and for each candidate run the
ARK-page relationship parse (reuse :1500/:1236) → classifier (A) → edge writer (B). Same
connection lifecycle as the climber (connect to 9222, per-image ARK from `page.url()`, JSONB
unicode sanitize, SAVEPOINT-scoped writes). Respects the one-FS-scraper-at-a-time rule.

## Phasing
1. **A — classifier + fixtures + unit test** (MacBook; no deps). ✅ DONE (`993d497ff`)
   `src/services/climb/kinship-source-classifier.js`, 11/11.
2. **B — edge writer + integration test** against a transaction-rolled-back DB
   (MacBook; pattern of `test-gate-role-aware.js`). ✅ DONE
   `src/services/climb/kinship-edge-writer.js` (resolve FS→canonical, ensure
   person_documents, D3 conflict flag, SELECT-first upsert with D1 verify), 11/11 live-DB.
   Confirmed: census co-res → verified=false, stated will+s3_key → verified=true, stated
   without s3_key → not verified, conflict → both edges unverified+flagged, M103 trigger
   syncs polymorphic cols. NOTE: person_documents unique index is (canonical_person_id,
   unconfirmed_person_id, s3_url, name_as_appears) — pre-archive s3_url is NULL so the
   per-source identity is carried in name_as_appears (`kinship:<type>:<sourceUrl>`).
3. **C — wire into the climber's loop** behind a flag (e.g. `CLIMB_HARVEST_SOURCES`), dry-run
   on ONE fixture lineage (Hopewell / Nancy Brown G21N-4JF) on the Mini, measure edges/person.
4. **Flip** `DAA_KINSHIP_GATE=enforce` for that lineage once its path is edge-to-edge
   documented; regenerate the DAA and confirm each link renders its citation.
5. **Backfill** pass over existing climb sessions (separate, sequenced against de-siloing
   Step 4 like #92) — do NOT bulk-run before the per-lineage flow is proven.

## Decisions (RESOLVED Jul 3 2026)
- **D1 — auto-verify tier-1? RESOLVED: split state-vs-infer.** Auto-`verified=true` only for
  document-STATED kinship (will/death/birth/marriage naming the parent/heir); census
  co-residence (0.85 tier-1, inferential) + all tier-2 stay `verified=false` pending human
  sign-off. Matches M102 (a stored doc lifts the gate) while withholding it from inference.
- **D2 — leads vs canonical for the edge ends. RESOLVED: write M103-polymorphic**
  (`a_subject_table/a_subject_id`), correct whichever way the deferred lead-vs-canonical
  demotion goes (`plan-climb-as-gated-lead-source.md` Phase D).
- **D3 — conflicting parents. RESOLVED: flag, never overwrite.** A contradictory tier-1 edge
  → both edges `verified=false` + `notes='kinship_conflict'` + /review; the DAA renders
  "lineage contested at generation N". No auto-resolve by tier (GPS conflict-resolution).

## See also
`standard-genealogical-edge-evidence.md` (the spec) · `plan-fs-image-archiving.md` (S3 half) ·
`plan-climb-as-gated-lead-source.md` (Phase B/D) · `note-climb-resolution-producer-jun27.md`
(canonical_family_edges still-open) · `standard-canonical-person-and-document-gate.md`.
