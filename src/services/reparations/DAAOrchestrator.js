/**
 * DAA Orchestrator
 * 
 * Coordinates the complete DAA generation process:
 * 1. Runs (or resumes) ancestor climb to find ALL slaveholders
 * 2. Aggregates enslaved persons with primary source documentation
 * 3. Calculates total debt across all slaveholders
 * 4. Generates comprehensive DAA with DOCX document
 * 
 * This bridges the gap between the ancestor climber and DAA generator.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class DAAOrchestrator {
    constructor(database, daaGenerator, documentGenerator) {
        this.db = database;
        this.daaGenerator = daaGenerator;
        this.documentGenerator = documentGenerator;
    }

    /**
     * Main entry point: Generate comprehensive DAA for a modern person
     * 
     * @param {string} familySearchId - FamilySearch ID of modern person
     * @param {Object} acknowledgerInfo - Acknowledger details
     * @returns {Object} Complete DAA record and document path
     */
    async generateComprehensiveDAA(familySearchId, acknowledgerInfo) {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('   COMPREHENSIVE DAA GENERATION');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`Modern Person: ${acknowledgerInfo.name} (${familySearchId})`);
        console.log();

        // Step 1: Ensure ancestor climb is complete
        console.log('Step 1: Checking ancestor climb status...');
        const climbSession = await this.ensureClimbComplete(familySearchId, acknowledgerInfo.name);
        console.log(`   ✓ Climb session: ${climbSession.id}`);
        console.log(`   ✓ Matches found: ${climbSession.matches_found}`);
        console.log();

        // Step 2: Get all documented slaveholders
        console.log('Step 2: Retrieving documented slaveholders...');
        const slaveholders = await this.getDocumentedSlaveholders(climbSession.id);
        console.log(`   ✓ Found ${slaveholders.length} documented slaveholder(s)`);
        
        if (slaveholders.length === 0) {
            throw new Error('No documented slaveholders found. Ensure primary sources are linked.');
        }
        
        for (const sh of slaveholders) {
            console.log(`      • ${sh.slaveholder_name} (Gen ${sh.generation_distance})`);
        }
        console.log();

        // Step 3: Aggregate enslaved persons for each slaveholder
        console.log('Step 3: Aggregating enslaved persons with primary sources...');
        const slaveholderData = await this.aggregateEnslavedData(slaveholders);
        
        let totalEnslavedCount = 0;
        for (const data of slaveholderData) {
            totalEnslavedCount += data.enslavedPersons.length;
            console.log(`   ✓ ${data.slaveholder.slaveholder_name}: ${data.enslavedPersons.length} enslaved person(s)`);
        }
        console.log(`   ✓ Total enslaved persons documented: ${totalEnslavedCount}`);
        console.log();

        // Step 4: Calculate total debt
        console.log('Step 4: Calculating total debt...');
        const debtCalculation = await this.calculateTotalDebt(slaveholderData, acknowledgerInfo.annualIncome);
        console.log(`   ✓ Total debt: $${debtCalculation.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(`   ✓ Annual payment (2%): $${debtCalculation.annualPayment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log();

        // Step 5: Create DAA database record
        console.log('Step 5: Creating DAA database record...');
        const daaRecord = await this.createDAARecord(
            climbSession,
            acknowledgerInfo,
            slaveholderData,
            debtCalculation
        );
        console.log(`   ✓ DAA ID: ${daaRecord.daaId}`);
        console.log(`   ✓ Agreement Number: ${daaRecord.agreementNumber}`);
        console.log();

        // Step 6: Generate DOCX document
        console.log('Step 6: Generating DOCX document...');
        const docxPath = await this.documentGenerator.generateDOCX(
            daaRecord,
            slaveholderData,
            debtCalculation,
            acknowledgerInfo
        );
        console.log(`   ✓ Document saved: ${docxPath}`);
        console.log();

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('   ✅ COMPREHENSIVE DAA GENERATION COMPLETE');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log();
        console.log('Summary:');
        console.log(`   • Slaveholders: ${slaveholderData.length}`);
        console.log(`   • Enslaved persons: ${totalEnslavedCount}`);
        console.log(`   • Total debt: $${debtCalculation.totalDebt.toLocaleString()}`);
        console.log(`   • Annual payment: $${debtCalculation.annualPayment.toLocaleString()}`);
        console.log(`   • Document: ${docxPath}`);
        console.log(`   • DAA ID: ${daaRecord.daaId}`);
        console.log();

        return {
            daaRecord,
            docxPath,
            slaveholderData,
            debtCalculation,
            climbSession
        };
    }

    /**
     * Ensure ancestor climb is complete for the given person
     * Checks for existing session or runs new climb
     */
    async ensureClimbComplete(familySearchId, personName) {
        // Check for existing completed session
        const existingSession = await this.db.query(`
            SELECT * FROM ancestor_climb_sessions
            WHERE modern_person_fs_id = $1
            AND status = 'completed'
            ORDER BY completed_at DESC
            LIMIT 1
        `, [familySearchId]);

        if (existingSession.rows.length > 0) {
            console.log('   ℹ Using existing climb session');
            return existingSession.rows[0];
        }

        // Check for in-progress session
        const inProgressSession = await this.db.query(`
            SELECT * FROM ancestor_climb_sessions
            WHERE modern_person_fs_id = $1
            AND status = 'in_progress'
            ORDER BY started_at DESC
            LIMIT 1
        `, [familySearchId]);

        if (inProgressSession.rows.length > 0) {
            console.log('   ⚠ Found in-progress climb session');
            console.log('   → Please complete the climb first by running:');
            console.log(`   → FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js --resume ${inProgressSession.rows[0].id}`);
            throw new Error('Climb session in progress. Complete it before generating DAA.');
        }

        // No session exists - need to run climb
        console.log('   ⚠ No climb session found');
        console.log('   → Please run ancestor climb first:');
        console.log(`   → FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js ${familySearchId} --name "${personName}"`);
        throw new Error('Ancestor climb required. Run the command above first.');
    }

    /**
     * Get all slaveholders with primary source documentation
     * 
     * NEW STRATEGY:
     * 1. Get ALL ancestor names from climb (not just matched ones)
     * 2. Query database for documented slaveholders
     * 3. Match using fuzzy name/location/date matching
     */
    async getDocumentedSlaveholders(sessionId) {
        console.log('   → Querying database for documented slaveholders...');
        
        // Step 1: Get ALL ancestor names from climb
        const climbNames = await this.db.query(`
            SELECT DISTINCT
                acm.id as match_id,
                acm.slaveholder_name,
                acm.slaveholder_fs_id,
                acm.slaveholder_birth_year,
                acm.generation_distance,
                acm.lineage_path,
                acm.match_type,
                acm.slaveholder_id as existing_match_id
            FROM ancestor_climb_matches acm
            WHERE acm.session_id = $1
            ORDER BY acm.generation_distance ASC
        `, [sessionId]);

        console.log(`   → Found ${climbNames.rows.length} ancestor names in climb`);

        // Step 2: Get ALL documented enslavers from database
        // Query enslavers who have enslaved_individuals (from slave schedules)
        const documentedSlaveholders = await this.db.query(`
            SELECT DISTINCT
                cp.id,
                cp.canonical_name,
                cp.birth_year_estimate,
                cp.death_year_estimate,
                cp.primary_state,
                cp.primary_county,
                cp.notes,
                COUNT(DISTINCT ei.enslaved_id) as enslaved_count,
                COUNT(DISTINCT pd.id) as document_count
            FROM canonical_persons cp
            INNER JOIN enslaved_individuals ei ON CAST(cp.id AS text) = ei.enslaved_by_individual_id
            LEFT JOIN person_documents pd ON cp.id = pd.canonical_person_id AND pd.s3_url IS NOT NULL
            WHERE cp.person_type = 'enslaver'
            GROUP BY cp.id, cp.canonical_name, cp.birth_year_estimate, cp.death_year_estimate, cp.primary_state, cp.primary_county, cp.notes
            HAVING COUNT(DISTINCT ei.enslaved_id) > 0
            ORDER BY cp.canonical_name ASC
        `);

        console.log(`   → Found ${documentedSlaveholders.rows.length} documented slaveholders in database`);

        // Step 3: Match climb ancestors to documented slaveholders
        const matches = [];
        
        for (const ancestor of climbNames.rows) {
            // Try to match by existing ID first
            if (ancestor.existing_match_id) {
                const dbMatch = documentedSlaveholders.rows.find(sh => sh.id === ancestor.existing_match_id);
                if (dbMatch) {
                    matches.push({
                        match_id: ancestor.match_id,
                        slaveholder_id: dbMatch.id,
                        slaveholder_name: dbMatch.canonical_name,
                        slaveholder_fs_id: ancestor.slaveholder_fs_id,
                        slaveholder_birth_year: dbMatch.birth_year_estimate,
                        generation_distance: ancestor.generation_distance,
                        lineage_path: ancestor.lineage_path,
                        match_type: 'existing_id',
                        match_confidence: 100,
                        primary_state: dbMatch.primary_state,
                        primary_county: dbMatch.primary_county,
                        notes: dbMatch.notes,
                        enslaved_count: dbMatch.enslaved_count,
                        document_count: dbMatch.document_count
                    });
                    continue;
                }
            }

            // Fuzzy matching by name
            const ancestorName = ancestor.slaveholder_name.toLowerCase().trim();
            
            for (const dbSlaveholder of documentedSlaveholders.rows) {
                const dbName = dbSlaveholder.canonical_name.toLowerCase().trim();
                
                // Exact match
                if (ancestorName === dbName) {
                    matches.push({
                        match_id: ancestor.match_id,
                        slaveholder_id: dbSlaveholder.id,
                        slaveholder_name: dbSlaveholder.canonical_name,
                        slaveholder_fs_id: ancestor.slaveholder_fs_id,
                        slaveholder_birth_year: dbSlaveholder.birth_year_estimate,
                        generation_distance: ancestor.generation_distance,
                        lineage_path: ancestor.lineage_path,
                        match_type: 'name_exact',
                        match_confidence: 90,
                        primary_state: dbSlaveholder.primary_state,
                        primary_county: dbSlaveholder.primary_county,
                        notes: dbSlaveholder.notes,
                        enslaved_count: dbSlaveholder.enslaved_count,
                        document_count: dbSlaveholder.document_count
                    });
                    break;
                }
                
                // ENHANCED: Special name variation matching for known families
                // Angelica Chesley → Angelica Chew, Maria Angelica Biscoe
                if (ancestorName.includes('angelica') && dbName.includes('angelica')) {
                    const matched = (ancestorName.includes('chesley') && (dbName.includes('chew') || dbName.includes('biscoe'))) ||
                                  (ancestorName.includes('chew') && (dbName.includes('chesley') || dbName.includes('biscoe'))) ||
                                  (ancestorName.includes('biscoe') && (dbName.includes('angelica')));
                    
                    if (matched) {
                        matches.push({
                            match_id: ancestor.match_id,
                            slaveholder_id: dbSlaveholder.id,
                            slaveholder_name: dbSlaveholder.canonical_name,
                            slaveholder_fs_id: ancestor.slaveholder_fs_id,
                            slaveholder_birth_year: dbSlaveholder.birth_year_estimate,
                            generation_distance: ancestor.generation_distance,
                            lineage_path: ancestor.lineage_path,
                            match_type: 'name_variation',
                            match_confidence: 85,
                            primary_state: dbSlaveholder.primary_state,
                            primary_county: dbSlaveholder.primary_county,
                            notes: dbSlaveholder.notes,
                            enslaved_count: dbSlaveholder.enslaved_count,
                            document_count: dbSlaveholder.document_count
                        });
                        break;
                    }
                }
                
                // Biscoe family name variations
                if ((ancestorName.includes('biscoe') && dbName.includes('biscoe')) ||
                    (ancestorName.includes('bisco') && dbName.includes('biscoe'))) {
                    matches.push({
                        match_id: ancestor.match_id,
                        slaveholder_id: dbSlaveholder.id,
                        slaveholder_name: dbSlaveholder.canonical_name,
                        slaveholder_fs_id: ancestor.slaveholder_fs_id,
                        slaveholder_birth_year: dbSlaveholder.birth_year_estimate,
                        generation_distance: ancestor.generation_distance,
                        lineage_path: ancestor.lineage_path,
                        match_type: 'name_variation',
                        match_confidence: 85,
                        primary_state: dbSlaveholder.primary_state,
                        primary_county: dbSlaveholder.primary_county,
                        notes: dbSlaveholder.notes,
                        enslaved_count: dbSlaveholder.enslaved_count,
                        document_count: dbSlaveholder.document_count
                    });
                    break;
                }
                
                // Chew family matching
                if (ancestorName.includes('chew') && dbName.includes('chew')) {
                    matches.push({
                        match_id: ancestor.match_id,
                        slaveholder_id: dbSlaveholder.id,
                        slaveholder_name: dbSlaveholder.canonical_name,
                        slaveholder_fs_id: ancestor.slaveholder_fs_id,
                        slaveholder_birth_year: dbSlaveholder.birth_year_estimate,
                        generation_distance: ancestor.generation_distance,
                        lineage_path: ancestor.lineage_path,
                        match_type: 'name_variation',
                        match_confidence: 85,
                        primary_state: dbSlaveholder.primary_state,
                        primary_county: dbSlaveholder.primary_county,
                        notes: dbSlaveholder.notes,
                        enslaved_count: dbSlaveholder.enslaved_count,
                        document_count: dbSlaveholder.document_count
                    });
                    break;
                }
                
                // General fuzzy match: check if names contain each other
                if (ancestorName.includes(dbName) || dbName.includes(ancestorName)) {
                    // Check birth year proximity (within 10 years)
                    const birthYearMatch = !ancestor.slaveholder_birth_year || !dbSlaveholder.birth_year_estimate ||
                        Math.abs(ancestor.slaveholder_birth_year - dbSlaveholder.birth_year_estimate) <= 10;
                    
                    if (birthYearMatch) {
                        matches.push({
                            match_id: ancestor.match_id,
                            slaveholder_id: dbSlaveholder.id,
                            slaveholder_name: dbSlaveholder.canonical_name,
                            slaveholder_fs_id: ancestor.slaveholder_fs_id,
                            slaveholder_birth_year: dbSlaveholder.birth_year_estimate,
                            generation_distance: ancestor.generation_distance,
                            lineage_path: ancestor.lineage_path,
                            match_type: 'name_fuzzy',
                            match_confidence: 75,
                            primary_state: dbSlaveholder.primary_state,
                            primary_county: dbSlaveholder.primary_county,
                            notes: dbSlaveholder.notes,
                            enslaved_count: dbSlaveholder.enslaved_count,
                            document_count: dbSlaveholder.document_count
                        });
                        break;
                    }
                }
            }
        }

        console.log(`   → Matched ${matches.length} documented slaveholders to ancestry`);
        
        // Remove duplicates (same slaveholder_id)
        const uniqueMatches = [];
        const seenIds = new Set();
        
        for (const match of matches) {
            if (!seenIds.has(match.slaveholder_id)) {
                seenIds.add(match.slaveholder_id);
                uniqueMatches.push(match);
                console.log(`      • ${match.slaveholder_name} (${match.enslaved_count} enslaved, ${match.document_count} docs)`);
            }
        }

        return uniqueMatches;
    }

    /**
     * Aggregate enslaved persons for each slaveholder with primary sources
     * 
     * UPDATED: Now uses enslaved_individuals table directly since
     * enslaved_owner_relationships is empty
     */
    async aggregateEnslavedData(slaveholders) {
        const slaveholderData = [];

        for (const slaveholder of slaveholders) {
            // Get enslaved persons from enslaved_individuals table
            const enslavedResult = await this.db.query(`
                SELECT 
                    ei.enslaved_id,
                    ei.full_name as enslaved_name,
                    ei.birth_year,
                    ei.death_year,
                    ei.freedom_year,
                    ei.gender,
                    pd.s3_url,
                    pd.source_url as document_source_url,
                    pd.document_type,
                    pd.collection_name,
                    pd.film_number,
                    pd.image_number
                FROM enslaved_individuals ei
                LEFT JOIN person_documents pd ON CAST(ei.enslaved_by_individual_id AS integer) = pd.canonical_person_id
                WHERE CAST(ei.enslaved_by_individual_id AS text) = CAST($1 AS text)
                ORDER BY ei.full_name ASC
            `, [slaveholder.slaveholder_id]);

            // Calculate years enslaved
            const enslavedPersons = enslavedResult.rows.map(person => {
                // Calculate from birth to freedom/death, defaulting to 30 years if unknown
                let yearsEnslaved = 30;
                if (person.birth_year && person.freedom_year) {
                    yearsEnslaved = person.freedom_year - person.birth_year;
                } else if (person.birth_year && person.death_year) {
                    yearsEnslaved = person.death_year - person.birth_year;
                }
                
                return {
                    ...person,
                    years_enslaved: Math.max(1, yearsEnslaved), // At least 1 year
                    start_year: person.birth_year || 1800,
                    end_year: person.freedom_year || person.death_year || 1865
                };
            });

            // Get primary source documents for this enslaver
            const primarySources = await this.getPrimarySourcesForEnslaver(slaveholder.slaveholder_id);

            slaveholderData.push({
                slaveholder,
                enslavedPersons,
                primarySources
            });
        }

        return slaveholderData;
    }

    /**
     * Get primary source documents for an enslaver
     */
    async getPrimarySourcesForEnslaver(enslaverId) {
        const result = await this.db.query(`
            SELECT DISTINCT
                pd.s3_url,
                pd.source_url as document_source_url,
                pd.document_type,
                pd.collection_name,
                pd.film_number,
                pd.image_number
            FROM person_documents pd
            WHERE pd.canonical_person_id = $1
              AND pd.s3_url IS NOT NULL
            ORDER BY pd.document_type, pd.film_number, pd.image_number
        `, [enslaverId]);

        return result.rows.map(doc => ({
            s3_url: doc.s3_url,
            document_source_url: doc.document_source_url,
            document_type: doc.document_type,
            collection_name: doc.collection_name,
            film_number: doc.film_number,
            image_number: doc.image_number,
            source_url: doc.document_source_url
        }));
    }

    /**
     * Aggregate unique primary sources across enslaved persons
     */
    aggregatePrimarySources(enslavedPersons) {
        const sources = new Map();

        for (const person of enslavedPersons) {
            if (person.s3_url) {
                const key = person.s3_url;
                if (!sources.has(key)) {
                    sources.set(key, {
                        s3_url: person.s3_url,
                        document_source_url: person.document_source_url,
                        document_type: person.document_type,
                        collection_name: person.collection_name,
                        film_number: person.film_number,
                        image_number: person.image_number,
                        source_url: person.source_url
                    });
                }
            }
        }

        return Array.from(sources.values());
    }

    /**
     * Calculate total debt across all slaveholders
     */
    async calculateTotalDebt(slaveholderData, annualIncome) {
        let totalDebt = 0;
        const slaveholderCalculations = [];

        for (const data of slaveholderData) {
            const enslavedForCalculation = data.enslavedPersons.map(person => ({
                name: person.enslaved_name,
                yearsEnslaved: person.years_enslaved,
                startYear: person.start_year || 1800, // Default if unknown
                relationship: person.relationship_type
            }));

            // Use DAAGenerator to calculate debt
            const preview = this.daaGenerator.calculatePreview(
                enslavedForCalculation,
                annualIncome
            );

            slaveholderCalculations.push({
                slaveholder: data.slaveholder,
                debt: preview.totalDebt,
                enslavedCount: enslavedForCalculation.length,
                calculations: preview.calculations
            });

            totalDebt += preview.totalDebt;
        }

        const annualPayment = Math.round(annualIncome * 0.02 * 100) / 100;

        return {
            totalDebt,
            annualPayment,
            annualIncome,
            slaveholderCalculations,
            totalEnslavedCount: slaveholderData.reduce((sum, d) => sum + d.enslavedPersons.length, 0)
        };
    }

    /**
     * Create comprehensive DAA database record
     */
    async createDAARecord(climbSession, acknowledgerInfo, slaveholderData, debtCalculation) {
        // For now, we'll create individual DAA records per slaveholder
        // Future enhancement: Multi-slaveholder DAA support
        
        const mainSlaveholder = slaveholderData[0]; // Primary/first slaveholder
        
        // Prepare all enslaved persons across all slaveholders
        const allEnslavedPersons = [];
        for (const data of slaveholderData) {
            for (const person of data.enslavedPersons) {
                allEnslavedPersons.push({
                    name: person.enslaved_name,
                    yearsEnslaved: person.years_enslaved,
                    startYear: person.start_year || 1800,
                    relationship: `enslaved_by_${data.slaveholder.slaveholder_name}`
                });
            }
        }

        // Get primary source for main slaveholder
        const primarySource = mainSlaveholder.primarySources[0] || {};

        // Generate DAA
        const daaResult = await this.daaGenerator.generateDAA({
            acknowledgerName: acknowledgerInfo.name,
            acknowledgerEmail: acknowledgerInfo.email,
            acknowledgerAddress: acknowledgerInfo.address,
            slaveholderName: mainSlaveholder.slaveholder.slaveholder_name,
            slaveholderCanonicalId: mainSlaveholder.slaveholder.slaveholder_id,
            slaveholderFamilySearchId: mainSlaveholder.slaveholder.slaveholder_fs_id,
            primarySourceArk: primarySource.ark,
            primarySourceArchive: primarySource.collection_name,
            primarySourceReference: `Film ${primarySource.film_number}, Image ${primarySource.image_number}`,
            primarySourceDate: null, // Would need to extract from document
            primarySourceType: primarySource.document_type,
            generationFromSlaveholder: mainSlaveholder.slaveholder.generation_distance,
            annualIncome: acknowledgerInfo.annualIncome,
            enslavedPersons: allEnslavedPersons,
            notes: `Comprehensive DAA generated from ancestor climb session ${climbSession.id}. Includes ${slaveholderData.length} slaveholder(s) and ${allEnslavedPersons.length} documented enslaved person(s).`
        });

        // Store slaveholder breakdown in notes for now
        // TODO: Use multi-slaveholder schema once migration 029 is run
        await this.db.query(`
            UPDATE debt_acknowledgment_agreements
            SET calculation_breakdown = jsonb_set(
                calculation_breakdown,
                '{slaveholder_breakdown}',
                $2::jsonb
            )
            WHERE daa_id = $1
        `, [
            daaResult.daaId,
            JSON.stringify(debtCalculation.slaveholderCalculations)
        ]);

        return daaResult;
    }
}

module.exports = DAAOrchestrator;
