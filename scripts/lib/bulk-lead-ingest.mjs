// bulk-lead-ingest.mjs — the set-based BULK path for large lead ingests (plan-bulk-ingest-and-enslaved-org.md).
//
// Replaces ~6-10 network round-trips PER person (PersonService.findOrCreateLead — the ~4h-for-21K Neon
// bottleneck) with ONE data-modifying CTE per BATCH: leads + person_external_ids + person_blocking_keys
// all created set-based. ext-id unique index IS the dedup (no app-side cache). Byte-identical to the
// interactive path: keys via derive_blocking_keys() (M121, = _queryKeys); same columns/defaults.
//
// Biscoe-safe: mints ONLY gated SECONDARY leads (status 'pending', no auto-promote/auto-merge). The
// scored cross-source resolver runs AFTER as its own set-based pass. Use for large gated-lead ingests
// (Enslaved.org #136, Dutch #137, …); keep findOrCreateLead for the interactive/scraper path.
//
// CONTRACT: each record MUST carry a UNIQUE sourceUrl (the per-record join key) + externalId + idSystem.
//   record = { name, sourceUrl, externalId, idSystem, personType?, birthYear?, deathYear?, sex?,
//              locations?[], sourceType?='scholarly', extractionMethod?='bulk', confidence?=0.8,
//              context?, dataQualityFlags?{}, relationships?[] }
//   bulkIngestLeads(pool, records, {batchSize=2000}) -> { created, linked, total, batches, ms }

const BATCH_DEFAULT = 2000;

export async function bulkIngestLeads(pool, records, opts = {}) {
  const batchSize = opts.batchSize || BATCH_DEFAULT;
  // de-dupe by sourceUrl within the input (the CTE join key must be 1:1 per batch)
  const seen = new Set();
  const recs = [];
  for (const r of records) {
    if (!r || !r.name || !r.sourceUrl || !r.externalId || !r.idSystem) continue;
    if (seen.has(r.sourceUrl)) continue;
    seen.add(r.sourceUrl); recs.push(r);
  }
  const t0 = Date.now();
  let created = 0, batches = 0;
  for (let i = 0; i < recs.length; i += batchSize) {
    const b = recs.slice(i, i + batchSize);
    const cols = {
      name: b.map(r => r.name),
      source_url: b.map(r => r.sourceUrl),
      external_id: b.map(r => String(r.externalId)),
      id_system: b.map(r => r.idSystem),
      person_type: b.map(r => r.personType || null),
      birth_year: b.map(r => r.birthYear ?? null),
      death_year: b.map(r => r.deathYear ?? null),
      sex: b.map(r => r.sex || null),
      source_type: b.map(r => r.sourceType || 'scholarly'),
      extraction_method: b.map(r => r.extractionMethod || 'bulk'),
      confidence: b.map(r => r.confidence ?? 0.8),
      context: b.map(r => r.context || null),
      dqf: b.map(r => JSON.stringify(r.dataQualityFlags || {})),
      rel: b.map(r => JSON.stringify(r.relationships || [])),
      loc: b.map(r => JSON.stringify(r.locations || [])),
    };
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const res = await c.query(
        `WITH stg AS (
           SELECT * FROM unnest(
             $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[],
             $8::text[], $9::text[], $10::text[], $11::numeric[], $12::text[], $13::jsonb[], $14::jsonb[], $15::jsonb[]
           ) AS t(name, source_url, external_id, id_system, person_type, birth_year, death_year,
                  sex, source_type, extraction_method, confidence, context, dqf, rel, loc)
         ),
         new_rows AS (
           SELECT s.* FROM stg s
           WHERE NOT EXISTS (SELECT 1 FROM person_external_ids e
                              WHERE e.id_system = s.id_system AND e.external_id = s.external_id)
         ),
         ins AS (
           INSERT INTO unconfirmed_persons
             (full_name, person_type, birth_year, death_year, gender, locations, source_url,
              source_type, extraction_method, confidence_score, context_text, data_quality_flags, relationships, status)
           SELECT name, person_type, birth_year, death_year, sex,
                  CASE WHEN loc IS NULL OR loc = '[]'::jsonb THEN NULL
                       ELSE ARRAY(SELECT jsonb_array_elements_text(loc)) END,
                  source_url, source_type, extraction_method, confidence, context, dqf, rel, 'pending'
           FROM new_rows
           RETURNING lead_id, source_url
         ),
         eids AS (
           INSERT INTO person_external_ids (subject_table, subject_id, id_system, external_id, external_url, confidence)
           SELECT 'unconfirmed_persons', ins.lead_id, s.id_system, s.external_id, s.source_url, s.confidence
           FROM ins JOIN new_rows s ON s.source_url = ins.source_url
           ON CONFLICT (id_system, external_id) DO NOTHING
           RETURNING 1
         ),
         keys AS (
           INSERT INTO person_blocking_keys (subject_table, subject_id, key_type, key_value)
           SELECT 'unconfirmed_persons', ins.lead_id, k.key_type, k.key_value
           FROM ins JOIN new_rows s ON s.source_url = ins.source_url
           CROSS JOIN LATERAL derive_blocking_keys(s.name, s.sex, s.birth_year) k
           ON CONFLICT (subject_table, subject_id, key_value) DO NOTHING
           RETURNING 1
         )
         SELECT (SELECT count(*) FROM ins)::int AS created`,
        [cols.name, cols.source_url, cols.external_id, cols.id_system, cols.person_type,
         cols.birth_year, cols.death_year, cols.sex, cols.source_type, cols.extraction_method,
         cols.confidence, cols.context, cols.dqf, cols.rel, cols.loc]);
      await c.query('COMMIT');
      created += res.rows[0].created;
      batches++;
    } catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  }
  return { created, linked: recs.length - created, total: recs.length, batches, ms: Date.now() - t0 };
}
