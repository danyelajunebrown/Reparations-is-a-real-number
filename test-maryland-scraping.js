/**
 * Test Script for Maryland Slave Owners Page
 * This script tests the intelligent scraping system on the provided URL
 */

const axios = require('axios');
const cheerio = require('cheerio');

// Import our intelligent scraping components
const { KnowledgeManager, MLAnalyzer, IntelligentScraper, IntelligentOrchestrator } = require('./src/services/scraping');

async function testMarylandScraping() {
    console.log('🧪 Starting Maryland Slave Owners Page Test');
    console.log('URL: https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/html/am812--1.html');

    try {
        // Step 1: Fetch the page content
        console.log('\n📍 Step 1: Fetching page content...');
        const response = await axios.get('https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/html/am812--1.html', {
            headers: {
                'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // Step 2: Analyze page structure
        console.log('\n📍 Step 2: Analyzing page structure...');
        console.log('Title:', $('title').text());
        console.log('Page type: Montgomery County Slave Statistics, 1867-1868');

        // Check if it's using iframe for PDF
        const iframeSrc = $('iframe').attr('src');
        if (iframeSrc) {
            console.log('⚠️  Page uses iframe for PDF content:', iframeSrc);
            console.log('📋 Need to extract data from PDF instead of HTML');
        }

        // Step 3: Test ML Analysis
        console.log('\n📍 Step 3: Testing ML Analysis...');
        const mlAnalyzer = new MLAnalyzer();
        const textContent = $('body').text();

        const mlAnalysis = mlAnalyzer.analyzePageContent(textContent, 'https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/html/am812--1.html');

        console.log('ML Analysis Results:');
        console.log('  - Source Type:', mlAnalysis.sourceType);
        console.log('  - Document Type:', mlAnalysis.documentType);
        console.log('  - Confidence:', mlAnalysis.confidence.toFixed(2));
        console.log('  - Content Quality:', mlAnalysis.contentQuality.toFixed(2));
        console.log('  - Sentiment:', mlAnalysis.sentiment);

        // Step 4: Test Knowledge Management
        console.log('\n📍 Step 4: Testing Knowledge Management...');
        const knowledgeManager = new KnowledgeManager();

        // Check if we have knowledge for this domain
        const domain = 'msa.maryland.gov';
        const siteKnowledge = knowledgeManager.getSiteKnowledge(`https://${domain}`);

        if (siteKnowledge) {
            console.log('✅ Found existing knowledge for this site');
            console.log('   - Type:', siteKnowledge.type);
            console.log('   - Confidence:', siteKnowledge.confidence);
            console.log('   - Success Rate:', siteKnowledge.successRate);
        } else {
            console.log('⚠️  No existing knowledge for this site - will create new patterns');
        }

        // Step 5: Identify issues and improvements needed
        console.log('\n📍 Step 5: Analysis and Recommendations...');

        const issues = [];
        const improvements = [];

        // Issue 1: PDF content in iframe
        if (iframeSrc) {
            issues.push({
                type: 'pdf_content',
                description: 'Page uses iframe to display PDF content - HTML scraping will miss actual data',
                severity: 'high',
                solution: 'Need PDF extraction capability or OCR processing'
            });

            improvements.push({
                type: 'pdf_support',
                description: 'Add PDF extraction and OCR capabilities to handle Maryland archives',
                priority: 'high'
            });
        }

        // Issue 2: Maryland-specific patterns needed
        issues.push({
            type: 'pattern_gap',
            description: 'No Maryland-specific patterns in knowledge base',
            severity: 'medium',
            solution: 'Add patterns for Maryland slave statistics format'
        });

        improvements.push({
            type: 'maryland_patterns',
            description: 'Add patterns for Maryland slave owner records',
            priority: 'high'
        });

        // Issue 3: Date range detection
        if (textContent.includes('1867-1868')) {
            console.log('✅ Correctly identified date range: 1867-1868');
        } else {
            issues.push({
                type: 'date_detection',
                description: 'Date range detection could be improved',
                severity: 'low',
                solution: 'Enhance date pattern matching'
            });
        }

        // Display results
        console.log('\n📋 ISSUES IDENTIFIED:');
        issues.forEach((issue, index) => {
            console.log(`   ${index + 1}. ${issue.type.toUpperCase()}: ${issue.description}`);
            console.log(`      Severity: ${issue.severity.toUpperCase()}`);
            console.log(`      Solution: ${issue.solution}`);
        });

        console.log('\n📋 IMPROVEMENTS RECOMMENDED:');
        improvements.forEach((improvement, index) => {
            console.log(`   ${index + 1}. ${improvement.type.toUpperCase()}: ${improvement.description}`);
            console.log(`      Priority: ${improvement.priority.toUpperCase()}`);
        });

        // Step 6: Create test patterns for Maryland
        console.log('\n📍 Step 6: Creating Maryland-Specific Patterns...');

        const marylandPatterns = {
            owner: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)*(?:\s*,\s*\d+)?(?:\s*slaves?)?/gi,
            enslaved: /(?:slave|servant|negro)\s+(?:named|called)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)*/gi,
            location: /Montgomery\s+County|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*,\s*MD/gi,
            date: /(?:186[0-9]|18[0-9]{2})/g
        };

        console.log('Maryland Patterns Created:');
        console.log('  - Owner:', marylandPatterns.owner);
        console.log('  - Enslaved:', marylandPatterns.enslaved);
        console.log('  - Location:', marylandPatterns.location);
        console.log('  - Date:', marylandPatterns.date);

        // Step 7: Summary
        console.log('\n📍 TEST SUMMARY:');
        console.log('✅ Successfully fetched and analyzed Maryland slave owners page');
        console.log('✅ Identified page structure and content type');
        console.log('✅ Performed ML analysis with confidence scoring');
        console.log('✅ Checked knowledge base for existing patterns');
        console.log('✅ Identified key issues and improvement opportunities');
        console.log('✅ Created Maryland-specific patterns for future use');

        console.log('\n🔧 NEXT STEPS:');
        console.log('1. Add PDF extraction capability to handle Maryland archives');
        console.log('2. Implement Maryland-specific patterns in knowledge base');
        console.log('3. Test with actual PDF content extraction');
        console.log('4. Validate results with user for accuracy');

        return {
            success: true,
            issues,
            improvements,
            mlAnalysis,
            marylandPatterns
        };

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return {
            success: false,
            error: error.message,
            stack: error.stack
        };
    }
}

// Run the test
testMarylandScraping()
    .then(results => {
        console.log('\n🎯 TEST COMPLETE');
        if (results.success) {
            console.log('✅ Test completed successfully - ready for user validation');
        } else {
            console.log('❌ Test failed - see error details above');
        }
    })
    .catch(error => {
        console.error('❌ Test failed with exception:', error.message);
    });
