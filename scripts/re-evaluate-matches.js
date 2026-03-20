#!/usr/bin/env node
/**
 * Retroactive Match Re-evaluation Script
 *
 * Re-evaluates ALL existing ancestor_climb_matches using the MatchVerifier
 * race-aware verification pipeline. Updates classifications, flags ambiguous
 * cases for human review, and prints a summary report.
 *
 * Usage:
 *   node scripts/re-evaluate-matches.js                  # All matches
 *   node scripts/re-evaluate-matches.js --session <id>   # Specific session
 *   node scripts/re-evaluate-matches.js --dry-run        # Preview without updating
 *
 * Requires: migration 034 applied to DB
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');

const MatchVerifier = require('../src/services/match-verification');

const sql = neon(process.env.DATABASE_URL);
const verifier = new MatchVerifier(sql);

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sessionIdx = args.indexOf('--session');
const sessionFilter = sessionIdx !== -1 ? args[sessionIdx + 1] : null;

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   MATCH RE-EVALUATION — Race-Aware Verification Pipeline');
    console.log('═══════════════════════════════════════════════════════════════');
    if (dryRun) console.log('   MODE: DRY RUN (no DB updates)');
    if (sessionFilter) console.log(`   SESSION: ${sessionFilter}`);
    console.log('');

    // Fetch all matches
    let matches;
    if (sessionFilter) {
        matches = await sql`
            SELECT m.*, s.modern_person_name as start_person_name, s.modern_person_fs_id as start_person_fs_id
            FROM ancestor_climb_matches m
            LEFT JOIN ancestor_climb_sessions s ON m.session_id = s.id
            WHERE m.session_id = ${sessionFilter}::uuid
            ORDER BY m.generation_distance, m.found_at
        `;
    } else {
        matches = await sql`
            SELECT m.*, s.modern_person_name as start_person_name, s.modern_person_fs_id as start_person_fs_id
            FROM ancestor_climb_matches m
            LEFT JOIN ancestor_climb_sessions s ON m.session_id = s.id
            ORDER BY m.generation_distance, m.found_at
        `;
    }

    console.log(`Found ${matches.length} matches to re-evaluate.\n`);

    // Track statistics
    const stats = {
        total: matches.length,
        reclassified: 0,
        unchanged: 0,
        errors: 0,
        by_classification: {},
        needs_review: 0,
        by_session: {}
    };

    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];

        // Construct ancestor object from stored fields
        const ancestor = {
            name: match.slaveholder_name,
            birth_year: match.slaveholder_birth_year,
            fs_id: match.slaveholder_fs_id,
            locations: match.slaveholder_location ? [match.slaveholder_location] : [],
            race_indicators: [],
            occupation: null
        };

        // Construct candidateMatch object
        const candidateMatch = {
            canonical_name: match.slaveholder_name,
            slaveholder_name: match.slaveholder_name,
            slaveholder_fs_id: match.slaveholder_fs_id,
            birth_year_estimate: match.slaveholder_birth_year,
            slaveholder_birth_year: match.slaveholder_birth_year,
            confidence: parseFloat(match.match_confidence) || 0.50,
            match_confidence: parseFloat(match.match_confidence) || 0.50,
            type: match.match_type,
            fs_id: match.slaveholder_fs_id
        };

        const generation = match.generation_distance || 0;

        try {
            const verdict = await verifier.verify(ancestor, candidateMatch, generation);

            const oldClassification = match.classification || 'debt';
            const newClassification = verdict.classification;
            const changed = oldClassification !== newClassification;

            if (changed) stats.reclassified++;
            else stats.unchanged++;

            stats.by_classification[newClassification] = (stats.by_classification[newClassification] || 0) + 1;
            if (verdict.requires_human_review) stats.needs_review++;

            const sessionKey = match.start_person_name || match.session_id;
            if (!stats.by_session[sessionKey]) {
                stats.by_session[sessionKey] = { total: 0, reclassified: 0 };
            }
            stats.by_session[sessionKey].total++;
            if (changed) stats.by_session[sessionKey].reclassified++;

            // Print per-match detail
            const marker = changed ? '→' : '=';
            const reviewFlag = verdict.requires_human_review ? ' [REVIEW]' : '';
            console.log(`  [${i + 1}/${matches.length}] ${match.slaveholder_name} (Gen ${generation}, ${(candidateMatch.confidence * 100).toFixed(0)}%): ${oldClassification} ${marker} ${newClassification} (adj: ${(verdict.confidence_adjusted * 100).toFixed(0)}%)${reviewFlag}`);

            if (verdict.evidence.length > 0) {
                for (const e of verdict.evidence) {
                    const prefix = e.type === 'disqualifying' ? '      ✗' : '      ✓';
                    console.log(`${prefix} ${e.detail}`);
                }
            }

            // Update DB
            if (!dryRun && changed) {
                try {
                    await sql`
                        UPDATE ancestor_climb_matches
                        SET classification = ${verdict.classification},
                            classification_reason = ${verdict.evidence.map(e => e.detail).join('; ') || 'Re-evaluated'},
                            verification_status = ${verdict.requires_human_review ? 'needs_review' : 'auto_verified'},
                            verification_evidence = ${JSON.stringify(verdict.evidence)},
                            confidence_adjusted = ${verdict.confidence_adjusted},
                            requires_human_review = ${verdict.requires_human_review},
                            review_reason = ${verdict.review_reason}
                        WHERE id = ${match.id}
                    `;
                } catch (updateErr) {
                    console.log(`      ⚠ Update failed: ${updateErr.message.substring(0, 80)}`);
                    stats.errors++;
                }
            }

        } catch (err) {
            console.log(`  [${i + 1}/${matches.length}] ERROR: ${match.slaveholder_name} — ${err.message.substring(0, 80)}`);
            stats.errors++;
        }
    }

    // Print summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   RE-EVALUATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Total matches:     ${stats.total}`);
    console.log(`Reclassified:      ${stats.reclassified}`);
    console.log(`Unchanged:         ${stats.unchanged}`);
    console.log(`Errors:            ${stats.errors}`);
    console.log(`Needs human review: ${stats.needs_review}`);
    console.log('');
    console.log('By classification:');
    for (const [cls, count] of Object.entries(stats.by_classification).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${cls.padEnd(25)} ${count}`);
    }
    console.log('');
    console.log('By session:');
    for (const [session, data] of Object.entries(stats.by_session)) {
        console.log(`  ${session}: ${data.total} matches, ${data.reclassified} reclassified`);
    }
    if (dryRun) {
        console.log('\n⚠ DRY RUN — no changes were written to the database.');
        console.log('  Run without --dry-run to apply changes.');
    }
    console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
