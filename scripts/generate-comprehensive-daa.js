#!/usr/bin/env node
/**
 * Generate Comprehensive DAA
 * 
 * Orchestrates the complete DAA generation process:
 * 1. Checks for completed ancestor climb session
 * 2. Aggregates all documented slaveholders and enslaved persons
 * 3. Calculates total debt
 * 4. Generates database record
 * 5. Creates DOCX document
 * 
 * Usage:
 *   node scripts/generate-comprehensive-daa.js --fs-id G21N-4JF --name "Nancy Brown" --email nancy@example.com --income 65000
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const DAAGenerator = require('../src/services/reparations/DAAGenerator');
const DAAOrchestrator = require('../src/services/reparations/DAAOrchestrator');
const DAADocumentGenerator = require('../src/services/reparations/DAADocumentGenerator');

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const params = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].substring(2);
            const value = args[i + 1];
            params[key] = value;
            i++;
        }
    }

    return params;
}

// Validate required parameters
function validateParams(params) {
    const required = ['fs-id', 'name', 'income'];
    const missing = required.filter(key => !params[key]);

    if (missing.length > 0) {
        console.error('Error: Missing required parameters:', missing.join(', '));
        console.error();
        console.error('Usage:');
        console.error('  node scripts/generate-comprehensive-daa.js \\');
        console.error('    --fs-id <FamilySearch_ID> \\');
        console.error('    --name "<Full Name>" \\');
        console.error('    --email <email@example.com> \\');
        console.error('    --income <annual_income> \\');
        console.error('    [--address-line1 "<address>"] \\');
        console.error('    [--address-city "<city>"] \\');
        console.error('    [--address-state "<state>"] \\');
        console.error('    [--address-zip "<zip>"]');
        console.error();
        console.error('Example:');
        console.error('  node scripts/generate-comprehensive-daa.js \\');
        console.error('    --fs-id G21N-4JF \\');
        console.error('    --name "Nancy Brown" \\');
        console.error('    --email "nancy@example.com" \\');
        console.error('    --income 65000');
        process.exit(1);
    }

    // Validate FamilySearch ID format
    const fsIdPattern = /^[A-Z0-9]{4,7}-[A-Z0-9]{2,4}$/;
    if (!fsIdPattern.test(params['fs-id'])) {
        console.error(`Error: Invalid FamilySearch ID format: ${params['fs-id']}`);
        console.error('Expected format: XXXX-XXX (e.g., G21N-4JF)');
        process.exit(1);
    }

    // Validate income is a positive number
    const income = parseInt(params.income);
    if (isNaN(income) || income <= 0) {
        console.error(`Error: Income must be a positive number: ${params.income}`);
        process.exit(1);
    }

    return true;
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   COMPREHENSIVE DAA GENERATION SYSTEM');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log();

    // Parse and validate arguments
    const params = parseArgs();
    validateParams(params);

    const familySearchId = params['fs-id'];
    const acknowledgerName = params['name'];
    const acknowledgerEmail = params['email'] || null;
    const annualIncome = parseInt(params['income']);

    // Optional address
    const address = (params['address-line1'] || params['address-city']) ? {
        line1: params['address-line1'] || '',
        city: params['address-city'] || '',
        state: params['address-state'] || '',
        zip: params['address-zip'] || ''
    } : null;

    console.log('Parameters:');
    console.log(`   FamilySearch ID: ${familySearchId}`);
    console.log(`   Name: ${acknowledgerName}`);
    console.log(`   Email: ${acknowledgerEmail || 'Not provided'}`);
    console.log(`   Annual Income: $${annualIncome.toLocaleString()}`);
    if (address && address.line1) {
        console.log(`   Address: ${address.line1}, ${address.city}, ${address.state} ${address.zip}`);
    }
    console.log();

    // Setup database connection
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes('render.com') || process.env.DATABASE_URL?.includes('neon.tech')
            ? { rejectUnauthorized: false }
            : false
    });

    const database = {
        query: (text, params) => pool.query(text, params),
        connect: () => pool.connect()
    };

    try {
        // Initialize services
        const daaGenerator = new DAAGenerator(database);
        const documentGenerator = new DAADocumentGenerator();
        const orchestrator = new DAAOrchestrator(database, daaGenerator, documentGenerator);

        // Prepare acknowledger info
        const acknowledgerInfo = {
            name: acknowledgerName,
            email: acknowledgerEmail,
            address,
            annualIncome
        };

        // Generate comprehensive DAA
        const result = await orchestrator.generateComprehensiveDAA(
            familySearchId,
            acknowledgerInfo
        );

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('   ✅ SUCCESS');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log();
        console.log('Generated Files:');
        console.log(`   • DOCX: ${result.docxPath}`);
        console.log();
        console.log('Database Records:');
        console.log(`   • DAA ID: ${result.daaRecord.daaId}`);
        console.log(`   • Agreement Number: ${result.daaRecord.agreementNumber}`);
        console.log();
        console.log('Summary:');
        console.log(`   • Slaveholders: ${result.slaveholderData.length}`);
        console.log(`   • Enslaved Persons: ${result.debtCalculation.totalEnslavedCount}`);
        console.log(`   • Total Debt: $${result.debtCalculation.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(`   • Annual Payment: $${result.debtCalculation.annualPayment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log();
        console.log('Next Steps:');
        console.log(`   1. Review the generated DOCX document`);
        console.log(`   2. Open with: open "${result.docxPath}"`);
        console.log(`   3. Verify all slaveholders and enslaved persons are included`);
        console.log(`   4. Check primary source links in exhibits`);
        console.log();

        await pool.end();
        process.exit(0);

    } catch (error) {
        console.error('═══════════════════════════════════════════════════════════════');
        console.error('   ❌ ERROR');
        console.error('═══════════════════════════════════════════════════════════════');
        console.error();
        console.error(error.message);
        console.error();

        if (error.message.includes('Ancestor climb required')) {
            console.error('Action Required:');
            console.error(`   Run ancestor climb first:`);
            console.error(`   FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js ${familySearchId} --name "${acknowledgerName}"`);
            console.error();
            console.error('   Then re-run this script.');
        } else if (error.message.includes('No documented slaveholders')) {
            console.error('Issue: No slaveholders with primary source documentation found.');
            console.error();
            console.error('Possible causes:');
            console.error('   1. Ancestor climb found matches but they lack primary sources');
            console.error('   2. enslaved_owner_relationships table not populated');
            console.error('   3. person_documents table missing FamilySearch ARKs');
            console.error();
            console.error('Action Required:');
            console.error('   1. Check ancestor_climb_matches table for this person');
            console.error('   2. Verify slaveholder records have primary sources linked');
            console.error('   3. Run: SELECT * FROM ancestor_climb_matches WHERE modern_person_fs_id = \'' + familySearchId + '\';');
        } else {
            console.error('Stack trace:');
            console.error(error.stack);
        }
        console.error();

        await pool.end();
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { parseArgs, validateParams };
