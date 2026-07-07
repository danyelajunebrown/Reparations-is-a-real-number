# PLAN — gate-lift campaign: served-but-gated enslavers (turnkey)

_Created 2026-07-07. Proven end-to-end on Hugh Hopewell V (#193376). This is the batch
version. Backend/data campaign — run as a coordinated drip (Mini), NOT ad-hoc._

## The problem (live counts, 2026-07-07)
Enslaver canonicals that SERVE an S3 scan but are `assertable_slaveowner=false` (gated
despite having the document — the scan is attached, the gate was never lifted):
- **10,890** total (will 7,367 · other 3,347 · estate_inventory 775 · estate_account 128 · … · census_slave_schedule 8)
- **7,967** served by a will/probate scan → the `reextract-hand-uploaded-wills.mjs` target
- **39,681** served will/probate DOCUMENTS have no extracted enslaved content
- Context: only 34,626 enslavers assertable today (this backlog ~+30%)
Same disease as RULE 0.6 / promotion-reckoning + the parallel "high-profile enslaver
front-end audit" top-10 (Duncan/Heyward/Calhoun/Madison/Monroe/Franklin/Carroll…).

## The per-person recipe (verified on Hugh V)
1. `reextract-hand-uploaded-wills.mjs --id <person_documents.id> --apply` → OCR (gemini-ocr;
   Cloud Vision is suspended) + LLM extract → writes `will_extractions.structured_extraction_jsonb`
   with `enslaved_persons[]` + `enslaved_persons_count`.
2. Sync the extracted count onto the DOC + lift the gate BY DERIVATION (not hand-set):
   ```sql
   UPDATE person_documents SET enslaved_count = <n>, evidences_enslaved_holding = (<n> > 0)
   WHERE id = <doc_id>;
   ```
   then `PersonService.recomputeGate(<canonical_id>)` → derives `assertable_slaveowner`.
   (Verified: Hugh V doc#570111 → count=2 [Jacob, Harry] → recomputeGate → assertable=true → serves un-gated on prod.)

## STATUS: both pipeline root causes FIXED (commit f6ce350a0, 2026-07-07) — campaign now RUNNABLE
Hugh V fully completed (`--relink --apply`): assertable=true, 2 enslaved linked, 6 family edges incl.
James Hopewell #1070 as his child (gated tier-3). The `--apply` path now extracts + links + lifts the
gate automatically for any of the 7,967. Remaining = run the batch drip (Mini, coordinated). Details of
what was fixed, below, for the record.

## TWO PIPELINE ROOT CAUSES — FIXED (both in reextract)
1. **CHECK-constraint bug — `scripts/reextract-hand-uploaded-wills.mjs:228`** creates heirs with
   `personType: 'free_person'`, which migration 110's `chk_canonical_person_type` REJECTS (allowlist
   has free_black/free_poc/free_person_of_color, NOT free_person). → fatal on the entity backfill.
   FIX: change to an M110-valid value (`unknown` is the safe neutral; or `free_person_of_color`; or
   ALTER the constraint to add `free_person` per #96's "add a role = ALTER both the SQL check +
   person-roles.js"). This blocks heir/enslaved links (Hugh V's family edges + Jacob/Harry person
   rows are still pending because of THIS).
2. **No gate-sync — reextract never sets `person_documents.enslaved_count`/`evidences_enslaved_holding`
   nor calls `recomputeGate`.** So even a fully-successful extract leaves the gate DOWN. FIX: after
   writing will_extractions, sync `enslaved_persons_count` → the doc + call `recomputeGate(canonicalId)`
   (step 2 above), inside the script.

## Batch design (after the two fixes)
- Enumerate the 7,967 will/probate-served gated enslavers (query in this doc's problem section).
- Drip on the Mini (like the probate cron): N/tick, resumable, idempotent (skip already-assertable),
  budget-aware (free LLM router — OpenRouter :free workhorse gpt-oss-120b, daily reset).
- Per record: reextract → gate-sync. Log count-before/after; ntfy on drain.
- Per audit Rule 1: enslaved_count is GROUNDED in the document's named/counted enslaved — never a proxy.
- **COORDINATE with the parallel enslaver-shore-up session** (commit/gate-recompute collisions hit twice
  this session). Ideally one owner runs the drip; the other pauses gate-recompute during batch windows.

## Hugh V — COMPLETE (2026-07-07)
Both fixes applied + `--relink --apply` re-run: assertable=true, Jacob/Harry linked, 6 family edges
(James Hopewell #1070 now his child; father Hugh Sr; others) — all gated tier-3 (verified=false) per the
kinship-evidence standard. Nothing left on Hugh V.

## See also
[[standard-canonical-person-and-document-gate]] (RULE 0.6) · [[activeContext]] (Hopewell audit + the
high-profile enslaver front-end audit 144e0e9cb + top-10) · [[reckoning-retrieval-epistemology-and-workaround-debt]].
