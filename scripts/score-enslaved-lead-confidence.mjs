#!/usr/bin/env node
/**
 * QW-4 / issue #70 — evidence-based confidence for enslaved leads stuck at a FLAT 0.85.
 *
 * 0.85 is the "scholarly verified DB" tier (DATA_SOURCE_INTEGRATION_CONTRACT). Two disjoint populations
 * currently sit there:
 *   • santos_enslaved_import (11,273) — a real scholarly census DB → 0.85 is DEFENSIBLE, LEAVE IT
 *     (only apply flag penalties; never blanket-downgrade a scholarly source).
 *   • full_text_transcript / secondary (869) — OCR transcript extraction wrongly parked in the
 *     scholarly band → re-tier to the secondary band (0.70–0.84 cross-referenced; lower if single/flagged).
 *
 * Score = tier base (by extraction_method) minus evidence penalties. Reversible: writes the breakdown to
 * data_quality_flags->'confidence_evidence' and NEVER touches the scraper's mint-time default.
 * Clamped to tier bounds; NEVER promotes into the 0.95+ government tier.
 *
 *   node scripts/score-enslaved-lead-confidence.mjs            # dry-run (histogram old->new)
 *   node scripts/score-enslaved-lead-confidence.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// scholarly DB imports legitimately sit in the 0.85 band; OCR/transcript is secondary at best.
const SCHOLARLY = /^(santos_enslaved_import|hall_|louisiana_|natchez_|ml_)/;
const OCR_SECONDARY = /(transcript|ocr|docai|regex|probate)/i;

function scoreLead(l) {
  const flags = (l.data_quality_flags && typeof l.data_quality_flags === 'object') ? l.data_quality_flags : {};
  const ev = [];
  const scholarly = SCHOLARLY.test(l.extraction_method || '');
  let base;
  if (scholarly) { base = 0.85; ev.push('scholarly DB (0.85)'); }
  else if (OCR_SECONDARY.test(l.extraction_method || '') || l.source_type === 'secondary') { base = 0.72; ev.push('OCR/secondary base (0.72)'); }
  else { base = 0.60; ev.push('unclassified base (0.60)'); }
  let s = base;
  // hard cap: a name that is a document/OCR artifact is not an identifiable person (applies to all sources)
  if (flags.name_artifact) { s = Math.min(s, 0.35); ev.push('name_artifact cap (0.35)'); }
  if (flags.implausible_age_year) { s -= 0.10; ev.push('implausible age/year (-0.10)'); }
  // STRUCTURAL penalties (mononym / missing location) apply ONLY to non-scholarly sources — a single
  // name and no county are NORMAL in a scholarly slave-census DB (esp. Brazilian mononyms), not a defect.
  if (!scholarly) {
    const name = (l.full_name || '').trim();
    if (name && !/\s/.test(name)) { s -= 0.05; ev.push('single-token name (-0.05)'); }
    if (!(Array.isArray(l.locations) && l.locations.length)) { s -= 0.05; ev.push('no location (-0.05)'); }
  }
  // clamp to below the 0.95 government tier and above a 0.20 floor
  s = Math.max(0.20, Math.min(0.94, Math.round(s * 100) / 100));
  return { score: s, ev };
}

(async () => {
  try {
    const rows = (await pool.query(
      `SELECT lead_id, full_name, extraction_method, source_type, locations, data_quality_flags
       FROM unconfirmed_persons
       WHERE person_type IN ('enslaved','suspected_enslaved') AND confidence_score = 0.85`)).rows;
    console.log(`=== score-enslaved-lead-confidence ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    console.log(`${rows.length.toLocaleString()} leads at flat 0.85\n`);
    const bucket = {}, changed = [];
    for (const r of rows) {
      const { score, ev } = scoreLead(r);
      const key = score.toFixed(2);
      bucket[key] = (bucket[key] || 0) + 1;
      if (score !== 0.85) changed.push({ r, score, ev });
    }
    console.log('proposed confidence histogram:');
    Object.entries(bucket).sort((a, b) => Number(b[0]) - Number(a[0])).forEach(([k, c]) => console.log(`  ${k} : ${c.toLocaleString()}`));
    console.log(`\n${changed.length.toLocaleString()} leads would change from 0.85 (${(rows.length - changed.length).toLocaleString()} stay — scholarly, clean).`);
    console.log('sample changes:');
    changed.slice(0, 8).forEach(({ r, score, ev }) => console.log(`  ${JSON.stringify((r.full_name||'').slice(0,24))} [${r.extraction_method}] 0.85 -> ${score}  (${ev.join('; ')})`));

    if (!APPLY) { console.log('\n(dry-run — no writes. Re-run with --apply.)'); return; }
    let n = 0;
    for (const { r, score, ev } of changed) {
      const flags = (r.data_quality_flags && typeof r.data_quality_flags === 'object') ? r.data_quality_flags : {};
      flags.confidence_evidence = { from: 0.85, to: score, reasons: ev, scored: 'qw4-#70' };
      await pool.query(`UPDATE unconfirmed_persons SET confidence_score = $2, data_quality_flags = $3 WHERE lead_id = $1`,
        [r.lead_id, score, JSON.stringify(flags)]);
      n++;
    }
    console.log(`\nre-scored ${n.toLocaleString()} leads (breakdown in data_quality_flags->confidence_evidence; reversible).`);
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
