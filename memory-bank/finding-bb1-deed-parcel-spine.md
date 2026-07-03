# Finding: land continuity runs on DEEDS, not wills (BB-1 pivot) — 2026-07-02

**Governs:** any future work on `land_transfer_events`, `inheritance_edges` real_property, `properties`,
and the continuity-of-holding (land-first) thesis. Supersedes the initial "wills → land_transfer_events"
framing.

## The decision
The land chain-of-title spine is built on **deeds**, not **wills**. Trigger: the question *"how would
parcels even be IDed?"* A will bequest is not parcel-identifying; a deed is.

| | Will bequest | Deed |
|---|---|---|
| Example | "the farm in Fannington Liberty Co GA", "midway tract of land" | "Lots 47 & 48 in Holmead's addition to Georgetown" + Liber J.A.S. 104 f.124-128 |
| Parcel identity | none (vague estate language) | platted lot/block/subdivision + recording ref (liber/folio) |
| Traceable forward? | no | yes — via county grantor-grantee index |
| Role in the model | **heirship provenance** (who inherited land-as-described) | **chain-of-title** (a specific parcel moving across owners/time) |

So: **wills feed the heirship graph** (`inheritance_edges` + `canonical_family_edges`); **deeds feed the
parcel chain** (`properties` ← `land_transfer_events`). Do not mint will land-bequests as parcel transfers
with `property_id=NULL` — that mislabels provenance as a parcel chain.

## Built (2026-07-02)
- **migration 112** `properties` = focused parcel anchor: `legal_description`, `lot`/`block`/`subdivision`,
  `liber_folio`, `metes_and_bounds`, self-ref `parent_property_id` (plantation→quarter), nullable
  `modern_parcel_apn`/`geometry_wkt`/`georeference_method` for the forward trace. Wired the dangling
  `land_transfer_events.property_id` FK. (M007's `properties` was never applied; its FKs point at absent
  tables — hence a focused new table, not applying all of M007.)
- Anchored the ONE real deed (Biscoe 1858 DC) as the pattern proof.
- `scripts/build-inheritance-land-transfers.mjs` exists but is a **heirship-provenance** producer, **NOT
  applied** (per this finding). 7 unique will land-bequests, all vague → property_id would be NULL.

## Blocked on (the real, largely-manual work) → issues [[#112]] deed/parcel spine, [[#113]] extractor devisee
1. **Deed corpus is 1 row** — chain-of-title needs deeds; we've ingested ~none. The input gap.
2. **Deed legal-description parser** → `properties` rows + link `property_id` (reuse M112 shape).
3. **County grantor-grantee forward-trace** — manual/browser (Recorder of Deeds, Mac Mini).
4. **Metes-and-bounds → modern APN** georeferencing.
5. **Probate extractor captures no devisee per land item** (0/280) → probate land can't yield a grantee
   (#113). Same root cause as QW-3's 272 fail-closed skips.

## Guardrail (audit rule #1 — do not violate)
`DisgorgementCalculator` sums `consideration_usd WHERE implicates_enslaver=TRUE`. New chain-link rows are
PROVENANCE, not new valuations (land value already counted by the 115 `project-probate-to-disgorgement`
rows) → set `implicates_enslaver=FALSE` and `consideration_usd=NULL` on chain links to avoid double-count.
Coordinate with `project-probate-to-disgorgement.js` (also writes land_transfer_events) and the
parallel-owned `georgia-probate-scraper.js`.
