/**
 * Source-type extraction registry — the FREE analog of a custom DocAI processor per source type.
 *
 * User directive (2026-08-08): "doc ai is the way [but] no paid." DocAI's VALUE is the per-source-type
 * structured extractor (a defined schema + a model that pulls typed fields, e.g. Freedmen's field 21 = last
 * master, 22 = depositor). We reproduce that DESIGN with FREE execution: a per-source-type schema + system
 * prompt, run over ocr_text by the existing free multi-provider LLM router (probate-llm-extractor.callLLM;
 * probate/wills reuse extractEstate wholesale). One place where text→typed-fields happens for ALL sources.
 *
 * detectSourceType(s3Key, collectionKey) picks the handler; REGISTRY[type].extract(ocr) → structured JSON;
 * REGISTRY[type].count(fields) → number of named persons (for validation/monitoring). NO model output is
 * summed or promoted here — this only produces the typed rows; gated promoters turn them into persons.
 */

const { extractEstate, callLLM } = require('../probate/probate-llm-extractor');

function detectSourceType(s3Key = '', collectionKey = '') {
  const s = `${s3Key} ${collectionKey}`.toLowerCase();
  if (/freedmen/.test(s)) return 'freedmens';
  if (/probate|appraise|inventory|estate/.test(s)) return 'probate';
  if (/\bwill\b|wills/.test(s)) return 'will';
  if (/census|slave.?schedule|18[0-9]0/.test(s)) return 'census_slave_schedule';
  return 'generic';
}

// ── Freedmen's Savings Bank depositor registration (the 26-field schema, condensed) ──────────────────────
const FREEDMENS_SYSTEM =
  "You are a forensic archivist extracting structured data from a transcribed Freedmen's Savings & Trust Co. " +
  'depositor registration (1865-1874). These forms record a formerly-enslaved depositor AND — critically — the ' +
  'name of their LAST MASTER/MISTRESS (the enslaver who held them at emancipation), the plantation, and family ' +
  'members. Extract ONLY values explicitly present; never invent. Output STRICT JSON only.';
const FREEDMENS_SCHEMA = `{
  "depositor_name": string|null, "account_number": string|null, "date_of_entry": string|null,
  "age": number|null, "complexion": string|null, "occupation": string|null, "residence": string|null,
  "birthplace": string|null, "where_brought_up": string|null,
  "last_master": string|null, "last_mistress": string|null, "plantation": string|null,
  "slave_residence": string|null, "old_title": string|null,
  "marital_status": string|null, "spouse_name": string|null,
  "father_name": string|null, "mother_name": string|null,
  "siblings_names": [string], "children_names": [string], "remarks": string|null
}`;
function freedmensPrompt(ocr) {
  return `Extract this Freedmen's Bank depositor form into the JSON schema. null when a field is absent.\n` +
    `SCHEMA:\n${FREEDMENS_SCHEMA}\n\nOCR:\n"""\n${ocr.slice(0, 12000)}\n"""\n\nReturn only the JSON object.`;
}

// ── Generic named-person extraction (census schedules, misc records) ─────────────────────────────────────
const GENERIC_SYSTEM =
  'You are a forensic archivist extracting the named PEOPLE and their roles from a transcribed 18th-20th ' +
  'century U.S. historical document. Distinguish ENSLAVERS (owners, testators, masters, heads-of-household on ' +
  'a slave schedule) from ENSLAVED persons (held, bequeathed, appraised as chattel, listed under an owner). ' +
  'Extract ONLY names explicitly present; never invent. Output STRICT JSON only.';
const GENERIC_SCHEMA = `{
  "doc_type": string, "place": string|null, "year": number|null,
  "persons": [ { "name": string, "role": string|null, "person_type": "enslaver"|"enslaved"|"descendant"|"unknown" } ]
}`;
function genericPrompt(ocr) {
  return `Extract this document into the JSON schema. Only real names explicitly present.\n` +
    `SCHEMA:\n${GENERIC_SCHEMA}\n\nOCR:\n"""\n${ocr.slice(0, 12000)}\n"""\n\nReturn only the JSON object.`;
}

const nonEmpty = (v) => (Array.isArray(v) ? v.length : (v ? 1 : 0));

const REGISTRY = {
  freedmens: {
    extract: async (ocr) => (await callLLM(freedmensPrompt(ocr), { system: FREEDMENS_SYSTEM, maxTokens: 2000 })).json,
    // people this form documents: the depositor (enslaved) + last master/mistress (enslaver) + named kin
    count: (f) => nonEmpty(f?.depositor_name) + nonEmpty(f?.last_master) + nonEmpty(f?.last_mistress)
      + nonEmpty(f?.spouse_name) + nonEmpty(f?.father_name) + nonEmpty(f?.mother_name)
      + nonEmpty(f?.siblings_names) + nonEmpty(f?.children_names),
  },
  // Probate + wills reuse the forensic estate extractor wholesale (already bakeoff-validated on financials).
  probate: {
    extract: async (ocr) => await extractEstate(ocr),
    count: (f) => nonEmpty(f?.enslaved_persons) + nonEmpty(f?.testator) + nonEmpty(f?.heirs),
  },
  will: {
    extract: async (ocr) => await extractEstate(ocr),
    count: (f) => nonEmpty(f?.enslaved_persons) + nonEmpty(f?.testator) + nonEmpty(f?.heirs),
  },
  census_slave_schedule: {
    extract: async (ocr) => (await callLLM(genericPrompt(ocr), { system: GENERIC_SYSTEM, maxTokens: 3000 })).json,
    count: (f) => nonEmpty(f?.persons),
  },
  generic: {
    extract: async (ocr) => (await callLLM(genericPrompt(ocr), { system: GENERIC_SYSTEM, maxTokens: 2500 })).json,
    count: (f) => nonEmpty(f?.persons),
  },
};

module.exports = { detectSourceType, REGISTRY };
