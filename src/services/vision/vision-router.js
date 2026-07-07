/**
 * Vision-OCR router — image→text transcription with a multi-provider router, the vision analog of
 * `src/services/probate/probate-llm-extractor.js`. Built behind the exact seam OCRService already
 * plugs into: `transcribeImage(buffer, {mimeType, prompt}) -> string`.
 *
 * Why this exists (issue #142): 1860 cursive OCR needs a model that is BOTH accurate AND uncapped.
 * A same-page bakeoff (ground-truth N.B. Forrest ages [30,22,18,16,14,8,15]=7) settled it:
 *   Qwen2.5-VL-72B (OpenRouter) → EXACT + uncapped   ✅ PRIMARY
 *   Gemini 2.5-flash            → accurate but DAILY-capped (~250/day)  → secondary
 *   GPT-4o / gpt-4o-mini / Groq → miscount cursive (12 / 116 / "Sarah Patton")  → gpt-4o tertiary only
 *   Google Vision               → key SUSPENDED (#126)
 *
 * All providers are OpenAI-compatible chat-completions with `image_url` (Gemini via its OpenAI-compat
 * endpoint). On 429/5xx/parse-fail we fall through to the next provider, exactly like the text router.
 * `VISION_PROVIDERS=openrouter-qwen,gemini` reorders/restricts the pool (bakeoffs).
 */

const DEFAULT_PROMPT =
  'Transcribe ALL legible text from this scanned document-page image VERBATIM, preserving names, ' +
  'dates, dollar amounts, and original spelling exactly. Do not summarize, translate, or modernize. ' +
  'If a word is illegible, write [illegible]. If the page is rotated, still transcribe it. Output ONLY the text.';

const OR_HEADERS = { 'HTTP-Referer': 'https://reparations.local', 'X-Title': 'reparations-vision' };

// Provider pool, tried in order. Qwen-VL first (accurate on cursive + uncapped via OpenRouter);
// Gemini second (accurate, daily-capped — good while quota is fresh); gpt-4o last (uncapped overflow).
function buildProviders() {
  const p = [];
  if (process.env.OPENROUTER_API_KEY) {
    p.push({ name: 'openrouter-qwen', url: 'https://openrouter.ai/api/v1/chat/completions',
      key: process.env.OPENROUTER_API_KEY, model: process.env.VISION_QWEN_MODEL || 'qwen/qwen2.5-vl-72b-instruct', headers: OR_HEADERS });
  }
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    p.push({ name: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      key: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, model: process.env.VISION_GEMINI_MODEL || 'gemini-2.5-flash',
      extra: { reasoning_effort: 'none' } });
  }
  if (process.env.OPENROUTER_API_KEY) {
    p.push({ name: 'openrouter-gpt4o', url: 'https://openrouter.ai/api/v1/chat/completions',
      key: process.env.OPENROUTER_API_KEY, model: 'openai/gpt-4o', headers: OR_HEADERS });
  }
  const order = (process.env.VISION_PROVIDERS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (order.length) return order.map(n => p.find(x => x.name === n)).filter(Boolean);
  return p;
}

const PROVIDERS = buildProviders();
const VISION_MODEL = PROVIDERS.length ? `${PROVIDERS[0].name}:${PROVIDERS[0].model}` : 'none';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Transcribe an image. Drop-in for the old gemini-ocr signature.
 * @param {Buffer} buffer   image bytes (jpeg/png/webp/gif)
 * @param {{mimeType?:string, prompt?:string, maxTokens?:number}} opts
 * @returns {Promise<string>} transcription ('' if every provider fails)
 */
async function transcribeImage(buffer, { mimeType = 'image/png', prompt = DEFAULT_PROMPT, maxTokens = 4096 } = {}) {
  if (!PROVIDERS.length) throw new Error('No vision provider key set (OPENROUTER_API_KEY / GEMINI_API_KEY)');
  // Gemini accepts jpeg/png/webp/heic; OpenRouter models accept the same set. Coerce odd types to png
  // (a real mismatch just errors → we fall through to the next provider).
  const mt = /jpe?g|png|webp|gif/i.test(mimeType) ? mimeType.replace('image/jpg', 'image/jpeg') : 'image/png';
  const dataUrl = `data:${mt};base64,${buffer.toString('base64')}`;
  let lastErr;
  for (const prov of PROVIDERS) {
    const body = {
      model: prov.model, temperature: 0, max_tokens: maxTokens, ...(prov.extra || {}),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }],
    };
    // Up to 2 tries per provider: a 429 waits out the minute; a 5xx retries once; then fall through.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(prov.url, {
          method: 'POST', signal: AbortSignal.timeout(120000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${prov.key}`, ...(prov.headers || {}) },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const txt = (await res.text()).slice(0, 160);
          lastErr = new Error(`${prov.name} ${res.status}: ${txt}`);
          if (res.status === 429 && attempt === 0) { await sleep(20000); continue; } // wait out the minute, retry once
          if (res.status >= 500 && attempt === 0) { await sleep(2500); continue; }
          break; // 4xx (quota/auth/model) → next provider
        }
        const data = await res.json();
        const text = (data.choices?.[0]?.message?.content || '').trim();
        if (text) return text;
        lastErr = new Error(`${prov.name}: empty response`);
        break; // empty → next provider
      } catch (e) { lastErr = e; if (attempt === 0) { await sleep(2500); continue; } }
    }
    // fall through to the next provider
  }
  if (lastErr) console.warn('[vision-router] all providers failed:', lastErr.message);
  return '';
}

module.exports = { transcribeImage, VISION_MODEL, buildProviders, DEFAULT_PROMPT };
