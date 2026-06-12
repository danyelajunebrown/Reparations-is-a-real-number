#!/usr/bin/env node
/**
 * Extract estate financial statements from v2-segmented probate rolls into
 * probate_estate_extractions. Single-estate (batch tanks recall) via the
 * OpenRouter-backed provider router. Idempotent (skips already-extracted
 * segments) and budget-resumable (stops cleanly when all providers are
 * exhausted, picks up next run / next daily reset).
 *
 * Runs on the Mac Mini.
 *   node scripts/extract-probate-estates.mjs --roll 9SYT-PT5 [--limit N]
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);
const { extractEstate, PROVIDERS } = require(path.resolve(__dirname, '../src/services/probate/probate-llm-extractor.js'));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ROLL = (()=>{const i=process.argv.indexOf('--roll');return i>-1?process.argv[i+1]:null;})();
const LIMIT = (()=>{const i=process.argv.indexOf('--limit');return i>-1?+process.argv[i+1]:null;})();
const EXV = 'llm-router-v1';
const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async()=>{
  if(!ROLL){console.error('--roll required');process.exit(1);}
  await pool.query(`CREATE TABLE IF NOT EXISTS probate_estate_extractions (
    id serial PRIMARY KEY, roll_group_id text, segment_id int UNIQUE, decedent_name text,
    document_type text, year int, enslaved_persons jsonb, non_chattel_assets jsonb,
    liabilities jsonb, heirs jsonb, monetary_bequests jsonb, estate_totals jsonb,
    enslaved_count int, enslaved_valued_count int, total_appraised_usd numeric,
    provider text, extractor_version text, extracted_at timestamptz DEFAULT now())`);

  let segs = (await pool.query(`SELECT id, decedent_name, page_doc_ids FROM probate_estate_segments_v2
    WHERE roll_group_id=$1 AND id NOT IN (SELECT segment_id FROM probate_estate_extractions WHERE segment_id IS NOT NULL)
    ORDER BY page_count DESC`, [ROLL])).rows;
  if(LIMIT) segs = segs.slice(0, LIMIT);
  console.log(`Roll ${ROLL}: ${segs.length} un-extracted estates | providers: ${PROVIDERS.map(p=>p.name).join('>')}\n`);

  let done=0, enslavedTot=0, valuedTot=0, failStreak=0; const provCount={};
  for (const seg of segs) {
    const ocr = (await pool.query(`SELECT ocr_text FROM person_documents WHERE id=ANY($1) ORDER BY id`, [seg.page_doc_ids])).rows.map(r=>r.ocr_text).filter(Boolean).join('\n');
    if (!ocr || ocr.length < 40) continue;
    let est, provider='?';
    try {
      // light wrapper to capture provider would need extractor change; infer via env order isn't reliable, skip.
      est = await extractEstate(ocr, { decedent: seg.decedent_name });
      failStreak = 0;
    } catch(e) {
      failStreak++;
      console.log(`  seg ${seg.id} (${seg.decedent_name}) failed: ${e.message.slice(0,60)}`);
      if (failStreak >= 4) { console.log(`\n⚠ ${failStreak} consecutive failures — providers likely exhausted. Stopping (resumable).`); break; }
      await sleep(5000); continue;
    }
    const ep = est?.enslaved_persons || [];
    const valued = ep.filter(p=>p.appraised_value_usd).length;
    enslavedTot += ep.length; valuedTot += valued;
    await pool.query(`INSERT INTO probate_estate_extractions
      (roll_group_id, segment_id, decedent_name, document_type, year, enslaved_persons, non_chattel_assets, liabilities, heirs, monetary_bequests, estate_totals, enslaved_count, enslaved_valued_count, total_appraised_usd, provider, extractor_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (segment_id) DO NOTHING`,
      [ROLL, seg.id, est.testator||seg.decedent_name, est.document_type||null, est.year||null,
       JSON.stringify(ep), JSON.stringify(est.non_chattel_assets||[]), JSON.stringify(est.liabilities||[]),
       JSON.stringify(est.heirs||[]), JSON.stringify(est.monetary_bequests||[]), JSON.stringify(est.estate_totals||{}),
       ep.length, valued, est.estate_totals?.total_appraised_value_usd||null, provider, EXV]);
    done++;
    if (done % 10 === 0) console.log(`  …${done}/${segs.length} | ${enslavedTot} enslaved (${valuedTot} valued) so far`);
    await sleep(1500);
  }
  console.log(`\n✓ extracted ${done} estates | ${enslavedTot} enslaved persons, ${valuedTot} with $ values`);
  const agg = (await pool.query(`SELECT COUNT(*) estates, SUM(enslaved_count) enslaved, SUM(enslaved_valued_count) valued, SUM(total_appraised_usd) total_usd FROM probate_estate_extractions WHERE roll_group_id=$1`, [ROLL])).rows[0];
  console.log(`Roll total in DB: ${agg.estates} estates, ${agg.enslaved} enslaved, ${agg.valued} valued, $${Math.round(agg.total_usd||0).toLocaleString()} appraised`);
  await pool.end();
})();
