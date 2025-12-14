/**
 * Run Migration 013: Slave Owner Descendant Mapping System
 * 
 * This script runs the migration using the existing database connection,
 * avoiding psql SSL/authentication issues.
 */

const fs = require('fs');
const path = require('path');
const db = require('../database.js');

async function runMigration013() {
    console.log('========================================');
    console.log('Running Migration 013: Slave Owner Descendant Mapping');
    console.log('========================================\n');

    try {
        // Read the migration file
        const migrationPath = path.join(__dirname, '../migrations/013-slave-owner-descendant-mapping.sql');
        console.log(`Reading migration from: ${migrationPath}`);
        
        const sql = fs.readFileSync(migrationPath, 'utf8');
        console.log(`Migration file loaded (${sql.length} characters)\n`);

        // Execute the migration
        console.log('Executing migration...');
        const startTime = Date.now();
        
        await db.query(sql);
        
        const duration = Date.now() - startTime;
        console.log(`✅ Migration completed successfully in ${duration}ms\n`);

        // Verify tables were created
        console.log('Verifying tables...');
        const tableCheck = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN (
                'slave_owner_descendants_suspected',
                'slave_owner_descendants_confirmed',
                'descendant_debt_assignments',
                'government_debt_obligations'
            )
            ORDER BY table_name
        `);

        console.log('\nTables created:');
        tableCheck.rows.forEach(row => {
            console.log(`  ✓ ${row.table_name}`);
        });

        // Verify views were created
        console.log('\nVerifying views...');
        const viewCheck = await db.query(`
            SELECT table_name 
            FROM information_schema.views 
            WHERE table_schema = 'public' 
            AND table_name IN (
                'living_descendants_with_debt',
                'government_obligations_by_level',
                'descendant_research_progress',
                'optin_conversion_funnel'
            )
            ORDER BY table_name
        `);

        console.log('\nViews created:');
        viewCheck.rows.forEach(row => {
            console.log(`  ✓ ${row.table_name}`);
        });

        // Show index count
        const indexCheck = await db.query(`
            SELECT COUNT(*) as index_count
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename IN (
                'slave_owner_descendants_suspected',
                'slave_owner_descendants_confirmed',
                'descendant_debt_assignments',
                'government_debt_obligations'
            )
        `);

        console.log(`\nIndexes created: ${indexCheck.rows[0].index_count}`);

        console.log('\n========================================');
        console.log('✅ Migration 013 Complete!');
        console.log('========================================');
        console.log('\nNew capabilities:');
        console.log('  • Slave owner descendant tracking (private)');
        console.log('  • Descendant opt-in system (public with consent)');
        console.log('  • Debt assignments to verified descendants');
        console.log('  • Government debt obligations tracking');
        console.log('  • 4 analytical views for reporting');
        console.log('  • Privacy-first design (living descendants protected)');
        console.log('\nReady for:');
        console.log('  1. DescendantMapper service development');
        console.log('  2. Opt-in portal creation');
        console.log('  3. FamilySearch genealogy integration');
        console.log('  4. Pilot with documented families\n');

    } catch (error) {
        console.error('\n❌ Migration failed!');
        console.error('Error:', error.message);
        console.error('\nFull error:');
        console.error(error);
        process.exit(1);
    } finally {
        // Close database connection
        await db.end();
    }
}

// Run the migration
runMigration013().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
