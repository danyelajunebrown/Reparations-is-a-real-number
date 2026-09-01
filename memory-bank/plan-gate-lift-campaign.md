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

## TWO TRACKS (key insight — the fix differs by served doc type)
- **Schedule-served (census_slave_schedule with enslaved_count>0): just `recomputeGate` — NO LLM, NO
  reextract.** These were attached without a gate recompute; a bulk `recompute-assertion-gates.mjs`
  lifts them cheaply. This is a big, fast slice of the backlog. (Verified: Ward/Lee/Hampton lifted by
  recomputeGate alone.)
- **Will/probate-served: the reextract path** (OCR+LLM → extract enslaved → gate-sync). The 7,967.
- ⇒ Run the cheap bulk recomputeGate FIRST (lifts every schedule-served one whose doc already has a
  count), THEN the reextract drip for the will-served remainder.

## FLAGSHIP ENSLAVERS SURFACED (2026-07-07, this session)
Now assertable + serving (verified on prod where noted): **Hugh Hopewell V #193376** (will → Jacob/Harry),
**Joshua John Ward #828471** (14 schedules, ~1,100 enslaved — largest US holder), **Robert E. Lee #828469**,
**Wade Hampton #828474** (recomputeGate), **Thomas Jefferson #828182** (will → Burwell/John/Madison/Eston
Hemings/Joe Fossett). Already assertable: Hamilton #828192, Cobb #360238.
**Cannot lift (no supporting doc):** Calhoun #207607, Isaac Franklin #141263, Charles Carroll #141466,
James Madison #427834, Stephen Duncan #79380 — all serve NO s3 doc → need a document attached first.
**Namesake/misattribution:** "James M Monroe" #614729's linked scan is a **1893 GA probate admin bond**
(President Monroe d.1831) — enslaved=0, gate correctly NOT lifted. The parallel audit's "Monroe easy" was
wrong about that doc; don't force-assert. Needs the President's actual will attached (or re-link).

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
