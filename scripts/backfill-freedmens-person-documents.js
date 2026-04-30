#!/usr/bin/env node
/**
 * Backfill person_documents rows for the 2,092 unconfirmed_persons that
 * carry a freedmens ledger_extraction in review_notes but were never
 * paired with a person_documents row.
 *
 * Per memory-bank/plan-apr29 Stage 4: every extracted record needs a
 * person_documents row pointing at its source image in S3 so downstream
 * readers can verify claims, re-extract under different OCR engines, and
 * audit the trail from extracted field → primary source.
 *
 * The forward path was fixed by the 2026-04-30 commit to
 * extract-freedmens-fields.js. This script handles the legacy 2,092.
 *
 * Approach:
 *   1. Enumerate S3 → build map of (branch_slug, image_num) → s3_key
 *      for every freedmens-bank/<branch>/image-N.png object that exists.
 *   2. For each extracted depositor with image_num:
 *      a. Look up which branch(es) have an image of that number.
 *      b. If exactly one → use it.
 *      c. If multiple → score branches by (residence/plantation hints
 *         in ledger_extraction.fields) AND extracted_at-vs-PM2-log
 *         time window → pick best.
 *      d. If zero or ambiguous → record as unresolvable, skip with note.
 *   3. INSERT person_documents row, idempotent via unique
 *      (unconfirmed_person_id, s3_key) check.
 *   4. Report summary: resolved, ambiguous, no_image_num, no_match.
 *
 * Usage:
 *   node scripts/backfill-freedmens-person-documents.js --dry-run
 *   node scripts/backfill-freedmens-person-documents.js --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { neon } = require('@neondatabase/serverless');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const sql = neon(process.env.DATABASE_URL);
const s3 = new S3Client({ region: process.env.S3_REGION || 'us-east-2' });
const BUCKET = process.env.S3_BUCKET;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;

// Branch slug → city/state hints. Used for residence/plantation matching
// when a depositor's image_num appears in multiple branches.
const BRANCH_HINTS = {
    'charleston-south-carolina-roll-21':   ['charleston', 'south carolina', 'sc'],
    'huntsville-alabama-roll':             ['huntsville', 'alabama', 'al', 'madison'],
    'memphis-tennessee-roll':              ['memphis', 'tennessee', 'tn', 'shelby'],
    'new-orleans-louisiana-roll':          ['new orleans', 'louisiana', 'la', 'orleans parish'],
    'savannah-georgia-roll-8':             ['savannah', 'georgia', 'ga', 'chatham'],
    'tallahassee-florida-roll':            ['tallahassee', 'florida', 'fl', 'leon'],
    'washington-d-c--roll-4':              ['washington', 'd.c.', 'dc', 'district of columbia'],
};

async function buildS3Index() {
    console.log('Building S3 index...');
    const index = new Map();    // imageNum → [{branch_slug, s3_key}, ...]
    let token;
    let totalKeys = 0;
    do {
        const resp = await s3.send(new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: 'freedmens-bank/',
            ContinuationToken: token,
            MaxKeys: 1000,
        }));
        for (const obj of resp.Contents || []) {
            const key = obj.Key;
            // Match freedmens-bank/<branch_slug>/image-<num>.png
            const m = key.match(/^freedmens-bank\/([^/]+)\/image-(\d+)\.png$/);
            if (!m) continue;
            const branchSlug = m[1];
            const imageNum = parseInt(m[2], 10);
            if (!index.has(imageNum)) index.set(imageNum, []);
            index.get(imageNum).push({ branch_slug: branchSlug, s3_key: key });
            totalKeys++;
        }
        token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
        if (totalKeys % 1000 === 0 && totalKeys > 0) {
            process.stdout.write(`  scanned ${totalKeys} keys...\r`);
        }
    } while (token);
    console.log(`  S3 index built: ${totalKeys} image keys, ${index.size} distinct image_num values`);
    return index;
}

function pickBestBranch(candidates, ledgerExtraction) {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // Score each candidate by ledger residence/plantation hints
    const haystack = [
        ledgerExtraction?.residence,
        ledgerExtraction?.plantation,
        ledgerExtraction?.slave_residence,
    ].filter(Boolean).join(' ').toLowerCase();

    if (!haystack) return null;  // ambiguous

    let bestScore = 0;
    let best = null;
    for (const c of candidates) {
        const hints = BRANCH_HINTS[c.branch_slug] || [];
        let score = 0;
        for (const h of hints) {
            if (haystack.includes(h)) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            best = c;
        }
    }
    return bestScore > 0 ? best : null;
}

(async () => {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Freedmens person_documents backfill');
    console.log(`  Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (!BUCKET) { console.error('S3_BUCKET not set'); process.exit(1); }

    const index = await buildS3Index();

    console.log('\nLoading extracted depositors...');
    const rows = await sql`
        SELECT lead_id, full_name, source_url,
               review_notes::jsonb AS rn
        FROM unconfirmed_persons
        WHERE review_notes ILIKE '%ledger_extraction%'
        ORDER BY lead_id
    `;
    console.log(`  ${rows.length} extracted depositors loaded`);

    const stats = {
        resolved_unique: 0,
        resolved_by_hint: 0,
        ambiguous_no_hint: 0,
        no_image_num: 0,
        image_num_not_in_s3: 0,
        already_has_person_document: 0,
        inserted: 0,
        insert_errors: 0,
    };
    const errorSamples = [];

    for (const row of rows) {
        const rn = row.rn || {};
        const imageNumRaw = rn.image_num;
        const imageNum = typeof imageNumRaw === 'number' ? imageNumRaw
                       : (imageNumRaw && imageNumRaw !== 'null' ? parseInt(imageNumRaw, 10) : null);

        if (!imageNum || isNaN(imageNum)) {
            stats.no_image_num++;
            continue;
        }

        const candidates = index.get(imageNum) || [];
        if (candidates.length === 0) {
            stats.image_num_not_in_s3++;
            continue;
        }

        let chosen;
        if (candidates.length === 1) {
            chosen = candidates[0];
            stats.resolved_unique++;
        } else {
            chosen = pickBestBranch(candidates, rn.ledger_extraction);
            if (chosen) {
                stats.resolved_by_hint++;
            } else {
                stats.ambiguous_no_hint++;
                if (errorSamples.length < 5) {
                    errorSamples.push(`lead_id=${row.lead_id} image_num=${imageNum} candidates=[${candidates.map(c => c.branch_slug).join(',')}] residence="${rn.ledger_extraction?.residence || ''}"`);
                }
                continue;
            }
        }

        // Idempotency check
        const exists = await sql`
            SELECT 1 FROM person_documents
            WHERE unconfirmed_person_id = ${row.lead_id} AND s3_key = ${chosen.s3_key}
            LIMIT 1
        `;
        if (exists.length > 0) {
            stats.already_has_person_document++;
            continue;
        }

        if (DRY_RUN) {
            stats.inserted++;
            continue;
        }

        // Insert
        try {
            const f = rn.ledger_extraction || {};
            const ledgerSummary = [
                f.last_master ? `master="${f.last_master}"` : null,
                f.last_mistress ? `mistress="${f.last_mistress}"` : null,
                f.plantation ? `plantation="${f.plantation}"` : null,
                f.old_title ? `old_title="${f.old_title}"` : null,
                f.residence ? `residence="${f.residence}"` : null,
            ].filter(Boolean).join('; ').slice(0, 500);

            await sql`
                INSERT INTO person_documents (
                    unconfirmed_person_id, name_as_appears, s3_url, s3_key, source_url,
                    source_type, collection_name, image_number, page_reference,
                    ocr_text, context_snippet, person_type, document_type,
                    extraction_confidence, created_at, created_by
                ) VALUES (
                    ${row.lead_id},
                    ${row.full_name},
                    ${`s3://${BUCKET}/${chosen.s3_key}`},
                    ${chosen.s3_key},
                    ${row.source_url || null},
                    ${'freedmens_bank'},
                    ${chosen.branch_slug},
                    ${imageNum},
                    ${`backfilled — image ${imageNum}`},
                    ${JSON.stringify(f).slice(0, 8000)},
                    ${ledgerSummary || null},
                    ${'depositor'},
                    ${'freedmens_bank_ledger'},
                    ${parseFloat(rn.match_confidence) || null},
                    NOW(),
                    ${`freedmens-backfill-${rn.extraction_source || 'unknown'}`}
                )
            `;
            stats.inserted++;
        } catch (e) {
            stats.insert_errors++;
            if (errorSamples.length < 5) {
                errorSamples.push(`lead_id=${row.lead_id}: ${e.message.slice(0, 80)}`);
            }
        }

        if ((stats.inserted + stats.insert_errors) % 100 === 0) {
            process.stdout.write(`  progress: inserted=${stats.inserted} resolved_unique=${stats.resolved_unique} hint=${stats.resolved_by_hint}\r`);
        }
    }

    console.log('\n\n═══════════════════════════════════════════════════════════════');
    console.log('Summary:');
    console.log(`  total extracted depositors:           ${rows.length}`);
    console.log(`  no image_num in review_notes:         ${stats.no_image_num}`);
    console.log(`  image_num not present in S3:          ${stats.image_num_not_in_s3}`);
    console.log(`  resolved (unique branch):             ${stats.resolved_unique}`);
    console.log(`  resolved (by residence/plantation):   ${stats.resolved_by_hint}`);
    console.log(`  ambiguous (multi-branch, no hint):    ${stats.ambiguous_no_hint}`);
    console.log(`  already has person_documents row:     ${stats.already_has_person_document}`);
    console.log(`  ${DRY_RUN ? 'would insert' : 'inserted'}:                    ${stats.inserted}`);
    if (!DRY_RUN) console.log(`  insert errors:                        ${stats.insert_errors}`);
    if (errorSamples.length > 0) {
        console.log('\nSample failures / ambiguities:');
        for (const s of errorSamples) console.log(`  ${s}`);
    }
    console.log('═══════════════════════════════════════════════════════════════');
})().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
