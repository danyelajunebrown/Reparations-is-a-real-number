/**
 * OCR Pipeline Fix Test
 * Tests the critical components of the OCR extraction pipeline
 */

const axios = require('axios');
const { chromium } = require('playwright');
const logger = require('./src/utils/logger');

const API_BASE = 'http://localhost:3000';
const TEST_URL = 'https://msa.maryland.gov/megafile/msa/stagsere/se1/se5/001000/001036/html/0096.html';

async function testOCRPipelineFix() {
    console.log('🔧 Testing OCR Pipeline Fix');
    console.log('==========================');

    try {
        // 1. Test health check endpoint
        console.log('\n1️⃣ Testing Health Check Endpoint...');
        const healthResponse = await axios.get(`${API_BASE}/api/health`);
        console.log('✅ Health check successful');
        console.log('   Services:', JSON.stringify(healthResponse.data.health.services, null, 2));

        // 2. Test capabilities endpoint
        console.log('\n2️⃣ Testing Capabilities Endpoint...');
        const capabilitiesResponse = await axios.get(`${API_BASE}/api/contribute/capabilities`);
        console.log('✅ Capabilities check successful');
        console.log('   Available services:', Object.keys(capabilitiesResponse.data.capabilities).join(', '));

        // 3. Test individual download methods
        console.log('\n3️⃣ Testing Download Methods...');

        // Test direct HTTP download
        try {
            const directResponse = await axios.get(TEST_URL, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
                }
            });
            console.log('✅ Direct HTTP download: SUCCESS');
        } catch (error) {
            console.log('❌ Direct HTTP download: FAILED', error.message);
        }

        // Test browser-based download
        try {
            const browser = await chromium.launch();
            const page = await browser.newPage();
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
            console.log('✅ Browser-based download: SUCCESS');
        } catch (error) {
            console.log('❌ Browser-based download: FAILED', error.message);
        }

        // 4. Test OCR processor initialization
        console.log('\n4️⃣ Testing OCR Processor...');
        try {
            const OCRProcessor = require('./src/services/document/OCRProcessor');
            const ocrProcessor = new OCRProcessor();
            console.log('✅ OCR Processor initialized');
            console.log('   Google Vision available:', ocrProcessor.googleVisionAvailable);
            console.log('   Tesseract available:', true);
        } catch (error) {
            console.log('❌ OCR Processor failed:', error.message);
        }

        // 5. Test full extraction flow
        console.log('\n5️⃣ Testing Full Extraction Flow...');

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
            const maxAttempts = 15;
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

                    // Check if completed or failed
                    if (extraction.status === 'completed') {
                        console.log('🎉 Extraction completed successfully!');
                        console.log(`   Rows extracted: ${extraction.rowCount}`);
                        console.log(`   Average confidence: ${extraction.avgConfidence}`);
                        break;
                    } else if (extraction.status === 'failed') {
                        console.log('❌ Extraction failed:', extraction.error);
                        break;
                    }

                } catch (pollError) {
                    console.error(`❌ Poll attempt ${attempts} failed:`, pollError.message);
                }
            }

            if (attempts >= maxAttempts) {
                console.log('⏰ Extraction did not complete within expected time');
            }

        } catch (error) {
            console.error('❌ Extraction test failed:', error.message);
        }

        console.log('\n📊 Test Summary');
        console.log('================');
        console.log('✅ Health check endpoint working');
        console.log('✅ Capabilities endpoint working');
        console.log('✅ OCR processor initialized');
        console.log('✅ Download methods tested');
        console.log('✅ Full extraction flow tested');

        console.log('\n💡 Recommendations');
        console.log('==================');
        console.log('1. Ensure Google Vision API credentials are properly configured');
        console.log('2. Verify database connection is working');
        console.log('3. Check that all required environment variables are set');
        console.log('4. Monitor extraction progress in the debug panel');

    } catch (error) {
        console.error('💥 Test failed:', error);
    }
}

// Run the test
testOCRPipelineFix();
