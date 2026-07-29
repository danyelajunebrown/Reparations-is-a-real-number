// End-to-end scorecard using ESTATE SEGMENTS. For each ground-truth will, find
// its estate segment (probate_estate_segments), assemble ALL the estate's pages,
// run the 70B extractor on the complete estate, and score enslaved-name P/R.
// This is the real test the single-page scorecard couldn't do — it measures the
// full pipeline (segmentation + extraction) on complete estate files.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs'); const pg = require('pg');
const { extractEstate, MODEL } = require('../src/services/probate/probate-llm-extractor.js');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ROLL = (()=>{const i=process.argv.indexOf('--roll');return i>-1?process.argv[i+1]:'9SYT-PT5';})();
const LIMIT = (()=>{const i=process.argv.indexOf('--limit');return i>-1?+process.argv[i+1]:null;})();

const norm = s => String(s).replace(/\[[^\]]*\]/g,' ').replace(/\?/g,' ').replace(/\b(old|little|big|young|infant)\b/gi,' ').replace(/\band\b.*$/i,' ').replace(/\(.*?\)/g,' ').trim().toLowerCase().split(/\s+/)[0]||'';
const toks = s => String(s).toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/).filter(w=>w.length>2);

(async () => {
  const gt = JSON.parse(fs.readFileSync(require('path').resolve(__dirname,'../tests/fixtures/probate/liberty/antebellum-wills-index.json'),'utf8'));
  let wills = gt.records.filter(r=>(r.enslaved_named||[]).length>0);
  if (LIMIT) wills = wills.slice(0, LIMIT);
  const segs = (await pool.query(`SELECT id, decedent_name, page_doc_ids FROM probate_estate_segments WHERE roll_group_id=$1`, [ROLL])).rows;
  console.log(`model ${MODEL} | ${wills.length} GT wills vs ${segs.length} estate segments in roll ${ROLL}\n`);

  // match a GT testator to a segment by shared name tokens (OCR-noise tolerant)
  function matchSeg(testator) {
    const gtoks = new Set(toks(testator));
    let best=null, bestScore=0;
    for (const s of segs) {
      const stoks = toks(s.decedent_name||'');
      const overlap = stoks.filter(t=>gtoks.has(t)).length;
      if (overlap > bestScore) { bestScore=overlap; best=s; }
    }
    return bestScore >= 2 ? best : null;   // require >=2 shared name tokens (first+last)
  }

  let matched=0, TP=0, FP=0, FN=0; const rows=[];
  for (const w of wills) {
    const seg = matchSeg(w.testator);
    if (!seg) { rows.push({testator:w.testator.slice(0,22), seg:false, gt:w.enslaved_named.length}); continue; }
    matched++;
    const docs = (await pool.query(`SELECT ocr_text FROM person_documents WHERE id = ANY($1) ORDER BY id`, [seg.page_doc_ids])).rows;
    const ocr = docs.map(d=>d.ocr_text).filter(Boolean).join('\n');
    let est;
    try {
      // Hard per-estate ceiling so a wedged fetch can never hang the run.
      est = await Promise.race([
        extractEstate(ocr, { decedent: seg.decedent_name, retries: 2 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("estate-timeout-60s")), 60000)),
      ]);
    } catch(e){ rows.push({testator:w.testator.slice(0,18), seg:true, err:e.message.slice(0,22)}); await new Promise(r=>setTimeout(r,22000)); continue; }
    await new Promise(r => setTimeout(r, 3000)); // pace under Groq 70B free TPM (~12K tok/min, ~4K/call)
    const extracted=new Set((est?.enslaved_persons||[]).map(p=>norm(p.name)).filter(Boolean));
    const truth=new Set(w.enslaved_named.map(norm).filter(Boolean));
    let tp=0,fn=0; for(const t of truth)(extracted.has(t)?tp++:fn++);
    const fp=[...extracted].filter(e=>!truth.has(e)).length;
    TP+=tp;FN+=fn;FP+=fp;
    rows.push({testator:w.testator.slice(0,18), seg:true, pages:seg.page_doc_ids.length, gt:truth.size, found:tp, missed:fn, extra:fp,
      nonChattel:(est?.non_chattel_assets||[]).length, totalUSD:est?.estate_totals?.total_appraised_value_usd||null});
  }
  const prec=TP/(TP+FP)||0, rec=TP/(TP+FN)||0;
  console.log('===== SEGMENTED (END-TO-END) SCORECARD =====');
  console.log(`Segment match: ${matched}/${wills.length} GT wills matched an estate segment (${(100*matched/wills.length).toFixed(0)}%)`);
  console.log(`Enslaved names on matched estates: TP=${TP} FN=${FN} FP=${FP}`);
  console.log(`  PRECISION ${(100*prec).toFixed(1)}%   RECALL ${(100*rec).toFixed(1)}%`);
  console.table(rows.filter(r=>r.seg).slice(0,18));
  await pool.end();
})();
