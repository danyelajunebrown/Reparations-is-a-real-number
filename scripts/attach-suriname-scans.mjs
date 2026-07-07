// attach-suriname-scans.mjs — the SCAN-ATTACH DRIP for Suriname (#137, RULE 0.6: a canonical must serve
// an image). Resolves each person's register-page SCAN and attaches it to the lead's person_documents,
// so promotion inherits gate-lifting primary evidence. LEAD-capable (person_documents.unconfirmed_person_id).
//
// PIPELINE (all verified): IISG CSV Folio+Inventory → Open Archives 'nas' record (match SourceReference
// Folio+RegistryNumber) → Scan.UriViewer (IIIF, service.archief.nl) → {base}.jp2/full/1200,/0/default.jpg
// → S3 (`sources/hdsc-suriname/scans/`) → person_documents (document_type='slave_register').
//
// EFFICIENT: resolves ONCE per distinct (inventory, folio) — the folio page is shared by all persons on
// it — and attaches to every Suriname lead on that folio. Rule 8: scan image re-hosted to S3; the nas
// collection page is Wayback-snapshotted ONCE (per-scan Wayback would hammer IA). Politeness: ≤4 req/s.
// Resumable: skips folios whose leads already have a slave_register doc.
//
// Usage: node scripts/attach-suriname-scans.mjs <csv> [--limit N] [--apply]   (default dry-run)

import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { parse } from 'csv-parse';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';

const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
const li = process.argv.indexOf('--limit'); const LIMIT = li > -1 ? +process.argv[li + 1] : Infinity;
const ii = process.argv.indexOf('--index'); const INDEX_PATH = ii > -1 ? process.argv[ii + 1] : null;
if (!FILE || !fs.existsSync(FILE)) { console.error('usage: node scripts/attach-suriname-scans.mjs <csv> [--index nas_scan_index.json] [--limit N] [--apply]'); process.exit(1); }
// High-recall LOCAL matching: (inventory|folio) → IIIF UriViewer, harvested by harvest-nas-scan-index.mjs.
const SCAN_INDEX = INDEX_PATH && fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) : null;

const UA = 'ReparationsResearch/1.0 (+non-commercial; db7613@bard.edu)';
const NAS_COLLECTION = 'https://www.nationaalarchief.nl/onderzoeken/index/nt00461';
const clean = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(url) { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }
function findScan(o) { if (o && typeof o === 'object') { if (o.UriViewer) return o; for (const v of Object.values(o)) { const r = findScan(v); if (r) return r; } } return null; }
function srcRef(rec) { const out = {}; (function w(o) { if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) { if (['Folio', 'RegistryNumber', 'Book'].includes(k) && typeof v === 'string') out[k] = v; else w(v); } } })(rec); return out; }

// Resolve the nas scan for (inventory, folio) by searching a sample name, matching SourceReference.
async function resolveScan(name, inventory, folio) {
  const q = encodeURIComponent(clean(name).split(' ')[0] || name);
  const search = await j(`https://api.openarch.nl/1.1/records/search.json?name=${q}&archive=nas&sourcetype=Slavenregister&number_show=25`);
  const docs = search?.response?.docs || [];
  for (const d of docs.slice(0, 8)) {
    await sleep(260);
    let rec; try { rec = await j(`https://api.openarch.nl/1.1/records/show.json?archive=nas&identifier=${d.identifier}`); } catch { continue; }
    const ref = srcRef(rec);
    if (String(ref.Folio) === String(folio) && String(ref.RegistryNumber) === String(inventory)) {
      const scan = findScan(rec); if (scan?.UriViewer) return { uriViewer: scan.UriViewer.replace(/\\\//g, '/'), recordUrl: d.uri || NAS_COLLECTION };
    }
  }
  return null;
}
async function fetchScanImage(uriViewer) {
  const base = uriViewer.replace(/\/info\.json$/, '');
  const r = await fetch(`${base}/full/1200,/0/default.jpg`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('iiif ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  // lead map: hdsc_person_id -> lead_id
  const leadMap = new Map();
  for (const r of (await pool.query(`SELECT external_id, subject_id FROM person_external_ids WHERE id_system='hdsc_suriname_slaveregister'`)).rows) leadMap.set(r.external_id, Number(r.subject_id));
  console.log(`leads: ${leadMap.size}`);
  // folio map from CSV: "inv|folio" -> { inventory, folio, sampleName, personIds[] }
  const folios = new Map();
  await new Promise((res, rej) => fs.createReadStream(FILE).pipe(parse({ columns: true, skip_empty_lines: true, relax_quotes: true }))
    .on('data', (r) => { const inv = clean(r.Inventory_number), fol = clean(r.Folio_number), id = clean(r.Id_person); if (!inv || !fol || !id) return; const k = inv + '|' + fol; let f = folios.get(k); if (!f) { f = { inventory: inv, folio: fol, sampleName: clean(r.Name_enslaved) || clean(r.First_name), ids: new Set() }; folios.set(k, f); } f.ids.add(id); })
    .on('end', res).on('error', rej));
  console.log(`distinct (inventory,folio) scans to resolve: ${folios.size}`);

  if (APPLY) { console.log('Wayback: nas collection page (rule 8, once)…'); const wb = await ensureSnapshot(NAS_COLLECTION); console.log(wb ? `  ✓ ${wb}` : '  soft-fail'); }

  const stats = { folios: 0, resolved: 0, unresolved: 0, scans_s3: 0, docs_attached: 0, skipped_done: 0, err: 0 };
  for (const [k, f] of folios) {
    if (stats.folios >= LIMIT) break;
    stats.folios++;
    const leadIds = [...f.ids].map((id) => leadMap.get(id)).filter(Boolean);
    if (!leadIds.length) continue;
    // resumable: skip if these leads already have a slave_register doc
    const done = (await pool.query(`SELECT 1 FROM person_documents WHERE unconfirmed_person_id = ANY($1::int[]) AND document_type='slave_register' LIMIT 1`, [leadIds])).rows.length;
    if (done) { stats.skipped_done++; continue; }
    let scan;
    if (SCAN_INDEX) {
      const uv = SCAN_INDEX[`${f.inventory}|${f.folio}`];
      scan = uv ? { uriViewer: uv.replace(/\\\//g, '/'), recordUrl: NAS_COLLECTION } : null;
    } else {
      try { scan = await resolveScan(f.sampleName, f.inventory, f.folio); } catch (e) { stats.err++; continue; }
      await sleep(260);
    }
    if (!scan) { stats.unresolved++; continue; }
    stats.resolved++;
    if (!APPLY) { if (stats.resolved <= 3) console.log(`  would attach folio ${k} (${leadIds.length} leads) ← ${scan.uriViewer.slice(0, 70)}…`); continue; }
    let buf; try { buf = await fetchScanImage(scan.uriViewer); } catch (e) { stats.err++; continue; }
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const s3Key = `sources/hdsc-suriname/scans/inv${f.inventory}-fol${f.folio}.jpg`;
    try { await S3.upload(s3Key, buf, 'image/jpeg', { sha256: sha, source: scan.recordUrl }); stats.scans_s3++; } catch (e) { stats.err++; continue; }
    for (const lid of leadIds) {
      const nm = clean(f.sampleName) || 'Suriname enslaved person';
      await pool.query(
        `INSERT INTO person_documents (unconfirmed_person_id, s3_key, source_url, name_as_appears, document_type, source_type_label, evidence_strength, evidences_enslaved_holding, enslaved_count_partial, created_by)
         VALUES ($1,$2,$3,$4,'slave_register','Suriname Slave Register (Nationaal Archief) 1830-1863','primary', FALSE, FALSE, 'attach-suriname-scans')
         ON CONFLICT DO NOTHING`, [lid, s3Key, scan.recordUrl, nm]).catch(() => {});
      stats.docs_attached++;
    }
    if (stats.resolved % 25 === 0) process.stdout.write(`\r  folios ${stats.folios}, resolved ${stats.resolved}, docs ${stats.docs_attached}   `);
    await sleep(300);   // politeness to service.archief.nl (IIIF) even in index mode
  }
  await pool.end();
  console.log('\n=== stats ===', JSON.stringify(stats));
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
