#!/usr/bin/env node
/**
 * Freedmen's Bank ↔ Enslaver Cross-Reference
 *
 * For each freedperson depositor who lists family members in their record,
 * check if any of those family member names appear as enslavers in
 * canonical_persons. A match suggests an enslaved_by relationship —
 * either the enslaver shared a surname with the freedperson (common pattern:
 * enslaved people often took their enslaver's surname), or the family member
 * listed IS the former enslaver recorded under a familial label.
 *
 * This creates the enslaved_by linkage that DAAOrchestrator needs.
 *
 * Usage:
 *   node scripts/crossref-freedmens-enslavers.js --dry-run
 *   node scripts/crossref-freedmens-enslavers.js --branch "Charleston, South Carolina"
 *   node scripts/crossref-freedmens-enslavers.js --all
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');

const DRY_RUN = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');
const branchIdx = process.argv.indexOf('--branch');
const TARGET_BRANCH = branchIdx !== -1 ? process.argv[branchIdx + 1] : null;

const sql = neon(process.env.DATABASE_URL);
const stats = { examined: 0, matched: 0, linked: 0, errors: 0, startTime: Date.now() };

async function crossRefBranch(branch) {
    console.log(`\n── ${branch} ──`);

    // Get depositors with family members in their relationships JSONB
    const depositors = await sql`
        SELECT lead_id, full_name, locations, relationships, context_text
        FROM unconfirmed_persons
        WHERE extraction_method IN ('freedmens_bank_index', 'freedmens_bank_ocr', 'freedmens_bank_scrape')
        AND ${branch} = ANY(locations)
        AND relationships IS NOT NULL
        AND jsonb_typeof(relationships) = 'array'
        AND NOT (relationships::text LIKE '%enslaved_by%')
    `;

    console.log(`  ${depositors.length} depositors with family members (no existing enslaved_by)`);
    stats.examined += depositors.length;

    for (const dep of depositors) {
        const rels = typeof dep.relationships === 'string'
            ? JSON.parse(dep.relationships)
            : (dep.relationships || []);

        if (!Array.isArray(rels) || rels.length === 0) continue;

        // Also check if the depositor's own surname matches an enslaver
        const depositorParts = dep.full_name.trim().split(/\s+/);
        const depositorSurname = depositorParts.length > 1
            ? depositorParts[depositorParts.length - 1]
            : null;

        // Collect all names to check: family members + depositor surname
        const namesToCheck = rels
            .filter(r => r.name && r.name.length > 2 && r.type !== 'enslaved_by')
            .map(r => r.name);

        for (const famName of namesToCheck) {
            try {
                // Check if this family member name matches an enslaver
                const matches = await sql`
                    SELECT id, canonical_name, person_type, primary_state
                    FROM canonical_persons
                    WHERE person_type = 'enslaver'
                    AND LOWER(canonical_name) = LOWER(${famName})
                    LIMIT 3
                `;

                if (matches.length > 0) {
                    const match = matches[0];
                    stats.matched++;

                    if (DRY_RUN) {
                        console.log(`  ✓ ${dep.full_name} → family "${famName}" matches enslaver "${match.canonical_name}" (${match.primary_state}, id=${match.id})`);
                    } else {
                        // Add enslaved_by relationship
                        const updatedRels = [...rels, {
                            type: 'enslaved_by',
                            name: match.canonical_name,
                            canonical_person_id: match.id,
                            match_source: 'freedmens_bank_family_crossref',
                            confidence: 0.45
                        }];

                        await sql`
                            UPDATE unconfirmed_persons
                            SET relationships = ${JSON.stringify(updatedRels)}::jsonb
                            WHERE lead_id = ${dep.lead_id}
                        `;
                        stats.linked++;
                        console.log(`  ✓ ${dep.full_name} → linked to enslaver "${match.canonical_name}" (${match.primary_state})`);
                    }
                    break; // One enslaver link per depositor is enough
                }
            } catch (err) {
                stats.errors++;
            }
        }

        // Surname match: check if depositor's surname matches an enslaver
        // in the same state (stronger signal than family member name match)
        if (depositorSurname && depositorSurname.length > 2) {
            const location = dep.locations?.[0] || '';
            try {
                const surnameMatches = await sql`
                    SELECT id, canonical_name, primary_state
                    FROM canonical_persons
                    WHERE person_type = 'enslaver'
                    AND LOWER(last_name) = LOWER(${depositorSurname})
                    AND primary_state IS NOT NULL
                    AND LOWER(primary_state) = LOWER(${location.split(',').pop()?.trim() || ''})
                    LIMIT 1
                `;

                if (surnameMatches.length > 0 && !rels.some(r => r.type === 'enslaved_by')) {
                    const m = surnameMatches[0];
                    if (DRY_RUN) {
                        console.log(`  ~ ${dep.full_name} surname "${depositorSurname}" matches enslaver "${m.canonical_name}" in ${m.primary_state} (surname-only, lower confidence)`);
                    }
                    // Don't auto-link surname-only matches — flag for review instead
                }
            } catch (err) {
                // Non-fatal
            }
        }
    }
}

async function main() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  FREEDMEN'S BANK ↔ ENSLAVER CROSS-REFERENCE`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'═'.repeat(60)}`);

    const branchRows = await sql`
        SELECT DISTINCT locations[1] AS branch, COUNT(*)::int AS n
        FROM unconfirmed_persons
        WHERE extraction_method IN ('freedmens_bank_index', 'freedmens_bank_ocr', 'freedmens_bank_scrape')
        AND relationships IS NOT NULL
        AND jsonb_typeof(relationships) = 'array'
        GROUP BY locations[1]
        ORDER BY n DESC
    `;

    console.log(`\n  Branches with family data:`);
    branchRows.forEach(r => console.log(`    ${(r.branch || '?').padEnd(35)} ${r.n} depositors with family`));

    const branches = TARGET_BRANCH ? [TARGET_BRANCH]
        : ALL ? branchRows.map(r => r.branch)
        : [];

    if (branches.length === 0) {
        console.log('\n  Use --branch "Name" or --all');
        process.exit(0);
    }

    for (const branch of branches) {
        await crossRefBranch(branch);
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Examined:  ${stats.examined}`);
    console.log(`  Matched:   ${stats.matched}`);
    console.log(`  Linked:    ${stats.linked}`);
    console.log(`  Errors:    ${stats.errors}`);
    console.log(`  Elapsed:   ${elapsed} min\n`);
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('Fatal:', err.message); process.exit(1); });
