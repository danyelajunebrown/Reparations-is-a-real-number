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
    return keys;
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
        ? `lead_id::text AS sid, name, NULL::int AS birth_year, NULL AS state, NULL AS sex, person_type`
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

    // Gather candidate subjects from the unified blocking pool + find_person_match name tiers
    const keys = await this._queryKeys(query);
    let refs = [];
    if (keys.length) {
      refs = (await this.db.query(
        `SELECT DISTINCT subject_table, subject_id FROM person_blocking_keys WHERE key_value = ANY($1::text[]) LIMIT 400`, [keys])).rows;
    }
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
}

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
