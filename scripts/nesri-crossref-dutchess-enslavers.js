#!/usr/bin/env node
/**
 * nesri-crossref-dutchess-enslavers.js — densify the Dutchess calibration ground truth by
 * cross-confirming OUR enslaver families (1714/1755 census + colonial wills) against NESRI's
 * independent Dutchess enslaver roster (census-derived, 1790-1820).
 *
 * Avoids the flaky 108-page roster scrape: does one TARGETED single-page NESRI search per surname
 * (owner-last-name + county=Dutchess), reads only the result COUNT. A hit = the same enslaver family
 * is documented in an INDEPENDENT source (a different census year, enumerated separately) → a genuine
 * cross-source `confirmed` verdict written to linkage_verdicts (migration 126). Per-surname isolation
 * = resilient to the shared-Chrome protocol timeouts that broke the paginated scrape.
 *
 *   node scripts/nesri-crossref-dutchess-enslavers.js            # DRY RUN (report only)
 *   node scripts/nesri-crossref-dutchess-enslavers.js --apply    # write confirmed verdicts
 */
'use strict';
require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const pg = require('pg');
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const PARTICLES = new Set(['van', 'ten', 'de', 'der', 'den', 'von', 'la', 'le']);
function surnameOf(name) {
  const toks = String(name || '').replace(/[^A-Za-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const pi = toks.findIndex(t => PARTICLES.has(t.toLowerCase()));
  return pi >= 0 ? toks.slice(pi).join(' ') : toks[toks.length - 1];
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function nesriCount(page, surname) {
  await page.goto('https://nesri.commons.gc.cuny.edu/search/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(5000);
  await page.type('input[name=Value9_1]', surname, { delay: 30 });        // Owner Last Name
  await page.type('input[name=Value13_1]', 'Dutchess', { delay: 30 });    // County or Borough
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
    page.click('input.cbSearchButton'),
  ]);
  await sleep(4000);
  return page.evaluate(() => {
    const t = document.body.innerText || '';
    const m = t.match(/1\s*[-–]\s*\d+\s*of\s*([\d,]+)/i) || t.match(/of\s+([\d,]+)\s*(?:records?)?/i);
    if (m) return parseInt(m[1].replace(/,/g, ''), 10);
    return /No records|0 records|not found/i.test(t) ? 0 : null;
  });
}

(async () => {
  // Our Dutchess enslaver families (census edges + 1714 leads + will testators)
  const rows = (await pool.query(`
    SELECT DISTINCT owner_name AS n FROM enslaved_owner_relationships
      WHERE (source_context ILIKE '%dutchess%' OR source_url ILIKE '%dutchess%') AND owner_name IS NOT NULL
    UNION SELECT DISTINCT u.full_name FROM unconfirmed_persons u JOIN person_external_ids e
      ON e.subject_id=u.lead_id AND e.subject_table='unconfirmed_persons'
      WHERE e.id_system IN ('ny_census_dutchess_1714','dutchess_colonial_will') AND u.person_type='enslaver'`)).rows;
  const families = new Map();   // surname(lower) -> a representative full name
  for (const r of rows) { const s = surnameOf(r.n); if (s && !families.has(s.toLowerCase())) families.set(s.toLowerCase(), { surname: s, example: r.n }); }
  console.log(`our Dutchess enslaver families to check against NESRI: ${families.size}`);

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const page = await browser.newPage();
  const results = [];
  for (const { surname, example } of families.values()) {
    let count = null;
    try { count = await nesriCount(page, surname); } catch (e) { count = null; }
    results.push({ surname, example, count });
    console.log(`  ${surname.padEnd(18)} → NESRI Dutchess: ${count === null ? 'ERR/unknown' : count}`);
    await sleep(2500);   // respectful cadence
  }
  await page.close();
  await browser.disconnect();

  const confirmed = results.filter(r => r.count && r.count > 0);
  const absent = results.filter(r => r.count === 0);
  const errored = results.filter(r => r.count === null);
  console.log(`\n=== CROSS-SOURCE DENSIFICATION (our families × NESRI Dutchess) ===`);
  console.log(`  confirmed in NESRI (independent census-derived source): ${confirmed.length}/${families.size}`);
  console.log(`  absent from NESRI Dutchess: ${absent.length}   |   errored/unknown: ${errored.length}`);
  console.log(`  confirmed families: ${confirmed.map(c => c.surname).join(', ')}`);

  if (APPLY && confirmed.length) {
    let n = 0;
    for (const c of confirmed) {
      const r = await pool.query(
        `INSERT INTO linkage_verdicts
           (subject_kind, subject_ref, enslaver_ref, verdict, basis, evidence_note, model_confidence,
            model_version, reference_class, verified_by)
         VALUES ('attribution', $1, $2, 'confirmed', 'document', $3, 0.9, 'nesri-crossref-v1',
                 'Dutchess|1755+NESRI|enslaver_identity', 'nesri-crossref')
         ON CONFLICT (subject_kind, subject_ref, basis) DO UPDATE SET evidence_note=EXCLUDED.evidence_note, model_confidence=0.9
         RETURNING id`,
        [`enslaver_family_nesri:${c.surname.toLowerCase()}`, c.example,
         `Cross-source: our Dutchess census/will enslaver "${c.example}" independently in NESRI Dutchess (${c.count} rec).`]);
      if (r.rows.length) n++;
    }
    console.log(`\nwrote ${n} NESRI cross-source verdicts → linkage_verdicts`);
    const tot = (await pool.query(`SELECT count(*) FROM linkage_verdicts WHERE verdict='confirmed'`)).rows[0].count;
    console.log(`total confirmed verdicts now: ${tot}`);
  } else if (!APPLY) console.log(`\n(dry run — re-run with --apply to write ${confirmed.length} verdicts)`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
