// Segmentation-aware scorecard for the LLM probate extractor.
// For each ground-truth will, locate its pages via the scraper's per-page
// testator_name (both name tokens present), feed ONLY those pages to the LLM
// extractor, and score enslaved-name precision/recall. Separates segmentation
// coverage (can we even find the will's pages?) from extraction quality.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs'); const pg = require('pg');
const { extractEstate, MODEL } = require('../src/services/probate/probate-llm-extractor.js');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const LIMIT = (()=>{const i=process.argv.indexOf('--limit');return i>-1?+process.argv[i+1]:null;})();
const CONC = 4;
const norm = s => String(s).replace(/\[[^\]]*\]/g,' ').replace(/\?/g,' ').replace(/\b(old|little|big|young|infant)\b/gi,' ').replace(/\band\b.*$/i,' ').replace(/\(.*?\)/g,' ').trim().toLowerCase().split(/\s+/)[0]||'';

async function pageOcrFor(first, last) {
  // pages the scraper tagged with this testator (both tokens), join their OCR
  const r = await pool.query(`
    SELECT pd.ocr_text FROM probate_scrape_progress p
    JOIN person_documents pd ON pd.id = p.person_document_id
    WHERE p.testator_name ILIKE '%'||$1||'%' AND p.testator_name ILIKE '%'||$2||'%'
    LIMIT 6`, [first, last]);
  return r.rows.map(x=>x.ocr_text).filter(Boolean).join('\n');
}
async function mapLimit(items, n, fn){const out=[];let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k]).catch(e=>({error:e.message}));}}));return out;}

(async () => {
  const gt = JSON.parse(fs.readFileSync(require('path').resolve(__dirname,'../tests/fixtures/probate/liberty/antebellum-wills-index.json'),'utf8'));
  let wills = gt.records.filter(r=>(r.enslaved_named||[]).length>0);
  if (LIMIT) wills = wills.slice(0, LIMIT);
  console.log(`model: ${MODEL} | scoring ${wills.length} wills (conc ${CONC})\n`);
  let segFound=0, segMiss=0, TP=0, FP=0, FN=0; const rows=[];
  await mapLimit(wills, CONC, async (w) => {
    const parts=w.testator.split(/\s+/); const first=parts[0], last=parts[parts.length-1];
    const ocr = await pageOcrFor(first, last);
    if (!ocr || ocr.length<40){ segMiss++; rows.push({testator:w.testator.slice(0,22),seg:false,gt:w.enslaved_named.length}); return; }
    segFound++;
    let est; try { est = await extractEstate(ocr); } catch(e){ rows.push({testator:w.testator.slice(0,22),seg:true,err:e.message.slice(0,20)}); return; }
    const extracted=new Set((est?.enslaved_persons||[]).map(p=>norm(p.name)).filter(Boolean));
    const truth=new Set(w.enslaved_named.map(norm).filter(Boolean));
    let tp=0,fn=0; for(const t of truth)(extracted.has(t)?tp++:fn++);
    const fp=[...extracted].filter(e=>!truth.has(e)).length;
    TP+=tp;FN+=fn;FP+=fp;
    rows.push({testator:w.testator.slice(0,20),seg:true,gt:truth.size,found:tp,missed:fn,extra:fp,nonChattel:(est?.non_chattel_assets||[]).length});
  });
  const prec=TP/(TP+FP)||0, rec=TP/(TP+FN)||0;
  console.log('===== LLM EXTRACTOR SCORECARD =====');
  console.log(`Segmentation: ${segFound} wills located via scraper testator tag, ${segMiss} not found (${(100*segFound/wills.length).toFixed(0)}% coverage)`);
  console.log(`Enslaved names on located wills:  TP=${TP} FN=${FN} FP=${FP}`);
  console.log(`  PRECISION ${(100*prec).toFixed(1)}%   RECALL ${(100*rec).toFixed(1)}%`);
  console.table(rows.filter(r=>r.seg).slice(0,15));
  await pool.end();
})();
