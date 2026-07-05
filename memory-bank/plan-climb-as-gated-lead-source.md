# PLAN — Reconceive the ancestor climb as a GATED LEAD source (Jun 30 2026)

_From `assessment-climb-architecture-gap-jun30.md` (user: "this is a massive architectural
issue… a sturdy filter cognizant of our many standards… the climb is so far behind our own
resolutions"). Sequenced against the active de-siloing work (`plan-de-siloing-fixes.md`) so
the two don't collide. Build incrementally; each phase its own migration/PR; dry-run +
measure before every apply; memory bank + GitHub stay in sync._

## Status log
- **Jun 30 2026:** Phase-0 consumer audit done (DAA protected by `_enforceProbateGate`;
  exposure is research/UI + identity store). Existing climb-quality tooling read & reconciled
  (Phase B is "run + wire", not build). Climber cutoff already fixed in code (1450→1600).
  Dry-runs quantified contamination → **logged as GitHub issue #92** (327k-row cleanup, to be
  sequenced into de-siloing Step 4). Worksheet converted to verified-corpus-only sourcing.

## Invariant (definition of done)
Nothing the climb produces is ASSERTED (as "ancestor of", "slaveholder", or in a DAA /
search) until it has passed the project's existing doors: identity resolution
(`find_person_match` / `person_blocking_keys`), the canonical/document gate
(`standard-canonical-person-and-document-gate.md`), and a source-tier/structural quality
filter. The climb becomes a **lead-discovery tool**: its raw output lands inert (gated
leads) and is promoted only by the same rules every other source obeys.

## Prerequisites already in place (do not rebuild)
- M103 lead-aware edges (`canonical_family_edges`, `enslaved_owner_relationships` polymorphic
  `subject_table/subject_id` + sync trigger). Climb parent edges can target it.
- `PersonService.findOrCreateLead` (resolve-then-create lead + blocking keys),
  `_writeBlockingKeys`, `resolve` (Biscoe-safe match), `promoteToCanonical`, `recomputeGate`.
- Climb-minted canonical backfill: 970/992 keyed, 0 strong dupes, 28 ambiguous
  (`note-climb-resolution-producer-jun27.md`).
- Audit prototype: `scripts/audit-lineages.mjs` (generation-gap, era, dup-identity, grade).

## Hard dependencies on de-siloing (sequencing constraints)
- **Phase A (climb writes → leads)** extends de-siloing **#2** (wire intake to the
  matching/blocking layer). Do NOT fork a parallel intake path — A is "the climber is one
  more #2 consumer." → A starts only once #2's PersonService intake door is the norm.
- **Phase B (demote existing climb canonicals → leads)** needs a **demote/merge primitive**.
  PersonService has NO merge yet (de-siloing **Step 4**: "fold merge/link into PersonService").
  → B blocks on Step 4. Until then, climb canonicals are GATED-in-place, not moved.
- **Phase E (re-key parent edges)** uses M103 (done) — no extra dep.
- **Assertion enforcement** rides de-siloing **#4** (gate search-wiring / `assertable_*` flip).

## Build order

### Phase 0 — Stop asserting from raw climb data NOW (contained, no dep) — DO FIRST
- Worksheet/DAA/search must source slaveholder + ancestry claims from the VERIFIED corpus
  (`enslaver_evidence_compendium` direct_primary, `person_relationships_verified`) by
  resolved identity — never from `person_documents_with_names` name-matches or the raw tree.
  (Worksheet already converted, Jun 30.) **Audit every other consumer of climb output** for
  the same leak; convert or gate. Cheap, urgent, unblocks nothing but stops harm.
- Add a `source_tier`/`gated` notion to climb-origin rows so consumers can exclude them
  (interim: filter on `created_by IN ('ancestor_climber_v2','climb_name_resolver')` +
  the audit grade) pending the real gate flag.

### Phase A — Climb WRITES go through PersonService as gated leads (rides de-siloing #2)
- New climb nodes: `findOrCreateLead({name, birthYear, sex, location, sourceType:'familysearch_tree',
  externalId, idSystem:'familysearch'})` — resolve-first (link, don't duplicate), create
  `unconfirmed_persons` + blocking keys, NEVER a canonical. FS tree = secondary, un-deduped →
  lead is the correct landing per the standard.
- Parent edges: write to lead-aware `canonical_family_edges` (M103 polymorphic ref) with
  `evidence_tier='familysearch_tree'`, in addition to / instead of `inferred_parent_links`.
- Retire direct `INSERT INTO canonical_persons` in `resolve-climb-ancestors.js` /
  `scrape-parents.js` / the climber. **Dry-run**: count leads-created vs links-reused.

> **Evidentiary spec for this filter: `standard-genealogical-edge-evidence.md` (Jul 3 2026).**
> That standard defines the kinship proposition, per-edge evidence tiers, the FS-Sources harvest, and the
> DAA chain-of-custody rule. Phase B's structural/temporal checks are the CHEAP half; the standard is the
> DOCUMENTARY half (an edge is assertable only with a proposition-specific kinship document). "Unreliable
> before X date" is retired there in favor of per-edge evidence — the depth cutoff becomes an emergent
> statistic, not a rule. Wire Phase B to SET `canonical_family_edges.evidence_tier`/`verified` per that standard.

### Phase B — Genealogical-production filter (MOSTLY ALREADY BUILT — run + wire, don't rebuild)
**Firsthand read (Jun 30): the project already built these validators.** Phase B is to
CONSOLIDATE them, WIRE them as an ingest gate (they are currently retroactive/ad-hoc), and
COVER the two paths they miss.
- `rescan-climb-matches.js` — temporal + geographic match filter (name_only requires state
  overlap/adjacent; Gen 8+ requires birth within 50y of 1619–1865; 0%-conf auto-reject).
- `re-evaluate-matches.js` + **MatchVerifier** (migration 034) — race-aware re-classification.
- `audit-climb-contamination.js` — detects: (A) descendant/modern canonicals from the
  climber; (B) `person_documents` that are FS-profile URLs with `s3_key` NULL masquerading as
  primary docs; (C) 'enslaver' canonicals whose only docs are FS profile URLs. **This is the
  Elizabeth-Parker class — the detector EXISTS; it just hasn't been run/enforced on current data.**
- `clean-climb-match-data-quality.mjs` — nulls implausible birth years; documented the 1450 cutoff defect.
- `generate-climb-accuracy-audit.mjs` — human-verification packet; explicitly stress-tests
  "FamilySearch trees are not always genealogically correct" (Premise #2).

**ROOT-CAUSE CONFIG DEFECT — already fixed in code (Jun 30 verify):** ALL 11 climb sessions
(10,041 ancestors) ran `config.historical_cutoff=1450`, `max_generations=50` — climbing to
the medieval period (1,310 of Adrian's "ancestors" born in the 1500s are a mechanical
artifact). BUT `familysearch-ancestor-climber.js:70` ALREADY sets
`HISTORICAL_CUTOFF_YEAR=1600` + `MIN_ANCESTOR_BIRTH_YEAR=1600` (documented 1450→1600 fix,
LX39-1MY session). No active code still sets 1450 → the contaminated sessions are PRE-FIX
DATA, not an ongoing leak. So there is NO config edit to make. Open: climber=1600 vs
`clean-climb-match-data-quality.mjs` prescription=1700 — reconcile (methodology call, not
silently overridden).

**Actual B work (the gap):** (1) flip the climber config (1700/12); (2) run the existing
cleanup tooling on current data (dry-run→apply): `audit-climb-contamination.js`,
`clean-climb-match-data-quality.mjs --apply`, `rescan-climb-matches.js`,
`re-evaluate-matches.js`; (3) WIRE them as a mandatory ingest gate (shift-left) so cleanup
isn't post-hoc; (4) COVER the two uncovered paths the match-tooling misses — the
`person_documents_with_names` name-match links (Elizabeth-Parker path; `audit-lineages.mjs`
gen-gap/era checks + the verified-corpus-only sourcing) and raw lineage-TREE structural
sanity (`audit-lineages.mjs` automates what `generate-climb-accuracy-audit` does by hand).

### Phase C — Assert ONLY by resolved identity (climb hit-checking)
- Replace the climber's name/SlaveVoyages match → enslaver with a `find_person_match` call
  against the verified corpus. A climbed lead = a verified enslaver only on an UNAMBIGUOUS
  identity match (Biscoe rule); else it stays a lead flagged for review.
- `ancestor_climb_matches` becomes explicitly "leads, self-classified", never an assertion
  source. DAA reads confirmations from the verified corpus by resolved identity.

### Phase D — Demote the existing climb-minted canonical debt → leads (blocks on Step 4)
- ~3.8k climb canonicals (`ancestor_climber_v2` + 992 `climb_name_resolver`) violate the
  standard (single-secondary, un-deduped). Once a vetted demote/merge primitive exists
  (Step 4), reclassify them to `unconfirmed_persons`, preserving `person_external_ids`,
  edges, and the 28 ambiguous review-flags. **High-risk, irreversible** — dry-run + per-batch
  verify; do NOT run while Step 4 migrations are mid-flight.

### Phase E — Promotion path
- A climbed lead promotes to canonical only via `promoteToCanonical` after: dedup
  (tiered fingerprint) + ≥secondary evidence + (for any slavery proposition) the S3
  assertion gate. Same door as every source. No bulk promotion.

## Interleaving with de-siloing lineup (avoid collisions)
| de-siloing item | climb-plan coupling |
|---|---|
| #2 PersonService intake consolidation | **A** is a consumer of it — co-design, don't fork |
| Step 4 merge/link + dead-table cleanup | **D** blocks on the merge primitive it builds |
| #3 reverse traversal (done) | **C** asserts against the same verified corpus |
| #4 gate search-wiring (`assertable_*`) | **Phase 0 / C** assertion enforcement rides it |
| #5 data-quality pass | **B**'s structural filter overlaps — share the validators |

## Guardrails (inherited)
- No canonical minted without the standard (dedup + ≥secondary; gated until S3 doc).
- Dry-run + measure before each apply. Each phase its own commit, pushed.
- No model output aggregated; deterministic code computes (the audit filter is code).

## Phase-0 consumer audit (firsthand, Jun 30) — blast radius
Consumers of raw climb output (`ancestor_climb_matches` / climb canonicals /
`person_documents_with_names` / `inferred_parent_links`): worksheet (fixed),
`DAAOrchestrator`, `match-verification` (svc+route), `pipeline-orchestrator`,
`ancestor-climb`/`review`/`contribute`/`ops` routes, `frontend/src/api/client.js`, and the
DAA PDF path. PLUS existing climb-quality tooling the project already built —
`audit-climb-contamination.js`, `clean-climb-match-data-quality.mjs`,
`re-evaluate-matches.js`, `rescan-climb-matches.js`, `generate-climb-accuracy-audit.mjs`
(**Phase B must consolidate with these, not duplicate — read them first**).

**DAA instrument is PROTECTED (good news).** `DAAOrchestrator.getDocumentedSlaveholders`
(primary) sources from `person_relationships_verified` + evidence — verified corpus. The
name-only `ancestor_climb_matches` FALLBACK (lines 168–198, `classification NOT IN
(temporal_impossible, common_name_suspect)`, `_from_climb_match`) builds entries with
`slaveholder_id: null`, and **`_enforceProbateGate` throws `DAAProbateGateError` when no
slaveholder resolves to a canonical with TIER A/B/C documentary evidence.** The fallback
only fires when documented=0 → all-null ids → gate blocks. So **raw climb matches cannot be
released in a DAA.** The probate gate is exactly the upstream discipline this plan wants —
the climb just needs the same gate applied at ingest so the identity layer/research
surfaces aren't polluted in the first place.

**Actual exposure (not the instrument):** (1) research/UI/API surfaces that DISPLAY climb
matches/canonicals without the assertable gate (`ancestor-climb`/`review` routes, frontend
client) — fix via de-siloing #4 `assertable_*`; (2) the identity store itself — un-deduped
climb canonicals polluting `canonical_persons` (the de-siloing debt, Phase D). The DAA's
own probate gate validates the approach; replicate it UPSTREAM.

## Open decisions to surface
1. Scope of Phase 0 audit: which consumers besides the worksheet read raw climb output
   (DAA generator, obligation math, public search)? Need a firsthand grep before sizing.
2. Phase D: demote-to-lead vs gate-in-place-permanently for the existing ~3.8k — depends on
   whether Step 4 ships a safe demote. Default: gate-in-place until then.
3. Does the live climber (`scripts/scrapers/familysearch-ancestor-climber.js`) get the
   Phase A/B retrofit, or is a v3 climber written against PersonService from the start?
