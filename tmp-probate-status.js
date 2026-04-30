require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
    // Adrian's session matches that AREN'T common_name_suspect or temporal_impossible
    const matches = await sql`
        SELECT slaveholder_name, slaveholder_fs_id, classification, verification_status, requires_human_review
        FROM ancestor_climb_matches
        WHERE session_id = 'f4a5b049-30dc-437f-8d55-fe5d68d42115'::uuid
          AND (classification IS NULL
               OR classification NOT IN ('temporal_impossible', 'common_name_suspect'))
        ORDER BY classification, slaveholder_name
    `;
    console.log(`=== Adrian session matches that would be in DAA gate scope (${matches.length}) ===`);
    for (const m of matches) console.log(`  ${m.classification?.padEnd(20)} ${m.slaveholder_name}`);

    // For each unique name, what evidence exists?
    const names = [...new Set(matches.map(m => (m.slaveholder_name || '').toLowerCase().trim()))].filter(Boolean);
    if (names.length) {
        const evidence = await sql`
            SELECT cp.id, cp.canonical_name, cp.person_type,
                   (SELECT COUNT(*)::int FROM land_transfer_events lte
                    WHERE lte.enslaver_person_id = cp.id AND lte.implicates_enslaver=TRUE) AS tier_a,
                   (SELECT COUNT(*)::int FROM person_documents pd
                    WHERE pd.canonical_person_id = cp.id
                      AND LOWER(COALESCE(pd.document_type,'')) IN
                          ('will','probate','administration','guardianship','deed',
                           'compensation_petition','dc_compensation_petition',
                           'compensated_emancipation_petition','dc_petition','petition',
                           'estate_inventory')) AS tier_b_probate,
                   (SELECT COUNT(*)::int FROM person_documents pd
                    WHERE pd.canonical_person_id = cp.id) AS tier_b_total,
                   (SELECT COUNT(*)::int FROM family_relationships fr
                    WHERE LOWER(fr.person1_name) = LOWER(cp.canonical_name)
                      AND fr.relationship_type = 'enslaved_by') AS tier_c
            FROM canonical_persons cp
            WHERE LOWER(cp.canonical_name) = ANY(${names}::text[])
            ORDER BY canonical_name, person_type
        `;
        console.log('\n=== probate gate evidence per canonical_persons row ===');
        console.log('   ✓/✗  | name                                    | A=lte B-probate B-total C-fr');
        for (const r of evidence) {
            const passes = r.tier_a > 0 || r.tier_b_probate > 0 || r.tier_c > 0;
            console.log(`  ${passes ? '✓' : '✗'}    | ${r.canonical_name.padEnd(40).slice(0,40)} | ${String(r.tier_a).padStart(3)} ${String(r.tier_b_probate).padStart(8)} ${String(r.tier_b_total).padStart(7)} ${String(r.tier_c).padStart(4)}`);
        }
    }
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
