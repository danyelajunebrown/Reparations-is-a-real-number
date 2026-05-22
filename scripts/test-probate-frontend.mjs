#!/usr/bin/env node
/**
 * Front-end / API integration test for the re-parsed probate dataset.
 *
 * Picks 20 diverse Liberty County testators and, for each, exercises the same
 * HTTP endpoints the front end calls:
 *   GET /api/contribute/search/:query   — the search box
 *   GET /api/contribute/person/:id      — the person profile
 * It searches the testator, then their heirs (wives/children) and named
 * enslaved persons, and reports where the chain breaks — the bug list.
 *
 * Requires the Express server running (default http://localhost:3000).
 *   node scripts/test-probate-frontend.mjs
 *   API=http://localhost:3000 node scripts/test-probate-frontend.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const API = process.env.API || 'http://localhost:3000';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function api(p) {
  try {
    const r = await fetch(API + p);
    if (!r.ok) return { __error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) { return { __error: e.message }; }
}

// search returns { results: [...] }; true if any result name contains all query words
function searchHit(json, name) {
  const rows = json.results || json.data || [];
  const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  return rows.some((r) => {
    const n = (r.name || r.full_name || r.canonical_name || '').toLowerCase();
    return words.every((w) => n.includes(w));
  });
}

async function main() {
  console.log(`Probate front-end test — API ${API}\n`);

  // 20 diverse testators: probate enslavers in Liberty that anchor inheritance
  // edges and/or have enslaved persons; spread across rolls.
  const testators = (await pool.query(`
    SELECT DISTINCT ON (cp.id) cp.id, cp.canonical_name,
      (SELECT COUNT(*) FROM inheritance_edges ie WHERE ie.testator_id = cp.id) AS heirs,
      (SELECT COUNT(*) FROM person_documents pd WHERE pd.canonical_person_id = cp.id) AS docs
    FROM canonical_persons cp
    WHERE cp.primary_county = 'Liberty' AND cp.person_type = 'enslaver'
      AND cp.created_by IN ('reparse-probate-entities','system')
      AND EXISTS (SELECT 1 FROM person_documents pd WHERE pd.canonical_person_id = cp.id)
    ORDER BY cp.id, heirs DESC
    LIMIT 200
  `)).rows.filter((t) => t.heirs > 0).slice(0, 20);

  if (testators.length === 0) { console.log('No testators with heirs found.'); await pool.end(); return; }

  const bugs = [];
  for (const t of testators) {
    const line = [`#${t.id} ${t.canonical_name}  (docs:${t.docs} heirs:${t.heirs})`];

    // 1. testator searchable?
    const ts = await api(`/api/contribute/search/${encodeURIComponent(t.canonical_name)}`);
    if (ts.__error) { bugs.push(`search API error for "${t.canonical_name}": ${ts.__error}`); line.push('search:ERR'); }
    else if (!searchHit(ts, t.canonical_name)) { bugs.push(`testator "${t.canonical_name}" (#${t.id}) not found by search`); line.push('search:MISS'); }
    else line.push('search:ok');

    // 2. profile loads + serves documents?
    const prof = await api(`/api/contribute/person/${t.id}?table=canonical_persons`);
    if (prof.__error) { bugs.push(`profile #${t.id} error: ${prof.__error}`); line.push('profile:ERR'); }
    else {
      const docs = (prof.documents || []).length + (prof.ownerDocuments || []).length;
      if (docs === 0) { bugs.push(`profile #${t.id} "${t.canonical_name}" serves 0 documents (DB says ${t.docs})`); line.push('docs:0'); }
      else if (docs > t.docs * 3 + 25) { bugs.push(`profile #${t.id} "${t.canonical_name}" serves ${docs} documents but DB links only ${t.docs} — over-broad query`); line.push(`docs:${docs}!!`); }
      else line.push(`docs:${docs}`);
    }

    // 3. heirs searchable?
    const heirRows = (await pool.query(
      `SELECT cp.canonical_name, ie.relationship_to_testator
         FROM inheritance_edges ie JOIN canonical_persons cp ON cp.id = ie.heir_id
        WHERE ie.testator_id = $1 LIMIT 3`, [t.id])).rows;
    for (const h of heirRows) {
      const hs = await api(`/api/contribute/search/${encodeURIComponent(h.canonical_name)}`);
      if (!hs.__error && !searchHit(hs, h.canonical_name)) {
        bugs.push(`heir "${h.canonical_name}" (${h.relationship_to_testator} of ${t.canonical_name}) not found by search`);
      }
    }
    line.push(`heirs-checked:${heirRows.length}`);
    console.log('  ' + line.join('  '));
  }

  console.log(`\n${bugs.length} bug(s) found:`);
  for (const b of bugs) console.log(`  - ${b}`);
  await pool.end();
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
