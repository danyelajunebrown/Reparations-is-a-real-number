// Is the recall loss a within-roll segmentation miss, or are the names in OTHER
// Liberty rolls (estate spans multiple probate books)? For the worst-loss GT
// wills, count GT names present in: (a) their vol-B segment, (b) anywhere in roll
// 9SYT-PT5, (c) anywhere in ALL Liberty probate OCR. If (c) >> (a), the fix is
// cross-roll estate assembly, not a better single-roll segmenter.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs'); const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const norm = s => String(s).replace(/\[[^\]]*\]/g,' ').replace(/\?/g,' ').replace(/\b(old|little|big|young|infant)\b/gi,' ').replace(/\band\b.*$/i,' ').replace(/\(.*?\)/g,' ').trim().toLowerCase().split(/\s+/)[0]||'';
const toks = s => String(s).toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/).filter(w=>w.length>2);
const has = (ocr,n) => n.length>=3 && ocr.includes(' '+n);

(async () => {
  const gt = JSON.parse(fs.readFileSync(require('path').resolve(__dirname,'../tests/fixtures/probate/liberty/antebellum-wills-index.json'),'utf8'));
  const segs = (await pool.query(`SELECT decedent_name, page_doc_ids FROM probate_estate_segments WHERE roll_group_id='9SYT-PT5'`)).rows;
  function matchSeg(t){ const g=new Set(toks(t)); let b=null,bs=0; for(const s of segs){const o=toks(s.decedent_name||'').filter(x=>g.has(x)).length; if(o>bs){bs=o;b=s;}} return bs>=2?b:null; }
  const clean = t => ' ' + (t||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ') + ' ';

  // Pre-load all-Liberty OCR once, concatenated.
  console.log('loading all Liberty OCR…');
  const allRows = (await pool.query(`SELECT ocr_text FROM person_documents WHERE collection_key LIKE 'georgia-probate-liberty-%' AND ocr_text IS NOT NULL`)).rows;
  const allOcr = clean(allRows.map(r=>r.ocr_text).join(' '));
  const rollRows = (await pool.query(`SELECT pd.ocr_text FROM person_documents pd JOIN probate_scrape_progress p ON p.person_document_id=pd.id WHERE p.roll_group_id='9SYT-PT5'`)).rows;
  const rollOcr = clean(rollRows.map(r=>r.ocr_text).join(' '));
  console.log(`all-Liberty OCR: ${(allOcr.length/1e6).toFixed(1)}M chars; roll OCR: ${(rollOcr.length/1e6).toFixed(1)}M chars\n`);

  const targets = ['Sarah Ann Austin','John Miller','Mary (Mercy) Brown','John Baker','William Way','Joseph Jones','Thomas Shepard'];
  const rows = [];
  let segSum=0, rollSum=0, allSum=0, totSum=0;
  for (const t of targets) {
    const w = gt.records.find(r=>r.testator===t); if(!w) continue;
    const seg = matchSeg(t);
    const segOcr = seg ? clean((await pool.query(`SELECT ocr_text FROM person_documents WHERE id=ANY($1)`,[seg.page_doc_ids])).rows.map(r=>r.ocr_text).join(' ')) : ' ';
    const names = [...new Set(w.enslaved_named.map(norm).filter(Boolean))];
    const inSeg = names.filter(n=>has(segOcr,n)).length;
    const inRoll = names.filter(n=>has(rollOcr,n)).length;
    const inAll = names.filter(n=>has(allOcr,n)).length;
    rows.push({ testator:t.slice(0,20), gt:names.length, inSeg, inRoll, inAllLiberty:inAll });
    segSum+=inSeg; rollSum+=inRoll; allSum+=inAll; totSum+=names.length;
  }
  console.table(rows);
  console.log(`\nTOTALS over ${targets.length} worst-loss wills (${totSum} names):`);
  console.log(`  in their segment:     ${segSum} (${(100*segSum/totSum).toFixed(0)}%)`);
  console.log(`  anywhere in roll B:   ${rollSum} (${(100*rollSum/totSum).toFixed(0)}%)`);
  console.log(`  anywhere in Liberty:  ${allSum} (${(100*allSum/totSum).toFixed(0)}%)`);
  await pool.end();
})();
