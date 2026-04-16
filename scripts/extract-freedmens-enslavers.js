#!/usr/bin/env node
/**
 * Freedmen's Bank — Former Enslaver Extraction
 *
 * Visits each depositor's FamilySearch record detail page (record_ark)
 * and extracts the "Former Master" / "Former Owner" field if present.
 * Updates the depositor's relationships JSONB with { type: 'enslaved_by', name }.
 *
 * This creates the enslaved_by linkage that DAAOrchestrator needs to include
 * freedpersons in reparations calculations.
 *
 * Requires Chrome on --remote-debugging-port=9222 with an active FS login.
 *
 * Usage:
 *   node scripts/extract-freedmens-enslavers.js --branch "Charleston, South Carolina" --dry-run
 *   node scripts/extract-freedmens-enslavers.js --branch "Charleston, South Carolina" --limit 100
 *   node scripts/extract-freedmens-enslavers.js --all
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const puppeteer = require('puppeteer-core');
const { neon } = require('@neondatabase/serverless');

const DRY_RUN = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');
const branchIdx = process.argv.indexOf('--branch');
const TARGET_BRANCH = branchIdx !== -1 ? process.argv[branchIdx + 1] : null;
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1]) : null;

const sql = neon(process.env.DATABASE_URL);
const stats = { visited: 0, found: 0, notFound: 0, errors: 0, startTime: Date.now() };

const ENSLAVER_LABELS = [
    'former master',
    'former owner',
    "master's name",
    "owner's name",
    'former slaveholder',
    'slave owner',
    'former master or employer'
];

async function extractEnslaverFromPage(page) {
    return await page.evaluate((labels) => {
        const rows = document.querySelectorAll('tr, [role="row"], .detail-row, dt, th');
        for (const row of rows) {
            const text = (row.innerText || '').toLowerCase();
            for (const label of labels) {
                if (text.includes(label)) {
                    const cells = row.querySelectorAll('td, dd, span, div');
                    for (const cell of cells) {
                        const val = (cell.innerText || '').trim();
                        if (val && !labels.some(l => val.toLowerCase().includes(l)) && val.length > 1 && val.length < 100) {
                            return val;
                        }
                    }
                    const nextSib = row.nextElementSibling;
                    if (nextSib) {
                        const val = (nextSib.innerText || '').trim();
                        if (val && val.length > 1 && val.length < 100) return val;
                    }
                }
            }
        }

        const allText = document.body.innerText || '';
        for (const label of labels) {
            const idx = allText.toLowerCase().indexOf(label);
            if (idx === -1) continue;
            const afterLabel = allText.substring(idx + label.length).replace(/^[:\s]+/, '');
            const line = afterLabel.split('\n')[0].trim();
            if (line && line.length > 1 && line.length < 100) return line;
        }

        return null;
    }, ENSLAVER_LABELS);
}

async function processBranch(page, branch) {
    console.log(`\n── ${branch} ──`);

    const limitClause = LIMIT ? sql`LIMIT ${LIMIT}` : sql`LIMIT 10000`;
    const depositors = await sql`
        SELECT lead_id, full_name, source_url, relationships
        FROM unconfirmed_persons
        WHERE extraction_method IN ('freedmens_bank_index', 'freedmens_bank_ocr', 'freedmens_bank_scrape')
        AND ${branch} = ANY(locations)
        AND source_url LIKE '%ark:/61903/1:1:%'
        AND (
            relationships IS NULL
            OR NOT (relationships::text LIKE '%enslaved_by%')
        )
        ORDER BY lead_id
        ${limitClause}
    `;

    console.log(`  ${depositors.length} records to check`);

    for (let i = 0; i < depositors.length; i++) {
        const dep = depositors[i];
        stats.visited++;

        try {
            await page.goto(dep.source_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 3000));

            const enslaver = await extractEnslaverFromPage(page);

            if (enslaver) {
                stats.found++;
                const existing = typeof dep.relationships === 'string'
                    ? JSON.parse(dep.relationships || '[]')
                    : (dep.relationships || []);
                const rels = Array.isArray(existing) ? existing : [];
                rels.push({ type: 'enslaved_by', name: enslaver });

                if (!DRY_RUN) {
                    await sql`
                        UPDATE unconfirmed_persons
                        SET relationships = ${JSON.stringify(rels)}::jsonb
                        WHERE lead_id = ${dep.lead_id}
                    `;
                }
                console.log(`  ✓ ${dep.full_name} → enslaved by "${enslaver}"`);
            } else {
                stats.notFound++;
            }
        } catch (err) {
            stats.errors++;
        }

        if ((i + 1) % 50 === 0) {
            process.stdout.write(`  Progress: ${i + 1}/${depositors.length} — ${stats.found} enslavers found\r`);
        }
    }
}

async function main() {
    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
    const pages = await browser.pages();
    let page = pages.find(p => /familysearch\.org/.test(p.url()));
    if (!page) page = await browser.newPage();

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  FREEDMEN'S BANK — FORMER ENSLAVER EXTRACTION`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'═'.repeat(60)}`);

    const branchRows = await sql`
        SELECT DISTINCT locations[1] AS branch, COUNT(*)::int AS n
        FROM unconfirmed_persons
        WHERE extraction_method IN ('freedmens_bank_index', 'freedmens_bank_ocr', 'freedmens_bank_scrape')
        AND source_url LIKE '%ark:/61903/1:1:%'
        GROUP BY locations[1]
        ORDER BY n DESC
    `;

    const branches = TARGET_BRANCH ? [TARGET_BRANCH]
        : ALL ? branchRows.map(r => r.branch)
        : [];

    if (branches.length === 0) {
        console.log('\n  Use --branch "Name" or --all');
        process.exit(0);
    }

    for (const branch of branches) {
        await processBranch(page, branch);
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Visited:    ${stats.visited}`);
    console.log(`  Found:      ${stats.found}`);
    console.log(`  Not found:  ${stats.notFound}`);
    console.log(`  Errors:     ${stats.errors}`);
    console.log(`  Elapsed:    ${elapsed} min\n`);

    try { await browser.disconnect(); } catch (_) {}
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('Fatal:', err.message); process.exit(1); });
