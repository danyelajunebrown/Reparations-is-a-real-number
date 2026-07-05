#!/usr/bin/env node
/**
 * test-daa-kinship-gate.js — regression for the DAA chain-of-custody (kinship) gate.
 *
 * Standard: memory-bank/standard-genealogical-edge-evidence.md §7 (weakest-link).
 * The probate gate validates the slaveholder NODE; this gate validates every
 * parent→child EDGE on the participant→slaveholder path. An edge is assertable
 * only when an S3-backed, tier-1, verified `canonical_family_edges` row exists.
 *
 * Uses a FAKE db (no network) — the two queries the gate issues are stubbed so
 * we test the deterministic evaluation + the audit/enforce switch in isolation.
 *
 *   node tests/unit/test-daa-kinship-gate.js
 */
const assert = require('node:assert');
const DAAOrchestrator = require('../../src/services/reparations/DAAOrchestrator');
const { DAAKinshipGateError } = DAAOrchestrator;

let passed = 0, failed = 0;
function check(name, cond) {
    if (cond) { passed++; console.log(`  ok   ${name}`); }
    else { failed++; console.log(`  FAIL ${name}`); }
}

// Fake db: ancestor_climb_matches query returns [] (paths passed inline on the
// slaveholder objects); the canonical_family_edges query marks an edge
// assertable iff "child_fs|parent_fs" is in assertableSet.
function makeDb(assertableSet) {
    return {
        async query(sql, params) {
            if (/FROM ancestor_climb_matches/.test(sql)) return { rows: [] };
            if (/canonical_family_edges/.test(sql)) {
                const [children, parents] = params;
                const rows = children.map((child_fs, i) => ({
                    child_fs,
                    parent_fs: parents[i],
                    assertable: assertableSet.has(`${child_fs}|${parents[i]}`),
                }));
                return { rows };
            }
            return { rows: [] };
        },
    };
}

const orch = (assertableSet) => new DAAOrchestrator(makeDb(assertableSet), null, null);

// A lineage with two edges: P0(child) → P1 → P2(slaveholder).
const sh = (extra = {}) => ({
    slaveholder_name: 'Test Slaveholder',
    slaveholder_fs_id: 'P2',
    generation_distance: 2,
    lineage_path: ['You', 'Parent', 'Test Slaveholder'],
    lineage_path_fs_ids: ['P0', 'P1', 'P2'],
    ...extra,
});

async function main() {
    // 1. Audit mode with unproven edges must NOT throw (harvest not built yet).
    {
        let threw = false;
        try {
            await orch(new Set())._enforceKinshipGate([sh()], 'sess', { enforce: false });
        } catch (e) { threw = true; }
        check('audit mode does not throw on unproven lineage', threw === false);
    }

    // 2. Enforce mode with an unproven edge throws, naming generation 1.
    {
        let err = null;
        try {
            await orch(new Set())._enforceKinshipGate([sh()], 'sess', { enforce: true });
        } catch (e) { err = e; }
        check('enforce mode throws DAAKinshipGateError', err instanceof DAAKinshipGateError);
        check('enforce error names the first-gap generation (1)', !!err && /generation 1/.test(err.message));
    }

    // 3. Enforce mode with ALL edges S3-documented passes (no throw).
    {
        const all = new Set(['P0|P1', 'P1|P2']);
        let threw = false;
        try {
            await orch(all)._enforceKinshipGate([sh()], 'sess', { enforce: true });
        } catch (e) { threw = true; }
        check('enforce mode passes when every edge is documented', threw === false);
    }

    // 4. Enforce mode reports the SHALLOWEST gap: edge0 proven, edge1 not → gen 2.
    {
        const partial = new Set(['P0|P1']); // P1|P2 missing
        let err = null;
        try {
            await orch(partial)._enforceKinshipGate([sh()], 'sess', { enforce: true });
        } catch (e) { err = e; }
        check('enforce reports deepest-proven / first gap at generation 2',
            !!err && /generation 2/.test(err.message));
    }

    // 5. A lineage with no FS-ID path cannot be verified → enforce throws.
    {
        let err = null;
        try {
            await orch(new Set())._enforceKinshipGate(
                [sh({ lineage_path_fs_ids: null })], 'sess', { enforce: true });
        } catch (e) { err = e; }
        check('enforce blocks lineage with no FS-ID chain',
            !!err && /chain of custody cannot be verified/.test(err.message));
    }

    // 6. Empty slaveholder set is a no-op (probate gate owns the empty case).
    {
        let threw = false;
        try { await orch(new Set())._enforceKinshipGate([], 'sess', { enforce: true }); }
        catch (e) { threw = true; }
        check('empty slaveholder list is a no-op', threw === false);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
