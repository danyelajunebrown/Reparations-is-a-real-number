require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const FS_IDS_TO_CHECK = [
    // Eli's grandparents
    { who: 'Eli — pat_grandfather William Cecil Fagan', fs: 'KG29-DW6' },
    { who: 'Eli — pat_grandmother Mary Catherine Richard', fs: 'M8G1-P86' },
    { who: 'Eli — mat_grandfather Edward Joseph Schwehr', fs: 'GQ5M-G1L' },
    { who: 'Eli — mat_grandmother Gwendolyn Louise Fagan', fs: 'LX39-1MY' },
    // Piper
    { who: 'Piper', fs: 'LTVZ-D9S' },
];

(async () => {
    for (const item of FS_IDS_TO_CHECK) {
        console.log(`\n──────────────────────────────────────────────────────────────`);
        console.log(`  ${item.who}  [${item.fs}]`);
        console.log(`──────────────────────────────────────────────────────────────`);

        const sessions = await sql`
            SELECT id, modern_person_name, modern_person_fs_id, status, ancestors_visited, matches_found, started_at
            FROM ancestor_climb_sessions
            WHERE modern_person_fs_id = ${item.fs}
            ORDER BY started_at DESC
        `;
        if (sessions.length === 0) {
            console.log('  (no climb sessions for this FS ID)');
            continue;
        }
        for (const s of sessions) {
            console.log(`  ${s.started_at?.toISOString?.()?.slice(0,10)}  ${s.status.padEnd(10)} visited=${s.ancestors_visited} matched=${s.matches_found}`);
        }

        for (const s of sessions.filter(x => x.status === 'completed')) {
            const inline = await sql`
                SELECT all_matches FROM ancestor_climb_sessions WHERE id = ${s.id}::uuid AND all_matches IS NOT NULL
            `;
            const matches = await sql`
                SELECT slaveholder_name, slaveholder_fs_id, generation_distance, lineage_path, classification
                FROM ancestor_climb_matches
                WHERE session_id = ${s.id}::uuid
                ORDER BY generation_distance ASC
            `;
            console.log(`\n  Session ${s.id.slice(0,8)} matches (${matches.length}):`);
            for (const m of matches.slice(0, 25)) {
                const lineage = Array.isArray(m.lineage_path) ? m.lineage_path.slice(0, 5).join(' → ') : '';
                console.log(`    Gen ${m.generation_distance}: ${m.slaveholder_name} (${m.classification})`);
                if (lineage) console.log(`        ${lineage}`);
            }
            if (inline[0]?.all_matches?.length) {
                const ancestors = [...new Set(
                    inline[0].all_matches.map(m => m?.person?.name).filter(Boolean)
                )];
                console.log(`\n  Ancestors visited (${ancestors.length} unique, first 30 shown):`);
                for (const a of ancestors.slice(0, 30)) console.log(`    - ${a}`);
            }
        }
    }
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
