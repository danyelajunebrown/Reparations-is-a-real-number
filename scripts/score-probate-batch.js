// Batch end-to-end scorecard: match each ground-truth will to its estate segment,
// assemble the estate's pages, BATCH N estates per LLM call (multi-provider
// router), and score enslaved-name precision/recall. Measures the full pipeline
// (segmentation + batched extraction) and reports throughput (calls, provider mix).
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs'); const pg = require('pg');
const { extractEstatesBatch, PROVIDERS } = require('../src/services/probate/probate-llm-extractor.js');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ROLL = (()=>{const i=process.argv.indexOf('--roll');return i>-1?process.argv[i+1]:'9SYT-PT5';})();
const LIMIT = (()=>{const i=process.argv.indexOf('--limit');return i>-1?+process.argv[i+1]:null;})();
const BATCH = (()=>{const i=process.argv.indexOf('--batch');return i>-1?+process.argv[i+1]:6;})();

const norm = s => String(s).replace(/\[[^\]]*\]/g,' ').replace(/\?/g,' ').replace(/\b(old|little|big|young|infant)\b/gi,' ').replace(/\band\b.*$/i,' ').replace(/\(.*?\)/g,' ').trim().toLowerCase().split(/\s+/)[0]||'';
const toks = s => String(s).toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/).filter(w=>w.length>2);

(async () => {
  const gt = JSON.parse(fs.readFileSync(require('path').resolve(__dirname,'../tests/fixtures/probate/liberty/antebellum-wills-index.json'),'utf8'));
  let wills = gt.records.filter(r=>(r.enslaved_named||[]).length>0);
  if (LIMIT) wills = wills.slice(0, LIMIT);
  const segs = (await pool.query(`SELECT id, decedent_name, page_doc_ids FROM probate_estate_segments WHERE roll_group_id=$1`, [ROLL])).rows;
  console.log(`providers: ${PROVIDERS.map(p=>p.name+':'+p.model).join(' > ')}`);
  console.log(`${wills.length} GT wills | ${segs.length} segments | batch size ${BATCH}\n`);

  function matchSeg(testator){ const g=new Set(toks(testator)); let best=null,bs=0; for(const s of segs){const o=toks(s.decedent_name||'').filter(t=>g.has(t)).length; if(o>bs){bs=o;best=s;}} return bs>=2?best:null; }

  // assemble matched estates
  const items = [];
  for (const w of wills) {
    const seg = matchSeg(w.testator);
    if (!seg) continue;
    const docs = (await pool.query(`SELECT ocr_text FROM person_documents WHERE id=ANY($1) ORDER BY id`, [seg.page_doc_ids])).rows;
    items.push({ will:w, decedent: seg.decedent_name, ocr: docs.map(d=>d.ocr_text).filter(Boolean).join('\n') });
  }
  console.log(`Matched ${items.length}/${wills.length} GT wills to segments (${(100*items.length/wills.length).toFixed(0)}%)`);

  let TP=0,FP=0,FN=0, calls=0; const provCount={}; const rows=[];
  for (let i=0;i<items.length;i+=BATCH) {
    const chunk = items.slice(i, i+BATCH).map((it,k)=>({ id:i+k, decedent: it.decedent, ocr: it.ocr }));
    let out;
    try { out = await extractEstatesBatch(chunk); } catch(e){ console.log(`  batch @${i} failed: ${e.message.slice(0,80)}`); continue; }
    calls++; provCount[out.provider]=(provCount[out.provider]||0)+1;
    const byId = new Map((out.results||[]).map(r=>[r.id, r]));
    for (let k=0;k<chunk.length;k++){
      const it = items[i+k]; const r = byId.get(i+k);
      const extracted = new Set((r?.enslaved_persons||[]).map(p=>norm(p.name)).filter(Boolean));
      const truth = new Set(it.will.enslaved_named.map(norm).filter(Boolean));
      let tp=0,fn=0; for(const t of truth)(extracted.has(t)?tp++:fn++);
      const fp=[...extracted].filter(e=>!truth.has(e)).length;
      TP+=tp;FN+=fn;FP+=fp;
      rows.push({testator:it.will.testator.slice(0,20), gt:truth.size, found:tp, missed:fn, extra:fp, nonChattel:(r?.non_chattel_assets||[]).length});
    }
    await new Promise(r=>setTimeout(r, 1000)); // light pace
  }
  const prec=TP/(TP+FP)||0, rec=TP/(TP+FN)||0;
  console.log(`\n===== BATCH SCORECARD =====`);
  console.log(`LLM calls: ${calls} (for ${items.length} estates → ${(items.length/Math.max(calls,1)).toFixed(1)} estates/call) | provider mix: ${JSON.stringify(provCount)}`);
  console.log(`Enslaved names: TP=${TP} FN=${FN} FP=${FP}`);
  console.log(`  PRECISION ${(100*prec).toFixed(1)}%   RECALL ${(100*rec).toFixed(1)}%`);
  console.table(rows.slice(0,20));
  await pool.end();
})();
