/**
 * Probate LLM extractor — forensic financial + entity extraction from probate
 * OCR (Cloud Vision), with a multi-provider free-tier router and BATCH prompting
 * (many estates per request) to stay within free quotas at scale.
 *
 * Two cost levers (see project memory: sustainable per-county extraction):
 *   1. Batch prompting — pack N estates into one request. Slashes request count
 *      on request-limited free tiers (Gemini: 1,500 req/day) and amortizes the
 *      shared system prompt on token-limited ones (Cerebras 1M tok/day, Groq).
 *   2. Provider router — try providers in order; on 429/quota fall through to the
 *      next. Pooled free tiers ≈ one county/day at $0.
 *
 * All providers are OpenAI-compatible chat-completions. Keys in .env:
 *   GEMINI_API_KEY, CEREBRAS_API_KEY, GROQ_API_KEY.
 */

// Provider pool, tried in order. Gemini first: request-rich (1,500/day, 1M TPM),
// ideal for big batches. Cerebras next: 1M tok/day, very fast. Groq last: overflow.
function buildProviders() {
  const p = [];
  // OpenRouter first ($10 deposit → 1,000 :free req/day; pooled strong models).
  // Llama-70B:free = best quality when its upstream isn't rate-limited; gpt-oss-120b:free
  // = reliable workhorse (strong on financial/appraisement extraction). 429s fall through.
  if (process.env.OPENROUTER_API_KEY) {
    const orHdr = { 'HTTP-Referer': 'https://reparations.local', 'X-Title': 'reparations-probate' };
    for (const m of ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-120b:free']) {
      p.push({ name: `openrouter(${m.split('/')[1].replace(':free','')})`, url: 'https://openrouter.ai/api/v1/chat/completions',
        key: process.env.OPENROUTER_API_KEY, model: m, extra: {}, headers: orHdr });
    }
  }
  if (process.env.GEMINI_API_KEY) p.push({
    name: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    extra: { reasoning_effort: 'none' }, // Gemini 2.5 is a thinking model — disable, or it burns the token budget and truncates JSON
  });
  if (process.env.CEREBRAS_API_KEY) p.push({
    name: 'cerebras', url: 'https://api.cerebras.ai/v1/chat/completions',
    key: process.env.CEREBRAS_API_KEY, model: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
    extra: { reasoning_effort: 'low' },
  });
  if (process.env.GROQ_API_KEY) p.push({
    name: 'groq', url: process.env.PROBATE_LLM_URL || 'https://api.groq.com/openai/v1/chat/completions',
    key: process.env.GROQ_API_KEY, model: process.env.PROBATE_LLM_MODEL || 'llama-3.3-70b-versatile', extra: {},
  });
  // PROBATE_PROVIDERS=cerebras,gemini restricts/reorders the pool (for bake-offs).
  const order = (process.env.PROBATE_PROVIDERS || '').split(',').map(s=>s.trim()).filter(Boolean);
  if (order.length) return order.map(n => p.find(x => x.name === n)).filter(Boolean);
  return p;
}
const PROVIDERS = buildProviders();
const MODEL = PROVIDERS.length ? `${PROVIDERS[0].name}:${PROVIDERS[0].model}` : 'none';

const SYSTEM = `You are a forensic archivist extracting structured data from transcribed 18th-20th century U.S. probate documents (wills, estate inventories, appraisements, estate/guardian accounts). The OCR may contain errors and appraisements are often two-column with a name and its dollar value separated — pair each enslaved person with the dollar amount appraised against THEM. Extract ONLY what is explicitly present — never invent names, values, or relationships. Enslaved people appear as first names (sometimes with age, an appraised dollar value, or a kin note like "Lucy his wife", or a bequest "to my wife Ann"); record names exactly as written. When a will or division record says an enslaved person goes to a named heir, record that heir as bequeathed_to. Distinguish CHATTEL (enslaved humans) from NON-CHATTEL assets (land/acreage, livestock, crops, tools, household goods, cash, notes/bonds receivable). Output STRICT JSON only.`;

const ESTATE_SCHEMA = `{
  "testator": string|null,
  "document_type": "will"|"inventory"|"appraisement"|"estate_account"|"guardian_account"|"other",
  "year": number|null,
  "enslaved_persons": [ { "name": string, "age": number|null, "appraised_value_usd": number|null, "kin_relation": string|null, "bequeathed_to": string|null } ],
  "non_chattel_assets": [ { "description": string, "category": "land"|"livestock"|"crop"|"tool"|"household"|"cash"|"receivable"|"other", "quantity": string|null, "value_usd": number|null } ],
  "liabilities": [ { "description": string, "creditor": string|null, "amount_usd": number|null } ],
  "heirs": [ { "name": string, "relation": string|null, "bequest": string|null } ],
  "monetary_bequests": [ { "beneficiary": string, "amount_usd": number|null, "form": string|null } ],
  "estate_totals": { "total_appraised_value_usd": number|null, "enslaved_value_usd": number|null, "non_chattel_value_usd": number|null }
}`;

// Guidance appended to every extraction prompt — drives the (1) quality fixes.
const FIELD_RULES = `RULES:
- estate_totals.total_appraised_value_usd: use the document's STATED grand total if present (e.g. "Total amount $7340", "amounting to $..."). If no total is stated, sum all appraised values you extracted.
- estate_totals.enslaved_value_usd: sum of enslaved_persons[].appraised_value_usd (null if none have values).
- bequeathed_to: the heir who receives this enslaved person, when a will/division states it; else null.
- monetary_bequests: cash/legacy bequests of dollar amounts to named people (wills only).`;

function singlePrompt(ocr, decedent) {
  const focus = decedent ? `\nFOCAL DECEDENT: "${decedent}". This OCR is an assembled estate file and may include stray lines bleeding in from an ADJACENT decedent. Extract ONLY ${decedent}'s estate; exclude anyone clearly tied to a different decedent.\n` : '';
  return `Extract this probate document into the JSON schema below. null/empty when absent; dollar values as plain numbers.${focus}\nSCHEMA:\n${ESTATE_SCHEMA}\n\n${FIELD_RULES}\n\nOCR:\n"""\n${ocr.slice(0, 12000)}\n"""\n\nReturn only the JSON object.`;
}

// Batch prompt: many estates → one request. Returns {"results":[{id, ...estate}]}.
function batchPrompt(estates) {
  const blocks = estates.map(e =>
    `=== ESTATE id=${e.id}${e.decedent ? ` decedent="${e.decedent}"` : ''} ===\n${(e.ocr || '').slice(0, 6000)}`
  ).join('\n\n');
  return `Below are ${estates.length} separate probate estate files, each delimited by "=== ESTATE id=... ===". Extract EACH independently into the schema. Keep estates separate — never merge people or assets across estates; attribute each to its own decedent.\n\nSCHEMA (per estate):\n${ESTATE_SCHEMA}\n\n${FIELD_RULES}\n\nReturn STRICT JSON: {"results":[{"id": <the estate id>, ...schema fields}]} with one entry per estate, ids matching exactly.\n\n${blocks}`;
}

async function callLLM(userContent, { maxTokens = 4000 } = {}) {
  if (!PROVIDERS.length) throw new Error('No LLM provider key set (GEMINI_API_KEY / CEREBRAS_API_KEY / GROQ_API_KEY)');
  let lastErr;
  for (const prov of PROVIDERS) {
    const body = {
      model: prov.model,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent }],
      temperature: 0, max_tokens: maxTokens, response_format: { type: 'json_object' }, ...prov.extra,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(prov.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${prov.key}`, 'Content-Type': 'application/json', ...(prov.headers || {}) },
          body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
        });
        if (!res.ok) {
          const txt = (await res.text()).slice(0, 160);
          // Quota/rate exhausted on this provider → fall through to the next one.
          if (res.status === 429 || res.status === 402 || res.status === 403) { lastErr = new Error(`${prov.name} ${res.status}: ${txt}`); break; }
          if (res.status >= 500) { lastErr = new Error(`${prov.name} ${res.status}`); await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
          throw new Error(`${prov.name} ${res.status}: ${txt}`);
        }
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) { lastErr = new Error(`${prov.name} empty`); break; }
        const clean = content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        return { json: JSON.parse(clean), provider: prov.name, usage: data.usage };
      } catch (e) { lastErr = e; if (attempt < 2) await new Promise(r => setTimeout(r, 1200 * (attempt + 1))); }
    }
  }
  throw lastErr || new Error('all providers failed');
}

// Single estate (back-compat). decedent constrains extraction to the focal estate.
async function extractEstate(ocr, { decedent = null } = {}) {
  if (!ocr || ocr.trim().length < 20) return null;
  const { json } = await callLLM(singlePrompt(ocr, decedent), { maxTokens: 4000 });
  return json;
}

// Batch: estates = [{id, decedent, ocr}] → [{id, ...estate}] (order not guaranteed; match by id).
async function extractEstatesBatch(estates, { maxTokens } = {}) {
  const usable = estates.filter(e => e.ocr && e.ocr.trim().length >= 20);
  if (!usable.length) return [];
  const { json, provider, usage } = await callLLM(batchPrompt(usable), { maxTokens: maxTokens || Math.min(16000, 1200 * usable.length + 1000) });
  const results = Array.isArray(json?.results) ? json.results : (Array.isArray(json) ? json : []);
  return { results, provider, usage };
}

module.exports = { extractEstate, extractEstatesBatch, callLLM, MODEL, PROVIDERS };
