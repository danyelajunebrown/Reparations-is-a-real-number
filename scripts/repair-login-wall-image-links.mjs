// repair-login-wall-image-links.mjs — reconnect real people to real pages.
//
// THE DEFECT. The 1860 bulk scrape captured page images with `page.screenshot()`. When the FamilySearch
// session lapsed the viewer served a SIGN-IN PAGE, and the screenshot of that sign-in page was archived
// as `document_type='census_slave_schedule'`. Filenames are content hashes, so every capture of the login
// wall collapsed onto the SAME key — one of which is now attached to 1,732 documents across 30 ARKs.
//
// MEASURED (2026-09-18):
//   10,879 person_documents point at a known login-wall image, across 359 real ARKs
//   16,263 people sit on those pages — 13,001 quarantined tally marks, 3,262 REAL
//   0 of the 10,879 carry ocr_text; 10,609 carry structured context_snippet
//
// THE PEOPLE ARE NOT FABRICATED, AND THIS IS THE POINT. Every one of the 3,262 carries its own ARK, and
// 2,838 came from FamilySearch's pre-indexed volunteer transcriptions. The 424 tagged
// `census_ocr_extraction` are real enslaved names (Henry, Sam, Moses, July, Sarah) — a sign-in page
// contains "Continue with Google", not "Moses" — and with zero ocr_text present they cannot have come
// from OCR of that image. They were mislabelled, not invented. So this is NOT a fabrication cleanup and
// the fix is NOT quarantine: quarantining would delete real evidence to tidy away OUR capture failure.
//
// WHAT IS ACTUALLY BROKEN is one link: person -> ARK is sound; ARK -> s3_key points at a login wall.
// Under RULE 0.6 and rule 8 ("it is the FILE in OUR storage that lifts the gate") that gate currently
// rests on a screenshot of a sign-in form, 10,879 times.
//
// THE REPAIR, in order, because the order matters:
//   1. UN-GATE, don't quarantine. Clear the bad s3_key so no document claims image-backing it lacks, and
//      record WHY on the row. The person, the ARK and the transcription all survive untouched.
//   2. QUEUE the 359 ARKs for genuine re-capture via captureFamilySearchImage() — the Download-button
//      primitive (issue #124) that already yields 3348x4522 scans in `owners/`.
//   3. RE-LINK on success: the new image attaches to its own ARK, and only that ARK.
// Step 1 is reversible and runs here. Steps 2-3 need the authenticated :9222 Chrome.
//
// Usage: node scripts/repair-login-wall-image-links.mjs [--apply] [--hashes a,b]
import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const HASHES = (() => { const i = A.indexOf('--hashes');
  return i > -1 ? A[i + 1].split(',').map(s => s.trim()) : ['1f431f14d5a1b950', '56e88e74882e2752']; })();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 300000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const like = HASHES.map((_, i) => `s3_key LIKE '%' || $${i + 1} || '%'`).join(' OR ');

console.log(`\n=== LOGIN-WALL IMAGE REPAIR ${APPLY ? '(APPLYING)' : '(dry run)'} ===\n`);

const before = (await pool.query(
  `SELECT count(*)::int docs, count(DISTINCT s3_key)::int keys, count(DISTINCT source_url)::int arks
     FROM person_documents WHERE document_type='census_slave_schedule' AND (${like})`, HASHES)).rows[0];
console.log(`  affected documents : ${before.docs}`);
console.log(`  distinct bad keys  : ${before.keys}`);
console.log(`  real ARKs involved : ${before.arks}   <- these are genuine census pages, only the IMAGE failed`);

// SAFETY GATE: if any of these documents carries OCR text, the assumption underpinning this repair
// (that no data was derived from the login image) is FALSE, and the run must stop for a human.
const ocr = (await pool.query(
  `SELECT count(*)::int n FROM person_documents
    WHERE document_type='census_slave_schedule' AND (${like})
      AND ocr_text IS NOT NULL AND length(ocr_text) > 40`, HASHES)).rows[0].n;
if (ocr > 0) {
  console.log(`\n  ⛔ ${ocr} of these documents DO carry ocr_text. Something WAS read off the login image.`);
  console.log('     Refusing to proceed: inspect that text before any repair.');
  await pool.end(); process.exit(2);
}
console.log(`  ocr_text present   : 0  ✓ (nothing was derived from the login image)`);

const people = (await pool.query(
  `SELECT count(*) FILTER (WHERE status IS DISTINCT FROM 'placeholder_aggregate')::int real,
          count(*) FILTER (WHERE status = 'placeholder_aggregate')::int tally
     FROM unconfirmed_persons u
    WHERE EXISTS (SELECT 1 FROM person_documents d WHERE d.source_url = u.source_url
                   AND d.document_type='census_slave_schedule' AND (${like.replace(/s3_key/g, 'd.s3_key')}))`,
  HASHES)).rows[0];
console.log(`  people on those pages: ${people.real} real · ${people.tally} quarantined tally`);
console.log(`  -> the ${people.real} real people are UNTOUCHED by this repair. Only the image link changes.\n`);

if (!APPLY) {
  console.log('  dry run — pass --apply to clear the false image-backing and queue re-capture\n');
  await pool.end(); process.exit(0);
}

// 1. Un-gate. Keep the bad key in data_quality_flags so the failure stays visible and reversible.
const cleared = await pool.query(
  // COLUMNS VERIFIED against information_schema before writing this. person_documents has NO
  // data_quality_flags and NO error_text (error_text is on probate_scrape_progress — I conflated the two
  // tables). The columns that DO exist and fit: s3_key, s3_url, context_snippet.
  // The former key is appended to context_snippet so the failure stays visible on the row and the change
  // stays reversible; context_snippet already carries provenance notes for these documents.
  `UPDATE person_documents
      SET s3_key = NULL, s3_url = NULL,
          context_snippet = COALESCE(context_snippet || ' | ', '')
            || 'IMAGE CAPTURE FAILED: archived image was a FamilySearch sign-in page, not the document. '
            || 'former_s3_key=' || s3_key
            || '. Re-capture via captureFamilySearchImage (Download button, issue #124). cleared '
            || now()::date
    WHERE document_type='census_slave_schedule' AND (${like})
    RETURNING id`, HASHES);
console.log(`  ✓ cleared false image-backing on ${cleared.rows.length} documents (reversible — former key retained)`);

// 2. Record each affected ARK as a recapture task. A null result is first-class evidence here.
const arks = (await pool.query(
  `SELECT DISTINCT source_url FROM person_documents
    WHERE document_type='census_slave_schedule'
      AND context_snippet LIKE '%IMAGE CAPTURE FAILED%' AND source_url IS NOT NULL`)).rows;
let queued = 0;
for (const a of arks) {
  // Schema verified against information_schema before writing: question / repository / index_searched /
  // result are NOT NULL, and the timestamp column is searched_at, not created_at.
  await pool.query(
    `INSERT INTO research_findings
       (question, repository, index_searched, result, subject_table, evidence_note, searched_by, searched_at)
     VALUES ($1, 'FamilySearch', '1860 US Census Slave Schedules (cc=3161105)', 'pending',
             'person_documents', $2, 'repair-login-wall-image-links', now())`,
    ['Re-capture the page image for ' + a.source_url + ' — the archived image was a sign-in page',
     JSON.stringify({ ark: a.source_url, method: 'captureFamilySearchImage', issue: 124 })]
  ).then(() => queued++).catch((e) => { if (queued === 0) console.log('    (finding insert failed: ' + e.message.slice(0, 70) + ')'); });
}
console.log(`  ✓ queued ${queued} ARKs for genuine re-capture (research_findings)`);
console.log(`\n  NEXT: re-capture needs the authenticated :9222 Chrome and the Download-button primitive.`);
await pool.end();
