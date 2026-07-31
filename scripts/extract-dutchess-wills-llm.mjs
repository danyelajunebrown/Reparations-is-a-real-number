// extract-dutchess-wills-llm.mjs — break the regex parser's 25.5% testator-recovery ceiling using a LOCAL
// LLM (qwen2.5 on ollama) over the ALREADY-OCR'd colonial will text. The retrievability rubric showed
// Dutchess docs are logged+embedded but under-LINKED (regex missed the testator on ~75% of docs); the OCR
// text exists, so this is a text→names problem, not re-OCR — no DocAI/GCP needed. For each unlinked doc:
// LLM extracts {testator, residence, enslaved_named}, we FILTER to true-Dutchess residents (the province-
// wide will books mention many counties — the loose %dutchess% cohort catches Albany docs too), validate
// the name, then LINK via the same path as ingest-dutchess-colonial-wills (findOrCreateLead + doc link +
// owner→enslaved edges). AUDIT: LLM output = secondary tier, requires_human_review; junk/place names declined
// (Biscoe — never minted, never deleted). Runs ON THE MINI (its ollama + 293G). Resumable (skips linked).
//
// Usage: node scripts/extract-dutchess-wills-llm.mjs [--limit N] [--apply]   (dry-run default)

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const A = process.argv.slice(2);
const lm = A.indexOf('--limit'); const LIMIT = lm > -1 ? +A[lm + 1] : 50;
const APPLY = A.includes('--apply');
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const GEN = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace('/api/embeddings', '') + '/api/generate';
const ID_SYSTEM = 'dutchess_colonial_will';
const LOC = 'Dutchess County, New York';
const SOURCE_URL = 'FamilySearch — Dutchess County colonial will books (NY prerogative wills 1629-1802)';

const PLACE_WORDS = /\b(county|precinct|township|town|city|state|york|albany|dutchess|province|manor|estate|deceased|widow|will|inventory|late|the|of|and|negro|slave)\b/i;
function validName(n) {
  const s = (n || '').replace(/\s+/g, ' ').trim();
  if (!s || s.split(' ').length < 2) return false;          // require a full name (Biscoe: single token = decline)
  if (!/[aeiou]/i.test(s.replace(/[^a-z]/gi, ''))) return false;
  if (/^\W|\d/.test(s)) return false;
  const toks = s.split(' ');
  if (toks.every((t) => PLACE_WORDS.test(t))) return false; // all place/boilerplate words
  return s.length <= 60;
}

async function llmExtract(text) {
  const prompt = `You are reading OCR text from a colonial New York (1650-1810) will or estate inventory. The OCR is noisy. Extract ONLY what is explicitly present, as JSON: {"testator":"<full name of the deceased / will-maker, normalized e.g. 'ABBORT, WILLIAM' -> 'William Abbott', or null>","residence_county":"<the county named for the testator, e.g. Dutchess / Albany / Ulster, or null>","enslaved_named":["<given names of enslaved people explicitly named, e.g. from 'Negro Man Jack' -> Jack; [] if none>"]}. Do not invent. Text:\n\n${String(text).slice(0, 3500)}`;
  const r = await fetch(GEN, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, format: 'json', options: { temperature: 0 } }),
    signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error('ollama ' + r.status);
  try { return JSON.parse((await r.json()).response); } catch { return null; }
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const ps = new PersonService(pool);
  const { rows } = await pool.query(
    `SELECT id, left(ocr_text, 3500) AS ocr FROM person_documents
      WHERE ocr_text ILIKE '%dutchess%' AND unconfirmed_person_id IS NULL AND canonical_person_id IS NULL
        AND length(COALESCE(ocr_text,'')) > 300
      ORDER BY id LIMIT $1`, [LIMIT]);
  console.log(`LLM extract: ${rows.length} unlinked Dutchess docs · model=${MODEL}${APPLY ? '' : ' [DRY-RUN]'}`);
  const st = { extracted: 0, dutchess: 0, otherCounty: 0, badName: 0, linked: 0, enslaved: 0, edges: 0, err: 0 };
  for (const d of rows) {
    let ex; try { ex = await llmExtract(d.ocr); } catch (e) { st.err++; continue; }
    if (!ex || !ex.testator) continue;
    st.extracted++;
    const county = (ex.residence_county || '').toLowerCase();
    // FILTER: only treat as Dutchess when the testator's residence is Dutchess (or none given but the doc is);
    // a named OTHER county means this province-book page is that county's, not Dutchess → skip.
    if (county && !county.includes('dutchess')) { st.otherCounty++; continue; }
    if (!validName(ex.testator)) { st.badName++; continue; }
    st.dutchess++;
    console.log(`  doc#${d.id}: ${ex.testator}${ex.enslaved_named?.length ? ' → enslaved: ' + ex.enslaved_named.join(', ') : ''}`);
    if (!APPLY) continue;
    try {
      const er = await ps.findOrCreateLead({
        name: ex.testator, personType: 'enslaver', locations: [LOC], sourceType: 'secondary', confidence: 0.55,
        idSystem: ID_SYSTEM, externalId: `will-llm-${d.id}`, sourceUrl: SOURCE_URL,
        context: `Testator of a Dutchess colonial will (doc ${d.id}); LLM-extracted from OCR${ex.enslaved_named?.length ? '; named as holding: ' + ex.enslaved_named.join(', ') : ''}.`,
        dataQualityFlags: { source_tier: 'secondary', max_evidence_tier: 'secondary', will_doc_id: d.id, extraction: 'colonial_will_llm_' + MODEL, requires_human_review: true },
      }, {});
      if (er.ref) {
        const col = er.ref.subject_table === 'canonical_persons' ? 'canonical_person_id' : 'unconfirmed_person_id';
        await pool.query(`UPDATE person_documents SET ${col}=COALESCE(${col},$2), name_as_appears=CASE WHEN COALESCE(name_as_appears,'') IN ('', 'Image '||COALESCE(collection_page_number::text,'')) THEN $3 ELSE name_as_appears END WHERE id=$1 AND canonical_person_id IS NULL`, [d.id, er.ref.subject_id, ex.testator]);
        st.linked++;
        for (const nm of (ex.enslaved_named || [])) {
          if (!nm || nm.length < 2 || PLACE_WORDS.test(nm)) continue;
          const nr = await ps.findOrCreateLead({ name: nm, personType: 'enslaved', locations: [LOC], sourceType: 'secondary', confidence: 0.55, idSystem: ID_SYSTEM, externalId: `will-llm-${d.id}::${nm}`, sourceUrl: SOURCE_URL, context: `Named as enslaved by ${ex.testator} in Dutchess colonial will (doc ${d.id}); LLM-extracted.`, dataQualityFlags: { source_tier: 'secondary', will_doc_id: d.id, requires_human_review: true, enslaver_name: ex.testator } }, {});
          st.enslaved++;
          if (nr.ref) {
            await pool.query(`INSERT INTO enslaved_owner_relationships (enslaved_name, owner_name, relationship_type, relationship_source, source_url, source_context, source_document_id, confidence_score, verification_status, created_by, enslaved_subject_table, enslaved_subject_id, owner_subject_table, owner_subject_id) VALUES ($1,$2,'enslaved_by','dutchess_colonial_will_llm',$3,$4,$5,0.55,'unverified','wills-llm-ingest',$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
              [nm, ex.testator, SOURCE_URL, `Dutchess will doc ${d.id} (LLM)`, String(d.id), nr.ref.subject_table, nr.ref.subject_id, er.ref.subject_table, er.ref.subject_id]).catch(() => {});
            st.edges++;
          }
        }
        if (ex.enslaved_named?.length) await pool.query(`UPDATE person_documents SET evidences_enslaved_holding=TRUE, enslaved_count=GREATEST(COALESCE(enslaved_count,0),$2) WHERE id=$1`, [d.id, ex.enslaved_named.length]).catch(() => {});
      }
    } catch (e) { st.err++; if (st.err <= 3) console.log(`   link err doc#${d.id}: ${e.message.slice(0, 50)}`); }
  }
  await pool.end();
  console.log(`\n=== ${JSON.stringify(st)} ===`);
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
