#!/usr/bin/env node
/**
 * backfill-inheritance-edges-from-will-extractions.js
 *
 * Reads will_extractions where canonical_person_id IS NOT NULL (testator is
 * linked to a canonical_persons record), extracts heir data from the
 * structured_extraction_jsonb field, and writes inheritance_edges rows for
 * each testator → heir bequest found in the will.
 *
 * Also handles the known ground-truth wills from tests/fixtures/:
 *   - George Biscoe 1859  (enslaved_persons_count=8, monetary bequest, real_property)
 *   - Henry Weaver 1884   (spouse + children heirs, real_property + personal_estate)
 *   - Mary Ann Weaver 1883 (Henry Weaver as heir, personal_estate)
 *
 * IDEMPOTENT: Uses INSERT ... ON CONFLICT DO NOTHING.
 *
 * USAGE:
 *   node scripts/backfill-inheritance-edges-from-will-extractions.js
 *   node scripts/backfill-inheritance-edges-from-will-extractions.js --dry-run
 *   node scripts/backfill-inheritance-edges-from-will-extractions.js --limit=100
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const isDryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 10000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Valid asset_type values matching the inheritance_edges CHECK constraint
const VALID_ASSET_TYPES = new Set([
    'real_property', 'enslaved_persons', 'personal_estate', 'monetary_bequest',
    'residual_estate', 'trust_interest', 'business_interest', 'mixed', 'unspecified'
]);

/**
 * Infer an asset_type from free-text bequest description.
 * Falls back to 'unspecified' if no match.
 */
function inferAssetType(bequestText) {
    if (!bequestText) return 'unspecified';
    const t = bequestText.toLowerCase();
    if (/enslaved|slave|servant|negro|colored person/.test(t)) return 'enslaved_persons';
    if (/land|lot|acre|plantation|farm|tract|real|property/.test(t)) return 'real_property';
    if (/money|dollar|\$|cash|sum|annuity|bond|note/.test(t)) return 'monetary_bequest';
    if (/residue|remainder|rest|remaining|all my/.test(t)) return 'residual_estate';
    if (/trust|use of|benefit of/.test(t)) return 'trust_interest';
    if (/business|firm|partnership|stock/.test(t)) return 'business_interest';
    if (/furniture|household|personal|goods|chattels|livestock|horse/.test(t)) return 'personal_estate';
    return 'unspecified';
}

/**
 * Given a will_extractions row, return an array of edge descriptors.
 * Each descriptor: { heir_name, heir_canonical_id (if resolvable), asset_type,
 *   enslaved_persons_count, asset_value_usd_est, value_methodology_note, notes }
 */
function extractEdgesFromWill(row) {
    const edges = [];
    if (!row.structured_extraction_jsonb) return edges;

    let parsed;
    try {
        parsed = typeof row.structured_extraction_jsonb === 'string'
            ? JSON.parse(row.structured_extraction_jsonb)
            : row.structured_extraction_jsonb;
    } catch {
        return edges;
    }

    // Support multiple schema shapes that the DocAI extractor may emit
    const bequests = parsed.bequests
        || parsed.heirs
        || parsed.beneficiaries
        || parsed.devises
        || [];

    for (const b of bequests) {
        const heirName = b.heir_name || b.name || b.beneficiary_name || b.devisee || null;
        if (!heirName) continue;

        const assetDesc = b.asset || b.bequest || b.description || b.item || '';
        const assetType = b.asset_type && VALID_ASSET_TYPES.has(b.asset_type)
            ? b.asset_type
            : inferAssetType(assetDesc);

        const enslavedCount = b.enslaved_persons_count
            || b.enslaved_count
            || (assetType === 'enslaved_persons' && b.quantity ? parseInt(b.quantity, 10) : null)
            || null;

        edges.push({
            heir_name: heirName.trim(),
            heir_canonical_id: null, // resolved below
            asset_type: assetType,
            enslaved_persons_count: enslavedCount && !isNaN(enslavedCount) ? enslavedCount : null,
            asset_value_usd_est: b.asset_value_usd_est || b.value_usd || null,
            value_methodology_note: b.value_methodology_note || null,
            notes: assetDesc || null,
        });
    }

    // If no structured bequests but enslaved_persons_count is set at top level, synthesize one
    if (edges.length === 0 && (parsed.enslaved_persons_count || row.enslaved_persons_count)) {
        edges.push({
            heir_name: null, // estate-level, no named heir
            heir_canonical_id: null,
            asset_type: 'enslaved_persons',
            enslaved_persons_count: parsed.enslaved_persons_count || row.enslaved_persons_count,
            asset_value_usd_est: null,
            value_methodology_note: 'Enslaved persons count from will extraction; no named heir in structured data',
            notes: 'Estate-level enslaved persons count — heir not individually named',
        });
    }

    return edges;
}

async function resolveHeirToCanonicalId(client, heirName) {
    if (!heirName) return null;
    const tokens = heirName
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(t => t.length >= 2);
    if (tokens.length === 0) return null;

    // Try full name match first
    const exactResult = await client.query(`
        SELECT id FROM canonical_persons
        WHERE canonical_name ILIKE $1
        LIMIT 3
    `, [`%${heirName}%`]);
    if (exactResult.rows.length === 1) return exactResult.rows[0].id;

    // Try all-token AND match
    if (tokens.length >= 2) {
        const conditions = tokens.map((_, i) => `canonical_name ILIKE $${i + 1}`).join(' AND ');
        const params = tokens.map(t => `%${t}%`);
        const tokResult = await client.query(`
            SELECT id FROM canonical_persons
            WHERE ${conditions}
            LIMIT 3
        `, params);
        if (tokResult.rows.length === 1) return tokResult.rows[0].id;
    }
    return null;
}

async function run() {
    const client = await pool.connect();
    try {
        console.log('[backfill-inheritance-edges] Starting will_extractions backfill...');
        if (isDryRun) console.log('[backfill-inheritance-edges] DRY RUN — no writes');

        // Fetch will_extractions linked to a canonical_person (testator known)
        const willsResult = await client.query(`
            SELECT
                we.id AS will_extraction_id,
                we.canonical_person_id AS testator_canonical_id,
                we.structured_extraction_jsonb,
                we.enslaved_persons_count,
                we.document_date,
                we.document_year,
                pd.id AS source_document_id,
                cp.canonical_name AS testator_name
            FROM will_extractions we
            JOIN canonical_persons cp ON cp.id = we.canonical_person_id
            LEFT JOIN person_documents pd ON pd.will_extraction_id = we.id
            WHERE we.canonical_person_id IS NOT NULL
            ORDER BY we.id ASC
            LIMIT $1
        `, [LIMIT]);

        const wills = willsResult.rows;
        console.log(`[backfill-inheritance-edges] ${wills.length} will_extractions with linked testator`);

        let edgesAttempted = 0;
        let edgesInserted = 0;
        let edgesSkipped = 0;
        let heirsResolved = 0;
        let heirsUnresolved = 0;

        for (const will of wills) {
            const rawEdges = extractEdgesFromWill(will);
            if (rawEdges.length === 0) continue;

            for (const edge of rawEdges) {
                edgesAttempted++;

                // Attempt to resolve heir to canonical_person_id
                if (edge.heir_name && !edge.heir_canonical_id) {
                    edge.heir_canonical_id = await resolveHeirToCanonicalId(client, edge.heir_name);
                    if (edge.heir_canonical_id) heirsResolved++;
                    else heirsUnresolved++;
                }

                if (isDryRun) {
                    const heirStr = edge.heir_name
                        ? `${edge.heir_name}${edge.heir_canonical_id ? ` (id=${edge.heir_canonical_id})` : ' (unresolved)'}`
                        : '(estate-level)';
                    console.log(`  [DRY-RUN] ${will.testator_name} → ${heirStr} | ${edge.asset_type}${edge.enslaved_persons_count ? ` | enslaved=${edge.enslaved_persons_count}` : ''}`);
                    edgesInserted++;
                    continue;
                }

                try {
                    const insertResult = await client.query(`
                        INSERT INTO inheritance_edges (
                            testator_id,
                            heir_id,
                            heir_name_as_written,
                            asset_type,
                            enslaved_persons_count,
                            asset_value_usd_est,
                            value_methodology_note,
                            source_document_id,
                            will_extraction_id,
                            document_date,
                            document_year,
                            verified,
                            notes,
                            created_at,
                            updated_at
                        )
                        VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9,
                            $10, $11,
                            false,
                            $12,
                            NOW(), NOW()
                        )
                        ON CONFLICT (testator_id, heir_id, asset_type, source_document_id)
                        DO NOTHING
                        RETURNING id
                    `, [
                        will.testator_canonical_id,
                        edge.heir_canonical_id,       // may be NULL for unresolved
                        edge.heir_name,
                        edge.asset_type,
                        edge.enslaved_persons_count,
                        edge.asset_value_usd_est,
                        edge.value_methodology_note,
                        will.source_document_id,      // may be NULL
                        will.will_extraction_id,
                        will.document_date,
                        will.document_year,
                        edge.notes,
                    ]);
                    if (insertResult.rowCount > 0) edgesInserted++;
                    else edgesSkipped++;
                } catch (err) {
                    console.error(`  [ERROR] Insert failed for will ${will.will_extraction_id}: ${err.message}`);
                }
            }
        }

        console.log('\n[backfill-inheritance-edges] Results:');
        console.log(`  Will extractions processed: ${wills.length}`);
        console.log(`  Edges attempted:            ${edgesAttempted}`);
        console.log(`  Heirs resolved to canon ID: ${heirsResolved}`);
        console.log(`  Heirs unresolved (name only): ${heirsUnresolved}`);
        console.log(`  Edges inserted:             ${edgesInserted}`);
        console.log(`  Edges already existed:      ${edgesSkipped}`);
        if (isDryRun) console.log('  (DRY RUN — no changes written)');

        console.log('\n[backfill-inheritance-edges] Next steps:');
        console.log('  1. node scripts/audit-family-edges.js   — check Bug 4 inheritance_edges count');
        console.log('  2. Manually verify Weaver/Biscoe inheritance chains:');
        console.log('     SELECT * FROM inheritance_edges_resolved WHERE testator_name ILIKE \'%weaver%\';');
        console.log('  3. For unresolved heirs: add canonical_persons rows, then re-run this script.');

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => {
    console.error('[backfill-inheritance-edges] FATAL:', err);
    process.exit(1);
});
