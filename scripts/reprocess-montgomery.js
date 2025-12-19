/**
 * Ironclad Montgomery County (MSA Volume 812) Reprocessor
 *
 * NON-NEGOTIABLE PRINCIPLE: No Person Left Behind.
 *
 * This script reprocesses the entire Volume 812 collection:
 *   https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/html/am812--1.html
 *
 * Goals:
 * 1) Process every page and produce a PER-PAGE COVERAGE REPORT.
 * 2) Count EVERY row/line that has ink/text and emit an entity.
 *    - If name is unreadable, emit a placeholder person (Unknown Enslaved Person #N).
 * 3) Handle ditto marks (",") and blank repeated fields by carrying forward previous values.
 * 4) Enforce owner association: every enslaved person must have an owner (or be flagged explicitly).
 * 5) Use shared OCRProcessor (Google Vision via REST API key) + optional CursiveOCREnhancer.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/reprocess-montgomery.js [startPage] [endPage]
 *
 * Safe mode (default): DOES NOT delete existing msa records.
 * It inserts new records with extraction_method='msa_812_reprocess_v1'.
 */

require('dotenv').config();

const axios = require('axios');
const crypto = require('crypto');
const sharp = require('sharp');
const { Pool } = require('pg');

const OCRProcessor = require('../src/services/document/OCRProcessor');
const config = require('../config');

const VOLUME_ID = '812';

function msaPdfUrl(page) {
  return `https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000${VOLUME_ID}/pdf/am${VOLUME_ID}--${page}.pdf`;
}

async function downloadPdf(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    headers: {
      'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)',
      'Accept': 'application/pdf'
    }
  });
  return Buffer.from(response.data);
}

/**
 * Extract embedded image from PDF and standardize for OCR.
 * NOTE: This is the same heuristic as msa-archive-scraper.js.
 */
async function extractImageFromPdf(pdfBuffer) {
  const pdfString = pdfBuffer.toString('binary');
  let imageBuffer = null;

  const jpegStart = pdfString.indexOf('\xFF\xD8\xFF');
  if (jpegStart !== -1) {
    let jpegEnd = pdfString.indexOf('\xFF\xD9', jpegStart);
    if (jpegEnd !== -1) {
      jpegEnd += 2;
      imageBuffer = Buffer.from(pdfString.slice(jpegStart, jpegEnd), 'binary');
    }
  }

  if (!imageBuffer) {
    const pngStart = pdfString.indexOf('\x89PNG');
    if (pngStart !== -1) {
      const pngEnd = pdfString.indexOf('IEND', pngStart);
      if (pngEnd !== -1) {
        imageBuffer = Buffer.from(pdfString.slice(pngStart, pngEnd + 8), 'binary');
      }
    }
  }

  if (!imageBuffer) return null;

  // Standardize: upscale-ish width and sharpen a bit for table lines
  const processed = await sharp(imageBuffer)
    .resize(2400, null, { fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .sharpen()
    .png({ quality: 95 })
    .toBuffer();

  return processed;
}

/**
 * Detect if a line has "ink" / meaningful content.
 * We treat even partial marks as meaningful because each row represents a person.
 */
function lineHasInk(line) {
  if (!line) return false;
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;

  // If it contains any letter or digit, count it.
  if (/[A-Za-z0-9]/.test(trimmed)) return true;

  // Ditto marks or punctuation alone can still indicate data.
  // Only count if there is a ditto-like punctuation mark.
  if (/["“”′’´`]/.test(trimmed)) return true;

  return false;
}

function normalizeDittoToken(token) {
  if (!token) return '';
  const t = token.trim();
  // common ditto marks: ", ”, ″, do
  if (t === '"' || t === '“' || t === '”' || t === '″' || t.toLowerCase() === 'do') {
    return '__DITTO__';
  }
  return t;
}

/**
 * Very conservative row parsing:
 * - Split into columns on 2+ spaces OR tab
 * - Carry forward ditto marks and blanks
 * This is not perfect table detection yet; it's step 1 of "ironclad": row counting + placeholders.
 */
function parseRowsFromOcrText(ocrText) {
  const rawLines = ocrText.split('\n');

  // Filter obvious headers but KEEP any possible row
  const lines = rawLines
    .map(l => l.replace(/\s+$/g, ''))
    .filter(l => l.trim().length > 0);

  // Identify candidate data rows: we keep rows that are not pure headers.
  const headerRegex = /(RECORD OF SLAVES|MONTGOMERY COUNTY|NAME OF|SEX|AGE|PHYSICAL|CONDITION|TERM|SERVICE|MILITARY|CONSTITUTION|ADOPTION|TIME|REMARKS|DATE)/i;

  const dataLines = [];
  for (const l of lines) {
    if (headerRegex.test(l) && l.trim().length < 80) continue;
    if (!lineHasInk(l)) continue;
    dataLines.push(l);
  }

  // Convert lines -> columns
  const rows = [];
  let prevCols = [];
  for (const l of dataLines) {
    const cols = l.split(/\t|\s{2,}/).map(c => normalizeDittoToken(c));

    // Carry forward ditto marks / blanks
    const resolved = cols.map((c, idx) => {
      if (c === '__DITTO__' || c === '') {
        return prevCols[idx] || '';
      }
      return c;
    });

    // Update prevCols only if we have something
    if (resolved.some(x => x && x !== '__DITTO__')) {
      prevCols = resolved;
    }

    rows.push({
      raw: l,
      cols: resolved
    });
  }

  return rows;
}

/**
 * Extract owner name heuristically from OCR text.
 * For Volume 812 pages, owner often appears near "By whom owned" or near the top.
 */
async function extractOwnerCandidates(pool, page, ocrText) {
  const text = ocrText.replace(/\s+/g, ' ');

  // 1) Try explicit OCR label patterns
  const patterns = [
    /By\s+whom\s+owned\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]+)+)/g,
    /Owned\s+by\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]+)+)/g,
    /Owner\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]+)+)/g
  ];

  const candidates = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      candidates.push(m[1].trim());
    }
  }

  // 2) Fallback: if we already have known owner/slaveholder entities for this PDF page,
  // use them as owner candidates (this prevents owner=NULL, which is unacceptable).
  // This is not a bandaid: it is a hard constraint enforcement mechanism.
  if (candidates.length === 0) {
    const sourceUrl = msaPdfUrl(page);
    const { rows } = await pool.query(
      `
        SELECT DISTINCT full_name
        FROM unconfirmed_persons
        WHERE source_url = $1
          AND person_type IN ('owner','slaveholder')
          AND extraction_method != 'msa_812_reprocess_v1'
        ORDER BY full_name
      `,
      [sourceUrl]
    );
    for (const r of rows) candidates.push(r.full_name);
  }

  // Sanity filter: drop obvious OCR garbage / short tokens.
  const cleaned = candidates
    .map(c => c.trim())
    .filter(c => c.length >= 4)
    .filter(c => /^[A-Z][A-Za-z.\s'-]+$/.test(c))
    .filter(c => !/^Frames\b/i.test(c));

  return [...new Set(cleaned)];
}

function buildPlaceholderName(page, rowIndex) {
  return `Unknown Enslaved Person (Vol ${VOLUME_ID} p.${page} row ${rowIndex + 1})`;
}

async function ensureCoverageTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS msa_reprocess_coverage (
      id BIGSERIAL PRIMARY KEY,
      volume_id TEXT NOT NULL,
      page_number INT NOT NULL,
      source_url TEXT NOT NULL,
      ocr_service TEXT,
      ocr_confidence NUMERIC,
      ocr_text_length INT,
      detected_rows INT NOT NULL,
      emitted_persons INT NOT NULL,
      named_persons INT NOT NULL,
      placeholder_persons INT NOT NULL,
      owner_candidates TEXT[],
      owner_assigned TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (volume_id, page_number)
    );
  `);
}

function computeRowFingerprint({ volumeId, page, rowIndex, rowRaw, ownerAssigned }) {
  const normalized = `${volumeId}|${page}|${rowIndex}|${(ownerAssigned || '').trim()}|${rowRaw.trim().replace(/\s+/g, ' ')}`;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

async function savePerson(pool, { fullName, ownerName, sourceUrl, page, rowRaw, confidence = 0.5 }) {
  const ctx = [
    `Maryland State Archives, SC 2908, Vol. ${VOLUME_ID}, p. ${page}.`,
    `Source: ${sourceUrl}.`,
    `Row OCR: ${rowRaw}`,
    ownerName ? `Owner: ${ownerName}` : 'Owner: UNKNOWN'
  ].join(' ');

  await pool.query(
    `
      INSERT INTO unconfirmed_persons (
        full_name,
        person_type,
        source_url,
        extraction_method,
        context_text,
        confidence_score,
        status,
        source_type,
        created_at
      ) VALUES ($1,'enslaved',$2,$3,$4,$5,'pending','primary',NOW())
      ON CONFLICT DO NOTHING
    `,
    [fullName, sourceUrl, 'msa_812_reprocess_v1', ctx, confidence]
  );
}

async function recordRowAndMaybeEmitPerson({
  pool,
  page,
  rowIndex,
  rowRaw,
  extractedName,
  emittedFullName,
  ownerAssigned
}) {
  const rowFingerprint = computeRowFingerprint({
    volumeId: VOLUME_ID,
    page,
    rowIndex,
    rowRaw,
    ownerAssigned
  });

  const sourceUrl = msaPdfUrl(page);

  const { rowCount } = await pool.query(
    `
      INSERT INTO msa_812_reprocess_rows (
        volume_id,
        page_number,
        row_index,
        source_url,
        row_raw,
        owner_assigned,
        extracted_name,
        emitted_full_name,
        row_fingerprint
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (row_fingerprint) DO NOTHING
    `,
    [
      VOLUME_ID,
      page,
      rowIndex,
      sourceUrl,
      rowRaw,
      ownerAssigned,
      extractedName,
      emittedFullName,
      rowFingerprint
    ]
  );

  // Only emit into unconfirmed_persons the first time we see this row.
  return rowCount === 1;
}

async function reprocessPage({ pool, ocrProcessor, page }) {
  const sourceUrl = msaPdfUrl(page);
  const pdfBuffer = await downloadPdf(sourceUrl);
  const imageBuffer = await extractImageFromPdf(pdfBuffer);

  if (!imageBuffer) {
    return {
      sourceUrl,
      ocr: { service: 'none', confidence: 0, text: '' },
      rows: [],
      emitted: 0,
      named: 0,
      placeholder: 0,
      ownerCandidates: [],
      ownerAssigned: null
    };
  }

  const file = { buffer: imageBuffer, originalname: `am812--${page}.png`, mimetype: 'image/png' };
  const ocr = await ocrProcessor.processWithEnhancement(file);

  const rows = parseRowsFromOcrText(ocr.text || '');
  const ownerCandidates = await extractOwnerCandidates(pool, page, ocr.text || '');
  const ownerAssigned = ownerCandidates[0] || null;

  // Emit one person per row.
  let emitted = 0;
  let named = 0;
  let placeholder = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Heuristic: assume first column is a name-ish token.
    const maybeName = (row.cols[0] || '').trim();
    // Do NOT allow known header tokens to become "named" persons.
    const headerTokens = new Set([
      'Compensation', 'Name', 'Names', 'Owner', 'Date', 'Sex', 'Age', 'Physical', 'Condition',
      'Term', 'Service', 'Military', 'Constitution', 'Adoption', 'Time', 'Remarks'
    ]);

    const nameLooksLegit =
      /^[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}$/.test(maybeName) &&
      !headerTokens.has(maybeName);

    const fullName = nameLooksLegit ? maybeName : buildPlaceholderName(page, i);

    if (nameLooksLegit) named++; else placeholder++;

    const shouldEmit = await recordRowAndMaybeEmitPerson({
      pool,
      page,
      rowIndex: i,
      rowRaw: row.raw,
      extractedName: maybeName,
      emittedFullName: fullName,
      ownerAssigned
    });

    if (shouldEmit) {
      await savePerson(pool, {
        fullName,
        ownerName: ownerAssigned,
        sourceUrl,
        page,
        rowRaw: row.raw,
        confidence: nameLooksLegit ? Math.max(0.5, ocr.confidence || 0.5) : 0.2
      });
      emitted++;
    }
  }

  return {
    sourceUrl,
    ocr,
    rows,
    emitted,
    named,
    placeholder,
    ownerCandidates,
    ownerAssigned
  };
}

async function main() {
  const startPage = parseInt(process.argv[2] || '1', 10);
  const endPage = parseInt(process.argv[3] || '0', 10) || null;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || config.database.connectionString,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : config.database.ssl
  });

  const ocrProcessor = new OCRProcessor();
  // IMPORTANT: initialize learning enhancer (machine learning intentionality)
  ocrProcessor.initializeCursiveEnhancer(pool);

  await ensureCoverageTable(pool);

  // Determine last page if not specified
  let last = endPage;
  if (!last) {
    // crude binary search using HEAD on html pages, same as msa-archive-scraper
    let low = 1;
    let high = 500;
    async function pageExists(p) {
      const url = `https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000${VOLUME_ID}/html/am${VOLUME_ID}--${p}.html`;
      try {
        const r = await axios.head(url, { timeout: 5000 });
        return r.status === 200;
      } catch {
        return false;
      }
    }

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      const exists = await pageExists(mid);
      if (exists) low = mid;
      else high = mid - 1;
    }
    last = low;
  }

  console.log(`\n=== MSA Volume ${VOLUME_ID} Reprocess (No Person Left Behind) ===`);
  console.log(`Pages: ${startPage} -> ${last}`);
  console.log(`OCR: ${ocrProcessor.googleVisionAvailable ? 'Google Vision available' : 'Tesseract only'}`);

  for (let page = startPage; page <= last; page++) {
    console.log(`\n📄 Reprocessing page ${page}...`);
    try {
      const res = await reprocessPage({ pool, ocrProcessor, page });

      await pool.query(
        `
          INSERT INTO msa_reprocess_coverage (
            volume_id, page_number, source_url,
            ocr_service, ocr_confidence, ocr_text_length,
            detected_rows, emitted_persons, named_persons, placeholder_persons,
            owner_candidates, owner_assigned
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT (volume_id, page_number)
          DO UPDATE SET
            source_url = EXCLUDED.source_url,
            ocr_service = EXCLUDED.ocr_service,
            ocr_confidence = EXCLUDED.ocr_confidence,
            ocr_text_length = EXCLUDED.ocr_text_length,
            detected_rows = EXCLUDED.detected_rows,
            emitted_persons = EXCLUDED.emitted_persons,
            named_persons = EXCLUDED.named_persons,
            placeholder_persons = EXCLUDED.placeholder_persons,
            owner_candidates = EXCLUDED.owner_candidates,
            owner_assigned = EXCLUDED.owner_assigned,
            created_at = NOW();
        `,
        [
          VOLUME_ID,
          page,
          res.sourceUrl,
          res.ocr.service || null,
          res.ocr.confidence || 0,
          (res.ocr.text || '').length,
          res.rows.length,
          res.emitted,
          res.named,
          res.placeholder,
          res.ownerCandidates,
          res.ownerAssigned
        ]
      );

      console.log(`   ✅ rows=${res.rows.length} emitted=${res.emitted} named=${res.named} placeholder=${res.placeholder} owner=${res.ownerAssigned || 'UNKNOWN'}`);

      // Vigilance: if we detected rows but no owner, scream.
      if (res.rows.length > 0 && !res.ownerAssigned) {
        console.log(`   🚨 OWNER MISSING on page ${page} while rows exist.`);
      }

      // gentle rate limit
      await new Promise(r => setTimeout(r, 750));
    } catch (e) {
      console.error(`   ❌ Page ${page} failed: ${e.message}`);
    }
  }

  console.log('\n✅ Reprocessing run completed. Coverage table: msa_reprocess_coverage');
  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
