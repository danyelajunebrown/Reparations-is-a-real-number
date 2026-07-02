# PLAN (design, for review) — #96 person_type false binary → status-as-facts

_Design pass, 2026-07-02. Grounded in: the NY audit + Ellison reframe
([[finding-ny-probate-audit-jul01]]), the canonical/document gate
([[standard-canonical-person-and-document-gate]]), the interpretive framework
(aliases/name_type/explicit-vs-inferred), and a full `person_type` usage map of
`src/` + `scripts/` + `migrations/`. NOTHING BUILT — bring for review first._

## The problem (restated with evidence)
`person_type` is a single label forced onto every person, encoding a
perpetrator/victim binary. DB-wide **97%+ of canonical_persons are
enslaver/enslaved/freedperson**; anyone who doesn't fit becomes `unknown` or is
mislabeled. It fails three ways:
1. **Dual/transitional status can't be expressed.** William Ellison (born
   enslaved 1790, manumitted 1816, owned 60+ people to 1861) has no honest
   single value. He fragments into ≥3 unlinked clusters, none canonical.
2. **It silently corrupts the highest-risk consumer.** `DAAOrchestrator.js:697`
   scopes the DAA owner universe to `person_type IN ('enslaver','descendant')`.
   The value `free_poc_slaveholder` **already exists** (4 canonicals) but is NOT
   in that list → **free-Black slaveholders are invisible to the DAA.** The
   binary isn't only conceptual; it drops real obligations to zero.
3. **Parity.** Because we only mint persons for perpetrator/victim roles, the
   connective free-person tissue the continuity-of-holding thesis needs (free
   heirs, witnesses, non-enslaving decedents) is structurally absent.

## What ALREADY exists (do not reinvent)
- **`person_facts` (M096, ~497K rows)** — a GEDCOM/GPS-aligned, **time-bounded**
  (`date_year`/`date_end_year`), evidenced (`source_*`, `confidence`),
  **contest-able** (`contested`) fact layer. Already carries `manumission` (221),
  `sale`, `escape`, `birth`, `death`, `residence`, `race_designation`. **This is
  the status-as-propositions model, already built** — it just has no *status*
  fact_types yet and is populated only for the 100,666 Hall enslaved cohort.
  **Canonical-only** (FK → canonical_persons).
- **`assertable_slaveowner` / `assertable_enslaved`** (M102 + #95) — already the
  **publicly-assertable projection** of status, per-proposition, evidence-gated.
- **`free_persons` (empty)** — purpose-built with `freedom_status`,
  `freedom_year`, `is_slaveholder`: someone already modeled the Ellison case,
  then abandoned it. Redundant with person_facts + the gate. **Deprecate.**
- **`actor_roles` (empty)** — time-bounded `role_type` + `period_start/end` +
  citation, for *entities* (chartered companies/polities). Precedent for the
  same shape at the person level.
- **`free_poc_slaveholder`** — an existing person_type value: the codebase
  already reaches for a dual-status label, just as a flat string.

## The de-facto enum reality (governs the migration, from the usage map)
- **No Postgres ENUM, no CHECK constraint** — `person_type` is free-text
  `VARCHAR(50)`; correctness is enforced only in app code (~704 sites, 122
  scripts). So there is **no enum to migrate** — but also no guardrail.
- **Two vocabularies:** `unconfirmed_persons` staging terms
  (owner/slaveholder/suspected_*/confirmed_*) vs `canonical_persons` resolved
  terms (enslaver/enslaved/descendant/…); promotion translates between them.
- Code treats **synonym CLUSTERS** as equivalent (owner-side ≈ {enslaver,
  slaveholder, owner, slave_owner, suspected_owner, confirmed_owner,
  free_poc_slaveholder}; enslaved-side ≈ {enslaved, suspected_enslaved, …,
  freedperson, free_black, free_poc, depositor}) — but each call site re-hardcodes
  its own IN-list, so they drift (e.g. DAA:697 omits the whole owner cluster).
- **`merged` is a tombstone**, not a role.
- Two **stored SQL matcher functions** hardcode person_type
  (`035-find-person-match-tier2b.sql`, `033-identity-system.sql`) — invisible to
  a `src/` grep; a vocabulary change breaks them silently.

## Thesis
**Status is a set of time-bounded, evidence-backed ROLE FACTS, not a single
enum.** Model it in `person_facts` (the truth layer); keep `person_type` as a
**derived, lossy display/filter summary**; the gate booleans stay the public
assertion projection. Do **not** migrate the enum or rewrite 704 consumers.

Ellison becomes, honestly and compositionally:
`person_facts`: enslavement 1790–1816 · manumission 1816 · free_status 1816+ ·
slaveholding 1816–1861 — each cited; `person_type='free_poc_slaveholder'` (the
headline); `assertable_slaveowner=TRUE` + `assertable_enslaved=TRUE` (#95, each
earned by its own document).

## Design

### 1. Status fact vocabulary (person_facts, no schema change — fact_type is free-text)
Add status fact_types alongside the existing event ones:
`enslavement` (date_year=onset/birth-into, date_end_year=manumission/death),
`free_status` (free-born or post-manumission), `slaveholding`
(date_year..date_end_year), `free_birth`; `manumission` already exists.
Each carries source/confidence/contested like every other fact. This is the
authoritative, multi-valued, temporal status record.

### 2. `person_type` = derived summary, with a canonical role-GROUP function
- Add ONE SQL function `person_role_group(person_type) →
  owner|enslaved|free|descendant|modern|merged|unknown` + a JS mirror, and
  **replace the scattered hardcoded IN-lists** with it, starting at the 5
  highest-risk consumers. This kills the drift (the DAA:697 bug is a drift bug).
- Define a derivation for the summary when facts imply dual status: a canonical
  with BOTH a slaveholding fact and an enslavement/free_status fact →
  summary `free_poc_slaveholder` (or a new `formerly_enslaved_slaveholder`).
- `person_type` stays writable/back-compat; consumers that need "was this person
  BOTH?" read the gate booleans / facts, never the single label.

### 3. Quick-win fix (independent, do first): DAA owner universe
`DAAOrchestrator.js:697` `IN ('enslaver','descendant')` → use the owner role
GROUP (include slaveholder/owner/free_poc_slaveholder/…). This makes free-Black
and non-'enslaver'-labeled owners visible to obligations. Small, high-value,
testable in isolation; a down payment on #96 that stands alone.

### 4. Deprecate `free_persons`; keep person_facts canonical-only (for now)
`free_persons` fields map to person_facts status facts + gate booleans → mark
dead / drop. Keep person_facts **canonical-only**: status facts are the
evidenced truth layer and the gate governs canonicals; lead-side status stays the
coarse person_type hint. (If lead-status richness is later needed, make
person_facts polymorphic via an M103-style `subject_table/subject_id` migration —
flagged, not built.)

### 5. Parity is UNBLOCKED here, not solved here
This model lets a free heir / witness / non-enslaving decedent exist with
`person_type` = free/unknown + optional facts, instead of being forced into a
perpetrator/victim slot or dropped. Actually *building them out* is a separate
producer task (heir/witness extraction, the #100 Ellison parser) — sequence after.

## Migration path (non-breaking first; each phase shippable + reviewable)
1. **Foundation (no schema change):** define the status fact vocabulary; backfill
   status facts from existing signals — `assertable_slaveowner` → slaveholding
   fact; `certificate_of_freedom`/`manumission` → free_status; enslaved_owner
   edges → enslavement. Truth layer becomes real without touching person_type.
2. **Centralize the enum:** add `person_role_group()` (SQL + JS); migrate the 5
   high-risk consumers + the two stored SQL matcher fns; **fix DAA:697** (or ship
   #3 standalone first).
3. **Dual-status summary derivation** + expose facts on the person profile UI.
4. **Deprecate `free_persons`**; (optional, later) polymorphic person_facts.

## Decisions (user, 2026-07-02)
- **1/B — YES, ship the DAA:697 owner-group fix as a standalone.** Live obligation
  gap; independent of the rest. BUILD (with a test).
- **4/D — YES, validation cohort first** (DC certificate-of-freedom + NY testators)
  before the full backfill.
- **5/E — YES, add the soft guardrail** on person_type (stop new junk values).
- **2/A — LEAD-CAPABLE, but RESEARCH FIRST.** Make person_facts lead-capable, but
  only after a dedicated research pass on HOW to do it "without creating more
  damage" (2.4M un-deduped leads; merge/split churn; gate interaction; not
  bloating/orphaning). Do NOT build until researched. → research finding pending.
- **3 — RESEARCH FIRST; this is foundational, not a label choice.**

## Decision 3 is not a naming question — it is the reparations-as-VECTOR principle (USER, verbatim intent)
A dual-status person (enslaved-then-enslaver) is **not** a net scalar. Being
enslaved earns a reparations **CREDIT**; later enslaving others incurs a
reparations **DEBIT** — and **the two do NOT cancel.** Reparations is **not** an
omniscient scalar like karma points or a credit score. It is a **VECTOR BETWEEN
PEOPLE** (damages + the other real values), **directed**, and it **begins with the
act of enslavement**. So:
- The credit is a directed claim: (this person's enslaver's lineage) → (this
  person / their descendants).
- The debit is a *separate* directed claim: (this person / their lineage) → (the
  people THEY enslaved / their descendants).
- Different counterparties, different origin-acts, different vectors. **They must
  NEVER be summed into a per-person net.** (This EXTENDS the existing dual-ledger
  rule — "compensation TO enslavers is evidence of debt, not credit against it" —
  to the case where one PERSON sits on both ledgers.)
Implication for #96: `person_type` (a scalar label) fundamentally cannot carry
this; even the fact model must make status **generate directed obligation edges**,
never a person-level balance. Research needed: does the CURRENT obligation model
(enslaver_lineage_ledger / reparations_line_items / ObligationReconciler / DAA)
represent obligations as directed party→party edges, and is there ANY aggregation
that could wrongly net a person's credit against their debit? → research finding
pending, then design how the status→obligation mapping stays a vector.

## Status: decisions 1/4/5 approved to build; 2 + 3 research DONE (below) → ready for build sign-off.

## RESEARCH FINDING — decision 3 (vector/netting): the code ALREADY honors it
Deep-dive (cited) verdict: obligations are **directed party→party throughout; NO code path nets a
person's credit against their debit.** Credit and debit are in structurally separate stores:
- CREDIT (owed TO, as enslaved) = `reparations_line_items.canonical_person_id=X`; its debit
  counterparty is `perpetrator_entity_id`→`harm_perpetrator_entities` (a DIFFERENT table). A
  canonical person only ever appears on the CREDIT side of a line item.
- DEBIT (owed BY, as enslaver) = `enslaver_lineage_ledger.enslaver_person_id=X` (separate table).
- Nothing joins them; repo-wide grep for credit−debit subtraction = 0. Explicit principle in
  `migrations/083:9-11` ("credit and debit computed independently"). `ObligationReconciler.combine()`
  only receives one lineage's DEBIT predictors; its lone subtraction is a prior-settlement offset
  (Belinda Sutton / DC $300 cap), not the person's own credit. A dual-status Ellison id → **two
  separate directed obligations, never a blend.**
- **Implication for #96:** the status model must make a dual-status person ELIGIBLE for both directed
  roles (enter the enslaver ledger AND be a line-item beneficiary) and introduce **NO per-person
  status balance/scalar.** The existing table separation preserves the vector; do not break it.
- **Separate latent bug found (NOT netting):** `USE_LINE_ITEM_METHODOLOGY=true` routes the DAA "debt"
  figure through `getLineItemsForPerson(acknowledger)` = the acknowledger's CREDIT-side line items,
  under a debt-acknowledgment header (`DAAOrchestrator.js:242-245`). Directional/semantic mismatch;
  dormant in prod (daa.js never passes canonicalPersonId). → file as its own issue.

## RESEARCH FINDING — decision 2 (lead-capable person_facts): YES via M103, gated on a safety net
- **Low read-side risk:** `person_facts` has **NO readers** anywhere in `src/`/`frontend/` yet (write-only
  from Hall ingest). So making the SCHEMA polymorphic now is cheap — but do NOT start WRITING lead facts
  until the safety net exists.
- **Recipe = mirror M103** (`migrations/103:22-58`): add `subject_table VARCHAR(48)`/`subject_id INTEGER`
  (nullable), `ALTER COLUMN person_id DROP NOT NULL` (KEEP the canonical FK → canonical facts keep
  ON DELETE CASCADE), backfill the ~497K Hall rows to `('canonical_persons',person_id)`, bidirectional
  sync trigger (legacy id ⇄ polymorphic), re-express the idempotency unique `uq_person_facts_provenance`
  over `(subject_table,subject_id,...)` (currently keyed on person_id → would fail to dedup NULL-person
  lead facts), polymorphic indexes.
- **THE MUST-FIX risks (all must land WITH the migration, per M101's "no cross-parent FK → code owns
  cleanup" policy `migrations/101:16-17`):**
  1. **Orphan-on-delete:** leads are physically DELETEd in 6+ paths (`contribute.js:2367/2376/2410`, cleanup
     scripts) and `lead_id` is a serial (reuse → dead facts re-attach to a new lead). Mitigate with an
     `AFTER DELETE` trigger on `unconfirmed_persons` that cascades to `person_facts` (simulated cascade —
     can't be forgotten by a new delete path).
  2. **Promote/link strands facts:** `promoteToCanonical` supersedes the lead (`PersonService.js:402-413`)
     without touching facts → they strand, invisible to the canonical every consumer reads. Add
     **`PersonService.migrateLeadFacts(leadRef,canonicalRef)`** and call it from promote + EVERY
     lead→canonical link site (`review.js:684-687`, `bulk-link-auto-enslaver-candidates.mjs:43`,
     `resolve-cross-source-enslavers.mjs:158`) — one helper, one place.
  3. **Merge blind spot:** `PersonService.merge` re-points FKs via an `information_schema` scan
     (`PersonService.js:443-449`) that MISSES polymorphic (no-FK) columns → extend it to re-point
     `person_facts` canonical subjects explicitly.
  4. **Gate:** leads have no gate columns and must stay internal-only; any future public reader of
     person_facts must join `canonical_persons` + require the `assertable_*` flag. NEVER assert lead facts.
  5. **Biscoe split:** lead splits (`unwind-overconsolidated-links.mjs`) must partition facts by source —
     deferrable ONLY while we aren't yet writing splittable lead facts.
- **Sequencing:** schema polymorphic + safety net (1-3) FIRST; only THEN do producers write lead facts.

## FINAL BUILD PLAN (for sign-off)
Phased, each shippable + tested; nothing breaks existing behavior:
- **P0 — DONE (2026-07-02).** New shared `src/services/person-roles.js` (OWNER/ENSLAVED/DESCENDANT
  groups + `roleGroup()`/`isOwnerType()` — the seed P3 extends with a SQL mirror). Wired into
  `DAAOrchestrator` step 2b: owner universe `IN ('enslaver','descendant')` → `= ANY([...OWNER_ROLE_TYPES,
  'descendant'])`; owner-preference on name collision uses `isOwnerType`. Test
  `tests/unit/test-daa-owner-universe.js` 9/9 (Ellison-shaped free_poc_slaveholder now IN scope,
  enslaved excluded). Backward-compatible (superset; no owner-synonym canonicals exist yet).
  **P3 routing target found:** `scripts/reconcile-lineage-obligations.js:111` builds the
  enslaver_lineage_ledger (the DEBIT) from `person_type='enslaver'` — must also use OWNER_ROLE_TYPES
  so a dual-status owner's debit computes; also `DocumentVerifier.js:239`, contribute.js search
  filters, the 2 stored SQL matcher fns (M033/M035). [decision 1]
- **P1 — DONE (2026-07-02).** Migration **110** — soft CHECK guardrail on person_type (both tables),
  allowlist = union of both vocabularies' in-use values + de-facto code enum + #96 forward values
  (free_poc_slaveholder/formerly_enslaved_slaveholder). Applied ADD…NOT VALID then VALIDATE (brief
  lock; all 3.1M rows passed). Verified: junk 'Albany' REJECTED, 'enslaver' + 'free_poc_slaveholder'
  accepted. NULL allowed. Keep in sync with person-roles.js; new role = ALTER both. [decision 5]
- **P2 — DONE (2026-07-02).** `scripts/backfill-status-facts.mjs` seeds the status layer in
  person_facts from gate evidence, VALIDATION COHORT first: A) 122 DC certificate_of_freedom →
  `free_status` (conservative: free status, NOT prior enslavement — real-or-absent); B) 7 NY testators
  (assertable_slaveowner) → dated `slaveholding`. Grounded (source_url + citation + conf 0.85),
  idempotent (NOT EXISTS guard; re-run = 0). Status layer now: manumission 221 (existing) + free_status
  122 + slaveholding 7. Dual-status EMERGENCE proven separately by test-gate-role-aware (a person CAN
  hold both). WIDEN beyond the cohort after review. [decision 4]
- **P3 (role-group centralization):** `person_role_group()` SQL fn + JS mirror; route the 5 high-risk
  consumers + the 2 stored SQL matcher fns through it; dual-status summary derivation.
- **P4 (lead-capable person_facts):** M103-mirror migration + the safety net (cascade trigger +
  migrateLeadFacts + merge extension + re-expressed unique). Schema first; producers later.
- **P5:** deprecate `free_persons`; surface facts + dual-status on the person profile UI.
- **Separate issue:** the `USE_LINE_ITEM_METHODOLOGY` credit-as-debt directional mismatch.

## Risks (from the usage map)
- Two stored SQL functions + several views hardcode person_type → recreate/route
  through role_group() or they silently mis-score.
- `merged` tombstone must remain excluded from search/DAA.
- The two-vocabulary translation lives only in promotion code — any unification
  must update every promotion path or orphan rows from search/DAA.
