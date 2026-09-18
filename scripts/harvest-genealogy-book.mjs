// harvest-genealogy-book.mjs — full-harvest EVERY person + stated kinship from a compiled genealogy.
//
// Compiled genealogies are pre-deduped, parentage-explicit sources (the Biscoe-rule key handed to us). We
// harvest the WHOLE book into genealogy_book_persons (migration 134), not just the person we came for. A
// separate review-gated promote turns staging → leads + canonical_family_edges (book-people are secondary,
// requires_review, NOT auto-enslavers). FREE (local text + the free LLM router). Resumable, low-and-slow.
//
// Usage:
//   node scripts/harvest-genealogy-book.mjs --book-text /path/book.txt --book-id bowiestheirkindr00bowi \
//        --title "Bowies and Their Kindred" --url https://archive.org/details/bowiestheirkindr00bowi [--apply]
//        [--max-chunks N]   (env: CHUNK=6000, GAP_MS=1500)

import 'dotenv/config';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { callLLM, MODEL } = require('../src/services/probate/probate-llm-extractor');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const BOOK_TEXT = val('--book-text'); const BOOK_ID = val('--book-id', 'unknown');
const TITLE = val('--title', ''); const URL = val('--url', '');
const CHUNK = parseInt(process.env.CHUNK || '6000', 10);
const GAP_MS = parseInt(process.env.GAP_MS || '1500', 10);
const MAX_CHUNKS = parseInt(val('--max-chunks', '0'), 10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SYS = 'You extract PERSONS from a compiled 18th-20th c. American family genealogy (OCR may be garbled). ' +
  'Conventions: "b."=born, "d."=died, "m."=married, "Issue:"=children, "son/daughter of X and Y"=parents. ' +
  'Extract EVERY named person in the passage with whatever the text states; never invent. STRICT JSON only.';
const schema = '{"persons":[{"name":string,"birth":string|null,"death":string|null,"father":string|null,"mother":string|null,"spouse":string|null,"residence":string|null,"note":string|null}]}';

function chunks(text) {
  const paras = text.split(/\n\s*\n/); const out = []; let cur = '';
  for (const p of paras) { if ((cur + p).length > CHUNK && cur) { out.push(cur); cur = ''; } cur += p + '\n\n'; }
  if (cur.trim()) out.push(cur);
  return out;
}

async function main() {
  if (!BOOK_TEXT || !fs.existsSync(BOOK_TEXT)) { console.error('need --book-text <path to extracted text>'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
  const done = new Set((await pool.query(`SELECT DISTINCT chunk_index c FROM genealogy_book_persons WHERE book_id=$1`, [BOOK_ID])).rows.map(r => r.c));
  const all = chunks(fs.readFileSync(BOOK_TEXT, 'utf8'));
  const total = MAX_CHUNKS ? Math.min(MAX_CHUNKS, all.length) : all.length;
  console.log(`=== harvest ${BOOK_ID}: ${all.length} chunks (processing ${total}), ${done.size} already done, router=${MODEL} ${APPLY ? 'APPLY' : 'DRY'} ===`);

  let people = 0, staged = 0, fail = 0, streak = 0;
  for (let i = 0; i < total; i++) {
    if (done.has(i)) continue;
    let persons = [];
    try { const { json } = await callLLM(`Extract persons from this genealogy passage into ${schema}.\n\n"""${all[i]}"""`, { system: SYS, maxTokens: 4000 });
      persons = Array.isArray(json.persons) ? json.persons : []; streak = 0; }
    catch (e) { fail++; if (++streak >= 5) { console.log('  ⚠ 5 consecutive failures — provider quota; aborting (resumable).'); break; } continue; }
    people += persons.length;
    if (APPLY) for (const p of persons) {
      const nm = (p.name || '').trim(); if (nm.length < 3) continue;
      const r = await pool.query(
        `INSERT INTO genealogy_book_persons (book_id, book_title, source_url, name, birth, death, father_name, mother_name, spouse_name, residence, note, chunk_index)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (book_id, name, COALESCE(birth,'')) DO NOTHING RETURNING id`,
        [BOOK_ID, TITLE, URL, nm, p.birth || null, p.death || null, p.father || null, p.mother || null, p.spouse || null, p.residence || null, p.note || null, i]);
      staged += r.rows.length;
    }
    if (i % 10 === 0) process.stdout.write(`\r  chunk ${i}/${total} — ${people} persons seen, ${staged} staged, ${fail} fail   `);
    await sleep(GAP_MS);
  }
  console.log(`\n=== done: ${people} persons seen, ${staged} newly staged (dedup within book), ${fail} chunk-failures ===`);
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
