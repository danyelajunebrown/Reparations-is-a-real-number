#!/usr/bin/env node
/**
 * Header-driven estate segmentation (v2). The v1 sequential segmenter mis-grouped
 * "Wills, appraisements and bonds" rolls because a decedent's will and their
 * appraisement (which lists the valued enslaved people) sit in SEPARATE sections,
 * and carry-forward stapled appraisement pages onto the wrong decedent.
 *
 * v2: for each page, extract the explicit DECEDENT-OF-RECORD from its section
 * header ("(In)ventory/appraisement/will/estate ... of NAME dec(eased)"), via a
 * regex first and an LLM fallback (cheap, batched, header text only). Pages with
 * no header inherit the current decedent (true continuations). Then GROUP all
 * pages by normalized decedent name across the whole roll — so a decedent's
 * non-contiguous will-run + appraisement-run merge into ONE estate.
 *
 * Writes probate_estate_segments_v2. Runs on the Mac Mini (free LLM router).
 *   node scripts/segment-probate-v2.mjs --roll 9SYT-PT5 [--apply] [--max-pages N]
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const require = createRequire(import.meta.url);
const { PROVIDERS } = require(path.resolve(__dirname, '../src/services/probate/probate-llm-extractor.js'));
const ROLL = (()=>{const i=process.argv.indexOf('--roll');return i>-1?process.argv[i+1]:null;})();
const MAXP = (()=>{const i=process.argv.indexOf('--max-pages');return i>-1?+process.argv[i+1]:null;})();
const APPLY = process.argv.includes('--apply');
const BATCH = 8;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// Regex: explicit decedent header. Captures NAME from "...of NAME dec(eased)" forms.
const HEADER_RE = /(?:will|testament|inventory|appraise?ment|estate|account|administration)[^.]{0,60}?\bof\s+(?:the\s+(?:estate|goods[^.]{0,30}?)\s+of\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,3})\s+(?:dec(?:'d|eased)?|sen|jun|esq|of\b)/i;

// Reject non-name captures ("the said", "the goods and chattels", "any part",
// place names, role words). Require ≥2 capitalized tokens that look like a name.
const BAD = /\b(said|goods|chattels|estate|part|same|aforesaid|county|georgia|liberty|state|deceased|inventory|appraisement|account|will|sum|whole|rest|residue|property|persons?|negro|slaves?|the|and|of)\b/i;
function isPlausibleName(s){
  if(!s) return false;
  const t = s.trim().split(/\s+/);
  if (t.length < 2 || t.length > 4) return false;
  if (BAD.test(s)) return false;
  return t.every(w => /^[A-Z][a-z.']+$/.test(w));
}
function headerName(ocr) {
  const head = (ocr||'').slice(0, 400).replace(/\s+/g,' ');
  const m = head.match(HEADER_RE);
  return (m && isPlausibleName(m[1])) ? m[1].trim() : null;
}

const SYS = `You read the TOP of an OCR'd probate book page and identify the DECEDENT whose estate the page documents. Probate sections open with headers like "Inventory and appraisement of the estate of NAME deceased", "Last will and testament of NAME", "Estate of NAME dec'd in account". Return the decedent's full name if the page STARTS such a section, else null. Reply STRICT JSON.`;

async function llmHeaderNames(pages) {
  if (!PROVIDERS.length) return {};
  const listing = pages.map(p=>`PAGE ${p.idx}: ${(p.ocr||'').slice(0,300).replace(/\s+/g,' ')}`).join('\n\n');
  const body = { messages:[{role:'system',content:SYS},{role:'user',content:`For each page, if it opens a new decedent's estate section, give the decedent name; else null.\nReturn JSON {"pages":[{"idx":number,"decedent":string|null}]}\n\n${listing}`}], temperature:0, max_tokens:1000, response_format:{type:'json_object'} };
  for (const prov of PROVIDERS) {
    try {
      const res = await fetch(prov.url,{method:'POST',headers:{Authorization:`Bearer ${prov.key}`,'Content-Type':'application/json'},body:JSON.stringify({model:prov.model,...body,...prov.extra}),signal:AbortSignal.timeout(60000)});
      if(!res.ok){ if([429,402,403].includes(res.status)) continue; throw new Error(prov.name+' '+res.status); }
      const j=await res.json(); const c=j.choices?.[0]?.message?.content?.replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
      const out={}; for(const p of (JSON.parse(c).pages||[])) out[p.idx]=p.decedent; return out;
    } catch(e){ /* try next provider */ }
  }
  return {};
}

const normName = s => String(s||'').toLowerCase().replace(/\b(mr|mrs|dr|doctr|capt|col|senior|sen|junior|jun|esq|the late|estate of)\b/g,' ').replace(/[^a-z\s]/g,' ').split(/\s+/).filter(w=>w.length>1).sort().join(' ');

(async()=>{
  if(!ROLL){console.error('--roll required');process.exit(1);}
  if(APPLY) await pool.query(`CREATE TABLE IF NOT EXISTS probate_estate_segments_v2 (id serial PRIMARY KEY, roll_group_id text, decedent_name text, decedent_key text, page_image_numbers int[], page_doc_ids int[], page_count int, created_at timestamptz DEFAULT now())`);
  let pages=(await pool.query(`SELECT pd.id doc_id, p.image_number img, pd.ocr_text ocr FROM person_documents pd JOIN probate_scrape_progress p ON p.person_document_id=pd.id WHERE pd.collection_key LIKE '%'||$1||'%' AND p.status='written' ORDER BY p.image_number`,[ROLL])).rows;
  if(MAXP) pages=pages.slice(0,MAXP);
  console.log(`Roll ${ROLL}: ${pages.length} pages. ${APPLY?'APPLY':'DRY'} | providers: ${PROVIDERS.map(p=>p.name).join('>')}\n`);

  // Pass 1: decedent-of-record per page (regex, LLM fallback for uncaught).
  const pageDecedent = new Array(pages.length).fill(null);
  let regexHits=0;
  const needLLM=[];
  for(let i=0;i<pages.length;i++){ const n=headerName(pages[i].ocr); if(n){pageDecedent[i]=n;regexHits++;} else needLLM.push(i); }
  console.log(`regex header names: ${regexHits}/${pages.length}; LLM-checking ${needLLM.length} headerless pages…`);
  for(let b=0;b<needLLM.length;b+=BATCH){
    const idxs=needLLM.slice(b,b+BATCH);
    const out=await llmHeaderNames(idxs.map(i=>({idx:i,ocr:pages[i].ocr})));
    for(const i of idxs) if(out[i] && isPlausibleName(out[i])) pageDecedent[i]=out[i];
    if((b/BATCH)%10===0) console.log(`  …LLM ${Math.min(b+BATCH,needLLM.length)}/${needLLM.length}`);
    await sleep(900);
  }

  // Carry-forward: headerless pages inherit the most recent decedent.
  let cur=null; for(let i=0;i<pages.length;i++){ if(pageDecedent[i]) cur=pageDecedent[i]; else pageDecedent[i]=cur; }

  // Group by normalized decedent name → estates (merges non-contiguous runs).
  const estates=new Map();
  for(let i=0;i<pages.length;i++){ const key=normName(pageDecedent[i]); if(!key)continue; if(!estates.has(key)) estates.set(key,{name:pageDecedent[i],imgs:[],docs:[]}); const e=estates.get(key); e.imgs.push(pages[i].img); e.docs.push(pages[i].doc_id); }
  const list=[...estates.values()];
  console.log(`\n→ ${list.length} estates (avg ${(pages.length/Math.max(list.length,1)).toFixed(1)} pp/estate)`);
  list.sort((a,b)=>b.docs.length-a.docs.length).slice(0,12).forEach(e=>console.log(`  ${e.name} [${e.docs.length}pp]`));

  if(APPLY){
    await pool.query(`DELETE FROM probate_estate_segments_v2 WHERE roll_group_id=$1`,[ROLL]);
    for(const e of list) await pool.query(`INSERT INTO probate_estate_segments_v2 (roll_group_id,decedent_name,decedent_key,page_image_numbers,page_doc_ids,page_count) VALUES ($1,$2,$3,$4,$5,$6)`,[ROLL,e.name,normName(e.name),e.imgs,e.docs,e.docs.length]);
    console.log(`\n✓ wrote ${list.length} v2 segments.`);
  } else console.log('\n(dry run)');
  await pool.end();
})();
