// Financial-extraction quality probe (no external GT — uses internal reconciliation).
// For appraisement/inventory estates: extract, then check (a) how many enslaved
// get dollar valuations, (b) whether the extracted estate total appears in the OCR
// (reconciliation), (c) non-chattel asset capture. The forensic-accounting payload.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pg=require('pg'); const { extractEstate } = require('../src/services/probate/probate-llm-extractor.js');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const N=(()=>{const i=process.argv.indexOf('--n');return i>-1?+process.argv[i+1]:12;})();
(async()=>{
  // appraisement/inventory estates: OCR mentions appraisement/inventory + has $ figures
  const segs=(await pool.query(`SELECT s.decedent_name, s.page_doc_ids FROM probate_estate_segments_v2 s
    WHERE s.roll_group_id='9SYT-PT5' AND s.page_count BETWEEN 1 AND 4
      AND EXISTS (SELECT 1 FROM person_documents pd WHERE pd.id=ANY(s.page_doc_ids) AND pd.ocr_text ILIKE '%appraise%')
    ORDER BY s.page_count DESC LIMIT $1`,[N])).rows;
  let estates=0, withVals=0, totalEnslaved=0, valuedEnslaved=0, reconciled=0, nonChattel=0;
  const rows=[];
  for(const seg of segs){
    const docs=(await pool.query(`SELECT ocr_text FROM person_documents WHERE id=ANY($1) ORDER BY id`,[seg.page_doc_ids])).rows;
    const ocr=docs.map(d=>d.ocr_text).filter(Boolean).join('\n');
    let est; try{est=await extractEstate(ocr,{decedent:seg.decedent_name});}catch(e){rows.push({d:seg.decedent_name.slice(0,18),err:e.message.slice(0,16)});continue;}
    estates++;
    const ep=est.enslaved_persons||[]; const valued=ep.filter(p=>p.appraised_value_usd).length;
    totalEnslaved+=ep.length; valuedEnslaved+=valued; nonChattel+=(est.non_chattel_assets||[]).length;
    if(valued>0) withVals++;
    // reconciliation: extracted total present as a number in the OCR?
    const tot=est.estate_totals?.total_appraised_value_usd;
    const ocrNums=ocr.replace(/[^0-9]/g,' ');
    const rec = tot && (ocrNums.includes(' '+Math.round(tot)+' ')||ocrNums.includes(' '+Math.round(tot)));
    if(rec) reconciled++;
    rows.push({d:seg.decedent_name.slice(0,18), enslaved:ep.length, valued, nonChattel:(est.non_chattel_assets||[]).length, total:tot||null, recon:rec?'Y':''});
    await new Promise(r=>setTimeout(r,1200));
  }
  console.log(`\n=== FINANCIAL EXTRACTION QUALITY (${estates} appraisement estates) ===`);
  console.log(`estates with ≥1 valued enslaved: ${withVals}/${estates}`);
  console.log(`enslaved extracted: ${totalEnslaved} | with $ value: ${valuedEnslaved} (${(100*valuedEnslaved/Math.max(totalEnslaved,1)).toFixed(0)}%)`);
  console.log(`non-chattel assets extracted: ${nonChattel}`);
  console.log(`estate total reconciled to OCR: ${reconciled}/${estates}`);
  console.table(rows);
  await pool.end();
})();
