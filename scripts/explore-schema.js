const { Pool } = require('pg');
require('dotenv').config({ path: '/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main/.env' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function explore() {
    console.log('DATABASE SCHEMA EXPLORATION\n');
    console.log('='.repeat(80));

    // Get all tables
    const tables = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `);

    console.log('\n1. ALL TABLES:\n');
    for (const t of tables.rows) {
        const count = await pool.query('SELECT COUNT(*) FROM "' + t.table_name + '"');
        console.log('   ' + t.table_name + ': ' + parseInt(count.rows[0].count).toLocaleString() + ' records');
    }

    // Explore unconfirmed_persons types
    console.log('\n2. UNCONFIRMED_PERSONS - person_type breakdown:\n');
    const upTypes = await pool.query(`
        SELECT person_type, COUNT(*) as count
        FROM unconfirmed_persons
        GROUP BY person_type
        ORDER BY count DESC
    `);
    for (const r of upTypes.rows) {
        console.log('   ' + (r.person_type || 'NULL') + ': ' + parseInt(r.count).toLocaleString());
    }

    // Explore canonical_persons
    console.log('\n3. CANONICAL_PERSONS - person_type breakdown:\n');
    const cpTypes = await pool.query(`
        SELECT person_type, COUNT(*) as count
        FROM canonical_persons
        GROUP BY person_type
        ORDER BY count DESC
    `);
    for (const r of cpTypes.rows) {
        console.log('   ' + (r.person_type || 'NULL') + ': ' + parseInt(r.count).toLocaleString());
    }

    // Explore enslaved_individuals
    console.log('\n4. ENSLAVED_INDIVIDUALS - columns:\n');
    const eiCols = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'enslaved_individuals'
        ORDER BY ordinal_position
    `);
    for (const c of eiCols.rows) {
        console.log('   ' + c.column_name + ' (' + c.data_type + ')');
    }

    // Check enslaved_individuals sample
    console.log('\n5. ENSLAVED_INDIVIDUALS sample records:\n');
    const eiSample = await pool.query(`
        SELECT id, full_name, owner_name, birth_year, death_year, location
        FROM enslaved_individuals
        LIMIT 5
    `);
    for (const r of eiSample.rows) {
        console.log('   ' + r.id + ': ' + r.full_name + ' | Owner: ' + (r.owner_name || 'unknown') + ' | ' + (r.location || 'no location'));
    }

    // Check canonical_persons for owners/slaveholders
    console.log('\n6. CANONICAL_PERSONS - slaveholders sample:\n');
    const cpOwners = await pool.query(`
        SELECT id, canonical_name, person_type, notes
        FROM canonical_persons
        WHERE person_type IN ('slaveholder', 'owner', 'slave_owner')
        LIMIT 5
    `);
    for (const r of cpOwners.rows) {
        console.log('   ' + r.id + ': ' + r.canonical_name + ' (' + r.person_type + ')');
        if (r.notes) console.log('      Notes: ' + r.notes.substring(0, 80) + '...');
    }

    // Check canonical_persons columns
    console.log('\n7. CANONICAL_PERSONS - columns:\n');
    const cpCols = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'canonical_persons'
        ORDER BY ordinal_position
    `);
    for (const c of cpCols.rows) {
        console.log('   ' + c.column_name + ' (' + c.data_type + ')');
    }

    // Check views
    console.log('\n8. VIEWS:\n');
    const views = await pool.query(`
        SELECT table_name
        FROM information_schema.views
        WHERE table_schema = 'public'
    `);
    for (const v of views.rows) {
        console.log('   ' + v.table_name);
    }

    // Check documents table
    console.log('\n9. DOCUMENTS table sample:\n');
    const docs = await pool.query(`
        SELECT document_id, owner_name, doc_type, title
        FROM documents
        LIMIT 5
    `);
    for (const d of docs.rows) {
        console.log('   ' + d.document_id + ': ' + (d.owner_name || 'no owner') + ' - ' + (d.doc_type || 'unknown type'));
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY - Entity Sources for Chat Search:\n');

    const summary = await pool.query(`
        SELECT 'unconfirmed_persons' as source, COUNT(*) as total,
               COUNT(*) FILTER (WHERE person_type = 'enslaved') as enslaved,
               COUNT(*) FILTER (WHERE person_type IN ('owner', 'slaveholder')) as owners
        FROM unconfirmed_persons
        UNION ALL
        SELECT 'enslaved_individuals', COUNT(*), COUNT(*), 0
        FROM enslaved_individuals
        UNION ALL
        SELECT 'canonical_persons', COUNT(*),
               COUNT(*) FILTER (WHERE person_type = 'enslaved'),
               COUNT(*) FILTER (WHERE person_type IN ('slaveholder', 'owner'))
        FROM canonical_persons
    `);

    console.log('Source                  | Total    | Enslaved | Owners');
    console.log('-'.repeat(60));
    for (const r of summary.rows) {
        console.log(r.source.padEnd(24) + '| ' +
                   r.total.toString().padEnd(9) + '| ' +
                   r.enslaved.toString().padEnd(9) + '| ' +
                   r.owners);
    }

    await pool.end();
}

explore().catch(console.error);
