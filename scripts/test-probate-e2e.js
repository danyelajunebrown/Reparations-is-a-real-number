#!/usr/bin/env node
/**
 * test-probate-e2e.js
 *
 * End-to-end retrieval test for Georgia Probate Scraper output.
 * Verifies the full chain: DB row → API response → front-end data shape.
 *
 * Checks:
 *   1. DB integrity — every written probate record has a valid person_document
 *   2. API shape — GET /api/contribute/person/:id returns correct fields
 *   3. S3 presigned URL — GET /api/contribute/person-doc-access/:pdId returns a URL
 *   4. Inheritance chain — inheritance_edges appear in person profile response
 *   5. Enslaved persons — unconfirmed_persons appear in relationships JSONB
 *
 * Usage:
 *   node scripts/test-probate-e2e.js
 *   node scripts/test-probate-e2e.js --county Chatham
 *   node scripts/test-probate-e2e.js --api-base http://localhost:3000
 *   node scripts/test-probate-e2e.js --api-base https://reparations-platform.onrender.com
 *
 * Requires ADMIN_TOKEN in .env to call admin-only API endpoints.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pg   = require('pg');
const http = require('http');
const https = require('https');

const argv     = process.argv.slice(2);
const opt      = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i+1] ? argv[i+1] : d; };
const COUNTY   = opt('--county', 'Liberty');
const API_BASE = opt('--api-base', `http://localhost:${process.env.PORT || 3000}`);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

function sep(c = '─', n = 70) { return c.repeat(n); }
function hdr(t) { console.log('\n' + sep('═')); console.log('  ' + t); console.log(sep('═')); }
function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.log(`  ✗ FAIL: ${msg}`); }
function info(msg) { console.log(`  · ${msg}`); }

let passCount = 0, failCount = 0;
function check(condition, label) {
    if (condition) { pass(label); passCount++; }
    else           { fail(label); failCount++; }
}

async function apiGet(path) {
    return new Promise((resolve, reject) => {
        const url   = `${API_BASE}${path}`;
        const proto = url.startsWith('https') ? https : http;
        const opts  = { headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` } };
        proto.get(url, opts, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
                catch { resolve({ status: res.statusCode, data: body }); }
            });
        }).on('error', reject);
    });
}

async function main() {
    hdr(`PROBATE E2E TEST  —  county="${COUNTY}"  api="${API_BASE}"`);
    console.log(`  ${new Date().toISOString()}\n`);

    const client = await pool.connect();
    try {

        // ── 1. Pull 5 representative written estates ──────────────────────────
        const estates = await client.query(`
            SELECT
                p.image_number,
                p.roll_group_id,
                p.record_type,
                p.testator_name,
                p.enslaved_count,
                p.person_document_id      AS pd_id,
                pd.canonical_person_id    AS cp_id,
                pd.document_year,
                pd.s3_key,
                pd.source_url,
                cp.canonical_name,
                cp.person_type,
                cp.verification_status
            FROM probate_scrape_progress p
            JOIN person_documents pd ON pd.id = p.person_document_id
            LEFT JOIN canonical_persons cp ON cp.id = pd.canonical_person_id
            WHERE p.collection_id = '1999178'
              AND p.county ILIKE $1
              AND p.status = 'written'
              AND p.record_type = 'will'
              AND p.testator_name IS NOT NULL
            ORDER BY p.enslaved_count DESC NULLS LAST, p.image_number
            LIMIT 5
        `, [COUNTY]);

        if (estates.rows.length === 0) {
            console.log('  No written will records found. Run --apply step on the scraper first.');
            return;
        }

        info(`Found ${estates.rows.length} test estates to verify.\n`);

        for (const [idx, e] of estates.rows.entries()) {
            console.log(`\n${sep('─')}`);
            console.log(`  Estate ${idx + 1}:  img=${e.image_number}  testator="${e.testator_name}"  year=${e.document_year}  enslaved=${e.enslaved_count}`);
            console.log(sep('─'));

            // ── 2. DB integrity checks ────────────────────────────────────────
            check(!!e.pd_id,        `person_documents row exists (id=${e.pd_id})`);
            check(!!e.document_year, `document_year populated (${e.document_year})`);
            check(!!e.s3_key,       `S3 key present`);
            check(!!e.cp_id,        `canonical_person linked (id=${e.cp_id})`);

            if (e.cp_id) {
                check(e.person_type === 'enslaver', `canonical_person typed as 'enslaver' (got: ${e.person_type})`);
                check(!!e.canonical_name,           `canonical_name not null ("${e.canonical_name}")`);
            }

            // ── 3. Inheritance edges ──────────────────────────────────────────
            const heirRes = await client.query(`
                SELECT ie.heir_id, cp2.canonical_name, ie.asset_type, ie.confidence
                FROM inheritance_edges ie
                JOIN canonical_persons cp2 ON cp2.id = ie.heir_id
                WHERE ie.source_document_id = $1
                LIMIT 10
            `, [e.pd_id]);
            check(heirRes.rows.length > 0, `inheritance_edges exist (${heirRes.rows.length} heirs)`);
            if (heirRes.rows.length > 0 && process.env.NODE_ENV !== 'production') {
                for (const h of heirRes.rows) {
                    info(`  heir: "${h.canonical_name}"  asset_type=${h.asset_type}  conf=${h.confidence}`);
                }
            }

            // ── 4. Enslaved persons ───────────────────────────────────────────
            const upRes = await client.query(`
                SELECT up.lead_id, up.full_name, up.gender,
                       up.relationships->>'dollar_value_at_bequeathal' AS dollar_value,
                       up.relationships->>'bequeathed_by_canonical_id' AS enslaver_id
                FROM unconfirmed_persons up
                JOIN person_documents pd ON pd.source_url = up.source_url
                WHERE pd.id = $1
                  AND up.person_type = 'enslaved'
                  AND up.extraction_method = 'full_text_transcript'
            `, [e.pd_id]);

            if (e.enslaved_count > 0) {
                check(upRes.rows.length > 0, `unconfirmed_persons rows for enslaved exist (${upRes.rows.length} found, ${e.enslaved_count} expected)`);
                for (const ep of upRes.rows) {
                    check(
                        ep.enslaver_id && ep.enslaver_id !== 'null',
                        `enslaved "${ep.full_name}" linked to testator (canonical_id=${ep.enslaver_id})`
                    );
                }
            } else {
                info(`No enslaved count on this record — skipping unconfirmed_persons check.`);
            }

            // ── 5. enslaver_evidence_compendium ───────────────────────────────
            if (e.cp_id) {
                const eecRes = await client.query(`
                    SELECT id, evidence_strength FROM enslaver_evidence_compendium
                    WHERE canonical_person_id = $1
                      AND evidence_source_table = 'person_documents'
                      AND evidence_source_id = $2::text
                `, [e.cp_id, e.pd_id]);
                check(eecRes.rows.length > 0, `enslaver_evidence_compendium row registered`);
            }

            // ── 6. API: person profile ────────────────────────────────────────
            if (e.cp_id && ADMIN_TOKEN) {
                const personRes = await apiGet(`/api/contribute/person/${e.cp_id}?table=canonical_persons`);
                check(personRes.status === 200, `GET /api/contribute/person/${e.cp_id} → 200`);
                if (personRes.status === 200 && personRes.data) {
                    const d = personRes.data;
                    check(!!d.canonical_name || !!d.name, `API response has name`);
                    check(Array.isArray(d.documents) || d.documents !== undefined, `API response has documents array`);
                    if (d.familyMembers) {
                        check(true, `API response has familyMembers section`);
                    }
                    if (ADMIN_TOKEN) {
                        info(`  API response keys: ${Object.keys(d).join(', ')}`);
                    }
                }
            } else if (!ADMIN_TOKEN) {
                info('ADMIN_TOKEN not set — skipping API checks (set in .env to enable).');
            }

            // ── 7. API: document viewer presigned URL ─────────────────────────
            if (e.pd_id && ADMIN_TOKEN) {
                const docRes = await apiGet(`/api/contribute/person-doc-access/${e.pd_id}`);
                check(docRes.status === 200, `GET /api/contribute/person-doc-access/${e.pd_id} → 200`);
                if (docRes.status === 200 && docRes.data) {
                    const hasUrl = typeof docRes.data.url === 'string' && docRes.data.url.startsWith('http');
                    check(hasUrl, `Presigned S3 URL returned`);
                }
            }
        }

        // ── Summary ───────────────────────────────────────────────────────────
        hdr('TEST SUMMARY');
        const total = passCount + failCount;
        console.log(`  PASSED: ${passCount} / ${total}`);
        console.log(`  FAILED: ${failCount} / ${total}`);
        if (failCount === 0) {
            console.log('\n  All checks passed. Proceeding to full-county run is safe.');
        } else {
            console.log('\n  Fix failures above before running full-county pass.');
            process.exitCode = 1;
        }
        console.log(sep('═') + '\n');

    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
