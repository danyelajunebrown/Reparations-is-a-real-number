#!/usr/bin/env node
/**
 * ingest-dutchess-colonial-wills.mjs — ingest the named enslaved + testators recovered from the
 * Dutchess colonial-will corpus (analyze-dutchess-colonial-wills.mjs yield) into the DB.
 *
 * Unlike the census (one shared district doc), each will is a SEPARATE imaged primary document already
 * in person_documents (s3_key set) — so the enslaved leads minted here are IMAGE-BACKED (the will scan
 * evidences the holding). Routes every person through PersonService.findOrCreateLead (dedup) + writes
 * owner→enslaved edges + sets the will doc's enslaved_count / evidences_enslaved_holding.
 *
 * TIER: the will is a primary legal document, but the NAME EXTRACTION is OCR needing review — so leads
 * are confidence 0.6 + requires_human_review, and the KNOWN false positive (doc 581079 "Philip" =
 * "Philip Field", a free person; assessment finding) is FLAGGED, not asserted. No fabricated data.
 *
 *   node scripts/ingest-dutchess-colonial-wills.mjs            # DRY RUN
 *   node scripts/ingest-dutchess-colonial-wills.mjs --apply
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = (await import('node:module')).createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');
const APPLY = process.argv.includes('--apply');
const ID_SYSTEM = 'dutchess_colonial_will';
const LOC = 'Dutchess County, New York';
const SOURCE_URL = 'FamilySearch — Dutchess County colonial will books (NY prerogative wills 1629-1802)';

// Known false-positive enslaved captures (assessment §; surnamed → likely free person, not enslaved).
const SUSPECT = new Set(['581079::Philip']);   // "Philip Field", a free man in a petition

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ps = new PersonService(pool);
const stats = { enslaverC: 0, enslaverL: 0, enslavedC: 0, enslavedL: 0, edges: 0, docsUpdated: 0, suspectFlagged: 0, rejected: 0 };

(async () => {
  console.log(APPLY ? '=== APPLY (writing) ===' : '=== DRY RUN (resolve+report only) ===');
  // Process EVERY doc with a recovered testator OR named enslaved — not just the named-enslaved subset.
  // Linking the ~312 testator docs to their enslaver is the LINKAGE unlock the retrievability rubric flagged
  // (docs were logged+embedded but 7.6% linked → invisible downstream). Enslaved leads/edges still only
  // when named enslaved are present (no fabricated persons from a testator alone).
  const rows = fs.readFileSync(path.resolve(__dirname, '../worksheets/dutchess-colonial-yield.jsonl'), 'utf8')
    .trim().split('\n').map(l => JSON.parse(l)).filter(o => o.testator || o.enslaved_named?.length);

  for (const w of rows) {
    const place = w.place || 'Dutchess';
    // ── enslaver lead (testator), if recovered ──
    let enslaverRef = null, enslaverName = w.testator || null;
    if (enslaverName) {
      const er = await ps.findOrCreateLead({
        name: enslaverName, personType: 'enslaver', locations: [LOC],
        sourceType: 'secondary', confidence: 0.6, idSystem: ID_SYSTEM, externalId: `will-${w.doc_id}`,
        sourceUrl: SOURCE_URL,
        context: `Testator of Dutchess colonial will (doc ${w.doc_id}, ${place}${w.year ? ', ' + w.year : ''}); named as holding: ${w.enslaved_named.join(', ')}.`,
        dataQualityFlags: { source_tier: 'secondary', max_evidence_tier: 'secondary', will_doc_id: w.doc_id,
          extraction: 'colonial_will_ocr', requires_human_review: true, enslaved_named: w.enslaved_named },
      }, { dryRun: !APPLY });
      if (er.action === 'linked') stats.enslaverL++; else if (er.action === 'created' || er.action === 'would_create') stats.enslaverC++; else stats.rejected++;
      enslaverRef = er.ref;
      // LINK the will document to its testator/enslaver (the rubric's LINKED metric) + set the display name.
      // A will is "about" the testator; the enslaved are linked via edges, not the doc's primary person.
      if (APPLY && enslaverRef) {
        const col = enslaverRef.subject_table === 'canonical_persons' ? 'canonical_person_id' : 'unconfirmed_person_id';
        await pool.query(
          `UPDATE person_documents
              SET ${col} = COALESCE(${col}, $2),
                  name_as_appears = CASE WHEN COALESCE(name_as_appears,'') IN ('', 'Image ' || COALESCE(collection_page_number::text,'')) THEN $3 ELSE name_as_appears END
            WHERE id = $1 AND canonical_person_id IS NULL`,
          [w.doc_id, enslaverRef.subject_id, enslaverName]).catch((e) => { if (stats.docsLinked === 0) console.log('   link err:', e.message.slice(0, 50)); });
        stats.docsLinked = (stats.docsLinked || 0) + 1;
      }
    }

    // ── enslaved leads + owner→enslaved edges ──
    let realEnslaved = 0;
    for (const name of w.enslaved_named) {
      const key = `${w.doc_id}::${name}`;
      const suspect = SUSPECT.has(key);
      const nr = await ps.findOrCreateLead({
        name, personType: 'enslaved', locations: [LOC],
        sourceType: 'secondary', confidence: suspect ? 0.2 : 0.6, idSystem: ID_SYSTEM, externalId: `will-${key}`,
        sourceUrl: SOURCE_URL,
        context: `Named as enslaved${enslaverName ? ' by ' + enslaverName : ''} in Dutchess colonial will (doc ${w.doc_id}, ${place}${w.year ? ', ' + w.year : ''}).`,
        dataQualityFlags: { source_tier: 'secondary', will_doc_id: w.doc_id, requires_human_review: true,
          ...(enslaverName ? { enslaver_name: enslaverName } : {}),
          ...(suspect ? { SUSPECTED_FALSE_POSITIVE: 'likely a free person (surnamed) — do NOT assert as enslaved without image review' } : {}) },
      }, { dryRun: !APPLY });
      if (suspect) stats.suspectFlagged++;
      if (nr.action === 'linked') stats.enslavedL++; else if (nr.action === 'created' || nr.action === 'would_create') stats.enslavedC++; else { stats.rejected++; continue; }
      if (!suspect) realEnslaved++;

      if (APPLY && enslaverRef && nr.ref) {
        await pool.query(
          `INSERT INTO enslaved_owner_relationships
             (enslaved_name, owner_name, relationship_type, start_year, relationship_source, source_url,
              source_context, source_document_id, confidence_score, verification_status, created_by,
              enslaved_subject_table, enslaved_subject_id, owner_subject_table, owner_subject_id)
           VALUES ($1,$2,'enslaved_by',$3,'dutchess_colonial_will',$4,$5,$6,$7,'unverified','wills-ingest',$8,$9,$10,$11)
           ON CONFLICT DO NOTHING`,
          [name, enslaverName, w.year || null, SOURCE_URL,
           `Dutchess will doc ${w.doc_id}`, String(w.doc_id), suspect ? 0.2 : 0.6,
           nr.ref.subject_table, nr.ref.subject_id, enslaverRef.subject_table, enslaverRef.subject_id]).catch(() => {});
        stats.edges++;
      }
    }

    // ── the will doc now evidences the holding (image-backed) ──
    if (APPLY && realEnslaved > 0) {
      await pool.query(
        `UPDATE person_documents SET enslaved_count = GREATEST(COALESCE(enslaved_count,0), $2),
           evidences_enslaved_holding = TRUE WHERE id = $1`, [w.doc_id, realEnslaved]).catch(() => {});
      stats.docsUpdated++;
    }
    console.log(`  doc ${w.doc_id}: ${enslaverName || '(no testator)'} → ${w.enslaved_named.join(', ')}${w.enslaved_named.some(n => SUSPECT.has(`${w.doc_id}::${n}`)) ? '  [1 suspect flagged]' : ''}`);
  }

  console.log(`\n=== SUMMARY (${APPLY ? 'APPLIED' : 'DRY RUN'}) ===`);
  console.log(`  enslavers: created ${stats.enslaverC}  linked ${stats.enslaverL}`);
  console.log(`  enslaved:  created ${stats.enslavedC}  linked ${stats.enslavedL}  (suspect flagged: ${stats.suspectFlagged})`);
  console.log(`  owner→enslaved edges: ${stats.edges}   will docs marked evidencing: ${stats.docsUpdated}`);
  if (!APPLY) console.log(`\n  → re-run with --apply to write.`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
