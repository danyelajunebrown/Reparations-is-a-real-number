#!/usr/bin/env node
/**
 * ingest-nesri-csv.mjs — ingest a NESRI "Download Data" CSV (the Caspio native export, 38 columns)
 * into the DB. The download path is FAR cleaner than card-scraping — one CSV with every field — but
 * Caspio caps each export at ~250 rows, so the full Dutchess corpus (2,569) is assembled from multiple
 * sliced CSVs; this script ingests any one of them (idempotent via product-specific external ids).
 *
 * Routing (standard-external-source-ingest):
 *   - Enslaver rows  → enslaver LEAD (dedup via PersonService — AUTO-LINKS to our census/will
 *     enslavers of the same family, which is the cross-source corroboration payoff).
 *   - Enslaved rows  → enslaved LEAD + owner→enslaved edge (when an enslaver is named).
 *   - Census rows    → SKIPPED as persons (aggregate counts → benchmarks, never fabricated person rows).
 *   - Site/College/Ship → skipped (not persons).
 * Secondary tier (0.85), id_system 'nesri', externalId = NESRI Enslaver/Enslaved Person Code.
 *
 *   node scripts/ingest-nesri-csv.mjs worksheets/nesri-dutchess-batch1.csv            # DRY RUN
 *   node scripts/ingest-nesri-csv.mjs worksheets/nesri-dutchess-batch1.csv --apply
 */
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
const require = (await import('node:module')).createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!FILE || !fs.existsSync(FILE)) { console.error('usage: ingest-nesri-csv.mjs <file.csv> [--apply]'); process.exit(1); }

function parseCSV(t) {
  const rows = []; let f = [], cur = '', q = false;
  t = t.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { f.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; f.push(cur); rows.push(f); f = []; cur = ''; }
      else cur += c; } }
  if (cur || f.length) { f.push(cur); rows.push(f); }
  return rows;
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ps = new PersonService(pool);
const nz = (v) => v != null && String(v).trim() !== '';
const s = { enslaverC: 0, enslaverL: 0, enslavedC: 0, enslavedL: 0, edges: 0, censusSkip: 0, otherSkip: 0, rejected: 0 };

(async () => {
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');
  const rows = parseCSV(fs.readFileSync(FILE, 'utf8'));
  const hdr = rows[0].map(h => h.trim());
  const col = (r, name) => { const i = hdr.findIndex(h => h.toLowerCase().replace(/\s+/g, ' ') === name.toLowerCase()); return i >= 0 ? (r[i] || '').trim() : ''; };
  const recs = rows.slice(1).filter(r => r.length >= hdr.length - 3);
  console.log(`rows: ${recs.length}`);

  for (const r of recs) {
    const type = col(r, 'Record Type');
    const year = parseInt(col(r, 'Year of Record'), 10) || null;
    const src = col(r, 'Source Document');
    const enslaverName = [col(r, 'Enslaver First Name'), col(r, 'Enslaver Last Name')].filter(Boolean).join(' ').trim();
    const enslavedName = [col(r, 'Enslaved Person First Name'), col(r, 'Enslaved Person  Last Name')].filter(Boolean).join(' ').trim();
    const enslaverCode = col(r, 'Enslaver Code');
    const enslavedCode = col(r, 'Enslaved Person Code');
    const nEnslaved = col(r, 'Number of Enslaved Persons');

    if (/census/i.test(type)) { s.censusSkip++; continue; }             // aggregate → benchmark, not a person
    if (!/enslaver|enslaved/i.test(type)) { s.otherSkip++; continue; }   // Site/College/Ship

    let enslaverRef = null;
    if (nz(enslaverName)) {
      const er = await ps.findOrCreateLead({
        name: enslaverName, personType: 'enslaver', locations: ['Dutchess County, New York'],
        sourceType: 'secondary', confidence: 0.85, idSystem: 'nesri',
        externalId: enslaverCode || `nesri-enslaver-${enslaverName}-${year || '?'}`,
        sourceUrl: 'https://nesri.commons.gc.cuny.edu/ (NESRI/CUNY-GC)',
        context: `NESRI Dutchess ${type} record${year ? ', ' + year : ''}${src ? ' — ' + src : ''}${nz(nEnslaved) ? '; enslaved count ' + nEnslaved : ''}.`,
        dataQualityFlags: { source_tier: 'secondary', max_evidence_tier: 'secondary', source: 'nesri',
          nesri_record_type: type, ...(nz(nEnslaved) ? { enslaved_count_documented: nEnslaved } : {}) },
      }, { dryRun: !APPLY });
      if (er.action === 'linked') s.enslaverL++; else if (er.action === 'created' || er.action === 'would_create') s.enslaverC++; else s.rejected++;
      enslaverRef = er.ref;
    }

    if (nz(enslavedName)) {
      const nr = await ps.findOrCreateLead({
        name: enslavedName, personType: 'enslaved', locations: ['Dutchess County, New York'],
        sourceType: 'secondary', confidence: 0.85, idSystem: 'nesri',
        externalId: enslavedCode || `nesri-enslaved-${enslavedName}-${year || '?'}`,
        sourceUrl: 'https://nesri.commons.gc.cuny.edu/ (NESRI/CUNY-GC)',
        context: `NESRI Dutchess enslaved-person record${year ? ', ' + year : ''}${enslaverName ? ', held by ' + enslaverName : ''}${src ? ' — ' + src : ''}.`,
        dataQualityFlags: { source_tier: 'secondary', source: 'nesri', ...(enslaverName ? { enslaver_name: enslaverName } : {}) },
      }, { dryRun: !APPLY });
      if (nr.action === 'linked') s.enslavedL++; else if (nr.action === 'created' || nr.action === 'would_create') s.enslavedC++; else { s.rejected++; continue; }

      if (APPLY && enslaverRef && nr.ref && nz(enslaverName)) {
        await pool.query(
          `INSERT INTO enslaved_owner_relationships
             (enslaved_name, owner_name, relationship_type, start_year, relationship_source, source_url,
              source_context, confidence_score, verification_status, created_by,
              enslaved_subject_table, enslaved_subject_id, owner_subject_table, owner_subject_id)
           VALUES ($1,$2,'enslaved_by',$3,'nesri',$4,$5,0.85,'unverified','nesri-csv-ingest',$6,$7,$8,$9)
           ON CONFLICT DO NOTHING`,
          [enslavedName, enslaverName, year, 'https://nesri.commons.gc.cuny.edu/', `NESRI Dutchess ${src}`,
           nr.ref.subject_table, nr.ref.subject_id, enslaverRef.subject_table, enslaverRef.subject_id]).catch(() => {});
        s.edges++;
      }
    }
  }

  console.log(`\n=== SUMMARY (${APPLY ? 'APPLIED' : 'DRY RUN'}) ===`);
  console.log(`  enslavers: created ${s.enslaverC}  linked(dedup→our census/wills) ${s.enslaverL}`);
  console.log(`  enslaved:  created ${s.enslavedC}  linked ${s.enslavedL}`);
  console.log(`  owner→enslaved edges: ${s.edges}`);
  console.log(`  census rows skipped (→benchmark, not persons): ${s.censusSkip}   other (site/college): ${s.otherSkip}   rejected(no name): ${s.rejected}`);
  if (!APPLY) console.log(`\n  → re-run with --apply to write.`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
