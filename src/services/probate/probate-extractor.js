'use strict';

/**
 * Probate hybrid extractor (Phase B of the probate extraction rebuild).
 *
 * Input : a `probate_documents` row (a logical document = ordered set of
 *         `person_documents` image transcripts, produced by document-segmenter.js).
 * Output: a typed extraction written to `will_extractions` —
 *         testator/decedent name, document date, and the inheritance accounting
 *         (heirs, bequests, and especially enslaved/servant people named as assets).
 *
 * Hybrid strategy (per user decision 2026-05-20):
 *   - regex fast-path  — a single-image document with a clean, unambiguous
 *     "Last Will and Testament of X" header and no enslaved-asset language.
 *   - LLM path         — everything else (multi-page, ambiguous, or any document
 *     mentioning enslaved people). Uses a LOCAL open-source model via Ollama
 *     (http://localhost:11434) — no paid API, no account, nothing leaves the box.
 *
 * Ollama + an open-weight model (default qwen2.5:7b) must be running locally:
 *   ollama serve &
 *   ollama pull qwen2.5:7b
 *
 * CLI:
 *   node src/services/probate/probate-extractor.js --county Liberty --limit 20
 *   node src/services/probate/probate-extractor.js --document <probate_documents.id>
 *   node src/services/probate/probate-extractor.js --county Liberty --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// 127.0.0.1, not localhost: Node's fetch may resolve "localhost" to IPv6 ::1
// while Ollama binds IPv4 only, which surfaces as an opaque "fetch failed".
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const EXTRACTOR_VERSION = 'probate-extractor/1.0.0+ollama';

// --- Extraction JSON schema (constrains the local model's output) ----------
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    document_type: {
      type: 'string',
      enum: ['will', 'codicil', 'will_with_codicil', 'estate_inventory',
             'estate_account', 'guardian_account', 'letters', 'other'],
    },
    testator_name: { type: ['string', 'null'] },
    signing_date: { type: ['string', 'null'] },
    recorded_date: { type: ['string', 'null'] },
    document_year: { type: ['integer', 'null'] },
    county: { type: ['string', 'null'] },
    state: { type: ['string', 'null'] },
    enslaved_persons: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'] },
          group_description: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          bequeathed_to: { type: ['string', 'null'] },
        },
        required: ['name'],
      },
    },
    heirs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          relation: { type: ['string', 'null'] },
          bequest: { type: ['string', 'null'] },
        },
        required: ['name'],
      },
    },
    executors: { type: 'array', items: { type: 'string' } },
    witnesses: { type: 'array', items: { type: 'string' } },
    estate_value: { type: ['string', 'null'] },
  },
  required: ['document_type', 'testator_name', 'enslaved_persons', 'heirs'],
};

const SYSTEM_PROMPT = `You extract structured facts from 18th/19th-century Georgia probate records (wills, codicils, estate inventories, estate accounts). The text is machine OCR of handwriting: expect garbled words, embedded page numbers, and noise. Several records may be concatenated — focus on the single will/inventory/account that dominates the text.

Return ONLY JSON matching the schema. Rules:

1. testator_name: the person whose will/estate this is (the decedent). OCR may garble the surname (e.g. "Barnard" as "Banner"); give your best clean reading. null if undeterminable.

2. enslaved_persons is the MOST IMPORTANT field. Scan the ENTIRE text. Enslaved people are human beings treated as property. They appear in MANY forms — capture every one:
   - "I give/bequeath/devise/lend [Name] to [heir]"
   - "[Name] and her children" / "[Name] and her increase" / unnamed groups ("her seven children")
   - "my negro woman/man/girl/boy [Name]", "[Name] a mulatto woman"
   - by trade: "my carpenter man [Name]", "my blacksmith [Name]", "old [Name]"
   - people "included in the lot/portion/share to [heir]" during estate division
   - "the negroes" worked on a plantation or appraised in an inventory
   For each: put the first name in "name" (strip descriptors — "Peggy a mulatto woman" → name "Peggy", description "mulatto woman"). For an unnamed group use name null and fill "group_description". bequeathed_to = the heir who receives them, if stated.
   NEVER list the testator, spouse, children, heirs, executors, or witnesses as enslaved — they are free. A person carrying a surname (esp. the testator's surname) is free family, not enslaved.

3. heirs: free people receiving bequests (spouse, kin, friends, legatees), with relation and bequest when stated.
4. Dates: "YYYY-MM-DD" preferred; a bare year is fine. document_year = signing year.
5. Do not invent. Missing field → null or []. Never output slave-schedule-style "Unknown (age N)" entries — only people actually in THIS document.`;

// One worked example (few-shot) — small models extract far more reliably with it.
const FEWSHOT_USER = `Probate record transcript:

[image 1]
Item I give to my wife Sarah my negro woman Dinah and her two children Tom and Lucy. Item my old carpenter man Cato I give to my son James Reed. In the division of my estate Hannah and her children are to be included in the lot to my daughter Mary. Signed John Reed this 4 May 1840. Witness Henry Polk.`;

const FEWSHOT_ASSISTANT = JSON.stringify({
  document_type: 'will',
  testator_name: 'John Reed',
  signing_date: '1840-05-04',
  recorded_date: null,
  document_year: 1840,
  county: null,
  state: 'Georgia',
  enslaved_persons: [
    { name: 'Dinah', group_description: null, description: 'negro woman', bequeathed_to: 'Sarah Reed' },
    { name: 'Tom', group_description: null, description: 'child of Dinah', bequeathed_to: 'Sarah Reed' },
    { name: 'Lucy', group_description: null, description: 'child of Dinah', bequeathed_to: 'Sarah Reed' },
    { name: 'Cato', group_description: null, description: 'old carpenter man', bequeathed_to: 'James Reed' },
    { name: 'Hannah', group_description: null, description: null, bequeathed_to: 'Mary Reed' },
    { name: null, group_description: "Hannah's children", description: null, bequeathed_to: 'Mary Reed' },
  ],
  heirs: [
    { name: 'Sarah Reed', relation: 'wife', bequest: 'Dinah and her children' },
    { name: 'James Reed', relation: 'son', bequest: 'Cato' },
    { name: 'Mary Reed', relation: 'daughter', bequest: 'Hannah and her children' },
  ],
  executors: [],
  witnesses: ['Henry Polk'],
  estate_value: null,
});

// --- Regex fast-path -------------------------------------------------------
const WILL_HEADER = /last\s+will\s+(?:and|&)\s+testament\s+of\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z.]+){0,3})/i;
const ENSLAVED_LANGUAGE = /\b(negro|negroes|slave|slaves|enslaved|mulatto|bequeath|servant|wench)\b/i;

function regexExtract(text) {
  const m = text.match(WILL_HEADER);
  if (!m) return null;
  // #67: widen 1700–1899 → 1600–1999 so colonial and 20th-c probate years register.
  const years = (text.match(/\b1[6-9]\d{2}\b/g) || []).map(Number);
  return {
    document_type: 'will',
    testator_name: m[1].replace(/\s+/g, ' ').trim(),
    signing_date: null,
    recorded_date: null,
    document_year: years.length ? Math.min(...years) : null,
    county: null,
    state: 'Georgia',
    enslaved_persons: [],
    heirs: [],
    executors: [],
    witnesses: [],
    estate_value: null,
  };
}

/** A document qualifies for the cheap regex path only if it is a single clean
 *  page with an unambiguous will header and no enslaved-asset language. */
function regexEligible(pages, combinedText) {
  return pages.length === 1
    && WILL_HEADER.test(combinedText)
    && !ENSLAVED_LANGUAGE.test(combinedText);
}

// --- OCR cleanup -----------------------------------------------------------
/**
 * FamilySearch "full-text" transcripts are noisy machine OCR: embedded folio
 * numbers, long runs of inventory price columns, stray digits. Stripping that
 * noise gives a small model far less to wade through and shorter input to
 * process. Words (names) are preserved; only number/punctuation noise is cut.
 * 4-digit 17xx/18xx years are kept (they carry dates).
 */
function cleanOcrText(text) {
  return (text || '')
    .replace(/\[image\s+\d+\]/gi, ' ')
    // runs of 3+ numeric/price/table tokens — inventory appraisal columns
    .replace(/(?:[$£]?\d[\d.,]*\s+){3,}/g, ' ')
    // standalone stray digit tokens (folio numbers, item numbers) — keep 17xx/18xx
    .replace(/\b(?!1[78]\d\d\b)\d{1,4}\b/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s{3,}/g, '  ')
    .trim();
}

// --- LLM path (local Ollama) ----------------------------------------------
async function ollamaExtract(rawText) {
  const combinedText = cleanOcrText(rawText);
  const body = {
    model: OLLAMA_MODEL,
    stream: true, // stream so headers arrive at once — CPU inference can exceed
                  // Node fetch's ~5min headers timeout on a non-streamed response
    format: EXTRACTION_SCHEMA,
    options: { temperature: 0, num_ctx: 6144 },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: FEWSHOT_USER },
      { role: 'assistant', content: FEWSHOT_ASSISTANT },
      { role: 'user', content: `Probate record transcript:\n\n${combinedText}` },
    ],
  };
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  // Accumulate the NDJSON stream — each line is {message:{content},done}.
  let content = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const obj = JSON.parse(line);
      if (obj.error) throw new Error(`Ollama: ${obj.error}`);
      if (obj.message && obj.message.content) content += obj.message.content;
    }
  }
  if (!content) throw new Error('Ollama returned no message content');
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`Ollama returned non-JSON: ${content.slice(0, 200)}`);
  }
}

async function ollamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    const names = (data.models || []).map((m) => m.name);
    return names.some((n) => n === OLLAMA_MODEL || n.startsWith(OLLAMA_MODEL.split(':')[0]));
  } catch {
    return false;
  }
}

// --- Document loading + writing -------------------------------------------
async function loadPages(client, personDocumentIds) {
  const res = await client.query(
    `SELECT id, image_number, ocr_text
       FROM person_documents
       WHERE id = ANY($1)
       ORDER BY image_number ASC`,
    [personDocumentIds]
  );
  return res.rows;
}

const MAX_CHARS = 24000; // keep within the model context window

async function extractDocument(client, doc, { dryRun }) {
  const pages = await loadPages(client, doc.person_document_ids);
  const combined = pages
    .map((p) => `[image ${p.image_number}]\n${(p.ocr_text || '').trim()}`)
    .join('\n\n')
    .slice(0, MAX_CHARS);

  let structured;
  let method;
  if (regexEligible(pages, combined)) {
    structured = regexExtract(combined);
    method = 'regex';
  } else {
    structured = await ollamaExtract(combined);
    method = `ollama:${OLLAMA_MODEL}`;
  }

  if (dryRun) return { method, structured, pages: pages.length };

  const rawPages = pages.map((p) => ({
    person_document_id: p.id,
    image_number: p.image_number,
    text: p.ocr_text || '',
  }));

  // document_id must be a valid person_documents FK (NOT NULL) — use the first image.
  await client.query(
    `INSERT INTO will_extractions
       (document_id, probate_document_id, raw_pages_jsonb, structured_extraction_jsonb,
        extractor_version, status)
     VALUES ($1, $2, $3, $4, $5, 'extracted')`,
    [
      pages[0].id, doc.id,
      JSON.stringify(rawPages),
      JSON.stringify({ ...structured, _extraction_method: method }),
      EXTRACTOR_VERSION,
    ]
  );
  return { method, structured, pages: pages.length };
}

async function selectDocuments(client, { documentId, county, collectionKey, limit, reextract }) {
  const where = [];
  const params = [];
  if (documentId) { params.push(documentId); where.push(`pd.id = $${params.length}`); }
  if (collectionKey) { params.push(collectionKey); where.push(`pd.collection_key = $${params.length}`); }
  if (county) { params.push(county); where.push(`pd.county = $${params.length}`); }
  if (!reextract) {
    where.push(`NOT EXISTS (SELECT 1 FROM will_extractions we WHERE we.probate_document_id = pd.id)`);
  }
  let sql = `SELECT pd.id, pd.collection_key, pd.county, pd.document_type,
                    pd.first_image_number, pd.last_image_number, pd.person_document_ids
               FROM probate_documents pd`;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` ORDER BY pd.collection_key, pd.first_image_number`;
  if (limit) { params.push(limit); sql += ` LIMIT $${params.length}`; }
  return (await client.query(sql, params)).rows;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const documentId = opt('--document');
  const county = opt('--county');
  const collectionKey = opt('--collection-key');
  const limit = parseInt(opt('--limit') || '0', 10) || null;
  const dryRun = args.includes('--dry-run');
  const reextract = args.includes('--reextract');

  if (!(await ollamaAvailable())) {
    console.error(`FATAL: Ollama not reachable at ${OLLAMA_URL} with model "${OLLAMA_MODEL}".`);
    console.error(`  Start it:  ollama serve &   then:  ollama pull ${OLLAMA_MODEL}`);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const docs = await selectDocuments(client, { documentId, county, collectionKey, limit, reextract });
    console.log(`${docs.length} document(s) to extract${dryRun ? ' [DRY RUN]' : ''} (model: ${OLLAMA_MODEL}).`);
    let ok = 0, regex = 0, llm = 0, failed = 0;
    for (const doc of docs) {
      try {
        const r = await extractDocument(client, doc, { dryRun });
        ok++;
        if (r.method === 'regex') regex++; else llm++;
        const es = (r.structured.enslaved_persons || []).map((e) => e.name || e.group_description).filter(Boolean);
        console.log(`  ${doc.collection_key} img ${doc.first_image_number}-${doc.last_image_number} `
          + `[${r.method}] testator="${r.structured.testator_name || '?'}" `
          + `type=${r.structured.document_type} enslaved=${es.length}${es.length ? ' (' + es.join(', ') + ')' : ''}`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${doc.collection_key} img ${doc.first_image_number}: ${e.message}`);
      }
    }
    console.log(`Done. ${ok} extracted (${regex} regex, ${llm} llm), ${failed} failed.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
}

module.exports = { regexExtract, regexEligible, cleanOcrText, ollamaExtract, ollamaAvailable, extractDocument, EXTRACTION_SCHEMA };
