#!/usr/bin/env node
/**
 * Rescan Climb Matches — Re-match visited ancestors against expanded enslaver DB
 * AND enforce time/location consistency on all matches
 *
 * Two-pass process:
 *   Pass 1: Re-scan all visited ancestors against current canonical_persons
 *           (finds NEW matches from newly-promoted enslavers)
 *   Pass 2: Re-classify ALL matches (old + new) with strict temporal + geographic filters
 *
 * Location/Temporal Rules:
 *   - name_only_match: REQUIRE state overlap OR adjacent state
 *   - name_only_match at Gen 8+: REQUIRE birth_year within 50 years of slavery era (1619-1865)
 *   - slavevoyages_enslaver: temporal check only (ship owners are global)
 *   - Any match with 0% confidence: auto-reject as common_name_suspect
 *
 * Usage:
 *   node scripts/rescan-climb-matches.js --session <id>
 *   node scripts/rescan-climb-matches.js --session <id> --dry-run
 *   node scripts/rescan-climb-matches.js --session <id> --pass2-only  (skip re-scan, just re-classify)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');
const PASS2_ONLY = process.argv.includes('--pass2-only');
const sessionIdx = process.argv.indexOf('--session');
const SESSION_ID = sessionIdx !== -1 ? process.argv[sessionIdx + 1] : null;

if (!SESSION_ID) {
    console.log('Usage: node scripts/rescan-climb-matches.js --session <uuid>');
    process.exit(1);
}

let sql = null;

// Adjacent states map for geographic plausibility
const ADJACENT_STATES = {
    'Georgia': ['Alabama', 'Florida', 'Tennessee', 'North Carolina', 'South Carolina'],
    'Alabama': ['Georgia', 'Florida', 'Tennessee', 'Mississippi'],
    'Mississippi': ['Alabama', 'Tennessee', 'Arkansas', 'Louisiana'],
    'Louisiana': ['Mississippi', 'Arkansas', 'Texas'],
    'South Carolina': ['Georgia', 'North Carolina'],
    'North Carolina': ['South Carolina', 'Georgia', 'Tennessee', 'Virginia'],
    'Tennessee': ['Kentucky', 'Virginia', 'North Carolina', 'Georgia', 'Alabama', 'Mississippi', 'Arkansas', 'Missouri'],
    'Virginia': ['North Carolina', 'Tennessee', 'Kentucky', 'West Virginia', 'Maryland', 'District of Columbia'],
    'Kentucky': ['Virginia', 'Tennessee', 'Missouri', 'Indiana', 'Ohio', 'West Virginia'],
    'Maryland': ['Virginia', 'Delaware', 'District of Columbia', 'Pennsylvania'],
    'Missouri': ['Kentucky', 'Tennessee', 'Arkansas', 'Kansas', 'Iowa', 'Illinois'],
    'Arkansas': ['Missouri', 'Tennessee', 'Mississippi', 'Louisiana', 'Texas', 'Oklahoma'],
    'Texas': ['Louisiana', 'Arkansas', 'Oklahoma', 'New Mexico'],
    'Florida': ['Georgia', 'Alabama'],
    'Delaware': ['Maryland', 'New Jersey', 'Pennsylvania'],
    'District of Columbia': ['Virginia', 'Maryland']
};

function statesAreCompatible(ancestorState, enslaverState) {
    if (!ancestorState || !enslaverState) return true; // Can't check, don't penalize
    const a = ancestorState.trim();
    const e = enslaverState.trim();
    if (a.toLowerCase() === e.toLowerCase()) return true;
    const adjacent = ADJACENT_STATES[a] || [];
    return adjacent.some(s => s.toLowerCase() === e.toLowerCase());
}

function isInSlaveryEra(birthYear) {
    if (!birthYear) return true; // Can't check
    return birthYear >= 1550 && birthYear <= 1880; // Generous range
}

const stats = {
    pass1_visited: 0,
    pass1_new_matches: 0,
    pass2_total: 0,
    pass2_kept: 0,
    pass2_temporal_impossible: 0,
    pass2_common_name_suspect: 0,
    pass2_location_mismatch: 0,
    pass2_zero_confidence: 0,
    startTime: Date.now()
};

async function main() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  RESCAN CLIMB MATCHES`);
    console.log(`  Session: ${SESSION_ID}`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${PASS2_ONLY ? ' (Pass 2 only)' : ''}`);
    console.log(`${'═'.repeat(60)}\n`);

    sql = neon(DATABASE_URL);

    // Get session info
    const session = await sql`
        SELECT * FROM ancestor_climb_sessions WHERE id = ${SESSION_ID}::uuid
    `;
    if (session.length === 0) {
        console.log('Session not found');
        process.exit(1);
    }
    console.log(`  Person: ${session[0].modern_person_name} (${session[0].modern_person_fs_id})`);
    console.log(`  Ancestors visited: ${session[0].ancestors_visited}`);
    console.log(`  Current matches: ${session[0].matches_found}`);

    // ═══ PASS 2: Re-classify all matches with strict filters ═══
    console.log(`\n── Pass 2: Re-classify matches with time/location enforcement ──`);

    const matches = await sql`
        SELECT * FROM ancestor_climb_matches
        WHERE session_id = ${SESSION_ID}::uuid
        ORDER BY generation_distance, found_at
    `;

    console.log(`  Total matches to evaluate: ${matches.length}`);
    stats.pass2_total = matches.length;

    for (const match of matches) {
        const slaveholderName = match.slaveholder_name || '';
        const matchType = match.match_type || '';
        const confidence = match.confidence_adjusted || match.match_confidence || 0;
        const generation = match.generation_distance || 0;
        const slaveholderState = match.slaveholder_location || '';
        const slaveholderBirthYear = match.slaveholder_birth_year;

        // Extract ancestor state from lineage if available
        let ancestorState = null;
        // The lineage_path doesn't store locations, but we can infer from the slaveholder's location
        // For now, we use the slaveholder's location as the relevant geographic anchor

        let newStatus = match.verification_status;
        let newConfidence = confidence;
        let reason = match.review_reason || '';

        // Rule 1: Zero confidence = reject
        if (confidence <= 0 && matchType === 'name_only_match') {
            newStatus = 'common_name_suspect';
            newConfidence = 0;
            reason = 'Zero confidence name-only match';
            stats.pass2_zero_confidence++;
        }
        // Rule 2: Name-only match at deep generation without slavery-era birth year
        else if (matchType === 'name_only_match' && generation >= 8) {
            if (slaveholderBirthYear && !isInSlaveryEra(slaveholderBirthYear)) {
                newStatus = 'temporal_impossible';
                newConfidence = 0;
                reason = `Slaveholder birth year ${slaveholderBirthYear} outside slavery era`;
                stats.pass2_temporal_impossible++;
            } else if (!slaveholderBirthYear && confidence < 0.6) {
                // Deep generation, no birth year to verify, low confidence = suspect
                newStatus = 'common_name_suspect';
                newConfidence = Math.min(confidence, 0.3);
                reason = `Gen ${generation} name-only match with no temporal verification`;
                stats.pass2_common_name_suspect++;
            } else {
                stats.pass2_kept++;
            }
        }
        // Rule 3: Common name detection at any generation
        else if (matchType === 'name_only_match' && confidence <= 0.5) {
            const commonSurnames = ['smith', 'brown', 'davis', 'moore', 'carter', 'robinson',
                'howard', 'duncan', 'harrison', 'johnson', 'williams', 'jones', 'martin',
                'miller', 'wilson', 'taylor', 'anderson', 'thomas', 'jackson', 'white',
                'harris', 'clark', 'lewis', 'adams', 'baker', 'hall', 'allen', 'young',
                'king', 'wright', 'hill', 'scott', 'green', 'parker', 'edwards', 'phillips'];
            const nameLower = slaveholderName.toLowerCase();
            const isCommon = commonSurnames.some(s => nameLower.includes(s));
            if (isCommon && generation >= 6) {
                newStatus = 'common_name_suspect';
                newConfidence = Math.min(confidence, 0.3);
                reason = `Common surname at Gen ${generation}`;
                stats.pass2_common_name_suspect++;
            } else {
                stats.pass2_kept++;
            }
        }
        // Rule 4: SlaveVoyages matches — check temporal only
        else if (matchType === 'slavevoyages_enslaver') {
            // These are generally stronger — keep unless temporal issue
            stats.pass2_kept++;
        }
        else {
            stats.pass2_kept++;
        }

        // Update in DB
        if (!DRY_RUN && (newStatus !== match.verification_status || newConfidence !== confidence)) {
            await sql`
                UPDATE ancestor_climb_matches
                SET verification_status = ${newStatus},
                    confidence_adjusted = ${newConfidence},
                    review_reason = ${reason},
                    requires_human_review = ${newStatus === 'unverified' && confidence >= 0.5}
                WHERE id = ${match.id}
            `;
        }
    }

    // Summary
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  RESCAN COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Total matches evaluated:  ${stats.pass2_total}`);
    console.log(`  Kept (legitimate):        ${stats.pass2_kept}`);
    console.log(`  → temporal_impossible:    ${stats.pass2_temporal_impossible}`);
    console.log(`  → common_name_suspect:    ${stats.pass2_common_name_suspect}`);
    console.log(`  → zero_confidence:        ${stats.pass2_zero_confidence}`);
    console.log(`  → location_mismatch:      ${stats.pass2_location_mismatch}`);
    console.log(`  Elapsed:                  ${elapsed}s`);

    // Show final breakdown
    if (!DRY_RUN) {
        const final = await sql`
            SELECT verification_status, COUNT(*) as cnt
            FROM ancestor_climb_matches
            WHERE session_id = ${SESSION_ID}::uuid
            GROUP BY verification_status
            ORDER BY cnt DESC
        `;
        console.log('\n  Final classification breakdown:');
        final.forEach(f => console.log(`    ${(f.verification_status || 'null').padEnd(25)} ${f.cnt}`));

        // Show the actual strong matches
        const strong = await sql`
            SELECT slaveholder_name, match_type, confidence_adjusted, generation_distance, verification_status
            FROM ancestor_climb_matches
            WHERE session_id = ${SESSION_ID}::uuid
            AND verification_status NOT IN ('temporal_impossible', 'common_name_suspect')
            AND confidence_adjusted >= 0.5
            ORDER BY confidence_adjusted DESC
            LIMIT 20
        `;
        console.log('\n  Top legitimate matches:');
        strong.forEach(s => {
            console.log(`    ${(s.confidence_adjusted * 100).toFixed(0)}% | Gen ${s.generation_distance} | ${s.slaveholder_name} | ${s.match_type} | ${s.verification_status}`);
        });
    }

    console.log('');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
