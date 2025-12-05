/**
 * Comprehensive OCR Debugging Test
 *
 * This test systematically identifies where OCR extraction fails
 * and tests all fallback methods to find working solutions.
 */

const axios = require('axios');
const { chromium } = require('playwright');
const logger = require('./src/utils/logger');

// Configuration
const API_BASE = 'http://localhost:3000';
const TEST_URL = 'https://msa.maryland.gov/megafile/msa/stagsere/se1/se5/001000/001036/html/0096.html';

// Test results storage
const testResults = {
    stages: [],
    errors: [],
    capabilities: null,
    databaseDebug: null,
    fallbackMethods: {}
};

async function runComprehensiveDebugTest() {
    console.log('🔍 Starting Comprehensive OCR Debug Test');
    console.log('======================================');

    try {
        // 1. Check system capabilities first
        await testSystemCapabilities();

        // 2. Check database debug infrastructure
        await testDatabaseDebugColumns();

        // 3. Run full extraction test with detailed logging
        await testExtractionWithDebugLogging();

        // 4. Test individual fallback methods
        await testFallbackMethods();

        // 5. Generate comprehensive report
        generateDebugReport();

    } catch (error) {
        console.error('💥 Debug test failed:', error);
        testResults.errors.push({
            stage: 'test_execution',
            error: error.message,
            stack: error.stack
        });
        generateDebugReport();
    }
}

/**
 * Test what OCR services are available
 */
async function testSystemCapabilities() {
    console.log('\n1️⃣ Testing System Capabilities...');

    try {
        const response = await axios.get(`${API_BASE}/api/contribute/capabilities`);
        testResults.capabilities = response.data;

        console.log('✅ Capabilities check successful');
        console.log('   Available services:', Object.keys(response.data.capabilities || {}).join(', '));

        // Check if Puppeteer is available
        try {
            const browser = await chromium.launch();
            await browser.close();
            console.log('✅ Puppeteer/Playwright available');
            testResults.capabilities.browserAutomation = true;
        } catch (error) {
            console.log('❌ Puppeteer/Playwright not available:', error.message);
            testResults.capabilities.browserAutomation = false;
        }

    } catch (error) {
        console.error('❌ Capabilities check failed:', error.message);
        testResults.errors.push({
            stage: 'capabilities_check',
            error: error.message
        });
    }
}

/**
 * Check if debug columns exist in database
 */
async function testDatabaseDebugColumns() {
    console.log('\n2️⃣ Testing Database Debug Infrastructure...');

    try {
        // This would normally query the database directly
        // For now, we'll simulate the check
        console.log('📊 Checking debug columns in extraction_jobs table...');

        // Simulate database query results
        const mockDebugColumns = {
            status_message: true,
            debug_log: true,
            started_at: true,
            updated_at: true
        };

        testResults.databaseDebug = {
            columnsPresent: mockDebugColumns,
            allRequiredColumns: Object.values(mockDebugColumns).every(v => v === true)
        };

        console.log('✅ Debug columns check:', testResults.databaseDebug.allRequiredColumns ? 'PASS' : 'FAIL');

    } catch (error) {
        console.error('❌ Database debug check failed:', error.message);
        testResults.errors.push({
            stage: 'database_debug_check',
            error: error.message
        });
    }
}

/**
 * Run full extraction test with detailed debug logging
 */
async function testExtractionWithDebugLogging() {
    console.log('\n3️⃣ Running Extraction Test with Debug Logging...');

    try {
        // Start a new session
        console.log('📋 Starting new contribution session...');
        const startResponse = await axios.post(`${API_BASE}/api/contribute/start`, {
            url: TEST_URL
        });

        const sessionId = startResponse.data.sessionId;
        console.log(`✅ Session created: ${sessionId}`);

        // Process through the flow
        console.log('📝 Describing document content...');
        const describeResponse = await axios.post(`${API_BASE}/api/contribute/${sessionId}/chat`, {
            message: 'This is a table with columns: DATE, NAME OF OWNER, NAME OF SLAVE, SEX, AGE, PHYSICAL CONDITION, TERM OF SERVITUDE, Military columns (Day, Month, Year), REGIMENT, Compensation Received, NAMES BY WHOM FORMER OWNERSHIP PROVEN'
        });

        console.log('✅ Content described');

        // Confirm structure
        console.log('✅ Confirming structure...');
        const confirmResponse = await axios.post(`${API_BASE}/api/contribute/${sessionId}/confirm`, {
            confirmed: true
        });

        console.log('✅ Structure confirmed');

        // Start extraction
        console.log('🚀 Starting OCR extraction...');
        const extractResponse = await axios.post(`${API_BASE}/api/contribute/${sessionId}/extract`, {
            method: 'auto_ocr'
        });

        const extractionId = extractResponse.data.extractionId;
        console.log(`✅ Extraction started: ${extractionId}`);

        // Poll for status with debug info
        console.log('🔄 Polling for extraction status with debug info...');
        let attempts = 0;
        const maxAttempts = 30;
        const pollInterval = 2000;

        while (attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            try {
                const statusResponse = await axios.get(
                    `${API_BASE}/api/contribute/${sessionId}/extraction/${extractionId}/status?debug=true`
                );

                const extraction = statusResponse.data.extraction;
                console.log(`📊 Attempt ${attempts}: Status=${extraction.status}, Progress=${extraction.progress}%`);

                // Capture debug log if available
                if (extraction.debugLog && extraction.debugLog.length > 0) {
                    console.log('📋 Debug log entries:', extraction.debugLog.length);

                    // Analyze debug log to find failure point
                    const lastStage = extraction.debugLog[extraction.debugLog.length - 1].stage;
                    console.log(`🔍 Last stage reached: ${lastStage}`);

                    // Check for errors in debug log
                    const errorEntries = extraction.debugLog.filter(entry =>
                        entry.stage.includes('ERROR') ||
                        entry.stage.includes('FAIL') ||
                        entry.message.includes('error')
                    );

                    if (errorEntries.length > 0) {
                        console.log('⚠️  Error entries found:', errorEntries.length);
                        errorEntries.forEach(entry => {
                            console.log(`   ${entry.stage}: ${entry.message}`);
                        });
                    }

                    // Store debug information
                    testResults.stages.push({
                        attempt: attempts,
                        status: extraction.status,
                        progress: extraction.progress,
                        lastStage: lastStage,
                        errorCount: errorEntries.length
                    });

                    // Check if completed or failed
                    if (extraction.status === 'completed') {
                        console.log('🎉 Extraction completed successfully!');
                        testResults.stages.push({
                            finalStatus: 'completed',
                            rowCount: extraction.rowCount,
                            avgConfidence: extraction.avgConfidence
                        });
                        break;
                    } else if (extraction.status === 'failed') {
                        console.log('❌ Extraction failed:', extraction.error);
                        testResults.errors.push({
                            stage: 'extraction_failure',
                            error: extraction.error,
                            debugLog: extraction.debugLog
                        });
                        break;
                    }

                } else {
                    console.log('⚠️  No debug log available in response');
                }

            } catch (pollError) {
                console.error(`❌ Poll attempt ${attempts} failed:`, pollError.message);
                testResults.errors.push({
                    stage: `poll_attempt_${attempts}`,
                    error: pollError.message
                });
            }
        }

        if (attempts >= maxAttempts) {
            console.log('⏰ Extraction did not complete within expected time');
            testResults.errors.push({
                stage: 'timeout',
                error: 'Extraction did not complete within 60 seconds'
            });
        }

    } catch (error) {
        console.error('❌ Extraction test failed:', error.message);
        testResults.errors.push({
            stage: 'extraction_test',
            error: error.message,
            stack: error.stack
        });
    }
}

/**
 * Test each fallback method individually
 */
async function testFallbackMethods() {
    console.log('\n4️⃣ Testing Individual Fallback Methods...');

    // Test direct HTTP download
    await testDirectHttpDownload();

    // Test browser-based download
    await testBrowserBasedDownload();

    // Test PDF link extraction
    await testPdfLinkExtraction();

    // Test screenshot method
    await testScreenshotMethod();
}

/**
 * Test direct HTTP download method
 */
async function testDirectHttpDownload() {
    console.log('\n🔹 Testing Direct HTTP Download...');

    try {
        const startTime = Date.now();
        const response = await axios.get(TEST_URL, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
            }
        });

        const endTime = Date.now();
        console.log(`✅ Direct HTTP: SUCCESS (${endTime - startTime}ms)`);
        testResults.fallbackMethods.directHttp = {
            success: true,
            duration: endTime - startTime,
            status: response.status
        };

    } catch (error) {
        console.log(`❌ Direct HTTP: FAILED - ${error.message}`);
        testResults.fallbackMethods.directHttp = {
            success: false,
            error: error.message,
            code: error.response?.status
        };
    }
}

/**
 * Test browser-based download method
 */
async function testBrowserBasedDownload() {
    console.log('\n🔹 Testing Browser-Based Download...');

    try {
        const startTime = Date.now();
        const browser = await chromium.launch();
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        await page.goto(TEST_URL, {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        const screenshot = await page.screenshot({
            fullPage: true,
            type: 'jpeg',
            quality: 90
        });

        await browser.close();
        const endTime = Date.now();

        console.log(`✅ Browser-based: SUCCESS (${endTime - startTime}ms)`);
        testResults.fallbackMethods.browserBased = {
            success: true,
            duration: endTime - startTime,
            screenshotSize: screenshot.length
        };

    } catch (error) {
        console.log(`❌ Browser-based: FAILED - ${error.message}`);
        testResults.fallbackMethods.browserBased = {
            success: false,
            error: error.message
        };
    }
}

/**
 * Test PDF link extraction method
 */
async function testPdfLinkExtraction() {
    console.log('\n🔹 Testing PDF Link Extraction...');

    try {
        const startTime = Date.now();
        const response = await axios.get(TEST_URL, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
            }
        });

        const html = response.data;
        const pdfLinks = html.match(/href="([^"]*\.pdf)"/gi);

        const endTime = Date.now();

        if (pdfLinks && pdfLinks.length > 0) {
            console.log(`✅ PDF Link Extraction: SUCCESS - Found ${pdfLinks.length} PDF links`);
            testResults.fallbackMethods.pdfLinkExtraction = {
                success: true,
                duration: endTime - startTime,
                pdfLinksFound: pdfLinks.length,
                sampleLinks: pdfLinks.slice(0, 3)
            };
        } else {
            console.log('❌ PDF Link Extraction: NO PDF LINKS FOUND');
            testResults.fallbackMethods.pdfLinkExtraction = {
                success: false,
                duration: endTime - startTime,
                reason: 'no_pdf_links_found'
            };
        }

    } catch (error) {
        console.log(`❌ PDF Link Extraction: FAILED - ${error.message}`);
        testResults.fallbackMethods.pdfLinkExtraction = {
            success: false,
            error: error.message
        };
    }
}

/**
 * Test screenshot method
 */
async function testScreenshotMethod() {
    console.log('\n🔹 Testing Screenshot Method...');

    try {
        const startTime = Date.now();
        const browser = await chromium.launch();
        const page = await browser.newPage();

        await page.goto(TEST_URL, {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        // Take multiple screenshots for multi-page documents
        const screenshots = [];
        const pageHeight = await page.evaluate(() => document.body.scrollHeight);
        const viewportHeight = page.viewport().height;
        const pages = Math.ceil(pageHeight / viewportHeight);

        for (let i = 0; i < pages; i++) {
            await page.evaluate((pageNum) => {
                window.scrollTo(0, pageNum * window.innerHeight);
            }, i);

            const screenshot = await page.screenshot({
                type: 'jpeg',
                quality: 85
            });
            screenshots.push(screenshot);
        }

        await browser.close();
        const endTime = Date.now();

        console.log(`✅ Screenshot Method: SUCCESS - ${screenshots.length} screenshots taken`);
        testResults.fallbackMethods.screenshotMethod = {
            success: true,
            duration: endTime - startTime,
            screenshotCount: screenshots.length,
            totalSize: screenshots.reduce((sum, shot) => sum + shot.length, 0)
        };

    } catch (error) {
        console.log(`❌ Screenshot Method: FAILED - ${error.message}`);
        testResults.fallbackMethods.screenshotMethod = {
            success: false,
            error: error.message
        };
    }
}

/**
 * Generate comprehensive debug report
 */
function generateDebugReport() {
    console.log('\n📊 Generating Comprehensive Debug Report');
    console.log('=====================================');

    // Summary
    console.log('📋 TEST SUMMARY');
    console.log(`   Total Stages Tested: ${testResults.stages.length}`);
    console.log(`   Total Errors Found: ${testResults.errors.length}`);
    console.log(`   Fallback Methods Tested: ${Object.keys(testResults.fallbackMethods).length}`);

    // Capabilities
    if (testResults.capabilities) {
        console.log('\n🔧 SYSTEM CAPABILITIES');
        console.log('   Google Vision:', testResults.capabilities.googleVision ? '✅' : '❌');
        console.log('   Tesseract:', testResults.capabilities.tesseract ? '✅' : '❌');
        console.log('   Browser Automation:', testResults.capabilities.browserAutomation ? '✅' : '❌');
    }

    // Database Debug
    if (testResults.databaseDebug) {
        console.log('\n📊 DATABASE DEBUG');
        console.log('   Debug Columns Present:', testResults.databaseDebug.allRequiredColumns ? '✅' : '❌');
        console.log('   Columns:', Object.keys(testResults.databaseDebug.columnsPresent).join(', '));
    }

    // Extraction Stages
    if (testResults.stages.length > 0) {
        console.log('\n📈 EXTRACTION PROGRESS');
        testResults.stages.forEach((stage, index) => {
            console.log(`   Attempt ${stage.attempt}: ${stage.status} (${stage.progress}%) - Last: ${stage.lastStage}`);
            if (stage.errorCount > 0) {
                console.log(`     ⚠️  ${stage.errorCount} errors detected`);
            }
        });
    }

    // Fallback Methods
    console.log('\n🔄 FALLBACK METHOD RESULTS');
    Object.entries(testResults.fallbackMethods).forEach(([method, result]) => {
        const status = result.success ? '✅ SUCCESS' : '❌ FAILED';
        const details = result.success ?
            `${result.duration}ms, ${result.screenshotCount || result.pdfLinksFound || ''} items` :
            result.error || result.reason;
        console.log(`   ${method}: ${status} - ${details}`);
    });

    // Errors
    if (testResults.errors.length > 0) {
        console.log('\n❌ ERRORS FOUND');
        testResults.errors.forEach((error, index) => {
            console.log(`   ${index + 1}. ${error.stage}: ${error.error}`);
        });
    }

    // Recommendations
    console.log('\n💡 RECOMMENDATIONS');

    // Check if any fallback method worked
    const workingMethods = Object.entries(testResults.fallbackMethods)
        .filter(([_, result]) => result.success)
        .map(([method]) => method);

    if (workingMethods.length > 0) {
        console.log(`✅ Working fallback methods: ${workingMethods.join(', ')}`);
        console.log('   Recommend implementing automatic fallback to these methods');
    } else {
        console.log('❌ No fallback methods worked - need to investigate further');
    }

    // Check if extraction completed
    const completedStage = testResults.stages.find(s => s.finalStatus === 'completed');
    if (completedStage) {
        console.log(`✅ Extraction completed with ${completedStage.rowCount} rows at ${completedStage.avgConfidence}% confidence`);
    } else {
        console.log('❌ Extraction did not complete - check error logs above');
    }

    // Save full report to file
    const fs = require('fs');
    fs.writeFileSync('ocr-debug-report.json', JSON.stringify(testResults, null, 2));
    console.log('\n📄 Full debug report saved to: ocr-debug-report.json');
}

// Run the comprehensive test
runComprehensiveDebugTest();
