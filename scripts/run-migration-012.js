/**
 * Run Migration 012: Business Proceeds Calculations
 */

const fs = require('fs');
const path = require('path');
const db = require('../database.js');

async function runMigration012() {
    console.log('========================================');
    console.log('Running Migration 012: Business Proceeds Calculations');
    console.log('========================================\n');

    try {
        const migrationPath = path.join(__dirname, '../migrations/012-business-proceeds-calculations.sql');
        console.log(`Reading migration from: ${migrationPath}`);
        
        const sql = fs.readFileSync(migrationPath, 'utf8');
        console.log(`Migration file loaded (${sql.length} characters)\n`);

        console.log('Executing migration...');
        const startTime = Date.now();
        
        await db.query(sql);
        
        const duration = Date.now() - startTime;
        console.log(`✅ Migration completed successfully in ${duration}ms\n`);

        // Verify tables
        const tableCheck = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN (
                'business_asset_records',
                'proceeds_calculation_methods',
                'proceeds_research_needed',
                'calculated_reparations'
            )
            ORDER BY table_name
        `);

        console.log('Tables created:');
        tableCheck.rows.forEach(row => {
            console.log(`  ✓ ${row.table_name}`);
        });

        console.log('\n✅ Migration 012 Complete!\n');

    } catch (error) {
        console.error('\n❌ Migration failed!');
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        await db.end();
    }
}

runMigration012().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
