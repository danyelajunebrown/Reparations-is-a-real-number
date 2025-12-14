/**
 * Test Universal Router Integration
 * 
 * Tests the new universal-extract endpoint with various URL types
 */

require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

async function testUniversalRouter() {
    console.log('\n' + '='.repeat(70));
    console.log('🧪 TESTING UNIVERSAL URL ROUTER');
    console.log('='.repeat(70) + '\n');

    const testCases = [
        {
            name: 'Rootsweb Census (should execute immediately)',
            url: 'https://freepages.rootsweb.com/~ajac/genealogy/aldallas.htm',
            expectedExecution: 'immediate',
            expectedCategory: 'rootsweb_census'
        },
        {
            name: 'Beyond Kin (should execute immediately)',
            url: 'https://www.beyondkin.org/example',
            expectedExecution: 'immediate',
            expectedCategory: 'beyondkin'
        },
        {
            name: 'Civil War DC (should execute immediately)',
            url: 'https://www.civilwardc.org/texts/petitions/example',
            expectedExecution: 'immediate',
            expectedCategory: 'civilwardc'
        },
        {
            name: 'FamilySearch Film (should queue - needs auth)',
            url: 'https://www.familysearch.org/ark:/61903/3:1:example',
            expectedExecution: 'queued',
            expectedCategory: 'familysearch'
        }
    ];

    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
        console.log(`\n📝 Test: ${testCase.name}`);
        console.log(`   URL: ${testCase.url}`);

        try {
            const response = await axios.post(`${API_BASE}/api/contribute/universal-extract`, {
                url: testCase.url,
                metadata: {
                    title: `Test: ${testCase.name}`
                }
            });

            const result = response.data;

            // Check if execution strategy matches expected
            const executionType = result.immediate ? 'immediate' : 'queued';
            const executionMatch = executionType === testCase.expectedExecution;

            // Check routing information
            const category = result.routing?.scraper?.category;
            const categoryMatch = category === testCase.expectedCategory;

            console.log(`   Execution: ${executionType} ${executionMatch ? '✅' : '❌'}`);
            console.log(`   Category: ${category} ${categoryMatch ? '✅' : '❌'}`);
            console.log(`   Source Type: ${result.routing?.classification?.sourceType}`);
            console.log(`   Confidence: ${result.routing?.classification?.confidence}`);

            if (result.immediate) {
                console.log(`   Results: ${result.extraction?.ownersFound || 0} owners, ${result.extraction?.enslavedFound || 0} enslaved`);
            } else if (result.queued) {
                console.log(`   Queue ID: ${result.queueId}`);
                console.log(`   Estimated Wait: ${result.estimatedWait}`);
            }

            if (executionMatch && categoryMatch) {
                console.log(`   ✅ PASSED`);
                passed++;
            } else {
                console.log(`   ❌ FAILED`);
                failed++;
            }

        } catch (error) {
            console.log(`   ❌ ERROR: ${error.message}`);
            if (error.response) {
                console.log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
            }
            failed++;
        }

        // Wait between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`   Passed: ${passed}/${testCases.length}`);
    console.log(`   Failed: ${failed}/${testCases.length}`);
    console.log(`   Success Rate: ${Math.round((passed / testCases.length) * 100)}%`);
    console.log('='.repeat(70) + '\n');

    if (failed === 0) {
        console.log('🎉 All tests passed! Universal Router is working correctly.\n');
        process.exit(0);
    } else {
        console.log('⚠️  Some tests failed. Review errors above.\n');
        process.exit(1);
    }
}

// Run tests
testUniversalRouter().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
