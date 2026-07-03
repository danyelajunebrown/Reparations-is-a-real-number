# STANDARD — Genealogical Edge Evidence (the kinship proposition)

_Authoritative project standard. Established by user verdict July 3, 2026._
_Extends `standard-canonical-person-and-document-gate.md` to the one proposition its
document gate never covered: **"X is the child of Y."** Origin: user — "how are we
establishing when we are confident vs when we are not that the FamilySearch 'ancestor'
even is verifiably the real ancestor… 'FamilySearch is unreliable before X date' is not a
real standard and holds no space to grow." Correct. This file makes the kinship link a
first-class, document-gated claim, exactly like slaveowning/enslaved status._

## 1. The proposition and why it needs a gate

The ancestor climb produces **kinship edges** — assertions of the form "Y is the parent of
X." Every DAA lineage is a *chain* of these edges from a living participant up to a named
slaveholder ancestor. To date the project has gated *who a node is* (slaveowner / enslaved,
per the gate standard) but has **never gated whether an edge is real.** The climb takes
FamilySearch's tree pointers as fact (`familysearch-ancestor-climber.js:772/793`
`foundIds.slice(0, 2)`; `scrape-parents.js` `data-testid="family-…"`) and stamps a
per-discovery-method **heuristic constant** as "confidence" (0.90 if from the participant's
tree, 0.70 from a provided name, 0.75/0.85 from a record). A constant keyed to *how the
edge was found* is not evidence of the edge.

**The kinship link is a claim. It gets a proposition-specific document gate — the same
discipline, one document at a time.** This is the standard's own logic: we do not assert
"was a slaveowner" because a person is old; we assert it only when a proposition-specific
document substantiates it. `"FamilySearch is unreliable before 1800"` is to the kinship
proposition exactly what `"old person ≈ slaveholder"` would have been to the slaveholding
proposition — a smeared-out proxy the project already refused on the other side.

## 2. The gate — assertable kinship

A kinship edge **EXISTS and is fully usable INTERNALLY** the moment the climb creates it
(navigation, lead discovery, obligation research, dedup) — as a tier-3 `canonical_family_edges`
row, `verified = false`. Internally we may *traverse* it.

It is **GATED** — non-assertable, never shown as "ancestor of," never load-bearing on a DAA —
until a **proposition-specific kinship document is stored in S3** and attached to the edge
(`canonical_family_edges.source_document_id → person_documents` with `s3_key` present). The
gate lifts **only for that edge**, and only to the tier the document earns (§3). This is the
edge-level twin of M102's `assertable_slaveowner` / `assertable_enslaved` person flags; the
existing `canonical_family_edges.verified` column IS the flag ("only tier 1–2 edges may be
verified" — M066 contract). A bare FamilySearch tree edge, forever, licenses navigation and
nothing more.

## 3. Kinship evidence tiers

Tier is a property of **the edge**, computed from the strongest *independent* record that
corroborates *that specific link* — not the year, not the tree that asserts it. Mapped onto
both the project confidence model (CLAUDE.md) and `canonical_family_edges.evidence_tier`:

| Confidence | edge_tier (M066) | Basis for "X is the child of Y" | Assertable? |
|---|---|---|---|
| 0.95+ | **1** | A record that **states the relationship**: will/probate naming X as heir/son/daughter of Y; death cert naming parents; birth/baptism naming parents; Bible record | ✅ |
| 0.85–0.94 | **1** | **Household co-residence**: a post-1850 US census showing X in Y's household at the right age/sex/place (pre-1850 US censuses name only the head → structurally cannot reach this tier) | ✅ |
| 0.70–0.84 | **2** | **Indirect / correlated** (GPS "reasonably exhaustive + correlation"): land adjacency, naming patterns, migration co-movement, DNA — a *correlated cluster*, never a single circumstantial fact | ⚠ review |
| < 0.50 | **3** | **Bare tree assertion**: a FamilySearch / WikiTree edge with no attached source. **The default for most deep grafts.** | ❌ gated |

Only tier 1 (and reviewed tier 2) edges are assertable. Tier 3 is navigable and inert.

## 4. Kinship document types (proposition-specific; "so far", extensible)

Add this column to the gate standard's verifying-document table — these substantiate
**"X is the child of Y"**, distinct from the slaveowner/enslaved columns:

| Document | establishes "is the child of" |
|---|---|
| Post-1850 US census (X co-resident in Y's household, right age) | ✅ |
| Marriage record naming the parents of a party | ✅ |
| Will / probate naming X as heir / son / daughter of Y | ✅ |
| Death certificate naming the decedent's parents | ✅ |
| Birth / baptism record naming parents | ✅ |
| Family Bible record | ✅ (secondary unless the original is imaged) |
| Pre-1850 US census (head-of-household only) | — (cannot place a named child) |
| Bare FamilySearch / WikiTree tree edge | — (navigation only) |

## 5. Where the evidence lives — and where it must stop living

- **Kinship edges are written to `canonical_family_edges`** (M066), lead-aware via the M103
  polymorphic subject refs so a *lead* ancestor can carry a gated edge before promotion.
  `source_document_id` points at the `person_documents` row for the kinship document;
  `evidence_tier`/`confidence`/`verified` follow §3.
- **The climb must HARVEST the FamilySearch Sources tab** per person (the records FS already
  attaches to a relationship — census, probate, vital records), classify each into §4, and
  set the edge tier from the strongest one. This replaces `slice(0, 2)` pointer-trust and the
  independent name/date record-search (which captures at most one source and never reads what
  FS already attached).
- **Retire the heuristic-constant path.** `inferred_parent_links.confidence` as a
  discovery-method lookup (0.90/0.70/0.75) is deprecated as an assertability signal — it may
  persist as a *navigation* hint but never lifts a gate. Tier comes from documents only.

## 6. Genealogical Proof Standard (GPS) mapping

This is GPS operationalized against the project's existing machinery, not a parallel system:

| GPS component | Our mechanism |
|---|---|
| Reasonably exhaustive research | Harvest ALL attached FS sources per edge, not the first pointer |
| Complete, accurate source citations | `source_document_id` per edge; citation rendered on the DAA |
| Analysis & correlation | edge_tier from the strongest independent record; tier-2 requires a *correlated cluster* |
| Resolution of conflicting evidence | conflicting parents → edge stays tier-3/gated + flagged for review (never silent pick) |
| Soundly written conclusion | `verified = true` + the DAA chain-of-custody render (§7) |

`person_facts` is already "GPS-aligned" for status facts (M096); this extends the same
evidence-first stance to the kinship *edge*, the layer facts don't cover.

## 7. DAA chain of custody — weakest link, not average

A DAA asserts *"this documented slaveholder is **your** ancestor."* That claim is only as
strong as the **weakest edge on the path** from participant to slaveholder. `_enforceProbateGate`
today validates the *slaveholder node* (TIER A/B/C estate evidence) but **not one edge on the
path** — a fully documented slaveholder can be named on a lineage where no link is corroborated.

**Rule:** a DAA may name a slaveholder ancestor only when **every edge on the participant→
slaveholder path clears the kinship gate** at ≥ tier 1 (reviewed tier 2 by human sign-off).
Each link renders its citation (a census here, a will there), the same way the slaveholding
itself is cited. A path with a gap renders *"lineage unproven at generation N"* — it is
surfaced, never silently asserted. This is a new gate that rides **alongside**
`_enforceProbateGate`, not a replacement.

## 8. "Unreliable before X date" becomes an emergent statistic

The date heuristic encodes one real fact: before the 1850 US census only the household head
is named, so co-residence evidence is unavailable and deep links fall back on sparser wills /
probate / church records. Under this standard that is not a rule — it is a **consequence**:
deep edges corroborate less often *because their records are thinner*, and they fail the gate
*individually*. This is the property the user asked for — **room to grow**: find a will that
names the heir at generation 9 and that edge earns assertability at *any* year. The curve
falls out of the data instead of being hardcoded, and it is falsifiable one document at a time.

## 9. Standing debt (flag; reconcile under this standard, do not act unprompted)

- **All existing climb edges** live in `inferred_parent_links` with heuristic-constant
  confidence, or as tier-3 `canonical_family_edges` — none carry a kinship document. All are
  **gated** under this standard until §5 harvest attaches one.
- **`canonical_family_edges` is under-populated** — the still-open item across
  `note-climb-resolution-producer-jun27.md`: climb parent edges were never mirrored here from
  `inferred_parent_links`. Mirror + harvest are the same pass.
- **The DAA path gate (§7) is not built** — `_enforceProbateGate` guards the node only.
- **person-lead PARITY deficiency** (`finding-ny-probate-audit-jul01.md`): most of a climbed
  lineage is connective free-person tissue the pipeline under-built; kinship gating touches
  exactly this population.

## 10. Mechanism (proposed, NOT yet built — mirrors the gate standard's style)

1. **Harvest** FS Sources per person → classify (§4) → write `person_documents` (with `s3_key`)
   + a `canonical_family_edges` edge at the earned `evidence_tier`, `source_document_id` set.
2. **Edge gate** = `canonical_family_edges.verified` lifted only when a tier-1 (or reviewed
   tier-2) kinship document with an `s3_key` is attached — the edge twin of M102.
3. **DAA path gate** alongside `_enforceProbateGate`: assert a slaveholder ancestor only if
   every edge on the path is verified; render per-link citations; else "unproven at gen N".
4. **Deprecate** discovery-method confidence constants as assertability signals.

## See also
`standard-canonical-person-and-document-gate.md` (the person-level twin; add the kinship
column to its document table) · `assessment-climb-architecture-gap-jun30.md` ·
`plan-climb-as-gated-lead-source.md` · `note-climb-resolution-producer-jun27.md` ·
`finding-census-namematch-falsepositives-jun30.md` · `interpretive-framework.md` ·
`plan-96-person-status-model.md` (person_facts GPS-alignment).
