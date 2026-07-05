# FINDING — `person_documents_with_names` census/petition/will linkages are NAME-ONLY and unverified (Jun 30 2026)

_Surfaced while marking confirmed slaveholders on Adrian Brown's lineage worksheet.
The user caught it: "Elizabeth Parker 1759–1793 New Jersey ⚖ Slave schedule" — a person
who DIED IN 1793 cannot be in an 1850/1860 census slave schedule._

## What's wrong
`person_documents_with_names.document_type='census_slave_schedule'` (and the will /
compensated_emancipation_petition rows) link a `canonical_person_id` to a slavery
document **by NAME ONLY**, with no temporal or geographic check and `human_verified=false`.
For a descendant whose ancestors are deep-colonial (1500s–1700s), this collides heavily
with the 33k+ real 1860-era enslaver records:
- Elizabeth Parker (NJ, d.1793) → "1860 Slave Schedule, Other, Georgia"
- Richard Lyman (CT, d.1640) → "1860 Florida"; James Patterson (d.1623) → "1860 Georgia"

On Adrian's 3,922-ancestor climb: **of 140 census/petition/will linkages, only 4 were
real** (the Hopewell/Biscoe line — Ann Maria Biscoe & Angelica Chew via 1862 DC petitions,
James Hopewell 1817 will, Hugh Hopewell 1797 will). The other 136 were impossible name
collisions. My first worksheet wrongly asserted "106 confirmed slaveholders" → audit-rule
violation ("real or absent"). Corrected to 4.

## Scope (DB-wide)
`person_documents_with_names` census_slave_schedule rows: **33,791 total** — 116 with the
canonical person dead before 1850, 137 born before 1760 (the egregious ones are ~250, i.e.
small DB-wide), but **0 / 33,791 are `human_verified`**, and **33,393 are person_type='enslaver'**.
So the table is mostly real 1860-era people; the false-positives concentrate where a
modern descendant's PRE-1760 ancestors share a name with a real 1860 enslaver. Risk: any
DAA / enslaver-promotion path that trusts these unverified name links will fabricate
slaveholder claims for descendants with deep-colonial trees. **Treat census/petition/will
person-doc links as UNVERIFIED leads, not confirmations, until date+place+human review.**

## ROOT CAUSE + RIGHT FIX (don't filter the bad source — use the verified one)
The bug was reading the WRONG table. The project already has a painstakingly-VERIFIED
confirmation layer: **`enslaver_evidence_compendium.evidence_strength='direct_primary'`**
(identity-resolved + primary-source). For Adrian that is exactly **4 people**: Ann Maria
Biscoe & Angelica Chew (`historical_reparations_petitions`, 1862 DC), Hugh Hopewell
(`will_extractions`), James Hopewell (`debt_acknowledgment_agreements`). The S3 gate alone
does NOT separate real from fake here — all 123 census links HAVE an `s3_url` (the 1860
schedule image is real); the **person↔document linkage** is the name-only false part, and
`human_verified=0`. So the assertable test is verified IDENTITY-resolved linkage, not "a
document exists."

`scripts/generate-lineage-worksheet.mjs` now marks ⚖ ONLY from
`enslaver_evidence_compendium WHERE evidence_strength='direct_primary'` and does NOT read
`person_documents_with_names` census/will/petition links at all → 4 confirmed, 0 false.
**General rule:** anything asserting "was a slaveowner" (worksheet, climber match, DAA)
must cross-reference the verified compendium / `person_relationships_verified` by
RESOLVED IDENTITY (person_blocking_keys / find_person_match), never by name string. The
climber's own `ancestor_climb_matches` are name/SlaveVoyages matches it self-classifies
(mostly `temporal_impossible`/`common_name_suspect`) — those are LEADS, not confirmations.
