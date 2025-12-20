#!/usr/bin/env node
/**
 * Run migration 024: Ancestor Climb Sessions
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');

async function runMigration() {
    const sql = neon(process.env.DATABASE_URL);

    console.log('Running migration 024-ancestor-climb-sessions.sql...\n');

    // Table 1: ancestor_climb_sessions
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS ancestor_climb_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                modern_person_name TEXT NOT NULL,
                modern_person_fs_id TEXT NOT NULL,
                status TEXT DEFAULT 'in_progress',
                started_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP,
                last_activity TIMESTAMP DEFAULT NOW(),
                ancestors_visited INTEGER DEFAULT 0,
                max_generation_reached INTEGER DEFAULT 0,
                matches_found INTEGER DEFAULT 0,
                current_queue JSONB DEFAULT '[]'::jsonb,
                visited_set TEXT[] DEFAULT ARRAY[]::TEXT[],
                all_matches JSONB DEFAULT '[]'::jsonb,
                config JSONB DEFAULT '{}'::jsonb,
                last_error TEXT,
                error_count INTEGER DEFAULT 0,
                created_by TEXT DEFAULT 'ancestor_climber',
                notes TEXT
            )
        `;
        console.log('✓ Created ancestor_climb_sessions table');
    } catch (e) {
        console.log('○ ancestor_climb_sessions:', e.message.substring(0, 60));
    }

    // Table 2: ancestor_climb_matches
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS ancestor_climb_matches (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES ancestor_climb_sessions(id) ON DELETE CASCADE,
                modern_person_name TEXT NOT NULL,
                modern_person_fs_id TEXT NOT NULL,
                slaveholder_id INTEGER,
                slaveholder_name TEXT NOT NULL,
                slaveholder_fs_id TEXT,
                slaveholder_birth_year INTEGER,
                slaveholder_location TEXT,
                generation_distance INTEGER NOT NULL,
                lineage_path TEXT[] NOT NULL,
                lineage_path_fs_ids TEXT[],
                match_type TEXT,
                match_confidence DECIMAL(3,2),
                classification TEXT NOT NULL DEFAULT 'debt',
                classification_reason TEXT,
                credit_amount DECIMAL(20,2) DEFAULT 0,
                debt_amount DECIMAL(20,2) DEFAULT 0,
                net_amount DECIMAL(20,2) DEFAULT 0,
                verified BOOLEAN DEFAULT false,
                verified_by TEXT,
                verified_at TIMESTAMP,
                found_at TIMESTAMP DEFAULT NOW(),
                notes TEXT
            )
        `;
        console.log('✓ Created ancestor_climb_matches table');
    } catch (e) {
        console.log('○ ancestor_climb_matches:', e.message.substring(0, 60));
    }

    // Indexes
    const indexes = [
        ['idx_acs_status', 'CREATE INDEX IF NOT EXISTS idx_acs_status ON ancestor_climb_sessions(status)'],
        ['idx_acs_modern_person', 'CREATE INDEX IF NOT EXISTS idx_acs_modern_person ON ancestor_climb_sessions(modern_person_fs_id)'],
        ['idx_acs_started_at', 'CREATE INDEX IF NOT EXISTS idx_acs_started_at ON ancestor_climb_sessions(started_at DESC)'],
        ['idx_acm_session', 'CREATE INDEX IF NOT EXISTS idx_acm_session ON ancestor_climb_matches(session_id)'],
        ['idx_acm_modern_person', 'CREATE INDEX IF NOT EXISTS idx_acm_modern_person ON ancestor_climb_matches(modern_person_fs_id)'],
        ['idx_acm_slaveholder_name', 'CREATE INDEX IF NOT EXISTS idx_acm_slaveholder_name ON ancestor_climb_matches(slaveholder_name)'],
        ['idx_acm_classification', 'CREATE INDEX IF NOT EXISTS idx_acm_classification ON ancestor_climb_matches(classification)'],
    ];

    for (const [name, ddl] of indexes) {
        try {
            await sql.query(ddl);
            console.log(`✓ Created index ${name}`);
        } catch (e) {
            console.log(`○ Index ${name}: ${e.message.substring(0, 40)}`);
        }
    }

    // Verify tables exist
    const tables = await sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN ('ancestor_climb_sessions', 'ancestor_climb_matches')
    `;
    console.log('\n✓ Tables verified:', tables.map(t => t.table_name).join(', '));
}

runMigration().catch(e => {
    console.error('Fatal error:', e.message);
    process.exit(1);
});
