require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runMigration() {
    console.log('Running migration 017: Create documents table...');
    
    try {
        const migrationSQL = fs.readFileSync(
            path.join(__dirname, '../migrations/017-create-documents-table.sql'),
            'utf8'
        );
        
        await pool.query(migrationSQL);
        console.log('✓ Migration 017 completed successfully');
        
        // Verify table was created
        const check = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'documents'
            ORDER BY ordinal_position
            LIMIT 10
        `);
        
        console.log(`\n✓ Documents table created with ${check.rows.length}+ columns`);
        console.log('Sample columns:', check.rows.map(r => r.column_name).join(', '));
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

runMigration();
