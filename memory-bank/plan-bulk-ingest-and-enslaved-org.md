# PLAN — bulk-ingest performance architecture + Enslaved.org (#136)

_2026-07-06. User flagged: the LBS promote was ~4h for 21K records over Neon — "super slow… a worry
given we have only begun to approach the true size of this corpus, even if they're just leads without
documents." Fix the ingest architecture BEFORE the 731K Enslaved.org load. This plan holds both._

## THE PERFORMANCE PROBLEM (diagnosed)
Root cause = **per-record round-trip multiplier over a remote DB**. `PersonService.findOrCreateLead`
does, PER person: resolve() (blocking-key lookup + `find_person_match`) + INSERT unconfirmed_persons +
`_writeBlockingKeys` (several INSERTs) + person_external_ids INSERT ≈ **6–10 network round-trips/person**.
Neon is us-east-1; each round-trip is tens of ms. Observed ≈ **1.5 records/sec** (21K in ~4h). At that
rate: Enslaved.org 731K ≈ **5–6 days**; the full multi-source corpus (Dutch 160K + PR 30K + FOTM 32K +
Hall/SV already in + …) = weeks. Infeasible. NOT a documents problem — it's the lead-creation path.

## THE FIX — a set-based BULK-INGEST path (keep PersonService for interactive)
Move large ingests off per-row app loops onto **set-based SQL**:
1. **COPY** the source's normalized rows into a per-source staging table (one bulk load, not N inserts).
2. **Dedup + create in bulk with INSERT…SELECT**, not per-row SELECT-then-INSERT:
   - external-id dedup: `INSERT INTO person_external_ids … SELECT … FROM staging ON CONFLICT DO NOTHING`
     (the ext-id unique index IS the dedup — no app-side cache needed at bulk scale).
   - leads: `INSERT INTO unconfirmed_persons … SELECT … FROM staging s WHERE NOT EXISTS (ext-id match)`.
   - blocking keys: ONE `INSERT INTO person_blocking_keys … SELECT (set-based key derivation)` — port the
     `_queryKeys` scheme (nmsx/soundex/metaphone) to SQL (or precompute keys in the staging COPY).
   Postgres does 731K set-based rows in **minutes**, not days — the round-trip count drops from ~7M to ~5.
3. **Biscoe stays safe:** bulk path is for GATED SECONDARY leads (no auto-promote, no auto-merge); the
   scored resolver / cross-source dedup (#128-style) runs AFTER as its own set-based pass over the
   staging↔spine blocking-key join — same discipline, just not inline per row.
4. Keep `PersonService.findOrCreateLead` for the INTERACTIVE path (scrapers, /submit-data, small ingests
   where per-record resolution matters). Add `PersonService.bulkIngestLeads(stagingTable, opts)` OR a
   standalone `scripts/lib/bulk-lead-ingest.mjs` the source ingests call.
Secondary wins: run the ingest from a box closer to us-east-1 if it stays chatty; pg.Pool TCP + a single
reused connection + `UNNEST`-batched multi-row inserts (already used in seed/wayback) for any residual
per-batch work. Target: **≥1,000 leads/sec** bulk (500–1000x).

## ENSLAVED.ORG (#136) — ontology MAPPED, ingest design (sits on the bulk path)
Dump = **standard Wikibase JSON**, `latest.wikibase.dump.json.gz` (464MB, fresh 2026-03-31), no auth.
One Q-entity per line: `{type:item|property, id:Qn, labels, descriptions, claims:{Pn:[statements]}}`.
Mixed vocabulary + Person + Event + Place + Source entities. **Property map (from the dump itself):**
- Identity: **P1** instance-of (→ distinguishes Person vs Event vs Place vs Source vs vocab), **P20**
  hasName, **P31** hasSex, **P32** hasRaceorColor, **P22** hasOccupation, **P3/P4** age value/category.
- **Role (the enslaver/enslaved derivation): P17** hasParticipantRole, **P24** hasDescriptiveRole,
  **P29** providesParticipantRole, **P30** hasEventType, **P33** hasPersonStatus, **P34**
  hasStatusGeneratingEvent → map role/status Q-values to our owner/enslaved role groups (person-roles.js).
- Kinship: **P37** hasSpouse, **P38** hasChild, **P39/P40** inter-agent relationship.
- **Provenance / DEDUP: P13** hasContributor, **P6** isDirectlyBasedOn, **P16** generatedBy, **P21**
  hasExternalReference (the native source id), **P15** hasLicenseInfo.
**Ingest steps:** (a) download dump on the Mini; (b) stream line-by-line, build the Q→label vocab map
first, then for each Person Q-item resolve P-values → {name, sex, race, occupation, age, role, status,
spouse/child Q-refs, contributor, native ext ref}; (c) **SKIP the federated slices we already hold** —
filter on P13 hasContributor ∈ {SlaveVoyages, Louisiana/Hall} → do NOT re-ingest (dedup by contributor,
then by name+context vs our spine); (d) COPY the NEW-dataset persons into staging → **bulk path** above;
(e) `id_system` PRODUCT-specific: `enslaved_org_qid` (the Q-id) PLUS preserve the contributor's native id
(rule #4); (f) gated SECONDARY (LOD, no images → no gate lift); (g) **embed phase** (RULE 0.5); (h)
kinship P37/P38 → `canonical_family_edges` producer (Biscoe-gated, later). License: per-dataset (JSDP =
CC BY-NC-SA); non-commercial OK.

## SEQUENCE
1. Build + test the **bulk-lead-ingest path** on a slice (validate against the per-record path: same
   leads, same blocking keys, same ext-ids — but 100–1000x faster). Re-promote LBS via it as the A/B check.
2. THEN Enslaved.org #136 on the bulk path. Then Dutch #137 / PR #138 / FOTM #139 etc. all reuse it.
See also [[assessment-macgregor-cuba-source-and-benchmark-scope]] · data-sourcing-shopping-list.md · #135.
