#!/usr/bin/env node
/**
 * ingest-ny-slave-census.mjs — file-first ingest of the O'Callaghan NY slave censuses
 * (1714 Dutchess household census + 1755 Census of Slaves, Dutchess + Westchester).
 *
 * Both are SECONDARY sources (published 19th-c transcriptions of colonial census manuscripts) →
 * leads at confidence 0.85, max_evidence_tier secondary, product-specific id_system. Follows
 * standard-external-source-ingest.md + standard-file-first-document-archival.md:
 *   1. ARCHIVE the source file → S3 + Wayback + source_artifacts (rule 8 dual-archive).
 *   2. person_documents per DISTRICT (ocr_text = faithful transcription) — the RAG-embeddable evidence.
 *   3. Route EVERY person through PersonService.findOrCreateLead (DEDUP — repairs the existing junk
 *      Hoffman/Ten Broeck rows instead of duplicating them). Enslavers + (1755) named enslaved.
 *   4. owner→enslaved edges (enslaved_owner_relationships, polymorphic → lead-aware).
 *   5. COUNT-only rows (1714, + Pelham/Mamaroneck/Rye/Horton 1755): enslaver + documented count,
 *      NO fabricated "unnamed enslaved" rows (audit rule: real or absent).
 *   6. EMBED phase (RULE 0.5) — queued: needs nomic on the Mini ollama (offline). Prints the command.
 *
 * Per-stratum validation (standard rule 2): each district's enslaved sum is checked against the
 * transcription's stated total; a mismatch BLOCKS that district.
 *
 *   node scripts/ingest-ny-slave-census.mjs                 # DRY RUN (default) — resolve + report, no writes
 *   node scripts/ingest-ny-slave-census.mjs --apply         # execute
 *   node scripts/ingest-ny-slave-census.mjs --county Dutchess --apply
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = (await import('node:module')).createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');
const S3 = require('../src/services/storage/S3Service');
const { ensureSnapshot } = await import('./lib/wayback.mjs');

const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const ONLY_COUNTY = arg('--county');
const DATA = path.resolve(__dirname, '../data/census');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ps = new PersonService(pool);

const stats = { enslaverLinked: 0, enslaverCreated: 0, enslavedLinked: 0, enslavedCreated: 0,
  edges: 0, countRows: 0, districts: 0, docs: 0, blockedDistricts: 0, rejected: 0 };

/** Archive a local source file → S3 + Wayback + source_artifacts. Returns the s3_key (or null in dry-run). */
async function archiveSource({ localPath, s3Key, datasetLabel, sourceName, sourceUrl, contentType, recordCount }) {
  if (!fs.existsSync(localPath)) { console.log(`  ⚠ source file missing: ${localPath} — skipping archive (leads still cite source_url)`); return null; }
  const buf = fs.readFileSync(localPath);
  if (buf.length < 1024) { console.log(`  ⚠ source file < 1KB (${buf.length}b) — soft-block, not archiving`); return null; }
  if (!APPLY) { console.log(`  [dry] would archive ${localPath} (${(buf.length/1024).toFixed(0)}KB) → s3://.../${s3Key} + Wayback(${sourceUrl})`); return s3Key; }
  await S3.upload(s3Key, buf, contentType, { sha256: sha(buf), source: sourceUrl });
  const wb = await ensureSnapshot(sourceUrl);
  await pool.query(
    `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_key, wayback_url, sha256, bytes, content_type, license, rehostable, record_count, retrieved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'public domain (pre-1928 / USGenWeb non-commercial)',TRUE,$10,NOW())
     ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key, wayback_url=EXCLUDED.wayback_url, record_count=EXCLUDED.record_count`,
    [`census-${slug(datasetLabel)}`, datasetLabel, sourceName, sourceUrl, s3Key, wb, sha(buf), buf.length, contentType, recordCount]);
  console.log(`  ✓ archived ${(buf.length/1024).toFixed(0)}KB → ${s3Key}  Wayback:${wb ? 'yes' : 'no'}`);
  return s3Key;
}

/** One person_documents row per district — the RAG-embeddable evidence page. Returns doc id (or null). */
async function upsertDistrictDoc({ src, d, ocrText, enslavedTotal, s3Key }) {
  const nameAsAppears = `${src.title} — ${d.county} Co. — ${d.district}`;
  if (!APPLY) { stats.docs++; return null; }
  const r = await pool.query(
    `INSERT INTO person_documents
       (name_as_appears, document_type, collection_name, collection_key, source_type, source_url, s3_key,
        ocr_text, document_year, person_type, evidences_enslaved_holding, enslaved_count, enslaved_count_partial, created_by)
     VALUES ($1,'census_slave_schedule',$2,$3,'secondary',$4,$5,$6,$7,'enslaver',TRUE,$8,$9,'ny-census-ingest')
     RETURNING id`,
    [nameAsAppears, src.title, src.id_system, src.source_url, s3Key, ocrText, src.year, enslavedTotal,
     !!d.counts_partial]);
  stats.docs++;
  return r.rows[0].id;
}

/** Faithful per-household transcription text for a district (goes into ocr_text → RAG). */
function districtOcr(src, d) {
  const lines = [`${src.title}. ${d.county} County, NY. ${d.district}.`];
  if (d.taken_by) lines.push(`Taken by ${d.taken_by}${d.date ? ', ' + d.date : ''}.`);
  const rows = d.households || d.slaveholding_households || [];
  for (const h of rows) {
    if (h.enslaved && h.enslaved.length) {
      lines.push(`${h.enslaver}${h.enslaver_title ? ' (' + h.enslaver_title + ')' : ''}: ` +
        h.enslaved.map(e => `${e.name}${e.sex ? ' [' + e.sex + ']' : ''}${e.age ? ' age ' + e.age : ''}`).join(', '));
    } else {
      const c = h.counts || {};
      const tot = h.enslaved_total ?? ((c.male || c.m_over16 || 0));
      lines.push(`${h.enslaver}${h.enslaver_title ? ' (' + h.enslaver_title + ')' : ''}: ${tot} enslaved (count only, unnamed in source).`);
    }
  }
  return lines.join('\n');
}

async function ingestHousehold({ src, d, h, docId, enslaverLoc, censusYear }) {
  const dslug = slug(d.district);
  const enslaverKey = h.row_key || `${src.year}-${slug(d.county)}-${dslug}-${slug(h.enslaver)}`;
  const enslavedTotal = h.enslaved_total ?? (h.enslaved ? h.enslaved.length : (h.counts ? Object.values(h.counts).reduce((a, b) => a + b, 0) : 0));
  const ctx = h.enslaved && h.enslaved.length
    ? `Named in ${src.title} (${d.district}, ${d.county} Co. NY) as holding: ${h.enslaved.map(e => e.name).join(', ')}.`
    : `Named in ${src.title} (${d.district}, ${d.county} Co. NY) as holding ${enslavedTotal} enslaved (count only; unnamed in source).`;

  // ── Enslaver lead (dedup via resolve) ─────────────────────────────────────
  const er = await ps.findOrCreateLead({
    name: h.enslaver, personType: 'enslaver', locations: [enslaverLoc],
    sourceType: 'secondary', confidence: 0.85, idSystem: src.id_system, externalId: enslaverKey,
    sourceUrl: src.source_url, context: ctx,
    dataQualityFlags: { source_tier: 'secondary', max_evidence_tier: 'secondary', census_year: src.year,
      enslaved_count_documented: enslavedTotal, ...(h.flags ? { transcription_flags: h.flags } : {}) },
  }, { dryRun: !APPLY });
  if (er.action === 'linked') stats.enslaverLinked++;
  else if (er.action === 'created' || er.action === 'would_create') stats.enslaverCreated++;
  else stats.rejected++;
  if (h.flags?.includes('estate_not_a_living_person')) { /* still recorded, flagged; promotion will quarantine */ }

  // ── Named enslaved (1755) → leads + owner edges ───────────────────────────
  if (h.enslaved && h.enslaved.length) {
    for (const e of h.enslaved) {
      const ekey = `${enslaverKey}::${slug(e.name)}`;
      const nr = await ps.findOrCreateLead({
        name: e.name, personType: 'enslaved', sex: e.sex || null, locations: [enslaverLoc],
        sourceType: 'secondary', confidence: 0.85, idSystem: src.id_system, externalId: ekey,
        sourceUrl: src.source_url,
        context: `Named as enslaved by ${h.enslaver} in ${src.title} (${d.district}, ${d.county} Co. NY, ${src.year})${e.age ? ', age ' + e.age : ''}.`,
        dataQualityFlags: { source_tier: 'secondary', census_year: src.year, enslaver_name: h.enslaver,
          ...(e.age ? { age_in_census: e.age } : {}), ...(e.flags ? { transcription_flags: e.flags } : {}) },
      }, { dryRun: !APPLY });
      if (nr.action === 'linked') stats.enslavedLinked++;
      else if (nr.action === 'created' || nr.action === 'would_create') stats.enslavedCreated++;
      else { stats.rejected++; continue; }

      if (APPLY && er.ref && nr.ref) {
        await pool.query(
          `INSERT INTO enslaved_owner_relationships
             (enslaved_name, owner_name, relationship_type, start_year, relationship_source, source_url,
              source_context, confidence_score, verification_status, created_by,
              enslaved_subject_table, enslaved_subject_id, owner_subject_table, owner_subject_id)
           VALUES ($1,$2,'enslaved_by',$3,'ny_slave_census',$4,$5,0.85,'unverified','ny-census-ingest',$6,$7,$8,$9)
           ON CONFLICT DO NOTHING`,
          [e.name, h.enslaver, censusYear, src.source_url, ctx,
           nr.ref.subject_table, nr.ref.subject_id, er.ref.subject_table, er.ref.subject_id]).catch((x) => {
             console.log(`    edge skip (${e.name}→${h.enslaver}): ${x.message.slice(0, 60)}`); });
        stats.edges++;
      }
    }
  } else {
    stats.countRows++;   // count-only: the documented count lives on the enslaver lead's flags + doc
  }
}

async function ingestSource(src, districts) {
  console.log(`\n════ ${src.title} ════  (tier=secondary conf=0.85 id_system=${src.id_system})`);
  const s3Key = await archiveSource(src._archive);

  for (const d of districts) {
    if (ONLY_COUNTY && d.county.toLowerCase() !== ONLY_COUNTY.toLowerCase()) continue;
    const rows = d.households || d.slaveholding_households || [];
    // per-stratum sum validation (standard rule 2)
    const summed = rows.reduce((a, h) => a + (h.enslaved_total ?? (h.enslaved ? h.enslaved.length : 0)), 0);
    if (d.stated_total != null && summed !== d.stated_total && !d.counts_partial) {
      console.log(`  ✗ BLOCK district "${d.district}": summed ${summed} ≠ stated ${d.stated_total}`); stats.blockedDistricts++; continue;
    }
    stats.districts++;
    const enslaverLoc = `${d.county} County, New York`;
    const ocr = districtOcr(src, d);
    const docId = await upsertDistrictDoc({ src, d, ocrText: ocr, enslavedTotal: summed, s3Key });
    const named = rows.filter(h => h.enslaved && h.enslaved.length).length;
    const cnt = rows.length - named;
    console.log(`  ${d.county} · ${d.district}: ${rows.length} enslavers (${named} named-holders, ${cnt} count-only), ${summed} enslaved${d.counts_only ? ' [counts]' : ''}`);
    for (const h of rows) await ingestHousehold({ src, d, h, docId, enslaverLoc, censusYear: src.year });
  }
}

(async () => {
  console.log(APPLY ? '=== APPLY (writing) ===' : '=== DRY RUN (no writes; resolve+report only) ===');

  // 1714 Dutchess (counts only)
  const j1714 = JSON.parse(fs.readFileSync(path.join(DATA, 'dutchess-1714.json'), 'utf8'));
  const src1714 = { ...j1714.source,
    _archive: { localPath: path.join(DATA, 'dutchess-1714-source.txt'),
      s3Key: 'sources/census/dutchess-1714.txt', datasetLabel: '1714 Census of Dutchess County',
      sourceName: j1714.source.publication, sourceUrl: j1714.source.source_url,
      contentType: 'text/plain', recordCount: j1714.slaveholding_households.length } };
  await ingestSource(src1714, [{
    county: 'Dutchess', district: 'Dutchess County (household census)', counts_only: true,
    slaveholding_households: j1714.slaveholding_households }]);

  // 1755 Census of Slaves (Dutchess + Westchester)
  const j1755 = JSON.parse(fs.readFileSync(path.join(DATA, 'census-of-slaves-1755.json'), 'utf8'));
  const src1755 = { ...j1755.source,
    _archive: { localPath: path.resolve(process.env.HOME, 'Downloads/1755-Dutchess-Slave-Census.pdf'),
      s3Key: 'sources/census/census-of-slaves-1755.pdf', datasetLabel: '1755 Census of Slaves',
      sourceName: j1755.source.publication, sourceUrl: j1755.source.source_url,
      contentType: 'application/pdf', recordCount: j1755.districts.reduce((a, d) => a + (d.households?.length || 0), 0) } };
  await ingestSource(src1755, j1755.districts);

  console.log(`\n=== SUMMARY (${APPLY ? 'APPLIED' : 'DRY RUN'}) ===`);
  console.log(`  districts:            ${stats.districts}   (blocked: ${stats.blockedDistricts})`);
  console.log(`  district docs:        ${stats.docs}`);
  console.log(`  enslavers:            created ${stats.enslaverCreated}  linked(dedup) ${stats.enslaverLinked}`);
  console.log(`  named enslaved:       created ${stats.enslavedCreated}  linked(dedup) ${stats.enslavedLinked}`);
  console.log(`  owner→enslaved edges: ${stats.edges}`);
  console.log(`  count-only holders:   ${stats.countRows}   (documented count, no named rows)`);
  console.log(`  rejected (no name):   ${stats.rejected}`);
  if (!APPLY) console.log(`\n  → re-run with --apply to write. EMBED phase (RULE 0.5) then: node scripts/embed-documents.mjs (needs Mini nomic/ollama).`);
  await pool.end();
})().catch(e => { console.error('INGEST_ERROR', e); process.exit(1); });
