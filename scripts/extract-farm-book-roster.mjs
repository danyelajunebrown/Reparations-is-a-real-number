// extract-farm-book-roster.mjs — Stage 3 of the Farm Book ingest: extract every ENSLAVED-person mention from
// each Farm Book page transcription → farm_book_persons staging (per-mention). Clean text (Baron transcription)
// so the free LLM router extracts reliably. Parentage (mother/father) is captured as text for Stage 4/5.
// NO leads/edges created here — Stage 5 resolves mentions → distinct people first (Biscoe-safe).
//
// Usage: node scripts/extract-farm-book-roster.mjs [--limit N] [--apply]   (idempotent: skips done pages)

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { callLLM, MODEL } = require('../src/services/probate/probate-llm-extractor');

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const LIMIT = (() => { const i = A.indexOf('--limit'); return i > -1 ? +A[i + 1] : 60; })();
const GAP = 1800;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SYS = 'You extract ENSLAVED people from a page of Thomas Jefferson\'s Farm Book (an enslaver\'s plantation ' +
  'ledger, 1774-1824). Extract ONLY enslaved people — NOT Jefferson, overseers, stewards, hired white workers, ' +
  'horses, or livestock. The text is a clean transcription. STRICT JSON only; never invent.';
const SCHEMA = `{"roll_year": number|null, "persons": [{
  "name": string, "birth_year": number|null,
  "location": string|null,   // Monticello, Shadwell, Elk-hill, Poplar Forest, Bedford, Lego, Tufton, Dun-lora, etc.
  "status": "labourer_in_ground"|"tradesperson"|"discharged"|"unknown",  // the marks: *=labourer, +=tradesperson/other occupation, -=discharged for age/infirmity
  "occupation": string|null,
  "mother": string|null,     // family brackets group a mother's children; birth registers give "Child (Father & Mother)"
  "father": string|null
}]}`;

function prompt(text) {
  return `Extract the enslaved people from this Farm Book page into the schema. Family brackets like ` +
    `"Betty Hemings { Nancy 1761, Thenia 1767, Critta 1769 }" mean those are Betty Hemings's children (mother=Betty Hemings). ` +
    `Birth registers like "Martin (Abram & Doll)" mean father=Abram, mother=Doll. Location headers apply to the names under them.\n` +
    `SCHEMA:\n${SCHEMA}\n\nPAGE:\n"""\n${text.slice(0, 12000)}\n"""\n\nReturn only the JSON object.`;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 180000 });
  const docs = (await pool.query(
    `SELECT d.id, d.source_url, length(d.ocr_text) len, d.ocr_text FROM person_documents d
      WHERE d.source_type='jefferson_farm_book' AND length(d.ocr_text) >= 60
        AND NOT EXISTS (SELECT 1 FROM farm_book_persons f WHERE f.person_document_id = d.id)
      ORDER BY d.id LIMIT ${LIMIT}`)).rows;
  console.log(`=== Farm Book Stage 3 (roster→staging) — ${docs.length} pages, router=${MODEL} ${APPLY ? 'APPLY' : 'DRY'} ===`);

  let mentions = 0, pagesDone = 0, streak = 0;
  for (const d of docs) {
    const page = +(d.source_url.match(/farm_(\d+)/)?.[1] || 0);
    let j = null;
    try { j = (await callLLM(prompt(d.ocr_text), { system: SYS, maxTokens: 4000 })).json; streak = 0; }
    catch (e) { if (++streak >= 5) { console.log('  ⚠ 5 consecutive provider failures — aborting (resumable).'); break; } continue; }
    const persons = Array.isArray(j.persons) ? j.persons : [];
    console.log(`  p${page}: ${persons.length} enslaved mentions (roll_year ${j.roll_year || '?'})`);
    if (APPLY) for (const p of persons) {
      const nm = (p.name || '').trim(); if (nm.length < 2) continue;
      await pool.query(
        `INSERT INTO farm_book_persons (person_document_id, page, roll_year, name, birth_year, location, status, occupation, mother_name, father_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [d.id, page, j.roll_year || null, nm, p.birth_year || null, p.location || null, p.status || 'unknown', p.occupation || null, p.mother || null, p.father || null]).catch(() => {});
      mentions++;
    } else mentions += persons.length;
    pagesDone++;
    await sleep(GAP);
  }
  console.log(`=== done: ${pagesDone} pages, ${mentions} enslaved person-mentions staged ===`);
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
