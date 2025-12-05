/**
 * Focused OCR Extraction for Maryland 1860 Census Data
 * Extracts and displays slave owner names with their enslaved persons
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { KnowledgeManager, MLAnalyzer, IframeHandler } = require('./src/services/scraping');
const fs = require('fs');
const path = require('path');

async function main() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 MARYLAND 1860 CENSUS NAME EXTRACTION`);
    console.log(`   Target: Montgomery County Slave Statistics`);
    console.log(`   Expected: 4 Slave Owners, 27 Enslaved Persons`);
    console.log(`${'='.repeat(80)}`);

    try {
        // Step 1: Check for existing OCR on source page
        console.log('\n📍 Step 1: Checking for existing OCR on source page...');
        const existingOCR = await checkExistingOCR();

        if (existingOCR.hasOCR) {
            console.log('✅ Found existing OCR on source page');
            const results = processExistingText(existingOCR.textContent);
            displayResults(results);
            return results;
        } else {
            console.log('⚠️  No existing OCR - processing PDF directly');
            const results = await processPDFWithOCR();
            displayResults(results);
            return results;
        }

    } catch (error) {
        console.error(`\n❌ Extraction failed: ${error.message}`);
        console.error(error.stack);
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Check if OCR text is already available on source page
 */
async function checkExistingOCR() {
    const url = 'https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/html/am812--1.html';

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
            }
        });

        const $ = cheerio.load(response.data);
        const bodyText = $('body').text();

        // Check for slave-related content in HTML
        const hasSlaveContent = bodyText.includes('slave') ||
                              bodyText.includes('Slave') ||
                              bodyText.includes('owner') ||
                              bodyText.includes('Owner');

        // Check for hidden or alternative content
        const hasHiddenContent = $('script, style, meta, link').text()
            .includes('slave') || bodyText.length > 10000;

        return {
            hasOCR: hasSlaveContent || hasHiddenContent,
            textContent: bodyText,
            hasSlaveContent,
            hasHiddenContent,
            textLength: bodyText.length
        };

    } catch (error) {
        console.error(`   ❌ Failed to check source page: ${error.message}`);
        return {
            hasOCR: false,
            textContent: '',
            error: error.message
        };
    }
}

/**
 * Process existing text content
 */
function processExistingText(text) {
    try {
        // Initialize ML analyzer
        const mlAnalyzer = new MLAnalyzer();

        // Analyze text content
        const mlAnalysis = mlAnalyzer.analyzePageContent(text,
            'https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/html/am812--1.html');

        console.log(`   🧠 ML Analysis completed`);
        console.log(`   - Found ${mlAnalysis.entities.owners.length} potential owners`);
        console.log(`   - Found ${mlAnalysis.entities.enslaved.length} potential enslaved persons`);
        console.log(`   - Confidence: ${mlAnalysis.confidence.toFixed(2)}`);

        // Format results for display
        const formattedResults = {
            slaveOwners: [],
            totalOwners: mlAnalysis.entities.owners.length,
            totalEnslaved: mlAnalysis.entities.enslaved.length,
            rawText: text,
            mlAnalysis
        };

        // Group enslaved persons by owner
        mlAnalysis.entities.owners.forEach(owner => {
            const enslaved = mlAnalysis.entities.enslaved
                .filter(e => e.slaveholder === owner)
                .map(e => e.name);

            formattedResults.slaveOwners.push({
                name: owner,
                enslaved: enslaved.length > 0 ? enslaved : ['Unknown slaves'],
                count: enslaved.length
            });
        });

        return formattedResults;

    } catch (error) {
        console.error(`   ❌ Text processing failed: ${error.message}`);
        return {
            slaveOwners: [],
            totalOwners: 0,
            totalEnslaved: 0,
            error: error.message
        };
    }
}

/**
 * Process PDF with OCR when no existing text
 */
async function processPDFWithOCR() {
    try {
        const url = 'https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/html/am812--1.html';

        // Initialize components
        const knowledgeManager = new KnowledgeManager();
        const mlAnalyzer = new MLAnalyzer();
        const iframeHandler = new IframeHandler(knowledgeManager, mlAnalyzer);

        console.log('   📄 Fetching page to extract iframe URL...');
        const html = await axios.get(url);
        const $ = cheerio.load(html);
        const iframeSrc = $('iframe').attr('src');

        if (!iframeSrc) {
            throw new Error('No iframe found on page');
        }

        // Convert to absolute URL
        const iframeUrl = new URL(iframeSrc, url).href;
        console.log(`   🔗 Found iframe: ${iframeUrl}`);

        // Download PDF
        console.log('   📥 Downloading PDF...');
        const pdfResponse = await axios.get(iframeUrl, {
            responseType: 'arraybuffer',
            timeout: 60000
        });

        // Perform OCR
        console.log('   🔍 Performing OCR...');
        const ocrResults = await iframeHandler.performOCR(pdfResponse.data);

        console.log(`   ✅ OCR completed: ${ocrResults.text.length} characters extracted`);
        console.log(`   - OCR Confidence: ${ocrResults.info.confidence.toFixed(2)}`);

        // Store results in knowledge base
        knowledgeManager.addSiteKnowledge(url, {
            ocrResults: ocrResults.text,
            sourceType: 'census_1860',
            extractionDate: new Date().toISOString(),
            extractionMethod: 'direct_pdf_ocr',
            confidence: ocrResults.info.confidence
        });

        // Process OCR text
        return processExistingText(ocrResults.text);

    } catch (error) {
        console.error(`   ❌ PDF processing failed: ${error.message}`);
        return {
            slaveOwners: [],
            totalOwners: 0,
            totalEnslaved: 0,
            error: error.message
        };
    }
}

/**
 * Display formatted results
 */
function displayResults(results) {
    console.log('\n📋 MARYLAND 1860 CENSUS RESULTS');
    console.log('================================================================================');

    if (results.slaveOwners.length === 0) {
        console.log('⚠️  No slave owners found in extracted data');
        console.log(`   Total text analyzed: ${results.rawText?.length || 0} characters`);
        return;
    }

    results.slaveOwners.forEach(owner => {
        console.log(`${owner.name} (${owner.count} slaves)`);
        owner.enslaved.forEach(slave => {
            console.log(`  - ${slave}`);
        });
        console.log(''); // Blank line between owners
    });

    console.log('================================================================================');
    console.log(`Total Slave Owners: ${results.totalOwners}`);
    console.log(`Total Enslaved Persons: ${results.totalEnslaved}`);
    console.log(`Extraction Confidence: ${results.mlAnalysis?.confidence.toFixed(2) || 'N/A'}`);
    console.log('================================================================================');

    // Save results to file
    const resultsFile = path.join(__dirname, 'maryland-1860-names-results.json');
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    console.log(`✅ Results saved to: ${resultsFile}`);
}

// Run the extraction
main()
    .then(results => {
        if (results?.slaveOwners?.length > 0) {
            console.log('\n🎯 EXTRACTION COMPLETE');
            console.log('✅ Successfully extracted and displayed names');
            console.log('✅ Results saved for future reference');
        } else {
            console.log('\n⚠️  Extraction completed but no names found');
            console.log('   This may indicate OCR issues or missing content');
        }
    })
    .catch(error => {
        console.error('❌ Extraction failed with exception:', error.message);
    });
