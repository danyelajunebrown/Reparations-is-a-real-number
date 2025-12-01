#!/usr/bin/env node
/**
 * Initialize Enslaved Individuals Metadata Schema
 * Adds fields for alternative names, middle name, child names, FamilySearch ID
 *
 * Usage: node init-enslaved-metadata-schema.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'database-schema-enslaved-metadata.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

async function initializeSchema() {
  console.log('Enslaved Individuals Metadata Schema Initialization');
  console.log('===================================================\n');

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

    console.log('Applying schema changes...\n');
    await client.query(schema);
    console.log('✓ Schema updated successfully!\n');

    console.log('Changes applied:');
    console.log('   * enslaved_individuals.alternative_names (TEXT[])');
    console.log('   * enslaved_individuals.middle_name (VARCHAR)');
    console.log('   * enslaved_individuals.child_names (TEXT[])');
    console.log('   * enslaved_individuals.spouse_name (VARCHAR)');
    console.log('   * Indexes for search optimization');
    console.log('   * Timestamp trigger for updated_at\n');

    // Test the changes
    const testResult = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'enslaved_individuals'
        AND column_name IN ('alternative_names', 'middle_name', 'child_names', 'spouse_name')
    `);

    console.log(`✓ Verified ${testResult.rows.length} new columns added\n`);

    client.release();
    await pool.end();

    console.log('Schema is ready for enhanced metadata!\n');
    process.exit(0);
  } catch (error) {
    console.error('Error applying schema:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  initializeSchema();
}

module.exports = initializeSchema;
