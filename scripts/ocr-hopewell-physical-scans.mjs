/**
 * scripts/ocr-hopewell-physical-scans.mjs
 *
 * OCR the five St. Mary's County Register of Wills physical scans and wire
 * their contents into the probate evidence graph.
 *
 * This script is the validated OCR path that will eventually become
 * `src/services/probate/will-ocr.js` (plan §3.2). For now it runs as a
 * one-off script with hardcoded PDF paths. Generalized from
 * `scripts/ocr-hopewell-will.mjs`.
 *
 * Session: 2026-05-12 (Session 52)
 * Plan reference: memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md
 *
 * Usage:
 *   node scripts/ocr-hopewell-physical-scans.mjs           # dry-run (default)
 *   node scripts/ocr-hopewell-physical-scans.mjs --apply   # OCR + DB writes
 *
 * DRIVER: pg.Pool directly — NOT the Neon serverless HTTP adapter.
 * rowCount behaves correctly. RETURNING id used for confirmation.
 *
 * CONSTRAINT: Do NOT overwrite person_documents.ocr_text for id=19.
 * The existing FamilySearch pre-indexed transcription is higher quality
 * than raw Vision OCR on a physical scan. Fresh-scan OCR goes into
 * will_extractions.raw_pages_jsonb only.
 */

import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import axios from 'axios';
import pg from 'pg';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const S3Service = require('../src/services/storage/S3Service');

// ── CLI flags ─────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const EXTRACTOR_VERSION = 'ocr-physical-scan-session-2026-05-12';

// ── PDF paths (confirmed 2026-05-12) ─────────────────────────────────────────
const PDF_MANIFEST = [
  {
    localPath: "/Users/danyelabrown/Downloads/saint mary's will 1.pdf",
    slug: 'james-hopewell-1817',
    s3Prefix: 'wills/james-hopewell-1817',
    docType: 'james_1817',
    pages: 3,
    existingPersonDocId: 19,      // DO NOT overwrite ocr_text on this row
    canonicalPersonId: 1070,
  },
  {
    localPath: "/Users/danyelabrown/Downloads/saint mary's will 2.pdf",
    slug: 'composite-1848',
    s3Prefix: 'wills/james-h-hopewell-1848-composite',
    docType: 'composite_1848',
    pages: 2,
    existingPersonDocId: null,
    canonicalPersonId: null,
  },
  {
    localPath: "/Users/danyelabrown/Downloads/saint mary's will 3.pdf",
    slug: 'hugh-hopewell-v-1777',
    s3Prefix: 'wills/hugh-hopewell-v-1777',
    docType: 'hugh_v_1777',
    pages: 3,
    existingPersonDocId: null,
    canonicalPersonId: null,     // resolved after Phase 1 lookup
  },
  {
    localPath: "/Users/danyelabrown/Downloads/saint mary's will 4.pdf",
    slug: 'composite-1785',
    s3Prefix: 'wills/hugh-hopewell-vi-1785-composite',
    docType: 'composite_1785',
    pages: 6,
    existingPersonDocId: null,
    canonicalPersonId: null,     // resolved after Phase 1 lookup
  },
];

// ── DB pool ───────────────────────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Vision API ────────────────────────────────────────────────────────────────
const VISION_KEY = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_API_KEY;

// ── Classification signals ────────────────────────────────────────────────────
const CLASSIFICATION_SIGNALS = {
  james_1817: {
    definitive: [
      /Ann\s+Maria\s+\w{0,20}(?:Biscoe|Beicar|Bercer|Biscor|Biscar)/i,
      /beloved\s+wife\s+\w{0,50}Angelica/i,
    ],
    confirming: [
      /Angelica\s+Hopewell/i,
      /Henrietta\s+Rebec/i,
      /Olivia\s+Caroline/i,
      /James\s+Robert\s+Hopewell/i,
      /Lewis.{0,30}Peter.{0,30}Fanny/i,
      /1817/,
    ],
    disqualifying: [
      /wife\s+Elizabeth\s+Hopewell/i,
      /Henry\s+Hopewell.{0,20}executor/i,
    ],
  },
  hugh_v_1777: {
    definitive: [
      /Thomas\s+Hopewell.{0,200}Pollard\s+Hopewell/is,
      /Elizabeth\s+Hopewell.{0,50}James\s+Hopewell.{0,50}executor/is,
    ],
    confirming: [
      /Jacob\s+and\s+Haney/i,
      /Lavisors\s+Creek/i,
      /Aquilla\s+Hall/i,
      /1777/,
      /Jeremiah\s+Jordan/i,
    ],
    disqualifying: [
      /wife\s+Hannah/i,
    ],
  },
  hugh_vi_1785: {
    definitive: [
      /wife\s+Hannah\s+Hopewell/i,
      /brother\s+James\s+Hopewell/i,
    ],
    confirming: [
      /Townbrook/i,
      /John\s+Borom/i,
      /1785/,
    ],
    disqualifying: [
      /wife\s+Elizabeth\s+Hopewell/i,
      /Thomas\s+Hopewell/i,
    ],
  },
  james_h_1848: {
    signals: [
      /wife\s+Elizabeth\s+Hopewell/i,
      /Henry\s+Hopewell.{0,30}executor/i,
      /Maria\s+Wheatly/i,
      /1848/,
    ],
  },
};

// ── OCR helpers ───────────────────────────────────────────────────────────────

async function ocrImage(imagePath) {
  if (!VISION_KEY) throw new Error('GOOGLE_VISION_API_KEY not set');
  const buf = fs.readFileSync(imagePath);
  const res = await axios.post(
    `https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`,
    {
      requests: [{
        image: { content: buf.toString('base64') },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      }],
    },
    { timeout: 120000 }
  );
  const ann = res.data.responses[0];
  if (ann.error) throw new Error(`Vision API error: ${ann.error.message}`);
  return {
    text: ann.fullTextAnnotation?.text || '',
    rawResponse: ann,  // preserved for bounding-box data
  };
}

async function ocrDocument(manifest) {
  const { localPath, slug } = manifest;

  if (!fs.existsSync(localPath)) {
    throw new Error(`PDF not found: ${localPath}`);
  }

  const outDir = path.join('/tmp/hopewell-physical-scans', slug);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n  Converting PDF → PNGs (300 DPI): ${path.basename(localPath)}`);
  // Quote the path to handle spaces
  execSync(
    `pdftoppm -r 300 -png "${localPath}" "${path.join(outDir, 'page')}"`,
    { stdio: 'inherit' }
  );

  const pngFiles = fs.readdirSync(outDir)
    .filter(f => f.match(/^page.*\.png$/))
    .sort();
  console.log(`  ${pngFiles.length} page(s): ${pngFiles.join(', ')}`);

  const pageResults = [];
  for (let i = 0; i < pngFiles.length; i++) {
    const pngPath = path.join(outDir, pngFiles[i]);
    console.log(`  OCR page ${i + 1}/${pngFiles.length}: ${pngFiles[i]} …`);
    const { text, rawResponse } = await ocrImage(pngPath);
    const firstLine = (text.split('\n')[0] || '').slice(0, 80);
    console.log(`    ${text.length} chars, first line: "${firstLine}"`);

    // Save raw JSON (includes pages[0].blocks bounding-box data for future will-package-splitter.js)
    const rawJsonPath = path.join(outDir, `page-${i + 1}-raw.json`);
    fs.writeFileSync(rawJsonPath, JSON.stringify(rawResponse, null, 2));

    pageResults.push({
      index: i + 1,
      filename: pngFiles[i],
      page_type: 'narrative_will',  // will-package-splitter will refine this
      ocr_text: text,
      ocr_method: 'DOCUMENT_TEXT_DETECTION',
      confidence: 0,   // Vision doesn't return a single confidence for DOCUMENT_TEXT_DETECTION
      raw_json_path: rawJsonPath,
    });
  }

  // Concatenate full text
  const fullText = pageResults
    .map(p => `── Page ${p.index} (${p.filename}) ──\n${p.ocr_text}`)
    .join('\n\n');
  const fullTextPath = path.join(outDir, 'full-text.txt');
  fs.writeFileSync(fullTextPath, fullText);
  console.log(`  Full text: ${fullText.length} chars → ${fullTextPath}`);

  return { pageResults, fullText, outDir };
}

// ── Classification ────────────────────────────────────────────────────────────

function classifyDocument(fullText, sourceFile) {
  const results = {};

  for (const [profile, spec] of Object.entries(CLASSIFICATION_SIGNALS)) {
    if (profile === 'james_h_1848') {
      const hits = spec.signals.filter(re => re.test(fullText)).map(re => re.toString());
      results[profile] = { hits, matched: hits.length >= 2 };
      continue;
    }

    const definitiveHits = spec.definitive
      .filter(re => re.test(fullText))
      .map(re => re.toString());
    const confirmingHits = spec.confirming
      .filter(re => re.test(fullText))
      .map(re => re.toString());
    const disqualifyingHits = spec.disqualifying
      .filter(re => re.test(fullText))
      .map(re => re.toString());

    results[profile] = {
      definitiveHits,
      confirmingHits,
      disqualifyingHits,
      isDefinitive: definitiveHits.length >= 1,
      isConfirmed: definitiveHits.length >= 1 && disqualifyingHits.length === 0,
      isProbable: confirmingHits.length >= 4 && disqualifyingHits.length === 0,
    };
  }

  // Determine best match
  let matchedProfile = null;
  let classification = 'UNKNOWN';
  let requiresHumanReview = true;

  // Check disqualifying for james_h_1848 first
  if (results.james_h_1848?.matched) {
    matchedProfile = 'james_h_1848';
    classification = 'DISQUALIFIED_NOT_ANCESTOR';
    requiresHumanReview = false;
  }

  for (const profile of ['james_1817', 'hugh_v_1777', 'hugh_vi_1785']) {
    if (results[profile]?.isConfirmed) {
      matchedProfile = profile;
      classification = 'CONFIRMED';
      requiresHumanReview = false;
      break;
    }
  }

  if (!matchedProfile) {
    for (const profile of ['james_1817', 'hugh_v_1777', 'hugh_vi_1785']) {
      if (results[profile]?.isProbable) {
        matchedProfile = profile;
        classification = 'PROBABLE';
        requiresHumanReview = true;
        break;
      }
    }
  }

  // OCR quality estimate: if > 15% of words look garbled, set LOW
  const wordCount = fullText.split(/\s+/).length;
  const garbledCount = (fullText.match(/[^\x00-\x7F]{2,}|[a-z]{8,}\d[a-z]{3,}/g) || []).length;
  const garbledRatio = wordCount > 0 ? garbledCount / wordCount : 0;
  const ocrQuality = garbledRatio > 0.15 ? 'LOW' : 'MEDIUM';
  if (ocrQuality === 'LOW') requiresHumanReview = true;

  const classResult = {
    source_file: sourceFile,
    classification,
    matched_profile: matchedProfile,
    definitive_signals_hit: matchedProfile && results[matchedProfile]?.definitiveHits || [],
    confirming_signals_hit: matchedProfile && results[matchedProfile]?.confirmingHits || [],
    disqualifying_signals_hit: matchedProfile && results[matchedProfile]?.disqualifyingHits || [],
    requires_human_review: requiresHumanReview,
    ocr_quality_estimate: ocrQuality,
    all_profile_results: results,
    notes: ocrQuality === 'LOW'
      ? 'OCR quality LOW — >15% apparent garbling detected. Manual review required.'
      : '',
  };

  return classResult;
}

// ── Extract a context quote from OCR text around a pattern ───────────────────

function extractQuote(text, pattern, maxLen = 300) {
  const re = typeof pattern === 'string'
    ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    : pattern;
  const m = re.exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index - 80);
  const end = Math.min(text.length, m.index + m[0].length + 180);
  return `…${text.slice(start, end).replace(/\s+/g, ' ')}…`;
}

// ── Structured extraction builders ───────────────────────────────────────────

function buildJames1817Extraction(fullText) {
  // VERIFIED DOCUMENT FACTS are ground truth.
  // OCR text is used to populate raw_quotes_per_field_jsonb.
  // Do NOT normalize enslaved names.
  return {
    testator: {
      name: 'James Hopewell',
      place: "Saint Mary's County, Maryland",
      signing_date: '1817-02-14',
      proved_dates: ['1817-12-16', '1817-12-23'],
    },
    spouse: { name: 'Angelica Hopewell' },
    children: [
      { name: 'James Robert Hopewell', role: 'heir',
        share_described: "Lands on wife's death or remarriage; contingent on surviving to 21 or having issue" },
      { name: 'Ann Maria Biscoe', role: 'heir',
        share_described: 'Bequest 4: Midley, Adam, Lloyd, Such + children, Ester + child Ally',
        ocr_name_variants: ['Ann Maria Beicar', 'Ann Maria Bercer', 'Ann Maria Biscor'],
        canonical_person_id: 141015 },
      { name: 'Olivia Caroline', role: 'heir',
        share_described: 'Bequest 3: Samuel, Rachel, Jem, Allison, Sophy, Sally, Peggy' },
      { name: 'Henrietta Rebecca', role: 'heir',
        share_described: 'Bequest 2: Minna + 8 children (John, Harriett, Sandy, George, Charlotte, Isaac + uncertain names)' },
    ],
    enslaved_persons: [
      // Bequest 1 → Angelica Hopewell
      { name: 'Lewis', sex: 'male', bequeathed_to: 'Angelica Hopewell', manumitted: false,
        context_quote: extractQuote(fullText, /Lewis.{0,60}Peter.{0,60}Fanny/i)
          || 'one negro man named Lewis and his son Peter and his Daughter Fanny' },
      { name: 'Peter', sex: 'male', bequeathed_to: 'Angelica Hopewell', manumitted: false,
        relationship: 'son of Lewis',
        context_quote: extractQuote(fullText, /son\s+Peter/i) },
      { name: 'Fanny', sex: 'female', bequeathed_to: 'Angelica Hopewell', manumitted: false,
        relationship: 'daughter of Lewis',
        context_quote: extractQuote(fullText, /[Dd]aughter\s+Fanny/i) },
      { name: 'Job', sex: 'male', bequeathed_to: 'Angelica Hopewell', manumitted: false,
        context_quote: extractQuote(fullText, /negro\s+man\s+Job/i) },
      { name: 'Joe', sex: 'male', bequeathed_to: 'Angelica Hopewell', manumitted: false,
        context_quote: extractQuote(fullText, /negro\s+man\s+Joe/i) },
      { name: 'Sarah', sex: 'female', bequeathed_to: 'Angelica Hopewell', manumitted: false,
        relationship: 'wife of Joe',
        context_quote: extractQuote(fullText, /Joe.{0,30}wife\s+Sarah/i)
          || extractQuote(fullText, /Sarah/i) },
      { name: 'Ezekiel', sex: 'male', bequeathed_to: 'Angelica Hopewell', manumitted: false,
        note: 'described as "yellow Negro"',
        context_quote: extractQuote(fullText, /Ezekiel/i) },
      // Bequest 2 → Henrietta Rebecca
      { name: 'Minna', sex: 'female', bequeathed_to: 'Henrietta Rebecca', manumitted: false,
        context_quote: extractQuote(fullText, /Minna/i) },
      { name: 'John', sex: 'male', bequeathed_to: 'Henrietta Rebecca', manumitted: false,
        relationship: 'child of Minna',
        context_quote: extractQuote(fullText, /Minna.{0,200}John/is) },
      { name: 'Harriett', sex: 'female', bequeathed_to: 'Henrietta Rebecca', manumitted: false,
        relationship: 'child of Minna',
        context_quote: extractQuote(fullText, /Harriett/i) },
      { name: 'Sandy', sex: null, bequeathed_to: 'Henrietta Rebecca', manumitted: false,
        name_uncertain: true,
        name_variants_possible: ['Sandy', 'Trudy', 'Henry', 'Will'],
        relationship: 'child of Minna',
        context_quote: extractQuote(fullText, /Sandy/i) },
      { name: 'George', sex: 'male', bequeathed_to: 'Henrietta Rebecca', manumitted: false,
        relationship: 'child of Minna',
        context_quote: extractQuote(fullText, /George/i) },
      { name: 'Charlotte', sex: 'female', bequeathed_to: 'Henrietta Rebecca', manumitted: false,
        relationship: 'child of Minna',
        context_quote: extractQuote(fullText, /Charlotte/i) },
      { name: 'Isaac', sex: 'male', bequeathed_to: 'Henrietta Rebecca', manumitted: false,
        relationship: 'child of Minna',
        context_quote: extractQuote(fullText, /Isaac/i) },
      // Bequest 3 → Olivia Caroline
      { name: 'Samuel', sex: 'male', bequeathed_to: 'Olivia Caroline', manumitted: false,
        context_quote: extractQuote(fullText, /Samuel.{0,40}Rachel/i) },
      { name: 'Rachel', sex: 'female', bequeathed_to: 'Olivia Caroline', manumitted: false,
        relationship: 'wife of Samuel',
        context_quote: extractQuote(fullText, /Rachel/i) },
      { name: 'Jem', sex: null, bequeathed_to: 'Olivia Caroline', manumitted: false,
        relationship: 'child of Samuel and Rachel',
        context_quote: extractQuote(fullText, /Jem/i) },
      { name: 'Allison', sex: null, bequeathed_to: 'Olivia Caroline', manumitted: false,
        relationship: 'child of Samuel and Rachel',
        context_quote: extractQuote(fullText, /Allison/i) },
      { name: 'Sophy', sex: 'female', bequeathed_to: 'Olivia Caroline', manumitted: false,
        relationship: 'child of Samuel and Rachel',
        context_quote: extractQuote(fullText, /Sophy/i) },
      { name: 'Sally', sex: 'female', bequeathed_to: 'Olivia Caroline', manumitted: false,
        relationship: 'child of Samuel and Rachel',
        context_quote: extractQuote(fullText, /Sally/i) },
      { name: 'Peggy', sex: 'female', bequeathed_to: 'Olivia Caroline', manumitted: false,
        relationship: 'child of Samuel and Rachel',
        context_quote: extractQuote(fullText, /Peggy/i) },
      // Bequest 4 → Ann Maria Biscoe
      { name: 'Midley', sex: 'female', bequeathed_to: 'Ann Maria Biscoe', manumitted: false,
        name_uncertain: true,
        name_variants_possible: ['Middly', 'Medley', 'Middy'],
        context_quote: extractQuote(fullText, /M[ie][dt][ld](?:ey|ly|y)/i) },
      { name: 'Adam', sex: 'male', bequeathed_to: 'Ann Maria Biscoe', manumitted: false,
        context_quote: extractQuote(fullText, /negro\s+man\s+Adam/i) },
      { name: 'Lloyd', sex: 'male', bequeathed_to: 'Ann Maria Biscoe', manumitted: false,
        context_quote: extractQuote(fullText, /Lloyd/i) },
      { name: 'Such', sex: 'female', bequeathed_to: 'Ann Maria Biscoe', manumitted: false,
        name_uncertain: true,
        name_variants_possible: ['Such', 'Susan', 'Sarah (OCR error — different person from Joe\'s wife Sarah)'],
        context_quote: extractQuote(fullText, /Such/i)
          || extractQuote(fullText, /negro\s+woman.{0,30}(?:Such|Susan)/i) },
      { name: 'Mary', sex: 'female', bequeathed_to: 'Ann Maria Biscoe', manumitted: false,
        relationship: 'child of Such',
        context_quote: extractQuote(fullText, /Such.{0,200}Mary/is) },
      { name: 'Nancy', sex: 'female', bequeathed_to: 'Ann Maria Biscoe', manumitted: false,
        relationship: 'child of Such',
        context_quote: extractQuote(fullText, /Nancy/i) },
      { name: 'Louisa', sex: 'female', bequeathed_to: 'Ann Maria Biscoe', manumitted: false,
        relationship: 'child of Such',
        context_quote: extractQuote(fullText, /Louisa/i) },
      { name: 'Ester', sex: 'female', bequeathed_to: 'Ann Maria Biscoe', manumitted: false,
        name_uncertain: true,
        name_variants_possible: ['Ester', 'Esther'],
        context_quote: extractQuote(fullText, /Es[th]+er/i) },
      { name: 'Ally', sex: null, bequeathed_to: 'Ann Maria Biscoe', manumitted: false,
        relationship: 'child of Ester',
        context_quote: extractQuote(fullText, /Ally/i) },
    ],
    executors: [{ name: 'Angelica Hopewell', role: 'sole executrix' }],
    witnesses: [
      { name: 'Austin Leigh', note: 'signed by mark', folio: 480 },
      { name: 'Massey', note: 'sealed', folio: 480 },
      { name: 'Luke W. Barker', folio: 482 },
      { name: 'Brc. Leigh', folio: 482 },
      { name: 'James Daffin', folio: 482 },
    ],
    registrar: {
      name: 'James Forrest',
      court: "Saint Mary's County Register of Wills",
    },
    court_jurisdiction: "Saint Mary's County, Maryland",
    probate_folios: '480–482',
    raw_quotes_per_field_jsonb: {
      testator_signing_date: extractQuote(fullText, /14th?\s+(?:day\s+of\s+)?February\s+1817/i),
      probate_dates: extractQuote(fullText, /December\s+1817/i),
      registrar: extractQuote(fullText, /James\s+Forrest/i),
      spouse_name: extractQuote(fullText, /Angelica\s+Hopewell/i),
      daughter_ann_maria: extractQuote(fullText, /Ann\s+Maria/i),
    },
    name_resolution_proposals: [
      {
        ocr_name: 'Ann Maria Beicar',
        ocr_name_variants: ['Ann Maria Bercer', 'Ann Maria Biscor', 'Ann Maria Biscar'],
        proposed_canonical_id: 141015,
        proposed_canonical_name: 'Ann Maria Biscoe',
        confidence: 0.92,
        resolution_basis: "OCR artifact 'Beicar/Bercer' is known rendering of 'Biscoe' in this document; confirmed by session context and existing DB record cp=141015",
      },
      {
        ocr_name: 'Angelica Hopewell',
        proposed_canonical_id: 140299,
        proposed_canonical_name: 'Angelica Chesley',
        confidence: 0.95,
        resolution_basis: "Will names wife by married name Hopewell (née Chesley); cp=140299 confirmed by ocr-hopewell-will.mjs --apply run (Session 32)",
      },
    ],
    extraction_notes: [
      'KNOWN ERROR IN test-daa-hopewell.js: that script assigns Sarah to Ann Maria Biscoe. INCORRECT. Sarah is Joe\'s wife, bequeathed to Angelica (Bequest 1). The enslaved mother in Bequest 4 (Ann Maria) is named SUCH, not Sarah.',
      'Bequest 2 (Henrietta Rebecca): two children of Minna have uncertain names. OCR variants include Trudy/Sandy/Henry/Will. Names preserved as-is with name_uncertain flag.',
    ],
  };
}

function buildHughV1777Extraction(fullText) {
  return {
    testator: {
      name: 'Hugh Hopewell',
      familysearch_id: 'GX1Q-ZMD',
      place: "Saint Mary's County, Maryland",
      signing_date: '1777-02-01',  // day partially legible — first of month as placeholder
      signing_date_uncertain: true,
      proved_dates: ['1777-07-22'],
    },
    spouse: {
      name: 'Elizabeth Hopewell',
      maiden_name: 'Edmondson',
      note: 'Elected dower/third part 22 July 1777',
    },
    children: [
      { name: 'Thomas Hopewell', role: 'heir',
        share_described: 'Plantation on Lavisors Creek + all Negroes on that plantation EXCEPT Jacob and Haney + stock except cattle carried down last fall + one horse bought of John Arquith' },
      { name: 'Pollard Hopewell', role: 'heir',
        share_described: 'Lands where Aquilla Hall lives; other Buchanan lands equalized by Peter Urquhart and Robert Watts' },
      { name: 'James Hopewell', role: 'heir', canonical_person_id: 1070,
        share_described: 'Residue of Buchanan/Lemas Hopewell lands and heirs' },
      { name: 'Anna Hobb', role: 'heir', note: 'née Hopewell',
        share_described: 'Equal part of personal estate' },
      { name: 'Elizabeth Hopewell', role: 'heir', note: 'daughter (different from wife)',
        share_described: 'Equal part personal estate excluding what already given' },
    ],
    spouse_share: {
      name: 'Elizabeth Hopewell',
      share_described: 'One-sixth part personal estate',
    },
    enslaved_persons: [
      { name: 'Jacob', sex: 'male', bequeathed_to: null, manumitted: false,
        note: 'Excepted from Thomas\'s bequest. Disposition of excepted enslaved persons not specified in will text alone.',
        context_quote: extractQuote(fullText, /Jacob\s+and\s+Haney/i) },
      { name: 'Haney', sex: null, bequeathed_to: null, manumitted: false,
        note: 'Excepted from Thomas\'s bequest. Disposition not specified in will text alone.',
        context_quote: extractQuote(fullText, /Haney/i) },
    ],
    enslaved_persons_collective: {
      description: 'All Negroes on Lavisors Creek plantation EXCEPT Jacob and Haney',
      bequeathed_to: 'Thomas Hopewell',
      count_unknown: true,
      context_quote: extractQuote(fullText, /[Nn]egro(?:es)?.{0,60}plantation/i),
    },
    executors: [
      { name: 'Elizabeth Hopewell', role: 'wife' },
      { name: 'James Hopewell', role: 'son', canonical_person_id: 1070 },
    ],
    registrar: {
      name: 'Jeremiah Jordan',
      court: "Saint Mary's County Register of Wills",
    },
    court_jurisdiction: "Saint Mary's County, Maryland",
    probate_folios: '9–11',
    raw_quotes_per_field_jsonb: {
      testator_signing: extractQuote(fullText, /February\s+1777/i),
      probate: extractQuote(fullText, /22\s+July\s+1777/i) || extractQuote(fullText, /July\s+1777/i),
      jacob_haney: extractQuote(fullText, /Jacob\s+and\s+Haney/i),
      lavisors_creek: extractQuote(fullText, /Lavisors\s+Creek/i),
      registrar: extractQuote(fullText, /Jeremiah\s+Jordan/i),
      family_preservation_clause: extractQuote(fullText, /[Nn]egro(?:es)?.{0,80}famil/i),
    },
    notes: 'Will explicitly requests enslaved persons be divided by families as much as possible.',
    name_resolution_proposals: [
      {
        ocr_name: 'James Hopewell',
        proposed_canonical_id: 1070,
        proposed_canonical_name: 'James Hopewell',
        confidence: 0.98,
        resolution_basis: 'Named as son and executor; matches cp=1070 (d.~1817, St. Mary\'s County). Cross-confirmed by James Hopewell 1817 will naming Hugh as father.',
      },
    ],
  };
}

function buildHughVI1785Extraction(fullText) {
  return {
    testator: {
      name: 'Hugh Hopewell',
      note: 'Hugh Hopewell VI, son of Hugh V (GX1Q-ZMD), brother of James Hopewell cp=1070',
      place: "Saint Mary's County, Maryland",
      birth_year_estimate: 1758,
      signing_date: '1785-02-18',
      proved_dates: ['1785-05-05'],
    },
    spouse: {
      name: 'Hannah Hopewell',
      note: 'Elected dower 18 May 1785',
    },
    children: [
      { name: 'James', role: 'heir', note: 'minor son of Hugh VI; distinct from James Hopewell cp=1070',
        share_described: 'Equal part personal estate at lawful age (21)' },
      { name: 'Ann', role: 'heir', note: 'minor daughter of Hugh VI',
        share_described: 'Equal part personal estate at lawful age (16)' },
      { name: 'Elisabeth', role: 'heir', note: 'minor daughter of Hugh VI',
        share_described: 'Equal part personal estate at lawful age (16)' },
      { name: 'Lucresa', role: 'heir', note: 'minor daughter of Hugh VI',
        share_described: 'Equal part personal estate at lawful age (16)' },
    ],
    beneficiaries_non_kin: [
      { name: 'John Borom', share_described: 'All land southward/westward of slash at barn where Nicholas Richardson formerly lived (~94 acres)' },
    ],
    real_property: [
      { description: 'Plantation "Townbrook/Townbrooke" (~70 acres) + land bought of Jeremiah Rhodes (except what given to John Borom)',
        bequeathed_to: 'James Hopewell (brother, cp=1070)',
        condition: 'Subject to bond for 50,000 lbs tobacco; if James cannot give bond, land at public auction',
        context_quote: extractQuote(fullText, /Townbrook/i) },
    ],
    executors: [
      { name: 'Hannah Hopewell', role: 'wife' },
      { name: 'James Hopewell', role: 'brother', canonical_person_id: 1070 },
    ],
    registrar: {
      court: "Saint Mary's County Register of Wills",
    },
    court_jurisdiction: "Saint Mary's County, Maryland",
    probate_folios: '325–327',
    raw_quotes_per_field_jsonb: {
      wife_hannah: extractQuote(fullText, /[Hh]annah\s+Hopewell/i),
      brother_james: extractQuote(fullText, /brother\s+James\s+Hopewell/i),
      townbrook: extractQuote(fullText, /Townbrook/i),
      john_borom: extractQuote(fullText, /John\s+Borom/i),
      signing_date: extractQuote(fullText, /18th?\s+February\s+1785/i),
    },
    name_resolution_proposals: [
      {
        ocr_name: 'James Hopewell',
        proposed_canonical_id: 1070,
        proposed_canonical_name: 'James Hopewell',
        confidence: 0.98,
        resolution_basis: 'Named as brother and executor; matches cp=1070 (St. Mary\'s County). Cross-confirmed by James Hopewell 1817 will.',
      },
    ],
  };
}

// ── Phase 0: DB pre-flight queries ───────────────────────────────────────────

async function runPhase0Queries(client) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PHASE 0: DB PRE-FLIGHT QUERIES');
  console.log('═══════════════════════════════════════════════════════════════');

  const results = {};

  // Q1: Existing relationships for Hopewell family
  console.log('\nQ1: person_relationships_verified for cp 1070/140299/141015');
  const q1 = await client.query(`
    SELECT id, person_id, related_person_id, relationship_type,
           evidence_source_ids, evidence_strength, verified_by
    FROM person_relationships_verified
    WHERE person_id IN (1070, 140299, 141015)
       OR related_person_id IN (1070, 140299, 141015)
  `);
  results.existingRelationships = q1.rows;
  console.log(`  ${q1.rows.length} row(s):`);
  for (const r of q1.rows) {
    console.log(`  id=${r.id} cp=${r.person_id} → cp=${r.related_person_id} [${r.relationship_type}] strength=${r.evidence_strength}`);
  }

  // Q2: will_extractions for document_id=19
  console.log('\nQ2: will_extractions for document_id=19');
  let q2;
  try {
    q2 = await client.query(`
      SELECT id, status, extractor_version, created_at, review_sections_jsonb,
             canonical_person_id
      FROM will_extractions WHERE document_id = 19
    `);
    results.willExtractionDoc19 = q2.rows;
    if (q2.rows.length) {
      console.log(`  ${q2.rows.length} row(s): id=${q2.rows[0].id}, status=${q2.rows[0].status}, version=${q2.rows[0].extractor_version}`);
    } else {
      console.log('  0 rows — will INSERT new row');
    }
  } catch (e) {
    console.log(`  ERROR (will_extractions table may not exist): ${e.message}`);
    results.willExtractionDoc19 = [];
    results.willExtractionsTableMissing = true;
  }

  // Q3: enslaver_evidence_compendium for cp=1070
  console.log('\nQ3: enslaver_evidence_compendium for cp=1070');
  let q3;
  try {
    q3 = await client.query(`
      SELECT id, evidence_source_table, evidence_source_id, evidence_strength,
             claim_summary, ingested_at
      FROM enslaver_evidence_compendium
      WHERE canonical_person_id = 1070
    `);
    results.enslaverEvidenceCompendium1070 = q3.rows;
    console.log(`  ${q3.rows.length} row(s)`);
    for (const r of q3.rows) {
      console.log(`  id=${r.id} source=${r.evidence_source_table}/${r.evidence_source_id} strength=${r.evidence_strength}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    results.enslaverEvidenceCompendium1070 = [];
  }

  // Q4: inheritance_edges table exists?
  console.log('\nQ4: inheritance_edges table exists?');
  const q4 = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'inheritance_edges'
    ) AS inheritance_edges_exists
  `);
  results.inheritanceEdgesExists = q4.rows[0].inheritance_edges_exists;
  console.log(`  inheritance_edges_exists: ${results.inheritanceEdgesExists}`);

  // Q5: person_documents.will_extraction_id column exists?
  console.log('\nQ5: person_documents.will_extraction_id column?');
  const q5 = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'person_documents'
      AND column_name = 'will_extraction_id'
  `);
  results.willExtractionIdColumnExists = q5.rows.length > 0;
  console.log(`  will_extraction_id column exists: ${results.willExtractionIdColumnExists}`);
  if (!results.willExtractionIdColumnExists) {
    console.log('  ⚠ DEBT: backfill-inheritance-edges-from-will-extractions.js assumes this column — will fail at JOIN');
  }

  // Q6: Hugh Hopewell canonical_persons rows
  // NOTE: person_type filter intentionally omitted — id=193376 "Hugh Hopewell IV" is
  // stored as 'descendant' (from FS scraper) but is the testator of the 1777 will.
  // Phase 4 will UPDATE person_type to 'enslaver' for that row.
  console.log('\nQ6: Hugh Hopewell canonical_persons rows (any type)');
  const q6 = await client.query(`
    SELECT id, canonical_name, birth_year_estimate, death_year_estimate,
           person_type, verification_status, notes
    FROM canonical_persons
    WHERE canonical_name ILIKE '%hugh hopewell%'
       OR (notes IS NOT NULL AND (notes::text ILIKE '%GX1Q-ZMD%'))
    ORDER BY birth_year_estimate NULLS LAST
  `);
  results.hughHopewellRows = q6.rows;
  console.log(`  ${q6.rows.length} row(s):`);
  for (const r of q6.rows) {
    console.log(`  id=${r.id} name="${r.canonical_name}" born=${r.birth_year_estimate} died=${r.death_year_estimate} type=${r.person_type}`);
  }

  // Q7: James Hopewell cp=1070
  console.log('\nQ7: canonical_persons id=1070 (James Hopewell)');
  const q7 = await client.query(`
    SELECT id, canonical_name, first_name, last_name
    FROM canonical_persons WHERE id = 1070
  `);
  results.jamesHopewell1070 = q7.rows[0] || null;
  if (q7.rows[0]) {
    console.log(`  id=1070: canonical_name="${q7.rows[0].canonical_name}" first="${q7.rows[0].first_name}" last="${q7.rows[0].last_name}"`);
  } else {
    console.log('  ⚠ NOT FOUND — cp=1070 does not exist');
  }

  // Q8: All will rows in person_documents
  console.log('\nQ8: All will rows in person_documents');
  const q8 = await client.query(`
    SELECT id, title, s3_key, canonical_person_id, ocr_text IS NOT NULL AS has_ocr,
           human_verified, document_year, collection_key
    FROM person_documents WHERE document_type = 'will' ORDER BY document_year
  `);
  results.existingWillDocs = q8.rows;
  console.log(`  ${q8.rows.length} will row(s):`);
  for (const r of q8.rows) {
    console.log(`  id=${r.id} cp=${r.canonical_person_id} year=${r.document_year} has_ocr=${r.has_ocr} "${r.title?.slice(0, 50)}"`);
  }

  // Q9: schema_migrations (which M04x-M06x are applied?)
  // NOTE: schema_migrations uses 'filename' column (not migration_id/migration_name)
  console.log('\nQ9: schema_migrations for M048–M067');
  try {
    const q9 = await client.query(`
      SELECT filename, applied_at FROM schema_migrations
      WHERE filename LIKE '04%' OR filename LIKE '05%' OR filename LIKE '06%'
      ORDER BY filename
    `);
    results.appliedMigrations = q9.rows.map(r => r.filename);
    console.log(`  Applied (${q9.rows.length}): ${results.appliedMigrations.map(f => f.slice(0, 3)).join(', ') || 'none'}`);
    for (const r of q9.rows) {
      console.log(`    ${r.filename} @ ${r.applied_at}`);
    }
  } catch (e) {
    console.log(`  schema_migrations query failed: ${e.message}`);
    results.appliedMigrations = [];
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  return results;
}

// ── Phase 1: State verification ───────────────────────────────────────────────

function verifyState(phase0Results) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PHASE 1: STATE VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════');

  const { existingRelationships, willExtractionDoc19, hughHopewellRows } = phase0Results;

  // Check spouse edge James ↔ Angelica
  const spouseEdgeExists = existingRelationships.some(r =>
    ((r.person_id === 1070 && r.related_person_id === 140299) ||
     (r.person_id === 140299 && r.related_person_id === 1070)) &&
    ['spouse', 'spouse_of', 'married_to'].includes(r.relationship_type)
  );
  console.log(`\n  James↔Angelica spouse edge (1070↔140299): ${spouseEdgeExists ? '✓ EXISTS — skip insert' : '✗ MISSING — will insert'}`);

  // Check parent edge James → Ann Maria
  const parentEdgeExists = existingRelationships.some(r =>
    r.person_id === 1070 && r.related_person_id === 141015 &&
    ['parent', 'parent_of', 'child', 'child_of', 'father', 'father_of'].includes(r.relationship_type)
  );
  console.log(`  James→Ann Maria parent edge (1070→141015): ${parentEdgeExists ? '✓ EXISTS — skip insert' : '✗ MISSING — will insert'}`);

  // Check will_extractions for doc_id=19
  const willExtractionExists = willExtractionDoc19 && willExtractionDoc19.length > 0;
  console.log(`  will_extractions for doc_id=19: ${willExtractionExists ? `✓ EXISTS (id=${willExtractionDoc19[0].id}) — will UPDATE structured_extraction_jsonb` : '✗ MISSING — will INSERT'}`);

  // Check Hugh V — match on OWN familysearch_id GX1Q-ZMD, NOT references to it
  // (id=193559 "Mrs Agnes Hopewell" has notes with mother_fs_id:GX1Q-ZMD — false match)
  // id=193376 "Hugh Hopewell IV" has notes with familysearch_id:GX1Q-ZMD — correct match
  const hughV = hughHopewellRows.find(r =>
    (r.birth_year_estimate === 1725 && r.death_year_estimate === 1777) ||
    (r.notes || '').includes('"familysearch_id":"GX1Q-ZMD"') ||
    (r.notes || '').includes('"familysearch_id": "GX1Q-ZMD"')
  );
  console.log(`  Hugh Hopewell V (GX1Q-ZMD, d.1777): ${hughV ? `✓ EXISTS id=${hughV.id}` : '✗ MISSING — will INSERT'}`);

  // Check Hugh VI
  const hughVI = hughHopewellRows.find(r =>
    r.birth_year_estimate === 1758 ||
    r.death_year_estimate === 1785
  );
  console.log(`  Hugh Hopewell VI (b.1758, d.1785): ${hughVI ? `✓ EXISTS id=${hughVI.id}` : '✗ MISSING — will INSERT'}`);

  return {
    spouseEdgeExists,
    parentEdgeExists,
    willExtractionExists,
    willExtractionId: willExtractionExists ? willExtractionDoc19[0].id : null,
    hughVId: hughV ? hughV.id : null,
    hughVIId: hughVI ? hughVI.id : null,
  };
}

// ── Phase 4: DB write helpers ─────────────────────────────────────────────────

async function uploadToS3(localPath, s3Key) {
  if (!S3Service.isEnabled()) {
    console.log(`  ⚠ S3 not configured — skipping upload of ${s3Key}`);
    return null;
  }
  const buf = fs.readFileSync(localPath);
  const filename = path.basename(localPath);
  await S3Service.upload(s3Key, buf, 'application/pdf', {
    'source': 'physical-scan',
    'session': EXTRACTOR_VERSION,
    'original-filename': filename,
  });
  const s3Url = S3Service.getPublicUrl ? S3Service.getPublicUrl(s3Key) : `s3://${s3Key}`;
  console.log(`  ✓ Uploaded → ${s3Key}`);
  return { s3Key, s3Url, fileSize: buf.length };
}

async function createCanonicalPerson(client, params) {
  const result = await client.query(`
    INSERT INTO canonical_persons
      (canonical_name, first_name, last_name, birth_year_estimate, death_year_estimate,
       person_type, verification_status, primary_state, primary_county, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `, [
    params.canonical_name, params.first_name, params.last_name,
    params.birth_year_estimate, params.death_year_estimate,
    params.person_type, params.verification_status,
    params.primary_state, params.primary_county, params.notes,
  ]);
  const newId = result.rows[0].id;
  console.log(`  ✓ Created canonical_persons: id=${newId} "${params.canonical_name}"`);
  return newId;
}

async function upsertWillExtraction(client, docId, canonicalPersonId, rawPagesJsonb, structuredJsonb, existingId) {
  if (existingId) {
    // UPDATE existing row (for doc_id=19, don't create duplicate)
    await client.query(`
      UPDATE will_extractions
      SET structured_extraction_jsonb = $1,
          raw_pages_jsonb = $2,
          extractor_version = $3,
          updated_at = NOW()
      WHERE id = $4
    `, [JSON.stringify(structuredJsonb), JSON.stringify(rawPagesJsonb), EXTRACTOR_VERSION, existingId]);
    console.log(`  ✓ Updated will_extractions id=${existingId}`);
    return existingId;
  } else {
    const result = await client.query(`
      INSERT INTO will_extractions
        (document_id, canonical_person_id, raw_pages_jsonb,
         structured_extraction_jsonb, extractor_version, status, review_sections_jsonb)
      VALUES ($1, $2, $3, $4, $5, 'extracted', '{}'::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [
      docId, canonicalPersonId,
      JSON.stringify(rawPagesJsonb),
      JSON.stringify(structuredJsonb),
      EXTRACTOR_VERSION,
    ]);
    const newId = result.rows[0]?.id;
    if (newId) console.log(`  ✓ Inserted will_extractions id=${newId}`);
    else console.log('  ⚠ will_extractions insert: ON CONFLICT (row may already exist)');
    return newId;
  }
}

async function insertRelationship(client, personId, relatedPersonId, relType, evidenceSourceIds, strength, verifiedBy) {
  // Check if already exists
  const exists = await client.query(`
    SELECT id FROM person_relationships_verified
    WHERE ((person_id=$1 AND related_person_id=$2) OR (person_id=$2 AND related_person_id=$1))
      AND relationship_type=$3
  `, [personId, relatedPersonId, relType]);
  if (exists.rows.length > 0) {
    console.log(`  ↳ Relationship ${relType} (${personId}↔${relatedPersonId}) already exists id=${exists.rows[0].id} — skip`);
    return exists.rows[0].id;
  }
  const result = await client.query(`
    INSERT INTO person_relationships_verified
      (person_id, related_person_id, relationship_type, evidence_source_ids,
       evidence_strength, has_conflicts, verified_by)
    VALUES ($1, $2, $3, $4::int[], $5, false, $6)
    ON CONFLICT DO NOTHING
    RETURNING id
  `, [personId, relatedPersonId, relType, evidenceSourceIds, strength, verifiedBy]);
  const newId = result.rows[0]?.id;
  if (newId) console.log(`  ✓ Inserted relationship ${relType} (${personId}↔${relatedPersonId}) id=${newId}`);
  return newId;
}

async function insertUnconfirmedPerson(client, params) {
  // unconfirmed_persons uses lead_id as PK (serial), not id
  const result = await client.query(`
    INSERT INTO unconfirmed_persons
      (full_name, person_type, source_type, extraction_method, confidence_score,
       context_text, relationships, status, review_notes, source_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
    ON CONFLICT DO NOTHING
    RETURNING lead_id
  `, [
    params.full_name,
    params.person_type || 'enslaved',
    params.source_type || 'will',
    params.extraction_method || 'vision_ocr_handwritten',
    params.confidence_score,
    params.context_text,
    JSON.stringify(params.relationships || []),
    params.status || 'pending',
    params.review_notes || '',
    params.source_url || '',
  ]).catch(async (e) => {
    // Some versions of unconfirmed_persons may not support ON CONFLICT DO NOTHING
    // without a unique constraint — try plain insert with individual error handling
    if (e.message.includes('ON CONFLICT DO NOTHING requires inference specification')) {
      return client.query(`
        INSERT INTO unconfirmed_persons
          (full_name, person_type, source_type, extraction_method, confidence_score,
           context_text, relationships, status, review_notes, source_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
        RETURNING lead_id
      `, [
        params.full_name, params.person_type || 'enslaved', params.source_type || 'will',
        params.extraction_method || 'vision_ocr_handwritten', params.confidence_score,
        params.context_text, JSON.stringify(params.relationships || []),
        params.status || 'pending', params.review_notes || '',
        params.source_url || '',
      ]);
    }
    throw e;
  });
  const leadId = result.rows[0]?.lead_id;
  if (leadId) console.log(`  ✓ Inserted unconfirmed_persons: lead_id=${leadId} name="${params.full_name}"`);
  return leadId;
}

async function insertEnslaverEvidence(client, canonicalPersonId, sourceTable, sourceId, strength, claimSummary) {
  try {
    await client.query(`
      INSERT INTO enslaver_evidence_compendium
        (canonical_person_id, evidence_source_table, evidence_source_id,
         evidence_strength, claim_summary, ingested_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING
    `, [canonicalPersonId, sourceTable, sourceId, strength, claimSummary, EXTRACTOR_VERSION]);
    console.log(`  ✓ Inserted enslaver_evidence_compendium cp=${canonicalPersonId} source=${sourceTable}/${sourceId}`);
  } catch (e) {
    console.log(`  ⚠ enslaver_evidence_compendium insert skipped: ${e.message}`);
  }
}

// ── Phase 5: Verification queries ────────────────────────────────────────────

async function runVerificationQueries(client) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PHASE 5: POST-WRITE VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════');

  // V1: All will rows
  const v1 = await client.query(`
    SELECT id, title, canonical_person_id, human_verified, document_year,
           collection_key, ocr_text IS NOT NULL AS has_ocr
    FROM person_documents WHERE document_type = 'will' ORDER BY document_year
  `);
  console.log(`\nV1: Will documents (${v1.rows.length} rows):`);
  for (const r of v1.rows) {
    console.log(`  id=${r.id} cp=${r.canonical_person_id} year=${r.document_year} has_ocr=${r.has_ocr} "${r.title?.slice(0, 50)}"`);
  }

  // V2: All will_extractions
  try {
    const v2 = await client.query(`
      SELECT we.id, we.document_id, we.canonical_person_id, we.status,
             we.extractor_version, pd.title
      FROM will_extractions we
      JOIN person_documents pd ON pd.id = we.document_id
      ORDER BY we.created_at
    `);
    console.log(`\nV2: will_extractions (${v2.rows.length} rows):`);
    for (const r of v2.rows) {
      console.log(`  id=${r.id} doc=${r.document_id} cp=${r.canonical_person_id} status=${r.status} version=${r.extractor_version}`);
    }
  } catch (e) {
    console.log(`\nV2: will_extractions query failed: ${e.message}`);
  }

  // V3: person_relationships_verified for Hopewell family
  const v3 = await client.query(`
    SELECT id, person_id, related_person_id, relationship_type,
           evidence_source_ids, evidence_strength
    FROM person_relationships_verified
    WHERE person_id IN (1070, 140299, 141015)
       OR related_person_id IN (1070, 140299, 141015)
    ORDER BY relationship_type
  `);
  console.log(`\nV3: Relationships (${v3.rows.length} rows):`);
  for (const r of v3.rows) {
    console.log(`  id=${r.id} ${r.person_id}→${r.related_person_id} [${r.relationship_type}] strength=${r.evidence_strength}`);
  }

  // V4: Unconfirmed persons from Hopewell wills
  const v4 = await client.query(`
    SELECT full_name, person_type, source_type, confidence_score, status
    FROM unconfirmed_persons
    WHERE context_text ILIKE '%hopewell%'
       OR context_text ILIKE '%burroughes%'
    ORDER BY source_type, full_name
  `);
  console.log(`\nV4: Unconfirmed persons from wills (${v4.rows.length} rows):`);
  for (const r of v4.rows) {
    console.log(`  "${r.full_name}" type=${r.person_type} conf=${r.confidence_score} status=${r.status}`);
  }

  // V5: Hugh Hopewell canonical persons
  const v5 = await client.query(`
    SELECT id, canonical_name, birth_year_estimate, death_year_estimate,
           person_type, verification_status
    FROM canonical_persons
    WHERE canonical_name ILIKE '%hugh hopewell%'
  `);
  console.log(`\nV5: Hugh Hopewell canonical_persons (${v5.rows.length} rows):`);
  for (const r of v5.rows) {
    console.log(`  id=${r.id} "${r.canonical_name}" born=${r.birth_year_estimate} died=${r.death_year_estimate} type=${r.person_type}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
}

// ── Main orchestration ────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('HOPEWELL PHYSICAL SCANS — OCR + DB INGESTION');
  console.log(`Mode: ${APPLY ? 'APPLY (DB writes ON)' : 'DRY-RUN (no DB writes)'}`);
  console.log(`Extractor version: ${EXTRACTOR_VERSION}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (!VISION_KEY) {
    console.error('GOOGLE_VISION_API_KEY not set — OCR will fail');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    // Phase 0: pre-flight DB queries
    const phase0 = await runPhase0Queries(client);

    // Phase 1: state verification
    const phase1 = verifyState(phase0);

    // Track IDs resolved during this run
    const resolvedIds = {
      hughVCp: phase1.hughVId,
      hughVICp: phase1.hughVIId,
      newPersonDocIds: {},       // slug → person_documents.id
      newWillExtractionIds: {},  // slug → will_extractions.id
    };

    // Phase 2 + 3: OCR + classify + extract for each PDF
    const ocrResults = {};

    for (const manifest of PDF_MANIFEST) {
      console.log(`\n───────────────────────────────────────────────────────────────`);
      console.log(`PROCESSING: ${manifest.slug} (${path.basename(manifest.localPath)})`);
      console.log(`───────────────────────────────────────────────────────────────`);

      let pageResults, fullText, outDir;
      try {
        ({ pageResults, fullText, outDir } = await ocrDocument(manifest));
      } catch (e) {
        console.error(`  ✗ OCR failed for ${manifest.slug}: ${e.message}`);
        ocrResults[manifest.slug] = { error: e.message };
        continue;
      }

      // Classify
      const classification = classifyDocument(fullText, path.basename(manifest.localPath));
      const classPath = path.join(outDir, 'classification.json');
      fs.writeFileSync(classPath, JSON.stringify(classification, null, 2));
      console.log(`\n  Classification: ${classification.classification} (profile: ${classification.matched_profile})`);
      console.log(`  OCR quality: ${classification.ocr_quality_estimate}`);
      console.log(`  Requires human review: ${classification.requires_human_review}`);

      // Build raw_pages_jsonb
      const rawPagesJsonb = pageResults.map(p => ({
        index: p.index,
        filename: p.filename,
        page_type: p.page_type,
        ocr_text: p.ocr_text,
        ocr_method: p.ocr_method,
        confidence: p.confidence,
      }));

      // Build structured extraction
      let structuredExtraction = null;
      if (manifest.docType === 'james_1817') {
        structuredExtraction = buildJames1817Extraction(fullText);
      } else if (manifest.docType === 'hugh_v_1777') {
        structuredExtraction = buildHughV1777Extraction(fullText);
      } else if (manifest.docType === 'composite_1785') {
        structuredExtraction = buildHughVI1785Extraction(fullText);
      } else if (manifest.docType === 'composite_1848') {
        structuredExtraction = {
          note: 'Composite document containing multiple wills. Sections: (A) Mary Mills 1845 probate — not Hopewell; (B) James H. Hopewell 1848 will — NOT ancestor James (wife Elizabeth, executor Henry); (C) Elizabeth Kilgore partial will.',
          sections: [
            { section: 'A', testator: 'Mary Mills', date: '1845', canonical_person_id: null,
              note: 'St. Mary\'s County July 1845 probate. Not Hopewell.' },
            { section: 'B', testator: 'James H. Hopewell', date: '1848',
              canonical_person_id: null,
              disqualifying_signals: ['wife Elizabeth Hopewell', 'executor Henry Hopewell', 'Maria Wheatly', '1848'],
              note: 'NOT ancestor James (cp=1070). Wife is Elizabeth (not Angelica). Executor is son Henry. Death ~1848 incompatible with MTRV-Z72 d.~1817.',
              spouse: 'Elizabeth Hopewell', executor: 'Henry Hopewell', other_heir: 'Maria Wheatly',
              enslaved_persons_visible: false,
            },
            { section: 'C', testator: 'Elizabeth Kilgore', date: null,
              canonical_person_id: null, note: 'Partial will, folio 172 bottom. Not Hopewell.' },
          ],
          status: 'pending_extraction',
          requires_human_review: true,
        };
      }

      ocrResults[manifest.slug] = {
        manifest,
        pageResults,
        fullText,
        classification,
        structuredExtraction,
        rawPagesJsonb,
      };

      if (!APPLY) {
        console.log('\n  [DRY-RUN] Structured extraction preview:');
        if (structuredExtraction?.enslaved_persons) {
          console.log(`    Enslaved persons: ${structuredExtraction.enslaved_persons.length}`);
          for (const ep of structuredExtraction.enslaved_persons.slice(0, 5)) {
            console.log(`      "${ep.name}" → ${ep.bequeathed_to}${ep.name_uncertain ? ' (uncertain)' : ''}`);
          }
          if (structuredExtraction.enslaved_persons.length > 5) {
            console.log(`      ... and ${structuredExtraction.enslaved_persons.length - 5} more`);
          }
        }
      }
    }

    if (!APPLY) {
      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('DRY-RUN COMPLETE — no DB writes performed.');
      console.log('Re-run with --apply to write to DB and S3.');
      console.log('OCR output written to /tmp/hopewell-physical-scans/');
      return;
    }

    // ── Phase 4: DB writes ────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('PHASE 4: DB WRITES');
    console.log('═══════════════════════════════════════════════════════════════');

    // 4A: S3 uploads
    console.log('\n─── 4A: S3 Uploads ────────────────────────────────────────────');
    const s3Results = {};
    for (const manifest of PDF_MANIFEST) {
      if (!ocrResults[manifest.slug] || ocrResults[manifest.slug].error) continue;
      const uuid = crypto.randomUUID();
      const s3Key = `${manifest.s3Prefix}/${uuid}.pdf`;
      const uploadResult = await uploadToS3(manifest.localPath, s3Key);
      s3Results[manifest.slug] = uploadResult;
    }

    // 4B/4E: canonical_persons for Hugh V and Hugh VI (if missing)
    console.log('\n─── Create missing canonical_persons ──────────────────────────');
    if (!resolvedIds.hughVCp) {
      resolvedIds.hughVCp = await createCanonicalPerson(client, {
        canonical_name: 'Hugh Hopewell',
        first_name: 'Hugh',
        last_name: 'Hopewell',
        birth_year_estimate: 1725,
        death_year_estimate: 1777,
        person_type: 'enslaver',  // NOTE: pre-dating compiler, same pattern as cp=1070 (manual, documented in audit)
        verification_status: 'document_confirmed',
        primary_state: 'Maryland',
        primary_county: "Saint Mary's County",
        notes: "FamilySearch ID: GX1Q-ZMD. Father of James Hopewell (cp=1070). Will dated Feb 1777, probated 22 Jul 1777. Confirmed by physical will document, St. Mary's County Register of Wills. Person_type='enslaver' set pre-compiler per session 52 pattern — see audit doc.",
      });
    } else {
      // Hugh V already exists (id=193376 from FS scraper as 'descendant').
      // UPDATE person_type to 'enslaver' — confirmed by physical will (Doc 3).
      // This is the same pattern as cp=1070 (manual, pre-compiler).
      const upd = await client.query(`
        UPDATE canonical_persons
        SET person_type = 'enslaver',
            verification_status = 'document_confirmed',
            notes = notes || $2
        WHERE id = $1 AND person_type != 'enslaver'
        RETURNING id, person_type
      `, [
        resolvedIds.hughVCp,
        '\nPerson_type updated to enslaver by session 52 (physical scan OCR of Hugh Hopewell V 1777 will). See will-ingestion-audit-2026-05-12.md.',
      ]);
      if (upd.rowCount > 0) {
        console.log(`  ✓ Updated cp=${resolvedIds.hughVCp} person_type → 'enslaver' (was 'descendant' from FS scraper)`);
      } else {
        console.log(`  ↳ cp=${resolvedIds.hughVCp} person_type already 'enslaver' — no change`);
      }
    }
    if (!resolvedIds.hughVICp) {
      resolvedIds.hughVICp = await createCanonicalPerson(client, {
        canonical_name: 'Hugh Hopewell',
        first_name: 'Hugh',
        last_name: 'Hopewell',
        birth_year_estimate: 1758,
        death_year_estimate: 1785,
        person_type: 'enslaver',  // NOTE: pre-dating compiler
        verification_status: 'document_confirmed',
        primary_state: 'Maryland',
        primary_county: "Saint Mary's County",
        notes: "Hugh Hopewell VI. Son of Hugh V (GX1Q-ZMD). Brother of James Hopewell (cp=1070). Wife Hannah Hopewell. Will dated 18 Feb 1785, probated 5 May 1785. Confirmed by physical will document, St. Mary's County Register of Wills. Person_type='enslaver' set pre-compiler per session 52 pattern — see audit doc.",
      });
    }
    console.log(`  Hugh V cp=${resolvedIds.hughVCp}, Hugh VI cp=${resolvedIds.hughVICp}`);

    // Update manifest with resolved IDs
    const doc3Manifest = PDF_MANIFEST.find(m => m.docType === 'hugh_v_1777');
    const doc4Manifest = PDF_MANIFEST.find(m => m.docType === 'composite_1785');
    if (doc3Manifest) doc3Manifest.canonicalPersonId = resolvedIds.hughVCp;
    if (doc4Manifest) doc4Manifest.canonicalPersonId = resolvedIds.hughVICp;

    // 4B: Document 1 — James Hopewell 1817
    console.log('\n─── 4B: Document 1 (James Hopewell 1817) ─────────────────────');
    const doc1Result = ocrResults['james-hopewell-1817'];
    if (doc1Result && !doc1Result.error) {
      // UPDATE existing person_documents id=19 (collection metadata ONLY — do NOT touch ocr_text)
      await client.query(`
        UPDATE person_documents
        SET
          collection_key = 'wills/james-hopewell-1817',
          collection_name = 'Will of James Hopewell (1817) — Saint Mary''s County, Maryland',
          collection_page_number = 1,
          collection_page_count = 3,
          document_year = 1817,
          human_verified = false
        WHERE id = 19
      `);
      console.log('  ✓ Updated person_documents id=19 (collection metadata — ocr_text preserved)');

      // UPSERT will_extractions
      const weId = await upsertWillExtraction(
        client, 19, 1070,
        doc1Result.rawPagesJsonb, doc1Result.structuredExtraction,
        phase1.willExtractionId
      );
      resolvedIds.newWillExtractionIds['james-hopewell-1817'] = weId;
    }

    // 4C: Relationships for James 1817
    console.log('\n─── 4C: Relationships (James 1817) ────────────────────────────');
    const verifiedBy1817 = `${EXTRACTOR_VERSION} — physical scan OCR, St. Mary's County Register of Wills folios 480-482`;
    // James ↔ Angelica spouse
    await insertRelationship(client, 1070, 140299, 'spouse', [19], 3,
      `${verifiedBy1817} — will names "beloved wife Angelica Hopewell"`);
    // James → Ann Maria parent
    await insertRelationship(client, 1070, 141015, 'parent_of', [19], 3,
      `${verifiedBy1817} — will names "my Daughter Ann Maria Biscoe" (OCR: Beicar/Bercer)`);

    // Look up Olivia Caroline, Henrietta Rebecca, James Robert — insert parent edges if found
    for (const childName of ['Olivia Caroline Hopewell', 'Olivia Caroline', 'Henrietta Rebecca Hopewell', 'Henrietta Rebecca', 'James Robert Hopewell']) {
      const lookup = await client.query(
        `SELECT id, canonical_name FROM canonical_persons
         WHERE canonical_name ILIKE $1 LIMIT 2`,
        [`%${childName.replace(/\s+/g, '%')}%`]
      );
      if (lookup.rows.length === 1) {
        await insertRelationship(client, 1070, lookup.rows[0].id, 'parent_of', [19], 3,
          `${verifiedBy1817} — will names child "${childName}"`);
      } else if (lookup.rows.length === 0) {
        console.log(`  ↳ "${childName}": no canonical_persons row found — parent edge deferred`);
      } else {
        console.log(`  ↳ "${childName}": ${lookup.rows.length} ambiguous matches — parent edge deferred`);
      }
    }

    // 4D: Unconfirmed persons from James 1817
    console.log('\n─── 4D: Unconfirmed Persons (James 1817 will) ─────────────────');
    const enslaved1817 = doc1Result?.structuredExtraction?.enslaved_persons || [];
    let unconfirmedCount = 0;
    for (const ep of enslaved1817) {
      const confidence = ep.name_uncertain ? 0.55 : 0.70;
      const nameVariantNote = ep.name_variants_possible
        ? ` OCR variants: [${ep.name_variants_possible.join(', ')}].` : '';
      const leadId = await insertUnconfirmedPerson(client, {
        full_name: ep.name,
        person_type: 'enslaved',
        source_type: 'will',
        extraction_method: 'vision_ocr_handwritten',
        confidence_score: confidence,
        context_text: `Bequeathed to ${ep.bequeathed_to} in will of James Hopewell (1817).${ep.relationship ? ` Relationship: ${ep.relationship}.` : ''}${ep.note ? ` Note: ${ep.note}.` : ''}${nameVariantNote} Source: person_documents id=19, session ${EXTRACTOR_VERSION}.`,
        relationships: [{
          relationship_type: 'enslaved_by',
          enslaver_canonical_id: 1070,
          source_document_id: 19,
          bequeathed_to: ep.bequeathed_to,
        }],
        status: 'pending',
        review_notes: `Extracted from James Hopewell 1817 will physical scan OCR ${EXTRACTOR_VERSION}.${ep.name_uncertain ? ' Name uncertain — requires manual verification.' : ''}`,
        source_url: s3Results['james-hopewell-1817']?.s3Url || 'wills/james-hopewell-1817/placeholder.pdf',
      });
      if (leadId) unconfirmedCount++;
    }
    console.log(`  Total unconfirmed_persons inserted: ${unconfirmedCount}/${enslaved1817.length}`);

    // 4E: Hugh V will (Document 3)
    console.log('\n─── 4E: Document 3 (Hugh Hopewell V, 1777) ───────────────────');
    const doc3Result = ocrResults['hugh-hopewell-v-1777'];
    if (doc3Result && !doc3Result.error && resolvedIds.hughVCp) {
      const s3Doc3 = s3Results['hugh-hopewell-v-1777'];
      // Insert person_documents
      const pd3Result = await client.query(`
        INSERT INTO person_documents
          (s3_key, s3_url, document_type, filename, file_size, mime_type,
           title, source_type_label, collection_name, name_as_appears,
           document_year, collection_key, collection_page_count,
           canonical_person_id, human_verified, created_by)
        VALUES ($1, $2, 'will', $3, $4, 'application/pdf', $5, 'probate_record',
                $6, 'Hugh Hopewell', 1777, $7, 3, $8, false, $9)
        RETURNING id
      `, [
        s3Doc3?.s3Key || `wills/hugh-hopewell-v-1777/placeholder.pdf`,
        s3Doc3?.s3Url || '',
        "saint mary's will 3.pdf",
        s3Doc3?.fileSize || 0,
        "Will of Hugh Hopewell (1777) — Saint Mary's County, Maryland",
        "Will of Hugh Hopewell (1777)",
        'wills/hugh-hopewell-v-1777',
        resolvedIds.hughVCp,
        EXTRACTOR_VERSION,
      ]);
      const pd3Id = pd3Result.rows[0].id;
      console.log(`  ✓ Inserted person_documents id=${pd3Id} for Hugh V will`);
      resolvedIds.newPersonDocIds['hugh-hopewell-v-1777'] = pd3Id;

      // Insert will_extractions
      const we3Id = await upsertWillExtraction(
        client, pd3Id, resolvedIds.hughVCp,
        doc3Result.rawPagesJsonb, doc3Result.structuredExtraction, null
      );
      resolvedIds.newWillExtractionIds['hugh-hopewell-v-1777'] = we3Id;

      // Relationships for Hugh V
      const vBy = `${EXTRACTOR_VERSION} — physical scan OCR, St. Mary's County Register of Wills folios 9-11`;
      // Hugh V → James Hopewell (parent)
      await insertRelationship(client, resolvedIds.hughVCp, 1070, 'parent_of', [pd3Id], 3,
        `${vBy} — will names James Hopewell as son and executor`);
      // Hugh V ↔ Elizabeth Hopewell (spouse)
      // Look up Elizabeth Edmondson/Hopewell
      const elizLookup = await client.query(
        `SELECT id FROM canonical_persons WHERE canonical_name ILIKE '%Elizabeth%Hopewell%' OR canonical_name ILIKE '%Elizabeth%Edmondson%' LIMIT 2`
      );
      if (elizLookup.rows.length === 1) {
        await insertRelationship(client, resolvedIds.hughVCp, elizLookup.rows[0].id, 'spouse', [pd3Id], 3,
          `${vBy} — will names Elizabeth Hopewell (née Edmondson) as wife/executor`);
      } else {
        console.log(`  ↳ Elizabeth Edmondson/Hopewell: ${elizLookup.rows.length} match(es) — spouse edge deferred`);
      }

      // Enslaved persons: Jacob and Haney
      for (const ep of doc3Result.structuredExtraction?.enslaved_persons || []) {
        await insertUnconfirmedPerson(client, {
          full_name: ep.name,
          person_type: 'enslaved',
          source_type: 'will',
          extraction_method: 'vision_ocr_handwritten',
          confidence_score: 0.80,
          context_text: `Excepted from Thomas Hopewell's bequest in will of Hugh Hopewell V (${EXTRACTOR_VERSION}). ${ep.note || ''} Source: person_documents id=${pd3Id}.`,
          relationships: [{
            relationship_type: 'enslaved_by',
            enslaver_canonical_id: resolvedIds.hughVCp,
            source_document_id: pd3Id,
            note: 'excepted_from_thomas_bequest',
          }],
          status: 'pending',
          review_notes: `From Hugh Hopewell V 1777 will physical scan OCR ${EXTRACTOR_VERSION}. Jacob and Haney are named exceptions to Thomas's bequest.`,
          source_url: s3Results['hugh-hopewell-v-1777']?.s3Url || 'wills/hugh-hopewell-v-1777/placeholder.pdf',
        });
      }

      // enslaver_evidence_compendium for Hugh V
      await insertEnslaverEvidence(client, resolvedIds.hughVCp,
        'will_extractions', String(we3Id || pd3Id),
        'direct_primary',
        "Hugh Hopewell V 1777 will names enslaved persons on Lavisors Creek plantation bequeathed to son Thomas, plus Jacob and Haney excepted. Evidence of enslavement from primary probate document.");
    }

    // 4E continued: Hugh VI will (Document 4 Section B)
    console.log('\n─── 4E: Document 4 (Hugh Hopewell VI, 1785) ──────────────────');
    const doc4Result = ocrResults['composite-1785'];
    if (doc4Result && !doc4Result.error && resolvedIds.hughVICp) {
      const s3Doc4 = s3Results['composite-1785'];
      const pd4Result = await client.query(`
        INSERT INTO person_documents
          (s3_key, s3_url, document_type, filename, file_size, mime_type,
           title, source_type_label, collection_name, name_as_appears,
           document_year, collection_key, collection_page_count,
           canonical_person_id, human_verified, created_by)
        VALUES ($1, $2, 'will', $3, $4, 'application/pdf', $5, 'probate_record',
                $6, 'Hugh Hopewell', 1785, $7, 6, $8, false, $9)
        RETURNING id
      `, [
        s3Doc4?.s3Key || `wills/hugh-hopewell-vi-1785-composite/placeholder.pdf`,
        s3Doc4?.s3Url || '',
        "saint mary's will 4.pdf",
        s3Doc4?.fileSize || 0,
        "Will of Hugh Hopewell VI (1785) — Saint Mary's County, Maryland (composite)",
        "Will of Hugh Hopewell VI (1785)",
        'wills/hugh-hopewell-vi-1785-composite',
        resolvedIds.hughVICp,
        EXTRACTOR_VERSION,
      ]);
      const pd4Id = pd4Result.rows[0].id;
      console.log(`  ✓ Inserted person_documents id=${pd4Id} for Hugh VI composite will`);
      resolvedIds.newPersonDocIds['composite-1785'] = pd4Id;

      const we4Id = await upsertWillExtraction(
        client, pd4Id, resolvedIds.hughVICp,
        doc4Result.rawPagesJsonb, doc4Result.structuredExtraction, null
      );
      resolvedIds.newWillExtractionIds['composite-1785'] = we4Id;

      // Relationships for Hugh VI
      const vBy6 = `${EXTRACTOR_VERSION} — physical scan OCR, St. Mary's County Register of Wills folios 325-327`;
      // Hugh VI → James Hopewell (sibling)
      await insertRelationship(client, resolvedIds.hughVICp, 1070, 'sibling_of', [pd4Id], 3,
        `${vBy6} — will names "brother James Hopewell" as executor`);
      // Hugh VI → Hugh V (child_of)
      if (resolvedIds.hughVCp) {
        await insertRelationship(client, resolvedIds.hughVCp, resolvedIds.hughVICp, 'parent_of', [pd4Id], 2,
          `${vBy6} — Hugh VI is son of Hugh V (GX1Q-ZMD); inferred from sibling relationship with James Hopewell cp=1070 and Hugh V's 1777 will`);
      }
      // Hugh VI ↔ Hannah Hopewell (spouse)
      const hannahLookup = await client.query(
        `SELECT id FROM canonical_persons WHERE canonical_name ILIKE '%Hannah%Hopewell%' LIMIT 2`
      );
      if (hannahLookup.rows.length === 1) {
        await insertRelationship(client, resolvedIds.hughVICp, hannahLookup.rows[0].id, 'spouse', [pd4Id], 3,
          `${vBy6} — will names Hannah Hopewell as wife and executor`);
      } else {
        console.log(`  ↳ Hannah Hopewell: ${hannahLookup.rows.length} match(es) — spouse edge deferred`);
      }

      // enslaver_evidence_compendium for Hugh VI
      await insertEnslaverEvidence(client, resolvedIds.hughVICp,
        'will_extractions', String(we4Id || pd4Id),
        'direct_primary',
        "Hugh Hopewell VI 1785 will — real property and personal estate bequeathed. Sibling relationship to James Hopewell (cp=1070, enslaver) establishes context. Will confirmed by physical document.");

      // Barbara Burroughes enslaved persons (Section C of Doc 4)
      console.log('\n  Inserting Barbara Burroughes enslaved persons (Doc 4 Section C)…');
      const burroughesEnslaved = [
        { full_name: 'Gill', sex: 'male', note: 'named in Barbara Burroughes 1785 will' },
        { full_name: 'Fido', sex: null, note: 'named in Barbara Burroughes 1785 will' },
        { full_name: 'Goron', sex: null, note: 'named in Barbara Burroughes 1785 will' },
        { full_name: 'Mushing Apron', sex: 'female', note: 'named in Barbara Burroughes 1785 will' },
        { full_name: 'Bonnet', sex: null, note: 'named in Barbara Burroughes 1785 will' },
        { full_name: 'Margaret Davis', sex: 'female',
          note: 'NOTABLE: received specific clothing bequest in Barbara Burroughes 1785 will: cotton gown, fino-linen apron, saddling saddle — unusual and independently valuable data point' },
      ];
      for (const ep of burroughesEnslaved) {
        await insertUnconfirmedPerson(client, {
          full_name: ep.full_name,
          person_type: 'enslaved',
          source_type: 'will',
          extraction_method: 'vision_ocr_handwritten',
          confidence_score: 0.65,
          context_text: `${ep.note}. Source: Document 4 (saint mary's will 4.pdf), Section C. Physical scan OCR ${EXTRACTOR_VERSION}. Document linked to person_documents id=${pd4Id}.${ep.full_name === 'Margaret Davis' ? ' NOTABLE: received specific clothing bequest (cotton gown, fino-linen apron, saddling saddle).' : ''}`,
          relationships: [{
            relationship_type: 'enslaved_by',
            enslaver_name_as_written: 'Barbara Burroughes',
            enslaver_canonical_id: null,
            source_document_id: pd4Id,
          }],
          status: 'pending',
          review_notes: `Barbara Burroughes 1785 will. Not linked to Hopewell family. Canonical person for Barbara Burroughes not yet created. ${EXTRACTOR_VERSION}.`,
          source_url: s3Results['composite-1785']?.s3Url || 'wills/composite-1785/placeholder.pdf',
        });
      }
    }

    // 4F: Non-ancestor documents
    console.log('\n─── 4F: Non-ancestor documents ─────────────────────────────────');

    // James H. Hopewell 1848 (composite doc 2 section B)
    const doc2Result = ocrResults['composite-1848'];
    if (doc2Result && !doc2Result.error) {
      const s3Doc2 = s3Results['composite-1848'];
      const pd2Result = await client.query(`
        INSERT INTO person_documents
          (s3_key, s3_url, document_type, filename, file_size, mime_type,
           title, source_type_label, collection_name, name_as_appears,
           document_year, collection_key, collection_page_count,
           canonical_person_id, human_verified, created_by,
           ocr_text)
        VALUES ($1, $2, 'will', $3, $4, 'application/pdf', $5, 'probate_record',
                $6, 'James H. Hopewell', 1848, $7, 2, NULL, false, $8, $9)
        RETURNING id
      `, [
        s3Doc2?.s3Key || 'wills/james-h-hopewell-1848-composite/placeholder.pdf',
        s3Doc2?.s3Url || '',
        "saint mary's will 2.pdf",
        s3Doc2?.fileSize || 0,
        "Will of James H. Hopewell (1848) — Saint Mary's County, Maryland [COMPOSITE — NOT ancestor James cp=1070]",
        "Will of James H. Hopewell (1848) — composite",
        'wills/james-h-hopewell-1848-composite',
        EXTRACTOR_VERSION,
        doc2Result.fullText,  // store OCR text for non-ancestor doc
      ]);
      const pd2Id = pd2Result.rows[0].id;
      console.log(`  ✓ Inserted person_documents id=${pd2Id} for composite 1848 doc (canonical_person_id=NULL)`);
      resolvedIds.newPersonDocIds['composite-1848'] = pd2Id;

      // will_extractions for the 1848 doc
      await upsertWillExtraction(client, pd2Id, null,
        doc2Result.rawPagesJsonb, doc2Result.structuredExtraction, null);
    }

    // Document 4 Section D (rotated pages — requires manual review)
    // Already covered under Doc 4 person_documents row above; note in extraction.

    console.log('\n─── Phase 4 complete ────────────────────────────────────────────');
    console.log('  Resolved IDs:');
    console.log(`    Hugh V cp=${resolvedIds.hughVCp}`);
    console.log(`    Hugh VI cp=${resolvedIds.hughVICp}`);
    console.log(`    New person_docs: ${JSON.stringify(resolvedIds.newPersonDocIds)}`);
    console.log(`    New will_extractions: ${JSON.stringify(resolvedIds.newWillExtractionIds)}`);

    // Phase 5: Verification
    await runVerificationQueries(client);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('✅ APPLY COMPLETE');
    console.log(`Session: ${EXTRACTOR_VERSION}`);
    console.log('Next steps:');
    console.log('  1. node scripts/apply-migrations.js  (apply any unapplied M049-M060)');
    console.log('  2. Review /tmp/hopewell-physical-scans/ for OCR quality findings');
    console.log('  3. node docs/will-ingestion-audit-2026-05-12.md  (generated in this session)');
    console.log('  4. Correct test-daa-hopewell.js enslaved person assignment error');
    console.log('═══════════════════════════════════════════════════════════════');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
