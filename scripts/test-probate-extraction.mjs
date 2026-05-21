#!/usr/bin/env node
/**
 * Measurement harness for the probate entity extractor.
 *
 * Runs src/services/probate/probate-entity-extractor.js against the OCR text
 * already stored in person_documents (created_by 'georgia-probate-scraper')
 * and reports hit rates — the iterate/debug loop for the extraction rebuild.
 * Read-only: writes nothing.
 *
 *   node scripts/test-probate-extraction.mjs                 # full corpus
 *   node scripts/test-probate-extraction.mjs --limit 500     # quick pass
 *   node scripts/test-probate-extraction.mjs --misses will   # dump testator
 *                                                            #  misses for a type
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);
const { extractEntities } = require('../src/services/probate/probate-entity-extractor.js');

const args = process.argv.slice(2);
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx !== -1 ? parseInt(args[limIdx + 1], 10) : 0;
const missIdx = args.indexOf('--misses');
const MISSES = missIdx !== -1 ? args[missIdx + 1] : null;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const rows = (await pool.query(
    `SELECT id, document_type, name_as_appears, document_year, ocr_text
       FROM person_documents
      WHERE created_by = 'georgia-probate-scraper' AND ocr_text IS NOT NULL
      ORDER BY id ${LIMIT ? `LIMIT ${LIMIT}` : ''}`
  )).rows;

  const stat = {};
  const bump = (type, key) => {
    stat[type] = stat[type] || { docs: 0, testator: 0, year: 0, heirDocs: 0, heirs: 0,
      enslavedDocs: 0, enslaved: 0, value: 0, oldTestator: 0, oldYear: 0 };
    stat[type][key]++;
  };
  const missExamples = [];

  for (const r of rows) {
    const type = r.document_type || 'null';
    const e = extractEntities(r.ocr_text);
    bump(type, 'docs');
    if (e.testatorName) bump(type, 'testator');
    else if (MISSES && type === MISSES && missExamples.length < 12) {
      missExamples.push({ id: r.id, ocr: r.ocr_text.replace(/\s+/g, ' ').slice(0, 240) });
    }
    if (e.year) bump(type, 'year');
    if (e.heirs.length) { bump(type, 'heirDocs'); stat[type].heirs += e.heirs.length; }
    if (e.enslavedPersons.length) { bump(type, 'enslavedDocs'); stat[type].enslaved += e.enslavedPersons.length; }
    if (e.estateValue) bump(type, 'value');
    // baseline (what the scraper stored)
    if (r.name_as_appears && !/^image\s+\d/i.test(r.name_as_appears)) bump(type, 'oldTestator');
    if (r.document_year) bump(type, 'oldYear');
  }

  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');
  console.log(`\nProbate extraction — ${rows.length} OCR pages\n`);
  const totals = { docs: 0, testator: 0, oldTestator: 0, year: 0, oldYear: 0,
    heirs: 0, enslaved: 0, value: 0 };
  for (const [type, s] of Object.entries(stat).sort((a, b) => b[1].docs - a[1].docs)) {
    console.log(`${type}  (${s.docs} pages)`);
    console.log(`  testator : ${pct(s.testator, s.docs).padStart(7)}  (was ${pct(s.oldTestator, s.docs)})`);
    console.log(`  year     : ${pct(s.year, s.docs).padStart(7)}  (was ${pct(s.oldYear, s.docs)})`);
    console.log(`  heirs    : ${String(s.heirs).padStart(6)} across ${s.heirDocs} pages`);
    console.log(`  enslaved : ${String(s.enslaved).padStart(6)} across ${s.enslavedDocs} pages`);
    console.log(`  est value: ${String(s.value).padStart(6)} pages`);
    for (const k of Object.keys(totals)) totals[k] += s[k] || 0;
  }
  console.log(`\nTOTAL  (${totals.docs} pages)`);
  console.log(`  testator : ${pct(totals.testator, totals.docs)}  (was ${pct(totals.oldTestator, totals.docs)})`);
  console.log(`  year     : ${pct(totals.year, totals.docs)}  (was ${pct(totals.oldYear, totals.docs)})`);
  console.log(`  heirs    : ${totals.heirs}   enslaved: ${totals.enslaved}   est values: ${totals.value}`);

  if (missExamples.length) {
    console.log(`\n--- testator misses for '${MISSES}' (debug) ---`);
    for (const m of missExamples) console.log(`[doc${m.id}] ${m.ocr}\n`);
  }
  await pool.end();
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
