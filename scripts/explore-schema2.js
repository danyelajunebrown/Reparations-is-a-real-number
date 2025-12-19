const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function explore() {
    // Enslaved individuals sample
    console.log('\n5. ENSLAVED_INDIVIDUALS sample records:\n');
    const eiSample = await pool.query(`
        SELECT enslaved_id, full_name, enslaved_by_individual_id, gender, occupation
        FROM enslaved_individuals
        LIMIT 5
    `);
    for (const r of eiSample.rows) {
        console.log('   ' + r.enslaved_id + ': ' + r.full_name + ' | Enslaver ID: ' + (r.enslaved_by_individual_id || 'unknown'));
    }

    // Check canonical_persons for owners/slaveholders
    console.log('\n6. CANONICAL_PERSONS - slaveholders sample:\n');
    const cpOwners = await pool.query(`
        SELECT id, canonical_name, person_type, notes
        FROM canonical_persons
        WHERE person_type IN ('slaveholder', 'owner', 'slave_owner', 'enslaver')
        LIMIT 10
    `);
    for (const r of cpOwners.rows) {
        console.log('   ' + r.id + ': ' + r.canonical_name + ' (' + r.person_type + ')');
        if (r.notes) console.log('      Notes: ' + r.notes.substring(0, 100));
    }

    // Check canonical enslaved
    console.log('\n7. CANONICAL_PERSONS - enslaved sample:\n');
    const cpEnslaved = await pool.query(`
        SELECT id, canonical_name, person_type, notes
        FROM canonical_persons
        WHERE person_type = 'enslaved'
        LIMIT 10
    `);
    for (const r of cpEnslaved.rows) {
        console.log('   ' + r.id + ': ' + r.canonical_name + ' (' + r.person_type + ')');
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

    // Documents
    console.log('\n9. DOCUMENTS:\n');
    const docs = await pool.query(`SELECT * FROM documents LIMIT 3`);
    console.log(JSON.stringify(docs.rows, null, 2));

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('ENTITY SUMMARY:\n');

    const summary = await pool.query(`
        SELECT 'unconfirmed_persons' as source, COUNT(*) as total,
               COUNT(*) FILTER (WHERE person_type = 'enslaved') as enslaved,
               COUNT(*) FILTER (WHERE person_type IN ('owner', 'slaveholder')) as owners
        FROM unconfirmed_persons
        WHERE status IS NULL OR status NOT IN ('rejected', 'needs_review')
        UNION ALL
        SELECT 'enslaved_individuals', COUNT(*), COUNT(*), 0
        FROM enslaved_individuals
        UNION ALL
        SELECT 'canonical_persons', COUNT(*),
               COUNT(*) FILTER (WHERE person_type = 'enslaved'),
               COUNT(*) FILTER (WHERE person_type IN ('slaveholder', 'owner', 'enslaver'))
        FROM canonical_persons
    `);

    console.log('Source                  | Total    | Enslaved | Owners');
    console.log('-'.repeat(60));
    for (const r of summary.rows) {
        console.log(r.source.padEnd(24) + '| ' +
                   parseInt(r.total).toLocaleString().padEnd(9) + '| ' +
                   parseInt(r.enslaved).toLocaleString().padEnd(9) + '| ' +
                   parseInt(r.owners).toLocaleString());
    }

    // Check if enslaved_individuals has link to canonical
    console.log('\n\nKEY QUESTION: Does enslaved_individuals link to canonical_persons?');
    const linkCheck = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'enslaved_individuals'
        AND column_name LIKE '%canonical%'
    `);
    if (linkCheck.rows.length > 0) {
        console.log('   YES - column: ' + linkCheck.rows[0].column_name);
    } else {
        console.log('   NO direct link column found');
    }

    // Check what columns canonical has
    console.log('\nCanonical_persons columns:');
    const cpCols = await pool.query(`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'canonical_persons' ORDER BY ordinal_position
    `);
    console.log(cpCols.rows.map(c => c.column_name).join(', '));

    await pool.end();
}

explore().catch(console.error);
