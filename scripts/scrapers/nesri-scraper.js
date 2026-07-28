#!/usr/bin/env node
/**
 * nesri-scraper.js — scrape the Northeast/New York Slavery Records Index (NESRI) Caspio search.
 *
 * NESRI (nesri.commons.gc.cuny.edu, CUNY Graduate Center) indexes 94k enslavement records across 9
 * NE states (38k NY; ~2,406–2,569 Dutchess). Each record has 38 fields INCLUDING structured genealogy:
 * Owner name/dates, County/Locality, Enslaved-Person name/dates, a "REG" birth-registration Tag,
 * Number-of-Enslaved counts, Source Document, Comments, and — critically for the Dutchess calibration
 * study — Enslaved Person Family Code, Parent ID Codes, Sibling ID Codes, Spouse.
 *
 * WHY: measure the Parent-ID-Codes / Family-Code FILL RATE for Dutchess (the maternal-link availability
 * that gates the calibration case study), and pull the full county cohort. See
 * memory-bank/assessment-dutchess-calibration-case-study-jul19.md §6.2.
 *
 * COURTESY: NESRI is a public scholarly project. Prefer a DATA REQUEST to the team for a bulk CSV; this
 * scraper is the fallback (user-approved 2026-07-19). Runs RATE-LIMITED, read-only, connects to the
 * existing debug Chrome (:9222) in a NEW tab (never launches; never touches other tabs).
 *
 * The results are Caspio "list" cards rendered as concatenated "Label Value Label Value…" text with
 * non-standard classes; we parse by splitting each card on the KNOWN 38 field labels (reliable).
 *
 *   node scripts/scrapers/nesri-scraper.js --county Dutchess --max-pages 10 --out worksheets/nesri-dutchess.jsonl
 */
'use strict';
const puppeteer = require('puppeteer-extra');
const fs = require('fs');
const path = require('path');

const opt = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const COUNTY = opt('--county', 'Dutchess');
const STATE = opt('--state', 'NY');
const TAG = opt('--tag', null);          // e.g. REG (birth registration) — fills "Search Based on a Tag"
const BROWSER_URL = opt('--browser-url', 'http://127.0.0.1:9223');   // DEDICATED NESRI Chrome (not the FS :9222)
const MAX_PAGES = parseInt(opt('--max-pages', '10'), 10);
const OUT = opt('--out', `worksheets/nesri-${COUNTY.toLowerCase()}.jsonl`);
const PAGE_DELAY_MS = parseInt(opt('--delay', '4000'), 10);   // respectful cadence

// NESRI field labels, longest-first so multi-word labels win when splitting concatenated cards.
// NOTE: the RESULTS view uses different labels than the search FORM — e.g. "Enslaver Last Name"
// (not "Owner Last Name"), "Enslaver Code", "Enslaved Person Code" (not "…Unique Code"). Both sets
// are included so the parser captures result cards correctly (verified live 2026-07-19). The
// Parent/Family/Sibling ID-code + Spouse fields are searchable but NOT surfaced in results (empirically
// absent from every Dutchess card) — kept here only so they'd parse IF a detail view ever exposed them.
const FIELDS = [
  // results-view (what actually appears in cards)
  'Enslaver Code', 'Enslaver Last Name', 'Enslaver First Name', 'Enslaver Birth Year', 'Enslaver Death Year',
  'Enslaved Person Code', 'Enslaved Person Last Name', 'Enslaved Person First Name',
  'Enslaved Person Birth Year', 'Enslaved Person Death Year',
  // search-form / shared
  'Enslaved Person Unique Code', 'Enslaved Person Family Code', 'Enslaver Unique Code',
  'Unique NESRI Record Identifier', 'Record Type', 'Search Based on a Tag', 'Search Tag', 'Year of Record',
  'Owner Last Name', 'Owner First Name', 'Owner Birth Year', 'Owner Death Year', 'County or Borough',
  'Locality', 'Address of Owner or Name of House or Vessel', 'Cemetery', 'Number of Enslaved Persons',
  'Adult Male Enslaved Persons', 'Adult Female Enslaved Persons', 'Minor Male Enslaved Persons',
  'Minor Female Enslaved Persons', 'Number of All Persons',
  'Source Document', 'Website Address', 'Comments', 'Related State or Nation', 'Art Site', 'ShipName',
  'Cohort', 'Advocate Last name', 'Advocate First name', 'Sibling ID Codes', 'Parent ID Codes',
  'Enslaved Person Spouse', 'State',
].sort((a, b) => b.length - a.length);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Parse one card's innerText into {field: value} by splitting on the known labels. */
function parseCard(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  // Build a regex that finds each label; capture the text between a label and the next label.
  const labelAlt = FIELDS.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp('(' + labelAlt + ')\\s*(.*?)(?=(?:' + labelAlt + ')|$)', 'g');
  const rec = {}; let m;
  while ((m = re.exec(t)) !== null) {
    const key = m[1].replace(/\s+/g, ' ').trim();
    const val = (m[2] || '').trim();
    if (!(key in rec)) rec[key] = val;   // first occurrence wins
  }
  return rec;
}

async function scrape() {
  // protocolTimeout raised — the default 30s Runtime.callFunctionOn timeout was what killed long runs
  // on the shared Chrome. Dedicated :9223 + a generous protocol timeout = the 108-page pull completes.
  const browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null, protocolTimeout: 240000 });
  const page = await browser.newPage();
  const records = [];
  try {
    await page.goto('https://nesri.commons.gc.cuny.edu/search/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(9000);   // the Caspio deploy renders the form async — 8s was occasionally too tight
    if (COUNTY) { const f = await page.$('input[name=Value13_1]'); await f.click(); await f.type(COUNTY, { delay: 60 }); } // focus THEN type (blind type missed the field)
    if (TAG) { const t = await page.$('input[name=Value7_1]'); await t.click(); await t.type(TAG, { delay: 60 }); }
    // The Caspio search is AJAX — there is NO page navigation, so the old waitForNavigation() sat idle for
    // its full 25s timeout and desynced the run. Click and wait a fixed beat for the result set to render.
    await page.click('input.cbSearchButton');
    await sleep(12000);

    // Scrape the current results page into card texts + total-pages, via the whole-results-text split
    // on each record's leading "State XX Record Type" (Caspio list cards have non-standard classes).
    const scrapePage = () => page.evaluate(() => {
      const txt = document.body.innerText || '';
      const totM = txt.match(/Page\s+.*?of\s+([\d,]+)/i);
      const cntM = txt.match(/1\s*[-–]\s*\d+\s*of\s*([\d,]+)/i);
      const region = txt.split(/Records?\s*1\s*[-–]/)[1] || txt;
      const cards = region.split(/(?=State\s+(?:NY|CT|NJ|MA|ME|NH|RI|VT|PA)\s+Record Type)/)
        .map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 30 && /Record Type/.test(s));
      return { cards, totalPages: totM ? parseInt(totM[1].replace(/,/g, ''), 10) : null, count: cntM ? cntM[1] : null };
    });

    let totalPages = MAX_PAGES;
    for (let p = 1; p <= MAX_PAGES; p++) {
      const { cards, totalPages: tp, count } = await scrapePage();
      if (tp) totalPages = tp;
      for (const c of cards) records.push(parseCard(c));
      console.log(`  page ${p}/${Math.min(MAX_PAGES, totalPages)}: ${cards.length} cards${p === 1 && count ? ` (total records ${count}, ${totalPages} pages)` : ''}`);
      if (p >= Math.min(MAX_PAGES, totalPages)) break;
      // paginate via the reliable Caspio "jump to page N" field
      const jf = await page.$('input.cbResultSetJumpToTextField');
      if (!jf) break;
      await jf.click({ clickCount: 3 });
      await jf.type(String(p + 1), { delay: 50 });
      page.keyboard.press('Enter');   // AJAX paginate — no navigation; wait a fixed beat for re-render
      await sleep(PAGE_DELAY_MS + 4000);
    }
  } catch (e) { console.log('SCRAPE ERR:', e.message); }
  await page.close();
  await browser.disconnect();
  return records;
}

(async () => {
  console.log(`NESRI scrape: county=${COUNTY} state=${STATE} max-pages=${MAX_PAGES}`);
  const recs = await scrape();
  console.log(`\nparsed ${recs.length} records`);
  if (!recs.length) { console.log('no records parsed — results markup may have changed; inspect the page.'); return; }

  const nonEmpty = (v) => v != null && String(v).trim() !== '' && String(v).trim() !== '-';
  const rate = (f) => { const n = recs.filter(r => nonEmpty(r[f])).length; return `${n}/${recs.length} (${(100 * n / recs.length).toFixed(0)}%)`; };
  const byType = {};
  for (const r of recs) { const t = r['Record Type'] || '?'; byType[t] = (byType[t] || 0) + 1; }

  console.log('\n=== FILL RATES (the calibration-critical fields) ===');
  console.log('  Record Type breakdown:', JSON.stringify(byType));
  for (const f of ['Parent ID Codes', 'Enslaved Person Family Code', 'Sibling ID Codes',
    'Enslaved Person First Name', 'Owner Last Name', 'Year of Record', 'Search Based on a Tag',
    'Enslaved Person Spouse']) {
    console.log(`  ${f.padEnd(32)}: ${rate(f)}`);
  }
  // The maternal-link question, scoped to Enslaved-Person records:
  const ep = recs.filter(r => /enslaved person/i.test(r['Record Type'] || ''));
  if (ep.length) {
    const pc = ep.filter(r => nonEmpty(r['Parent ID Codes'])).length;
    const fc = ep.filter(r => nonEmpty(r['Enslaved Person Family Code'])).length;
    console.log(`\n  AMONG ${ep.length} Enslaved-Person records:`);
    console.log(`    Parent ID Codes populated:  ${pc}/${ep.length} (${(100 * pc / ep.length).toFixed(0)}%)  ← maternal-link fill rate`);
    console.log(`    Family Code populated:      ${fc}/${ep.length} (${(100 * fc / ep.length).toFixed(0)}%)`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\nwrote ${recs.length} records → ${OUT}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
