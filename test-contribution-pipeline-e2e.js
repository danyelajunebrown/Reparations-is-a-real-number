/**
 * End-to-End Test for Contribution Pipeline
 *
 * This script simulates a real user going through the entire contribution flow:
 * 1. Submit URL (msa.maryland.gov)
 * 2. Describe document content (like a real user would)
 * 3. Confirm structure
 * 4. Start extraction
 *
 * Run with: node test-contribution-pipeline-e2e.js
 */

const API_BASE = process.env.API_BASE || 'https://reparations-platform.onrender.com';

// Test data - mimics real user input
const TEST_URL = 'https://msa.maryland.gov/megafile/msa/stagsere/se1/se5/001000/001036/html/0096.html';

const USER_DESCRIPTIONS = [
    // First description - detailed like the real user provided
    `the scanned pdf shows an open book (two pages visible with spine down the center. there is however only 1 table and it spreads across both pages). As for your questions: #LAYOUT# table with columns and rows (the column headings are from left to right: "DATE." "NAME OF OWNER." "NAME OF SLAVE." "SEX." "AGE." "PHYSICAL CONDITION." "TERM OF SERVITUDE." "Left with or taken by the military." (sub columns Day. Month. Year.) "Enlisted in U.S. Service." (sub columns Day. Month. Year.) "REGIMENT." "Compensation Received." "NAMES // BY WHOM FORMER OWNERSHIP PROVEN"; #QUALITY# excellent very clear image only the tiniest fine print gets blurry (as in the tiny "Murphy & Co Printers and Stationers..."); #HANDWRITTEN# yes the entries are hand written cursive, the column titles are typewritten. Also the dimensions of the page are: 131.89 × 89.78 inches`,

    // Simpler description to test
    `This is a table with 5 columns: Date, Owner Name, Slave Name, Age, Location. The scan quality is good and the text is handwritten cursive.`,

    // Very minimal description
    `it's a list of names`,
];

// Color codes for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
    console.log(`\n${colors.blue}${colors.bold}[STEP ${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
    console.log(`${colors.green}✓ ${message}${colors.reset}`);
}

function logError(message) {
    console.log(`${colors.red}✗ ${message}${colors.reset}`);
}

function logWarning(message) {
    console.log(`${colors.yellow}⚠ ${message}${colors.reset}`);
}

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

function validateQuestions(questions, context) {
    if (!questions) {
        logWarning(`${context}: No questions array returned`);
        return true; // Not having questions is valid
    }

    if (!Array.isArray(questions)) {
        logError(`${context}: Questions is not an array: ${typeof questions}`);
        return false;
    }

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];

        if (!q) {
            logError(`${context}: Question at index ${i} is undefined/null`);
            return false;
        }

        if (typeof q !== 'object') {
            logError(`${context}: Question at index ${i} is not an object: ${typeof q}`);
            return false;
        }

        if (!q.id) {
            logError(`${context}: Question at index ${i} missing 'id' property`);
            return false;
        }

        if (!q.question) {
            logError(`${context}: Question ${q.id} missing 'question' property`);
            return false;
        }

        // Validate that questions have either type or options
        const hasType = q.type && ['number', 'text'].includes(q.type);
        const hasOptions = q.options && Array.isArray(q.options);

        if (!hasType && !hasOptions) {
            logWarning(`${context}: Question ${q.id} has neither type (number/text) nor options array`);
        }

        // Validate options if present
        if (q.options) {
            if (!Array.isArray(q.options)) {
                logError(`${context}: Question ${q.id} has options but it's not an array: ${typeof q.options}`);
                return false;
            }

            for (let j = 0; j < q.options.length; j++) {
                const opt = q.options[j];
                if (!opt) {
                    logError(`${context}: Question ${q.id} option at index ${j} is undefined/null`);
                    return false;
                }
                if (!opt.value || !opt.label) {
                    logError(`${context}: Question ${q.id} option ${j} missing value or label`);
                    return false;
                }
            }
        }

        logSuccess(`Question ${q.id}: valid (type=${q.type || 'options-based'})`);
    }

    return true;
}

async function testStartSession(url) {
    logStep(1, 'Starting contribution session');

    const data = await makeRequest('/api/contribute/start', 'POST', { url });

    if (!data.success) {
        throw new Error(`Start session failed: ${data.error}`);
    }

    logSuccess(`Session created: ${data.sessionId}`);
    logSuccess(`Stage: ${data.stage}`);
    log(`  Message preview: ${data.message?.substring(0, 100)}...`);

    // Validate questions
    if (!validateQuestions(data.questions, 'Initial questions')) {
        throw new Error('Initial questions validation failed');
    }

    return data;
}

async function testDescribeContent(sessionId, description) {
    logStep(2, 'Describing document content');
    log(`  Description length: ${description.length} chars`);

    const data = await makeRequest(`/api/contribute/${sessionId}/chat`, 'POST', {
        message: description
    });

    if (!data.success) {
        throw new Error(`Describe content failed: ${data.error}`);
    }

    logSuccess(`Stage after description: ${data.stage}`);
    log(`  Message preview: ${data.message?.substring(0, 100)}...`);

    // Validate questions
    if (!validateQuestions(data.questions, 'Follow-up questions')) {
        throw new Error('Follow-up questions validation failed');
    }

    return data;
}

async function testConfirmStructure(sessionId) {
    logStep(3, 'Confirming structure');

    // First, get current session state
    const sessionData = await makeRequest(`/api/contribute/${sessionId}`, 'GET');

    if (sessionData.session?.stage !== 'structure_confirmation') {
        logWarning(`Expected stage 'structure_confirmation', got '${sessionData.session?.stage}'`);

        // If still in content_description, we may need to answer more questions
        if (sessionData.session?.stage === 'content_description') {
            log('  Still in content_description stage - may need more input');

            // Try confirming anyway via chat
            const chatData = await makeRequest(`/api/contribute/${sessionId}/chat`, 'POST', {
                message: 'yes that looks correct, please proceed'
            });

            logSuccess(`Chat response stage: ${chatData.stage}`);
            return chatData;
        }
    }

    const data = await makeRequest(`/api/contribute/${sessionId}/confirm`, 'POST', {
        confirmed: true
    });

    if (!data.success) {
        throw new Error(`Confirm structure failed: ${data.error}`);
    }

    logSuccess(`Stage after confirmation: ${data.nextStage}`);
    log(`  Message preview: ${data.message?.substring(0, 100)}...`);

    // Validate extraction options
    if (data.extractionOptions) {
        logSuccess(`Extraction options available: ${data.extractionOptions.length}`);
        for (const opt of data.extractionOptions) {
            log(`    - ${opt.id}: ${opt.label} ${opt.recommended ? '(recommended)' : ''}`);
        }
    }

    return data;
}

async function testChooseExtractionMethod(sessionId, method = 'guided_entry') {
    logStep(4, `Choosing extraction method: ${method}`);

    const data = await makeRequest(`/api/contribute/${sessionId}/extract`, 'POST', {
        method
    });

    if (!data.success) {
        throw new Error(`Start extraction failed: ${data.error}`);
    }

    logSuccess(`Extraction started: ${data.extractionId}`);
    logSuccess(`Stage: ${data.nextStage}`);

    return data;
}

async function testGetSessionState(sessionId) {
    logStep('X', 'Getting session state');

    const data = await makeRequest(`/api/contribute/${sessionId}`, 'GET');

    if (!data.success) {
        throw new Error(`Get session failed: ${data.error}`);
    }

    logSuccess('Session state retrieved');
    log(`  Stage: ${data.session?.stage}`);
    log(`  Conversation messages: ${data.conversation?.length || 0}`);
    log(`  Source metadata: ${data.sourceMetadata?.domain || 'none'}`);
    log(`  Content structure: ${data.contentStructure ? 'present' : 'none'}`);

    return data;
}

async function runSingleTest(testName, url, description) {
    console.log('\n' + '='.repeat(60));
    log(`TEST: ${testName}`, 'bold');
    console.log('='.repeat(60));

    const errors = [];
    let sessionId = null;

    try {
        // Step 1: Start session
        const startData = await testStartSession(url);
        sessionId = startData.sessionId;

        // Step 2: Describe content
        const describeData = await testDescribeContent(sessionId, description);

        // Step 3: Confirm structure (if we reached that stage)
        if (describeData.stage === 'structure_confirmation') {
            const confirmData = await testConfirmStructure(sessionId);

            // Step 4: Choose extraction method
            if (confirmData.extractionOptions) {
                await testChooseExtractionMethod(sessionId, 'guided_entry');
            }
        } else {
            log(`  Skipping confirm/extract - still at stage: ${describeData.stage}`);
        }

        // Final: Get session state
        await testGetSessionState(sessionId);

        logSuccess(`\nTEST PASSED: ${testName}`);
        return { success: true, sessionId };

    } catch (error) {
        logError(`\nTEST FAILED: ${testName}`);
        logError(`Error: ${error.message}`);
        console.error(error.stack);
        return { success: false, sessionId, error: error.message };
    }
}

async function runAllTests() {
    console.log('\n' + '='.repeat(60));
    log('CONTRIBUTION PIPELINE END-TO-END TESTS', 'bold');
    log(`API: ${API_BASE}`, 'blue');
    console.log('='.repeat(60));

    const results = [];

    // Test 1: Detailed user description (like the real bug report)
    results.push(await runSingleTest(
        'Detailed Maryland Archives Description',
        TEST_URL,
        USER_DESCRIPTIONS[0]
    ));

    // Test 2: Simpler description
    results.push(await runSingleTest(
        'Simple Column Description',
        TEST_URL,
        USER_DESCRIPTIONS[1]
    ));

    // Test 3: Minimal description
    results.push(await runSingleTest(
        'Minimal Description',
        TEST_URL,
        USER_DESCRIPTIONS[2]
    ));

    // Summary
    console.log('\n' + '='.repeat(60));
    log('TEST SUMMARY', 'bold');
    console.log('='.repeat(60));

    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    log(`Passed: ${passed}`, 'green');
    log(`Failed: ${failed}`, failed > 0 ? 'red' : 'green');

    if (failed > 0) {
        log('\nFailed tests:', 'red');
        results.filter(r => !r.success).forEach(r => {
            log(`  - ${r.error}`, 'red');
        });
    }

    return failed === 0;
}

// Run tests
runAllTests()
    .then(success => {
        process.exit(success ? 0 : 1);
    })
    .catch(error => {
        console.error('Test runner error:', error);
        process.exit(1);
    });
