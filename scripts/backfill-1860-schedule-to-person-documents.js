#!/usr/bin/env node
/**
 * Backfill person_documents rows for 1860 slave schedule persons.
 *
 * THE JOIN CHAIN:
 *   unconfirmed_persons.source_url
 *     → archived_urls.url
 *     → archived_urls.s3_key   (archives/slave-schedules/1860/<state>/<county>/<hash>.png)
 *     → person_documents INSERT
 *
 * The scraper (extract-census-ocr.js) already wired this:
 *   - storePerson()     writes source_url = image.url  → unconfirmed_persons
 *   - archiveToS3()     writes url = image.url, s3_key → archived_urls
 *
 * For persons promoted to canonical_persons, we also populate canonical_person_id.
 *
 * Usage:
 *   node scripts/backfill-1860-schedule-to-person-documents.js --dry-run
 *   node scripts/backfill-1860-schedule-to-person-documents.js --apply
 *   node scripts/backfill-1860-schedule-to-person-documents.js --apply --state Texas
 *   node scripts/backfill-1860-schedule-to-person-documents.js --audit
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);
const S3_BUCKET = process.env.S3_BUCKET;

const args = process.argv.slice(2);
const APPLY    = args.includes('--apply');
const AUDIT    = args.includes('--audit');
const DRY_RUN  = !APPLY && !AUDIT;
const STATE_FILTER = (() => {
    const idx = args.indexOf('--state');
    return idx >= 0 ? args[idx + 1] : null;
})();

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT MODE: show coverage stats, no writes
// ─────────────────────────────────────────────────────────────────────────────
async function runAudit() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  1860 Slave Schedule → person_documents AUDIT');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Total 1860 unconfirmed_persons
    const [{ total_up }] = await sql`
        SELECT COUNT(*) AS total_up
        FROM unconfirmed_persons
        WHERE extraction_method IN ('census_ocr_extraction', 'pre_indexed')
    `;
    console.log(`Unconfirmed persons (1860 extraction methods): ${total_up}`);

    // How many have source_url in archived_urls
    const [{ archived }] = await sql`
        SELECT COUNT(DISTINCT up.lead_id) AS archived
        FROM unconfirmed_persons up
        JOIN archived_urls au ON au.url = up.source_url
        WHERE up.extraction_method IN ('census_ocr_extraction', 'pre_indexed')
    `;
    console.log(`Have matching archived_urls entry:             ${archived}`);

    // How many already have person_documents
    const [{ already_linked }] = await sql`
        SELECT COUNT(DISTINCT pd.unconfirmed_person_id) AS already_linked
        FROM person_documents pd
        JOIN unconfirmed_persons up ON up.lead_id = pd.unconfirmed_person_id
        WHERE up.extraction_method IN ('census_ocr_extraction', 'pre_indexed')
    `;
    console.log(`Already have person_documents row:            ${already_linked}`);

    // Net new to backfill
    const [{ to_backfill }] = await sql`
        SELECT COUNT(DISTINCT up.lead_id) AS to_backfill
        FROM unconfirmed_persons up
        JOIN archived_urls au ON au.url = up.source_url
        LEFT JOIN person_documents pd
            ON pd.unconfirmed_person_id = up.lead_id
           AND pd.s3_key = au.s3_key
        WHERE up.extraction_method IN ('census_ocr_extraction', 'pre_indexed')
          AND pd.id IS NULL
    `;
    console.log(`Would backfill (net new):                     ${to_backfill}`);

    // No-archive gap (persons whose source_url is NOT in archived_urls)
    const [{ no_archive }] = await sql`
        SELECT COUNT(*) AS no_archive
        FROM unconfirmed_persons up
        LEFT JOIN archived_urls au ON au.url = up.source_url
        WHERE up.extraction_method IN ('census_ocr_extraction', 'pre_indexed')
          AND au.url IS NULL
    `;
    console.log(`No archived_urls match (S3 archive failed):   ${no_archive}`);

    // Canonical persons breakdown
    const [{ canon_linked }] = await sql`
        SELECT COUNT(*) AS canon_linked
        FROM canonical_persons cp
        JOIN unconfirmed_persons up ON up.lead_id::text = cp.enslaved_person_id
        JOIN archived_urls au ON au.url = up.source_url
        WHERE up.extraction_method IN ('census_ocr_extraction', 'pre_indexed')
    `;
    console.log(`Canonical persons with S3 archive to link:    ${canon_linked}`);

    // Breakdown by extraction_method
    console.log('\nBreakdown by extraction_method:');
    const byMethod = await sql`
        SELECT up.extraction_method, COUNT(*) AS cnt
        FROM unconfirmed_persons up
        JOIN archived_urls au ON au.url = up.source_url
        WHERE up.extraction_method IN ('census_ocr_extraction', 'pre_indexed')
        GROUP BY up.extraction_method
        ORDER BY cnt DESC
    `;
    for (const row of byMethod) {
        console.log(`  ${row.extraction_method.padEnd(30)} ${row.cnt}`);
    }

    // Sample 5 rows that would be backfilled
    console.log('\nSample rows that would be backfilled:');
    const samples = await sql`
        SELECT up.lead_id, up.full_name, up.person_type,
               up.extraction_method, au.s3_key
        FROM unconfirmed_persons up
        JOIN archived_urls au ON au.url = up.source_url
        LEFT JOIN person_documents pd
            ON pd.unconfirmed_person_id = up.lead_id
           AND pd.s3_key = au.s3_key
        WHERE up.extraction_method IN ('census_ocr_extraction', 'pre_indexed')
          AND pd.id IS NULL
        LIMIT 5
    `;
    for (const r of samples) {
        console.log(`  lead_id=${r.lead_id} name="${r.full_name}" type=${r.person_type}`);
        console.log(`    s3_key=${r.s3_key}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKFILL (DRY-RUN or APPLY)
// ─────────────────────────────────────────────────────────────────────────────
async function runBackfill() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  1860 Slave Schedule → person_documents BACKFILL');
    console.log(`  Mode:         ${APPLY ? 'APPLY' : 'DRY RUN'}`);
    if (STATE_FILTER) console.log(`  State filter: ${STATE_FILTER}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL not set');
        process.exit(1);
    }

    // Build the canonical-person lookup map: lead_id → canonical_person_id
    // (only rows that have been promoted)
    console.log('Loading canonical person promotions...');
    const canonRows = await sql`
        SELECT cp.id AS canonical_id, cp.enslaved_person_id::integer AS lead_id
        FROM canonical_persons cp
        JOIN unconfirmed_persons up ON up.lead_id::text = cp.enslaved_person_id
        WHERE up.extraction_method IN ('census_ocr_extraction', 'pre_indexed')
          AND cp.enslaved_person_id ~ '^[0-9]+$'
    `;
    const canonMap = new Map(canonRows.map(r => [r.lead_id, r.canonical_id]));
    console.log(`  ${canonMap.size} lead_ids have been promoted to canonical_persons\n`);

    // Process in cursor-paginated batches to stay within Neon's 64MB HTTP limit.
    // We select only the columns we need and extract JSONB fields in SQL.
    const BATCH_SIZE = 2000;
    let cursor = 0;  // lead_id cursor — start from 0 (all IDs are positive)
    let totalProcessed = 0;
    let batchNum = 0;

    const stats = {
        inserted: 0,
        skipped_already_exists: 0,
        insert_errors: 0,
        total: 442160,  // from audit; recounted below
    };
    const errorSamples = [];

    console.log(`Processing in batches of ${BATCH_SIZE} (cursor pagination on lead_id)...\n`);

    while (true) {
        // Fetch next batch using cursor (lead_id > cursor) so we never re-scan old rows
        let rows;
        if (STATE_FILTER) {
            rows = await sql`
                SELECT
                    up.lead_id,
                    up.full_name,
                    up.person_type,
                    up.source_url,
                    up.confidence_score,
                    up.relationships->>'state'  AS rel_state,
                    up.relationships->>'county' AS rel_county,
                    up.relationships->>'owner'  AS rel_owner,
                    up.relationships->>'age'    AS rel_age,
                    substring(up.context_text, 1, 300) AS context_text,
                    au.s3_key
                FROM unconfirmed_persons up
                JOIN archived_urls au ON au.url = up.source_url
                LEFT JOIN person_documents pd
                    ON pd.unconfirmed_person_id = up.lead_id
                   AND pd.s3_key = au.s3_key
                WHERE up.extraction_method IN ('census_ocr_extraction', 'pre_indexed')
                  AND pd.id IS NULL
                  AND up.lead_id > ${cursor}
                  AND (
                      up.relationships::text ILIKE ${'%' + STATE_FILTER + '%'}
                      OR up.context_text     ILIKE ${'%' + STATE_FILTER + '%'}
                  )
                ORDER BY up.lead_id
                LIMIT ${BATCH_SIZE}
            `;
        } else {
            rows = await sql`
                SELECT
                    up.lead_id,
                    up.full_name,
                    up.person_type,
                    up.source_url,
                    up.confidence_score,
                    up.relationships->>'state'  AS rel_state,
                    up.relationships->>'county' AS rel_county,
                    up.relationships->>'owner'  AS rel_owner,
                    up.relationships->>'age'    AS rel_age,
                    substring(up.context_text, 1, 300) AS context_text,
                    au.s3_key
                FROM unconfirmed_persons up
                JOIN archived_urls au ON au.url = up.source_url
                LEFT JOIN person_documents pd
                    ON pd.unconfirmed_person_id = up.lead_id
                   AND pd.s3_key = au.s3_key
                WHERE up.extraction_method IN ('census_ocr_extraction', 'pre_indexed')
                  AND pd.id IS NULL
                  AND up.lead_id > ${cursor}
                ORDER BY up.lead_id
                LIMIT ${BATCH_SIZE}
            `;
        }

        if (rows.length === 0) break;

        batchNum++;
        cursor = rows[rows.length - 1].lead_id;

        if (DRY_RUN && batchNum <= 1) {
            // Print first 5 rows in dry-run
            for (const row of rows.slice(0, 5)) {
                console.log(`  [DRY] Would insert: lead_id=${row.lead_id} "${row.full_name}" → ${row.s3_key}`);
            }
        }

        for (const row of rows) {
            const state  = row.rel_state  || extractFromContext(row.context_text, 'state')  || '';
            const county = row.rel_county || extractFromContext(row.context_text, 'county') || '';
            const owner  = row.rel_owner  || '';
            const age    = row.rel_age    || null;

            const s3Url   = S3_BUCKET ? `s3://${S3_BUCKET}/${row.s3_key}` : null;
            const canonId = canonMap.get(row.lead_id) || null;
            const contextSnippet = buildContextSnippet(row, owner, state, county, age);

            if (DRY_RUN) {
                stats.inserted++;
                totalProcessed++;
                continue;
            }

            try {
                await sql`
                    INSERT INTO person_documents (
                        unconfirmed_person_id,
                        canonical_person_id,
                        name_as_appears,
                        s3_key,
                        s3_url,
                        source_url,
                        source_type,
                        collection_name,
                        document_type,
                        person_type,
                        context_snippet,
                        extraction_confidence,
                        created_at,
                        created_by
                    ) VALUES (
                        ${row.lead_id},
                        ${canonId},
                        ${row.full_name},
                        ${row.s3_key},
                        ${s3Url},
                        ${row.source_url},
                        ${'1860_slave_schedule'},
                        ${'1860 U.S. Slave Schedule'},
                        ${'census_slave_schedule'},
                        ${row.person_type || 'enslaved'},
                        ${contextSnippet},
                        ${parseFloat(row.confidence_score) || 0.6},
                        NOW(),
                        ${'1860-schedule-backfill'}
                    )
                `;
                stats.inserted++;
            } catch (e) {
                // Skip duplicate (row was inserted between our check and insert)
                if (e.message.includes('duplicate') || e.message.includes('unique')) {
                    stats.skipped_already_exists++;
                } else {
                    stats.insert_errors++;
                    if (errorSamples.length < 5) {
                        errorSamples.push(`lead_id=${row.lead_id} "${row.full_name}": ${e.message.slice(0, 120)}`);
                    }
                }
            }
            totalProcessed++;
        }

        process.stdout.write(
            `  batch ${batchNum}: processed=${totalProcessed}  inserted=${stats.inserted}  errors=${stats.insert_errors}  cursor=${cursor}\r`
        );
    }

    stats.total = totalProcessed;

    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('Summary:');
    console.log(`  total candidates:       ${stats.total}`);
    if (DRY_RUN) {
        console.log(`  would insert:           ${stats.inserted}`);
    } else {
        console.log(`  inserted:               ${stats.inserted}`);
        console.log(`  skipped (already had):  ${stats.skipped_already_exists}`);
        console.log(`  insert errors:          ${stats.insert_errors}`);
    }
    if (errorSamples.length > 0) {
        console.log('\nSample errors:');
        for (const s of errorSamples) console.log(`  ${s}`);
    }
    console.log('═══════════════════════════════════════════════════════════════');

    if (APPLY && stats.inserted > 0) {
        console.log('\n✅ Backfill complete. Run --audit again to verify coverage.');
    }
    if (DRY_RUN) {
        console.log('\nThis was a dry run. Re-run with --apply to write to the database.');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try to extract state or county from context_text.
 * context_text format from storePerson():
 *   "Unknown (Male, age 35) | Owner: John Smith | Milam, Texas (1860)"
 *   "John Smith (slaveholder) | Milam, Texas (1860)"
 */
function extractFromContext(contextText, field) {
    if (!contextText) return null;
    // Match "County, State (Year)" pattern
    const m = contextText.match(/\|\s*([^,|]+),\s*([^(|]+)\s*\(\d{4}\)/);
    if (!m) return null;
    if (field === 'county') return m[1].trim();
    if (field === 'state')  return m[2].trim();
    return null;
}

/**
 * Build a short human-readable snippet for the person_documents.context_snippet field.
 */
function buildContextSnippet(row, owner, state, county, age) {
    const parts = [];
    if (row.person_type === 'enslaved') {
        if (owner)  parts.push(`Enslaved by: ${owner}`);
        if (county) parts.push(`Location: ${county}${state ? ', ' + state : ''}`);
        if (age)    parts.push(`Age: ${age}`);
        parts.push('Source: 1860 U.S. Slave Schedule');
    } else {
        parts.push(`Slaveholder`);
        if (county) parts.push(`Location: ${county}${state ? ', ' + state : ''}`);
        parts.push('Source: 1860 U.S. Slave Schedule');
    }
    return parts.join(' | ').slice(0, 500) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
    if (AUDIT) {
        await runAudit();
    } else {
        await runBackfill();
    }
})().catch(e => {
    console.error('\nFATAL:', e.message);
    console.error(e.stack);
    process.exit(1);
});
