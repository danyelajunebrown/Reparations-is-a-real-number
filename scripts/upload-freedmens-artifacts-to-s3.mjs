// Upload cached Freedmen's Bank OCR artifacts to S3 and record the S3 keys
// in unconfirmed_persons.review_notes so the primary-source evidence persists
// past local-dir cleanup.
//
// Artifacts per depositor (from extract-freedmens-fields.js):
//   debug/freedmens-bank/enslaver-test/{branch-slug}/{tag}.png          screenshot
//   debug/freedmens-bank/enslaver-test/{branch-slug}/{tag}-vision.json   Vision response
//   debug/freedmens-bank/enslaver-test/{branch-slug}/{tag}-parsed.json   parsed + anchors
//   debug/freedmens-bank/enslaver-test/{branch-slug}/{tag}-ocr.txt       flat OCR text
//
// We upload to S3 under:
//   freedmens-bank/ocr-artifacts/{branch-slug}/{tag}.{ext}
//
// And add to each matching unconfirmed_persons row's review_notes:
//   s3_screenshot_key, s3_vision_key, s3_parsed_key, s3_ocr_text_key
//
// Match logic: a local artifact's `{tag}` is either `acct-<N>` or
// `lead-<N>`. For acct-N, we find the DB depositor(s) by account# + branch.
// For lead-N, we find by lead_id directly. Multiple depositors can share one
// set of artifacts (same ledger page).
//
// Usage:
//   node scripts/upload-freedmens-artifacts-to-s3.mjs                 # dry-run
//   node scripts/upload-freedmens-artifacts-to-s3.mjs --apply         # live

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S3Service = require('../src/services/storage/S3Service');

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

if (!S3Service.isEnabled()) {
    console.error('S3 is not enabled. Check config/env vars (S3_ENABLED, S3_BUCKET, AWS_*).');
    await pool.end();
    process.exit(1);
}

const ROOT = path.resolve('debug/freedmens-bank/enslaver-test');
if (!fs.existsSync(ROOT)) {
    console.error(`Artifact dir not found: ${ROOT}`);
    process.exit(1);
}

// Walk each branch directory
const branchDirs = fs.readdirSync(ROOT).filter(d => fs.statSync(path.join(ROOT, d)).isDirectory());
console.log(`Branches found: ${branchDirs.length}`);
console.log(`Mode: ${APPLY ? 'APPLY (uploading to S3 + DB writes)' : 'DRY-RUN'}`);
console.log();

// Translate slug back to branch location for DB lookup. Our slug came from
// scripts/extract-freedmens-fields.js localDir construction:
//   branchLocation.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + (rollLabel || 'roll')...
// So "Charleston, South Carolina" → "charleston-south-carolina", roll becomes
// "roll-21" etc. We match the DB by reversing: find any branch whose
// locations[1] slugifies to a prefix of the dir name.
function slugToBranchMatchers(slug) {
    // Three dir-name shapes in practice:
    //   "charleston-south-carolina-roll-21" → loc="charleston-south-carolina", roll="Roll 21"
    //   "baltimore-maryland-roll"            → loc="baltimore-maryland", no roll
    //                                          (branch has no roll label in DB)
    //   "washington-d-c--roll-4"             → loc="washington-d-c", roll="Roll 4"
    //                                          (DC's slug has extra dashes)
    // The earlier regex `.split('-roll-')` wasn't stripping the trailing
    // "-roll" suffix from no-roll-number dirs, leaving "baltimore-maryland-roll"
    // as locSlug. The ILIKE pattern then required "roll" in locations[1] and
    // failed for "Baltimore, Maryland" (which has no "roll" in it).
    let s = slug;
    let rollLabel = null;
    const withNum = s.match(/^(.*)-roll-(\d+)$/);
    if (withNum) {
        s = withNum[1];
        rollLabel = `Roll ${withNum[2]}`;
    } else {
        // trailing "-roll" with no number
        s = s.replace(/-roll$/, '');
    }
    // Collapse runs of dashes that happen when slug source had punctuation
    // like "D.C." → "d-c-" → "d-c"
    s = s.replace(/-+/g, '-').replace(/(^-|-$)/g, '');
    return { locSlug: s, rollLabel };
}
function slugifyLocation(loc) {
    return (loc || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

let totalUploads = 0;
let totalDbUpdates = 0;
let totalErrors = 0;
let totalSkipped = 0;

for (const branchDir of branchDirs) {
    const { locSlug, rollLabel } = slugToBranchMatchers(branchDir);
    const localDir = path.join(ROOT, branchDir);
    const files = fs.readdirSync(localDir);

    // Group files by tag (everything before the extension/suffix)
    const tagGroups = new Map();
    for (const f of files) {
        const m = f.match(/^(acct-\d+|lead-\d+|image-\d+)(?:-(vision|parsed|ocr))?\.(\w+)$/);
        if (!m) continue;
        const [, tag, kind, ext] = m;
        if (!tagGroups.has(tag)) tagGroups.set(tag, {});
        const key = kind || (ext === 'png' ? 'screenshot' : 'other');
        tagGroups.get(tag)[key] = f;
    }

    if (tagGroups.size === 0) continue;
    console.log(`[${branchDir}] ${tagGroups.size} tag groups`);

    for (const [tag, group] of tagGroups) {
        // Resolve this tag to DB depositor(s)
        let depositors = [];
        const acctMatch = tag.match(/^acct-(\d+)$/);
        const leadMatch = tag.match(/^lead-(\d+)$/);
        if (leadMatch) {
            const r = await pool.query('SELECT lead_id, full_name, review_notes FROM unconfirmed_persons WHERE lead_id=$1', [parseInt(leadMatch[1])]);
            depositors = r.rows;
        } else if (acctMatch) {
            const r = await pool.query(`
                SELECT lead_id, full_name, review_notes
                FROM unconfirmed_persons
                WHERE extraction_method='freedmens_bank_index'
                  AND context_text LIKE $1
                  AND locations[1] ILIKE $2
                  ${rollLabel ? 'AND context_text LIKE $3' : ''}
                LIMIT 20
            `, rollLabel
                ? [`%account #${acctMatch[1]}%`, `%${locSlug.replace(/-/g, '%')}%`, `%${rollLabel}%`]
                : [`%account #${acctMatch[1]}%`, `%${locSlug.replace(/-/g, '%')}%`]);
            depositors = r.rows;
        }
        if (depositors.length === 0) {
            totalSkipped++;
            continue;
        }

        // Upload each file once, collect S3 keys
        const s3Keys = {};
        for (const [kind, filename] of Object.entries(group)) {
            const s3Key = `freedmens-bank/ocr-artifacts/${branchDir}/${filename}`;
            s3Keys[`s3_${kind}_key`] = s3Key;
            if (!APPLY) continue;
            const body = fs.readFileSync(path.join(localDir, filename));
            const contentType = filename.endsWith('.png') ? 'image/png'
                : filename.endsWith('.json') ? 'application/json'
                : 'text/plain';
            try {
                await S3Service.upload(s3Key, body, contentType);
                totalUploads++;
            } catch (err) {
                totalErrors++;
                if (totalErrors <= 3) console.error(`  upload failed ${s3Key}: ${err.message}`);
            }
        }

        // Update DB rows with S3 keys
        for (const dep of depositors) {
            const current = typeof dep.review_notes === 'string'
                ? JSON.parse(dep.review_notes || '{}')
                : (dep.review_notes || {});
            const merged = { ...current, ...s3Keys, s3_uploaded_at: new Date().toISOString() };
            if (APPLY) {
                await pool.query('UPDATE unconfirmed_persons SET review_notes=$1::jsonb WHERE lead_id=$2',
                    [JSON.stringify(merged), dep.lead_id]);
                totalDbUpdates++;
            }
        }
    }
}

console.log();
console.log(`Uploads:      ${totalUploads}`);
console.log(`DB updates:   ${totalDbUpdates}`);
console.log(`Errors:       ${totalErrors}`);
console.log(`Tags skipped: ${totalSkipped} (no DB depositor match)`);

await pool.end();
