#!/usr/bin/env node
/**
 * Issue #99 — sweep place-word / legal-boilerplate entities out of the enslaver class.
 *
 * Testator extraction minted place-words and boilerplate as person_type='enslaver' (Albany, New York,
 * Cayuga, Sole [from "sole executor"], Deceased, Estate, Executor, Administrator, Widow, "Image" [the
 * placeholder testator]). They are not people. A high-precision EXACT-match blocklist (only names that
 * ARE the junk word — never a substring, so "Sole Freeman" is safe) reclassifies them to
 * person_type='unknown' and clears both assertable flags, with a reversible note. "Image"-named rows
 * are real slave-schedule owners whose NAME extraction failed (see #70) — reclassified too, since
 * "Image" is not a usable identity; the underlying doc stays linked for re-extraction.
 *
 * Forward fix (apply the name_suspect heuristic at MINT so new junk never enters) is a separate change
 * in the probate testator-mint path.
 *
 *   node scripts/flag-junk-enslaver-entities.mjs            # dry-run
 *   node scripts/flag-junk-enslaver-entities.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JUNK = ['albany', 'new york', 'cayuga', 'brooklyn', 'kings', 'queens', 'buffalo', 'rochester',
  'sole', 'deceased', 'late', 'estate', 'the estate', 'executor', 'executrix', 'administrator',
  'administratrix', 'none', 'unknown', 'testator', 'said', 'ditto', 'image', 'witness', 'widow', 'heirs'];

(async () => {
  try {
    const cond = `person_type='enslaver' AND lower(trim(canonical_name)) = ANY($1)`;
    const before = (await pool.query(`SELECT count(*) c, count(*) FILTER (WHERE assertable_slaveowner OR assertable_enslaved) a FROM canonical_persons WHERE ${cond}`, [JUNK])).rows[0];
    console.log(`=== flag junk enslaver entities ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    console.log(`junk-named enslaver canonicals: ${(+before.c).toLocaleString()} (${(+before.a).toLocaleString()} currently assertable)`);
    const sample = (await pool.query(`SELECT canonical_name, count(*) c FROM canonical_persons WHERE ${cond} GROUP BY 1 ORDER BY 2 DESC`, [JUNK])).rows;
    console.log('  ' + sample.map(r => `${r.canonical_name}×${r.c}`).join(', '));
    if (!APPLY) { console.log('\n(dry-run) re-run with --apply.'); return; }
    const r = await pool.query(
      `UPDATE canonical_persons SET person_type='unknown', assertable_slaveowner=false, assertable_enslaved=false,
         notes = COALESCE(notes,'') || ' | #99 reclassified enslaver->unknown: place-word/boilerplate junk name (was enslaver)', updated_at=NOW()
       WHERE ${cond} RETURNING id`, [JUNK]);
    console.log(`\nreclassified ${r.rowCount} junk entities enslaver->unknown + de-asserted. Reversible via notes.`);
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
