# ASSESSMENT — De-siloing / Orphaning Risk (read-only audit, Jun 25 2026)

_User asked (Jun 24) to ASSESS — not solve — whether already-verified info can orphan
when future inflow arrives (the grandchild/great-grandchild-of-an-enslaved-person case),
BEFORE exponential growth. Verdict: the orphaning risk is REAL and STRUCTURAL, across all
three paths. DB facts below are verified directly; code-path findings are from a read-only
audit (file:line cited) and should be re-confirmed at fix time (the audit was wrong on one
point — see find_person_match)._

## Finding 1 — The relationship/lineage layer is canonical-(or-unconfirmed)-only
Verified FK targets of the relationship/lineage tables:
- **canonical_persons ONLY:** canonical_family_edges, person_relationships_verified,
  enslaved_descendants_confirmed/suspected, inheritance_edges, social_network_edges,
  enslaver_lineage_ledger.
- **canonical + unconfirmed_persons(lead_id):** slaveholding_relationships,
  enslaved_owner_relationships — the ONLY lead-aware edges, and they only know
  `unconfirmed_persons`, **NOT** `slavevoyages_past_people` or `hall_slave_records`.
- `family_relationships` is name-STRING based (no person FK at all).

⇒ The **~266K new leads (169K SlaveVoyages PAST + ~100K Hall) cannot be hung into ANY
relationship/lineage edge.** They are structurally un-linkable to kin or lineage.

## Finding 2 — Intake promotion bypasses the matching/dedup layer entirely
`find_person_match(p_name,p_birth_year,p_location,p_person_type,p_external_id,p_id_system)`
**exists** in the DB (M033) — but the promotion path does not call it. Audit:
`src/services/contribution/OwnerPromotion.js:201-206` matches **only the `individuals`
table by exact lower(full_name)** — no canonical_persons, no lead tables, no
`person_blocking_keys`, no `find_person_match`. The contribute /search endpoint
(`contribute.js:177-433`) does query canonical + unconfirmed + enslaved_individuals, but
**promotion bypasses it**.
⇒ A new contribution matching an existing LEAD **creates a duplicate and orphans the lead**;
the blocking/dedup layer we just built is **not wired into intake**.

## Finding 3 — Descendant→enslaved-ancestor traversal doesn't exist (canonical + name-string only)
Audit of `familysearch-ancestor-climber.js` + `match-verification.js` + DAA:
- The climber links descendants to **slaveholder** ancestors only, via
  `person_relationships_verified` (**both endpoints must be canonical_persons**, FK).
- It does **not** link descendants to **enslaved** ancestors at all.
- The DAA finds enslaved people only by **enslaver-NAME string match**
  (`family_relationships.person1_name`, `unconfirmed_persons.relationships->>'enslaved_by'`)
  or `enslaved_individuals` canonical FK — **never via the relationship graph, never
  reaching PAST/Hall leads.** No reverse descendant→enslaved traversal.

## The grandchild/great-grandchild case, concretely
A future descendant document arrives → climber traces to slaveholder ancestors by name; but
(a) the descendant's enslaved-ancestor LEADS (PAST/Hall/unconfirmed) are in no lineage graph;
(b) promotion of the new doc creates a duplicate instead of matching the existing lead;
(c) no reverse traversal connects them. **Already-verified enslaved-ancestor info orphans.**

## Recommendations (LATER — must precede exponential growth; do NOT build now)
1. **Make the relationship/lineage layer lead-aware** (polymorphic subject, the M101
   pattern) so PAST/Hall/unconfirmed leads can carry kin/lineage/enslaved-owner edges.
2. **Wire intake promotion to the matching + blocking layer** (`find_person_match` +
   `person_blocking_keys` + search lead tables) so new contributions MATCH existing
   leads/canonicals instead of duplicating.
3. **Add reverse descendant→enslaved-ancestor traversal** through the relationship graph
   (FK-based, not enslaver-name string), reaching leads.

These are core/invasive and interact with the gate mechanism (the gate governs canonical
*visibility*; this orphaning is about leads being *linkable* at all — orthogonal but both
needed for the de-siloing imperative, [[project_direction_identity_over_payment]]).
Sequence per user: de-silo assessed (this doc) → gate mechanism next.
