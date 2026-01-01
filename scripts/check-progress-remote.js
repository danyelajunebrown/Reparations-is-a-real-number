#!/usr/bin/env node
/**
 * CHECK SCRAPER PROGRESS REMOTELY
 *
 * Run this from ANY computer with Node.js to check progress:
 *   node check-progress-remote.js
 *
 * Or run directly (no install needed):
 *   npx -y @neondatabase/serverless && node check-progress-remote.js
 */

const DATABASE_URL = 'postgresql://neondb_owner:npg_2S8LrhzkZmad@ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function checkProgress() {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(DATABASE_URL);

    console.log('\n========================================================================');
    console.log('  1860 SLAVE SCHEDULE SCRAPER - PROGRESS CHECK');
    console.log('  Checked at:', new Date().toLocaleString());
    console.log('========================================================================\n');

    // Records per day (last 7 days)
    const daily = await sql`
        SELECT
            DATE(created_at) as date,
            COUNT(*) as records
        FROM unconfirmed_persons
        WHERE source_url LIKE '%1860%Slave%'
        AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
    `;

    console.log('📊 Records extracted per day (last 7 days):');
    if (daily.length === 0) {
        console.log('   No records in last 7 days');
    } else {
        daily.forEach(row => {
            console.log(`   ${row.date}: ${row.records} records`);
        });
    }

    // Total records
    const total = await sql`
        SELECT COUNT(*) as total
        FROM unconfirmed_persons
        WHERE source_url LIKE '%1860%Slave%'
    `;
    console.log('\n📈 Total 1860 Slave Schedule records:', total[0].total);

    // Records in last hour (is it running?)
    const recent = await sql`
        SELECT COUNT(*) as count
        FROM unconfirmed_persons
        WHERE source_url LIKE '%1860%Slave%'
        AND created_at > NOW() - INTERVAL '1 hour'
    `;

    const lastHour = parseInt(recent[0].count);
    if (lastHour > 0) {
        console.log(`\n✅ SCRAPER IS ACTIVE - ${lastHour} records in last hour`);
    } else {
        console.log('\n⚠️  No records in last hour - scraper may be stopped or between runs');
    }

    // By state
    const byState = await sql`
        SELECT
            SPLIT_PART(SPLIT_PART(source_url, '> ', 2), ' >', 1) as state,
            COUNT(*) as records
        FROM unconfirmed_persons
        WHERE source_url LIKE '%1860%Slave%'
        GROUP BY state
        ORDER BY records DESC
        LIMIT 10
    `;

    console.log('\n📍 Records by state:');
    byState.forEach(row => {
        if (row.state) {
            console.log(`   ${row.state}: ${row.records}`);
        }
    });

    console.log('\n========================================================================\n');
}

checkProgress().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
