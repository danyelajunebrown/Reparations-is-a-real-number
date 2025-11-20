const pool = require('./database');

async function verifyFamilySearchIds() {
  try {
    console.log('Checking FamilySearch IDs in database...\n');

    // Query documents with FamilySearch IDs
    const result = await pool.query(`
      SELECT owner_name, owner_familysearch_id, doc_type
      FROM documents
      WHERE owner_familysearch_id IS NOT NULL
      ORDER BY owner_name
    `);

    if (result.rows.length === 0) {
      console.log('No FamilySearch IDs found in documents table.');
    } else {
      console.log(`Found ${result.rows.length} owner(s) with FamilySearch IDs:\n`);
      result.rows.forEach(row => {
        console.log(`  ${row.owner_name}`);
        console.log(`    FamilySearch ID: ${row.owner_familysearch_id}`);
        console.log(`    Document Type: ${row.doc_type}`);
        console.log('');
      });
    }

    // Query individuals with FamilySearch IDs
    const individualsResult = await pool.query(`
      SELECT full_name, familysearch_id
      FROM individuals
      WHERE familysearch_id IS NOT NULL
      ORDER BY full_name
    `);

    if (individualsResult.rows.length > 0) {
      console.log(`Found ${individualsResult.rows.length} individual(s) with FamilySearch IDs:\n`);
      individualsResult.rows.forEach(row => {
        console.log(`  ${row.full_name}`);
        console.log(`    FamilySearch ID: ${row.familysearch_id}`);
        console.log('');
      });
    }

    await pool.end();

  } catch (error) {
    console.error('Error:', error.message);
  }
}

verifyFamilySearchIds();
