/**
 * Retroactively apply the improved probate forensic accounting to the
 * INDIVIDUAL, HAND-UPLOADED wills that predate the new county pipeline.
 *
 * The new pipeline (src/services/probate/probate-llm-extractor.js +
 * segmentation) was built for bulk county ingestion and never touched the
 * curated wills sitting in S3 (Hopewell family, Biscoe, Weaver). Those have
 * either NO OCR ("pending_ocr") or poor early handwriting OCR, and their
 * will_extractions rows carry ZERO forensic financials (no non-chattel,
 * liabilities, estate totals, or enslaved valuations) and null testators.
 *
 * This script, per hand-uploaded will:
 *   1. ensures good OCR — Cloud Vision DOCUMENT_TEXT_DETECTION on the S3 PDF
 *      when text is missing/short (or --reocr to force)
 *   2. runs the forensic extractor (extractEstate) → financials + entities
 *   3. supersedes the stale will_extractions row with the forensic one
 *   4. backfills the testator canonical person: death_year (will/probate year
 *      PROXY, labeled), location (parsed from the collection title)
 *   5. resolves heirs → canonical_persons + canonical_family_edges (so they
 *      show in the modal family graph)
 *   6. resolves named enslaved people → enslaved_individuals +
 *      slaveholding_relationships (documentary chain back to the will)
 *
 * inheritance_edges (testator → heir wealth transfer) are then produced by the
 * existing scripts/backfill-inheritance-edges-from-will-extractions.js, which
 * reads the will_extractions rows this script writes.
 *
 * Usage:
 *   node scripts/reextract-hand-uploaded-wills.mjs              # DRY RUN (no writes, no OCR re-run unless needed for preview)
 *   node scripts/reextract-hand-uploaded-wills.mjs --apply      # write everything
 *   node scripts/reextract-hand-uploaded-wills.mjs --reocr      # force Cloud Vision re-OCR of all targets
 *   node scripts/reextract-hand-uploaded-wills.mjs --id 19      # restrict to one person_documents.id
 *   node scripts/reextract-hand-uploaded-wills.mjs --no-entities # OCR + extraction + will_extractions only (skip person/heir/enslaved writes)
 */

import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import axios from 'axios';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S3Service = require('../src/services/storage/S3Service');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { extractEstate, MODEL } = require('../src/services/probate/probate-llm-extractor');
const { transcribeImage, GEMINI_OCR_MODEL } = require('../src/services/probate/gemini-ocr');
const NameResolver = require('../src/services/NameResolver');

const APPLY       = process.argv.includes('--apply');
const REOCR       = process.argv.includes('--reocr');
// --relink: skip OCR + LLM; re-run only the entity backfill (heirs/enslaved/
// demographics) from the latest stored will_extractions. Idempotent, no API
// calls — use to repair entity links without re-extracting.
const RELINK      = process.argv.includes('--relink');
const NO_ENTITIES = process.argv.includes('--no-entities');
// --id accepts a single id or a comma-separated list (e.g. --id 184161,184162,44165)
const ONLY_IDS    = (() => { const i = process.argv.indexOf('--id'); return i !== -1 ? process.argv[i + 1].split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean) : null; })();
const EXTRACTOR_VERSION = 'forensic-llm-retro/2026-06-11';

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const resolver = new NameResolver(pool);

const log = (...a) => console.log(...a);
const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString());

// ---- helpers ---------------------------------------------------------------

// "Will of George Biscoe (1859) — Montgomery County, Maryland" → name/loc
function parseCollectionName(title) {
  const out = { testator: null, county: null, state: null };
  if (!title) return out;
  const m = title.match(/^\s*(?:Last\s+)?Will(?:\s+and\s+Testament)?\s+of\s+(.+?)(?:\s*\(|\s*[—–-]|$)/i);
  out.testator = m ? m[1].replace(/\s+/g, ' ').trim() : null;
  // location after an em/en dash: "— Saint Mary's County, Maryland"
  const loc = title.match(/[—–]\s*([^,]+?County)?\s*,?\s*([A-Z][a-z]+)\s*$/);
  if (loc) {
    if (loc[1]) out.county = loc[1].replace(/County\s*$/i, '').trim();
    out.state = loc[2] ? loc[2].trim() : null;
  }
  return out;
}

// OCR a will PDF from S3 using Gemini vision (free; Cloud Vision key was
// suspended). Downloads via the SDK (presigned GET 403'd on region mismatch),
// rasterizes with pdftoppm, transcribes each page with Gemini.
async function visionOcrPdfFromS3(s3Key) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'will-ocr-'));
  try {
    const obj = await S3Service.client.send(new GetObjectCommand({ Bucket: S3Service.bucket, Key: s3Key }));
    const chunks = [];
    for await (const c of obj.Body) chunks.push(c);
    const pdfPath = path.join(dir, 'will.pdf');
    fs.writeFileSync(pdfPath, Buffer.concat(chunks));
    execSync(`pdftoppm -r 200 -png "${pdfPath}" "${path.join(dir, 'page')}"`, { stdio: 'pipe' });
    const pageFiles = fs.readdirSync(dir).filter(f => f.startsWith('page') && f.endsWith('.png')).sort();
    const pages = [];
    for (let i = 0; i < pageFiles.length; i++) {
      const bytes = fs.readFileSync(path.join(dir, pageFiles[i]));
      const text = await transcribeImage(bytes);
      pages.push({ index: i + 1, filename: pageFiles[i], ocr_text: text, page_type: 'will', confidence: 0.85, ocr_method: `gemini:${GEMINI_OCR_MODEL}` });
      // Pace under the free RPM limit (~10/min): ~7s between page calls.
      if (i < pageFiles.length - 1) await new Promise(r => setTimeout(r, 7000));
    }
    const fullText = pages.map(p => `[image ${p.index}]\n${p.ocr_text}`).join('\n\n');
    return { fullText, pages };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Map a will "relation" word to a canonical_family_edges relationship + direction.
// person_a is the testator; returns {type, swap} where swap means testator is person_b.
function relationToEdge(relation) {
  const r = (relation || '').toLowerCase();
  if (/\b(wife|husband|spouse)\b/.test(r)) return { type: 'spouse', undirected: true };
  if (/\b(son|daughter|child|children)\b/.test(r)) return { type: 'parent_of' };      // testator parent_of heir
  if (/\b(grandson|granddaughter|grandchild)\b/.test(r)) return { type: 'parent_of', note: 'grandchild (recorded as descendant edge)' };
  if (/\b(father|mother|parent)\b/.test(r)) return { type: 'child_of' };               // testator child_of heir
  if (/\b(brother|sister|sibling)\b/.test(r)) return { type: 'sibling_of', undirected: true };
  return null; // friend/legatee/unknown — no kin edge
}

async function upsertFamilyEdge(testatorId, heirId, edge, pdId, bequest) {
  // person_a/person_b: directed types keep testator as person_a (parent_of)
  // or person_b (child_of); undirected (spouse/sibling) use lower id first.
  let a = testatorId, b = heirId;
  if (edge.undirected) { a = Math.min(testatorId, heirId); b = Math.max(testatorId, heirId); }
  else if (edge.type === 'child_of') { a = testatorId; b = heirId; } // testator child_of heir → person_a=child=testator
  const notes = `From hand-uploaded will (person_documents.id=${pdId}). ${edge.note ? edge.note + '. ' : ''}${bequest ? 'Bequest: ' + bequest.slice(0, 200) : ''}`.trim();
  const r = await pool.query(
    `INSERT INTO canonical_family_edges
       (person_a_id, person_b_id, relationship_type, source_document_id, evidence_tier, confidence, verified, notes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,1,0.90,false,$5,NOW(),NOW())
     ON CONFLICT (person_a_id, person_b_id, relationship_type) DO NOTHING
     RETURNING id`,
    [a, b, edge.type, pdId, notes]
  );
  return r.rowCount ? r.rows[0].id : null;
}

async function linkEnslaved(testatorId, person, year, place, weId, pdId) {
  const name = (person.name || '').trim();
  if (!name || name.length < 2) return { created: false, reason: 'no-name' };
  const birthYear = (person.age && year) ? (year - person.age) : null;
  // Find an existing enslaved_individuals row for this name under this enslaver.
  const existing = await pool.query(
    `SELECT enslaved_id FROM enslaved_individuals
      WHERE enslaved_by_individual_id = $1 AND LOWER(full_name) = LOWER($2) LIMIT 1`,
    [testatorId, name]
  );
  let enslavedId = existing.rows[0]?.enslaved_id || null;
  const valNote = person.appraised_value_usd ? ` appraised at ${money(person.appraised_value_usd)}` : '';
  const kinNote = person.kin_relation ? ` (${person.kin_relation})` : '';
  if (!enslavedId) {
    enslavedId = `willenslaved-${pdId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 60);
    await pool.query(
      `INSERT INTO enslaved_individuals (enslaved_id, full_name, given_name, enslaved_by_individual_id, birth_year, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (enslaved_id) DO NOTHING`,
      [enslavedId, name, name.split(/\s+/)[0], testatorId, birthYear,
       `Named in hand-uploaded will (person_documents.id=${pdId})${valNote}${kinNote}.`]
    );
  }
  // Documentary relationship row.
  await pool.query(
    `INSERT INTO slaveholding_relationships
       (enslaver_canonical_id, enslaved_individual_id, relationship_type, date_window_start, place_text,
        evidence_source_table, evidence_source_id, confidence_low, confidence_high, notes, created_at)
     VALUES ($1,$2,'owned',$3,$4,'will_extractions',$5,0.80,0.95,$6,NOW())
     ON CONFLICT DO NOTHING`,
    [testatorId, enslavedId, year ? `${year}-01-01` : null, place || 'unknown',
     weId, `Bequeathed/listed in will${valNote}${kinNote}.`]
  );
  return { created: true, enslavedId, birthYear };
}

// ---- main ------------------------------------------------------------------

async function selectTargets() {
  const params = [];
  let where = `pd.document_type IN ('will','estate_inventory','estate_account','guardian_account')
               AND (pd.source_type IS NULL OR pd.source_type NOT IN ('familysearch','familysearch_tree'))`;
  if (ONLY_IDS) { params.push(ONLY_IDS); where = `pd.id = ANY($1)`; }
  const r = await pool.query(
    `SELECT pd.id, pd.canonical_person_id, pd.s3_key, pd.collection_name, pd.document_type,
            pd.document_year, pd.ocr_text, length(pd.ocr_text) AS ocrlen,
            cp.canonical_name AS linked_name
       FROM person_documents pd
       LEFT JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
      WHERE ${where}
      ORDER BY pd.id`, params);
  return r.rows;
}

// Backfill testator demographics, heirs (family edges), and enslaved
// (slaveholding) from an extraction object. Shared by the extract path and
// the --relink repair path.
async function backfillEntities(doc, est, weId, { year, parsed, testatorId }) {
  const ens = est.enslaved_persons || [];
  const heirs = est.heirs || [];

  // Testator demographics (death year = probate/recording-year PROXY)
  const deathProxyYear = doc.document_year || year;
  const proxyNote = deathProxyYear ? `death_year_estimate=${deathProxyYear} inferred from probate/will document year (PROXY — actual death may differ); source person_documents.id=${doc.id}.` : null;
  await pool.query(
    `UPDATE canonical_persons
        SET death_year_estimate = COALESCE(death_year_estimate, $2),
            primary_state       = COALESCE(primary_state, $3),
            primary_county      = COALESCE(primary_county, $4),
            notes               = CASE WHEN $5::text IS NULL THEN notes
                                       WHEN notes IS NULL OR notes='' THEN $5
                                       WHEN position($5 in notes) > 0 THEN notes
                                       ELSE notes || E'\n' || $5 END,
            updated_at = NOW()
      WHERE id = $1`,
    [testatorId, deathProxyYear, parsed.state, parsed.county, proxyNote]
  );

  const place = [parsed.county && parsed.county + ' County', parsed.state].filter(Boolean).join(', ') || null;

  let edgesAdded = 0;
  for (const h of heirs) {
    if (!h.name) continue;
    const edge = relationToEdge(h.relation);
    const rr = await resolver.resolveOrCreate(h.name, { personType: 'free_person', state: parsed.state, county: parsed.county, confidence: 0.65 });
    if (!rr.canonicalPerson) continue;
    if (edge && rr.canonicalPerson.id !== testatorId) {
      const id = await upsertFamilyEdge(testatorId, rr.canonicalPerson.id, edge, doc.id, h.bequest);
      if (id) edgesAdded++;
    }
  }
  log(`   ↳ heirs: ${edgesAdded} new family edge(s)`);

  let ensCreated = 0;
  for (const p of ens) {
    try { const r = await linkEnslaved(testatorId, p, year, place, weId, doc.id); if (r.created) ensCreated++; }
    catch (e) { log(`     enslaved "${p.name}" link failed: ${e.message}`); }
  }
  log(`   ↳ enslaved: ${ensCreated} linked via slaveholding_relationships`);
  return { edgesAdded, ensCreated };
}

async function processDoc(doc) {
  const parsed = parseCollectionName(doc.collection_name);
  const testatorName = doc.linked_name || parsed.testator;
  log(`\n━━━ #${doc.id}  ${doc.collection_name || '(untitled)'} ━━━`);
  log(`   linked cp: ${doc.canonical_person_id || '—'} (${doc.linked_name || 'UNLINKED'})  parsed testator: ${parsed.testator || '?'}  loc: ${parsed.county || '?'}/${parsed.state || '?'}`);

  // --relink: read the latest stored extraction; re-run entity backfill only.
  if (RELINK) {
    const we = await pool.query(
      `SELECT id, canonical_person_id, structured_extraction_jsonb AS s
         FROM will_extractions WHERE document_id=$1 AND status <> 'rejected'
         ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1`, [doc.id]);
    if (!we.rows[0]) { log(`   (relink) no stored extraction — SKIP.`); return null; }
    const est = typeof we.rows[0].s === 'string' ? JSON.parse(we.rows[0].s) : we.rows[0].s;
    const testatorId = we.rows[0].canonical_person_id || doc.canonical_person_id;
    if (!testatorId) { log(`   (relink) no testator cp — SKIP.`); return null; }
    const year = est.year || est.document_year || doc.document_year || null;
    log(`   (relink) stored extraction: enslaved=${(est.enslaved_persons||[]).length} heirs=${(est.heirs||[]).length}`);
    if (!APPLY) { log(`   [DRY-RUN] no writes.`); return { doc }; }
    await backfillEntities(doc, est, we.rows[0].id, { year, parsed, testatorId });
    return { doc, relinked: true };
  }

  // 1. OCR
  let ocr = doc.ocr_text || '';
  let pages = null;
  const needOcr = REOCR || !ocr || doc.ocrlen < 200;
  if (needOcr) {
    if (!doc.s3_key) { log(`   ✗ no s3_key — cannot OCR. SKIP.`); return null; }
    log(`   OCR: ${REOCR ? 'forced re-OCR' : 'missing/short'} → Cloud Vision on ${doc.s3_key}`);
    try {
      const res = await visionOcrPdfFromS3(doc.s3_key);
      ocr = res.fullText; pages = res.pages;
      log(`   OCR: ${pages.length} page(s), ${ocr.length} chars`);
    } catch (e) { log(`   ✗ OCR failed: ${e.message}. SKIP.`); return null; }
  } else {
    log(`   OCR: using stored text (${doc.ocrlen} chars)`);
  }
  if (!ocr || ocr.trim().length < 40) { log(`   ✗ OCR too short to extract. SKIP.`); return null; }

  // 2. Forensic extraction
  log(`   Extracting with ${MODEL} (decedent="${testatorName || ''}")…`);
  let est;
  try { est = await extractEstate(ocr, { decedent: testatorName }); }
  catch (e) { log(`   ✗ extraction failed: ${e.message}. SKIP.`); return null; }
  if (!est) { log(`   ✗ extractor returned null. SKIP.`); return null; }

  const ens = est.enslaved_persons || [];
  const nonChattel = est.non_chattel_assets || [];
  const liabilities = est.liabilities || [];
  const heirs = est.heirs || [];
  const totals = est.estate_totals || {};
  const year = est.year || doc.document_year || null;
  log(`   ► testator=${est.testator || '?'}  year=${year || '?'}  type=${est.document_type}`);
  log(`   ► enslaved=${ens.length}  non-chattel=${nonChattel.length}  liabilities=${liabilities.length}  heirs=${heirs.length}`);
  log(`   ► totals: appraised=${money(totals.total_appraised_value_usd)}  enslaved=${money(totals.enslaved_value_usd)}  non-chattel=${money(totals.non_chattel_value_usd)}`);
  if (ens.length) log(`     enslaved: ${ens.slice(0, 12).map(e => e.name + (e.appraised_value_usd ? `=${money(e.appraised_value_usd)}` : '')).join(', ')}${ens.length > 12 ? ' …' : ''}`);
  if (heirs.length) log(`     heirs: ${heirs.slice(0, 8).map(h => `${h.name}${h.relation ? ' (' + h.relation + ')' : ''}`).join(', ')}`);

  if (!APPLY) {
    // Read-only PREVIEW of the family edges + heir/enslaved resolution that an
    // --apply would create — so edges can be vetted before any write. Uses
    // findCandidateMatches (SELECT-only); creates/links NOTHING.
    log(`   ── proposed family edges (PREVIEW, nothing written) ──`);
    const tName = doc.linked_name || testatorName || '(testator)';
    if (!heirs.length) log(`     (no heirs extracted)`);
    for (const h of heirs) {
      if (!h.name) continue;
      const edge = relationToEdge(h.relation);
      let resolv = 'would CREATE new canonical person';
      try {
        const cands = await resolver.findCandidateMatches(h.name, { state: parsed.state, county: parsed.county });
        if (cands && cands[0] && cands[0].match_confidence >= 0.85) {
          resolv = `would MATCH existing cp ${cands[0].id} "${cands[0].canonical_name}" (${(cands[0].match_confidence).toFixed(2)}, ${cands[0].match_type || '?'})`;
        } else if (cands && cands[0] && cands[0].match_confidence >= 0.60) {
          resolv = `AMBIGUOUS → would QUEUE for review (top: cp ${cands[0].id} "${cands[0].canonical_name}" ${(cands[0].match_confidence).toFixed(2)})`;
        }
      } catch (e) { resolv = `match-check error: ${e.message}`; }
      if (edge) log(`     EDGE  ${tName} --${edge.type}${edge.undirected ? '(undirected)' : ''}--> "${h.name}"  [${resolv}]${h.bequest ? `  bequest: ${String(h.bequest).slice(0,60)}` : ''}`);
      else log(`     (no kin edge for "${h.name}"${h.relation ? ' ['+h.relation+']' : ''} — friend/legatee)  [${resolv}]`);
    }
    if (ens.length) {
      log(`   ── enslaved persons (PREVIEW) ──`);
      for (const e of ens) log(`     ENSLAVED "${e.name || '(unnamed)'}"${e.age!=null?` age ${e.age}`:''}${e.appraised_value_usd!=null?` ${money(e.appraised_value_usd)}`:''}${e.kin_relation?` — ${e.kin_relation}`:''}  → would link via slaveholding_relationships(owned)`);
    }
    log(`   [DRY-RUN] no writes.`);
    return { doc, est, year, parsed, testatorName, ocr, pages };
  }

  // 3. Persist OCR (if re-run)
  if (pages) {
    await pool.query(
      `UPDATE person_documents SET ocr_text=$1, document_year=COALESCE(document_year,$2),
              evidence_strength=COALESCE(evidence_strength,'direct_primary'), extraction_confidence=GREATEST(COALESCE(extraction_confidence,0),0.85)
       WHERE id=$3`,
      [ocr, year, doc.id]
    );
  } else if (doc.document_year == null && year != null) {
    await pool.query(`UPDATE person_documents SET document_year=$1 WHERE id=$2`, [year, doc.id]);
  }

  // 4. Resolve testator → canonical person
  let testatorId = doc.canonical_person_id;
  if (!testatorId && testatorName) {
    // A hand-curated will identifies ONE specific decedent. Do NOT fuzzy-match
    // the testator to an existing canonical person — soundex collisions merge
    // distinct people across generations (e.g. "James H. Hopewell" → "James
    // Hopewell", "Hugh Hopewell IV" → "Hugh Hopewell VI"). Create a distinct
    // canonical person; a curator can merge later if they truly are the same.
    const cp = await resolver.createCanonicalPerson(testatorName, {
      personType: 'enslaver', state: parsed.state, county: parsed.county, confidence: 0.7,
    });
    if (cp) {
      testatorId = cp.id;
      await pool.query(`UPDATE person_documents SET canonical_person_id=$1 WHERE id=$2`, [testatorId, doc.id]);
      log(`   ↳ testator created as distinct cp ${testatorId} (no fuzzy-merge)`);
    } else {
      log(`   ↳ testator name invalid — extraction saved without canonical link`);
    }
  }

  // 5. will_extractions — supersede stale rows for this document, insert forensic one
  const structured = {
    ...est,
    testator_name: est.testator || testatorName || null,
    document_year: year,
    enslaved_persons_count: ens.length || null,
    _extraction_method: MODEL,
    _source: 'reextract-hand-uploaded-wills.mjs',
  };
  const rawPages = pages || [{ index: 1, ocr_text: ocr, page_type: 'will', confidence: 0.85, ocr_method: 'stored' }];
  // Supersede ALL prior extractions for this document (any version), so a
  // re-run never leaves stale/duplicate 'extracted' rows competing as "latest".
  await pool.query(
    `UPDATE will_extractions SET status='rejected', review_notes=COALESCE(review_notes,'') || ' superseded by ${EXTRACTOR_VERSION}'
       WHERE document_id=$1 AND status <> 'rejected'`, [doc.id]);
  const weRes = await pool.query(
    `INSERT INTO will_extractions
       (document_id, canonical_person_id, raw_pages_jsonb, structured_extraction_jsonb, extractor_version, status, review_sections_jsonb)
     VALUES ($1,$2,$3,$4,$5,'extracted','{}'::jsonb)
     RETURNING id`,
    [doc.id, testatorId || null, JSON.stringify(rawPages), JSON.stringify(structured), EXTRACTOR_VERSION]
  );
  const weId = weRes.rows[0].id;
  log(`   ↳ will_extractions written: ${weId}`);

  if (NO_ENTITIES || !testatorId) {
    log(`   (entity backfill ${NO_ENTITIES ? 'skipped via --no-entities' : 'skipped — no testator cp'})`);
    return { doc, est, weId, testatorId };
  }

  // 6+7. Testator demographics, heirs (family edges), enslaved (slaveholding)
  const r = await backfillEntities(doc, est, weId, { year, parsed, testatorId });
  return { doc, est, weId, testatorId, ...r };
}

async function main() {
  log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${REOCR ? ' +reocr' : ''}${NO_ENTITIES ? ' +no-entities' : ''}  extractor=${MODEL}`);
  if (!GEMINI_KEY) log(`WARNING: GEMINI_API_KEY not set — docs needing OCR will be skipped.`);
  const targets = await selectTargets();
  log(`${targets.length} hand-uploaded probate document(s) targeted.\n`);
  const results = [];
  for (const doc of targets) {
    try { const r = await processDoc(doc); if (r) results.push(r); }
    catch (e) { log(`   ✗ #${doc.id} fatal: ${e.message}`); }
  }
  log(`\n════ Summary ════`);
  log(`processed: ${results.length}/${targets.length}`);
  if (APPLY) {
    log(`Next: node scripts/backfill-inheritance-edges-from-will-extractions.js --apply   # build testator→heir inheritance_edges`);
  } else {
    log(`Re-run with --apply to write. Add --reocr to force Cloud Vision re-OCR.`);
  }
  await pool.end();
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
