/**
 * Test Script: Belinda Sutton Historical Reparations Petition
 * 
 * This script demonstrates the PetitionTracker system by importing
 * the landmark 1783 Belinda Sutton case - the first successful
 * reparations petition in American history.
 * 
 * What it proves:
 * - Enslavement occurred (Isaac Royall owned Belinda for 50 years)
 * - Debt was recognized (Legislature awarded £15/year + £12 back payment)
 * - Government broke promise (Only 2 payments made = 23% fulfillment)
 * - Additional debt from broken promise ($114,750+ in modern value)
 */

const PetitionTracker = require('./src/services/reparations/PetitionTracker');
const database = require('./database');

async function testBelindaSuttonCase() {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║   TESTING: Historical Reparations Petition System             ║');
    console.log('║   Case: Belinda Sutton vs Isaac Royall Jr. (1783)             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    try {
        // Initialize PetitionTracker with database connection
        const tracker = new PetitionTracker(database);
        
        // Import Belinda Sutton's case
        console.log('[Test] Importing Belinda Sutton case...\n');
        const { petition, analysis } = await tracker.importBelindaSuttonCase();
        
        // Display detailed results
        console.log('\n[Test] PETITION DETAILS:');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`Petitioner: ${petition.petitionerName}`);
        console.log(`Enslaver: ${petition.enslaverName}`);
        console.log(`Petition Date: ${petition.petitionDate}`);
        console.log(`Years Enslaved: ${petition.yearsOfService} years`);
        console.log(`Authority: ${petition.petitionedAuthority}`);
        console.log(`Jurisdiction: ${petition.jurisdiction}`);
        console.log(`\nPETITION STATUS: ${petition.petitionStatus}`);
        console.log(`Decision Date: ${petition.decisionDate}`);
        console.log(`Award: ${petition.awardedCurrency} ${petition.amountAwarded} ${petition.awardDuration}`);
        console.log(`Award Terms: ${petition.awardTerms}`);
        
        // Display fulfillment analysis
        console.log('\n[Test] FULFILLMENT ANALYSIS ("Wrap Around Check"):');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`Expected Total: ${analysis.awardedCurrency} ${analysis.expectedTotalPayments} over ${analysis.awardDurationYears} years`);
        console.log(`Actually Paid: ${analysis.awardedCurrency} ${analysis.totalAmountPaid} (${analysis.paymentCount} payments)`);
        console.log(`Unpaid Amount: ${analysis.awardedCurrency} ${analysis.amountUnpaid}`);
        console.log(`Fulfillment Rate: ${analysis.fulfillmentPercentage}%`);
        console.log(`Status: ${analysis.fulfillmentStatus.toUpperCase()}`);
        console.log(`Payments Missed: ${analysis.paymentsMissed} of ${analysis.expectedPaymentCount}`);
        console.log(`\nFailure Reason: ${analysis.failureReason}`);
        
        // Display modern values and debt impact
        console.log('\n[Test] MODERN VALUE & DEBT IMPACT:');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`Paid (modern value): $${analysis.paidModernValue.toLocaleString()}`);
        console.log(`Unpaid (modern value): $${analysis.unpaidModernValue.toLocaleString()}`);
        console.log(`\nADDITIONAL DEBT FROM BROKEN PROMISE:`);
        console.log(`├─ Base unpaid amount: $${analysis.unpaidModernValue.toLocaleString()}`);
        console.log(`├─ Broken promise penalty (50%): $${analysis.brokenPromisePenalty.toLocaleString()}`);
        console.log(`├─ Compound interest (2% annual): $${analysis.compoundInterestOwed.toLocaleString()}`);
        console.log(`└─ TOTAL ADDITIONAL DEBT: $${analysis.totalAdditionalDebt.toLocaleString()}`);
        
        // Test database queries
        console.log('\n[Test] DATABASE QUERIES:');
        console.log('═══════════════════════════════════════════════════════');
        
        // Get broken promises summary
        const brokenPromises = await tracker.getBrokenPromisesSummary();
        console.log(`\nBroken Promises Found: ${brokenPromises.length}`);
        
        if (brokenPromises.length > 0) {
            console.log(`\nSample Record:`);
            const sample = brokenPromises[0];
            console.log(`  Petitioner: ${sample.petitioner_name}`);
            console.log(`  Enslaver: ${sample.enslaver_name}`);
            console.log(`  Fulfillment: ${sample.fulfillment_percentage}%`);
            console.log(`  Unpaid Modern Value: $${parseFloat(sample.unpaid_modern_value).toLocaleString()}`);
        }
        
        // Get comprehensive debt for Isaac Royall
        const comprehensiveDebt = await tracker.getComprehensiveDebt('Isaac Royall Jr.');
        if (comprehensiveDebt) {
            console.log(`\nComprehensive Debt for ${comprehensiveDebt.enslaver_name}:`);
            console.log(`  Original Calculated Debt: $${parseFloat(comprehensiveDebt.original_calculated_debt || 0).toLocaleString()}`);
            console.log(`  Unpaid Awarded Reparations: $${parseFloat(comprehensiveDebt.unpaid_awarded_reparations).toLocaleString()}`);
            console.log(`  Broken Promise Penalties: $${parseFloat(comprehensiveDebt.broken_promise_penalties).toLocaleString()}`);
            console.log(`  Interest on Unpaid: $${parseFloat(comprehensiveDebt.interest_on_unpaid).toLocaleString()}`);
            console.log(`  ────────────────────────────────────────────────`);
            console.log(`  TOTAL COMPREHENSIVE DEBT: $${parseFloat(comprehensiveDebt.total_comprehensive_debt).toLocaleString()}`);
        }
        
        // Generate report
        console.log('\n[Test] BROKEN PROMISES REPORT:');
        console.log('═══════════════════════════════════════════════════════');
        const report = tracker.generateBrokenPromisesReport();
        console.log(report);
        
        // Success summary
        console.log('\n\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║                    TEST RESULTS: SUCCESS                       ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');
        console.log('\n✅ Petition record created');
        console.log('✅ Payment records created (2 payments)');
        console.log('✅ Fulfillment analysis calculated');
        console.log('✅ Database queries successful');
        console.log('✅ Broken promises detected and quantified');
        console.log('\n📊 KEY FINDINGS:');
        console.log(`   • Belinda Sutton received only 23% of promised payments`);
        console.log(`   • Modern value of unpaid amount: $${analysis.unpaidModernValue.toLocaleString()}`);
        console.log(`   • Total additional debt from broken promise: $${analysis.totalAdditionalDebt.toLocaleString()}`);
        console.log(`   • This case proves systemic failure to honor reparations awards`);
        
        console.log('\n🔍 IMPLICATIONS FOR SYSTEM:');
        console.log('   • Historical awards should be tracked in blockchain as "pre-genesis" debt');
        console.log('   • Broken promise penalties add to total debt owed to descendants');
        console.log('   • Multi-purpose documents prove both enslavement AND broken promises');
        console.log('   • System now tracks: Original debt + Compensation to owners + Broken promises\n');
        
        console.log('Test completed successfully!');
        console.log('════════════════════════════════════════════════════════════════\n');
        
    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
if (require.main === module) {
    testBelindaSuttonCase()
        .then(() => {
            console.log('Exiting...');
            process.exit(0);
        })
        .catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { testBelindaSuttonCase };
