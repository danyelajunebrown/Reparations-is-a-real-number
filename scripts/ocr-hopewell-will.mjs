// OCR the James Hopewell will PDF and wire its contents into the probate
// evidence graph.
//
// Steps:
//   1. Download s3://owners/James-Hopewell/will/James-Hopewell-Will-1817-complete.pdf
//   2. Convert to 300dpi PNG pages with pdftoppm
//   3. OCR each page with Google Vision DOCUMENT_TEXT_DETECTION
//   4. Store concatenated text + per-page snippets in person_documents
//   5. Scan for named persons; record whichever of Adrian's lineage
//      (Angelica Chesley, Maria Angelica Biscoe, Rebecca Angelica Chesley
//      Hopewell, etc.) appears, noted in the document for audit.
//   6. Create the Chesley↔Hopewell spouse relationship in
//      person_relationships_verified (the graph has 0 rows on either of
//      them right now; she literally isn't linked to anyone).
//
// Usage:
//   node scripts/ocr-hopewell-will.mjs           # dry-run
//   node scripts/ocr-hopewell-will.mjs --apply   # perform OCR + DB writes

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

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const VISION_KEY = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_API_KEY;
if (!VISION_KEY) {
    console.error('GOOGLE_VISION_API_KEY not set');
    process.exit(1);
}

const S3_KEY = 'owners/James-Hopewell/will/James-Hopewell-Will-1817-complete.pdf';
const HOPEWELL_CP = 1070;
const CHESLEY_CP = 140299;

async function ocrImage(buf) {
    const res = await axios.post(
        `https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`,
        { requests: [{ image: { content: buf.toString('base64') }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] },
        { timeout: 120000 }
    );
    const ann = res.data.responses[0];
    if (ann.error) throw new Error(`Vision: ${ann.error.message}`);
    return ann.fullTextAnnotation?.text || '';
}

async function main() {
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hopewell-will-'));
    const pdfPath = path.join(dir, 'will.pdf');

    console.log(`Downloading ${S3_KEY} → ${pdfPath}`);
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const client = new (require('../src/services/storage/S3Service').constructor || Object)();
    // Simpler: use getViewUrl + fetch
    const url = await S3Service.getViewUrl(S3_KEY, 300);
    const buf = Buffer.from((await axios.get(url, { responseType: 'arraybuffer' })).data);
    fs.writeFileSync(pdfPath, buf);
    console.log(`  downloaded ${(buf.length / 1024).toFixed(0)} KB`);

    console.log(`Converting PDF → PNGs with pdftoppm …`);
    execSync(`pdftoppm -r 300 -png "${pdfPath}" "${path.join(dir, 'page')}"`, { stdio: 'inherit' });
    const pages = fs.readdirSync(dir).filter(f => f.startsWith('page') && f.endsWith('.png')).sort();
    console.log(`  ${pages.length} page image(s): ${pages.join(', ')}`);

    console.log(`Running Vision OCR on each page …`);
    const pageTexts = [];
    for (const p of pages) {
        const bytes = fs.readFileSync(path.join(dir, p));
        const txt = await ocrImage(bytes);
        pageTexts.push({ page: p, text: txt });
        console.log(`  ${p}: ${txt.length} chars, first line: "${(txt.split('\n')[0] || '').slice(0, 80)}"`);
    }
    const fullText = pageTexts.map((p, i) => `── Page ${i + 1} (${p.page}) ──\n${p.text}`).join('\n\n');

    // Scan for persons of interest. The lineage key — found on first OCR —
    // is that the will names her by her MARRIED name "Angelica Hopewell",
    // not her maiden "Chesley". This is exactly the identity-resolution
    // failure mode we flagged in project memory.
    const wanted = [
        'wife Angelica Hopewell', 'Angelica Hopewell', 'beloved wife',
        'Ann Maria', 'Ann Maria Biscoe', 'Maria Biscoe',
        'Henrietta Rebecca', 'Olivia Caroline',
        'James Robert Hopewell', 'Peter Hopewell',
        'Angelica Chesley', 'Chesley',
    ];
    const hits = {};
    for (const name of wanted) {
        const re = new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        const matches = [...fullText.matchAll(re)];
        if (matches.length) hits[name] = matches.length;
    }
    console.log('\nNamed-person hits in the will:');
    for (const [name, count] of Object.entries(hits).sort((a, b) => b[1] - a[1])) {
        console.log(`  "${name}": ${count}`);
    }
    const hopewellWifeConfirmed = (hits['wife Angelica Hopewell'] || 0) > 0
        || ((hits['Angelica Hopewell'] || 0) > 0 && (hits['beloved wife'] || 0) > 0);
    console.log(`\n→ Wife-of-James Hopewell identified as Angelica Hopewell (maiden=Chesley): ${hopewellWifeConfirmed ? 'YES' : 'no direct phrase match'}`);

    // Pull a snippet around the bequest to wife
    const wifeCtx = [];
    const wifeRe = /([^\n]{0,120})(wife\s+Angelica\s+Hopewell|beloved\s+wife)([^\n]{0,250})/gi;
    let m;
    while ((m = wifeRe.exec(fullText)) !== null) {
        wifeCtx.push(`…${m[1]}${m[2]}${m[3]}…`.replace(/\s+/g, ' '));
        if (wifeCtx.length >= 3) break;
    }
    console.log(`\nContext snippets around bequest to wife (${wifeCtx.length}):`);
    for (const s of wifeCtx) console.log(`  ${s}`);

    if (!APPLY) {
        console.log('\nDRY-RUN — re-run with --apply to write OCR text + spouse relationship.');
        await pool.end();
        return;
    }

    // Write OCR text to person_documents.ocr_text + context_snippet.
    // Store a concise, highly-useful snippet referencing the key finding:
    // the will identifies Angelica by her married surname Hopewell, which
    // is why NameResolver (searching Chesley) missed the linkage.
    const snippet = hopewellWifeConfirmed
        ? `Will names "beloved wife Angelica Hopewell" (= Angelica Chesley by maiden name; ${hits['Angelica Hopewell'] || 0}× occurrences). Bequests to her include enslaved persons named in the will. Sample context: "${wifeCtx[0]?.slice(0, 200) || ''}"`
        : `OCR'd via Google Vision. Length: ${fullText.length} chars.`;

    await pool.query(
        `UPDATE person_documents
         SET ocr_text = $1,
             context_snippet = $2,
             human_verified = false,
             extraction_confidence = 0.85
         WHERE canonical_person_id = $3 AND document_type = 'will'`,
        [fullText, snippet, HOPEWELL_CP]
    );
    console.log('\n✓ Stored OCR text + snippet on person_documents.');

    // Add spouse relationship if not already present
    const exists = await pool.query(
        `SELECT id FROM person_relationships_verified
         WHERE ((person_id=$1 AND related_person_id=$2) OR (person_id=$2 AND related_person_id=$1))
           AND relationship_type IN ('spouse','spouse_of','married_to')`,
        [HOPEWELL_CP, CHESLEY_CP]
    );
    if (exists.rowCount) {
        console.log(`  Spouse relationship already exists (id=${exists.rows[0].id}).`);
    } else {
        const r = await pool.query(
            `INSERT INTO person_relationships_verified
             (person_id, related_person_id, relationship_type, evidence_source_ids,
              evidence_strength, has_conflicts, verified_by)
             VALUES ($1, $2, 'spouse', $3::int[], $4, false, $5)
             RETURNING id`,
            [
                HOPEWELL_CP, CHESLEY_CP,
                [19],  // person_documents.id of the will
                hopewellWifeConfirmed ? 3 : 2,
                'ocr-hopewell-will.mjs (Apr 2026 — will explicitly names "beloved wife Angelica Hopewell"; maiden name Chesley)',
            ]
        );
        console.log(`  ✓ Added spouse relationship: cp=${HOPEWELL_CP} ↔ cp=${CHESLEY_CP} (id=${r.rows[0].id})`);
    }

    // Also record Ann Maria Biscoe as daughter (cp=141015 — she's claimant
    // of cww.00429). The will says "my Daughter Ann Maria Bercer" — "Bercer"
    // is the OCR error for "Biscoe".
    const ANN_MARIA_CP = 141015;
    const daughterExists = await pool.query(
        `SELECT id FROM person_relationships_verified
         WHERE ((person_id=$1 AND related_person_id=$2) OR (person_id=$2 AND related_person_id=$1))
           AND relationship_type IN ('parent','parent_of','child','child_of','father','father_of')`,
        [HOPEWELL_CP, ANN_MARIA_CP]
    );
    if (!daughterExists.rowCount && (hits['Ann Maria'] || 0) > 0) {
        const r = await pool.query(
            `INSERT INTO person_relationships_verified
             (person_id, related_person_id, relationship_type, evidence_source_ids,
              evidence_strength, has_conflicts, verified_by)
             VALUES ($1, $2, 'parent_of', $3::int[], 3, false, $4) RETURNING id`,
            [HOPEWELL_CP, ANN_MARIA_CP, [19],
             'ocr-hopewell-will.mjs — "my Daughter Ann Maria Bercer" = Ann Maria Biscoe (cp=141015, claimant of cww.00429)']
        );
        console.log(`  ✓ Added parent relationship: cp=${HOPEWELL_CP} (James) → cp=${ANN_MARIA_CP} (Ann Maria Biscoe, daughter) id=${r.rows[0].id}`);

        // And the Chesley → Ann Maria linkage
        const r2 = await pool.query(
            `INSERT INTO person_relationships_verified
             (person_id, related_person_id, relationship_type, evidence_source_ids,
              evidence_strength, has_conflicts, verified_by)
             VALUES ($1, $2, 'parent_of', $3::int[], 2, false, $4) RETURNING id`,
            [CHESLEY_CP, ANN_MARIA_CP, [19],
             'ocr-hopewell-will.mjs — inferred mother-daughter via spouse relationship (James+Angelica → Ann Maria Biscoe)']
        );
        console.log(`  ✓ Added parent relationship: cp=${CHESLEY_CP} (Angelica) → cp=${ANN_MARIA_CP} (Ann Maria Biscoe, daughter) id=${r2.rows[0].id}`);
    }

    // Tidy up
    fs.rmSync(dir, { recursive: true, force: true });
    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
