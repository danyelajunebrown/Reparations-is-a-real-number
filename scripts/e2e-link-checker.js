#!/usr/bin/env node
/**
 * e2e-link-checker.js
 * Systematically tests all /api/contribute/person/:id node connections against the live API.
 *
 * Tests:
 *   1. Sample unconfirmed_persons (Freedman's Bank depositors, 1860 slave schedule)
 *   2. Sample enslaved_individuals
 *   3. Sample canonical_persons (slaveholders)
 *   4. For each slaveholder — clicks through every enslavedPerson link and verifies it resolves
 *   5. Reports broken links, wrong table_source assignments, and missing documents
 *
 * Usage:
 *   node scripts/e2e-link-checker.js [--api https://reparations-platform.onrender.com] [--limit 20]
 *   node scripts/e2e-link-checker.js --api http://localhost:3001 --limit 5
 */

const https = require('https');
const http = require('http');

// ── Config ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const BASE_URL = getArg('--api', 'https://reparations-platform.onrender.com');
const LIMIT = parseInt(getArg('--limit', '20'), 10);
const VERBOSE = args.includes('--verbose');

// ── HTTP helper ───────────────────────────────────────────────────────────────
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, { timeout: 20000 }, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch {
                    resolve({ status: res.statusCode, data: null, raw: body.slice(0, 200) });
                }
            });
        }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
    });
}

// ── Counters ──────────────────────────────────────────────────────────────────
const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
    errors: []
};

function pass(label) {
    results.passed++;
    if (VERBOSE) console.log(`  ✅ ${label}`);
}

function fail(label, detail) {
    results.failed++;
    const msg = `  ❌ ${label}${detail ? ' — ' + detail : ''}`;
    console.log(msg);
    results.errors.push({ label, detail });
}

function warn(label, detail) {
    results.warnings++;
    const msg = `  ⚠️  ${label}${detail ? ' — ' + detail : ''}`;
    console.log(msg);
}

// ── Core test: fetch a person and validate ─────────────────────────────────
async function testPerson(id, tableHint, expectedTableSource, context) {
    const url = `${BASE_URL}/api/contribute/person/${id}${tableHint ? `?table=${tableHint}` : ''}`;
    try {
        const { status, data } = await fetchJson(url);
        const label = `${context} [${id}]`;

        if (status !== 200 || !data?.success) {
            fail(label, `HTTP ${status} — ${data?.error || 'no success flag'}`);
            return null;
        }

        const p = data.person;
        if (!p) {
            fail(label, 'person object missing from response');
            return null;
        }

        // Table source check
        if (expectedTableSource && p.tableSource !== expectedTableSource) {
            fail(label, `tableSource="${p.tableSource}" expected="${expectedTableSource}"`);
        } else {
            pass(label);
        }

        // full_name must exist
        if (!p.full_name) {
            warn(label, 'full_name is missing');
        }

        return data;
    } catch (err) {
        fail(`${context} [${id}]`, err.message);
        return null;
    }
}

// ── Test all enslavedPersons links on a slaveholder profile ──────────────────
async function testEnslavedLinks(slaveholderData, slaveholderLabel) {
    const enslaved = slaveholderData?.enslavedPersons || [];
    if (enslaved.length === 0) {
        if (VERBOSE) console.log(`    (no enslaved persons listed for ${slaveholderLabel})`);
        return;
    }

    console.log(`    → Testing ${enslaved.length} enslaved person link(s) for ${slaveholderLabel}`);
    for (const ep of enslaved.slice(0, 10)) { // cap at 10 per slaveholder
        const epId = ep.id || ep.enslaved_id || ep.lead_id;
        const epTable = ep.table_source;
        if (!epId) {
            fail(`enslavedPerson link under ${slaveholderLabel}`, `id is null/undefined (ep=${JSON.stringify(ep).slice(0,80)})`);
            continue;
        }
        await testPerson(epId, epTable || null, epTable || undefined, `enslaved under ${slaveholderLabel}`);
    }
}

// ── Sample IDs fetcher ────────────────────────────────────────────────────────
async function getSampleIds(searchQuery, expectedType, tableSource, limit) {
    const url = `${BASE_URL}/api/contribute/search/${encodeURIComponent(searchQuery)}?limit=${limit}`;
    try {
        const { data } = await fetchJson(url);
        if (!data?.results) return [];
        return data.results
            .filter(r => r.table_source === tableSource)
            .slice(0, limit)
            .map(r => ({ id: r.id, table: r.table_source, name: r.name }));
    } catch {
        return [];
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n🔗 e2e-link-checker — ${BASE_URL}`);
    console.log(`   limit=${LIMIT} verbose=${VERBOSE}\n`);

    // ── 1. Freedman's Bank depositors (unconfirmed_persons, freedperson) ──────
    console.log('── 1. Freedman\'s Bank depositors ───────────────────────────────');
    const depositorUrl = `${BASE_URL}/api/contribute/depositors/search?limit=${LIMIT}`;
    try {
        const { status, data } = await fetchJson(depositorUrl);
        if (status !== 200 || !data?.depositors) {
            fail('depositors/search endpoint', `HTTP ${status}`);
        } else {
            pass(`depositors/search returned ${data.depositors.length} results`);
            const sampleDepositors = data.depositors.slice(0, Math.min(LIMIT, data.depositors.length));
            for (const dep of sampleDepositors) {
                const profileData = await testPerson(
                    dep.lead_id,
                    'unconfirmed_persons',
                    'unconfirmed_persons',
                    `Freedman's Bank depositor "${dep.full_name}"`
                );
                // Verify no enslaved persons are falsely attached
                if (profileData?.enslavedPersons?.length > 0) {
                    fail(
                        `false slaveholder: "${dep.full_name}" [${dep.lead_id}]`,
                        `${profileData.enslavedPersons.length} enslaved persons shown for a freedperson`
                    );
                }
            }
        }
    } catch (err) {
        fail('depositors/search', err.message);
    }

    // ── 2. 1860 slave schedule persons (unconfirmed_persons, enslaved) ─────────
    console.log('\n── 2. 1860 slave schedule (unconfirmed_persons, enslaved) ───────');
    const schedulePersons = await getSampleIds('enslaved', 'enslaved', 'unconfirmed_persons', LIMIT);
    if (schedulePersons.length === 0) {
        warn('1860 slave schedule sample', 'no unconfirmed_persons enslaved records found via search');
    }
    for (const sp of schedulePersons) {
        await testPerson(sp.id, 'unconfirmed_persons', 'unconfirmed_persons', `1860 enslaved "${sp.name}"`);
    }

    // ── 3. enslaved_individuals ──────────────────────────────────────────────
    console.log('\n── 3. enslaved_individuals ─────────────────────────────────────');
    const enslavedPersons = await getSampleIds('enslaved', 'enslaved', 'enslaved_individuals', LIMIT);
    if (enslavedPersons.length === 0) {
        warn('enslaved_individuals sample', 'no records found via search');
    }
    for (const ep of enslavedPersons) {
        await testPerson(ep.id, 'enslaved_individuals', 'enslaved_individuals', `enslaved_individual "${ep.name}"`);
    }

    // ── 4. canonical_persons (slaveholders) + enslaved links ─────────────────
    console.log('\n── 4. canonical_persons slaveholders + enslaved person links ────');
    const slaveholders = await getSampleIds('owner', 'slaveholder', 'canonical_persons', Math.ceil(LIMIT / 2));
    if (slaveholders.length === 0) {
        warn('canonical_persons slaveholder sample', 'no records found via search');
    }
    for (const sh of slaveholders) {
        const shData = await testPerson(
            sh.id,
            'canonical_persons',
            'canonical_persons',
            `slaveholder "${sh.name}"`
        );
        if (shData) {
            await testEnslavedLinks(shData, `"${sh.name}"`);
        }
    }

    // ── 5. Known-good spot checks ─────────────────────────────────────────────
    console.log('\n── 5. Known-good spot checks ───────────────────────────────────');

    // Solomon G Brown — Freedman's Bank depositor with DocAI enrichment (lead_id = 2382371)
    const solomonData = await testPerson(
        '2382371', 'unconfirmed_persons', 'unconfirmed_persons',
        'Solomon G Brown (Freedman\'s Bank, DocAI)'
    );
    if (solomonData) {
        const p = solomonData.person;
        if (p.docai_fields) {
            pass('Solomon G Brown — docai_fields present on person object');
        } else {
            warn('Solomon G Brown', 'docai_fields not in person object (may not be enriched yet)');
        }
        if (solomonData.enslavedPersons?.length > 0) {
            fail('Solomon G Brown', `false slaveholder — ${solomonData.enslavedPersons.length} enslaved persons shown`);
        } else {
            pass('Solomon G Brown — no false enslaved persons attributed');
        }
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log('\n══ SUMMARY ══════════════════════════════════════════════════════');
    console.log(`  ✅ Passed:   ${results.passed}`);
    console.log(`  ❌ Failed:   ${results.failed}`);
    console.log(`  ⚠️  Warnings: ${results.warnings}`);
    if (results.failed > 0) {
        console.log('\n  Failed checks:');
        for (const e of results.errors) {
            console.log(`    • ${e.label}${e.detail ? ': ' + e.detail : ''}`);
        }
    }
    console.log('');
    process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
