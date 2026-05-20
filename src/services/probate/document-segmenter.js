'use strict';

/**
 * Probate document segmenter (Phase A of the probate extraction rebuild).
 *
 * The FamilySearch scraper writes one `person_documents` row per page-image.
 * A will / inventory / estate account routinely spans several consecutive
 * images, and the old parser treated one image = one record — so a multi-page
 * will became several disconnected fragments.
 *
 * This service reads `person_documents` for a roll (grouped by `collection_key`,
 * ordered by `image_number`), detects where each logical document starts and
 * ends from start-of-document language in the transcript, and writes one
 * `probate_documents` row per logical document (migration 080).
 *
 * Read-only on `person_documents`; safe to run while the scraper is still
 * filling the roll. Idempotent — re-running re-segments and upserts.
 *
 * CLI:
 *   node src/services/probate/document-segmenter.js --county Liberty
 *   node src/services/probate/document-segmenter.js --collection-key georgia-probate-liberty-9SYY-924
 *   node src/services/probate/document-segmenter.js --county Liberty --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- Start-of-document signals --------------------------------------------
// Regexes are deliberately tolerant of OCR noise (FamilySearch "full-text"
// transcripts are frequently machine OCR, not clean volunteer transcription).
// Each entry: { type, re, weight }. Highest-weight match wins for an image.
const START_SIGNALS = [
  { type: 'will',            weight: 1.00, re: /last\s+will\s+(?:and|&|\W){0,3}testament/i },
  { type: 'will',            weight: 0.95, re: /in\s+the\s+name\s+of\s+god[\s,.]+amen/i },
  { type: 'will',            weight: 0.70, re: /\bi[\s,]+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z.]+){0,3}[\s,]+(?:of\s+the\s+county|being\s+of\s+sound|do\s+(?:hereby\s+)?make)/ },
  { type: 'inventory',       weight: 1.00, re: /inventory\s+(?:and|&)?\s*appraise?ment/i },
  { type: 'inventory',       weight: 0.90, re: /appraise?ment\s+of\s+the\s+(?:estate|property|goods|effects)/i },
  { type: 'inventory',       weight: 0.80, re: /a\s+true\s+(?:and\s+perfect\s+)?inventory/i },
  { type: 'estate_account',  weight: 0.95, re: /in\s+account\s+(?:current\s+)?with\s+the\s+estate/i },
  { type: 'estate_account',  weight: 0.80, re: /annual\s+return\s+of/i },
  { type: 'guardian_account',weight: 0.95, re: /guardian(?:'?s)?\s+(?:account|return)/i },
  { type: 'letters',         weight: 1.00, re: /letters\s+testamentary/i },
  { type: 'letters',         weight: 1.00, re: /letters\s+of\s+administration/i },
  { type: 'letters',         weight: 0.90, re: /letters\s+of\s+guardianship/i },
];

const MIN_TEXT_LEN = 6; // transcripts <= this are treated as effectively empty

function normalize(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Classify a single image's transcript.
 * @returns {{isStart:boolean, type:string|null, confidence:number}}
 */
function detectStart(text) {
  if (!text || text.length <= MIN_TEXT_LEN) {
    return { isStart: false, type: null, confidence: 0 };
  }
  let best = null;
  for (const sig of START_SIGNALS) {
    if (sig.re.test(text)) {
      if (!best || sig.weight > best.weight) best = sig;
    }
  }
  if (best) return { isStart: true, type: best.type, confidence: best.weight };
  return { isStart: false, type: null, confidence: 0 };
}

/**
 * Parse `georgia-probate-{countySlug}-{rollGroupId}` into its parts.
 */
function parseCollectionKey(collectionKey) {
  const m = /^georgia-probate-([a-z]+)-(.+)$/i.exec(collectionKey || '');
  if (!m) return { county: null, rollGroupId: null };
  const county = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return { county, rollGroupId: m[2] };
}

/**
 * Segment one roll's images into logical documents.
 * @param {Array<{id:number,image_number:number,ocr_text:string,document_type:string}>} images
 *        ordered by image_number ascending
 * @returns {Array} document objects ready to upsert
 */
function segmentImages(images) {
  const docs = [];
  let current = null;

  const open = (img, type, confidence) => ({
    first_image_number: img.image_number,
    last_image_number: img.image_number,
    document_type: type,
    person_document_ids: [img.id],
    page_count: 1,
    // a document opened without a start signal (orphan first page) is low-confidence
    segmentation_confidence: confidence,
    needs_review: confidence < 0.5,
  });

  const append = (img) => {
    current.person_document_ids.push(img.id);
    current.last_image_number = img.image_number;
    current.page_count = current.person_document_ids.length;
  };

  for (const img of images) {
    const text = normalize(img.ocr_text);
    const start = detectStart(text);

    if (start.isStart) {
      if (current) docs.push(current);
      current = open(img, start.type, start.confidence);
      continue;
    }

    // Not a start. Empty/short pages and continuation pages attach to the
    // open document. With no open document, an image becomes its own
    // low-confidence 'other' record (orphan — e.g. an index/cover page, or a
    // document whose start signal was lost to OCR garble).
    if (current) {
      append(img);
    } else {
      const type = text.length <= MIN_TEXT_LEN ? 'no_transcript' : 'other';
      current = open(img, type, 0.3);
    }
  }
  if (current) docs.push(current);
  return docs;
}

async function listCollectionKeys(client, county) {
  const res = await client.query(
    `SELECT DISTINCT collection_key FROM person_documents
       WHERE source_type = 'familysearch'
         AND collection_key ILIKE $1
       ORDER BY collection_key`,
    [county ? `georgia-probate-${county.toLowerCase()}-%` : 'georgia-probate-%']
  );
  return res.rows.map((r) => r.collection_key);
}

async function segmentRoll(client, collectionKey, { dryRun }) {
  const imgRes = await client.query(
    `SELECT id, image_number, ocr_text, document_type
       FROM person_documents
       WHERE collection_key = $1
       ORDER BY image_number ASC`,
    [collectionKey]
  );
  const images = imgRes.rows;
  if (images.length === 0) return { collectionKey, images: 0, documents: 0 };

  const docs = segmentImages(images);
  const { county, rollGroupId } = parseCollectionKey(collectionKey);

  if (!dryRun) {
    // Re-segmentation is idempotent: clear this roll's prior rows, re-insert.
    await client.query('DELETE FROM probate_documents WHERE collection_key = $1', [collectionKey]);
    for (const d of docs) {
      await client.query(
        `INSERT INTO probate_documents
           (collection_key, county, state, roll_group_id,
            first_image_number, last_image_number, page_count,
            document_type, person_document_ids,
            segmentation_method, segmentation_confidence, needs_review)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'heuristic',$10,$11)
         ON CONFLICT (collection_key, first_image_number) DO UPDATE SET
            last_image_number       = EXCLUDED.last_image_number,
            page_count              = EXCLUDED.page_count,
            document_type           = EXCLUDED.document_type,
            person_document_ids     = EXCLUDED.person_document_ids,
            segmentation_confidence = EXCLUDED.segmentation_confidence,
            needs_review            = EXCLUDED.needs_review,
            updated_at              = NOW()`,
        [
          collectionKey, county, 'Georgia', rollGroupId,
          d.first_image_number, d.last_image_number, d.page_count,
          d.document_type, d.person_document_ids,
          d.segmentation_confidence, d.needs_review,
        ]
      );
    }
  }
  return { collectionKey, images: images.length, documents: docs.length, docs };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  const county = opt('--county');
  const collectionKey = opt('--collection-key');
  const dryRun = args.includes('--dry-run');

  const client = await pool.connect();
  try {
    const keys = collectionKey ? [collectionKey] : await listCollectionKeys(client, county);
    if (keys.length === 0) {
      console.log('No matching rolls found.');
      return;
    }
    console.log(`Segmenting ${keys.length} roll(s)${dryRun ? ' [DRY RUN]' : ''}...`);
    let totalDocs = 0;
    let totalImages = 0;
    for (const key of keys) {
      const r = await segmentRoll(client, key, { dryRun });
      totalImages += r.images;
      totalDocs += r.documents;
      console.log(`  ${key}: ${r.images} images -> ${r.documents} documents`);
    }
    console.log(`Done. ${totalImages} images segmented into ${totalDocs} documents across ${keys.length} roll(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('FATAL', e.message);
    process.exit(1);
  });
}

module.exports = { detectStart, segmentImages, parseCollectionKey, segmentRoll };
