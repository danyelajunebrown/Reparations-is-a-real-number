#!/usr/bin/env node
/**
 * Reclassify existing probate `person_documents` rows with the shared
 * classifier (src/services/probate/document-classifier.js).
 *
 * Background: the Georgia probate scraper's old rule tagged a page as a `will`
 * whenever the transcript merely contained the substrings "executor" and
 * "will" anywhere — so estate accounts, inventories and will-book index pages
 * were all swept into `document_type = 'will'`. This script re-runs the
 * corrected classifier over every probate document already in the DB and, with
 * --apply, rewrites `document_type` and `extraction_confidence` to match.
 *
 * DRY RUN by default — prints the from -> to shift matrix and writes nothing.
 *
 *   node scripts/reclassify-probate-documents.mjs            # dry run
 *   node scripts/reclassify-probate-documents.mjs --apply    # write changes
 *   node scripts/reclassify-probate-documents.mjs --limit 50 # sample
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// document-classifier.js is CommonJS; load it through createRequire.
const require = createRequire(import.meta.url);
const { classifyTranscript } = require('../src/services/probate/document-classifier.js');

const APPLY = process.argv.includes('--apply');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : 0;

// Same mapping the scraper uses: classifier recordType -> person_documents.document_type.
const DOC_TYPE_MAP = {
  will: 'will',
  inventory: 'estate_inventory',
  estate_account: 'estate_account',
  guardian_account: 'guardian_account',
  letters: 'other',
  other: 'other',
};

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log(APPLY ? '=== RECLASSIFY (APPLY — writing changes) ===' : '=== RECLASSIFY (DRY RUN — no writes) ===');

  const rows = (await pool.query(
    `SELECT id, document_type, extraction_confidence, ocr_text
       FROM person_documents
      WHERE created_by = 'georgia-probate-scraper'
      ORDER BY id
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}`
  )).rows;

  console.log(`Loaded ${rows.length} probate document(s).\n`);

  const shifts = new Map();   // "from -> to" -> count
  let changed = 0;
  const updates = [];

  for (const r of rows) {
    const { recordType, confidence } = classifyTranscript(r.ocr_text);
    const newType = DOC_TYPE_MAP[recordType] || 'other';
    const oldType = r.document_type || 'other';

    const key = `${oldType} -> ${newType}`;
    shifts.set(key, (shifts.get(key) || 0) + 1);

    if (newType !== oldType || Number(r.extraction_confidence) !== confidence) {
      changed++;
      updates.push({ id: r.id, newType, confidence });
    }
  }

  console.log('Type shift matrix (current document_type -> reclassified):');
  for (const [k, n] of [...shifts.entries()].sort((a, b) => b[1] - a[1])) {
    const arrow = k.split(' -> ');
    const moved = arrow[0] !== arrow[1] ? '  <-- CHANGED' : '';
    console.log(`  ${String(n).padStart(6)}  ${k}${moved}`);
  }

  console.log(`\n${changed} row(s) would change document_type and/or extraction_confidence.`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to commit.');
    await pool.end();
    return;
  }

  console.log(`\nApplying ${updates.length} update(s)...`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      await client.query(
        `UPDATE person_documents
            SET document_type = $2, extraction_confidence = $3
          WHERE id = $1`,
        [u.id, u.newType, u.confidence]
      );
    }
    await client.query('COMMIT');
    console.log(`Done. ${updates.length} row(s) updated.`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
