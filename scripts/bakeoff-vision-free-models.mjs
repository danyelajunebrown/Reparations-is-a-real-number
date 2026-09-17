// bakeoff-vision-free-models.mjs — which FREE vision model can actually read 1860 cursive?
//
// WHY. The corpus needs OCR on ~4,576 pages (3.2%; pre-indexed transcriptions cover the rest). Gemini's
// free tier is daily-capped, so a second free provider means the backlog drains in days instead of weeks.
// OpenRouter lists free image-capable models — but "free" says nothing about whether it can COUNT A
// CURSIVE CENSUS PAGE. The 2026-07-06 bakeoff is blunt about that: GPT-4o returned 12 people, gpt-4o-mini
// returned 116, Groq hallucinated a name. Adopting an untested model because it is free would put
// fabricated counts into the evidence base, which is the failure this project exists to avoid.
//
// So: score every candidate against a KNOWN page before trusting any of them.
// Ground truth lives in tests/fixtures/vision-bakeoff/ — never in this file (standing rule).
//
// READ-ONLY. No DB writes. Calls only models priced at 0 (asserted per-model before each call).
//
// Usage: node scripts/bakeoff-vision-free-models.mjs [--limit 10] [--include-control]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const A = process.argv.slice(2);
const LIMIT = (() => { const i = A.indexOf('--limit'); return i > -1 ? +A[i + 1] : 12; })();
const CONTROL = A.includes('--include-control');   // also run gemini (free tier, our current default)

const FIX = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/vision-bakeoff/forrest-1860.json'), 'utf8'));
const CASE = FIX.cases[0];

const PROMPT =
  'This is an 1860 US Census SLAVE SCHEDULE page. Transcribe it verbatim. For every enslaved person ' +
  'listed under the owner, output one line: AGE | SEX | COLOR. Do not summarise. Do not invent rows. ' +
  'If you cannot read a value write ?. Output only those lines.';

const OR_KEY = process.env.OPENROUTER_API_KEY;
if (!OR_KEY) { console.error('OPENROUTER_API_KEY not set'); process.exit(2); }

// ── candidates: FREE + image-capable, taken live from OpenRouter (never hardcoded) ──────────────────
async function freeVisionModels() {
  const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${OR_KEY}` } });
  const data = (await r.json()).data || [];
  return data.filter((m) => {
    const pr = m.pricing || {};
    const free = ['0', '0.0', '-1'].includes(String(pr.prompt)) && ['0', '0.0', '-1'].includes(String(pr.completion));
    const img = ((m.architecture || {}).input_modalities || []).includes('image');
    // exclude routers/aliases — they can silently dispatch to a PAID model
    const alias = /^openrouter\/(auto|free)/.test(m.id) || /stealth\//.test(m.id);
    return free && img && !alias;
  }).map((m) => m.id);
}

const ages = (txt) => (txt.match(/\b(1[0-9]{1,2}|[1-9][0-9]?)\b/g) || []).map(Number).filter((n) => n >= 0 && n <= 110);

function score(text) {
  const got = ages(text);
  const want = CASE.expected_ages.slice();
  let hit = 0;
  const pool = got.slice();
  for (const w of want) { const i = pool.indexOf(w); if (i > -1) { pool.splice(i, 1); hit++; } }
  const lines = text.split('\n').filter((l) => /\d/.test(l)).length;
  return { hit, want: want.length, countGuess: lines, exact: hit === want.length && lines === want.length };
}

async function callModel(model, dataUrl) {
  const t0 = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(180000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR_KEY}` },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 1500,
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }] }),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok) return { err: `${res.status}: ${(await res.text()).slice(0, 70)}`, secs };
  const j = await res.json();
  return { text: (j.choices?.[0]?.message?.content || '').trim(), secs };
}

(async () => {
  console.log(`\nGROUND TRUTH — ${CASE.owner}, ${CASE.expected_person_count} enslaved, ages ${JSON.stringify(CASE.expected_ages)}`);
  console.log(`image: ${CASE.s3_key}\n`);

  const url = await S3.getViewUrl(CASE.s3_key, 900);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
  console.log(`fetched ${(buf.length / 1024).toFixed(0)} KB\n`);

  const models = (await freeVisionModels()).slice(0, LIMIT);
  console.log(`testing ${models.length} FREE image-capable models\n`);

  const rows = [];
  for (const m of models) {
    process.stdout.write(`  ${m.padEnd(52)} `);
    try {
      const { text, err, secs } = await callModel(m, dataUrl);
      if (err) { console.log(`ERR ${err}`); rows.push({ model: m, result: 'error', detail: err.slice(0, 40) }); continue; }
      const s = score(text);
      console.log(`${s.hit}/${s.want} ages · ~${s.countGuess} rows · ${secs}s${s.exact ? '  ★ EXACT' : ''}`);
      rows.push({ model: m, ages_hit: `${s.hit}/${s.want}`, rows_seen: s.countGuess, secs, exact: s.exact });
    } catch (e) { console.log(`FAIL ${e.message.slice(0, 50)}`); rows.push({ model: m, result: 'fail' }); }
  }

  console.log('\n=== RESULT (ranked) ===');
  console.table(rows.filter((r) => r.ages_hit).sort((a, b) =>
    parseInt(b.ages_hit) - parseInt(a.ages_hit)).concat(rows.filter((r) => !r.ages_hit)));
  console.log('\nA model is only adoptable if it gets the ages AND the row count right. Close is not usable:');
  console.log('a wrong count becomes a wrong enslaved_count on a real person\'s record.\n');
})();
