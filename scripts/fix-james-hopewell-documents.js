/**
 * Phase 1: Fix James Hopewell Document Duplication
 * 
 * Problem: James Hopewell's document showing as two separate pages instead of one
 * Solution: Identify duplicates, consolidate into single record, update references
 */

const db = require('../database.js');

async function fixJamesHopewellDocuments() {
    console.log('========================================');
    console.log('Phase 1: Fix James Hopewell Documents');
    console.log('========================================\n');

    try {
        // Step 1: Find all documents related to James Hopewell
        console.log('Step 1: Searching for James Hopewell documents...');
        const documentsResult = await db.query(`
            SELECT 
                d.document_id,
                d.owner_name,
                d.filename,
                d.file_path,
                d.created_at,
                d.total_enslaved,
                d.named_enslaved
            FROM documents d
            WHERE d.owner_name ILIKE '%james%hopewell%'
               OR d.owner_name ILIKE '%hopewell%james%'
               OR d.filename ILIKE '%hopewell%'
            ORDER BY d.created_at
        `);

        console.log(`Found ${documentsResult.rows.length} document(s)\n`);

        if (documentsResult.rows.length === 0) {
            console.log('No James Hopewell documents found. Checking enslaved_people table...\n');
            
            // Check enslaved_people table for James Hopewell as owner
            const enslavedResult = await db.query(`
                SELECT 
                    owner_name,
                    document_id,
                    COUNT(*) as count
                FROM enslaved_people
                WHERE owner_name ILIKE '%james%hopewell%'
                   OR owner_name ILIKE '%hopewell%james%'
                GROUP BY owner_name, document_id
            `);

            console.log(`Found ${enslavedResult.rows.length} owner record(s):`);
            enslavedResult.rows.forEach(row => {
                console.log(`  - ${row.owner_name} (doc_id: ${row.document_id}, ${row.count} enslaved people)`);
            });
            
            if (enslavedResult.rows.length === 0) {
                console.log('\n✓ No duplicates found - data is clean!');
                return;
            }
        } else {
            // Display found documents
            console.log('Documents found:');
            documentsResult.rows.forEach((doc, i) => {
                console.log(`\n${i + 1}. Document ID: ${doc.document_id}`);
                console.log(`   Owner: ${doc.owner_name}`);
                console.log(`   Filename: ${doc.filename}`);
                console.log(`   File path: ${doc.file_path || 'N/A'}`);
                console.log(`   Total enslaved: ${doc.total_enslaved || 0}`);
                console.log(`   Named enslaved: ${doc.named_enslaved || 0}`);
                console.log(`   Created: ${doc.created_at}`);
            });
        }

        // Step 2: Check for duplicate/split pages
        console.log('\n\nStep 2: Analyzing for duplicates...');
        
        if (documentsResult.rows.length > 1) {
            console.log('⚠️  Multiple documents found - checking if they should be consolidated\n');

            // Group by similar filenames
            const groups = {};
            documentsResult.rows.forEach(doc => {
                const baseName = (doc.filename || '')
                    .replace(/page\s*\d+/gi, '')
                    .replace(/_page_\d+/gi, '')
                    .replace(/-page-\d+/gi, '')
                    .trim()
                    .toLowerCase();
                
                if (!groups[baseName]) {
                    groups[baseName] = [];
                }
                groups[baseName].push(doc);
            });

            console.log('Potential consolidation groups:');
            Object.entries(groups).forEach(([baseName, docs]) => {
                if (docs.length > 1) {
                    console.log(`\n  Base name: "${baseName}"`);
                    console.log(`  Documents to consolidate: ${docs.length}`);
                    docs.forEach(doc => {
                        console.log(`    - ID ${doc.document_id}: ${doc.filename} (${doc.total_enslaved || 0} enslaved)`);
                    });
                }
            });

            // Step 3: Consolidation strategy
            console.log('\n\nStep 3: Consolidation Strategy');
            console.log('For multi-page documents:');
            console.log('  1. Keep earliest document as primary');
            console.log('  2. Update it to reflect full document (total_pages, etc.)');
            console.log('  3. Move all enslaved_people references to primary document');
            console.log('  4. Mark duplicates for deletion or archive\n');

            // Example consolidation (won't execute without confirmation)
            for (const [baseName, docs] of Object.entries(groups)) {
                if (docs.length > 1) {
                    const primaryDoc = docs[0]; // Earliest document
                    const duplicates = docs.slice(1);

                    console.log(`\nConsolidation plan for "${baseName}":`);
                    console.log(`  Primary document: ID ${primaryDoc.document_id}`);
                    console.log(`  Will consolidate ${duplicates.length} duplicate(s):`);
                    duplicates.forEach(dup => {
                        console.log(`    - ID ${dup.document_id} (${dup.total_enslaved || 0} enslaved)`);
                    });

                    // Count total enslaved people
                    const totalEnslaved = docs.reduce((sum, doc) => sum + parseInt(doc.total_enslaved || 0), 0);
                    console.log(`  Total enslaved people: ${totalEnslaved}`);
                }
            }

            console.log('\n⚠️  CONSOLIDATION NOT EXECUTED');
            console.log('This is a dry run. To execute consolidation, uncomment the code below.\n');

            // UNCOMMENT TO EXECUTE CONSOLIDATION:
            /*
            for (const [baseName, docs] of Object.entries(groups)) {
                if (docs.length > 1) {
                    const primaryDoc = docs[0];
                    const duplicates = docs.slice(1);

                    console.log(`\nExecuting consolidation for "${baseName}"...`);

                    // Update primary document
                    await db.query(`
                        UPDATE documents
                        SET 
                            total_pages = $1,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $2
                    `, [docs.length, primaryDoc.id]);

                    // Move enslaved people to primary document
                    for (const dup of duplicates) {
                        await db.query(`
                            UPDATE enslaved_people
                            SET document_id = $1
                            WHERE document_id = $2
                        `, [primaryDoc.id, dup.id]);
                    }

                    // Mark duplicates as archived
                    for (const dup of duplicates) {
                        await db.query(`
                            UPDATE documents
                            SET 
                                document_name = document_name || ' [ARCHIVED - Consolidated into doc ' || $1 || ']',
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = $2
                        `, [primaryDoc.id, dup.id]);
                    }

                    console.log(`✓ Consolidated ${duplicates.length} documents into primary doc ${primaryDoc.id}`);
                }
            }
            */

        } else if (documentsResult.rows.length === 1) {
            console.log('✓ Only one document found - no consolidation needed\n');
        }

        // Step 4: Verification
        console.log('\nStep 4: Current state after analysis:');
        const finalCheck = await db.query(`
            SELECT 
                d.document_id,
                d.owner_name,
                d.filename,
                d.total_enslaved
            FROM documents d
            WHERE d.owner_name ILIKE '%james%hopewell%'
               OR d.owner_name ILIKE '%hopewell%james%'
               OR d.filename ILIKE '%hopewell%'
        `);

        console.log(`Total James Hopewell documents: ${finalCheck.rows.length}`);
        finalCheck.rows.forEach(doc => {
            console.log(`  - Doc ${doc.document_id}: ${doc.owner_name} - ${doc.total_enslaved || 0} enslaved people`);
        });

        console.log('\n========================================');
        console.log('✓ Phase 1: Document Analysis Complete!');
        console.log('========================================\n');

    } catch (error) {
        console.error('\n❌ Document fix failed!');
        console.error('Error:', error.message);
        console.error(error);
    }
}

// Run the fix
fixJamesHopewellDocuments()
    .then(() => {
        console.log('Done. Database connection will close automatically.');
        process.exit(0);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
