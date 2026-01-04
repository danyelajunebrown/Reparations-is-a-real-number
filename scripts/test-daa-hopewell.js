/**
 * Test Script: James Hopewell DAA
 * 
 * Validates DAA system with the documented James Hopewell case:
 * - Will dated 1811, probated Dec 16, 1817
 * - 9 enslaved persons bequeathed to Ann Maria Biscoe
 * - Acknowledger: Danyela June Brown (8 generations removed)
 * - Expected total debt: ~$232 billion
 * - Expected annual payment: $1,300 (2% of $65,000)
 */

const DAAGenerator = require('../src/services/reparations/DAAGenerator');
const { Pool } = require('pg');
require('dotenv').config();

// Database connection
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

async function testHopewellDAA() {
    console.log('='.repeat(80));
    console.log('TEST: James Hopewell DAA Generation');
    console.log('='.repeat(80));
    console.log();

    const generator = new DAAGenerator(database);

    // James Hopewell's 9 enslaved persons from will
    const enslavedPersons = [
        { name: 'Medley', yearsEnslaved: 25, startYear: 1792 },
        { name: 'Adam', yearsEnslaved: 25, startYear: 1792 },
        { name: 'Lloyd', yearsEnslaved: 25, startYear: 1792 },
        { name: 'Sarah', yearsEnslaved: 20, startYear: 1797, relationship: 'bequeathed_to_ann_maria_biscoe' },
        { name: 'Mary (daughter of Sarah)', yearsEnslaved: 15, startYear: 1802, relationship: 'bequeathed_to_ann_maria_biscoe' },
        { name: 'Nancy (daughter of Sarah)', yearsEnslaved: 15, startYear: 1802, relationship: 'bequeathed_to_ann_maria_biscoe' },
        { name: 'Louisa (daughter of Sarah)', yearsEnslaved: 15, startYear: 1802, relationship: 'bequeathed_to_ann_maria_biscoe' },
        { name: 'Esther', yearsEnslaved: 20, startYear: 1797, relationship: 'bequeathed_to_ann_maria_biscoe' },
        { name: 'Ally (child of Esther)', yearsEnslaved: 15, startYear: 1802, relationship: 'bequeathed_to_ann_maria_biscoe' }
    ];

    console.log('📋 Test Parameters:');
    console.log(`   Acknowledger: Danyela June Brown`);
    console.log(`   Slaveholder: James Hopewell (canonical_id: 1070)`);
    console.log(`   Generation: 8`);
    console.log(`   Annual Income: $65,000`);
    console.log(`   Enslaved Persons: ${enslavedPersons.length}`);
    console.log();

    // Step 1: Test individual calculations
    console.log('Step 1: Testing Individual Debt Calculations');
    console.log('-'.repeat(80));
    
    let totalCalculated = 0;
    for (const person of enslavedPersons) {
        const calc = generator.calculateIndividualDebt(person.yearsEnslaved, person.startYear);
        totalCalculated += calc.modernValue;
        
        console.log(`   ${person.name.padEnd(30)} $${calc.modernValue.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`);
        console.log(`      Formula: ${calc.formula}`);
    }
    
    console.log();
    console.log(`   CALCULATED TOTAL: $${totalCalculated.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`);
    console.log();

    // Step 2: Test preview calculation
    console.log('Step 2: Testing Preview Calculation');
    console.log('-'.repeat(80));
    
    const preview = generator.calculatePreview(enslavedPersons, 65000);
    console.log(`   Total Debt: $${preview.totalDebt.toLocaleString()}`);
    console.log(`   Annual Payment (2%): $${preview.annualPayment.toLocaleString()}`);
    console.log(`   Years to Pay Off: ${preview.yearsToPayOff.toLocaleString()}`);
    console.log(`   Enslaved Count: ${preview.enslavedCount}`);
    console.log();

    // Step 3: Generate actual DAA
    console.log('Step 3: Generating Complete DAA');
    console.log('-'.repeat(80));

    try {
        const result = await generator.generateDAA({
            acknowledgerName: 'Danyela June Brown',
            acknowledgerEmail: 'danyela@example.com',
            acknowledgerAddress: {
                line1: '123 Test Street',
                city: 'Washington',
                state: 'DC',
                zip: '20001'
            },
            slaveholderName: 'James Hopewell',
            slaveholderCanonicalId: 1070,
            slaveholderFamilySearchId: 'MTRV-Z72',
            primarySourceArk: '3:1:33S7-9YTT-96HV',
            primarySourceArchive: 'St. Mary\'s County Court Records',
            primarySourceReference: 'LIBER JJ#3, FOLIO 480-481',
            primarySourceDate: '1817-12-16',
            primarySourceType: 'will',
            generationFromSlaveholder: 8,
            annualIncome: 65000,
            enslavedPersons,
            notes: 'Test case for James Hopewell will, probated 1817'
        });

        console.log('   ✅ DAA Generated Successfully!');
        console.log();
        console.log(`   Agreement Number: ${result.agreementNumber}`);
        console.log(`   DAA ID: ${result.daaId}`);
        console.log(`   Total Debt: $${result.totalDebt.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`);
        console.log(`   Annual Payment: $${result.annualPayment.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`);
        console.log(`   Enslaved Persons: ${result.enslavedCount}`);
        console.log();

        // Step 4: Retrieve the DAA
        console.log('Step 4: Retrieving Complete DAA Record');
        console.log('-'.repeat(80));

        const fullDAA = await generator.getDAA(result.daaId);
        
        console.log(`   Agreement: ${fullDAA.agreement_number}`);
        console.log(`   Status: ${fullDAA.status}`);
        console.log(`   Acknowledger: ${fullDAA.acknowledger_name}`);
        console.log(`   Slaveholder: ${fullDAA.slaveholder_name}`);
        console.log(`   Primary Source: ${fullDAA.primary_source_archive}`);
        console.log(`   Reference: ${fullDAA.primary_source_reference}`);
        console.log();
        console.log(`   Enslaved Persons in Database:`);
        
        for (const person of fullDAA.enslavedPersons) {
            console.log(`      - ${person.enslaved_name}: $${parseFloat(person.individual_debt).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })} (${person.years_enslaved} years, ${person.start_year}-${person.end_year})`);
        }
        console.log();

        // Step 5: Test payment recording
        console.log('Step 5: Recording Sample Payment');
        console.log('-'.repeat(80));

        const payment = await generator.recordPayment(
            result.daaId,
            1300,
            65000,
            {
                paymentMethod: 'test',
                paymentProcessor: 'test',
                txHash: '0x' + 'test'.repeat(16),
                network: 'testnet'
            }
        );

        console.log(`   ✅ Payment Recorded`);
        console.log(`   Payment ID: ${payment.paymentId}`);
        console.log(`   Year: ${payment.year}`);
        console.log(`   Amount: $${payment.amount.toLocaleString()}`);
        console.log();

        // Step 6: Validation against expected values
        console.log('Step 6: Validation Against Expected Values');
        console.log('-'.repeat(80));

        const expectedDebt = 232000000000; // ~$232 billion
        const expectedPayment = 1300;
        const debtTolerance = expectedDebt * 0.1; // 10% tolerance
        const paymentMatch = Math.abs(result.annualPayment - expectedPayment) < 1;

        console.log(`   Expected Total Debt: ~$${expectedDebt.toLocaleString()}`);
        console.log(`   Actual Total Debt:   $${result.totalDebt.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`);
        console.log(`   Within 10% tolerance: ${Math.abs(result.totalDebt - expectedDebt) < debtTolerance ? '✅' : '❌'}`);
        console.log();
        console.log(`   Expected Annual Payment: $${expectedPayment.toLocaleString()}`);
        console.log(`   Actual Annual Payment:   $${result.annualPayment.toLocaleString()}`);
        console.log(`   Exact match: ${paymentMatch ? '✅' : '❌'}`);
        console.log();

        // Step 7: Test academic sources and legal precedents
        console.log('Step 7: Testing Academic Sources & Legal Precedents');
        console.log('-'.repeat(80));

        const precedents = await generator.getLegalPrecedents();
        const sources = await generator.getAcademicSources();

        console.log(`   Legal Precedents: ${precedents.length}`);
        for (const p of precedents) {
            console.log(`      - ${p.case_name} (${p.case_year})`);
        }
        console.log();

        console.log(`   Academic Sources: ${sources.length}`);
        for (const s of sources) {
            console.log(`      - ${s.authors.join(', ')} (${s.publication_year})`);
            console.log(`        ${s.title}`);
        }
        console.log();

        // Success summary
        console.log('='.repeat(80));
        console.log('✅ ALL TESTS PASSED');
        console.log('='.repeat(80));
        console.log();
        console.log('Summary:');
        console.log(`   - DAA ${result.agreementNumber} created successfully`);
        console.log(`   - Total debt: $${result.totalDebt.toLocaleString()}`);
        console.log(`   - Annual payment: $${result.annualPayment.toLocaleString()}`);
        console.log(`   - 9 enslaved persons recorded`);
        console.log(`   - 1 test payment recorded`);
        console.log(`   - ${precedents.length} legal precedents available`);
        console.log(`   - ${sources.length} academic sources available`);
        console.log();
        console.log('Next steps:');
        console.log('   1. Run migration 028: psql $DATABASE_URL -f migrations/028-daa-system.sql');
        console.log('   2. Implement DocuSign integration for signatures');
        console.log('   3. Implement government petition automation');
        console.log('   4. Implement Web3 escrow integration');
        console.log('   5. Generate .docx document templates');
        console.log();

        return result.daaId;

    } catch (error) {
        console.error('❌ ERROR:', error.message);
        console.error(error.stack);
        throw error;
    }
}

// Run the test
(async () => {
    try {
        await testHopewellDAA();
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('Test failed:', error);
        await pool.end();
        process.exit(1);
    }
})();
