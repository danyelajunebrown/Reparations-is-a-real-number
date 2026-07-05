#!/usr/bin/env node
/**
 * test-kinship-edge-writer.js — integration test for the kinship edge writer.
 *
 * Standard: memory-bank/standard-genealogical-edge-evidence.md (§5, D1/D3).
 * Exercises the real resolve → document → canonical_family_edges path against a
 * live DB, all inside a transaction that is ROLLED BACK (non-destructive).
 *
 * Requires DATABASE_URL. Fixtures use FS IDs prefixed 'TEST-KEW-' so they never
 * collide with real person_external_ids even if a rollback were skipped.
 *
 *   node tests/unit/test-kinship-edge-writer.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const pg = require('pg');
const PersonService = require('../../src/services/PersonService');
const { writeKinshipEdge } = require('../../src/services/climb/kinship-edge-writer');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ok   ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// Classifier-shaped verdicts (kept literal so the writer is tested in isolation).
const statedWill = { documentType: 'will', evidenceTier: 1, evidences: 'child_of', parentHint: {}, kinConfidence: 0.96, verifiedEligible: true };
const censusCoRes = { documentType: 'census', evidenceTier: 1, evidences: 'child_of', parentHint: {}, kinConfidence: 0.87, verifiedEligible: false };

async function main() {
    const client = await pool.connect();
    const svc = new PersonService(client);
    await client.query('BEGIN');
    try {
        const mkPerson = async (name) =>
            (await client.query(
                `INSERT INTO canonical_persons (canonical_name, person_type) VALUES ($1,'enslaver') RETURNING id`,
                [name])).rows[0].id;
        const mkFsId = async (cid, fsId) =>
            client.query(
                `INSERT INTO person_external_ids (canonical_person_id, id_system, external_id, confidence)
                 VALUES ($1,'familysearch',$2,0.9)`,
                [cid, fsId]);
        const edgeRow = async (childId, parentId) =>
            (await client.query(
                `SELECT evidence_tier, verified, source_document_id, notes, a_subject_table, a_subject_id
                 FROM canonical_family_edges
                 WHERE person_a_id=$1 AND person_b_id=$2 AND relationship_type='child_of'`,
                [childId, parentId])).rows[0];

        // Fixtures: child, true parent, and a rival parent for the conflict case.
        const childId  = await mkPerson('KEW Child');
        const parentId = await mkPerson('KEW Parent');
        const rivalId  = await mkPerson('KEW Rival Parent');
        await mkFsId(childId, 'TEST-KEW-CHILD');
        await mkFsId(parentId, 'TEST-KEW-PARENT');
        await mkFsId(rivalId, 'TEST-KEW-RIVAL');

        const deps = { db: client, personService: svc };

        // 1. Unresolved end → no edge written.
        {
            const r = await writeKinshipEdge(deps, {
                childFsId: 'TEST-KEW-NOBODY', parentFsId: 'TEST-KEW-PARENT', classification: statedWill,
            });
            check('unresolved child FS id → status unresolved', r.status === 'unresolved' && r.end === 'child', JSON.stringify(r));
        }

        // 2. Census co-residence (verifiedEligible=false) WITH s3Key → edge tier-1, verified=false.
        {
            const r = await writeKinshipEdge(deps, {
                childFsId: 'TEST-KEW-CHILD', parentFsId: 'TEST-KEW-PARENT', classification: censusCoRes,
                source: { sourceUrl: 'ark:/census/1', s3Key: 'fixtures/census.jpg', documentYear: 1860 },
            });
            const row = await edgeRow(childId, parentId);
            check('census co-residence writes an edge', r.status === 'written' && !!row);
            check('census co-residence stays verified=false (D1 inferential)', r.verified === false && row.verified === false);
            check('edge carries the source_document_id', !!row && row.source_document_id != null);
            check('M103 trigger synced polymorphic subject cols', !!row && row.a_subject_table === 'canonical_persons' && row.a_subject_id === childId);
        }

        // 3. STATED will WITH s3Key upgrades the same edge → verified=true (D1 auto-verify).
        {
            const r = await writeKinshipEdge(deps, {
                childFsId: 'TEST-KEW-CHILD', parentFsId: 'TEST-KEW-PARENT', classification: statedWill,
                source: { sourceUrl: 'ark:/will/1', s3Key: 'fixtures/will.jpg', documentYear: 1817 },
            });
            const row = await edgeRow(childId, parentId);
            check('stated will auto-verifies the edge', r.verified === true && row.verified === true);
        }

        // 4. STATED will WITHOUT s3Key → cannot assert (gate needs an archived file).
        {
            const c2 = await mkPerson('KEW Child2');
            await mkFsId(c2, 'TEST-KEW-CHILD2');
            const r = await writeKinshipEdge(deps, {
                childFsId: 'TEST-KEW-CHILD2', parentFsId: 'TEST-KEW-PARENT', classification: statedWill,
                source: { sourceUrl: 'ark:/will/2' }, // no s3Key
            });
            check('stated kinship without s3_key is not verified', r.status === 'written' && r.verified === false);
        }

        // 5. D3 conflict: a rival STATED tier-1 parent for a child that already has a
        //    verified tier-1 parent → both unverified + flagged, never overwritten.
        {
            const r = await writeKinshipEdge(deps, {
                childFsId: 'TEST-KEW-CHILD', parentFsId: 'TEST-KEW-RIVAL', classification: statedWill,
                source: { sourceUrl: 'ark:/will/rival', s3Key: 'fixtures/rival.jpg', documentYear: 1820 },
            });
            const original = await edgeRow(childId, parentId);
            const rival = await edgeRow(childId, rivalId);
            check('conflict returns status conflict', r.status === 'conflict', JSON.stringify(r));
            check('new rival edge is not verified', rival && rival.verified === false);
            check('pre-existing tier-1 edge is UNVERIFIED by the conflict', original && original.verified === false);
            check('both edges flagged kinship_conflict',
                original && rival && /kinship_conflict/.test(original.notes || '') && /kinship_conflict/.test(rival.notes || ''));
        }

        console.log(`\n${passed} passed, ${failed} failed`);
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.end();
    }
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
