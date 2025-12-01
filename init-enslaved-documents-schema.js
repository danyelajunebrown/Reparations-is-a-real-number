#!/usr/bin/env node
/**
 * Initialize Enslaved-Person-Primary Documents Schema
 * Allows documents to be indexed to enslaved people directly
 *
 * Usage: node init-enslaved-documents-schema.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'database-schema-enslaved-documents.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

async function initializeSchema() {
  console.log('Enslaved-Person Documents Schema Initialization');
  console.log('================================================\n');

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
    console.log('   * documents.owner_name is now nullable');
    console.log('   * documents.primary_subject_type (owner/enslaved)');
    console.log('   * documents.enslaved_individual_id');
    console.log('   * enslaved_individuals.spouse_name');
    console.log('   * enslaved_person_documents view\n');

    // Test the view
    const viewResult = await client.query('SELECT COUNT(*) FROM enslaved_person_documents');
    console.log(`✓ View is working (${viewResult.rows[0].count} enslaved-person documents)\n`);

    client.release();
    await pool.end();

    console.log('Schema is ready for enslaved-person-primary documents!\n');
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
