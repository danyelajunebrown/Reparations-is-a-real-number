/**
 * Will / Probate Document Ingestion Routes
 *
 * POST /api/wills/ingest
 *   - Public-facing (no admin token required)
 *   - Accepts a PDF upload + optional metadata
 *   - Uploads to S3 at wills/{testator-slug}/{uuid}.pdf
 *   - Inserts a person_documents row
 *   - Attempts a will_extractions row (graceful degradation if M048 not yet applied)
 *
 * Session 45 — May 2026: initial implementation.
 * The WillPipeline service (src/services/probate/WillPipeline.js) is tracked in
 * GitHub issue #XX — it will eventually replace the inline logic here for full
 * OCR + structured extraction + downstream fanout.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const db = require('../../database/connection');
const S3Service = require('../../services/storage/S3Service');
const logger = require('../../utils/logger');

// ── Multer config ─────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'), false);
    }
  },
});

/**
 * Slugify a testator name for use as an S3 key prefix.
 * e.g. "Henry Weaver" → "henry-weaver"
 */
function slugify(name) {
  if (!name) return 'unknown';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Look up a canonical_persons row by name.
 *
 * Strategy (in order):
 *  1. Exact ILIKE match on canonical_name          — "Henry Weaver"
 *  2. Split on first space → first_name + last_name match
 *
 * Returns:
 *  { id, canonical_name }  — exactly 1 match → safe to auto-link
 *  { ambiguous: true, count: N, name }  — multiple matches → skip, notify caller
 *  null  — no match found
 *
 * Never throws — all errors return null so upload is never blocked.
 */
async function findCanonicalPersonByName(name) {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();

  try {
    // Step 1: exact canonical_name ILIKE
    const exact = await db.query(
      `SELECT id, canonical_name
         FROM canonical_persons
        WHERE canonical_name ILIKE $1
        LIMIT 2`,
      [trimmed]
    );

    if (exact.rows.length === 1) {
      return { id: exact.rows[0].id, canonical_name: exact.rows[0].canonical_name };
    }
    if (exact.rows.length > 1) {
      return { ambiguous: true, count: exact.rows.length, name: trimmed };
    }

    // Step 2: split into first + last name
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return null;
    const firstName = parts[0];
    const lastName  = parts[parts.length - 1];

    const split = await db.query(
      `SELECT id, canonical_name
         FROM canonical_persons
        WHERE first_name ILIKE $1 AND last_name ILIKE $2
        LIMIT 2`,
      [firstName, lastName]
    );

    if (split.rows.length === 1) {
      return { id: split.rows[0].id, canonical_name: split.rows[0].canonical_name };
    }
    if (split.rows.length > 1) {
      return { ambiguous: true, count: split.rows.length, name: trimmed };
    }

    return null;
  } catch (lookupErr) {
    logger.warn('canonical_person lookup failed (non-fatal)', { error: lookupErr.message, name: trimmed });
    return null;
  }
}

// ── POST /api/wills/ingest ────────────────────────────────────────────────────
router.post('/ingest', upload.single('willPdf'), async (req, res) => {
  try {
    const {
      testatorName,
      testatorYear,
      testatorLocation,
      archiveSource,
      canonicalPersonId,
      participantId,
    } = req.body;

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'No PDF file uploaded' });
    }

    // ── 1. Upload to S3 ──────────────────────────────────────────────────────
    const slug = slugify(testatorName);
    const uuid = crypto.randomUUID();
    const s3Key = `wills/${slug}/${uuid}.pdf`;

    if (!S3Service.isEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'S3 storage is not configured on this server',
      });
    }

    await S3Service.upload(s3Key, file.buffer, 'application/pdf', {
      'testator-name': testatorName || '',
      'archive-source': archiveSource || '',
      'uploaded-by': 'public-ingestion',
    });

    const s3Url = S3Service.getPublicUrl(s3Key);

    // ── 2. Name-based canonical person lookup ────────────────────────────────
    // If the caller didn't pass canonicalPersonId explicitly, try to find
    // the person by testatorName. Result is one of:
    //   { id, canonical_name }        → unique match, safe to auto-link
    //   { ambiguous: true, count, name } → multiple matches, skip linking
    //   null                           → no match found
    let resolvedPersonId = canonicalPersonId ? parseInt(canonicalPersonId, 10) : null;
    let matchedPerson    = null;
    let matchAmbiguous   = false;

    if (!resolvedPersonId && testatorName) {
      const lookup = await findCanonicalPersonByName(testatorName);
      if (lookup && !lookup.ambiguous) {
        resolvedPersonId = lookup.id;
        matchedPerson    = { id: lookup.id, canonical_name: lookup.canonical_name };
        logger.info('Auto-linked will to canonical person', {
          testatorName,
          canonical_person_id: lookup.id,
          canonical_name: lookup.canonical_name,
        });
      } else if (lookup && lookup.ambiguous) {
        matchAmbiguous = true;
        logger.info('Ambiguous name lookup — skipping auto-link', {
          testatorName,
          count: lookup.count,
        });
      }
    }

    // ── 3. Insert person_documents row ───────────────────────────────────────
    const titleText = testatorName
      ? `Will of ${testatorName}${testatorYear ? ` (${testatorYear})` : ''}${testatorLocation ? ` — ${testatorLocation}` : ''}`
      : file.originalname;

    let personDocId = null;
    try {
      const pdResult = await db.query(
        `INSERT INTO person_documents
           (s3_key, s3_url, document_type, filename, file_size, mime_type,
            title, source_type_label, collection_name,
            name_as_appears, document_year, created_by, canonical_person_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          s3Key,                                               // $1  s3_key
          s3Url,                                               // $2  s3_url
          'will',                                              // $3  document_type
          file.originalname,                                   // $4  filename
          file.size,                                           // $5  file_size
          'application/pdf',                                   // $6  mime_type
          titleText,                                           // $7  title
          'probate_record',                                    // $8  source_type_label
          testatorName ? `Will of ${testatorName}` : 'Uploaded Will', // $9  collection_name
          testatorName || file.originalname,                   // $10 name_as_appears (NOT NULL)
          testatorYear ? parseInt(testatorYear, 10) : null,    // $11 document_year
          'public-ingestion',                                  // $12 created_by
          resolvedPersonId || null,                            // $13 canonical_person_id
        ]
      );
      personDocId = pdResult.rows[0].id;
    } catch (pdErr) {
      logger.error('person_documents insert failed', { error: pdErr.message });
      // Still return success for S3 upload — don't block the user
      return res.json({
        success: true,
        personDocId: null,
        extractionId: null,
        s3Key,
        warning: `S3 upload succeeded but DB record failed: ${pdErr.message}`,
        nextSteps: [
          'Document is stored in S3 at: ' + s3Key,
          'Manual DB insert needed for person_documents',
        ],
      });
    }

    // ── 4. Insert will_extractions row (graceful — M048 may not be applied) ─
    let extractionId = null;
    try {
      const extResult = await db.query(
        `INSERT INTO will_extractions
           (document_id, canonical_person_id, participant_id,
            raw_pages_jsonb, structured_extraction_jsonb, extractor_version)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          personDocId,
          resolvedPersonId || null,     // use the resolved id (auto-linked or explicit)
          participantId || null,
          JSON.stringify([{
            index: 0,
            page_type: 'pending_ocr',
            ocr_text: '',
            ocr_method: null,
            confidence: 0,
          }]),
          JSON.stringify({
            testator: {
              name: testatorName || null,
              year: testatorYear ? parseInt(testatorYear, 10) : null,
              location: testatorLocation || null,
            },
            archive_source: archiveSource || null,
            status: 'pending_extraction',
          }),
          '1.0-manual-upload',
        ]
      );
      extractionId = extResult.rows[0].id;
    } catch (extErr) {
      // M048 not yet applied, or participant_id FK miss — non-fatal
      logger.warn('will_extractions insert skipped', { error: extErr.message });
    }

    logger.info('Will ingested', { s3Key, personDocId, extractionId, testatorName });

    return res.json({
      success: true,
      personDocId,
      extractionId,
      s3Key,
      // Linkage result — used by the frontend success screen
      matchedPerson:   matchedPerson   || null,   // { id, canonical_name } or null
      matchAmbiguous:  matchAmbiguous,             // true if >1 person matched
      message: 'Will uploaded and recorded successfully',
      nextSteps: [
        `Stored in S3: ${s3Key}`,
        matchedPerson
          ? `Auto-linked to ${matchedPerson.canonical_name} (id ${matchedPerson.id})`
          : matchAmbiguous
            ? `Multiple persons match "${testatorName}" — linked manually later`
            : 'No matching person found in database yet',
        extractionId
          ? `Extraction record created — ID ${extractionId}`
          : 'Apply migration 048 to enable full extraction tracking',
        'OCR + structured extraction run is queued for the next pipeline pass',
      ],
    });
  } catch (err) {
    logger.error('Will ingestion error', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/wills/:id ────────────────────────────────────────────────────────
// Returns the status of an extraction record. Used by the frontend status page.
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         we.id, we.document_id, we.status, we.extractor_version,
         we.structured_extraction_jsonb, we.review_sections_jsonb,
         we.created_at, we.updated_at,
         pd.s3_key, pd.title, pd.filename
       FROM will_extractions we
       JOIN person_documents pd ON pd.id = we.document_id
       WHERE we.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Extraction not found' });
    }
    res.json({ success: true, extraction: result.rows[0] });
  } catch (err) {
    // will_extractions table may not exist yet
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
