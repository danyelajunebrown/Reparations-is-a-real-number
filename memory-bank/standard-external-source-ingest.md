# STANDARD — External-source ingest (aggregate + person-level)

_Codified from the 2026-07-03 benchmark + de-siloing session, where two systematic corruptions
(census `stateicp` VA↔TN transposition; SlaveVoyages `sv_id` namespace collision) each passed a
naive check and were caught only by a deeper gate. These rules are mandatory for every new source
scrape/ingest ([[reference-benchmark-sources-register]], scrape issues #119/#120)._

## 1. Use the CERTIFIED variable, never a present-but-uncertified column
A column existing in a file ≠ it being valid. IPUMS ships `stateicp` in the household CSVs but marks
it UNAVAILABLE; it transposes VA↔TN 1810-1840. The fix was the county file's certified `statefip`.
→ Before keying on any identifier/geography field, confirm the source certifies it. Prefer the
validated variable even if it means a different file/extract.

## 2. Validate PER-STRATUM, not just the total
A total conserves swaps: a VA↔TN transposition left the national enslaved total within 0.3% while
per-state strata were 60-200% wrong. A national/aggregate gate is NECESSARY BUT NOT SUFFICIENT.
→ Every aggregate ingest MUST check the finest strata it claims (per-state, per-parish, per-province)
against independent control totals, and BLOCK on a stratum failure even when the total passes. Bake
the per-stratum tripwire INTO the ingest script (see `ingest-ipums-census-benchmark.mjs` per-state
gate, `seed-slave-economy-benchmarks.mjs` parish/province sum checks).

## 3. Land the FULL attribute set on the spine — never thin-name + orphaned side table
SlaveVoyages was ingested thin (names → `canonical_persons` with `primary_state` NULL; the rich
geography stranded in `slavevoyages_past_people`, 169,065 orphaned). Same failure as the old
Louisiana import. The side table can't answer "who's in Cuba"; the spine must.
→ Route every person through `PersonService.findOrCreateLead` with ALL available attributes
(name, sex, birthYear, location, origin, occupation, condition, relationships, source IDs). A raw
staging table is fine, but the SPINE entity (lead/canonical) carries the attributes + blocking keys.
For #119 (British Slave Registers): name/sex/age/colour/birthplace(creole|African+ethnic)/occupation/
manumission + the named enslaver ALL land — not just names.

## 4. `id_system` must be PRODUCT-specific; external-id matching is namespace-strict
The 5,275 false links (enslaved→enslaver) came from two SlaveVoyages products both labelled
`id_system='slavevoyages'` with colliding integer external-ids, so tier-1 (name-blind) external match
bolted the wrong records together. IDs from different products of one source are DIFFERENT namespaces.
→ `id_system` values must name the PRODUCT (`slavevoyages_africanorigins`, `slavevoyages_voyages`,
`t71_register`, `t71_compensation`), never just the vendor. Never pass an external-id to `resolve()`
across a namespace you haven't confirmed is the same entity type. Existing coarse labels (the 51,111
`slavevoyages` canonicals) need re-tagging (see the person_external_ids overhaul issue).

## 5. Provenance must reach the LEAD, not just the canonical
`person_external_ids` is canonical-only (FK), so lead-origin source IDs currently live in a context
string — unqueryable, unjoinable. → make `person_external_ids` polymorphic `(subject_table,
subject_id)` (mirror M101/M103) so a gated lead carries its `t71_register`/`sv_id`/deed-id as a
first-class, resolvable external id. Prerequisite for clean scrape provenance.

## 6. Reference-class correctness: don't conflate distinct populations
Freetown (62k) / St Helena disembarkations are RECAPTIVES (Africans liberated from slave ships), NOT
an enslaved population at that place — a different reference class from a slaveholding denominator.
→ Tag by the actual status/event (liberated-recaptive vs enslaved-held), as a dated status FACT
([[plan-96-person-status-model]]), never "enslaved at <liberation site>". Benchmarks keep recaptive
tallies in a separate class from slaveholding denominators.

## 7. Keep source discrepancies as-transcribed; annotate, don't fudge
la Sagra's capital line-items sum to $507,087,002 vs a stated total of $507,088,002 ($1k source
error). We kept both, noted the discrepancy, and used a tolerance on that one check — never altered a
figure to force agreement. → Validation tolerances document KNOWN SOURCE discrepancies; they are
never used to paper over OUR transcription errors (those checks stay exact).

## 8. DUAL-ARCHIVE every source: S3 re-host AND Wayback snapshot (non-optional)
This is the M100 `source_artifacts` standard ("our S3 re-host + the Internet Archive/Wayback snapshot of
its canonical page") and the SlaveVoyages ingest followed it (`ensureSnapshot`). It was NEVER codified as
a rule here, so the LBS ingest silently regressed — it wrote per-page HTML to S3 but left `wayback_url`
NULL (caught 2026-07-06; backfilled). → EVERY external-source ingest MUST, per source: (a) re-host the
file/page to S3 (`s3_key`) when `rehostable=TRUE`; AND (b) `ensureSnapshot()` the canonical source page to
Wayback and record `wayback_url` on the `source_artifacts` row. S3 = serving copy; Wayback = independent
provenance/backup (rate-limited, so snapshot the DATASET/record page, not necessarily every image). For
`rehostable=FALSE` sources (JFS no-repost, etc.), S3 stays NULL and Wayback/link-only is the record. A
gate-lifting document image (register scan) that lands in S3 gets its source page Wayback-snapshotted too.
Verify `wayback_url` is populated as part of ingest done-ness.

## See also
[[reference-benchmark-sources-register]] · [[plan-ipums-census-benchmark]] ·
[[standard-canonical-person-and-document-gate]] · [[assessment-de-siloing-orphaning]] ·
[[plan-96-person-status-model]]
