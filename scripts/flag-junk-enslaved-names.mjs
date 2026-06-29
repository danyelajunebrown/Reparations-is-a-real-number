#!/usr/bin/env node
/**
 * ⑤ Data-quality: FLAG (never delete) unconfirmed enslaved leads whose name is a clear
 * document/OCR ARTIFACT (not a person) — e.g. "Act", "Administrators", "Estate", "Esq", a month
 * abbreviation — surfaced by the enslaved→owner producer / DAA Source 4.
 *
 * CRITICAL (documented prior mistake): descriptor-placeholders like "Boy", "Girl", "Woman",
 * "Unknown", "Negro", "Infant", "Child" represent REAL unnamed enslaved people (age/sex captured,
 * name not) — a past `NOT LIKE 'Unknown%'` filter wrongly dropped Charles Brown's 5 documented
 * enslaved. So the blocklist below is NARROW: only legal/structural/OCR artifacts, NEVER descriptors.
 * High-precision EXACT (normalized) matches only; we FLAG via data_quality_flags->'name_artifact'
 * (reversible), we do not delete, and consumers can choose to exclude flagged rows.
 *
 *   node scripts/flag-junk-enslaved-names.mjs            # dry-run (lists every name it would flag)
 *   node scripts/flag-junk-enslaved-names.mjs --apply
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Normalized (lowercase, alnum+space) names that are NEVER a person — extraction artifacts only.
// Deliberately EXCLUDES descriptor-placeholders (boy/girl/woman/man/child/infant/unknown/negro/
// slave) which are real unnamed enslaved people.
const ARTIFACTS = new Set([
  // legal / estate / accounting structure
  'act', 'administrator', 'administrators', 'administratrix', 'executor', 'executors', 'executrix',
  'estate', 'estates', 'heir', 'heirs', 'deceased', 'decd', 'codicil', 'inventory', 'appraisement',
  'appraisal', 'item', 'lot', 'sundry', 'sundries', 'balance', 'amount', 'total', 'cash', 'note',
  'notes', 'bond', 'account', 'accounts', 'voucher', 'receipt', 'page', 'folio', 'column', 'ditto',
  // titles / abbreviations misparsed as a name
  'esq', 'esqr', 'capt', 'captn', 'clk', 'hon', 'messrs', 'mrs', 'mr', 'dr', 'rev',
  // months / date fragments
  'jan', 'feb', 'mar', 'apl', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  // connectors / fragments
  'and', 'the', 'of', 'to', 'and i', 'do',
]);

const norm = (s) => (s == null ? '' : String(s)).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

(async () => {
  try {
    // Candidate population: enslaved leads (the ones the producer/#3 surface)
    const rows = (await pool.query(
      `SELECT lead_id, full_name, data_quality_flags FROM unconfirmed_persons
       WHERE person_type IN ('enslaved','suspected_enslaved') AND full_name IS NOT NULL`)).rows;
    const hits = rows.filter(r => ARTIFACTS.has(norm(r.full_name)));
    const byName = {};
    for (const h of hits) byName[h.full_name] = (byName[h.full_name] || 0) + 1;

    console.log(`=== flag-junk-enslaved-names ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    console.log(`scanned ${rows.length.toLocaleString()} enslaved leads; ${hits.length.toLocaleString()} match the artifact blocklist (${Object.keys(byName).length} distinct names):`);
    Object.entries(byName).sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`   ${JSON.stringify(n)} × ${c}`));

    if (!APPLY) { console.log('\n(dry-run — nothing flagged. Eyeball the list above; re-run with --apply.)'); return; }

    let flagged = 0;
    for (const h of hits) {
      const flags = (h.data_quality_flags && typeof h.data_quality_flags === 'object') ? h.data_quality_flags : {};
      flags.name_artifact = true;
      await pool.query(`UPDATE unconfirmed_persons SET data_quality_flags = $2 WHERE lead_id = $1`, [h.lead_id, JSON.stringify(flags)]);
      flagged++;
    }
    console.log(`\nflagged ${flagged} leads with data_quality_flags->'name_artifact'=true (NOT deleted; reversible).`);
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
