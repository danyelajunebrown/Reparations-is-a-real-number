/**
 * Will / Probate Document Ingestion Routes
 *
 * POST /api/wills/ingest
 *   - Public-facing (no admin token required)
 *   - Accepts a PDF, JPEG, or PNG upload + optional metadata
 *   - Routes S3 key prefix by documentType:
 *       will           → wills/{slug}/{uuid}.{ext}
 *       case_register  → case-registers/{slug}/{uuid}.{ext}
 *       deed           → deeds/{slug}/{uuid}.{ext}
 *       estate_inventory → estate-inventories/{slug}/{uuid}.{ext}
 *       other          → archival-docs/{slug}/{uuid}.{ext}
 *   - Inserts a person_documents row with the correct document_type
 *   - For 'will' type only: also inserts a will_extractions stub
 *     (other types queue for post-upload OCR scripts)
 *
 * Session 45 — May 2026: initial implementation.
 * Session 53 — May 2026: raised file size limit to 75MB; added documentType
 *   routing for case registers (Hynson DC runaway/fugitive books), deeds,
 *   estate inventories; added compiledBy + eraStart/eraEnd fields for
 *   register-type documents.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const db = require('../../database/connection');
const S3Service = require('../../services/storage/S3Service');
const logger = require('../../utils/logger');

// ── Valid document types ───────────────────────────────────────────────────────
const VALID_DOC_TYPES = new Set([
  'will',
  'case_register',
  'deed',
  'estate_inventory',
  'other',
]);

// ── S3 prefix per document type ───────────────────────────────────────────────
const S3_PREFIX = {
  will:             'wills',
  case_register:    'case-registers',
  deed:             'deeds',
  estate_inventory: 'estate-inventories',
  other:            'archival-docs',
};

// ── Accepted MIME types ────────────────────────────────────────────────────────
const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

// ── MIME → file extension map ──────────────────────────────────────────────────
const MIME_TO_EXT = {
  'application/pdf': 'pdf',
  'image/jpeg':      'jpg',
  'image/png':       'png',
};

// ── Multer config — 75MB to accommodate Heritage Books / MSA PDF scans ────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 75 * 1024 * 1024, // 75 MB
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPEG, and PNG files are accepted'), false);
    }
  },
});

/**
 * Slugify a name for use as an S3 key prefix.
 * e.g. "Henry Weaver" → "henry-weaver"
 * e.g. "Hynson DC Runaway 1848-1863" → "hynson-dc-runaway-1848-1863"
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
      // Shared fields (all document types)
      documentType      = 'will',      // 'will' | 'case_register' | 'deed' | 'estate_inventory' | 'other'
      archiveSource,
      canonicalPersonId,
      participantId,

      // Will-specific fields
      testatorName,
      testatorYear,
      testatorLocation,

      // Register-specific fields
      documentTitle,    // replaces testatorName for case_register
      eraStart,         // replaces testatorYear for multi-year registers
      eraEnd,
      compiledBy,       // e.g. "Hynson, Jerry M., Heritage Books 1999"
    } = req.body;

    // Normalize and validate document type
    const docType = VALID_DOC_TYPES.has(documentType) ? documentType : 'other';

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // ── 1. Resolve display name and year for the document ────────────────────
    // For wills: testatorName + testatorYear
    // For registers: documentTitle + eraStart/eraEnd
    // For others: fall back to documentTitle → testatorName → filename
    let displayName, displayYear, displayLocation;

    if (docType === 'will') {
      displayName     = testatorName || null;
      displayYear     = testatorYear ? parseInt(testatorYear, 10) : null;
      displayLocation = testatorLocation || null;
    } else if (docType === 'case_register') {
      displayName     = documentTitle || testatorName || null;
      displayYear     = eraStart ? parseInt(eraStart, 10) : null;
      displayLocation = archiveSource || null;
    } else {
      displayName     = documentTitle || testatorName || null;
      displayYear     = testatorYear ? parseInt(testatorYear, 10) : (eraStart ? parseInt(eraStart, 10) : null);
      displayLocation = testatorLocation || archiveSource || null;
    }

    // ── 2. Upload to S3 ──────────────────────────────────────────────────────
    const prefix   = S3_PREFIX[docType] || 'archival-docs';
    const slug     = slugify(displayName || file.originalname);
    const uuid     = crypto.randomUUID();
    const fileExt  = MIME_TO_EXT[file.mimetype] || 'bin';
    const s3Key    = `${prefix}/${slug}/${uuid}.${fileExt}`;

    if (!S3Service.isEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'S3 storage is not configured on this server',
      });
    }

    await S3Service.upload(s3Key, file.buffer, file.mimetype, {
      'document-type':  docType,
      'display-name':   displayName || '',
      'archive-source': archiveSource || '',
      'compiled-by':    compiledBy || '',
      'uploaded-by':    'public-ingestion',
    });

    const s3Url = S3Service.getPublicUrl(s3Key);

    // ── 3. Canonical person resolution ──────────────────────────────────────
    // If an explicit canonicalPersonId was provided, use it.
    // Otherwise, for wills: auto-create a canonical_persons row using
    // location + year context to avoid cross-contaminating same-name records.
    // Name-only auto-linking (ILIKE without location context) is intentionally
    // avoided — the same name can appear across multiple states and centuries.
    let resolvedPersonId = canonicalPersonId ? parseInt(canonicalPersonId, 10) : null;
    let matchedPerson    = null;
    let matchAmbiguous   = false;

    // ── 3b. Auto-create canonical_persons for wills if testator not in DB ───
    // Only runs when:
    //   - documentType is 'will'
    //   - no explicit canonicalPersonId was supplied
    //   - testatorName is present
    // Uses location+year to disambiguate before attaching to an existing row.
    if (docType === 'will' && !resolvedPersonId && displayName) {
      try {
        const nameParts = displayName.trim().split(/\s+/);
        const firstName = nameParts[0];
        const lastName  = nameParts[nameParts.length - 1];

        // ── auto-match to existing canonical_persons ────────────────────────
        // Three bugs were merging the old query — see the May 23 Hopewell dup
        // discovery for why "Hugh Hopewell IV" uploaded against an existing
        // "Hugh Hopewell IV" still created a duplicate:
        //   1. user's testatorLocation is comma-joined ("County, State") but
        //      the DB stores county and state in separate columns, so the
        //      single ILIKE could never align.
        //   2. existing rows with NULL primary_state/county were rejected by
        //      the OR clause even though they are not in conflict.
        //   3. ILIKE was strict on suffix variants — "Hugh Hopewell IV" did
        //      not match an existing "Hugh Hopewell".
        // The query now returns candidates by name (with / without suffix);
        // location and year compatibility are decided in JS so the logic is
        // legible and so we can prefer richer matches.
        const stripped = displayName.replace(/[,\s]+(jr|sr|[ivx]+|esq)\.?$/i, '').trim();
        const nameVariants = stripped && stripped !== displayName ? [displayName, stripped] : [displayName];
        const locParts = displayLocation
          ? displayLocation.split(/,\s*/).map((s) => s.trim()).filter(Boolean)
          : [];

        const candidates = await db.query(
          `SELECT id, canonical_name, primary_state, primary_county, death_year_estimate
             FROM canonical_persons
            WHERE person_type = 'enslaver'
              AND canonical_name ILIKE ANY($1::text[])`,
          [nameVariants]
        );

        const norm = (s) => (s || '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
        const userLocBlob = locParts.map(norm).join(' ');
        let existingPerson = null;
        let bestScore = -1;
        for (const c of candidates.rows) {
          // year compatibility: incompatible only if BOTH sides have a year and they're > 10 apart
          if (displayYear && c.death_year_estimate
              && Math.abs(c.death_year_estimate - displayYear) > 10) continue;

          // location compatibility:
          //   - user provided no location: any candidate accepted
          //   - candidate has NULL state AND county: no conflict (we'll enrich)
          //   - both have location: any locPart must appear in either column (or vice versa)
          if (locParts.length > 0 && (c.primary_state || c.primary_county)) {
            const dbBlob = `${norm(c.primary_state)} ${norm(c.primary_county)}`;
            const overlap = locParts.some((p) => {
              const np = norm(p);
              return np && (dbBlob.includes(np) || userLocBlob.includes(norm(c.primary_state))
                          || userLocBlob.includes(norm(c.primary_county)));
            });
            if (!overlap) continue;
          }

          // score: prefer candidates with location and year info
          const score = ((c.primary_state || c.primary_county) ? 2 : 0)
                      + (c.death_year_estimate ? 1 : 0);
          if (score > bestScore) { bestScore = score; existingPerson = c; }
        }

        // Enrich an existing match if it has no location and the upload does.
        if (existingPerson && !existingPerson.primary_state && !existingPerson.primary_county
            && locParts.length >= 2) {
          await db.query(
            `UPDATE canonical_persons
                SET primary_county = COALESCE(primary_county, $2),
                    primary_state  = COALESCE(primary_state, $3),
                    death_year_estimate = COALESCE(death_year_estimate, $4),
                    updated_at = NOW()
              WHERE id = $1`,
            [existingPerson.id, locParts[0], locParts[1], displayYear || null]
          );
          logger.info('Enriched existing canonical_persons row with upload location/year', {
            id: existingPerson.id, county: locParts[0], state: locParts[1],
          });
        }

        if (existingPerson) {
          resolvedPersonId = existingPerson.id;
          matchedPerson = { id: existingPerson.id, canonical_name: existingPerson.canonical_name };
          logger.info('Auto-linked will to existing canonical_persons by location+year', {
            displayName, resolvedPersonId,
          });
        } else {
          // Parse "County, State" from testatorLocation
          const locParts    = displayLocation ? displayLocation.split(/,\s*/) : [];
          const primaryCounty = locParts.length >= 2 ? locParts[0] : null;
          const primaryState  = locParts.length >= 2 ? locParts[1] : (locParts[0] || null);

          const newPerson = await db.query(
            `INSERT INTO canonical_persons
               (canonical_name, first_name, last_name,
                person_type, verification_status,
                primary_county, primary_state,
                death_year_estimate, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, canonical_name`,
            [
              displayName,
              firstName,
              lastName,
              'enslaver',
              'pending_review',
              primaryCounty,
              primaryState,
              displayYear || null,
              `Auto-created from will upload. ` +
              `Archive: ${archiveSource || 'not specified'}. ` +
              `Location: ${displayLocation || 'not specified'}. ` +
              `Pending source verification and admin review.`,
            ]
          );
          resolvedPersonId = newPerson.rows[0].id;
          matchedPerson = {
            id: newPerson.rows[0].id,
            canonical_name: newPerson.rows[0].canonical_name,
            created: true,
          };
          logger.info('Auto-created canonical_persons row from will upload', {
            displayName, resolvedPersonId,
          });
        }
      } catch (autoCreateErr) {
        logger.warn('Auto-create canonical_persons failed (non-fatal)', {
          error: autoCreateErr.message,
        });
      }
    }

    // ── 4. Build title and collection name ───────────────────────────────────
    let titleText, collectionName;

    if (docType === 'will') {
      titleText      = displayName
        ? `Will of ${displayName}${displayYear ? ` (${displayYear})` : ''}${displayLocation ? ` — ${displayLocation}` : ''}`
        : file.originalname;
      collectionName = displayName ? `Will of ${displayName}` : 'Uploaded Will';
    } else if (docType === 'case_register') {
      const eraLabel = (eraStart && eraEnd) ? `${eraStart}–${eraEnd}`
                      : eraStart ? `${eraStart}+`
                      : '';
      titleText = displayName
        ? `${displayName}${eraLabel ? ` (${eraLabel})` : ''}${compiledBy ? ` — comp. ${compiledBy}` : ''}`
        : file.originalname;
      collectionName = displayName || 'Uploaded Case Register';
    } else {
      titleText      = displayName
        ? `${displayName}${displayYear ? ` (${displayYear})` : ''}${displayLocation ? ` — ${displayLocation}` : ''}`
        : file.originalname;
      collectionName = displayName || 'Uploaded Document';
    }

    // ── 5. Insert person_documents row ───────────────────────────────────────
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
          docType,                                             // $3  document_type (not hardcoded 'will')
          file.originalname,                                   // $4  filename
          file.size,                                           // $5  file_size
          file.mimetype,                                       // $6  mime_type
          titleText,                                           // $7  title
          docType === 'will'            ? 'probate_record'
            : docType === 'case_register' ? 'court_record'
            : docType === 'deed'          ? 'deed_record'
            : docType === 'estate_inventory' ? 'estate_record'
            : 'archival_document',                             // $8  source_type_label
          collectionName,                                      // $9  collection_name
          displayName || file.originalname,                    // $10 name_as_appears (NOT NULL)
          displayYear || null,                                 // $11 document_year
          'public-ingestion',                                  // $12 created_by
          resolvedPersonId || null,                            // $13 canonical_person_id
        ]
      );
      personDocId = pdResult.rows[0].id;
    } catch (pdErr) {
      logger.error('person_documents insert failed', { error: pdErr.message });
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

    // ── 6. Insert will_extractions stub (WILLS ONLY) ─────────────────────────
    // For case_register, deed, estate_inventory, other: skip this table.
    // Those document types are post-processed by dedicated OCR scripts
    // (scripts/ocr-register-document.mjs etc.) that write to will_extractions
    // with the correct structured shape for their document class.
    let extractionId = null;

    if (docType === 'will') {
      try {
        const extResult = await db.query(
          `INSERT INTO will_extractions
             (document_id, canonical_person_id, participant_id,
              raw_pages_jsonb, structured_extraction_jsonb, extractor_version)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            personDocId,
            resolvedPersonId || null,
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
                name:     displayName || null,
                year:     displayYear || null,
                location: displayLocation || null,
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
    }

    logger.info('Document ingested', {
      docType, s3Key, personDocId, extractionId,
      displayName: displayName || '(none)',
    });

    // ── 7. Build next steps per document type ────────────────────────────────
    let nextSteps;
    if (docType === 'will') {
      nextSteps = [
        `Stored in S3: ${s3Key}`,
        matchedPerson?.created
          ? `New profile created for "${matchedPerson.canonical_name}" — pending source verification`
          : matchedPerson
            ? `Linked to existing profile: ${matchedPerson.canonical_name} (id ${matchedPerson.id})`
            : matchAmbiguous
              ? `Multiple persons match "${displayName}" — document stored, link manually later`
              : displayName
                ? 'Document stored — pending admin review and person linking'
                : 'Document stored — no person name provided',
        extractionId
          ? `Extraction record created — OCR processing will run automatically`
          : 'Document queued for processing',
      ];
    } else if (docType === 'case_register') {
      nextSteps = [
        `Stored in S3: ${s3Key}`,
        `person_documents.id = ${personDocId}`,
        'Next: run scripts/ocr-register-document.mjs --person-doc-id ' + personDocId + ' --apply',
        'Then: run scripts/parse-hynson-case-entries.js --person-doc-id ' + personDocId + ' --apply',
        'Then: run scripts/fanout-hynson-cases.js --person-doc-id ' + personDocId + ' --apply',
      ];
    } else {
      nextSteps = [
        `Stored in S3: ${s3Key}`,
        `person_documents.id = ${personDocId}`,
        'Document queued for manual OCR + extraction',
      ];
    }

    return res.json({
      success: true,
      personDocId,
      extractionId,
      s3Key,
      docType,
      matchedPerson:   matchedPerson   || null,
      matchAmbiguous:  matchAmbiguous,
      message: 'Document uploaded and recorded successfully',
      nextSteps,
    });
  } catch (err) {
    logger.error('Document ingestion error', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/wills/candidates ─────────────────────────────────────────────────
// Returns all canonical_persons rows whose name matches a query string.
// Used by the frontend disambiguation UI after an ambiguous will upload.
// Public — no auth required.
//
// Query params:
//   name  — the testator name to match (required)
//   limit — max results (default 10)
router.get('/candidates', async (req, res) => {
  const { name, limit = 10 } = req.query;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'name query param required' });
  }
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  const firstName = parts[0];
  const lastName  = parts[parts.length - 1];

  try {
    const result = await db.query(
      `SELECT
         id,
         canonical_name,
         person_type,
         birth_year_estimate  AS birth_year,
         death_year_estimate  AS death_year,
         primary_county,
         primary_state,
         primary_plantation,
         sex,
         notes
       FROM canonical_persons
       WHERE
         canonical_name ILIKE $1
         OR (first_name ILIKE $2 AND last_name ILIKE $3)
       ORDER BY
         (CASE WHEN canonical_name ILIKE $1 THEN 0 ELSE 1 END),
         canonical_name
       LIMIT $4`,
      [`%${trimmed}%`, `%${firstName}%`, `%${lastName}%`, parseInt(limit, 10)]
    );
    return res.json({ success: true, candidates: result.rows });
  } catch (err) {
    logger.error('Will candidates lookup error', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/wills/link ──────────────────────────────────────────────────────
// Links an uploaded document (person_documents row) to a canonical_persons row.
// Called from the frontend disambiguation UI.
// Public — no auth required.
//
// Body: { personDocId, canonicalPersonId, extractionId? }
router.post('/link', async (req, res) => {
  const { personDocId, canonicalPersonId, extractionId } = req.body;
  if (!personDocId || !canonicalPersonId) {
    return res.status(400).json({
      success: false,
      error: 'personDocId and canonicalPersonId are required',
    });
  }
  const pdId  = parseInt(personDocId, 10);
  const cpId  = parseInt(canonicalPersonId, 10);

  try {
    // Update person_documents
    await db.query(
      `UPDATE person_documents SET canonical_person_id = $1 WHERE id = $2`,
      [cpId, pdId]
    );

    // Update will_extractions if provided (non-fatal)
    if (extractionId) {
      try {
        await db.query(
          `UPDATE will_extractions SET canonical_person_id = $1 WHERE id = $2`,
          [cpId, extractionId]
        );
      } catch (extErr) {
        logger.warn('will_extractions link update skipped', { error: extErr.message });
      }
    }

    // Fetch the linked person's name for confirmation
    const cp = await db.query(
      `SELECT id, canonical_name FROM canonical_persons WHERE id = $1`,
      [cpId]
    );
    const linkedPerson = cp.rows[0] || null;

    logger.info('Document linked to canonical person', { pdId, cpId, extractionId });
    return res.json({
      success: true,
      linkedTo: linkedPerson,
      personDocId: pdId,
    });
  } catch (err) {
    logger.error('Document link error', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/wills/unlinked ───────────────────────────────────────────────────
// Returns person_documents rows for uploaded documents not yet linked to a
// canonical_persons row, with candidate matches for immediate resolution.
// Covers all document types (will, case_register, deed, etc.).
// Used by public/review.html "Unlinked Wills" queue.
// Public — no admin token required.
router.get('/unlinked', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || 50, 10), 200);
  const offset = parseInt(req.query.offset || 0, 10);
  const type   = req.query.type || null;  // optional filter by document_type

  try {
    const result = await db.query(
      `SELECT
         pd.id              AS person_doc_id,
         pd.title,
         pd.name_as_appears,
         pd.document_type,
         pd.document_year,
         pd.collection_name,
         pd.s3_key,
         pd.s3_url,
         pd.created_at,
         we.id              AS extraction_id,
         we.structured_extraction_jsonb
       FROM person_documents pd
       LEFT JOIN will_extractions we ON we.document_id = pd.id
       WHERE pd.canonical_person_id IS NULL
         AND ($1::text IS NULL OR pd.document_type = $1)
       ORDER BY pd.created_at DESC
       LIMIT $2 OFFSET $3`,
      [type, limit, offset]
    );

    // For each unlinked document, fetch the top 5 candidate canonical persons
    const rows = result.rows;
    const enriched = await Promise.all(rows.map(async (row) => {
      const name = row.name_as_appears || '';
      let candidates = [];
      if (name && row.document_type === 'will') {
        // Only auto-suggest candidates for will-type documents (single person)
        try {
          const parts = name.trim().split(/\s+/);
          const first = parts[0];
          const last  = parts[parts.length - 1];
          const cands = await db.query(
            `SELECT id, canonical_name, person_type,
                    birth_year_estimate AS birth_year,
                    death_year_estimate AS death_year,
                    primary_county, primary_state, primary_plantation
             FROM canonical_persons
             WHERE canonical_name ILIKE $1
                OR (first_name ILIKE $2 AND last_name ILIKE $3)
             ORDER BY (CASE WHEN canonical_name ILIKE $1 THEN 0 ELSE 1 END)
             LIMIT 5`,
            [`%${name.trim()}%`, `%${first}%`, `%${last}%`]
          );
          candidates = cands.rows;
        } catch (_) { /* non-fatal */ }
      }

      // Parse location/year from structured extraction if available
      let archiveSource = null;
      let location = null;
      try {
        const ext = row.structured_extraction_jsonb;
        if (ext && typeof ext === 'object') {
          archiveSource = ext.archive_source || null;
          location = ext.testator?.location || null;
        }
      } catch (_) { /* non-fatal */ }

      return { ...row, candidates, archiveSource, location };
    }));

    // Count total unlinked (with optional type filter)
    const countRes = await db.query(
      `SELECT COUNT(*) FROM person_documents
       WHERE canonical_person_id IS NULL
         AND ($1::text IS NULL OR document_type = $1)`,
      [type]
    );

    return res.json({
      success: true,
      total: parseInt(countRes.rows[0].count, 10),
      count: enriched.length,
      items: enriched,
    });
  } catch (err) {
    logger.error('Unlinked docs fetch error', { error: err.message });
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
         pd.s3_key, pd.title, pd.filename, pd.document_type
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
