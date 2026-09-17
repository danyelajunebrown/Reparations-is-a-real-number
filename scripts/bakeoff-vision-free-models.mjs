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

// A MODEL MUST NOT BE SCORED ON A REQUEST THAT NEVER REACHED IT.
// First version of this function scored `ling-3.0-flash-vl` as "0/7 ages" when OpenRouter had actually
// returned HTTP 200 with a 429 nested in the BODY — an upstream rate-limit recorded as a fact about the
// model's eyesight. That is precisely the bug this session fixed in vision-router, reproduced here
// within the hour. Errors and non-answers are now separated from scores, and a model that never
// produced output is reported as INCONCLUSIVE, never as a failure to read.
async function callModel(model, dataUrl, maxTokens = 3000) {
  const t0 = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(180000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR_KEY}` },
    body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens,
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }] }),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok) return { err: `http ${res.status}: ${(await res.text()).slice(0, 60)}`, secs };

  const j = await res.json();
  // OpenRouter reports upstream failures INSIDE a 200. Treat them as errors, not as answers.
  if (j.error) return { err: `upstream ${j.error.code || ''}: ${String(j.error.message).slice(0, 55)}`, secs };

  const ch = j.choices?.[0] || {};
  // Some reasoning models emit into `reasoning` and leave `content` empty.
  const text = (ch.message?.content || ch.message?.reasoning || '').trim();
  if (!text) {
    return { inconclusive: ch.finish_reason === 'length'
      ? 'spent token budget before emitting (reasoning model)'
      : `empty content (finish_reason=${ch.finish_reason || 'none'})`, secs };
  }
  return { text, secs };
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
      let { text, err, inconclusive, secs } = await callModel(m, dataUrl);
      // an upstream 429 is transient by definition — give it one retry before judging the model
      if (err && /429|rate-limit/i.test(err)) {
        await new Promise((r) => setTimeout(r, 15000));
        ({ text, err, inconclusive, secs } = await callModel(m, dataUrl));
      }
      if (err) { console.log(`ERR  ${err}`); rows.push({ model: m, verdict: 'NOT REACHED', detail: err.slice(0, 44) }); continue; }
      if (inconclusive) { console.log(`--   ${inconclusive}`); rows.push({ model: m, verdict: 'INCONCLUSIVE', detail: inconclusive.slice(0, 44) }); continue; }
      const s = score(text);
      console.log(`${s.hit}/${s.want} ages · ~${s.countGuess} rows · ${secs}s${s.exact ? '  ★ EXACT' : ''}`);
      rows.push({ model: m, verdict: s.exact ? 'EXACT' : 'read, inaccurate',
                  ages_hit: `${s.hit}/${s.want}`, rows_seen: s.countGuess, secs });
    } catch (e) { console.log(`FAIL ${e.message.slice(0, 50)}`); rows.push({ model: m, verdict: 'NOT REACHED', detail: e.message.slice(0, 44) }); }
  }

  console.log('\n=== RESULT (ranked) ===');
  const scored = rows.filter((r) => r.ages_hit).sort((a, b) => parseInt(b.ages_hit) - parseInt(a.ages_hit));
  console.table(scored.concat(rows.filter((r) => !r.ages_hit)));
  console.log(`\n  models actually TESTED: ${scored.length} of ${rows.length}` +
              ` (${rows.filter((r) => r.verdict === 'NOT REACHED').length} unreachable,` +
              ` ${rows.filter((r) => r.verdict === 'INCONCLUSIVE').length} inconclusive)`);
  if (!scored.length) console.log('  ⚠️  NOTHING WAS MEASURED. This run says nothing about model quality.');
  console.log('\nA model is only adoptable if it gets the ages AND the row count right. Close is not usable:');
  console.log('a wrong count becomes a wrong enslaved_count on a real person\'s record.\n');
})();
