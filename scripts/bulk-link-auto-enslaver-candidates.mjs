#!/usr/bin/env node
/**
 * Bulk-apply the `auto_link_candidate` tier of cross_source_candidates (entity_kind='enslaver').
 *
 * The cross-source resolver already SEPARATED unambiguous single-matches (route='auto_link_candidate':
 * score≥6, exact/near-exact name + same state + same county, and NOT a multi-match) from the genuinely
 * ambiguous 'review' tier. Making a human click "Link" on thousands of identical-name+same-county
 * single-matches (mostly the same 1860-schedule owner recorded once per enslaved person) is waste — the
 * tier is named auto-link because it is meant to be auto-applied. Biscoe still holds: NAME-ONLY and
 * MULTI-MATCH cases were routed to 'review', not here, and remain for human eyes.
 *
 * Does exactly what POST /api/review/cross_source_enslavers/:id/link does, set-based:
 *   - link the lead   → unconfirmed_persons.confirmed_individual_id = canonical id, status='confirmed'
 *   - mark candidate  → cross_source_candidates.status='linked'
 *
 *   node scripts/bulk-link-auto-enslaver-candidates.mjs            # dry-run (count + sample)
 *   node scripts/bulk-link-auto-enslaver-candidates.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const WHERE = `entity_kind='enslaver' AND route='auto_link_candidate' AND status='pending'`;

(async () => {
  const client = await pool.connect();
  try {
    const n = (await client.query(`SELECT count(*) c FROM cross_source_candidates WHERE ${WHERE}`)).rows[0].c;
    const rev = (await client.query(`SELECT count(*) c FROM cross_source_candidates WHERE entity_kind='enslaver' AND route='review' AND status='pending'`)).rows[0].c;
    console.log(`=== bulk-link auto enslaver candidates ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    console.log(`auto_link_candidate pending: ${(+n).toLocaleString()}  |  'review' pending (stays for humans): ${(+rev).toLocaleString()}`);
    const sample = (await client.query(
      `SELECT unconfirmed_name, canonical_name, location, score FROM cross_source_candidates WHERE ${WHERE} ORDER BY score DESC LIMIT 6`)).rows;
    console.log('sample:'); sample.forEach(r => console.log(`  ${r.score}  "${r.unconfirmed_name}" -> "${r.canonical_name}"  (${r.location || '?'})`));

    if (!APPLY) { console.log(`\n(dry-run) re-run with --apply to link ${(+n).toLocaleString()} leads → canonicals.`); return; }

    await client.query('BEGIN');
    const linked = (await client.query(
      `UPDATE unconfirmed_persons u
         SET confirmed_individual_id = x.canonical_person_id::text, status='confirmed',
             reviewed_by='bulk_auto_link', reviewed_at=NOW(),
             review_notes = COALESCE(u.review_notes,'') || ' | bulk-linked to cp=' || x.canonical_person_id || ' (auto_link_candidate)'
        FROM cross_source_candidates x
        WHERE x.${'entity_kind'}='enslaver' AND x.route='auto_link_candidate' AND x.status='pending'
          AND u.lead_id = x.unconfirmed_lead_id
        RETURNING u.lead_id`)).rowCount;
    const marked = (await client.query(
      `UPDATE cross_source_candidates SET status='linked', reviewed_by='bulk_auto_link', reviewed_at=NOW() WHERE ${WHERE}`)).rowCount;
    await client.query('COMMIT');
    console.log(`\nLINKED ${linked} leads; marked ${marked} candidates 'linked'. The 'review' tier is untouched.`);
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
