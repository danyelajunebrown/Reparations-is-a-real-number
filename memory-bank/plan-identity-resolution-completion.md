# Plan — Completing Identity Resolution for canonical_persons

_Scoping document, May 21 2026. Written off the back of the canonical-person
source-document audit._

## Problem

"Canonical" is supposed to mean **a verified, discrete, unique human being not
already in the database**. Today it does not — it means "a row some import or
promotion script created." `canonical_persons` has 559,984 rows (post junk
cleanup) and the verification artifact, `identity_fingerprint`, is populated on
only **157** of them (0.03%).

## Root cause — it is not "never run", it is "formula can't fire"

Migration `033-identity-system.sql` already did the work *structurally*:

- `identity_fingerprint VARCHAR(64)` column + index.
- A one-time backfill `UPDATE`.
- Trigger `trg_compute_fingerprint` that recomputes on every INSERT/UPDATE.

The fingerprint formula is:

```
md5( lower(last_name) | birth_year_estimate | lower(primary_state) )
```

…and it is **only computed when all three fields are non-NULL**:

```sql
IF NEW.last_name IS NOT NULL
   AND NEW.birth_year_estimate IS NOT NULL
   AND NEW.primary_state IS NOT NULL
```

`birth_year_estimate` is NULL for virtually every person — the 1860 slave
schedule, Louisiana, and SlaveVoyages imports carry no birth year. So the
trigger fires, hits the `ELSE`, and sets the fingerprint back to NULL. The
system runs on every row and produces nothing.

## What "completing" it requires

### 1. A fingerprint that does not depend on birth year

A dedup key must be computable from fields the data actually has. Proposed
**tiered fingerprint** — strongest available components, recorded with a tier:

| Tier | Components | When |
|------|-----------|------|
| 1 | last_name + birth_year + primary_state | birth year known (~today's 157 + future) |
| 2 | last_name + first_name + primary_county + primary_state | county known |
| 3 | last_name_soundex + first_name_soundex + primary_state | minimal |

`canonical_persons` already has `first_name_soundex`, `last_name_soundex`,
`first_name_metaphone`, `last_name_metaphone` — tier 3 is computable now for
almost the whole table. Store the tier used (reuse the existing `match_tier`
column or add `fingerprint_tier`).

### 2. Rewrite the trigger + re-backfill

Replace `compute_identity_fingerprint()` with the tiered logic; never leave the
fingerprint NULL when *any* tier is satisfiable. One-time `UPDATE` over all
~560K rows. New migration.

### 3. Duplicate detection (the actual point)

A fingerprint is only a dedup *signal* — collisions are candidate duplicates,
not confirmed ones. Build a review/merge pass:

- Group by `identity_fingerprint`; clusters of >1 are merge candidates.
- Tier 1 collisions: high-confidence auto-merge eligible. Tier 3 collisions:
  human review (common-name false-positive risk — same problem the climber's
  confidence filter already fights).
- `person_merge_log` and the `merged` person_type already exist (12 rows) —
  the merge plumbing is partly built; wire it to the fingerprint clusters.

### 4. Decide the placeholder-name records

`louisiana_import` has hundreds of rows named `"no name"`, `"unnamed"`,
`"none given"` — real but un-named enslaved individuals. They must NOT be
fingerprint-merged (they would all collapse together). Either exclude rows with
a non-name from fingerprinting, or model them as "N unnamed individuals in
transaction X" instead of N individual person rows. Data-model decision.

## Sequencing

1. New migration: tiered fingerprint formula + trigger rewrite + re-backfill.
2. Dry-run a duplicate-cluster report (no merges) — measure how bad dedup is.
3. Auto-merge tier-1 exact collisions behind a dry-run/apply script.
4. Queue tier-2/3 collisions for human review.

## Out of scope here

This does not touch the source-document coverage work (Buckets B/C1 done, C2
needs the evidence panel). It is purely about making `canonical` mean what the
user says it means: one row = one verified discrete human.
