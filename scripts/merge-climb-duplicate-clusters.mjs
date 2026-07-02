#!/usr/bin/env node
/**
 * Collapse ancestor-climber DUPLICATE canonical clusters (issue #92 climb contamination) — the
 * "Jennie Goodwin ×6" pattern where climb re-runs re-imported ONE FamilySearch person as many rows.
 * This kills the dedup-queue pairwise explosion (N dupes → N-choose-2 cards) at the SOURCE.
 *
 * SAFE criterion (Biscoe-respecting — provably one person, not a same-name guess):
 *   person_type='descendant' AND created_by LIKE 'ancestor_climber%'
 *   AND identical (canonical_name, birth_year_estimate, death_year_estimate)
 *   AND real name (NOT '?'/unknown/unresolved/unnamed/none)
 *   AND EXACTLY ONE distinct familysearch external_id across the cluster (the definitive anchor).
 * → survivor = the FS-id-bearing member; the no-id re-imports fold into it via PersonService.merge
 * (FK-safe, marks victim person_type='merged', logs person_merge_log — reversible).
 *
 * EXCLUDED (left for human review, never auto-merged): placeholder-name clusters, clusters with >1
 * distinct FS id (= distinct people), and clusters with ZERO FS id (no anchor to confirm sameness).
 *
 *   node scripts/merge-climb-duplicate-clusters.mjs            # dry-run
 *   node scripts/merge-climb-duplicate-clusters.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
import PersonService from '../src/services/PersonService.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const svc = new PersonService(pool);

(async () => {
  try {
    // clusters with exactly one distinct FS id + real name
    const clusters = (await pool.query(`
      SELECT canonical_name, birth_year_estimate b, death_year_estimate d,
             array_agg(cp.id ORDER BY cp.id) ids,
             (array_agg(cp.id) FILTER (WHERE e.external_id IS NOT NULL))[1] fs_survivor
      FROM canonical_persons cp
      LEFT JOIN person_external_ids e ON e.canonical_person_id=cp.id AND e.id_system='familysearch'
      WHERE cp.person_type='descendant' AND cp.created_by LIKE 'ancestor_climber%'
        AND cp.canonical_name IS NOT NULL AND length(trim(cp.canonical_name))>2
        AND cp.canonical_name !~* '^\\s*(\\?|unknown|unnamed|unresolved|no name|none)'
        AND cp.canonical_name NOT LIKE '%unresolved%' AND cp.canonical_name NOT LIKE '%unknown%'
      GROUP BY 1,2,3
      HAVING count(*)>1 AND count(DISTINCT e.external_id)=1`)).rows;
    console.log(`=== merge-climb-duplicate-clusters ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    let dupes = 0; for (const c of clusters) dupes += c.ids.length - 1;
    console.log(`anchored safe clusters (1 FS id, real name): ${clusters.length.toLocaleString()} → ${dupes.toLocaleString()} dupes to fold`);
    clusters.slice(0, 6).forEach(c => console.log(`  "${c.canonical_name}" b.${c.b || '?'} — ${c.ids.length} rows → survivor #${c.fs_survivor}`));
    if (!APPLY) { console.log('\n(dry-run) re-run with --apply. Uses PersonService.merge (FK-safe, reversible).'); return; }

    let merged = 0, failed = 0;
    for (const c of clusters) {
      const survivor = c.fs_survivor;
      for (const victim of c.ids) {
        if (victim === survivor) continue;
        const r = await svc.merge(survivor, victim, { reason: '#92 climb re-import duplicate (auto-cluster)', mergedBy: 'merge-climb-clusters' });
        if (r.ok) merged++; else { failed++; if (failed <= 5) console.log(`  merge ${survivor}<-${victim} failed: ${r.reason}`); }
      }
    }
    console.log(`\nmerged ${merged} duplicate rows into their FS-anchored survivors (${failed} failed).`);
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
