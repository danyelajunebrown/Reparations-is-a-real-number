// harvest-nas-scan-index.mjs — build a (inventory, folio) → scan index for the Nationaal Archief Suriname
// slave registers, so attach-suriname-scans.mjs matches LOCALLY (high recall) instead of name-search (~15%).
//
// Harvests Open Archives OAI-PMH set=nas (metadataPrefix oai_a2a, 150/page, ~524K records), keeps the
// Slavenregister records, extracts RegistryNumber (=IISG Inventory_number) + Folio + the IIIF UriViewer,
// and writes a JSON map { "inv|folio": uriViewer }. Dedupes per folio (the folio image is shared). Then
// the drip loads this + local-joins the 13,683 IISG folios → ~near-100% recall. Politeness: ~4 req/s.
//
// Usage: node scripts/harvest-nas-scan-index.mjs <out.json> [--max-pages N]

import fs from 'node:fs';

const OUT = process.argv[2] || '/tmp/nas_scan_index.json';
const mp = process.argv.indexOf('--max-pages'); const MAX_PAGES = mp > -1 ? +process.argv[mp + 1] : Infinity;
const UA = 'ReparationsResearch/1.0 (+non-commercial; db7613@bard.edu)';
const BASE = 'https://api.openarch.nl/oai-pmh/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = (s, t) => { const m = s.match(new RegExp(`<(?:\\w+:)?${t}\\b[^>]*>([^<]*)</(?:\\w+:)?${t}>`)); return m ? m[1].trim() : null; };

async function fetchXml(url, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (r.status === 503 || r.status === 429) { await sleep(3000 * i); continue; } if (!r.ok) throw new Error('http ' + r.status); return r.text(); }
    catch (e) { if (i === tries) throw e; await sleep(2000 * i); }
  }
}

async function main() {
  const index = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  let token = null, pages = 0, records = 0, slaveReg = 0, total = 0;
  do {
    const url = token
      ? `${BASE}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`
      : `${BASE}?verb=ListRecords&metadataPrefix=oai_a2a&set=nas`;
    let xml; try { xml = await fetchXml(url); } catch (e) { console.error('\nfetch fail (stopping, resumable):', e.message); break; }
    const recs = xml.split(/<record>/).slice(1);
    for (const rec of recs) {
      records++;
      // keep only slave-register source records
      const st = (rec.match(/SourceType[^>]*>([^<]*)/) || [])[1] || '';
      if (!/slavenregister/i.test(st) && !/slavenregister/i.test(rec)) continue;
      // find the SourceReference block fields + the scan UriViewer
      const inv = tag(rec, 'RegistryNumber') || tag(rec, 'InventoryNumber');
      const folio = tag(rec, 'Folio');
      let uv = tag(rec, 'UriViewer');
      if (!inv || !folio || !uv) continue;
      uv = uv.replace(/\\\//g, '/').replace(/&amp;/g, '&');
      const k = `${inv}|${folio}`;
      if (!index[k]) { index[k] = uv; slaveReg++; }
    }
    const tm = xml.match(/<resumptionToken[^>]*completeListSize="(\d+)"[^>]*>([^<]*)</);
    if (tm) { total = +tm[1]; token = tm[2] || null; } else { token = (xml.match(/<resumptionToken[^>]*>([^<]*)</) || [])[1] || null; }
    pages++;
    if (pages % 20 === 0) { fs.writeFileSync(OUT, JSON.stringify(index)); process.stdout.write(`\r  pages ${pages}, records ${records}/${total || '?'}, distinct folios ${Object.keys(index).length}   `); }
    if (pages >= MAX_PAGES) break;
    await sleep(250);
  } while (token);
  fs.writeFileSync(OUT, JSON.stringify(index));
  console.log(`\nDone: ${pages} pages, ${records} records scanned, ${Object.keys(index).length} distinct (inv,folio) scans → ${OUT}`);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
