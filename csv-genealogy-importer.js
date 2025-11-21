/**
 * CSV Genealogy Bulk Importer
 *
 * Imports genealogy data from CSV files into the enslaved_individuals
 * and enslaved_relationships tables.
 *
 * CSV Format:
 * PersonID,FullName,BirthYear,DeathYear,Gender,FatherID,MotherID,SpouseID,SpouseName,Location,FamilySearchID,Notes
 *
 * Example:
 * ENS001,James Hopewell,1780,1825,Male,,,,,Maryland,MTRV-272,Enslaved ancestor
 * ENS002,Sarah Hopewell,1805,1870,Female,ENS001,,,John Smith,Virginia,,Daughter of James
 */

const Papa = require('papaparse');
const fs = require('fs');

class CSVGenealogyImporter {
    constructor(database) {
        this.db = database;
        this.stats = {
            totalRows: 0,
            personsCreated: 0,
            personsUpdated: 0,
            relationshipsCreated: 0,
            errors: []
        };
    }

    /**
     * Parse and validate a CSV file
     * @param {string} filePath - Path to CSV file
     * @returns {Promise<Array>} Parsed rows
     */
    async parseCSVFile(filePath) {
        return new Promise((resolve, reject) => {
            const fileContent = fs.readFileSync(filePath, 'utf8');

            Papa.parse(fileContent, {
                header: true,
                skipEmptyLines: true,
                transformHeader: (header) => {
                    // Normalize header names (trim, lowercase)
                    return header.trim().toLowerCase().replace(/\s+/g, '_');
                },
                complete: (results) => {
                    if (results.errors.length > 0) {
                        console.error('CSV parsing errors:', results.errors);
                    }
                    resolve(results.data);
                },
                error: (error) => {
                    reject(error);
                }
            });
        });
    }

    /**
     * Validate a person record
     */
    validatePersonRecord(row, index) {
        const errors = [];

        if (!row.personid || row.personid.trim() === '') {
            errors.push(`Row ${index}: PersonID is required`);
        }

        if (!row.fullname || row.fullname.trim() === '') {
            errors.push(`Row ${index}: FullName is required`);
        }

        // Validate year ranges
        if (row.birthyear && (parseInt(row.birthyear) < 1600 || parseInt(row.birthyear) > 2100)) {
            errors.push(`Row ${index}: BirthYear ${row.birthyear} is out of valid range (1600-2100)`);
        }

        if (row.deathyear && (parseInt(row.deathyear) < 1600 || parseInt(row.deathyear) > 2100)) {
            errors.push(`Row ${index}: DeathYear ${row.deathyear} is out of valid range (1600-2100)`);
        }

        return errors;
    }

    /**
     * Import a single person record
     */
    async importPerson(row) {
        const personId = row.personid.trim();
        const fullName = row.fullname.trim();
        const birthYear = row.birthyear ? parseInt(row.birthyear) : null;
        const deathYear = row.deathyear ? parseInt(row.deathyear) : null;
        const gender = row.gender || null;
        const spouseName = row.spousename || null;
        const location = row.location || null;
        const familySearchId = row.familysearchid || null;
        const notes = row.notes || null;

        try {
            // Check if person already exists
            const existing = await this.db.query(
                'SELECT enslaved_id FROM enslaved_individuals WHERE enslaved_id = $1',
                [personId]
            );

            if (existing.rows && existing.rows.length > 0) {
                // Update existing record
                await this.db.query(`
                    UPDATE enslaved_individuals
                    SET full_name = $2,
                        birth_year = $3,
                        death_year = $4,
                        gender = $5,
                        spouse_name = $6,
                        location = $7,
                        familysearch_id = $8,
                        notes = $9,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE enslaved_id = $1
                `, [personId, fullName, birthYear, deathYear, gender, spouseName, location, familySearchId, notes]);

                this.stats.personsUpdated++;
                console.log(`✓ Updated person: ${fullName} (${personId})`);
            } else {
                // Insert new record
                await this.db.query(`
                    INSERT INTO enslaved_individuals (
                        enslaved_id, full_name, birth_year, death_year, gender,
                        spouse_name, location, familysearch_id, notes, verified
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
                `, [personId, fullName, birthYear, deathYear, gender, spouseName, location, familySearchId, notes]);

                this.stats.personsCreated++;
                console.log(`✓ Created person: ${fullName} (${personId})`);
            }

            return true;
        } catch (error) {
            this.stats.errors.push({
                personId,
                fullName,
                error: error.message
            });
            console.error(`✗ Error importing person ${fullName}:`, error.message);
            return false;
        }
    }

    /**
     * Import relationships for a person
     */
    async importRelationships(row) {
        const personId = row.personid.trim();
        const fatherId = row.fatherid ? row.fatherid.trim() : null;
        const motherId = row.motherid ? row.motherid.trim() : null;
        const spouseId = row.spouseid ? row.spouseid.trim() : null;

        try {
            // Parent-child relationships
            if (fatherId) {
                await this.createRelationship(fatherId, personId, 'parent-child', true, 'csv_import');
            }

            if (motherId) {
                await this.createRelationship(motherId, personId, 'parent-child', true, 'csv_import');
            }

            // Spouse relationship
            if (spouseId) {
                await this.createRelationship(personId, spouseId, 'spouse', false, 'csv_import');
            }

            return true;
        } catch (error) {
            this.stats.errors.push({
                personId,
                error: `Relationship import error: ${error.message}`
            });
            console.error(`✗ Error importing relationships for ${personId}:`, error.message);
            return false;
        }
    }

    /**
     * Create a relationship between two people
     */
    async createRelationship(id1, id2, type, isDirected, source) {
        try {
            // Check if relationship already exists
            const existing = await this.db.query(`
                SELECT relationship_id FROM enslaved_relationships
                WHERE enslaved_id_1 = $1 AND enslaved_id_2 = $2 AND relationship_type = $3
            `, [id1, id2, type]);

            if (existing.rows && existing.rows.length > 0) {
                // Relationship already exists, skip
                return;
            }

            // Insert new relationship
            await this.db.query(`
                INSERT INTO enslaved_relationships (
                    enslaved_id_1, enslaved_id_2, relationship_type,
                    is_directed, source_type, confidence, verified
                ) VALUES ($1, $2, $3, $4, $5, 1.0, true)
            `, [id1, id2, type, isDirected, source]);

            this.stats.relationshipsCreated++;
            console.log(`  ✓ Created ${type} relationship: ${id1} → ${id2}`);

        } catch (error) {
            // If foreign key constraint fails, it means one of the persons doesn't exist yet
            // We'll skip this relationship and log it
            console.log(`  ⚠ Skipped relationship ${id1} → ${id2}: ${error.message}`);
        }
    }

    /**
     * Import entire CSV file
     * @param {string} filePath - Path to CSV file
     * @param {object} options - Import options
     * @returns {Promise<object>} Import statistics
     */
    async importFile(filePath, options = {}) {
        console.log(`Starting CSV import: ${filePath}`);

        // Reset stats
        this.stats = {
            totalRows: 0,
            personsCreated: 0,
            personsUpdated: 0,
            relationshipsCreated: 0,
            errors: []
        };

        try {
            // Parse CSV file
            const rows = await this.parseCSVFile(filePath);
            this.stats.totalRows = rows.length;

            console.log(`Parsed ${rows.length} rows from CSV`);

            // Start database transaction
            const client = await this.db.pool.connect();

            try {
                await client.query('BEGIN');

                // Phase 1: Import all persons first
                console.log('\n=== Phase 1: Importing Persons ===');
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];

                    // Validate row
                    const validationErrors = this.validatePersonRecord(row, i + 1);
                    if (validationErrors.length > 0) {
                        this.stats.errors.push(...validationErrors);
                        console.error(`✗ Row ${i + 1} validation failed:`, validationErrors);
                        continue;
                    }

                    // Import person
                    await this.importPerson(row);
                }

                // Phase 2: Import all relationships
                console.log('\n=== Phase 2: Importing Relationships ===');
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    await this.importRelationships(row);
                }

                await client.query('COMMIT');
                console.log('\n✓ Transaction committed successfully');

            } catch (error) {
                await client.query('ROLLBACK');
                console.error('✗ Transaction rolled back due to error:', error);
                throw error;
            } finally {
                client.release();
            }

            // Print summary
            console.log('\n=== Import Summary ===');
            console.log(`Total rows processed: ${this.stats.totalRows}`);
            console.log(`Persons created: ${this.stats.personsCreated}`);
            console.log(`Persons updated: ${this.stats.personsUpdated}`);
            console.log(`Relationships created: ${this.stats.relationshipsCreated}`);
            console.log(`Errors: ${this.stats.errors.length}`);

            if (this.stats.errors.length > 0) {
                console.log('\nErrors:');
                this.stats.errors.slice(0, 10).forEach(err => {
                    console.log(`  - ${JSON.stringify(err)}`);
                });
                if (this.stats.errors.length > 10) {
                    console.log(`  ... and ${this.stats.errors.length - 10} more`);
                }
            }

            return this.stats;

        } catch (error) {
            console.error('CSV import failed:', error);
            throw error;
        }
    }

    /**
     * Generate a sample CSV file for reference
     */
    generateSampleCSV(outputPath = './sample-genealogy.csv') {
        const sampleData = [
            ['PersonID', 'FullName', 'BirthYear', 'DeathYear', 'Gender', 'FatherID', 'MotherID', 'SpouseID', 'SpouseName', 'Location', 'FamilySearchID', 'Notes'],
            ['ENS001', 'James Hopewell', '1780', '1825', 'Male', '', '', '', 'Angelica Chesley', 'Maryland', 'MTRV-272', 'Enslaved ancestor'],
            ['ENS002', 'Anne Maria Hopewell', '1799', '1881', 'Female', 'ENS001', '', '', '', 'Virginia', '', 'Daughter of James'],
            ['ENS003', 'James Robert Hopewell', '1813', '1872', 'Male', 'ENS001', '', '', 'Mary Johnson', 'Maryland', '', 'Son of James'],
            ['ENS004', 'Sarah Elizabeth Hopewell', '1835', '1905', 'Female', 'ENS003', '', '', '', 'Virginia', '', 'Granddaughter of James'],
            ['ENS005', 'John Thomas Hopewell', '1858', '1920', 'Male', 'ENS003', '', '', 'Emma Wilson', 'Maryland', '', 'Great-grandson of James']
        ];

        const csv = Papa.unparse(sampleData);
        fs.writeFileSync(outputPath, csv);
        console.log(`Sample CSV file created: ${outputPath}`);
        return outputPath;
    }
}

module.exports = CSVGenealogyImporter;
