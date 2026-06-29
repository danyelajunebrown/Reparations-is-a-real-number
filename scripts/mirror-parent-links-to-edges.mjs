#!/usr/bin/env node
/**
 * ① (climb reconciliation): mirror inferred_parent_links → canonical_family_edges so the lead-aware
 * kinship layer (M103) — and #3's reverse traversal / lineage queries — can SEE the parent edges the
 * climb scraper produced. The climb session wrote child→parent only to inferred_parent_links
 * (keyed by FamilySearch id / name), which the relationship layer can't traverse.
 *
 * Resolution: FS-id-based (clean) via person_external_ids(familysearch). Only links whose BOTH
 * endpoints resolve to a canonical person are mirrored — high-precision, no fuzzy name guessing
 * (name-only links are left for the identity-resolution layer; Biscoe). Writes one `child_of` edge
 * per link (a=child, b=parent). Idempotent via the legacy (person_a_id,person_b_id,relationship_type)
 * unique; the M103 trigger fills the polymorphic subject columns.
 *
 *   node scripts/mirror-parent-links-to-edges.mjs            # dry-run (measure)
 *   node scripts/mirror-parent-links-to-edges.mjs --apply
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    // Preload familysearch external_id → canonical_person_id (one scan, O(1) lookups).
    const fsMap = new Map();
    for (const r of (await pool.query(
      `SELECT external_id, canonical_person_id FROM person_external_ids WHERE id_system = 'familysearch' AND canonical_person_id IS NOT NULL`)).rows) {
      if (!fsMap.has(r.external_id)) fsMap.set(r.external_id, r.canonical_person_id);
    }
    console.log(`preloaded ${fsMap.size.toLocaleString()} familysearch→canonical ids`);

    const links = (await pool.query(
      `SELECT child_fs_id, parent_fs_id, child_name, parent_name, relationship, source_url, confidence
       FROM inferred_parent_links WHERE child_fs_id IS NOT NULL AND parent_fs_id IS NOT NULL`)).rows;

    const stats = { links: links.length, resolved: 0, written: 0, dup: 0, selfLoop: 0, unresolved: 0 };
    console.log(`=== mirror-parent-links-to-edges ${APPLY ? '(APPLY)' : '(DRY-RUN)'} === ${links.length.toLocaleString()} both-fsid links`);

    for (const l of links) {
      const child = fsMap.get(l.child_fs_id);
      const parent = fsMap.get(l.parent_fs_id);
      if (!child || !parent) { stats.unresolved++; continue; }
      if (child === parent) { stats.selfLoop++; continue; }   // FS self-referential parent row noise
      stats.resolved++;
      if (!APPLY) continue;
      // a = child, b = parent, relationship_type = 'child_of' (child IS child_of parent).
      const r = await pool.query(
        `INSERT INTO canonical_family_edges (person_a_id, person_b_id, relationship_type, source_url, evidence_tier, confidence, notes)
         VALUES ($1, $2, 'child_of', $3, 3, $4, 'mirrored from inferred_parent_links (climb parent scrape)')
         ON CONFLICT (person_a_id, person_b_id, relationship_type) DO NOTHING RETURNING id`,
        [child, parent, l.source_url || null, l.confidence || 0.6]);
      if (r.rows.length) stats.written++; else stats.dup++;
    }

    console.log('\n=== result ===');
    console.log('both-fsid links:', stats.links.toLocaleString());
    console.log('both endpoints resolve to canonical:', stats.resolved.toLocaleString());
    console.log('self-loop (skipped):', stats.selfLoop.toLocaleString(), '| unresolved fs_id:', stats.unresolved.toLocaleString());
    if (APPLY) console.log('edges written:', stats.written.toLocaleString(), '| already-present:', stats.dup.toLocaleString());
    else console.log('(dry-run — re-run with --apply)');
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
