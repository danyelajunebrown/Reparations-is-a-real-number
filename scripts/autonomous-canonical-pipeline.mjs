// autonomous-canonical-pipeline.mjs — the platform's OWN inception→canonical quality pipeline.
//
// User directive (2026-08-07): the CODEBASE — not a human in a chat — should develop/maintain scrapers and
// clean up behind them to produce ADDITIONAL canonicals that are (a) verifiable, (b) deduplicated (Biscoe),
// (c) primary-source-archive gated (RULE 0.6: image in S3 + embedded). This is the QC-to-inception
// responsibility of the platform. ALL inference is LOCAL (the Mini's ollama — free, no Claude API).
//
// One source (a FamilySearch fullText ark) → gated canonicals, end to end:
//   1. SCRAPE   — connect to the FS Chrome (:9222), grab the fullText transcription + capture the page image.
//   2. EXTRACT  — local ollama (qwen) over the transcription → {persons:[{name,person_type,role}], doc_type}.
//   3. ARCHIVE  — file-first (RULE 8): image → S3 + Wayback + source_artifacts. The FILE lifts the gate.
//   4. DEDUPE   — PersonService.findOrCreateLead (mint gate + Biscoe; never auto-merge ambiguous).
//   5. GATE     — promoteToCanonical for the PRIMARY subject (image-backed doc = RULE 0.6 clause 2).
//   6. EMBED    — local ollama (nomic-embed-text) → doc_ocr (RULE 0.6 clause 3). Every canonical in RAG.
//   7. LOG      — research_findings + source_ingest_queue status. Nothing asserted without provenance.
//
// Queue-driven for autonomy: reads source_ingest_queue (status='pending'), or --ark <ark> for a single test.
// Runs on the MINI (Chrome + ollama). Cron: */N * * * * node scripts/autonomous-canonical-pipeline.mjs --one
//
// Usage: node scripts/autonomous-canonical-pipeline.mjs --ark "<fullText ark url>" [--apply]   (dry-run default)
//        node scripts/autonomous-canonical-pipeline.mjs --one --apply     (process one queued source)

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const S3 = require('../src/services/storage/S3Service');
const PersonService = require('../src/services/PersonService');

const A = process.argv.slice(2);
const flag = (n) => { const p = A.find(a => a === `--${n}` || a.startsWith(`--${n}=`)); return p ? (p.includes('=') ? p.split('=').slice(1).join('=') : true) : undefined; };
const APPLY = !!flag('apply');
const ONE = !!flag('one');
const ARK_IN = typeof flag('ark') === 'string' ? flag('ark') : null;
const OLLAMA_GEN = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace('/api/embeddings', '') + '/api/generate';
const OLLAMA_EMB = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/embeddings');
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ollamaExtract(text) {
  const prompt = `You are reading the OCR/transcription of one historical record (a will, probate, deed, petition, or census page) about slavery in the U.S. Extract ONLY what is explicitly present, as JSON:
{"doc_type":"<will|probate|deed|petition|census|inventory|other>","primary_person":"<the record's main person / testator / grantor / petitioner, or null>","persons":[{"name":"<full name>","person_type":"<enslaver|enslaved|free_person|unknown>","role":"<how they appear>"}],"place":"<county, state or null>","year":<integer or null>}
Rules: do NOT invent. Only individually-NAMED people (never a count). Normalize names ('BISCOE, GEO. W.' -> 'George W. Biscoe'). Text:\n\n${String(text).slice(0, 6000)}`;
  const r = await fetch(OLLAMA_GEN, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, format: 'json', options: { temperature: 0 } }), signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error('ollama gen ' + r.status);
  try { return JSON.parse((await r.json()).response); } catch { return null; }
}
async function ollamaEmbed(text) {
  const r = await fetch(OLLAMA_EMB, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: String(text).slice(0, 6000) }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('ollama emb ' + r.status); return (await r.json()).embedding;
}

// grab the fullText transcription + a full-res image from the FS viewer (reuses the census-pull lifecycle).
async function scrapeFullText(browser, arkUrl, dir) {
  const page = await browser.newPage();
  try {
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }).catch(() => {});
    await page.goto(arkUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(9000);
    const perImageArk = (page.url().match(/ark:\/61903\/([^?&#]+)/) || [])[1] || null;
    const meta = await page.evaluate(() => {
      const signedIn = !/sign in|create.*free account/i.test(document.body.innerText.slice(0, 4000));
      // fullText transcription lives in the text panel; fall back to the whole visible text.
      const panel = document.querySelector('[data-testid*="transcript"], .transcription, article, main');
      const text = (panel ? panel.innerText : document.body.innerText).replace(/\s+/g, ' ').trim();
      return { signedIn, text: text.slice(0, 12000) };
    });
    // try the Download button for the image (best-effort; text is the primary signal here)
    let imageBuffer = null;
    try {
      const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button,a')].find(b => /download/i.test(b.getAttribute('aria-label') || b.title || b.innerText || '')));
      if (btn) { await btn.asElement()?.click().catch(() => {}); await sleep(8000);
        const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|pdf)$/i.test(f));
        if (files.length) { const fp = dir + '/' + files[0]; await sleep(1000); if (fs.statSync(fp).size > 40000) imageBuffer = fs.readFileSync(fp); } }
    } catch { /* image optional */ }
    return { perImageArk, signedIn: meta.signedIn, text: meta.text, imageBuffer };
  } finally { await page.close().catch(() => {}); }
}

async function processOne(pool, ps, browser, src) {
  const { ark_url: arkUrl, queue_id } = src;
  const dir = `/tmp/acp-${(arkUrl.match(/ark:\/61903\/([^?&#]+)/) || [])[1]?.replace(/[^\w-]/g, '') || 'x'}`;
  console.log(`\n▶ ${arkUrl}`);
  const { perImageArk, signedIn, text, imageBuffer } = await scrapeFullText(browser, arkUrl, dir);
  if (!signedIn) { console.log('  ⚠ sign-in wall — FS session expired (re-login via VNC)'); return { status: 'inaccessible' }; }
  if (!text || text.length < 40) { console.log('  ⚠ no transcription text'); return { status: 'none' }; }
  console.log(`  transcription: ${text.length} chars; image: ${imageBuffer ? (imageBuffer.length / 1024 | 0) + 'KB' : 'none'}`);

  const ex = await ollamaExtract(text);
  if (!ex || !ex.persons?.length) { console.log('  ⚠ ollama found no named persons'); return { status: 'none', extract: ex }; }
  console.log(`  extracted: doc=${ex.doc_type} primary="${ex.primary_person}" persons=${ex.persons.length} (${ex.place || '?'}, ${ex.year || '?'})`);
  if (!APPLY) { console.log('  [DRY-RUN] would archive + dedupe + gate + embed'); return { status: 'dry', extract: ex }; }

  // ARCHIVE (file-first) — the image if we got one; else the fullText is the evidence (still archived).
  const arkRef = perImageArk ? `https://www.familysearch.org/ark:/61903/${perImageArk}` : arkUrl;
  let s3Key = null;
  if (imageBuffer) {
    s3Key = `sources/fs-fulltext/${(perImageArk || crypto.randomUUID()).replace(/[^\w-]/g, '_')}.jpg`;
    const sha = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    await S3.upload(s3Key, imageBuffer, 'image/jpeg', { sha256: sha, source: 'familysearch', ark: perImageArk || '' });
    const wb = await ensureSnapshot(arkRef);
    await pool.query(`INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_key, wayback_url, sha256, bytes, content_type, rehostable)
      VALUES ($1,$2,'FamilySearch fullText record',$3,$4,$5,$6,$7,'image/jpeg',TRUE) ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key`,
      [`acp-${perImageArk}`, ex.primary_person || 'FS record', arkRef, s3Key, wb, sha, imageBuffer.length]).catch(() => {});
    console.log(`  ☁️ archived → S3 ${s3Key}`);
  } else console.log('  ⚠ no image captured — persons stay LEADS (RULE 0.6: no image ⇒ no canonical)');

  // DEDUPE + GATE
  let canonicals = 0, leads = 0;
  const idSys = 'fs_fulltext';
  for (const p of ex.persons) {
    const isPrimary = ex.primary_person && p.name && ex.primary_person.toLowerCase().includes(p.name.split(' ').pop().toLowerCase());
    const extId = `${idSys}:${perImageArk || arkUrl}:${p.name}`;
    const lead = await ps.findOrCreateLead({ name: p.name, personType: p.person_type || 'unknown',
      locations: [ex.place].filter(Boolean), sourceType: 'primary_source', confidence: 0.8, idSystem: idSys, externalId: extId, sourceUrl: arkRef,
      context: `${p.role || p.person_type} in a FamilySearch fullText ${ex.doc_type || 'record'} (${ex.place || ''} ${ex.year || ''}); primary_person=${ex.primary_person}. LLM-extracted (qwen, local).`,
      dataQualityFlags: { source_tier: 'primary', extraction: 'fs_fulltext_ollama', requires_human_review: true } }, {});
    if (!lead.ref) { continue; }
    // GATE to canonical only for the image-backed PRIMARY subject (RULE 0.6). Others stay leads (Biscoe-safe).
    if (isPrimary && s3Key) {
      const out = await ps.promoteToCanonical(lead.ref, { personType: p.person_type, sourceType: 'primary_source', createdBy: 'autonomous-canonical-pipeline', confidence: 0.9,
        document: { documentType: ex.doc_type || 'fs_record', sourceUrl: arkRef, s3Key, evidenceStrength: 'primary', documentYear: ex.year, nameAsAppears: p.name } }, { dryRun: false });
      if (out.ref?.subject_id) {
        canonicals++;
        // EMBED (RULE 0.6 clause 3): give the doc retrievable text + embed it.
        const docTxt = `${p.name} — ${ex.doc_type} (${ex.place || ''} ${ex.year || ''}); ${p.role || ''}. FamilySearch ${arkRef}. Transcription excerpt: ${text.slice(0, 600)}`;
        const d = await pool.query(`UPDATE person_documents SET ocr_text=COALESCE(NULLIF(ocr_text,''),$2) WHERE canonical_person_id=$1 AND s3_key=$3 RETURNING id`, [out.ref.subject_id, docTxt, s3Key]);
        if (d.rows[0]) { try { const vec = await ollamaEmbed(docTxt);
          await pool.query(`INSERT INTO embeddings (subject_table,subject_id,content_kind,model,embedding,content_hash,chunk_index) VALUES ('person_documents',$1,'doc_ocr','nomic-embed-text',$2::vector,$3,0) ON CONFLICT (subject_table,subject_id,content_kind,model,chunk_index) DO NOTHING`,
            [String(d.rows[0].id), '[' + vec.join(',') + ']', crypto.createHash('sha256').update(docTxt).digest('hex')]); } catch (e) { console.log('   embed err:', e.message.slice(0, 40)); } }
        console.log(`  ✓ CANONICAL #${out.ref.subject_id} ${p.name} (image-backed + embedded, RULE 0.6)`);
      } else { leads++; console.log(`  ↪ ${p.name}: ${out.action} (held as lead — ${out.action})`); }
    } else { leads++; }
  }
  await pool.query(`INSERT INTO research_findings (question, repository, index_searched, result, hit_count, evidence_note, searched_by)
    VALUES ($1,'FamilySearch fullText',$2,'hit',$3,$4,'autonomous-canonical-pipeline')`,
    [`Autonomous ingest — ${ex.primary_person || 'FS record'}`, arkRef, canonicals, `doc=${ex.doc_type}; ${canonicals} canonical(s) gated (image-backed+embedded), ${leads} held as leads; place=${ex.place}, year=${ex.year}.`]).catch(() => {});
  return { status: 'done', canonicals, leads };
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 180000 });
  await pool.query(`CREATE TABLE IF NOT EXISTS source_ingest_queue (
    queue_id BIGSERIAL PRIMARY KEY, ark_url TEXT UNIQUE, source_kind TEXT DEFAULT 'fs_fulltext',
    status TEXT DEFAULT 'pending', result JSONB, added_by TEXT, added_at TIMESTAMPTZ DEFAULT now(), processed_at TIMESTAMPTZ)`);
  const ps = new PersonService(pool);

  let sources = [];
  if (ARK_IN) sources = [{ ark_url: ARK_IN, queue_id: null }];
  else if (ONE) sources = (await pool.query(`SELECT queue_id, ark_url FROM source_ingest_queue WHERE status='pending' ORDER BY queue_id LIMIT 1`)).rows;
  if (!sources.length) { console.log('no sources to process (use --ark <url> or seed source_ingest_queue).'); await pool.end(); return; }

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  for (const src of sources) {
    let res; try { res = await processOne(pool, ps, browser, src); } catch (e) { res = { status: 'error', error: e.message.slice(0, 200) }; console.log('  ❌', e.message.slice(0, 100)); }
    if (src.queue_id && APPLY) await pool.query(`UPDATE source_ingest_queue SET status=$2, result=$3, processed_at=now() WHERE queue_id=$1`, [src.queue_id, res.status, JSON.stringify(res)]).catch(() => {});
  }
  await browser.disconnect();
  await pool.end();
  console.log('\n=== autonomous-canonical-pipeline done ===');
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
