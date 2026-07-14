// public-record-bridge.mjs — LIVING-PERSON WORKAROUND (user directive 2026-07-14).
//
// FamilySearch hides the TREE PROFILE of living people ("[Unknown Name]"), which blocks the climb from
// reading a living grandparent's parent links. But INDEXED HISTORICAL RECORDS are public regardless of
// living status. With the participant's precise, consented data (name + birth year + birthplace + known
// spouse/children), we search public FS records, DISAMBIGUATE to the right person via known relatives, and
// extract the PARENTS — the (deceased, public) great-grandparents who ARE valid climb seeds. The matched
// record (marriage naming parents = tier 1; obituary = secondary; 1950 census co-residence = tier 1)
// doubles as the kinship document, so this bridge also produces the document-backed edge the edge-writer
// needs. Connects to the same logged-in Chrome (:9222) via puppeteer.connect (never launch).
//
// Usage: node scripts/climb/public-record-bridge.mjs   (reads the PIPER grandparents below)

import pptr from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
pptr.use(Stealth());

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Piper's grandparents + KNOWN family context from the consented intake (the disambiguators).
const GRANDPARENTS = [
  { label: 'GP4 Kathleen Elizabeth Piper', given: 'Kathleen', surname: 'Piper', birth: 1942, place: 'Mississippi',
    knownSpouse: ['Jerry Ralph Smith', 'Jerry R Smith'], knownChildren: ['Laura Smith Hill', 'Laura Hill'] },
  { label: 'GP2 Norma Jean Branch Hill', given: 'Norma', surname: 'Branch', birth: 1941, place: 'Mississippi',
    knownSpouse: ['Lloyd Rhea Hill', 'Lloyd Hill'], knownChildren: ['Thomas Alton Hill', 'Thomas Hill'], altSurname: 'Hill' },
  { label: 'GP1 Lloyd Rhea Hill', given: 'Lloyd', surname: 'Hill', birth: 1940, place: 'United States',
    knownSpouse: ['Norma Jean Branch Hill', 'Norma Branch', 'Norma Hill'], knownChildren: ['Thomas Alton Hill', 'Thomas Hill'] },
];

function searchUrl(gp, surname) {
  const p = new URLSearchParams({
    'q.givenName': gp.given, 'q.surname': surname,
    'q.birthLikePlace': gp.place, 'q.birthLikeDate.from': String(gp.birth - 2), 'q.birthLikeDate.to': String(gp.birth + 2),
    'f.recordCountry': 'United States',
  });
  return 'https://www.familysearch.org/search/record/results?' + p.toString();
}

async function scrapeResults(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="/ark:/61903/"]').forEach((a) => {
      const row = a.closest('tr, li, [class*="result"], [class*="Row"]') || a.parentElement;
      const txt = (row?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || seen.has(txt.slice(0, 50))) return;
      seen.add(txt.slice(0, 50));
      const ark = (a.href.match(/\/ark:\/61903\/[^?#"]+/) || [])[0] || null;
      // pull the labeled fields the results row exposes
      const grab = (label) => { const m = txt.match(new RegExp(label + '\\s+([^]*?)(?:Spouses|Children|Siblings|Parents|Birth|Marriage|Residence|Immigration|Death|More|$)', 'i')); return m ? m[1].trim().slice(0, 120) : null; };
      out.push({
        text: txt.slice(0, 220), ark,
        collection: (txt.match(/"([^"]+)"/) || [])[1] || null,
        parents: grab('Parents'), spouses: grab('Spouses'), children: grab('Children'),
        year: (txt.match(/\b(18|19|20)\d{2}\b/) || [])[0] || null,
      });
    });
    return out;
  }).catch(() => []);
}

function scoreMatch(gp, r) {
  const hay = norm(r.text);
  let score = 0; const why = [];
  for (const sp of gp.knownSpouse) if (hay.includes(norm(sp)) && norm(sp).length > 4) { score += 3; why.push('spouse:' + sp); break; }
  for (const ch of gp.knownChildren) if (hay.includes(norm(ch)) && norm(ch).length > 4) { score += 3; why.push('child:' + ch); break; }
  if (gp.birth && r.year && Math.abs(+r.year - gp.birth) <= 3) { score += 1; why.push('birthyr'); }
  if (/census/i.test(r.collection || '')) { score += 1; why.push('census'); }
  return { score, why };
}

async function main() {
  const b = await pptr.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const page = await b.newPage();
  for (const gp of GRANDPARENTS) {
    console.log(`\n=== ${gp.label} (b.${gp.birth}, ${gp.place}) — public-record bridge ===`);
    const surnames = [gp.surname, gp.altSurname].filter(Boolean);
    let allResults = [];
    for (const sn of surnames) {
      await page.goto(searchUrl(gp, sn), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(6000);
      const rows = await scrapeResults(page);
      allResults.push(...rows);
    }
    // rank by disambiguation score
    const scored = allResults.map((r) => ({ ...r, ...scoreMatch(gp, r) })).sort((a, b2) => b2.score - a.score);
    const strong = scored.filter((r) => r.score >= 3);
    console.log(`  ${allResults.length} public records; ${strong.length} disambiguated to THIS person (score≥3)`);
    const parents = new Set();
    for (const r of strong.slice(0, 6)) {
      console.log(`   [${r.score}] ${(r.collection || '?').slice(0, 45)} ${r.year || ''} — ${r.why.join(',')}`);
      if (r.parents) { console.log(`       Parents: ${r.parents}`); r.parents.split(/,|;|and /).map((x) => x.trim()).filter((x) => x.length > 3).forEach((x) => parents.add(x)); }
    }
    console.log(`  → GREAT-GRANDPARENT SEED(S) from public records: ${parents.size ? [...parents].join(' | ') : 'NONE FOUND (widen search)'}`);
  }
  await page.close().catch(() => {});
  await b.disconnect();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
