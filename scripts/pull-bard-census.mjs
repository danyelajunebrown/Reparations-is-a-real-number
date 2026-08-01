// pull-bard-census.mjs — RUN ON THE MAC MINI (logged-in FamilySearch Chrome on :9222).
// ===========================================================================================
// Pulls the PRIMARY-SOURCE census pages that document the Bard-College modern-endpoint enslavers,
// image-backs them to S3 (rule 8 dual archive), and promotes the leads to canonical under RULE 0.6
// ("every canonical serves an image and is in RAG"). This is the pull that ingest-massena-deed.mjs
// and ingest-bard-lineage-edges.mjs flagged as "still to be pulled (Mini)":
//
//   Samuel Bard   — lead 3579208 — 1800 U.S. Census, Dutchess Co NY — 7 enslaved  (GRANDFATHER of founder)
//   William Bard  — lead 3579211 — 1810 U.S. Census, Dutchess Co NY — 4 enslaved  (FATHER of founder; the
//                                                                                  PROBABLE son of Samuel)
//
// Downstream effect: image-backing + promoting these two lifts the RULE 0.6 gate (a census_slave_schedule
// doc with an s3_key is an OWNER_NAMED type → assertable_slaveowner lifts in ONE step). Confirming the
// 1810 William household as Samuel's son (operator visual review + --confirm-william-son) flips kinship
// edge #8114 (William child_of Samuel) from verified=false to verified=true.
//
// ── LIFECYCLE REUSE (do NOT re-invent) ────────────────────────────────────────────────────────────────
//   • FamilySearch Chrome lifecycle  → scripts/scrapers/familysearch-ancestor-climber.js
//       puppeteer.connect() to http://127.0.0.1:9222 (NEVER launch — crashes Intel Mac Sonoma),
//       waitUntil:'domcontentloaded' (FS is an SPA; networkidle never fires), per-image ARK from page.url().
//   • Full-res image capture         → scripts/pull-marquee-schedules.cjs captureFamilySearchImage()
//       The FS viewer renders tiled <img> (no canvas) — issue #124. We click the toolbar "Download" button
//       and intercept the CDP download to get the real full-res page JPG, NOT a zoomed-out screenshot.
//   • File-first S3 + Wayback + source_artifacts → scripts/archive-roster-documents.mjs / archive-massena-deed.mjs
//       (standard-file-first-document-archival.md: the FILE in OUR storage lifts the gate, never a URL.)
//   • RULE 0.6 promotion             → scripts/promote-image-backed-leads.mjs (PersonService.promoteToCanonical:
//       Biscoe-safe link-or-create, writes the s3-backed doc, then recomputeGate).
//   • Null-result logging            → migration 128 research_findings ('hit'|'none'|'inaccessible'|'truncated').
//
// ── EXACT MINI RUN STEPS ────────────────────────────────────────────────────────────────────────────────
//   0. ONE FS SCRAPER AT A TIME (CLAUDE.md / feedback_one_fs_scraper_at_a_time): make sure the climber and the
//      probate/NY scrapers are NOT using Chrome. Gate via PM2 (`pm2 stop queue-*`) before running this.
//   1. Launch (or reuse) the debug Chrome that the scrapers share, and SIGN IN to FamilySearch in it:
//        open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/familysearch-ancestor-climber
//      (SSH/PM2 cannot spawn Chrome — no window server access; launch via VNC into the Mini's GUI.)
//      Confirm you are logged in (an image viewer must show the full page, not a "sign in to view" wall).
//   2. LOCATE each census page in that logged-in Chrome and copy its per-image viewer URL:
//        - Samuel: 1800 U.S. Federal Census, Dutchess County NY — find the "Bard" household.
//        - William: 1810 U.S. Federal Census, Dutchess County NY — find the "Bard" household.
//      The URL you copy must be the IMAGE viewer URL (contains ark:/61903/...), NOT a search-results URL.
//   3. Dry-run to preview (no Chrome, no writes):
//        node scripts/pull-bard-census.mjs --samuel-url="<1800 ark viewer url>" --william-url="<1810 ark viewer url>"
//   4. Apply (connects to :9222, captures, archives, promotes):
//        node scripts/pull-bard-census.mjs --apply --samuel-url="..." --william-url="..."
//   5. After visually confirming the 1810 Dutchess "Bard" household matches the genealogy's William (b.1778,
//      son of Dr. Samuel Bard), re-run with the confirmation flag to flip edge #8114 verified:
//        node scripts/pull-bard-census.mjs --apply --william-url="..." --only=william --confirm-william-son
//      (Biscoe: the son-identity is asserted ONLY on operator visual confirmation — never auto-flipped.)
//
//   Flags: --apply (default dry-run) · --samuel-url=<u> · --william-url=<u> · --only=samuel|william ·
//          --confirm-william-son (flip #8114 verified once the 1810 household is operator-confirmed).
//
// EMBED (RULE 0.5): after this run, embed the two new canonicals + their docs (embed-persons.mjs /
// embed-documents.mjs) so they surface in RAG/search/modals. Unembedded = retrieval silo.

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

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────
const A = process.argv.slice(2);
const flag = (name) => { const p = A.find(a => a === `--${name}` || a.startsWith(`--${name}=`)); if (!p) return undefined; return p.includes('=') ? p.split('=').slice(1).join('=') : true; };
const APPLY = !!flag('apply');
const ONLY = typeof flag('only') === 'string' ? String(flag('only')).toLowerCase() : null;
const CONFIRM_WILLIAM_SON = !!flag('confirm-william-son');
const BUCKET = process.env.S3_BUCKET || 'reparations-them';
const REGION = process.env.S3_REGION || 'us-east-2';

// ── TARGETS (leads already in the DB, from NESRI; see ingest-bard-lineage-edges.mjs) ────────────────────
const TARGETS = [
  { key: 'samuel', leadId: 3579208, name: 'Samuel Bard', censusYear: 1800, enslaved: 7,
    s3Key: 'sources/census/bard-1800-dutchess.jpg', viewerUrl: flag('samuel-url') === true ? null : (flag('samuel-url') || null),
    role: 'GRANDFATHER of Bard College founder John Bard; Hyde Park physician.' },
  { key: 'william', leadId: 3579211, name: 'William Bard', censusYear: 1810, enslaved: 4,
    s3Key: 'sources/census/bard-1810-dutchess.jpg', viewerUrl: flag('william-url') === true ? null : (flag('william-url') || null),
    role: 'FATHER of founder John Bard; PROBABLE son of Samuel Bard (the identity this pull confirms).' },
].filter(t => !ONLY || t.key === ONLY);

const EDGE_ID = 8114; // canonical_family_edges: William(3579211) child_of Samuel(3579208), tier 3, verified=false
const CREATED_BY = 'pull-bard-census';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── reusable clean FS image capture (Download button + CDP download interception; issue #124) ──
// Copied verbatim in behaviour from pull-marquee-schedules.cjs::captureFamilySearchImage so the two
// pulls capture identically. Returns {imageBuffer(full-res jpg), indexText, crumb, signedIn}.
async function captureFamilySearchImage(page, dir) {
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }).catch(() => {});
  await sleep(9000); // viewer + index panel render
  const meta = await page.evaluate(() => {
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
  let imageBuffer = null;
  for (let i = 0; i < 24 && !imageBuffer; i++) {
    await sleep(1500);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f) && !/\.crdownload$/i.test(f)) : [];
    if (files.length) { const fp = dir + '/' + files[0]; const s1 = fs.statSync(fp).size; await sleep(1200); const s2 = fs.statSync(fp).size; if (s1 === s2 && s1 > 80000) imageBuffer = fs.readFileSync(fp); }
  }
  return { imageBuffer, indexText: meta.indexText, crumb: meta.crumb, signedIn: !meta.signInWall };
}

// research_findings logger (migration 128; 'truncated' is load-bearing for capped searches).
async function logFinding(pool, { question, repository, index_searched, result, hit_count, subject_id, note }) {
  await pool.query(
    `INSERT INTO research_findings (question, repository, index_searched, result, hit_count, subject_table, subject_id, evidence_note, searched_by)
     VALUES ($1,$2,$3,$4,$5,'unconfirmed_persons',$6,$7,$8)`,
    [question, repository, index_searched, result, hit_count ?? null, subject_id, note, CREATED_BY]).catch((e) => console.log(`   ⚠ finding log failed: ${e.message.slice(0, 60)}`));
}

async function main() {
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (no Chrome, no writes) ===');
  console.log(`targets: ${TARGETS.map(t => `${t.name}(${t.censusYear}, lead ${t.leadId})`).join(' · ') || '(none — check --only)'}`);

  // ── DRY RUN: print the plan and exit before any Chrome/S3/DB mutation ──
  if (!APPLY) {
    for (const t of TARGETS) {
      console.log(`\n${t.name} — ${t.censusYear} US Census, Dutchess Co NY (${t.enslaved} enslaved)`);
      console.log(`  viewer URL : ${t.viewerUrl || '(REQUIRED — pass --' + t.key + '-url="<ark viewer url>")'}`);
      console.log(`  would: navigate → capture full-res page (Download button) → S3 ${t.s3Key} → Wayback+source_artifacts`);
      console.log(`  would: write census_slave_schedule doc (OWNER_NAMED ⇒ lifts assertable_slaveowner) → promoteToCanonical (RULE 0.6) → recomputeGate`);
    }
    console.log(`\nedge #${EDGE_ID} (William child_of Samuel): would flip verified=true ONLY with --confirm-william-son (currently ${CONFIRM_WILLIAM_SON ? 'SET' : 'not set'}).`);
    console.log('\n(dry-run complete — re-run with --apply on the Mini)');
    return;
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const db = { query: (t, p) => pool.query(t, p) };
  const svc = new PersonService(db);

  // connect to the shared logged-in FS Chrome (NEVER launch — CLAUDE.md).
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const promoted = {}; // key → canonicalId

  for (const t of TARGETS) {
    console.log(`\n→ ${t.name} — ${t.censusYear} US Census, Dutchess Co NY (${t.role})`);
    const q = `Did the NY Hyde Park Bards (${t.name}) hold enslaved people — pull the ${t.censusYear} census page?`;
    const repo = `FamilySearch — ${t.censusYear} U.S. Federal Census, Dutchess County NY`;

    if (!t.viewerUrl) {
      console.log(`   ⚠ no --${t.key}-url supplied — cannot navigate. Logging inaccessible.`);
      await logFinding(pool, { question: q, repository: repo, index_searched: `Dutchess Co NY, surname Bard`, result: 'inaccessible', hit_count: null, subject_id: t.leadId, note: `No image-viewer URL supplied; operator must locate the ${t.censusYear} Dutchess Bard household in the logged-in FS Chrome and pass --${t.key}-url. Lead remains un-image-backed (RULE 0.6 gate stays down).` });
      continue;
    }

    const page = await browser.newPage();
    const dir = `/tmp/bard-census-${t.key}`;
    try {
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      // FS is an SPA — domcontentloaded, never networkidle (CLAUDE.md).
      await page.goto(t.viewerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // per-image ARK from the settled viewer URL (never the group ARK).
      const perImageArk = (page.url().match(/ark:\/61903\/([^?&#]+)/) || [])[1] || null;
      const arkUrl = perImageArk ? `https://www.familysearch.org/ark:/61903/${perImageArk}` : t.viewerUrl;

      const { imageBuffer, indexText, crumb, signedIn } = await captureFamilySearchImage(page, dir);
      if (!signedIn) {
        console.log('   ⚠ SIGN-IN WALL — FS session expired. Re-login via VNC into the :9222 Chrome, then re-run.');
        await logFinding(pool, { question: q, repository: repo, index_searched: `ark:/61903/${perImageArk || '?'}`, result: 'inaccessible', hit_count: null, subject_id: t.leadId, note: 'Sign-in wall — FS session expired in the :9222 debug Chrome. Manual re-login required (reference_familysearch_session_reauth).' });
        continue;
      }
      if (!imageBuffer) {
        console.log('   ⚠ no image downloaded (Download button not found or capture timed out).');
        await logFinding(pool, { question: q, repository: repo, index_searched: `ark:/61903/${perImageArk || '?'}`, result: 'none', hit_count: null, subject_id: t.leadId, note: 'Navigated to the viewer but the Download button yielded no full-res JPG (issue #124 capture path). Retry / verify the viewer URL is an image page.' });
        continue;
      }
      if (imageBuffer.length < 1024) { console.log('   ⚠ <1KB soft-block — refusing (standard-file-first-document-archival).'); continue; }

      const surname = 'bard';
      const surnameOnPage = (indexText || '').toLowerCase().includes(surname) || (crumb || '').toLowerCase().includes(surname);
      const sha = crypto.createHash('sha256').update(imageBuffer).digest('hex');
      const ocr = [crumb ? 'PAGE: ' + crumb : '', indexText ? 'IMAGE INDEX (all persons on this page): ' + indexText : ''].filter(Boolean).join('\n') || null;
      console.log(`   ark:/61903/${perImageArk || '(none)'} | index ${indexText ? indexText.length + ' chars' : 'none'} | "bard" on page: ${surnameOnPage} | img ${(imageBuffer.length / 1024) | 0}KB`);

      // ── 1. ARCHIVE (rule 8 dual): S3 self-host + Wayback the ARK + source_artifacts ──
      await S3.upload(t.s3Key, imageBuffer, 'image/jpeg', { sha256: sha, source: 'familysearch', ark: perImageArk || '', schedule: `${t.censusYear}_census_dutchess` });
      const s3Url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${t.s3Key}`;
      const wb = await ensureSnapshot(arkUrl);
      await pool.query(
        `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_key, wayback_url, sha256, bytes, content_type, rehostable, record_count, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'image/jpeg',TRUE,1,$9)
         ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key, wayback_url=EXCLUDED.wayback_url, sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes`,
        [`bard-census-${t.censusYear}-dutchess`, `${t.name} — ${t.censusYear} US Census, Dutchess Co NY (${t.enslaved} enslaved)`,
         `FamilySearch (${t.censusYear} US Federal Census)`, arkUrl, t.s3Key, wb, sha, imageBuffer.length,
         `Primary-source census page for the Bard-College modern-endpoint enslaver ${t.name}. Full-res via viewer Download button (issue #124). ${t.enslaved} enslaved per NESRI. Surname on page: ${surnameOnPage}.`]).catch((e) => console.log(`   ⚠ source_artifacts: ${e.message.slice(0, 60)}`));
      console.log(`   ☁️  S3 ${t.s3Key} + Wayback${wb ? ' ✓' : ' (none)'} + source_artifacts`);

      // ── 2. PROMOTE (RULE 0.6): lead → canonical, carrying the s3-backed census doc → recomputeGate ──
      // census_slave_schedule is an OWNER_NAMED doc type: an s3-backed doc lifts assertable_slaveowner in ONE step.
      const evidence = {
        personType: 'enslaver', sourceType: 'primary_source', createdBy: CREATED_BY, confidence: 0.95,
        document: {
          documentType: 'census_slave_schedule', sourceUrl: arkUrl, s3Url, s3Key: t.s3Key,
          evidenceStrength: 'primary', documentYear: t.censusYear, nameAsAppears: t.name,
        },
      };
      const out = await svc.promoteToCanonical({ subject_table: 'unconfirmed_persons', subject_id: t.leadId }, evidence, { dryRun: false });
      const canonicalId = out.ref?.subject_id || null;
      console.log(`   promote → ${out.action}${canonicalId ? ' canonical#' + canonicalId : ''} | gate assertable_slaveowner=${out.gate?.assertable_slaveowner}`);

      if (canonicalId) {
        promoted[t.key] = canonicalId;
        // Enrich the canonical's census doc with the captured index text + human-verified holding flag,
        // then recompute (idempotent). evidences_enslaved_holding = only when the surname is confirmed on page.
        await pool.query(
          `UPDATE person_documents SET ocr_text = COALESCE($2, ocr_text), title = COALESCE(title, $3),
             human_verified = $4, verified_by = CASE WHEN $4 THEN $5 ELSE verified_by END,
             evidences_enslaved_holding = $4
             WHERE canonical_person_id = $1 AND s3_key = $6`,
          [canonicalId, ocr, `${t.censusYear} U.S. Census — ${t.name}, Dutchess Co NY (ark:/61903/${perImageArk})`, surnameOnPage, CREATED_BY, t.s3Key]).catch((e) => console.log(`   ⚠ doc enrich: ${e.message.slice(0, 60)}`));
        // link the FS ARK as an external id on the canonical (provenance, not evidence).
        if (perImageArk) await svc.link({ subject_table: 'canonical_persons', subject_id: canonicalId }, perImageArk, 'familysearch_ark', { url: arkUrl, confidence: 0.95 }).catch(() => {});
        const gate2 = await svc.recomputeGate(canonicalId);
        console.log(`   recomputeGate → assertable_slaveowner=${gate2.assertable_slaveowner}`);
      }

      await logFinding(pool, { question: q, repository: repo, index_searched: `ark:/61903/${perImageArk || '?'}, surname Bard`, result: surnameOnPage ? 'hit' : 'partial', hit_count: t.enslaved, subject_id: t.leadId,
        note: `${t.censusYear} Dutchess census page pulled + archived (${t.s3Key}). ${t.enslaved} enslaved (NESRI). "Bard" ${surnameOnPage ? 'CONFIRMED on the page index' : 'NOT auto-confirmed in the index text — operator visual review needed'}. ${canonicalId ? `Promoted → canonical#${canonicalId} (RULE 0.6).` : `Promotion: ${out.action}.`}` });
    } catch (e) {
      console.log(`   ❌ ${e.message}`);
      await logFinding(pool, { question: q, repository: repo, index_searched: 'Dutchess Co NY, surname Bard', result: 'inaccessible', hit_count: null, subject_id: t.leadId, note: `Pull errored: ${e.message.slice(0, 200)}` });
    } finally {
      await page.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); await sleep(3000);
    }
  }
  browser.disconnect();

  // ── 3. FLIP kinship edge #8114 (William child_of Samuel) — ONLY on operator confirmation (Biscoe) ──
  const wCanon = promoted['william'] || null;
  const sCanon = promoted['samuel'] || null;
  const wProcessed = TARGETS.some(t => t.key === 'william');
  if (wProcessed) {
    if (!CONFIRM_WILLIAM_SON) {
      console.log(`\nedge #${EDGE_ID}: NOT flipped — --confirm-william-son not set. The 1810 Dutchess "William Bard"`);
      console.log(`   as Samuel's son is PROBABLE (namesake caution, Biscoe). Re-run with --confirm-william-son after visual review.`);
      await logFinding(pool, { question: `Is the 1810 Dutchess "William Bard" enslaver the son of Samuel Bard (edge #${EDGE_ID})?`, repository: 'FamilySearch 1810 US Census + Bard genealogy', index_searched: 'Dutchess Co NY household, cross-ref genealogy b.1778', result: 'partial', hit_count: null, subject_id: 3579211, note: `1810 census page pulled; son-identity confirmation deferred to operator (--confirm-william-son not set). Edge #${EDGE_ID} stays verified=false.` });
    } else {
      // Prefer repointing to the promoted canonicals; fall back to flipping the lead-endpoint row in place.
      const note = ` [VERIFIED ${new Date().toISOString().slice(0, 10)}: 1810 Dutchess census page (S3 sources/census/bard-1810-dutchess.jpg) operator-confirmed the William Bard household as Samuel's son. tier→2 (primary census corroborates the identity the compiled genealogy stated). ${CREATED_BY}]`;
      let flipped = false;
      if (wCanon && sCanon) {
        try {
          await pool.query(
            `UPDATE canonical_family_edges SET
               a_subject_table='canonical_persons', a_subject_id=$2, person_a_id=$2,
               b_subject_table='canonical_persons', b_subject_id=$3, person_b_id=$3,
               evidence_tier=2, verified=TRUE, verified_by=$4, verified_at=now(), confidence=0.90,
               source_url='https://www.familysearch.org/ (1810 US Census, Dutchess Co NY)',
               notes = COALESCE(notes,'') || $5, updated_at=now()
             WHERE id=$1`, [EDGE_ID, wCanon, sCanon, CREATED_BY, note]);
          flipped = true;
          console.log(`\n✓ edge #${EDGE_ID} flipped verified=true, repointed to canonical#${wCanon} child_of canonical#${sCanon} (tier 2).`);
        } catch (e) { console.log(`   ⚠ repoint flip failed (${e.message.slice(0, 60)}) — trying in-place flip.`); }
      }
      if (!flipped) {
        await pool.query(
          `UPDATE canonical_family_edges SET evidence_tier=2, verified=TRUE, verified_by=$2, verified_at=now(),
             confidence=0.90, notes = COALESCE(notes,'') || $3, updated_at=now() WHERE id=$1`,
          [EDGE_ID, CREATED_BY, note]).then(() => { flipped = true; }).catch((e) => console.log(`   ⚠ in-place flip failed: ${e.message.slice(0, 80)}`));
        if (flipped) console.log(`\n✓ edge #${EDGE_ID} flipped verified=true in place (lead endpoints; canonical ids unavailable this run).`);
      }
      await logFinding(pool, { question: `Is the 1810 Dutchess "William Bard" enslaver the son of Samuel Bard (edge #${EDGE_ID})?`, repository: 'FamilySearch 1810 US Census + Bard genealogy', index_searched: 'Dutchess Co NY household, cross-ref genealogy b.1778', result: 'hit', hit_count: 1, subject_id: 3579211, note: `Operator-confirmed. Edge #${EDGE_ID} → verified=true, tier 2. William Bard (1810 Dutchess enslaver) = son of Samuel Bard; the enslaver lineage into Bard College founder John Bard is now census-corroborated.` });
    }
  }

  await pool.end();
  console.log('\n=== done ===');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
