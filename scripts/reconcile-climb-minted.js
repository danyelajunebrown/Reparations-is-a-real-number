#!/usr/bin/env node
/**
 * reconcile-climb-minted.js
 *
 * De-silos the canonical_persons that the climb name-resolver minted OUTSIDE the
 * shared identity layer (created_by='climb_name_resolver', 0 blocking keys).
 *
 *   Pass 1 — backfill person_blocking_keys for every one (additive, idempotent)
 *            via PersonService._writeBlockingKeys → they become visible to
 *            find_person_match / resolve() / every other producer.
 *   Pass 2 — run PersonService.resolve() on each (name+birthYear+location, the
 *            Biscoe-safe bar: name_exact + corroborator + unambiguous) to DETECT
 *            duplicates against the now-populated pool. Writes a candidate report
 *            to worksheets/dedup-candidates.json. Does NOT merge (no vetted merge
 *            primitive yet — that's the identity session's gated step 4).
 *
 * Usage: node scripts/reconcile-climb-minted.js [--limit N]
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const PersonService = require('../src/services/PersonService');

const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? parseInt(process.argv[i + 1], 10) : 0; })();

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const svc = new PersonService(pool);

  // The climb-minted canonical persons + their FS id + location.
  const { rows: people } = await pool.query(`
    SELECT cp.id, cp.canonical_name AS name, cp.birth_year_estimate AS birth_year,
           cp.primary_state, cp.primary_county, cp.person_type,
           pei.external_id AS fs_id
    FROM canonical_persons cp
    LEFT JOIN person_external_ids pei
      ON pei.canonical_person_id = cp.id AND pei.id_system = 'familysearch'
    WHERE cp.created_by = 'climb_name_resolver'
    ORDER BY cp.id ${LIMIT ? 'LIMIT ' + LIMIT : ''}`);
  console.log(`climb-minted canonical_persons: ${people.length}`);

  const locOf = (p) => [p.primary_county, p.primary_state].filter(Boolean).join(', ') || null;

  // ---- Pass 1: backfill blocking keys ----
  let keyed = 0, keysWritten = 0;
  for (const p of people) {
    if (!p.name) continue;
    const n = await svc._writeBlockingKeys('canonical_persons', p.id, { name: p.name, sex: null, birthYear: p.birth_year });
    if (n > 0) keyed++;
    keysWritten += n;
  }
  console.log(`Pass 1 — blocking keys: ${keyed}/${people.length} persons now keyed (+${keysWritten} key rows)`);

  // ---- Pass 2: dedup detection (no externalId → find OTHER identities) ----
  const dupes = [];
  let ambiguous = 0, clean = 0, checked = 0;
  for (const p of people) {
    if (!p.name) continue;
    checked++;
    let r;
    try {
      r = await svc.resolve({ name: p.name, birthYear: p.birth_year, location: locOf(p), personType: p.person_type });
    } catch (e) { continue; }
    if (r.match && !(r.match.subject_table === 'canonical_persons' && r.match.subject_id === p.id)) {
      dupes.push({ climb_id: p.id, name: p.name, birth_year: p.birth_year, location: locOf(p), fs_id: p.fs_id,
        match_table: r.match.subject_table, match_id: r.match.subject_id, match_name: r.match.name,
        confidence: r.match.confidence, signals: r.match.signals });
    } else if (r.ambiguous) { ambiguous++; }
    else { clean++; }
    if (checked % 200 === 0) console.log(`  …resolved ${checked}/${people.length} (dupes=${dupes.length}, ambiguous=${ambiguous})`);
  }

  fs.writeFileSync('worksheets/dedup-candidates.json', JSON.stringify(dupes, null, 2));
  console.log(`\nPass 2 — dedup detection (Biscoe-safe: name+corroborator+unambiguous):`);
  console.log(`  duplicate candidates (strong match to a DIFFERENT identity): ${dupes.length}`);
  console.log(`  ambiguous (common-name collision, needs review): ${ambiguous}`);
  console.log(`  clean (no other identity): ${clean}`);
  console.log(`  → candidates written to worksheets/dedup-candidates.json`);
  if (dupes.length) {
    console.log('\n  sample duplicate candidates:');
    for (const d of dupes.slice(0, 12))
      console.log(`   climb#${d.climb_id} ${d.name} (b.${d.birth_year || '?'}, ${d.location || '?'}) → ${d.match_table}#${d.match_id} "${d.match_name}" [${(d.confidence||0).toFixed(2)} ${(d.signals||[]).join('+')}]`);
  }
  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
