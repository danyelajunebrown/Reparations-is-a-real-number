// Recall-loss diagnosis (no LLM). For each ground-truth will, assemble its
// estate segment's OCR and check how many GT enslaved names LITERALLY appear in
// that OCR. This separates the two failure modes:
//   - name NOT in segment OCR  → SEGMENTATION loss (wrong pages grouped) — the
//     extractor can never recover it; this is the recall ceiling.
//   - name IN segment OCR but the LLM missed it → EXTRACTION loss (fix prompt/model).
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs'); const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ROLL = (()=>{const i=process.argv.indexOf('--roll');return i>-1?process.argv[i+1]:'9SYT-PT5';})();

const norm = s => String(s).replace(/\[[^\]]*\]/g,' ').replace(/\?/g,' ').replace(/\b(old|little|big|young|infant)\b/gi,' ').replace(/\band\b.*$/i,' ').replace(/\(.*?\)/g,' ').trim().toLowerCase().split(/\s+/)[0]||'';
const toks = s => String(s).toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/).filter(w=>w.length>2);

(async () => {
  const gt = JSON.parse(fs.readFileSync(require('path').resolve(__dirname,'../tests/fixtures/probate/liberty/antebellum-wills-index.json'),'utf8'));
  const wills = gt.records.filter(r=>(r.enslaved_named||[]).length>0);
  const segs = (await pool.query(`SELECT id, decedent_name, page_doc_ids, page_count FROM probate_estate_segments WHERE roll_group_id=$1`, [ROLL])).rows;
  function matchSeg(t){ const g=new Set(toks(t)); let b=null,bs=0; for(const s of segs){const o=toks(s.decedent_name||'').filter(x=>g.has(x)).length; if(o>bs){bs=o;b=s;}} return bs>=2?b:null; }

  let matched=0, totalNames=0, namesInOcr=0; const rows=[];
  for (const w of wills) {
    const seg = matchSeg(w.testator);
    if (!seg) continue;
    matched++;
    const docs = (await pool.query(`SELECT ocr_text FROM person_documents WHERE id=ANY($1)`, [seg.page_doc_ids])).rows;
    const ocr = ' ' + docs.map(d=>d.ocr_text||'').join(' ').toLowerCase().replace(/[^a-z0-9\s]/g,' ') + ' ';
    const names = [...new Set(w.enslaved_named.map(norm).filter(Boolean))];
    let present = 0;
    for (const n of names) if (n.length>=3 && ocr.includes(' '+n)) present++;  // word-prefix presence
    totalNames += names.length; namesInOcr += present;
    rows.push({ testator:w.testator.slice(0,22), pages:seg.page_count, gt:names.length, inOcr:present, missingFromOcr:names.length-present });
  }
  console.log(`\n=== OCR-PRESENCE DIAGNOSIS (roll ${ROLL}) ===`);
  console.log(`GT wills matched to a segment: ${matched}`);
  console.log(`GT enslaved names total: ${totalNames}`);
  console.log(`  present in their segment's OCR: ${namesInOcr} (${(100*namesInOcr/totalNames).toFixed(1)}%)  <- extraction CEILING`);
  console.log(`  absent from segment OCR:        ${totalNames-namesInOcr} (${(100*(totalNames-namesInOcr)/totalNames).toFixed(1)}%)  <- SEGMENTATION loss`);
  console.log(`\nWorst segmentation losses (names in GT but not in fed OCR):`);
  console.table(rows.filter(r=>r.missingFromOcr>0).sort((a,b)=>b.missingFromOcr-a.missingFromOcr).slice(0,15));
  await pool.end();
})();
