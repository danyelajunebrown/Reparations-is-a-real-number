// Quick database diagnostic script
require('dotenv').config();
const database = require('./database');

async function checkDatabase() {
    console.log('🔍 Database Diagnostic Check\n');
    console.log('================================\n');

    try {
        // 1. Check database connection
        console.log('1. Testing database connection...');
        const health = await database.checkHealth();
        console.log(`   ✅ Database health: ${health.healthy ? 'CONNECTED' : 'DISCONNECTED'}\n`);

        if (!health.healthy) {
            console.error('   ❌ Database connection failed!');
            console.error('   Error:', health.error);
            process.exit(1);
        }

        // 2. Check if tables exist
        console.log('2. Checking if tables exist...');
        const tableCheck = await database.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name IN ('documents', 'enslaved_people', 'individuals')
            ORDER BY table_name
        `);

        if (tableCheck.rows.length === 0) {
            console.log('   ❌ NO TABLES FOUND!');
            console.log('   Run: npm run init-db\n');
            process.exit(1);
        }

        console.log(`   ✅ Found ${tableCheck.rows.length} tables:`);
        tableCheck.rows.forEach(row => {
            console.log(`      - ${row.table_name}`);
        });
        console.log('');

        // 3. Check if stats_dashboard view exists
        console.log('3. Checking if stats_dashboard view exists...');
        const viewCheck = await database.query(`
            SELECT table_name
            FROM information_schema.views
            WHERE table_schema = 'public'
            AND table_name = 'stats_dashboard'
        `);

        if (viewCheck.rows.length === 0) {
            console.log('   ❌ stats_dashboard view NOT FOUND!');
            console.log('   Run: npm run init-db\n');
            process.exit(1);
        }
        console.log('   ✅ stats_dashboard view exists\n');

        // 4. Get current statistics
        console.log('4. Querying database statistics...');
        const stats = await database.getStats();

        if (!stats) {
            console.log('   ⚠️  stats_dashboard returned no data (empty database)\n');
        } else {
            console.log('   📊 Current Statistics:');
            console.log(`      Documents: ${stats.total_documents || 0}`);
            console.log(`      Unique Owners: ${stats.unique_owners || 0}`);
            console.log(`      Enslaved People: ${stats.total_enslaved_counted || 0}`);
            console.log(`      Total Reparations: $${stats.total_reparations_calculated || 0}`);
            console.log('');
        }

        // 5. Check documents table directly
        console.log('5. Checking documents table directly...');
        const docCount = await database.query('SELECT COUNT(*) as count FROM documents');
        console.log(`   📄 Documents in table: ${docCount.rows[0].count}\n`);

        if (parseInt(docCount.rows[0].count) === 0) {
            console.log('   ⚠️  No documents found in database!');
            console.log('   This means uploads are not being saved.\n');
        }

        // 6. Show recent documents if any
        if (parseInt(docCount.rows[0].count) > 0) {
            console.log('6. Recent documents:');
            const recentDocs = await database.query(`
                SELECT document_id, owner_name, doc_type, total_enslaved, created_at
                FROM documents
                ORDER BY created_at DESC
                LIMIT 5
            `);

            recentDocs.rows.forEach(doc => {
                console.log(`   - ${doc.owner_name} (${doc.doc_type}): ${doc.total_enslaved} enslaved - ${doc.created_at}`);
            });
            console.log('');
        }

        console.log('✅ Database diagnostic complete!\n');

    } catch (error) {
        console.error('❌ Diagnostic error:', error.message);
        console.error(error);
        process.exit(1);
    }

    process.exit(0);
}

checkDatabase();
