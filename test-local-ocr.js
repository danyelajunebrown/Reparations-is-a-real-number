/**
 * Test OCR Extraction with Local PDF
 *
 * This script tests the OCR extraction functionality with a local PDF file
 * to verify the full pipeline works without external dependencies
 */

const API_BASE = 'http://localhost:3000';
const fs = require('fs');
const path = require('path');

// Test data - use a local PDF file
const LOCAL_PDF_PATH = path.join(__dirname, 'test-download.pdf');
const USER_DESCRIPTION = `This is a table with columns: "DATE." "NAME OF OWNER." "NAME OF SLAVE." "SEX." "AGE." The scan quality is excellent and the text is printed.`;

async function makeRequest(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const url = `${API_BASE}${endpoint}`;
    console.log(`  → ${method} ${url}`);

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${data.error || 'Unknown error'}`);
    }

    return data;
}

async function testLocalOCRExtraction() {
    console.log('🧪 Testing OCR Extraction with Local PDF');
    console.log('='.repeat(50));

    let sessionId = null;
    let extractionId = null;

    try {
        // Check if local PDF exists
        if (!fs.existsSync(LOCAL_PDF_PATH)) {
            throw new Error(`Local PDF file not found: ${LOCAL_PDF_PATH}`);
        }

        // Step 1: Start session with local file URL
        console.log('\n1️⃣ Starting session with local PDF...');
        const startData = await makeRequest('/api/contribute/start', 'POST', {
            url: `file://${LOCAL_PDF_PATH}`
        });
        sessionId = startData.sessionId;
        console.log(`✅ Session created: ${sessionId}`);

        // Step 2: Describe content
        console.log('\n2️⃣ Describing document content...');
        const describeData = await makeRequest(`/api/contribute/${sessionId}/chat`, 'POST', {
            message: USER_DESCRIPTION
        });
        console.log(`✅ Content described, stage: ${describeData.stage}`);

        // Step 3: Confirm structure
        console.log('\n3️⃣ Confirming structure...');
        const confirmData = await makeRequest(`/api/contribute/${sessionId}/confirm`, 'POST', {
            confirmed: true
        });
        console.log(`✅ Structure confirmed, extraction options available: ${confirmData.extractionOptions.length}`);

        // Step 4: Start OCR extraction
        console.log('\n4️⃣ Starting OCR extraction...');
        const extractData = await makeRequest(`/api/contribute/${sessionId}/extract`, 'POST', {
            method: 'auto_ocr'
        });
        extractionId = extractData.extractionId;
        console.log(`✅ Extraction started: ${extractionId}`);

        // Step 5: Poll for completion
        console.log('\n5️⃣ Polling for extraction completion...');
        let attempts = 0;
        const maxAttempts = 30; // 1 minute max
        const pollInterval = 2000; // 2 seconds

        let extractionComplete = false;
        let parsedRows = null;

        while (attempts < maxAttempts && !extractionComplete) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            try {
                const statusData = await makeRequest(`/api/contribute/${sessionId}/extraction/${extractionId}/status`);
                const extraction = statusData.extraction;

                console.log(`   Attempt ${attempts}: Status=${extraction.status}, Progress=${extraction.progress}%`);

                if (extraction.status === 'completed') {
                    extractionComplete = true;
                    parsedRows = extraction.parsedRows;
                    console.log(`✅ Extraction completed! Found ${extraction.rowCount} rows with ${extraction.avgConfidence * 100}% confidence`);
                    break;
                } else if (extraction.status === 'failed') {
                    throw new Error(`Extraction failed: ${extraction.error}`);
                }
            } catch (error) {
                console.log(`   Poll attempt ${attempts} failed: ${error.message}`);
            }
        }

        if (!extractionComplete) {
            throw new Error(`Extraction did not complete within ${maxAttempts * (pollInterval/1000)} seconds`);
        }

        // Step 6: Verify results
        console.log('\n6️⃣ Verifying OCR results...');
        if (!parsedRows || !Array.isArray(parsedRows) || parsedRows.length === 0) {
            throw new Error('No parsed rows returned');
        }

        console.log(`✅ Found ${parsedRows.length} parsed rows`);
        console.log('📊 Sample row data:');
        const sampleRow = parsedRows[0];
        console.log(JSON.stringify(sampleRow, null, 2));

        console.log('\n🎉 Local OCR Extraction Test PASSED!');
        console.log('='.repeat(50));
        return true;

    } catch (error) {
        console.error(`\n❌ Local OCR Extraction Test FAILED: ${error.message}`);
        console.error(error.stack);
        return false;
    }
}

// Run test
testLocalOCRExtraction()
    .then(success => {
        process.exit(success ? 0 : 1);
    })
    .catch(error => {
        console.error('Test runner error:', error);
        process.exit(1);
    });
