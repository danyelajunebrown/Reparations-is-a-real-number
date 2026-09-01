#!/usr/bin/env node
/**
 * report-census-dedup-candidates.mjs — READ-ONLY consolidation view for the 1714/1755 census leads.
 *
 * The census ingest created 441 discrete leads; resolve() (Biscoe-conservative) auto-linked none —
 * birth-year-less colonial names can't be safely auto-merged. This surfaces the dedup CANDIDATES for
 * human review: where a census enslaver lead shares blocking keys with (a) an existing canonical/lead
 * — the "repair the junk Hoffman/Ten Broeck rows" opportunity — or (b) another census lead
 * (cross-source recurrence, e.g. the same family in 1714 AND 1755). NO merges, NO writes — a worksheet
 * a human resolves. This is the entity-resolution groundwork the Dutchess DAA and any calibration
 * study both need.
 *
 *   node scripts/report-census-dedup-candidates.mjs            # summary
 *   node scripts/report-census-dedup-candidates.mjs --jsonl    # + worksheets/census-dedup-candidates.jsonl
 */
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const WRITE = process.argv.includes('--jsonl');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const q = async (sql, p = []) => (await pool.query(sql, p)).rows;

(async () => {
  // Census enslaver leads (the ones worth consolidating; enslaved leads are Biscoe-sensitive first names).
  const leads = await q(`
    SELECT u.lead_id, u.full_name, u.person_type, e.id_system
    FROM unconfirmed_persons u
    JOIN person_external_ids e ON e.subject_id = u.lead_id AND e.subject_table='unconfirmed_persons'
    WHERE e.id_system LIKE 'ny_census%' AND u.person_type='enslaver'`);
  console.log(`census enslaver leads: ${leads.length}`);

  // For each, other subjects sharing >=2 blocking keys (strong candidate), split by target class.
  const rows = await q(`
    WITH census AS (
      SELECT u.lead_id
      FROM unconfirmed_persons u
      JOIN person_external_ids e ON e.subject_id=u.lead_id AND e.subject_table='unconfirmed_persons'
      WHERE e.id_system LIKE 'ny_census%' AND u.person_type='enslaver'
    ),
    ck AS (
      SELECT c.lead_id, k.key_type, k.key_value
      FROM census c
      JOIN person_blocking_keys k ON k.subject_table='unconfirmed_persons' AND k.subject_id=c.lead_id
    )
    SELECT ck.lead_id,
           k2.subject_table AS cand_table, k2.subject_id AS cand_id,
           count(*) AS shared_keys
    FROM ck
    JOIN person_blocking_keys k2 ON k2.key_type = ck.key_type AND k2.key_value = ck.key_value
      AND NOT (k2.subject_table='unconfirmed_persons' AND k2.subject_id=ck.lead_id)
    GROUP BY 1,2,3
    HAVING count(*) >= 2
    ORDER BY ck.lead_id, shared_keys DESC`);

  // Resolve candidate names + partition into existing-DB vs another-census-lead.
  const byLead = new Map();
  for (const r of rows) {
    if (!byLead.has(r.lead_id)) byLead.set(r.lead_id, []);
    byLead.get(r.lead_id).push(r);
  }
  const nameOf = async (t, id) => {
    const col = t === 'canonical_persons' ? 'canonical_name' : 'full_name';
    const idc = t === 'canonical_persons' ? 'id' : 'lead_id';
    const r = await q(`SELECT ${col} n FROM ${t} WHERE ${idc}=$1`, [id]);
    return r[0]?.n || '(?)';
  };
  const censusLeadIds = new Set(leads.map(l => l.lead_id));

  let withAnyCand = 0, withExistingCanonical = 0, withCrossCensus = 0;
  const out = [];
  for (const l of leads) {
    const cands = byLead.get(l.lead_id) || [];
    if (!cands.length) continue;
    withAnyCand++;
    const enriched = [];
    let hitCanonical = false, hitCross = false;
    for (const c of cands.slice(0, 8)) {
      const nm = await nameOf(c.cand_table, c.cand_id);
      const kind = c.cand_table === 'canonical_persons' ? 'canonical'
        : (censusLeadIds.has(c.cand_id) ? 'census_lead' : 'other_lead');
      if (kind === 'canonical') hitCanonical = true;
      if (kind === 'census_lead') hitCross = true;
      enriched.push({ kind, name: nm, table: c.cand_table, id: c.cand_id, shared_keys: +c.shared_keys });
    }
    if (hitCanonical) withExistingCanonical++;
    if (hitCross) withCrossCensus++;
    out.push({ lead_id: l.lead_id, name: l.full_name, id_system: l.id_system, candidates: enriched });
  }

  console.log(`\n=== CONSOLIDATION CANDIDATES (read-only, Biscoe: review not auto-merge) ===`);
  console.log(`enslaver leads with >=1 strong candidate (>=2 shared keys): ${withAnyCand}/${leads.length}`);
  console.log(`  ...matching an existing CANONICAL (repair-the-junk opportunity): ${withExistingCanonical}`);
  console.log(`  ...matching another CENSUS lead (cross-source 1714<->1755 recurrence): ${withCrossCensus}`);

  console.log(`\n--- sample clusters (census lead → candidates) ---`);
  for (const o of out.filter(o => o.candidates.some(c => c.kind === 'canonical')).slice(0, 12)) {
    console.log(`  [${o.id_system.replace('ny_census_', '')}] ${o.name} #${o.lead_id}`);
    for (const c of o.candidates.filter(c => c.kind === 'canonical').slice(0, 3))
      console.log(`      ~ ${c.kind}: "${c.name}" (${c.table}#${c.id}, ${c.shared_keys} keys)`);
  }

  if (WRITE) {
    const dir = path.resolve(__dirname, '../worksheets'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'census-dedup-candidates.jsonl');
    fs.writeFileSync(f, out.map(o => JSON.stringify(o)).join('\n') + '\n');
    console.log(`\nwrote ${out.length} clusters → ${f} (human review before any merge)`);
  }
  await pool.end();
})().catch(e => { console.error('REPORT_ERROR', e.message); process.exit(1); });
