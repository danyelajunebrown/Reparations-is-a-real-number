#!/usr/bin/env node
/**
 * Estate segmentation for a probate roll. The corpus has no estate boundaries —
 * a roll is hundreds of sequential pages covering hundreds of decedents, ~1
 * header page tagged per estate, continuation pages untagged. This groups the
 * pages into discrete estate files (one decedent each) so the LLM extractor can
 * be fed complete estates.
 *
 * Method: scan pages in image order; an LLM batch-classifier marks which pages
 * START a new estate and names the decedent. The "current decedent" threads
 * across continuation pages (and across batch boundaries). Segments are written
 * to probate_estate_segments.
 *
 * Runs on the Mac Mini (HF token in .env). Heavy work stays off the MacBook.
 *
 *   node scripts/segment-probate-roll.mjs --roll 9SYT-PT5 [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ROLL = (() => { const i = process.argv.indexOf('--roll'); return i > -1 ? process.argv[i + 1] : null; })();
const MAXP = (() => { const i = process.argv.indexOf('--max-pages'); return i > -1 ? +process.argv[i + 1] : null; })();
const APPLY = process.argv.includes('--apply');
const BATCH = 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HF_URL = process.env.PROBATE_LLM_URL || 'https://router.huggingface.co/v1/chat/completions';
const MODEL = (() => { const i = process.argv.indexOf('--model'); return i > -1 ? process.argv[i + 1] : (process.env.PROBATE_SEG_MODEL || process.env.PROBATE_LLM_MODEL || 'meta-llama/Llama-3.3-70B-Instruct'); })();
const TOKEN = process.env.GROQ_API_KEY || process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;

const SYS = `You segment OCR'd 18th-20th century U.S. probate book pages into individual estate files. Each estate belongs to ONE deceased person (decedent/testator). A page STARTS a new estate only when it opens a new decedent's record: a will opening ("last will and testament of NAME", "I NAME ... do make this my last will"), an estate/inventory/appraisement/account header naming a decedent ("Estate of NAME deceased", "Inventory of the estate of NAME", "In account with the estate of NAME", "Returns of NAME's estate"). Continuation pages (more of the same will/inventory/account, or appraisal line-items) do NOT start a new estate. Reply STRICT JSON.`;

async function classifyBatch(pages, priorDecedent) {
  const listing = pages.map(p => `--- PAGE ${p.index} ---\n${(p.ocr || '').slice(0, 1000)}`).join('\n\n');
  const user = `The estate currently in progress before PAGE ${pages[0].index} belongs to: ${priorDecedent || '(none / start of roll)'}.\nFor EACH page below decide if it starts a NEW decedent's estate.\nReturn JSON: {"pages":[{"index":number,"starts_new_estate":boolean,"decedent_name":string|null}]}\n(decedent_name only when starts_new_estate is true.)\n\n${listing}`;
  for (let a = 0; a <= 4; a++) {
    try {
      const res = await fetch(HF_URL, { method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }], temperature: 0, max_tokens: 1200, response_format: { type: 'json_object' } }),
        signal: AbortSignal.timeout(90000) });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          const ra = parseFloat(res.headers.get('retry-after')) || 0;
          await sleep(Math.max(ra * 1000, 3000 * (a + 1)));
          continue;
        }
        throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0,120)}`);
      }
      const j = await res.json();
      return JSON.parse(j.choices[0].message.content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()).pages || [];
    } catch (e) { if (a === 4) throw e; await sleep(2000 * (a + 1)); }
  }
  return []; // exhausted — degrade to "all continuation" rather than crash
}

(async () => {
  if (!ROLL) { console.error('--roll <id> required'); process.exit(1); }
  if (APPLY) await pool.query(`CREATE TABLE IF NOT EXISTS probate_estate_segments (
    id serial PRIMARY KEY, roll_group_id text, decedent_name text,
    page_image_numbers int[], page_doc_ids int[], page_count int, created_at timestamptz DEFAULT now())`);

  let pages = (await pool.query(`
    SELECT pd.id AS doc_id, p.image_number AS img, pd.ocr_text AS ocr
    FROM person_documents pd JOIN probate_scrape_progress p ON p.person_document_id = pd.id
    WHERE pd.collection_key LIKE '%'||$1||'%' AND p.status='written'
    ORDER BY p.image_number`, [ROLL])).rows;
  if (MAXP) pages = pages.slice(0, MAXP);
  console.log(`Roll ${ROLL}: ${pages.length} pages${MAXP ? ' (capped)' : ''}. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} | model ${MODEL}\n`);

  const segments = [];
  let current = null;
  for (let i = 0; i < pages.length; i += BATCH) {
    const batch = pages.slice(i, i + BATCH).map((p, k) => ({ index: i + k, img: p.img, doc_id: p.doc_id, ocr: p.ocr }));
    let marks;
    try { marks = await classifyBatch(batch, current?.decedent); }
    catch (e) { console.log(`  batch @${i} error: ${e.message} — treating as continuation`); marks = []; }
    const markByIdx = new Map(marks.map(m => [m.index, m]));
    for (const pg2 of batch) {
      const m = markByIdx.get(pg2.index);
      if (m?.starts_new_estate && m.decedent_name) {
        current = { decedent: m.decedent_name.trim(), imgs: [], docs: [] };
        segments.push(current);
      }
      if (!current) { current = { decedent: '(unattributed roll head)', imgs: [], docs: [] }; segments.push(current); }
      current.imgs.push(pg2.img); current.docs.push(pg2.doc_id);
    }
    if ((i / BATCH) % 5 === 0) console.log(`  …${Math.min(i + BATCH, pages.length)}/${pages.length} pages, ${segments.length} estates so far`);
    await sleep(1500); // pace to stay under Groq free-tier RPM/TPM
  }

  console.log(`\nSegmented into ${segments.length} estates (avg ${(pages.length / segments.length).toFixed(1)} pages/estate).`);
  console.log('Sample:'); segments.slice(0, 12).forEach(s => console.log(`  ${s.decedent}  [${s.imgs.length} pp: ${s.imgs[0]}–${s.imgs[s.imgs.length-1]}]`));

  if (APPLY) {
    await pool.query(`DELETE FROM probate_estate_segments WHERE roll_group_id=$1`, [ROLL]);
    for (const s of segments) {
      await pool.query(`INSERT INTO probate_estate_segments (roll_group_id, decedent_name, page_image_numbers, page_doc_ids, page_count) VALUES ($1,$2,$3,$4,$5)`,
        [ROLL, s.decedent, s.imgs, s.docs, s.imgs.length]);
    }
    console.log(`\n✓ wrote ${segments.length} segments to probate_estate_segments.`);
  } else console.log('\n(dry run — re-run with --apply to persist)');
  await pool.end();
})();
