/**
 * Probate LLM extractor — forensic financial + entity extraction from a probate
 * document's OCR text (Cloud Vision output), via the Hugging Face Inference
 * router (OpenAI-compatible chat completions). Replaces the regex
 * probate-entity-extractor.js, which scored 7.7% precision / 9.9% recall on
 * enslaved names and captured almost no financial detail.
 *
 * Produces a structured ESTATE FINANCIAL STATEMENT so the same pass feeds both
 * the lineage/inheritance graph AND the wealth-transfer accounting (M088):
 * chattel (enslaved persons w/ appraised value + kin) vs non-chattel assets
 * (land, livestock, goods, cash, receivables), liabilities, and per-heir
 * bequest allocations.
 *
 * Env: HUGGINGFACE_API_KEY (or HF_TOKEN). Model via PROBATE_LLM_MODEL
 * (default meta-llama/Llama-3.3-70B-Instruct).
 */
const HF_URL = 'https://router.huggingface.co/v1/chat/completions';
const MODEL = process.env.PROBATE_LLM_MODEL || 'meta-llama/Llama-3.3-70B-Instruct';
const TOKEN = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;

const SYSTEM = `You are a forensic archivist extracting structured data from a transcribed 18th–20th century U.S. probate document (will, estate inventory, appraisement, or estate/guardian account). The text is OCR of historical handwriting and may contain errors. Extract ONLY what is explicitly present — never invent names, values, or relationships. Enslaved people appear as first names (sometimes with an age, an appraised dollar value, or a kin note like "Lucy his wife"); record their names exactly as written, including descriptors. Distinguish CHATTEL (enslaved humans) from NON-CHATTEL assets (land/acreage, livestock, crops, tools, household goods, cash, notes/bonds receivable). Output STRICT JSON only.`;

function buildUserPrompt(ocr) {
  return `Extract this probate document into the JSON schema below. Use null/empty arrays when a field is absent. Dollar values as numbers (no $ or commas).

SCHEMA:
{
  "testator": string|null,            // the deceased / estate owner
  "document_type": "will"|"inventory"|"appraisement"|"estate_account"|"guardian_account"|"other",
  "year": number|null,
  "enslaved_persons": [ { "name": string, "age": number|null, "appraised_value_usd": number|null, "kin_relation": string|null } ],
  "non_chattel_assets": [ { "description": string, "category": "land"|"livestock"|"crop"|"tool"|"household"|"cash"|"receivable"|"other", "quantity": string|null, "value_usd": number|null } ],
  "liabilities": [ { "description": string, "creditor": string|null, "amount_usd": number|null } ],
  "heirs": [ { "name": string, "relation": string|null, "bequest": string|null } ],   // bequest = plain-text of what they receive
  "estate_totals": { "total_appraised_value_usd": number|null, "enslaved_value_usd": number|null, "non_chattel_value_usd": number|null }
}

OCR TEXT:
"""
${ocr.slice(0, 12000)}
"""

Return only the JSON object.`;
}

async function extractEstate(ocr, { retries = 2 } = {}) {
  if (!TOKEN) throw new Error('HUGGINGFACE_API_KEY / HF_TOKEN not set');
  if (!ocr || ocr.trim().length < 20) return null;
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUserPrompt(ocr) }],
    temperature: 0,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(HF_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) { lastErr = new Error(`HF ${res.status}: ${(await res.text()).slice(0, 200)}`);
        if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        throw lastErr; }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) { lastErr = new Error('empty completion'); continue; }
      // Strip code fences if the model added them despite json mode.
      const clean = content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

module.exports = { extractEstate, MODEL };
