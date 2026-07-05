#!/usr/bin/env node
/**
 * RUN ON THE MAC MINI (logged-in FamilySearch Chrome on :9222 + scraper deps).
 * Pulls the FULL-RESOLUTION 1860 slave-schedule image for each marquee enslaver lead into S3 via
 * the viewer's DOWNLOAD button (not a zoomed-out screenshot), records the structured Image Index as
 * ocr_text (owner + enslaved), and writes a census_slave_schedule primary doc on the lead. The
 * MacBook then verifies (owner named in the index) and promotes lead→canonical→served.
 *
 * The clean-capture method (system-wide fix): FamilySearch renders images as tiled <img> in an
 * OpenSeadragon-less viewer — there is no single element to grab. The "Download" toolbar button
 * yields the real full-res page JPG. captureFamilySearchImage() below is the reusable primitive.
 *
 * ONE FS SCRAPER AT A TIME (CLAUDE.md): do NOT run while the probate/NY scraper is using Chrome.
 *   node scripts/pull-marquee-schedules.cjs [--only=<lead_id>]
 */
require('dotenv').config();
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const LEAD_IDS = ONLY ? [parseInt(ONLY, 10)] : [779254, 1811938, 1263396, 1554277, 1635134, 1875015];
const BUCKET = process.env.S3_BUCKET || 'reparations-them';
const REGION = process.env.S3_REGION || 'us-east-2';
const s3 = new S3Client({ region: REGION, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sanitize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

/**
 * Reusable clean FamilySearch image capture. Returns {imageBuffer(full-res jpg), indexText, crumb, signedIn}.
 * Uses the viewer's Download button + CDP download interception.
 */
async function captureFamilySearchImage(page, dir) {
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }).catch(() => {});
  await sleep(9000); // viewer + index panel render
  const meta = await page.evaluate(() => {
    // Structured Image Index (every person on the page: Name / Sex / Age / Free-or-Enslaved)
    let indexText = '';
    const nodes = Array.from(document.querySelectorAll('body *')).filter(el =>
      el.children.length < 40 && /free\s*or\s*enslaved|\bOwner\b|\bSlave\b/i.test(el.innerText || '') && (el.innerText || '').length < 20000);
    const cand = nodes.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length)[0];
    if (cand) indexText = (cand.innerText || '').replace(/\s*\n\s*/g, ' | ').replace(/\s{2,}/g, ' ').trim().slice(0, 8000);
    const signInWall = /create a free account to view|sign in to view this image/i.test(document.body.innerText.slice(0, 4000));
    const crumb = (document.querySelector('nav, [class*="breadcrumb"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200);
    const clicked = (() => { const el = Array.from(document.querySelectorAll('button,[role=button],a')).find(e => /^download$/i.test((e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim())); if (el) { el.click(); return true; } return false; })();
    return { indexText, signInWall, crumb, clicked };
  });
  // poll the download dir for a complete image file
  let imageBuffer = null;
  for (let i = 0; i < 24 && !imageBuffer; i++) {
    await sleep(1500);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f) && !/\.crdownload$/i.test(f)) : [];
    if (files.length) { const fp = dir + '/' + files[0]; const s1 = fs.statSync(fp).size; await sleep(1200); const s2 = fs.statSync(fp).size; if (s1 === s2 && s1 > 80000) imageBuffer = fs.readFileSync(fp); }
  }
  return { imageBuffer, indexText: meta.indexText, crumb: meta.crumb, signedIn: !meta.signInWall };
}

(async () => {
  const { rows: leads } = await pool.query(
    `SELECT lead_id, full_name, source_url, array_to_string(locations,',') loc FROM unconfirmed_persons WHERE lead_id = ANY($1)`, [LEAD_IDS]);
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const results = [];
  for (const L of leads) {
    const page = await browser.newPage();
    const dir = `/tmp/fsdl-${L.lead_id}`;
    try {
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      console.log(`\n→ ${L.full_name} (${L.loc}) lead#${L.lead_id}`);
      await page.goto(L.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const perImageArk = (page.url().match(/ark:\/61903\/([^?]+)/) || [])[1] || null;
      const { imageBuffer, indexText, crumb, signedIn } = await captureFamilySearchImage(page, dir);
      if (!signedIn) { console.log('   ⚠️ SIGN-IN WALL'); results.push({ lead: L.lead_id, ok: false, reason: 'signin' }); continue; }
      if (!imageBuffer) { console.log('   ⚠️ no image downloaded'); results.push({ lead: L.lead_id, ok: false, reason: 'no_download' }); continue; }
      const ocr = [crumb ? 'PAGE: ' + crumb : '', indexText ? 'IMAGE INDEX (all persons on this page): ' + indexText : ''].filter(Boolean).join('\n');
      const surname = (L.full_name.split(/\s+/).pop() || '').toLowerCase();
      const surnameOnPage = surname.length >= 3 && (indexText || '').toLowerCase().includes(surname);
      console.log(`   crumb: ${crumb || '(none)'} | index ${indexText ? indexText.length + ' chars' : 'none'} | "${surname}" on page: ${surnameOnPage} | img ${(imageBuffer.length/1024|0)}KB`);
      const key = `owners/${sanitize(L.full_name)}/census_slave_schedule/${sanitize(L.full_name)}-${crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0,16)}.jpg`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: imageBuffer, ContentType: 'image/jpeg',
        Metadata: { source: 'familysearch', ark: perImageArk || '', schedule: '1860_slave_schedule', lead: String(L.lead_id) } }));
      const s3Url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
      const doc = await pool.query(
        `INSERT INTO person_documents (unconfirmed_person_id, name_as_appears, document_type, source_url, source_type, s3_url, s3_key, evidence_strength, document_year, title, ocr_text, human_verified, verified_by, created_by)
         VALUES ($1,$2,'census_slave_schedule',$3,'primary_source',$4,$5,'primary',1860,$6,$7,false,'roster_partner_ingest','roster_partner_ingest')
         ON CONFLICT (COALESCE(canonical_person_id,'-1'::integer), COALESCE(unconfirmed_person_id,'-1'::integer), COALESCE(s3_url,''::text), name_as_appears) DO NOTHING RETURNING id`,
        [L.lead_id, L.full_name, L.source_url, s3Url, key, `1860 U.S. Census Slave Schedule — ${L.full_name}, ${L.loc} (FamilySearch ark:/61903/${perImageArk})`, ocr || null]);
      console.log(`   ☁️  S3: ${key}  → doc#${doc.rows[0]?.id}`);
      results.push({ lead: L.lead_id, name: L.full_name, ok: true, s3_key: key, doc: doc.rows[0]?.id, surname_on_page: surnameOnPage, img_kb: imageBuffer.length/1024|0 });
    } catch (e) { console.log('   ❌', e.message); results.push({ lead: L.lead_id, ok: false, err: e.message }); }
    finally { await page.close().catch(()=>{}); fs.rmSync(dir, { recursive: true, force: true }); await sleep(3000); }
  }
  browser.disconnect();
  console.log('\nRESULTS:', JSON.stringify(results, null, 1));
  await pool.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
