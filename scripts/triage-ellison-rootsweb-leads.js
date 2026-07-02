#!/usr/bin/env node
/**
 * QW-5 / issue #100 (part b) — triage the 260 leads shredded out of ONE rootsweb narrative page
 * (the William Ellison family, Sumter SC). Ellison was a REAL free-Black slaveholder, so this is a
 * careful triage, NOT a blanket flag: only unambiguous NON-person fragments (place/structural words,
 * NameValidator garbage) are rejected; every real-looking name → 'needs_review' for a human.
 *
 * Reuses src/services/NameValidator.js (validate/hasGarbagePattern). Reversible (status only, note
 * appended). Does NOT touch the already-'reviewing' rows. The upstream segmentation fix (so a
 * narrative page is not sliced per-capitalized-token) is the separate #100 producer work.
 *
 *   node scripts/triage-ellison-rootsweb-leads.js            # dry-run
 *   node scripts/triage-ellison-rootsweb-leads.js --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const NameValidator = require('../src/services/NameValidator.js');
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// structural / place words that make a "name" a location or document label, not a person.
const NONPERSON = /\b(road|street|lane|ferry|graveyard|cemetery|church|plantation|county|family|creek|bridge|river|hill|house|store|mill|swamp)\b/i;

function isFragment(name) {
  const n = (name || '').trim();
  if (!n || n.length < 3) return true;
  if (NONPERSON.test(n)) return true;                 // place/structural label
  if (!NameValidator.isValidName(n)) return true;     // NameValidator garbage/common-word/header
  return false;
}

(async () => {
  try {
    const rows = (await pool.query(
      `SELECT lead_id, full_name FROM unconfirmed_persons
       WHERE source_url ILIKE '%rootsweb%ellison%' AND status='pending'`)).rows;
    const reject = [], review = [];
    for (const r of rows) (isFragment(r.full_name) ? reject : review).push(r);
    console.log(`=== triage-ellison-rootsweb ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    console.log(`${rows.length} pending leads → REJECT ${reject.length} (non-person fragments) · NEEDS_REVIEW ${review.length} (real-looking)\n`);
    console.log('would REJECT:'); reject.slice(0, 20).forEach(r => console.log(`  ✗ ${JSON.stringify(r.full_name)}`));
    console.log('would keep for review (sample):'); review.slice(0, 12).forEach(r => console.log(`  ? ${JSON.stringify(r.full_name)}`));

    if (!APPLY) { console.log('\n(dry-run — no writes. Re-run with --apply.)'); return; }
    let rj = 0, rv = 0;
    for (const r of reject) { await pool.query(`UPDATE unconfirmed_persons SET status='rejected', review_notes=COALESCE(review_notes,'') || ' | #100 rejected: rootsweb narrative fragment (not a person)' WHERE lead_id=$1`, [r.lead_id]); rj++; }
    for (const r of review) { await pool.query(`UPDATE unconfirmed_persons SET status='reviewing', review_notes=COALESCE(review_notes,'') || ' | #100 needs human review (shredded from Ellison narrative)' WHERE lead_id=$1`, [r.lead_id]); rv++; }
    console.log(`\nrejected ${rj} fragments; moved ${rv} to reviewing. Reversible (status + note).`);
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
