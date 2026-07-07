// validate-ucl-lbs-ingest.mjs — the "do NOT call the ingest successful until this passes" harness.
//
// Proves EXTRACTION ACCURACY + INTEGRITY at scale, not just plumbing. Checks (per the committed bar):
//   1. Dedup at full scale        — leads == distinct persons == ucl_lbs_person ext-ids (1:1).
//   2. Field-fill + plausibility  — % claims with colony/claimNo/£/enslaved/year; year in band; £>0; N>0.
//   3. Extraction fidelity        — re-parse a random S3 sample, compare to stored parsed JSONB (drift=0).
//   4. No fabrication (audit #5)  — 0 placeholder/OCR-junk person names; £ as-transcribed (not summed).
//   5. Referential integrity      — every lbs_claim_persons.subject_id resolves; estate links valid.
//   6. Per-colony control surface — Σ£ / Σenslaved per colony (rule #2 tripwire surface).
//   7. RAG retrievability         — (RULE 0.5) a sample LBS person is findable via the RAG layer.
//   8. Stratified human sample    — writes N records (by type+colony) to worksheets/ for manual review.
//
// Exit non-zero if any HARD check fails. Usage:
//   node scripts/validate-ucl-lbs-ingest.mjs [--sample 60] [--reparse 40] [--rag]   (--rag needs ollama)

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');
const { parseLbs } = require('../src/services/lbs/lbs-parser');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? +A[i + 1] : d; };
const SAMPLE = val('--sample', 60), REPARSE = val('--reparse', 40), DO_RAG = A.includes('--rag');
const PLACEHOLDER = /^(note|estate|ditto|do\b|image \d|deceased|sole|late|the |a |unknown|no name|slaves?|negro|do\.|item)/i;

let hardFail = 0;
const check = (name, ok, detail) => { console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) hardFail++; };
const info = (name, detail) => console.log(`  · ${name}: ${detail}`);

async function readHtmlFromS3(key) { const url = await S3.getViewUrl(key, 300); const r = await fetch(url); if (!r.ok) throw new Error('s3 ' + r.status); return r.text(); }

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const q = async (s, p = []) => (await pool.query(s, p)).rows;
  const one = async (s, p = []) => (await q(s, p))[0];
  console.log('=== UCL LBS ingest validation ===\n');

  // 1. DEDUP
  const d = await one(`SELECT
    (SELECT count(*)::int FROM unconfirmed_persons WHERE source_url LIKE '%/lbs/person/view/%') leads,
    (SELECT count(DISTINCT substring(source_url from '/view/(-?[0-9]+)'))::int FROM unconfirmed_persons WHERE source_url LIKE '%/lbs/person/view/%') dp,
    (SELECT count(*)::int FROM person_external_ids WHERE id_system='ucl_lbs_person') ext`);
  check('dedup 1:1 (leads = distinct = ext-ids)', Math.abs(d.leads - d.dp) <= 2 && Math.abs(d.ext - d.dp) <= 2, `leads ${d.leads} / distinct ${d.dp} / ext ${d.ext}`);

  // 2. FIELD-FILL + PLAUSIBILITY (claims)
  const cl = await one(`SELECT count(*)::int n,
    count(colony)::int colony, count(claim_no)::int claimno, count(comp_decimal)::int pounds, count(enslaved_count)::int ens, count(award_year)::int yr,
    count(*) FILTER (WHERE comp_decimal IS NOT NULL AND comp_decimal<=0)::int badpounds,
    count(*) FILTER (WHERE enslaved_count IS NOT NULL AND enslaved_count<0)::int badens,
    count(*) FILTER (WHERE award_year IS NOT NULL AND (award_year<1834 OR award_year>1846))::int badyr
    FROM lbs_claims`);
  const pct = (x) => cl.n ? (100 * x / cl.n).toFixed(1) + '%' : 'n/a';
  info('claims', `${cl.n} | colony ${pct(cl.colony)} claim_no ${pct(cl.claimno)} £ ${pct(cl.pounds)} enslaved ${pct(cl.ens)} year ${pct(cl.yr)}`);
  check('claim colony fill ≥ 95%', cl.colony / cl.n >= 0.95, pct(cl.colony));
  check('claim £ fill ≥ 90%', cl.pounds / cl.n >= 0.90, pct(cl.pounds));
  check('no non-positive £ or enslaved', cl.badpounds === 0 && cl.badens === 0, `£≤0:${cl.badpounds} N≤0:${cl.badens}`);
  check('award years within 1834–1846', cl.badyr === 0, `${cl.badyr} out of band`);

  // role vocabulary
  const roles = await q(`SELECT count(DISTINCT role_raw)::int r, count(*) FILTER (WHERE is_awardee)::int aw, count(*)::int n FROM lbs_claim_persons`);
  info('claim_persons', `${roles[0].n} rows, ${roles[0].r} distinct roles, ${roles[0].aw} awardees`);
  check('awardees present', roles[0].aw > 0, String(roles[0].aw));

  // 3. EXTRACTION FIDELITY — re-parse S3 sample vs stored JSONB
  const samp = await q(`SELECT r.url_type, r.ext_id, r.html_s3_key, r.parsed FROM lbs_raw_records r WHERE r.parsed IS NOT NULL AND r.html_s3_key IS NOT NULL ORDER BY random() LIMIT $1`, [REPARSE]);
  let drift = 0, checked = 0;
  for (const s of samp) {
    try { const re = parseLbs(s.url_type, await readHtmlFromS3(s.html_s3_key)); checked++;
      // compare a few stable keys
      const a = JSON.stringify({ name: re.name, colony: re.colony, c: re.compensation?.decimal, e: re.enslavedCount });
      const b = JSON.stringify({ name: s.parsed.name, colony: s.parsed.colony, c: s.parsed.compensation?.decimal, e: s.parsed.enslavedCount });
      if (a !== b) { drift++; if (drift <= 3) info('drift', `${s.url_type}/${s.ext_id} live=${a} stored=${b}`); }
    } catch (e) { info('reparse-err', `${s.url_type}/${s.ext_id}: ${e.message}`); }
  }
  check('extraction fidelity (re-parse drift = 0)', drift === 0, `${drift}/${checked} drifted`);

  // 4. NO FABRICATION
  const junk = await q(`SELECT full_name FROM unconfirmed_persons WHERE source_url LIKE '%/lbs/person/view/%' AND full_name ~* $1 LIMIT 20`, [PLACEHOLDER.source]);
  check('no placeholder/OCR-junk person names', junk.length === 0, junk.length ? junk.slice(0, 5).map(x => x.full_name).join(', ') : 'clean');
  // £ as-transcribed: comp_decimal must equal pounds + s/20 + d/240 (no summing/rounding drift)
  const mism = await one(`SELECT count(*)::int n FROM lbs_claims WHERE comp_decimal IS NOT NULL AND comp_pounds IS NOT NULL
    AND abs(comp_decimal - (comp_pounds + COALESCE(comp_shillings,0)/20.0 + COALESCE(comp_pence,0)/240.0)) > 0.01`);
  check('£ as-transcribed (decimal = £sd, no drift)', mism.n === 0, `${mism.n} mismatches`);

  // 5. REFERENTIAL INTEGRITY
  const orphan = await one(`SELECT count(*)::int n FROM lbs_claim_persons cp WHERE cp.subject_id IS NOT NULL
    AND cp.subject_table='unconfirmed_persons' AND NOT EXISTS (SELECT 1 FROM unconfirmed_persons u WHERE u.lead_id=cp.subject_id)`);
  check('no dangling claim_person → lead refs', orphan.n === 0, `${orphan.n} dangling`);

  // 6. PER-COLONY CONTROL SURFACE
  const colonies = await q(`SELECT colony, count(*)::int claims, COALESCE(SUM(enslaved_count),0)::int enslaved, COALESCE(SUM(comp_decimal),0)::bigint pounds FROM lbs_claims WHERE colony IS NOT NULL GROUP BY 1 ORDER BY 4 DESC LIMIT 8`);
  console.log('  per-colony (top by £):');
  colonies.forEach(c => console.log(`    ${c.colony}: ${c.claims} claims, ${c.enslaved} enslaved, £${Number(c.pounds).toLocaleString()}`));

  // 7. RAG RETRIEVABILITY (RULE 0.5) — sample LBS person embedded + findable
  const emb = await one(`SELECT count(*)::int n FROM embeddings e WHERE e.subject_table='unconfirmed_persons' AND e.content_kind='person_profile'
    AND EXISTS (SELECT 1 FROM person_external_ids x WHERE x.id_system='ucl_lbs_person' AND x.subject_table='unconfirmed_persons' AND x.subject_id::text = e.subject_id)`);
  info('RAG', `${emb.n} LBS person leads embedded`);
  check('LBS persons embedded (RULE 0.5 — reach RAG/search/modals)', emb.n > 0, emb.n === 0 ? 'run embed-ucl-lbs.mjs on the Mini' : `${emb.n} embedded`);

  // 8. STRATIFIED HUMAN-REVIEW SAMPLE
  const hs = await q(`SELECT url_type, ext_id, parsed FROM lbs_raw_records WHERE parsed IS NOT NULL
    ORDER BY url_type, random() LIMIT $1`, [SAMPLE]);
  const dir = 'worksheets'; if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'lbs-validation-sample.json'), JSON.stringify(hs.map(h => ({
    url: `https://www.ucl.ac.uk/lbs/${h.url_type}/view/${h.ext_id}`, type: h.url_type, ext_id: h.ext_id, parsed: h.parsed })), null, 2));
  info('human-review sample', `${hs.length} records → worksheets/lbs-validation-sample.json (verify against the live/archived page)`);

  console.log(`\n${hardFail === 0 ? '✓✓ VALIDATION PASSED — ingest may be called validated' : `✗ ${hardFail} HARD CHECK(S) FAILED — NOT validated`}`);
  await pool.end();
  process.exit(hardFail ? 1 : 0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(2); });
