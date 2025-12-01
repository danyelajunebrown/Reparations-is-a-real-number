#!/usr/bin/env node
/**
 * Initialize OCR Comparison Schema
 * Run this after init-database.js to add OCR comparison tracking
 *
 * Usage: node init-ocr-comparisons-schema.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'database-schema-ocr-comparisons.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

async function initializeOCRSchema() {
  console.log('OCR Comparison Schema Initialization');
  console.log('=====================================\n');

  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'reparations',
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD
  });

  try {
    console.log('Connecting to PostgreSQL...');
    const client = await pool.connect();
    console.log('✓ Connected\n');

    // Check if OCR comparisons table already exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'ocr_comparisons'
      );
    `);

    if (tableCheck.rows[0].exists) {
      console.log('INFO: OCR comparisons table already exists\n');
    } else {
      console.log('Creating OCR comparison schema...\n');
      await client.query(schema);
      console.log('✓ OCR comparison schema created successfully!\n');
    }

    console.log('Created/Verified:');
    console.log('   * ocr_comparisons table');
    console.log('   * ocr_performance_stats view');
    console.log('   * recent_ocr_comparisons view\n');

    // Test the views
    const statsResult = await client.query('SELECT * FROM ocr_performance_stats');
    console.log(`✓ Views are working (${statsResult.rows.length} document types tracked)\n`);

    client.release();
    await pool.end();

    console.log('OCR comparison schema is ready!\n');
    process.exit(0);
  } catch (error) {
    console.error('Error initializing OCR comparison schema:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  initializeOCRSchema();
}

module.exports = initializeOCRSchema;
