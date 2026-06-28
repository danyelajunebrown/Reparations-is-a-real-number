#!/usr/bin/env node
/**
 * PRODUCER (de-siloing #1 follow-on): materialize enslaved→owner edges into the now-lead-aware
 * enslaved_owner_relationships (M103/M104), so #3 (reverse descendant→enslaved-ancestor traversal)
 * has real ownership edges to traverse and #1 becomes useful.
 *
 * Sources (both keep the ENSLAVED person as a LEAD — nothing is promoted to canonical here):
 *   1. unconfirmed_persons.relationships  enslaved_by entries (name OR related_to owner name)
 *   2. slavevoyages_past_people.raw->enslavers  — ROLE-FILTERED to ownership only
 *      (Owner/Buyer/Seller). Captain/Shipper/Investor/Consignor are trade-chain roles, NOT
 *      ownership, and are EXCLUDED (a ship captain is not the owner).
 *
 * Owner resolution (name-only — these owner mentions carry no birth/location corroborator):
 *   reuse an existing owner LEAD with the exact normalized name, else create one via
 *   PersonService.findOrCreateLead (lead + blocking keys; NEVER a canonical). Distinct same-name
 *   owners conflating + linking owner leads to existing enslaver canonicals are DEFERRED to the
 *   identity-resolution layer (these leads are in the blocking pool, so it can split/merge them).
 *   This respects the Biscoe rule: name-only never mints a canonical; it only clusters leads.
 *
 *   node scripts/build-enslaved-owner-edges.mjs                 # dry-run (measure)
 *   node scripts/build-enslaved-owner-edges.mjs --apply         # write edges
 *   node scripts/build-enslaved-owner-edges.mjs --source past --apply --limit 1000
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const APPLY = process.argv.includes('--apply');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const SOURCE = arg('--source', 'all');           // unconfirmed | past | all
const LIMIT = arg('--limit') ? parseInt(arg('--limit'), 10) : null;
const norm = (s) => (s == null ? '' : String(s)).toLowerCase().replace(/[^a-z0-9]/g, '');
const OWNERSHIP_ROLE = /owner|buyer|seller/i;     // PAST roles that ARE the enslaved_by proposition

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ps = new PersonService(pool);

const stats = { statements: 0, edges: 0, ownersLinked: 0, ownersCreated: 0, skippedNoOwner: 0, dupEdges: 0 };
const ownerCache = new Map();

/** Preload ALL owner-type leads (normalized name → ref) ONCE, so owner resolution is an O(1)
 *  memory lookup instead of a per-owner unindexed seq-scan over 2.4M unconfirmed_persons (which
 *  made the first runs grind). New owners created during the run are added to the same cache. */
async function preloadOwners() {
  const res = await pool.query(
    `SELECT lead_id, lower(regexp_replace(full_name,'[^a-zA-Z0-9]','','g')) AS k
     FROM unconfirmed_persons WHERE person_type IN ('owner','suspected_owner','enslaver')`);
  for (const r of res.rows) if (r.k && !ownerCache.has(r.k)) ownerCache.set(r.k, { subject_table: 'unconfirmed_persons', subject_id: r.lead_id });
  console.log(`preloaded ${ownerCache.size.toLocaleString()} owner-name → lead refs`);
}

/** Resolve an owner name → a subject ref (cache/preload reuse, else create a name-only lead). */
async function getOwnerRef(name, sourceUrl) {
  const key = norm(name);
  if (!key) return null;
  if (ownerCache.has(key)) { stats.ownersLinked++; return ownerCache.get(key); }
  const r = await ps.findOrCreateLead({ name, personType: 'suspected_owner', sourceType: 'secondary', sourceUrl, context: 'owner inferred from an enslaved→owner statement (name-only; pending identity resolution)' });
  ownerCache.set(key, r.ref);
  if (r.action === 'created') stats.ownersCreated++; else stats.ownersLinked++;
  return r.ref;
}

async function writeEdge(enslavedRef, enslavedName, ownerRef, ownerName, relSource, sourceUrl, conf) {
  const r = await pool.query(
    `INSERT INTO enslaved_owner_relationships
       (enslaved_subject_table, enslaved_subject_id, enslaved_name,
        owner_subject_table, owner_subject_id, owner_name,
        relationship_type, relationship_source, source_url, confidence_score, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'enslaved_by',$7,$8,$9,'edge_producer')
     ON CONFLICT (enslaved_subject_table, enslaved_subject_id, owner_subject_table, owner_subject_id, relationship_type)
       WHERE enslaved_subject_id IS NOT NULL AND owner_subject_id IS NOT NULL
     DO NOTHING RETURNING id`,
    [enslavedRef.subject_table, enslavedRef.subject_id, enslavedName,
     ownerRef.subject_table, ownerRef.subject_id, ownerName, relSource, sourceUrl || null, conf || 0.7]);
  if (r.rows.length) stats.edges++; else stats.dupEdges++;
}

async function runUnconfirmed() {
  const rows = (await pool.query(
    `SELECT lead_id, full_name, source_url, relationships FROM unconfirmed_persons
     WHERE jsonb_typeof(relationships)='array' AND relationships @> '[{"type":"enslaved_by"}]'
     ${LIMIT ? 'LIMIT ' + LIMIT : ''}`)).rows;
  console.log(`[unconfirmed] ${rows.length.toLocaleString()} rows with an enslaved_by relationship`);
  for (const u of rows) {
    for (const e of u.relationships) {
      if (!e || e.type !== 'enslaved_by') continue;
      const ownerName = (e.name || e.related_to || '').trim();
      if (!ownerName) { stats.skippedNoOwner++; continue; }
      stats.statements++;
      if (!APPLY) continue;
      const ownerRef = await getOwnerRef(ownerName, u.source_url);
      if (!ownerRef) { stats.skippedNoOwner++; continue; }
      await writeEdge({ subject_table: 'unconfirmed_persons', subject_id: u.lead_id }, u.full_name || '(unknown)', ownerRef, ownerName, 'contribution_scrape', u.source_url, 0.75);
    }
  }
}

async function runPast() {
  const PAST_URL = 'https://www.slavevoyages.org/past/database';
  const rows = (await pool.query(
    `SELECT sv_id, name, raw->'enslavers' AS enslavers FROM slavevoyages_past_people
     WHERE jsonb_typeof(raw->'enslavers')='array' AND jsonb_array_length(raw->'enslavers')>0
     ${LIMIT ? 'LIMIT ' + LIMIT : ''}`)).rows;
  console.log(`[past] ${rows.length.toLocaleString()} records with enslavers[] (role-filtering to Owner/Buyer/Seller)`);
  for (const p of rows) {
    for (const en of p.enslavers) {
      const nr = en && en.name_and_role; if (!nr) continue;
      const m = String(nr).match(/\(([^)]+)\)\s*$/);
      const role = m ? m[1] : '';
      if (!OWNERSHIP_ROLE.test(role)) continue;       // exclude captain/shipper/investor/consignor
      const ownerName = String(nr).replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (!ownerName) { stats.skippedNoOwner++; continue; }
      stats.statements++;
      if (!APPLY) continue;
      const ownerRef = await getOwnerRef(ownerName, PAST_URL);
      if (!ownerRef) { stats.skippedNoOwner++; continue; }
      await writeEdge({ subject_table: 'slavevoyages_past_people', subject_id: p.sv_id }, p.name || '(unknown)', ownerRef, ownerName, 'slavevoyages_past', PAST_URL, 0.70);
    }
  }
}

(async () => {
  try {
    console.log(`=== build-enslaved-owner-edges ${APPLY ? '(APPLY)' : '(DRY-RUN)'} source=${SOURCE}${LIMIT ? ' limit=' + LIMIT : ''} ===`);
    if (APPLY) await preloadOwners();
    if (SOURCE === 'unconfirmed' || SOURCE === 'all') await runUnconfirmed();
    if (SOURCE === 'past' || SOURCE === 'all') await runPast();
    console.log('\n=== result ===');
    console.log('ownership statements found:', stats.statements.toLocaleString());
    if (APPLY) {
      console.log('edges written:', stats.edges.toLocaleString(), '| already-present (skipped):', stats.dupEdges.toLocaleString());
      console.log('owner leads created:', stats.ownersCreated.toLocaleString(), '| owner refs reused:', stats.ownersLinked.toLocaleString());
    } else {
      console.log('(dry-run — nothing written. Re-run with --apply.)');
    }
    console.log('skipped (no owner name):', stats.skippedNoOwner.toLocaleString());
  } catch (e) {
    console.error('ERROR:', e.message); process.exitCode = 1;
  } finally { await pool.end(); }
})();
