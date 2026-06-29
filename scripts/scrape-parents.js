#!/usr/bin/env node
/**
 * scrape-parents.js
 *
 * The climb walked parent links to reach 3,921 ancestors but never persisted
 * who-descends-from-whom. This re-queries each VISITED FamilySearch person and
 * records their PARENTS (fs id + name), giving the complete child->parent edge
 * set needed to rebuild the lineage tree (grouped by top/apical ancestor).
 *
 * Writes edges to inferred_parent_links:
 *   child_fs_id / child_name = the person we're on (an ancestor)
 *   parent_fs_id / parent_name = each parent found on their page
 *   discovery_method = 'details-parent-scrape'
 *
 * Resumable via worksheets/.parents-progress.json. Same login/cookie/recycle
 * pattern as resolve-climb-ancestors.js.
 *
 * Usage:
 *   HEADLESS=0 LIMIT=5 DIAG=1 node scripts/scrape-parents.js   # login + calibrate
 *   HEADLESS=1 LIMIT=0 node scripts/scrape-parents.js          # full run
 */
require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');

const sql = neon(process.env.DATABASE_URL);
const SID = process.env.SID || 'f4a5b049-30dc-437f-8d55-fe5d68d42115';
const FS_ID = process.env.FS_ID || 'P4RF-PFQ';   // Adrian — the participant (also scraped: their parents matter)
const LIMIT = parseInt(process.env.LIMIT || '0', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const DIAG = process.env.DIAG === '1';

const PERSON_URL = 'https://www.familysearch.org/en/tree/person/details/';
const COOKIES = './fs-climber-cookies.json';
const PROGRESS = './worksheets/.parents-progress.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadProgress() { try { return new Set(JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))); } catch { return new Set(); } }
function saveProgress(set) { try { fs.writeFileSync(PROGRESS, JSON.stringify([...set])); } catch (e) { console.error('progress save failed:', e.message); } }

async function applyCookies(page) {
  try { const c = JSON.parse(fs.readFileSync(COOKIES, 'utf8')); await page.setCookie(...c); return c.length; } catch { return 0; }
}
async function ensureLogin(page) {
  await page.goto(PERSON_URL + FS_ID, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  const url = page.url();
  if (url.includes('ident.familysearch') || url.includes('/auth/')) {
    if (HEADLESS) throw new Error('Login required but running headless. Re-run with HEADLESS=0 to log in once.');
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  LOG IN to FamilySearch in the browser window.       ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');
    for (let i = 0; i < 150; i++) { await sleep(2000); const u = page.url();
      if (u.includes('/tree/person/details/') && !u.includes('ident.familysearch') && !u.includes('/auth/')) break; }
    const c = await page.cookies(); fs.writeFileSync(COOKIES, JSON.stringify(c, null, 2));
    console.log(`✓ Logged in, saved ${c.length} fresh cookies\n`);
  } else { console.log('✓ Existing cookies still valid — logged in\n'); }
}

// Extract this person's PARENTS as [{fs_id, name}]. FamilySearch's details page
// renders family in data-testid attributes (no plain <a> links):
//   data-testid="family-<FATHERID>_<MOTHERID>"   the couple card
//   data-testid="focusPersonHighlight"           marks the focus person as a CHILD
// The card that contains focusPersonHighlight is the focus person's PARENTS'
// family (they appear there as a child/sibling). Its testid yields the parent
// ids; names come from the couple text block "Name / Sex / years / • / ID".
async function extractParents(page, fsId) {
  await page.goto(PERSON_URL + fsId, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Family card is lazy-mounted only when scrolled into view. Scroll down to
  // trigger it, then wait for the actual family-<f>_<m> card (not just the text).
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  } catch {}
  try {
    await page.waitForFunction(() => {
      const b = document.body.innerText || '';
      return !!document.querySelector('[data-testid^="family-"][data-testid*="_"]') ||
             !!document.querySelector('[data-testid="focusPersonHighlight"]') ||
             b.includes('Person Not Found') || b.includes('This person is living');
    }, { timeout: 22000, polling: 400 });
  } catch { /* settle anyway */ }
  await sleep(1800);

  return await page.evaluate((selfId) => {
    const body = document.body.innerText || '';
    if (body.includes('Person Not Found')) return { not_found: true, parents: [] };
    const IDRE = /[A-Z0-9]{4}-[A-Z0-9]{3,4}/;

    // name for a parent id from a card's text lines: ID line is preceded by
    // "Name\nSex\nyears\n•\nID"; grab the name a few lines above, skipping the
    // metadata lines.
    const nameNear = (lines, id) => {
      const idx = lines.findIndex(l => l.trim() === id);
      if (idx < 0) return null;
      for (let j = idx - 1; j >= Math.max(0, idx - 5); j--) {
        const t = lines[j].trim();
        if (!t || t === '•' || /^(Male|Female|Unknown sex)$/i.test(t) ||
            /^\d{3,4}\s*[–\-]\s*(\d{3,4}|Living|Deceased)?$/.test(t) ||
            /^Preferred$/i.test(t)) continue;
        return t;
      }
      return null;
    };

    // Find the family card(s) that contain the focus person as a child.
    const cards = Array.from(document.querySelectorAll('[data-testid^="family-"]'));
    let parents = [];
    for (const card of cards) {
      const tid = card.getAttribute('data-testid') || '';
      const m = tid.match(/^family-([A-Z0-9]{4}-[A-Z0-9]{3,4}|UNKNOWN)_([A-Z0-9]{4}-[A-Z0-9]{3,4}|UNKNOWN)$/i);
      if (!m) continue;
      const hasFocus = card.querySelector('[data-testid="focusPersonHighlight"]') ||
                       (card.innerText || '').includes(selfId);
      // the focus person's own marriages also produce family-<self>_<spouse> cards;
      // those have self as a PARENT in the testid — skip them.
      const ids = [m[1].toUpperCase(), m[2].toUpperCase()];
      if (ids.includes(selfId)) continue;            // this is focus-as-parent card
      if (!hasFocus) continue;                         // not the parents' card
      const lines = (card.innerText || '').split('\n');
      for (const pid of ids) {
        if (pid === 'UNKNOWN') continue;
        if (!parents.find(p => p.fs_id === pid))
          parents.push({ fs_id: pid, name: nameNear(lines, pid) });
      }
    }

    // Fallback: parse the "Parents and Siblings" text block directly.
    if (!parents.length) {
      const lines = body.split('\n').map(s => s.trim());
      const start = lines.findIndex(l => /^Parents and Siblings$/i.test(l));
      if (start >= 0) {
        const end = lines.findIndex((l, i) => i > start && /^Children\b|^No Marriage Events$|^Spouse/i.test(l));
        const seg = lines.slice(start + 1, end > start ? end : start + 14);
        for (let i = 0; i < seg.length; i++) {
          if (IDRE.test(seg[i]) && seg[i].trim().length <= 9) {
            const id = seg[i].trim();
            if (id === selfId) continue;
            if (!parents.find(p => p.fs_id === id)) parents.push({ fs_id: id, name: nameNear(seg, id) });
          }
        }
      }
    }
    // diag: list all family-card testids
    const _cards = cards.map(c => c.getAttribute('data-testid'));
    return { not_found: false, parents, _cards };
  }, fsId.toUpperCase());
}

async function saveEdges(childFs, childName, parents) {
  for (const par of parents) {
    if (!par.fs_id) continue;
    await sql`
      INSERT INTO inferred_parent_links
        (session_id, child_fs_id, child_name, parent_fs_id, parent_name, relationship, discovery_method, confidence, created_at)
      VALUES (${SID}::uuid, ${childFs}, ${childName || null}, ${par.fs_id}, ${par.name || null},
              'parent', 'details-parent-scrape', 0.9, NOW())`;
  }
}

async function buildWorklist() {
  const vs = await sql`SELECT visited_set v FROM ancestor_climb_sessions WHERE id=${SID}::uuid`;
  const visited = (vs[0].v || []).filter(Boolean);
  // names for child labels (from canonical)
  const names = await sql`
    SELECT pei.external_id fs, cp.canonical_name nm
    FROM person_external_ids pei JOIN canonical_persons cp ON cp.id=pei.canonical_person_id
    WHERE pei.id_system='familysearch' AND pei.external_id = ANY(${visited})`;
  const nameOf = new Map(); for (const r of names) if (!nameOf.has(r.fs)) nameOf.set(r.fs, r.nm);
  // already-scraped child ids for THIS method (so a re-run resumes)
  const done = await sql`SELECT DISTINCT child_fs_id fs FROM inferred_parent_links WHERE session_id=${SID}::uuid AND discovery_method='details-parent-scrape'`;
  const alreadyEdged = new Set(done.map(r => r.fs));
  return { visited, nameOf, alreadyEdged };
}

async function main() {
  const { visited, nameOf, alreadyEdged } = await buildWorklist();
  const processed = loadProgress();
  const todo = visited.filter(id => !processed.has(id) && !alreadyEdged.has(id));
  const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  console.log(`Session ${SID.slice(0,8)} · ${visited.length} visited · ${processed.size} progress-done · ${alreadyEdged.size} edge-done`);
  console.log(`This run: ${batch.length} persons · headless=${HEADLESS} · diag=${DIAG}\n`);
  if (!batch.length) { console.log('Nothing to do.'); return; }

  const browser = await puppeteer.launch({ headless: HEADLESS ? 'new' : false,
    defaultViewport: { width: 1366, height: 2200 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  let page = await browser.newPage();
  await applyCookies(page); await ensureLogin(page);

  const RECYCLE = 250;
  const recyclePage = async () => { try { await page.close(); } catch {} page = await browser.newPage(); await applyCookies(page); };

  const stats = { withParents: 0, noParents: 0, notfound: 0, err: 0, edges: 0 };
  for (let i = 0; i < batch.length; i++) {
    const fsId = batch[i];
    try {
      const r = await extractParents(page, fsId);
      if (r.not_found) stats.notfound++;
      else {
        await saveEdges(fsId, nameOf.get(fsId), r.parents);
        stats.edges += r.parents.length;
        if (r.parents.length) stats.withParents++; else stats.noParents++;
        if (DIAG) {
          console.log(`\n[${i+1}] ${fsId} ${nameOf.get(fsId) || ''}`);
          console.log('   parents:', r.parents.map(p => `${p.name}(${p.fs_id})`).join(' | ') || '(none)');
          console.log('   familyCards:', (r._cards||[]).join(' | ') || '(none)');
        } else if ((i+1) % 10 === 0) {
          console.log(`[${i+1}/${batch.length}] ${fsId} ${(nameOf.get(fsId)||'').slice(0,28).padEnd(28)} parents=${r.parents.length}`);
        }
      }
    } catch (e) {
      stats.err++; const msg = e.message || '';
      if (/Login required|ident\.familysearch|\/auth\//.test(msg)) { console.error('✗ session expired — stopping.'); break; }
      if ((i+1) % 10 === 0) console.error(`[${i+1}] ${fsId} err: ${msg.slice(0,60)}`);
    }
    processed.add(fsId);
    if ((i+1) % 10 === 0) saveProgress(processed);
    if ((i+1) % RECYCLE === 0) { saveProgress(processed); await recyclePage(); }
    await sleep(1400 + Math.floor((i % 7) * 180));
  }
  saveProgress(processed);
  await browser.close();
  console.log(`\n✓ Run done. withParents=${stats.withParents} noParents=${stats.noParents} not_found=${stats.notfound} err=${stats.err} edges=${stats.edges}`);
  console.log(`  Total progress: ${processed.size}/${visited.length}`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
