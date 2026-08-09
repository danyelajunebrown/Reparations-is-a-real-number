# PLAN — Freedmen's Bank enslaver (last_master) re-extraction at quality

_Scoped 2026-08-08 from the read-only completion audit (`scripts/audit-freedmens-completion.mjs`)._

## The finding (why this exists)
The Freedmen's Savings Bank corpus is large and real but the **enslaver link is barely started and low quality**:
- **416,520** depositor leads (`unconfirmed_persons.extraction_method IN ('freedmens_bank_index','freedmens_bank_ocr')`),
  **416,136 with a FamilySearch ARK** `source_url` (`ark:/61903/1:1:…`, collection **1417695**). 78,214 `person_documents`
  carry those FS URLs.
- **Only 1,105 (0.3%) have an `enslaved_by` (last_master) annotation** in `relationships` JSONB — the rest are index-only.
- Those 1,105 were extracted with `google_vision_ledger_extraction` and are **badly OCR-degraded**: the mint gate "passes"
  562 but the samples include form-text noise (`"Always lived inn"`, `"aug aquatics Maria"`, `"Name of Master"`). Real
  usable enslavers are far fewer. Promoting the JSONB as-is would mint hundreds of fake enslavers — do NOT.
- **0 of the 416K are embedded** (RULE 0.5) — being fixed separately by the `embed-leads --extraction-method` drip.

## Goal
Extract the **last_master / last_mistress (enslaver)** for the ~415K index-only depositors at real quality, mint each as a
gated enslaver lead, write the `enslaved_by` edge (depositor→enslaver), and archive+embed the form image. The depositor's
naming of their enslaver at emancipation is one of the highest-value reparations links in the whole dataset.

## Why now is the right time — the tooling exists
The blocker was OCR quality on cursive forms. We now have the fix: the **vision-router** (`src/services/vision/vision-router.js`,
Qwen2.5-VL-72B primary) BEAT Google Vision on exactly this (cursive bakeoff, issue #142), and the **freedmens handler** in
`src/services/extraction/source-type-registry.js` already carries the 26-field depositor schema. So the extraction stack is
built; this plan is about feeding the form images through it.

## Approach (reuse everything; one FS scraper at a time)
Per depositor (queue-driven, resumable, on the Mini — FS Chrome `:9222`, one scraper at a time per the standing rule):
1. **Fetch the form image** — navigate to the depositor's FS ARK detail (`source_url`), capture the registration-form image
   (the same page `extract-freedmens-fields.js` used). Prefer the FS Download button for full-res (issue #124).
2. **Archive to S3** (RULE 0.6 + RULE 8: file-first, dual S3+Wayback) as `person_documents.s3_key` linked to the depositor
   lead — this both lifts the gate and makes the image re-processable forever (no more on-the-fly-only extraction).
3. **OCR with the vision-router** (Qwen-VL) → `ocr_text`. This is the quality upgrade over `google_vision_ledger_extraction`.
4. **Structured-extract** via the freedmens registry handler → `{depositor_name, last_master, last_mistress, plantation, …}`
   into `structured_extractions` (source_type='freedmens').
5. **Promote** via `promote-structured-extractions.mjs` (already built): depositor=enslaved (link the archived image),
   last_master=enslaver lead (mint-gated, Biscoe-safe), `enslaved_owner` edge, embed. `requires_human_review`.

Steps 3–5 already exist. The NEW work is steps 1–2 (a freedmens form-image scraper/archiver keyed on the ARK), plus wiring
it to enqueue into `source_ingest_queue` / a freedmens work table.

## Sequencing & gates
- **Step 0 — PROOF (1 form):** take one depositor whose google-vision `last_master` is garbled, re-fetch its form, OCR with
  the vision-router, confirm the enslaver name is materially better. Validate BEFORE scaling. (If Qwen-VL doesn't clearly
  beat the old name on these specific forms, stop and rethink.)
- **Batch 1 — the 1,105 already-annotated** (re-do them at quality; compare old vs new; retire the garbled JSONB names).
- **Then the 415K index-only**, low-and-slow, FS-session-gated, queue-driven. This is a long haul (hundreds of K forms,
  one scraper at a time) — treat like the 1860 slave-schedule / probate drips: a background cron with a watchdog.

## Constraints / risks
- **FS session** — expires; one scraper at a time; manual re-login via VNC into the `:9222` debug Chrome (standing rules).
- **Scale** — 415K forms is a multi-week+ drip even before rate limits; the vision-router's paid-vs-free lever applies
  (Gemini free-tier caps; Qwen-VL via OpenRouter is per-call). Default FREE, burst only on the operator's say-so.
- **Quality gate** — enslaver names still `requires_human_review`; never auto-promote freedmens enslavers to canonical.
- **Freedmens Bank reliability caveats** apply (see `project_freedmens_bank_history`): the depositor's stated master is
  testimony, tier accordingly (0.65–0.7, not government-primary 0.95).

## Immediate next action
Run **Step 0 (the 1-form proof)** to validate the vision-router beats the old google-vision names before building the
form-image scraper for scale.
