#!/usr/bin/env node
/**
 * Freedperson Promotion Script
 *
 * Promotes Freedmen's Bank depositors from unconfirmed_persons to
 * canonical_persons with person_type='freedperson', making them
 * available for identity resolution, match verification cross-ref,
 * and the ancestor climber's match pipeline.
 *
 * Usage:
 *   node scripts/promote-freedpersons.js --dry-run              # Audit only
 *   node scripts/promote-freedpersons.js --branch "Charleston, South Carolina"
 *   node scripts/promote-freedpersons.js --all                  # All branches
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');

const DRY_RUN = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');
const branchIdx = process.argv.indexOf('--branch');
const TARGET_BRANCH = branchIdx !== -1 ? process.argv[branchIdx + 1] : null;
const CHUNK_SIZE = 500;

let sql = null;
const stats = { examined: 0, promoted: 0, filtered: 0, existing: 0, linked: 0, errors: 0, startTime: Date.now() };

function isGarbageName(name) {
    if (!name || name.length < 2) return true;
    if (/^\d/.test(name)) return true;
    if (/^[^a-zA-Z]/.test(name)) return true;
    if (/^(unknown|ditto|do|same|above|illegible|blank|n\/a|none|test|\?+|\.+|-+|dead|closed|more|attach)$/i.test(name.trim())) return true;
    if (name.trim().length < 2) return true;
    return false;
}

function parseName(fullName) {
    let cleaned = fullName.trim();
    cleaned = cleaned.replace(/^(Mrs?\.?|Dr\.?|Rev\.?)\s+/i, '');
    cleaned = cleaned.replace(/\s+(Jr\.?|Sr\.?)$/i, '');

    if (cleaned.includes(',')) {
        const parts = cleaned.split(',').map(s => s.trim());
        return { firstName: parts[1] || '', lastName: parts[0] || '' };
    }

    const parts = cleaned.split(/\s+/).filter(p => p.length > 0);
    if (parts.length === 0) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
    return { firstName: parts[0], lastName: parts[parts.length - 1] };
}

function extractState(location) {
    if (!location) return null;
    const m = location.match(/,\s*([A-Z][a-z].*)$/);
    if (m) return m[1].trim().replace(/,.*$/, '').trim();
    return null;
}

async function promoteBranch(branch) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  Promoting: ${branch}`);
    console.log(`${'─'.repeat(60)}`);

    const depositors = await sql`
        SELECT DISTINCT ON (LOWER(full_name))
            lead_id, full_name, locations, confidence_score,
            context_text, extraction_method, source_url, relationships
        FROM unconfirmed_persons
        WHERE extraction_method IN ('freedmens_bank_index', 'freedmens_bank_ocr', 'freedmens_bank_scrape')
        AND ${branch} = ANY(locations)
        AND confirmed_individual_id IS NULL
        ORDER BY LOWER(full_name), confidence_score DESC, lead_id
    `;

    console.log(`  Found ${depositors.length} unique depositors`);
    stats.examined += depositors.length;

    let promoted = 0, filtered = 0, existing = 0, linked = 0;

    for (let i = 0; i < depositors.length; i += CHUNK_SIZE) {
        const chunk = depositors.slice(i, i + CHUNK_SIZE);

        for (const dep of chunk) {
            if (isGarbageName(dep.full_name)) {
                filtered++;
                stats.filtered++;
                continue;
            }

            const { firstName, lastName } = parseName(dep.full_name);
            const state = extractState(branch);

            const existingCheck = await sql`
                SELECT id, person_type FROM canonical_persons
                WHERE LOWER(canonical_name) = LOWER(${dep.full_name})
                AND (
                    primary_state ILIKE ${state || '%'}
                    OR primary_state IS NULL
                )
                LIMIT 1
            `;

            if (existingCheck.length > 0) {
                existing++;
                stats.existing++;
                if (!DRY_RUN) {
                    await sql`
                        UPDATE unconfirmed_persons
                        SET confirmed_individual_id = ${String(existingCheck[0].id)}
                        WHERE lead_id = ${dep.lead_id}
                        AND confirmed_individual_id IS NULL
                    `;
                    linked++;
                    stats.linked++;
                }
                continue;
            }

            if (!DRY_RUN) {
                try {
                    const result = await sql`
                        INSERT INTO canonical_persons (
                            canonical_name, first_name, last_name,
                            person_type, primary_state,
                            confidence_score, verification_status,
                            notes, created_by
                        ) VALUES (
                            ${dep.full_name},
                            ${firstName},
                            ${lastName},
                            ${'freedperson'},
                            ${state},
                            ${dep.confidence_score || 0.90},
                            ${'unverified'},
                            ${'Freedmen\'s Bank depositor. ' + (dep.context_text || '').substring(0, 200) + '. Lead #' + dep.lead_id},
                            ${'promote-freedpersons.js'}
                        )
                        RETURNING id
                    `;

                    await sql`
                        UPDATE unconfirmed_persons
                        SET confirmed_individual_id = ${String(result[0].id)}
                        WHERE lead_id = ${dep.lead_id}
                    `;

                    promoted++;
                    stats.promoted++;
                } catch (err) {
                    if (err.code === '23505') {
                        existing++;
                        stats.existing++;
                    } else {
                        stats.errors++;
                    }
                }
            } else {
                promoted++;
                stats.promoted++;
            }
        }

        const pct = Math.round((i + chunk.length) / depositors.length * 100);
        process.stdout.write(`  ${i + chunk.length}/${depositors.length} (${pct}%) — ${promoted} promoted, ${filtered} filtered, ${existing} existing\r`);
    }

    console.log(`\n  Result: ${promoted} promoted, ${filtered} filtered, ${existing} already existed, ${linked} linked`);
}

async function main() {
    sql = neon(process.env.DATABASE_URL);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  FREEDMEN'S BANK DEPOSITOR PROMOTION`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'═'.repeat(60)}`);

    const branchRows = await sql`
        SELECT DISTINCT locations[1] AS branch, COUNT(*)::int AS n
        FROM unconfirmed_persons
        WHERE extraction_method IN ('freedmens_bank_index', 'freedmens_bank_ocr', 'freedmens_bank_scrape')
        AND person_type = 'freedperson'
        GROUP BY locations[1]
        ORDER BY n DESC
    `;

    console.log(`\n  Branches with freedperson data:`);
    branchRows.forEach(r => console.log(`    ${(r.branch || '?').padEnd(35)} ${r.n} depositors`));

    const branches = TARGET_BRANCH ? [TARGET_BRANCH]
        : ALL ? branchRows.map(r => r.branch)
        : [];

    if (branches.length === 0) {
        console.log('\n  No branches selected. Use --branch "Name" or --all');
        process.exit(0);
    }

    for (const branch of branches) {
        await promoteBranch(branch);
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Examined:  ${stats.examined}`);
    console.log(`  Promoted:  ${stats.promoted}`);
    console.log(`  Filtered:  ${stats.filtered}`);
    console.log(`  Existing:  ${stats.existing}`);
    console.log(`  Linked:    ${stats.linked}`);
    console.log(`  Errors:    ${stats.errors}`);
    console.log(`  Elapsed:   ${elapsed} min\n`);
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('Fatal:', err.message); process.exit(1); });
