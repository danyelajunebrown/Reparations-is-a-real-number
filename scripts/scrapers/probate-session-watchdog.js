/**
 * probate-session-watchdog.js — SELF-HEALING session keeper for the NY probate scraper.
 *
 * The scraper stalls silently when the FamilySearch session expires ("SESSION LOST … PAUSING navigation")
 * or when waypoints return zero county links — both symptoms of an expired jar. The existing
 * probate-scrape-watchdog only SIGSTOPs + notifies (awaits a human). This one HEALS:
 *   every INTERVAL, if the scraper is stalled (recent SESSION LOST / PAUSING / zero-links in the log, or the
 *   process is gone) →
 *     • probe the live debug-Chrome (:9222): is it still logged into FamilySearch?
 *         - YES → re-capture the cookie jar from it (_capture-fs-cookies.js) + restart the scraper
 *                 (--apply --resume, truncating the log so stale SESSION-LOST lines don't re-trigger us).
 *         - NO  → notify (ntfy) that a human must VNC in and sign into FS; do NOT restart (would re-fail).
 * Idempotent-ish: only acts on a genuine stall; logs every action.
 *
 * Run via PM2 (survives reboots):
 *   pm2 start scripts/scrapers/probate-session-watchdog.js --name probate-session-heal-ny -- --collection 1920234
 */

'use strict';
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const pptr = require('puppeteer-extra');
let notify; try { ({ notify } = require('../../src/utils/notify')); } catch { notify = async () => {}; }

const opt = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const COLLECTION = opt('--collection', '1920234');
const LABEL = opt('--label', 'NYprobate');
const LOG = opt('--log', path.join(os.homedir(), 'probate-newyork-full.log'));
const NODE = '/usr/local/bin/node';
const SCRAPER = 'scripts/scrapers/georgia-probate-scraper.js';
const INTERVAL_MS = parseInt(opt('--interval-min', '5'), 10) * 60 * 1000;
const PROC = `georgia-probate-scraper.js.*${COLLECTION}`;
const RESTART = `nohup ${NODE} ${SCRAPER} --collection ${COLLECTION} --label ${LABEL} --apply --resume --log ${LOG} > ${LOG} 2>&1 &`;

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const sh = (c) => { try { return execSync(c, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const scraperPid = () => sh(`pgrep -f '${PROC}' || true`);
const tail = (n) => sh(`tail -${n} ${LOG} 2>/dev/null || true`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chromeLoggedIn() {
  try {
    const b = await pptr.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const pg = await b.newPage();
    await pg.goto('https://www.familysearch.org/tree/overview', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
    await sleep(3000);
    const u = pg.url();
    await pg.close().catch(() => {});
    await b.disconnect();
    return !/login|ident|signin/i.test(u);
  } catch (e) { log('chrome probe error', e.message); return false; }
}

let healCount = 0;
async function check() {
  const t = tail(25);
  const sessionIssue = /SESSION LOST|PAUSING navigation|zero county links/i.test(t);
  const pid = scraperPid();
  if (pid && !sessionIssue) { log('healthy — scraper', pid, 'progressing'); return; }

  log('STALL', pid ? `(pid ${pid} paused on session issue)` : '(process gone)');
  const loggedIn = await chromeLoggedIn();
  if (loggedIn) {
    log('live Chrome IS logged in → re-capturing jar + restarting');
    sh(`${NODE} scripts/scrapers/_capture-fs-cookies.js`);
    sh(`pkill -f '${PROC}' || true`);
    await sleep(2500);
    execSync(RESTART, { stdio: 'ignore', shell: '/bin/bash' });
    await sleep(1500);
    healCount++;
    await notify(`${LABEL}: SELF-HEALED — re-captured FS jar + restarted scraper (heal #${healCount}).`, { severity: 'default', title: 'probate self-heal', tags: ['scraper', 'probate', 'heal'] }).catch(() => {});
  } else {
    log('live Chrome LOGGED OUT → cannot self-heal, notifying');
    await notify(`${LABEL}: STALLED — FamilySearch is logged OUT. VNC into the :9222 Chrome scraper tab (vnc://100.114.130.16) and sign in; I will auto-restart within ${INTERVAL_MS / 60000}m.`, { severity: 'high', title: 'probate NEEDS FS LOGIN', tags: ['scraper', 'probate', 'warning'] }).catch(() => {});
  }
}

log(`probate-session-watchdog up — ${LABEL} (collection ${COLLECTION}), interval ${INTERVAL_MS / 60000}m, log ${LOG}`);
setInterval(() => check().catch((e) => log('check error', e.message)), INTERVAL_MS);
check().catch((e) => log('initial check error', e.message));
