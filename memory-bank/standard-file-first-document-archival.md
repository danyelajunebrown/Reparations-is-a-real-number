# STANDARD — File-first document archival (the FILE lifts the gate, not the URL)

_Codified 2026-07-08 after a below-standard high-profile-enslaver batch was rolled back. Refines RULE 0.6
([[standard-canonical-person-and-document-gate]])._

## The principle (non-negotiable)
**It is the FILE in OUR storage that lifts the gate — never a URL, never a boolean flag.** A canonical is
assertable (`assertable_slaveowner` / `assertable_enslaved`) ONLY when it serves a real, archived document
**file** (`person_documents.s3_key`, a non-empty object in S3) that evidences the proposition. An external
`source_url` is provenance metadata, not evidence — external pages rot, 404, login-wall, and can't be served.

## Why (the failure that taught this)
A roster of famous enslavers (Duncan, Monroe, Heyward, Butler, Calhoun, Madison, Davis, Franklin, Carroll,
Jackson) was ingested by pasting external `source_url`s and setting `evidences_enslaved_holding=TRUE` + a
manual `assertable_slaveowner=TRUE`. Result: the frontend linked out to WhiteHouseHistory.org / LSU 404s, a
guessed URL, malformed URLs (prose appended after the link), and 0KB soft-block files — "barely linking the
page," not archiving. The whole batch was rolled back (20 canonicals / 173 leads / 161 owner-edges / etc.).

## The correct pipeline (in order — do NOT skip or reorder)
1. **GET the file** — fetch the actual document. If the origin bot-blocks/login-walls (rootsweb 403, LSU
   Akamai, Fold3/FamilySearch/Ancestry), get it from an OPEN source: Wayback raw (`web.archive.org/web/
   <ts>id_/<url>` — the IA cache), Harvard Dataverse `api/access/datafile/<id>`, Project Gutenberg `.txt`,
   LOC `tile.loc.gov` PDFs/IIIF JPGs, `iiif.library.cofc.edu` IIIF, open transcriptions. **Use subagents to
   find/verify the open, directly-downloadable URL** (returns the real bytes, not a login/search page).
2. **ARCHIVE (rule 8 dual)** — upload the fetched bytes to S3 (self-host) + Wayback-snapshot the source +
   record in `source_artifacts`. Reject files < 1KB (0KB = soft-block, not a document).
3. **EXTRACT** — OCR/parse to `ocr_text` (HTML→text now; PDF/image OCR follow-on). RULE 0.5.
4. **THEN mint the canonical** with the doc carrying the real `s3_key`; set `evidences_enslaved_holding`
   from the doc content; **gate = EXISTS(a doc with s3_key AND evidences_enslaved_holding)** — never a bare
   flag. **EMBED** (RULE 0.5).
5. Load the named enslaved roster from the archived file → leads + `enslaved_owner_relationships`
   (owner→enslaved, the DAA backbone) + `inheritance_edges` (transmitting ancestor → figure).

## Tooling (built this session, reusable)
- `scripts/archive-roster-documents.mjs` — fetch→S3→Wayback→`source_artifacts`→OCR→set `s3_key`; **Wayback
  IA-cache fallback** when the origin blocks; 1KB size guard.
- Gate recompute is set-based: `UPDATE canonical_persons SET assertable_* = EXISTS(doc with s3_key AND
  evidences_*)`. Verify assertions off files, not flags.
- Schema traps (all hit + fixed): explicit param casts (`$n::text/::int`); `derive_blocking_keys(name,sex,
  birth)`; `person_external_ids` is polymorphic (`subject_table`/`subject_id`, NO `unconfirmed_person_id`);
  `unconfirmed_persons.person_type` ∈ enumerated set (`freedperson`/`enslaved`, NOT `formerly_enslaved`) and
  `.source_url` is NOT NULL; `inheritance_edges.evidence_tier` is INT; SAVEPOINT every risky insert
  (aborted-txn trap). Env fetch on the MacBook 403s many origins — the Mini/agents/Wayback get them.

## Verified open file sources for the roster redo (agent-sourced)
Butler→`gutenberg.org/cache/epub/64804/pg64804.txt` (92) · Franklin→`dataverse.harvard.edu/api/access/
datafile/7679728` TSV (138) · Carroll→WikiTree Space page (213) · Heyward→`iiif.library.cofc.edu/iiif/2/
206023/full/max/0/default.jpg` Fife list (141) · Jackson→`tile.loc.gov/.../01109_0095_0099.pdf` will ·
Madison→OLL S3 PD PDF (Writings vol IX) · Davis→Wayback `.../mswarren.htm` schedule · Duncan→Wayback
`.../duncanwill.html` + LSU `1431m.pdf` via Wayback · Monroe→WHHA article (Spence 1774 inventory, 9 names).
