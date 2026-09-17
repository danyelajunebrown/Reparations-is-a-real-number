#!/usr/bin/env node
// Regression test — the distinction this whole file exists to protect:
//
//   '' means "a provider answered and the page held no text"   (a fact about the DOCUMENT)
//   throw means "no provider could be reached"                 (a fact about OUR INFRASTRUCTURE)
//
// Collapsing those two is how a suspended Vision key (issue #126) and later a Gemini 429 both got
// recorded as "OCR returned little text - may be title page" — an outage written into the evidence base
// as a claim about a historical document. The caller's guard was correct and could never fire, because
// this router swallowed the error and returned ''.
//
// Run: node tests/unit/test-vision-router-failure-modes.js   (exits non-zero on any failure)
process.env.VISION_PROVIDERS = 'gemini';
process.env.GEMINI_API_KEY = 'test-key';
delete process.env.OPENROUTER_API_KEY;

const { transcribeImage } = require('../../src/services/vision/vision-router');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const stub = (status, body) => { global.fetch = async () => ({
  ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }); };

const CASES = [
  { name: "blank page (200, whitespace content) -> '' , no throw",
    stub: [200, { choices: [{ message: { content: '   ' } }] }], expect: { returns: '' } },
  { name: 'real transcription passes through',
    stub: [200, { choices: [{ message: { content: 'Sussex County 1860' } }] }], expect: { returns: 'Sussex County 1860' } },
  { name: '429 quota wall -> THROWS (must never look like a blank page)',
    stub: [429, { error: { code: 429, message: 'You exceeded your current quota' } }], expect: { throws: 'VisionProvidersExhausted' } },
  { name: '401 auth failure -> THROWS',
    stub: [401, { error: { message: 'invalid api key' } }], expect: { throws: 'VisionProvidersExhausted' } },
  { name: '500 provider error -> THROWS',
    stub: [500, { error: { message: 'internal' } }], expect: { throws: 'VisionProvidersExhausted' } },
];

(async () => {
  let pass = 0;
  for (const c of CASES) {
    stub(...c.stub);
    let got;
    try { got = { returned: await transcribeImage(PNG, { mimeType: 'image/png' }) }; }
    catch (e) { got = { threw: e.name, message: e.message }; }

    const ok = c.expect.throws ? got.threw === c.expect.throws : got.returned === c.expect.returns;
    if (ok) pass++;
    console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${c.name}`);
    if (!ok) console.log(`        got ${JSON.stringify(got).slice(0, 120)}`);
  }
  // The caller (extract-census-ocr performOCR) only rethrows messages matching this pattern. If the
  // router's wording drifts out of it, the guard silently stops working again — assert the contract.
  stub(429, { error: { message: 'You exceeded your current quota' } });
  let msg = '';
  try { await transcribeImage(PNG, { mimeType: 'image/png' }); } catch (e) { msg = e.message; }
  const CALLER_RE = /40[13]|quota|exhaust|unauthor|api key|credential|all providers/i;
  const wired = CALLER_RE.test(msg);
  if (wired) pass++;
  console.log(`  ${wired ? '✓' : '✗ FAIL'}  message still matches performOCR's rethrow pattern`);

  console.log(`\n  ${pass}/${CASES.length + 1} passing`);
  process.exit(pass === CASES.length + 1 ? 0 : 1);
})();
