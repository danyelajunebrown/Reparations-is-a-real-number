/**
 * PersonService — the single person create/find/promote gate for the whole layer.
 * See memory-bank/design-person-service-consolidation.md.
 *
 * STEP 1 (this file, read-only): resolve(query) — search the UNIFIED pool
 * (person_blocking_keys, polymorphic over leads + canonicals, M101) + the DB
 * find_person_match() (external-id / name+date+loc), return the best existing
 * subject. Tier-3 / name-only is NEVER an auto-match (Biscoe) — it comes back as
 * `candidates` for review, not `match`.
 *
 * findOrCreateLead / promoteToCanonical / merge / link land in later steps; nothing
 * here writes.
 */
'use strict';

const SUBJECT_TABLES = {
  canonical_persons:        { idCol: 'id',      nameCol: 'canonical_name', kind: 'canonical' },
  unconfirmed_persons:      { idCol: 'lead_id', nameCol: 'name',           kind: 'lead' },
  slavevoyages_past_people: { idCol: 'sv_id',   nameCol: 'name',           kind: 'lead', idCast: 'int' },
  hall_slave_records:       { idCol: 'record_index', nameCol: 'name',      kind: 'lead' },
};

// External-assertion gate (M102 / standard-canonical-person-and-document-gate.md): which
// document_type values substantiate which proposition. A STORED doc (s3_key present) of one of
// these types lifts that proposition's gate. Bare profiles (familysearch_record, tree_profile),
// 'other', 'research_report', and URL-only secondary records (slavevoyages_record) substantiate
// NOTHING — they are deliberately absent. Extensible: add a type as new sources are vetted.
const DOC_PROP_SLAVEOWNER = [
  'census_slave_schedule', 'slave_schedule', 'census', 'will', 'will_testament',
  'estate_inventory', 'estate_account', 'guardian_account', 'compensated_emancipation_petition',
  'compensation_petition', 'emancipation_petition', 'plantation_record', 'bill_of_sale',
  'slave_manifest', 'tax_record', 'court_record', 'insurance_register', 'government_disclosure',
  'corporate_disclosure', 'correspondence',
];
const DOC_PROP_ENSLAVED = [
  'will', 'will_testament', 'estate_inventory', 'estate_account',
  'compensated_emancipation_petition', 'emancipation_petition', 'plantation_record',
  'freedmens_bank', 'certificate_of_freedom', 'slave_narrative', 'freedman_narrative',
  'narrative', 'evacuation_roll', 'enslaved_census_brazil', 'enslaved_census',
  'probate_enslaved_records', 'bill_of_sale', 'slave_manifest', 'correspondence',
];

class PersonService {
  constructor(db) { this.db = db; }

  // ---- helpers ----
  _norm(s) { return (s == null ? '' : String(s)).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  _sex1(s) { const c = (s == null ? '' : String(s)).trim().toLowerCase()[0]; return c === 'm' ? 'm' : c === 'f' ? 'f' : 'u'; }
  _parseName(full) {
    const parts = String(full || '').trim().split(/[\s,]+/).filter(Boolean);
    if (!parts.length) return { first: '', last: '' };
    if (String(full).includes(',')) return { first: parts[1] || '', last: parts[0] }; // "Last, First"
    return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : '' };
  }
  _lev(a, b) {
    a = a || ''; b = b || ''; if (a === b) return 0;
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  _sim(a, b) { const L = Math.max(a.length, b.length); return L ? 1 - this._lev(a, b) / L : 0; }

  /** Compute the blocking key_values a query would share with existing subjects.
   *  Surname scheme (sn/s4/mp) reaches canonicals/Hall/unconfirmed; name+sex scheme
   *  (nmsx/nmsxb) reaches SlaveVoyages-PAST-style leads. */
  async _queryKeys(query) {
    const keys = [];
    const { first, last } = this._parseName(query.name);
    const surname = this._norm(last);
    if (surname.length >= 2) {
      keys.push('sn:' + surname);
      if (surname.length >= 4) keys.push('s4:' + surname.slice(-4));
      try { const r = await this.db.query('SELECT metaphone($1,8) mp', [surname]); if (r.rows[0]?.mp) keys.push('mp:' + r.rows[0].mp); } catch { /* fuzzystrmatch absent */ }
    }
    const nm = this._norm(query.name);
    const sx = this._sex1(query.sex);
    if (nm) {
      keys.push('nmsx:' + nm + ':' + sx);
      if (query.birthYear) keys.push('nmsxb:' + nm + ':' + sx + ':' + (Math.floor(query.birthYear / 10) * 10));
    }
    // person_blocking_keys.key_value is varchar(64); a long name (e.g. an estate-style owner
    // string) would overflow. Cap every key at 64 — applied here so READ and WRITE truncate
    // identically (matching is preserved; only pathologically long names collide, → candidates).
    return keys.map(k => (k.length > 64 ? k.slice(0, 64) : k));
  }

  /** Fetch display rows for a set of {subject_table, subject_id} refs. */
  async _fetchSubjects(refs) {
    const byTable = {};
    for (const r of refs) (byTable[r.subject_table] ||= new Set()).add(r.subject_id);
    const out = [];
    for (const [table, idset] of Object.entries(byTable)) {
      const cfg = SUBJECT_TABLES[table]; if (!cfg) continue;
      const idExpr = cfg.idCast === 'int' ? `${cfg.idCol}::int` : cfg.idCol;
      const ids = [...idset];
      const sel = table === 'canonical_persons'
        ? `id::text AS sid, canonical_name AS name, birth_year_estimate AS birth_year, primary_state AS state, sex, person_type`
        : table === 'slavevoyages_past_people'
        ? `sv_id::text AS sid, name, (year - age)::int AS birth_year, disembark_port AS state, sex, 'enslaved' AS person_type`
        : table === 'unconfirmed_persons'
        ? `lead_id::text AS sid, full_name AS name, birth_year, locations[1] AS state, gender AS sex, person_type`
        : `record_index::text AS sid, name, year::int AS birth_year, location AS state, sex, 'enslaved' AS person_type`;
      const rows = (await this.db.query(`SELECT ${sel} FROM ${table} WHERE ${idExpr} = ANY($1::int[])`, [ids])).rows;
      for (const row of rows) out.push({ subject_table: table, subject_id: Number(row.sid), kind: cfg.kind, ...row });
    }
    return out;
  }

  _score(query, s) {
    const qn = this._norm(query.name), sn = this._norm(s.name);
    let score = 0, signals = [];
    const nameSim = this._sim(qn, sn);
    if (qn && qn === sn) { score += 0.55; signals.push('name_exact'); }
    else if (nameSim >= 0.85) { score += 0.40; signals.push('name_fuzzy'); }
    else if (nameSim >= 0.70) { score += 0.20; signals.push('name_weak'); }
    if (query.birthYear && s.birth_year && Math.abs(query.birthYear - s.birth_year) <= 3) { score += 0.25; signals.push('birth_year'); }
    if (query.location && s.state && this._norm(query.location).includes(this._norm(s.state).slice(0, 6))) { score += 0.10; signals.push('location'); }
    if (query.sex && s.sex && this._sex1(query.sex) === this._sex1(s.sex)) { score += 0.05; signals.push('sex'); }
    return { score: Math.min(score, 0.99), signals };
  }

  /**
   * resolve(query) → { match, candidates }
   * query: { name, birthYear?, location?, sex?, externalId?, idSystem?, personType? }
   * match is returned ONLY for a Tier-1 external-id hit or a Tier-2 name+corroborator
   * (birth_year / location / external id). Name-only (Tier-3) → candidates, never match.
   */
  async resolve(query = {}) {
    const out = { match: null, candidates: [] };
    if (!query.name && !query.externalId) return out;

    // Tier 1 — external id (exact, canonical) via find_person_match
    if (query.externalId && query.idSystem) {
      const r = await this.db.query('SELECT * FROM find_person_match($1,$2,$3,$4,$5,$6)',
        [query.name || '', query.birthYear || null, query.location || null, query.personType || null, query.externalId, query.idSystem]);
      const t1 = r.rows.find(x => x.match_tier === 1);
      if (t1) { out.match = { subject_table: 'canonical_persons', subject_id: t1.canonical_person_id, kind: 'canonical', name: t1.canonical_name, tier: 1, confidence: Number(t1.match_confidence), signals: ['external_id'] }; return out; }
    }

    // Gather candidate subjects from the unified blocking pool + find_person_match name tiers.
    // Split keys by selectivity: STRONG (exact surname sn, name+sex nmsx/nmsxb) are selective
    // and must always be included; WEAK phonetic bridges (s4 suffix, mp metaphone) collide with
    // thousands (e.g. mp:UNKPRSN ↔ every Henderson/Anderson) so they're only a small capped
    // supplement — otherwise they flood out the real selective matches under the LIMIT.
    const keys = await this._queryKeys(query);
    const strongKeys = keys.filter(k => /^(sn|nmsx|nmsxb):/.test(k));
    const weakKeys = keys.filter(k => /^(s4|mp):/.test(k));
    const refMap = new Map();
    const addRefs = rows => rows.forEach(r => refMap.set(r.subject_table + ':' + r.subject_id, r));
    // Per-key lookup with a per-key cap: a common key (sn:harris, mp:UNKPRSN) must not crowd
    // out a SELECTIVE key's matches (nmsx:harriswilliam) under a shared LIMIT — that crowding
    // caused both a self-match miss AND a false positive in testing (only one of two William
    // Harrises survived, so the ambiguity guard never saw the tie).
    for (const k of strongKeys) addRefs((await this.db.query(
      `SELECT DISTINCT subject_table, subject_id FROM person_blocking_keys WHERE key_value = $1 LIMIT 200`, [k])).rows);
    for (const k of weakKeys) addRefs((await this.db.query(
      `SELECT DISTINCT subject_table, subject_id FROM person_blocking_keys WHERE key_value = $1 LIMIT 80`, [k])).rows);
    let refs = [...refMap.values()];
    // include find_person_match name+date+loc canonical candidates
    if (query.name) {
      const fm = await this.db.query('SELECT * FROM find_person_match($1,$2,$3,$4,NULL,NULL)',
        [query.name, query.birthYear || null, query.location || null, query.personType || null]).catch(() => ({ rows: [] }));
      for (const x of fm.rows) refs.push({ subject_table: 'canonical_persons', subject_id: x.canonical_person_id });
    }
    if (!refs.length) return out;

    const subjects = await this._fetchSubjects(refs);
    const scored = subjects.map(s => { const { score, signals } = this._score(query, s); return { ...s, confidence: score, signals }; })
      .filter(s => s.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);

    out.candidates = scored.slice(0, 10);
    // A real MATCH needs name + a non-name corroborator AND must be UNAMBIGUOUS — if any
    // other candidate ties/near-ties the top score, it's a common-name collision (e.g. 6
    // distinct "Mary b.181x"), so we never auto-match; surface all for review (Biscoe rule).
    const top = scored[0];
    const corroborated = top && top.signals.some(g => g === 'birth_year' || g === 'location' || g === 'external_id');
    const ambiguous = top && scored.filter(s => s.confidence >= top.confidence - 0.05).length > 1;
    if (top && top.confidence >= 0.80 && top.signals.includes('name_exact') && corroborated && !ambiguous) {
      out.match = { ...top, tier: 2 };
    } else if (top) {
      out.ambiguous = !!ambiguous; // signal to callers: needs review, do not auto-link
    }
    return out;
  }

  /** Write the appropriate blocking keys for a subject (surname scheme if a surname is
   *  present; name+sex composite always) into the polymorphic person_blocking_keys. */
  async _writeBlockingKeys(subjectTable, subjectId, record) {
    const keys = await this._queryKeys({ name: record.name, sex: record.sex, birthYear: record.birthYear });
    if (!keys.length) return 0;
    const kt = keys.map(k => k.split(':')[0]);
    const res = await this.db.query(
      `INSERT INTO person_blocking_keys (subject_table, subject_id, key_type, key_value)
       SELECT $1, $2, u.kt, u.kv FROM unnest($3::text[], $4::text[]) AS u(kt, kv)
       ON CONFLICT (subject_table, subject_id, key_value) DO NOTHING`,
      [subjectTable, subjectId, kt, keys]);
    return res.rowCount;
  }

  /**
   * findOrCreateLead(record, opts) — the ingest entry point. resolve() first; if a
   * confident, unambiguous match exists, LINK to it (never duplicate). Otherwise create a
   * LEAD in unconfirmed_persons (NEVER a canonical) + its blocking keys, so it's
   * discoverable for future matching. opts.dryRun returns the decision without writing.
   * record: { name, birthYear, sex, location|locations, sourceUrl, sourceType, personType,
   *           confidence, context, externalId?, idSystem? }
   */
  async findOrCreateLead(record = {}, opts = {}) {
    const dry = !!opts.dryRun;
    const res = await this.resolve({
      name: record.name, birthYear: record.birthYear, location: record.location || (record.locations && record.locations[0]),
      sex: record.sex, externalId: record.externalId, idSystem: record.idSystem, personType: record.personType,
    });
    if (res.match) {
      if (!dry && record.externalId && record.idSystem && res.match.subject_table === 'canonical_persons') {
        await this.db.query(
          `INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, external_url, confidence)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id_system, external_id) DO NOTHING`,
          [res.match.subject_id, record.idSystem, record.externalId, record.sourceUrl || null, 0.9]).catch(() => {});
      }
      return { ref: res.match, action: 'linked', candidates: res.candidates };
    }
    if (!record.name) return { ref: null, action: 'rejected_no_name', candidates: res.candidates };
    if (dry) return { ref: { subject_table: 'unconfirmed_persons', subject_id: null }, action: 'would_create', candidates: res.candidates };

    const ins = await this.db.query(
      `INSERT INTO unconfirmed_persons (full_name, person_type, birth_year, death_year, gender, locations, source_url, source_type, extraction_method, confidence_score, context_text, data_quality_flags, relationships, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING lead_id`,
      [record.name, record.personType || null, record.birthYear || null, record.deathYear || null, record.sex || null,
       record.locations || (record.location ? [record.location] : null), record.sourceUrl || '(unspecified)',
       record.sourceType || 'secondary', record.extractionMethod || 'ml', record.confidence || null, record.context || null,
       record.dataQualityFlags ? JSON.stringify(record.dataQualityFlags) : '{}',
       record.relationships ? JSON.stringify(record.relationships) : '[]',
       record.status || 'pending']);
    const leadId = ins.rows[0].lead_id;
    await this._writeBlockingKeys('unconfirmed_persons', leadId, record);
    // NB: external ids for leads have no home yet (person_external_ids FK is canonical-only) —
    // tracked as a follow-up (polymorphic external ids). Not dropped: kept in context if needed.
    return { ref: { subject_table: 'unconfirmed_persons', subject_id: leadId }, action: 'created', candidates: res.candidates };
  }

  // ---- promotion + external-assertion gate (step 3) ----

  /** Load identity fields for any subject ref (lead or canonical). */
  async _loadSubject(ref) {
    if (!ref || !ref.subject_table || ref.subject_id == null) return null;
    const rows = await this._fetchSubjects([{ subject_table: ref.subject_table, subject_id: Number(ref.subject_id) }]);
    return rows[0] || null;
  }

  /**
   * recomputeGate(canonicalId) — derive the external-assertion gate from STORED documents.
   * A proposition becomes assertable ONLY when a person_documents row exists with s3_key
   * present (a real archived file, not a URL pointer) AND a document_type that substantiates
   * that proposition (DOC_PROP_*). Returns { assertable_slaveowner, assertable_enslaved }.
   */
  async recomputeGate(canonicalId) {
    const r = await this.db.query(
      `UPDATE canonical_persons SET
         assertable_slaveowner = EXISTS (SELECT 1 FROM person_documents d
            WHERE d.canonical_person_id = $1 AND d.s3_key IS NOT NULL AND d.document_type = ANY($2)),
         assertable_enslaved   = EXISTS (SELECT 1 FROM person_documents d
            WHERE d.canonical_person_id = $1 AND d.s3_key IS NOT NULL AND d.document_type = ANY($3)),
         updated_at = now()
       WHERE id = $1
       RETURNING assertable_slaveowner, assertable_enslaved`,
      [canonicalId, DOC_PROP_SLAVEOWNER, DOC_PROP_ENSLAVED]);
    return r.rows[0] || { assertable_slaveowner: false, assertable_enslaved: false };
  }

  /**
   * promoteToCanonical(leadRef, evidence, opts) — mint/attach a canonical under the standard.
   * - DEDUPES first (resolve): an unambiguous existing-canonical match is REUSED (link), never
   *   duplicated; an AMBIGUOUS match refuses → needs_review (Biscoe, no auto-merge).
   * - Creates a canonical only when no existing match (requires ≥ a secondary source; gate
   *   booleans default FALSE — a secondary-only canonical exists + works internally but stays
   *   GATED). Writes soundex/metaphone + blocking keys so it's discoverable in the unified pool.
   * - Writes a person_documents row (s3_key only if a real stored file is supplied) + optional
   *   external id, then recomputeGate (gate lifts only for a proposition with a qualifying
   *   STORED doc). Marks the source lead 'promoted'. NEVER asserts anything externally.
   * evidence: { sourceType?, confidence?, personType?, externalId?, idSystem?, createdBy?,
   *   document?: { documentType, sourceUrl, s3Url, s3Key, evidenceStrength, documentYear, nameAsAppears } }
   */
  async promoteToCanonical(leadRef, evidence = {}, opts = {}) {
    const dry = !!opts.dryRun;
    const subj = await this._loadSubject(leadRef);
    if (!subj) return { ref: null, action: 'subject_not_found' };
    if (!subj.name) return { ref: null, action: 'rejected_no_name' };

    const personType = evidence.personType || subj.person_type || null;
    const res = await this.resolve({ name: subj.name, birthYear: subj.birth_year, location: subj.state, sex: subj.sex, externalId: evidence.externalId, idSystem: evidence.idSystem, personType });
    if (res.ambiguous) return { ref: null, action: 'needs_review', candidates: res.candidates };

    let canonicalId, action;
    if (res.match && res.match.subject_table === 'canonical_persons') {
      canonicalId = res.match.subject_id; action = 'linked';
      if (dry) return { ref: { subject_table: 'canonical_persons', subject_id: canonicalId }, action, candidates: res.candidates };
    } else {
      if (dry) return { ref: { subject_table: 'canonical_persons', subject_id: null }, action: 'would_create', candidates: res.candidates };
      const { first, last } = this._parseName(subj.name);
      const sx = this._sex1(subj.sex); const sex = sx === 'u' ? null : sx;
      const ins = await this.db.query(
        `INSERT INTO canonical_persons
           (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
            sex, person_type, birth_year_estimate, primary_state, confidence_score, verification_status, created_by)
         VALUES ($1, $2::text, $3::text, soundex($2::text), soundex($3::text), metaphone($3::text,8), $4,$5,$6,$7,$8,'promoted',$9)
         RETURNING id`,
        [subj.name, first || null, last || null, sex, personType, subj.birth_year || null, subj.state || null,
         evidence.confidence || 0.70, evidence.createdBy || 'person_service']);
      canonicalId = ins.rows[0].id; action = 'created';
      await this._writeBlockingKeys('canonical_persons', canonicalId, { name: subj.name, sex: subj.sex, birthYear: subj.birth_year });
    }

    // Evidence document (≥ secondary; s3_key only when a real stored file is supplied).
    const doc = evidence.document || {};
    await this.db.query(
      `INSERT INTO person_documents
         (canonical_person_id, name_as_appears, document_type, source_url, source_type, s3_url, s3_key, evidence_strength, document_year, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (COALESCE(canonical_person_id, '-1'::integer), COALESCE(unconfirmed_person_id, '-1'::integer), COALESCE(s3_url, ''::text), name_as_appears) DO NOTHING`,
      [canonicalId, doc.nameAsAppears || subj.name, doc.documentType || null, doc.sourceUrl || evidence.sourceUrl || null,
       evidence.sourceType || 'secondary', doc.s3Url || null, doc.s3Key || null,
       doc.evidenceStrength || (doc.s3Key ? 'primary' : 'secondary_database'), doc.documentYear || null,
       evidence.createdBy || 'person_service']);

    if (evidence.externalId && evidence.idSystem) {
      await this.db.query(
        `INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, external_url, confidence)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id_system, external_id) DO NOTHING`,
        [canonicalId, evidence.idSystem, evidence.externalId, doc.sourceUrl || evidence.sourceUrl || null, 0.9]).catch(() => {});
    }

    const gate = await this.recomputeGate(canonicalId);

    if (leadRef.subject_table === 'unconfirmed_persons') {
      await this.db.query(
        `UPDATE unconfirmed_persons SET status='promoted', reviewed_at=now(), reviewed_by=$2,
           review_notes = COALESCE(review_notes,'') || $3 WHERE lead_id=$1`,
        [leadRef.subject_id, evidence.createdBy || 'person_service', ` [promoted→canonical#${canonicalId}]`]).catch(() => {});
      // The lead's identity now lives in the canonical — drop its blocking keys so it stops
      // competing as a separate subject in the unified pool (otherwise a future resolve sees
      // BOTH the promoted lead and its canonical → false ambiguity, breaking dedup-on-ingest).
      await this.db.query(
        `DELETE FROM person_blocking_keys WHERE subject_table='unconfirmed_persons' AND subject_id=$1`,
        [leadRef.subject_id]).catch(() => {});
    }
    return { ref: { subject_table: 'canonical_persons', subject_id: canonicalId }, action, gate, candidates: res.candidates };
  }

  /** link(ref, externalId, idSystem, opts) — attach an external id to a CANONICAL person.
   *  (person_external_ids is canonical-only; leads can't carry external ids yet.) */
  async link(ref, externalId, idSystem, opts = {}) {
    if (!ref || ref.subject_table !== 'canonical_persons') return { ok: false, reason: 'link requires a canonical ref (person_external_ids is canonical-only)' };
    if (!externalId || !idSystem) return { ok: false, reason: 'externalId + idSystem required' };
    if (opts.dryRun) return { ok: true, action: 'would_link' };
    await this.db.query(
      `INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, external_url, confidence)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id_system, external_id) DO NOTHING`,
      [ref.subject_id, idSystem, externalId, opts.url || null, opts.confidence || 0.9]);
    return { ok: true, action: 'linked' };
  }

  /**
   * merge(survivorId, victimId, opts) — FK-safe merge of two canonical_persons (folded in from
   * scripts/merge-canonical-persons.mjs). Enrich survivor with victim's non-null fields, re-point
   * EVERY FK referencing canonical_persons from victim→survivor (row-walk + drop on unique
   * collision), mark victim person_type='merged' (kept, excluded from search), log to
   * person_merge_log. HAND-CONFIRMED only (never auto-called — Biscoe). opts.dryRun reports the
   * FK refs without writing.
   */
  async merge(survivorId, victimId, opts = {}) {
    survivorId = Number(survivorId); victimId = Number(victimId);
    if (!Number.isInteger(survivorId) || !Number.isInteger(victimId) || survivorId === victimId) return { ok: false, reason: 'need two distinct canonical ids' };
    const both = (await this.db.query('SELECT id FROM canonical_persons WHERE id IN ($1,$2)', [survivorId, victimId])).rows;
    if (both.length !== 2) return { ok: false, reason: 'one or both ids not in canonical_persons' };
    const fks = (await this.db.query(`
      SELECT tc.table_name, kcu.column_name FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'canonical_persons'`)).rows;
    const work = [];
    for (const fk of fks) { let n; try { n = Number((await this.db.query(`SELECT COUNT(*) c FROM ${fk.table_name} WHERE ${fk.column_name} = $1`, [victimId])).rows[0].c); } catch { continue; } if (n > 0) work.push({ ...fk, n }); }
    if (opts.dryRun) return { ok: true, action: 'would_merge', fkRefs: work.map(w => `${w.table_name}.${w.column_name}:${w.n}`) };

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        UPDATE canonical_persons sv SET
          primary_county = COALESCE(sv.primary_county, vc.primary_county),
          primary_state = COALESCE(sv.primary_state, vc.primary_state),
          birth_year_estimate = COALESCE(sv.birth_year_estimate, vc.birth_year_estimate),
          death_year_estimate = COALESCE(sv.death_year_estimate, vc.death_year_estimate),
          sex = COALESCE(sv.sex, vc.sex),
          notes = COALESCE(sv.notes,'') || ' [merged from #' || vc.id || ' "' || vc.canonical_name || '"]',
          updated_at = NOW()
        FROM canonical_persons vc WHERE sv.id = $1 AND vc.id = $2`, [survivorId, victimId]);
      for (const w of work) {
        try {
          await client.query(`UPDATE ${w.table_name} SET ${w.column_name} = $1 WHERE ${w.column_name} = $2`, [survivorId, victimId]);
        } catch (e) {
          if (!/unique constraint/i.test(e.message)) throw e;
          await client.query('SAVEPOINT s');
          const dups = await client.query(`SELECT ctid FROM ${w.table_name} WHERE ${w.column_name} = $1`, [victimId]);
          for (const d of dups.rows) {
            await client.query('SAVEPOINT r');
            try { await client.query(`UPDATE ${w.table_name} SET ${w.column_name} = $1 WHERE ctid = $2`, [survivorId, d.ctid]); await client.query('RELEASE SAVEPOINT r'); }
            catch { await client.query('ROLLBACK TO SAVEPOINT r'); await client.query(`DELETE FROM ${w.table_name} WHERE ctid = $1`, [d.ctid]); }
          }
          await client.query('RELEASE SAVEPOINT s');
        }
      }
      await client.query(`UPDATE canonical_persons SET person_type='merged', notes=COALESCE(notes,'') || ' [merged into #' || $1 || ']', updated_at=NOW() WHERE id=$2`, [survivorId, victimId]);
      await client.query(`INSERT INTO person_merge_log (surviving_person_id, merged_person_id, merge_reason, merged_by, merged_at) VALUES ($1,$2,$3,$4,NOW())`, [survivorId, victimId, opts.reason || 'PersonService.merge', opts.mergedBy || 'person_service']);
      await client.query('COMMIT');
      return { ok: true, action: 'merged', survivorId, victimId, fkRefs: work.length };
    } catch (e) { await client.query('ROLLBACK'); return { ok: false, reason: e.message }; }
    finally { client.release(); }
  }
}

// Export the proposition→document-type lists so the gate backfill (scripts/recompute-assertion-
// gates.mjs) and recomputeGate share ONE source of truth.
PersonService.DOC_PROP_SLAVEOWNER = DOC_PROP_SLAVEOWNER;
PersonService.DOC_PROP_ENSLAVED = DOC_PROP_ENSLAVED;

module.exports = PersonService;

// ---- CLI test (read-only): node src/services/PersonService.js --name "Mary" --sex f --birth 1812 ----
if (require.main === module) {
  const path = require('path');
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const { Pool } = require('pg');
  const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const svc = new PersonService(pool);
  (async () => {
    const q = { name: arg('--name'), sex: arg('--sex'), birthYear: arg('--birth') ? +arg('--birth') : null, location: arg('--loc'), externalId: arg('--extid'), idSystem: arg('--idsys') };
    console.log('query:', JSON.stringify(q));
    const r = await svc.resolve(q);
    console.log('keys:', await svc._queryKeys(q));
    console.log('MATCH:', r.match ? JSON.stringify(r.match) : '(none — name-only or no corroborator)');
    console.log('CANDIDATES (top):');
    r.candidates.slice(0, 6).forEach(c => console.log(`  [${c.kind}/${c.subject_table}#${c.subject_id}] ${c.name} b.${c.birth_year || '?'} conf=${c.confidence.toFixed(2)} {${c.signals.join(',')}}`));
    await pool.end();
  })();
}
