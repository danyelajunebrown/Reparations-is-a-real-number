#!/usr/bin/env node
/**
 * Re-parse pass — apply the rebuilt probate entity extractor to the OCR text
 * already stored in person_documents, and write the structured results back.
 *
 * No re-scraping: works entirely off stored `ocr_text`. The extractor
 * (src/services/probate/probate-entity-extractor.js) was rebuilt and
 * spot-checked; the scraper's original inline regexes found a testator on 37%
 * of pages and produced 44 inheritance edges from 2,621 wills.
 *
 * What it writes (per phase):
 *   A  person_documents.name_as_appears, document_year  — UPDATE
 *   B  canonical_persons (testator, person_type 'enslaver') matched/created,
 *      person_documents.canonical_person_id linked
 *   C  inheritance_edges (testator -> heir); heir canonical_persons created
 *   D  unconfirmed_persons rows for enslaved persons named in wills/inventories
 *   E  estate value -> testator canonical_persons.notes (JSON merge)
 *
 * Document-level testator propagation: pages are grouped via probate_documents
 * (the segmenter's logical-document table); a testator found on any page of a
 * document is applied to every page of that document.
 *
 * DRY RUN by default — prints what each phase WOULD write, touches nothing.
 *   node scripts/reparse-probate-entities.mjs              # dry run
 *   node scripts/reparse-probate-entities.mjs --apply      # write
 *   node scripts/reparse-probate-entities.mjs --limit 800  # quick sample
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);
const { extractEntities } = require('../src/services/probate/probate-entity-extractor.js');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx !== -1 ? parseInt(args[limIdx + 1], 10) : 0;
const CREATED_BY = 'reparse-probate-entities';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  console.log(APPLY ? '=== Probate re-parse (APPLY — writing) ===' : '=== Probate re-parse (DRY RUN — no writes) ===');

  // ---- load probate pages + their segmented-document grouping --------------
  const pages = (await pool.query(
    `SELECT id, document_type, name_as_appears, document_year, canonical_person_id,
            collection_key, image_number, source_url, ocr_text
       FROM person_documents
      WHERE created_by = 'georgia-probate-scraper' AND ocr_text IS NOT NULL
      ORDER BY collection_key, image_number ${LIMIT ? `LIMIT ${LIMIT}` : ''}`
  )).rows;

  // page id -> logical document id (probate_documents). Pages not segmented
  // are their own single-page document keyed "solo:<page id>".
  const docOfPage = new Map();
  const segRows = (await pool.query(
    `SELECT id, person_document_ids FROM probate_documents`
  )).rows;
  for (const s of segRows) {
    for (const pid of s.person_document_ids || []) docOfPage.set(pid, `seg:${s.id}`);
  }

  // ---- run the extractor, group results by logical document ---------------
  const byPage = new Map();          // page id -> extraction
  const docs = new Map();            // doc key -> { pages:[], testator, year, heirs, enslaved, estateValue }
  for (const pg2 of pages) {
    const e = extractEntities(pg2.ocr_text);
    byPage.set(pg2.id, e);
    const dk = docOfPage.get(pg2.id) || `solo:${pg2.id}`;
    if (!docs.has(dk)) docs.set(dk, { pages: [], testator: null, year: null, heirs: [], enslaved: [], estateValue: null });
    const d = docs.get(dk);
    d.pages.push(pg2);
    if (!d.testator && e.testatorName) d.testator = e.testatorName;
    if (!d.year && e.year) d.year = e.year;
    if (!d.estateValue && e.estateValue) d.estateValue = e.estateValue;
    for (const h of e.heirs) d.heirs.push(h);
    for (const en of e.enslavedPersons) d.enslaved.push({ ...en, sourceUrl: pg2.source_url });
  }

  // ---- counters ------------------------------------------------------------
  const c = { nameUpd: 0, yearUpd: 0, testators: 0, links: 0, heirEdges: 0,
    enslaved: 0, estate: 0, cpCreated: 0, cpMatched: 0 };

  const client = APPLY ? await pool.connect() : null;
  if (client) await client.query('BEGIN');
  const q = (text, params) => (client ? client.query(text, params) : Promise.resolve({ rows: [] }));

  // match an existing Liberty canonical person by exact name, else create one.
  const cpCache = new Map();
  async function upsertCanonical(name, personType) {
    const key = `${name.toLowerCase()}|${personType}`;
    if (cpCache.has(key)) return cpCache.get(key);
    let id = null;
    if (APPLY) {
      const found = await q(
        `SELECT id FROM canonical_persons
          WHERE lower(canonical_name) = lower($1)
            AND primary_county = 'Liberty' AND primary_state IN ('GA','Georgia')
          ORDER BY (person_type = $2) DESC, id LIMIT 1`,
        [name, personType]
      );
      if (found.rows[0]) { id = found.rows[0].id; c.cpMatched++; }
      else {
        const parts = name.split(/\s+/);
        const ins = await q(
          `INSERT INTO canonical_persons
             (canonical_name, first_name, last_name, person_type, verification_status,
              primary_county, primary_state, created_by)
           VALUES ($1,$2,$3,$4,'pending_review','Liberty','Georgia',$5) RETURNING id`,
          [name, parts[0], parts[parts.length - 1], personType, CREATED_BY]
        );
        id = ins.rows[0].id; c.cpCreated++;
      }
    } else {
      c.cpCreated++; // dry run can't tell match vs create — count as a candidate
      id = -(cpCache.size + 1); // synthetic truthy id so dry-run flows through B-E
    }
    cpCache.set(key, id);
    return id;
  }

  // ---- per-document write --------------------------------------------------
  for (const [, d] of docs) {
    let testatorId = null;
    if (d.testator) {
      testatorId = await upsertCanonical(d.testator, 'enslaver');
      c.testators++;
    }

    for (const pg2 of d.pages) {
      // Phase A — name / year
      const wantName = d.testator && /^image\s+\d/i.test(pg2.name_as_appears || '');
      const wantYear = d.year && !pg2.document_year;
      if (wantName) c.nameUpd++;
      if (wantYear) c.yearUpd++;
      // Phase B — link page to testator person
      const wantLink = testatorId && !pg2.canonical_person_id;
      if (wantLink || wantName || wantYear) {
        if (APPLY) {
          await q(
            `UPDATE person_documents
                SET name_as_appears = COALESCE($2, name_as_appears),
                    document_year   = COALESCE($3, document_year),
                    canonical_person_id = COALESCE($4, canonical_person_id)
              WHERE id = $1`,
            [pg2.id, wantName ? d.testator : null, wantYear ? d.year : null,
             wantLink ? testatorId : null]
          );
        }
        if (wantLink) c.links++;
      }
    }

    if (!testatorId) continue; // edges / estate need a testator anchor

    // Phase C — inheritance edges
    const seenHeir = new Set();
    for (const h of d.heirs) {
      if (seenHeir.has(h.name.toLowerCase())) continue;
      seenHeir.add(h.name.toLowerCase());
      const heirId = await upsertCanonical(h.name, 'unknown');
      if (APPLY && heirId && heirId !== testatorId) {
        await q(
          `INSERT INTO inheritance_edges
             (testator_id, heir_id, relationship_to_testator, asset_type,
              document_year, evidence_tier, confidence, verified, created_at, updated_at)
           VALUES ($1,$2,$3,'unspecified',$4,2,0.75,false,NOW(),NOW())
           ON CONFLICT DO NOTHING`,
          [testatorId, heirId, h.relation, d.year]
        );
      }
      c.heirEdges++;
    }

    // Phase D — enslaved persons -> unconfirmed_persons
    const seenEnsl = new Set();
    for (const en of d.enslaved) {
      if (seenEnsl.has(en.name.toLowerCase())) continue;
      seenEnsl.add(en.name.toLowerCase());
      if (APPLY) {
        // unconfirmed_persons has no unique constraint — guard with NOT EXISTS
        // so re-running the pass does not duplicate enslaved rows.
        await q(
          `INSERT INTO unconfirmed_persons
             (full_name, person_type, source_url, source_type, extraction_method,
              context_text, status, created_at)
           SELECT $1,'enslaved',$2,'georgia_probate',$3,$4,'pending',NOW()
           WHERE NOT EXISTS (
             SELECT 1 FROM unconfirmed_persons
              WHERE full_name = $1 AND extraction_method = $3
                AND COALESCE(source_url,'') = COALESCE($2,''))`,
          [en.name, en.sourceUrl || '', CREATED_BY,
           `Named in ${d.testator}'s probate (Liberty Co. GA${d.year ? ', ' + d.year : ''})`
           + (en.value ? `; appraised $${en.value}` : '')]
        );
      }
      c.enslaved++;
    }

    // Phase E — estate value onto the testator's notes
    if (d.estateValue) {
      if (APPLY) {
        // idempotent — skip if a probate estate value is already noted.
        await q(
          `UPDATE canonical_persons
              SET notes = COALESCE(notes,'') || $2, updated_at = NOW()
            WHERE id = $1
              AND (notes IS NULL OR notes NOT LIKE '%[probate estate value:%')`,
          [testatorId, ` [probate estate value: $${d.estateValue}${d.year ? ' (' + d.year + ')' : ''}]`]
        );
      }
      c.estate++;
    }
  }

  if (client) { await client.query('COMMIT'); client.release(); }

  // ---- report --------------------------------------------------------------
  console.log(`\nPages processed : ${pages.length}`);
  console.log(`Logical docs    : ${docs.size}`);
  console.log(`\nPhase A — person_documents`);
  console.log(`  name_as_appears set : ${c.nameUpd}`);
  console.log(`  document_year set   : ${c.yearUpd}`);
  console.log(`Phase B — testator linkage`);
  console.log(`  documents with testator : ${c.testators}`);
  console.log(`  pages linked to a person: ${c.links}`);
  console.log(`Phase C — inheritance edges : ${c.heirEdges}`);
  console.log(`Phase D — enslaved persons  : ${c.enslaved}`);
  console.log(`Phase E — estate values     : ${c.estate}`);
  console.log(`canonical_persons ${APPLY ? `matched ${c.cpMatched}, created ${c.cpCreated}` : `≈${c.cpCreated} testator+heir names (match/create resolved on --apply)`}`);
  if (!APPLY) console.log('\nDry run — nothing written. Re-run with --apply to commit.');
  else console.log('\nApplied.');
  await pool.end();
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
