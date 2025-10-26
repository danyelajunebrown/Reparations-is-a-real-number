// init-database.js
// Run this script to initialize the PostgreSQL database with tables and views
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'database-schemas.js');
const schemaContent = fs.readFileSync(schemaPath, 'utf8');

const schemaMatch = schemaContent.match(/const postgresSchema = `([\s\S]+?)`;\s*\/\/ ==================/);

if (!schemaMatch) {
    console.error('❌ Could not extract PostgreSQL schema from database-schemas.js');
    console.error('Make sure the schema is defined as: const postgresSchema = `...`;');
    process.exit(1);
}

const schema = schemaMatch[1];

async function initializeDatabase() {
    console.log('🔧 PostgreSQL Database Initialization');
    console.log('=====================================\n');
    
    const pool = new Pool({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        database: process.env.POSTGRES_DB || 'reparations',
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD
    });

    try {
        console.log('📡 Connecting to PostgreSQL...');
        console.log(`   Host: ${process.env.POSTGRES_HOST || 'localhost'}`);
        console.log(`   Port: ${process.env.POSTGRES_PORT || 5432}`);
        console.log(`   Database: ${process.env.POSTGRES_DB || 'reparations'}`);
        console.log(`   User: ${process.env.POSTGRES_USER}`);
        
        const client = await pool.connect();
        
        console.log('✓ Connected to PostgreSQL\n');
        console.log('🏗️  Creating database schema...\n');
        
        await client.query(schema);
        
        console.log('✅ Database schema initialized successfully!\n');
        
        console.log('📊 Created Tables:');
        console.log('   ✓ documents');
        console.log('   ✓ enslaved_people');
        console.log('   ✓ families');
        console.log('   ✓ family_children');
        console.log('   ✓ verification_reviews');
        console.log('   ✓ reparations_breakdown');
        console.log('   ✓ citations');
        console.log('   ✓ research_gaps');
        console.log('   ✓ document_tags');
        console.log('   ✓ audit_log\n');
        
        console.log('📈 Created Views:');
        console.log('   ✓ owner_summary');
        console.log('   ✓ verification_queue');
        console.log('   ✓ blockchain_queue');
        console.log('   ✓ stats_dashboard\n');
        
        console.log('🔍 Testing database views...');
        const statsResult = await client.query('SELECT * FROM stats_dashboard');
        console.log('   ✓ stats_dashboard view is working');
        console.log(`   📈 Current stats: ${JSON.stringify(statsResult.rows[0])}\n`);
        
        client.release();
        await pool.end();
        
        console.log('✅ Database initialization complete!\n');
        
    } catch (error) {
        console.error('\n❌ Error initializing database:');
        console.error(error.message);
        console.error('\n💡 Troubleshooting:');
        console.error('   1. Make sure PostgreSQL is running');
        console.error('   2. Verify your .env file has correct credentials');
        console.error('   3. Check if the database exists\n');
        process.exit(1);
    }
}

console.log('🚀 Starting database initialization...\n');
initializeDatabase();
