#!/usr/bin/env node
/**
 * test-kinship-source-classifier.js — regression for the pure kinship-source
 * classifier (harvest mechanism step 1).
 *
 * Standard: memory-bank/standard-genealogical-edge-evidence.md §3/§4.
 * Ground-truth cases live in tests/fixtures/fs-sources/classifier-cases.json
 * (per feedback_no_hardcoded_test_data). Each asserts a normalized attached
 * source maps to the expected tier / proposition / auto-verify decision.
 *
 *   node tests/unit/test-kinship-source-classifier.js
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { classifyKinshipSource } = require('../../src/services/climb/kinship-source-classifier');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ok   ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const cases = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../fixtures/fs-sources/classifier-cases.json'), 'utf8'));

for (const c of cases) {
    const out = classifyKinshipSource(c.source);
    const e = c.expect;
    let ok = out.documentType === e.documentType
        && out.evidenceTier === e.evidenceTier
        && out.evidences === e.evidences;
    if (ok && e.verifiedEligible !== undefined) ok = out.verifiedEligible === e.verifiedEligible;
    if (ok && e.parentFsId !== undefined) ok = (out.parentHint && out.parentHint.fsId) === e.parentFsId;
    check(c.name, ok,
        ok ? '' : `got ${JSON.stringify({ documentType: out.documentType, evidenceTier: out.evidenceTier, evidences: out.evidences, verifiedEligible: out.verifiedEligible, parentFsId: out.parentHint && out.parentHint.fsId })}`);
}

// Invariant checks beyond the fixtures.
check('null/empty source is a safe drop', classifyKinshipSource(null).documentType === null);
check('D1: no census/deed/tier-2 output is ever auto-verify-eligible', (() => {
    for (const c of cases) {
        const out = classifyKinshipSource(c.source);
        if (out.verifiedEligible && (out.evidenceTier !== 1 || out.documentType === 'census')) return false;
    }
    return true;
})());
check('every kept edge carries a parentHint', (() => {
    for (const c of cases) {
        const out = classifyKinshipSource(c.source);
        if (out.evidences && !out.parentHint) return false;
    }
    return true;
})());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
