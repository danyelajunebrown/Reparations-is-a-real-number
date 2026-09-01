// nesri-jsonl-to-csv.mjs — bridge the card-scraper's JSONL (nesri-scraper.js output) into the CSV shape
// ingest-nesri-csv.mjs consumes (it maps columns by header name). The card scrape avoids Caspio's 250-row
// CSV-export cap (genealogy fields are empty for Dutchess anyway), so JSONL→CSV lets the full 2,572 flow
// through the tested ingest. Usage: node scripts/nesri-jsonl-to-csv.mjs <in.jsonl> <out.csv>

import fs from 'node:fs';
const [IN, OUT] = [process.argv[2], process.argv[3]];
if (!IN || !OUT || !fs.existsSync(IN)) { console.error('usage: nesri-jsonl-to-csv.mjs <in.jsonl> <out.csv>'); process.exit(1); }

const rows = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// column union across all records, preserving first-seen order
const cols = [];
for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
fs.writeFileSync(OUT, csv);
console.log(`wrote ${rows.length} rows × ${cols.length} cols → ${OUT}`);
