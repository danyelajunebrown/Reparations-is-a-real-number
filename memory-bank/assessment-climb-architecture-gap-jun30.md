# ASSESSMENT — The ancestor climb bypasses the project's genealogical-production standards (Jun 30 2026)

_User: "this is a massive architectural issue… this pre-1800 notoriety needs to have been
resolved before it gets to our climb, or a sturdy filter cognizant of our many standards…
this climb architecture is so far behind our own resolutions of precisely these issues."_
Correct. This is not a worksheet bug; the worksheet merely made it visible.

## The core defect
The ancestor climb is a RAW INGESTION pipeline that mints person nodes by scraping
FamilySearch's collaborative tree, and it runs **entirely outside** the standards every
other data path has been brought under. Concretely, for Adrian Brown's climb:
- **86% of 2,675 connected ancestors were born before 1700; 1,310 in the 1500s.** These
  are FamilySearch deep-tree grafts (speculative gentry/royal lines), not documented
  ancestry. 96% of the 1,223 lines grade SPECULATIVE; only 19 SOLID.
- The climb **mints `canonical_persons`** (`created_by` ∈ `ancestor_climber_v2`,
  `climb_name_resolver`) from a SINGLE secondary source (FS tree) **without dedup** —
  the exact "never bulk-mint un-deduped canonicals" violation
  `standard-canonical-person-and-document-gate.md` calls out (same sin as SlaveVoyages-PAST
  & Hall). 992 such rows had 0 `person_blocking_keys` (see `note-climb-resolution-producer-jun27.md`).
- It **asserts by name string, not resolved identity**: slaveholder status came from
  name-matched `person_documents_with_names` (0/33,791 human-verified), producing
  Elizabeth Parker (NJ, d.1793) ⚖ "1860 Georgia slave schedule"
  (`finding-census-namematch-falsepositives-jun30.md`).

## Why it's an architecture problem, not a data problem
Every standard the project painstakingly built — the canonical/document gate, the tiered
identity fingerprint, `person_blocking_keys`/`find_person_match`, the evidence-tier model,
the M101/M103 lead-aware layer — assumes nodes ENTER through a controlled door
(`PersonService`, dedup, gating). **The climb is a second, uncontrolled door** that pours
un-resolved, un-gated, source-tier-unclassified nodes straight into `canonical_persons`
and the edge tables. It is upstream of, and blind to, the resolutions. Polishing the
worksheet (grading, temporal gates) treats the leak at the faucet; the breach is the door.

**Stakes:** the climb feeds the DAA (the legal instrument). Raw climb nodes flowing into
DAA / obligation / search would assert ancestry and slaveholding the project cannot stand
behind — violating CLAUDE.md RULES 1, 2, 5 (provenance; no aggregating unverified output;
"real or absent").

## The user's framing (precise, and right)
"We would have no prior need to have pre-cleaned person nodes for non-slaveowners." The
curated standards were built around the slaveholder / enslaved / descendant corpus — the
people who matter for a DAA. The climb explores the FULL ancestor space (mostly
non-slaveowners, mostly deep-speculative), a class of nodes the pipeline never had to
standardize. The climb introduces un-standardized nodes AT SCALE.

## Recommended architecture: the climb is a LEAD-DISCOVERY tool, not a canonical producer
1. **Climb output lands as LEADS, not canonicals.** FS-tree people are secondary-only +
   un-deduped → `unconfirmed_persons` via `PersonService.findOrCreateLead` (writes blocking
   keys, dedups on entry). Promotion to canonical only after the standard's two gates
   (verified discrete identity + ≥secondary evidence) — same door as every other source.
2. **A genealogical-production filter at ingest** (the "sturdy filter" the user asked for),
   cognizant of the standards:
   - **Source-tier**: FamilySearch collaborative tree = low tier, GATED (non-assertable)
     by default — like the SlaveVoyages C1 bucket.
   - **Structural/temporal sanity**: reject/flag impossible generation gaps (29 found),
     >2-parent nodes, cycles, duplicate-identity merges (10 found).
   - **Confidence-graded depth boundary**: quarantine pre-~1750 speculative tail; it may
     exist as gated leads but is never asserted. (`scripts/audit-lineages.mjs` is a working
     prototype of this filter — move it UPSTREAM into the climber.)
3. **Assert only by resolved identity.** A climbed ancestor = a verified enslaver only via
   `find_person_match`/`person_blocking_keys` against the verified corpus
   (`enslaver_evidence_compendium` direct_primary, `person_relationships_verified`) — never
   name string. Slaveholder/ancestry claims pass the proposition-specific assertion gate.
4. **Retrofit the existing climb debt**: reclassify climb-minted canonicals → leads;
   re-key parent edges into the lead-aware `canonical_family_edges`; backfill blocking keys
   (partly done, 970/992).

## Net
Reconceive the climb as quarantined lead discovery whose output is inert until it passes
the identity-resolution + evidence/gate standards. Until then, **nothing climbed should be
asserted** — not in a DAA, not in search, not as "ancestor of," not as "slaveholder."
The current worksheet now grades/quarantines visually, but that belongs in the pipeline,
not the renderer.

## See also
`standard-canonical-person-and-document-gate.md` · `plan-de-siloing-fixes.md` ·
`plan-identity-resolution-completion.md` · `note-climb-resolution-producer-jun27.md` ·
`finding-census-namematch-falsepositives-jun30.md` · `interpretive-framework.md`
