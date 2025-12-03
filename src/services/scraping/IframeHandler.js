/**
 * Iframe Handler - Robust Solution for PDF/Iframe Content Extraction
 *
 * This system:
 * 1. Detects iframe-based content (PDFs, images, etc.)
 * 2. Extracts iframe source URLs
 * 3. Downloads and processes PDF content
 * 4. Performs OCR on PDFs to extract slave owner/enslaved data
 * 5. Stores extracted data in structured format
 * 6. Learns from iframe patterns for future use
 * 7. Integrates with knowledge base for pattern reuse
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { TesseractWorker } = require('tesseract.js');

class IframeHandler {
    constructor(knowledgeManager, mlAnalyzer) {
        this.knowledgeManager = knowledgeManager;
        this.mlAnalyzer = mlAnalyzer;
        this.ocrWorker = null;
        this.iframeCache = new Map(); // Cache for iframe content
    }

    /**
     * Main method: Handle iframe content extraction
     */
    async handleIframeContent(url, options = {}) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🔍 IFRAME HANDLER`);
        console.log(`   Target URL: ${url}`);
        console.log(`${'='.repeat(60)}`);

        const startTime = Date.now();
        const results = {
            url,
            success: false,
            iframeDetected: false,
            iframeUrl: null,
            pdfExtracted: false,
            ocrResults: null,
            slaveOwners: [],
            enslavedPersons: [],
            relationships: [],
            rawText: '',
            metadata: {},
            errors: []
        };

        try {
            // Step 1: Fetch the main page
            console.log('\n📍 Step 1: Fetching main page...');
            const html = await this.fetchHTML(url);
            const $ = cheerio.load(html);

            // Step 2: Detect iframes
            console.log('\n📍 Step 2: Detecting iframes...');
            const iframeInfo = this.detectIframes($);

            if (iframeInfo.iframes.length === 0) {
                console.log('⚠️  No iframes detected - using regular HTML content');
                results.rawText = this.extractText($);
                results.success = true;
                return results;
            }

            results.iframeDetected = true;
            results.iframeUrl = iframeInfo.iframes[0].src;
            console.log(`   ✅ Found iframe: ${results.iframeUrl}`);

            // Step 3: Process iframe content
            console.log('\n📍 Step 3: Processing iframe content...');
            const iframeResults = await this.processIframeContent(results.iframeUrl, url);

            // Merge results
            Object.assign(results, iframeResults);

            // Step 4: Extract slave owner and enslaved data
            console.log('\n📍 Step 4: Extracting slave owner and enslaved data...');
            this.extractSlaveData(results, options);

            // Step 5: ML Analysis on extracted content
            console.log('\n📍 Step 5: Performing ML analysis...');
            results.mlAnalysis = this.mlAnalyzer.analyzePageContent(results.rawText, url);

            // Step 6: Update knowledge base
            console.log('\n📍 Step 6: Updating knowledge base...');
            await this.updateKnowledge(url, results);

            results.success = true;
            results.duration = Date.now() - startTime;

            console.log(`\n✅ Iframe processing complete in ${results.duration}ms`);
            console.log(`   Slave Owners Found: ${results.slaveOwners.length}`);
            console.log(`   Enslaved Persons Found: ${results.enslavedPersons.length}`);
            console.log(`   Relationships Found: ${results.relationships.length}`);

            return results;

        } catch (error) {
            console.error(`\n❌ Iframe processing failed: ${error.message}`);
            results.errors.push({
                stage: 'iframe_processing',
                error: error.message,
                timestamp: new Date().toISOString()
            });
            return results;
        }
    }

    /**
     * Detect iframes in HTML content
     */
    detectIframes($) {
        const iframes = [];

        $('iframe').each((i, el) => {
            const src = $(el).attr('src');
            const title = $(el).attr('title') || '';
            const width = $(el).attr('width') || 'auto';
            const height = $(el).attr('height') || 'auto';

            if (src) {
                // Convert relative URLs to absolute
                const absoluteUrl = this.makeAbsoluteUrl(src, $(el).attr('base') || '');
                iframes.push({
                    src: absoluteUrl,
                    title,
                    width,
                    height,
                    type: this.detectIframeType(absoluteUrl)
                });
            }
        });

        return { iframes, count: iframes.length };
    }

    /**
     * Detect iframe content type
     */
    detectIframeType(url) {
        if (url.endsWith('.pdf')) return 'pdf';
        if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return 'image';
        if (url.match(/\.(html|htm|php|asp)$/i)) return 'html';
        return 'unknown';
    }

    /**
     * Process iframe content based on type
     */
    async processIframeContent(iframeUrl, baseUrl) {
        const results = {
            iframeUrl,
            pdfExtracted: false,
            ocrResults: null,
            rawText: '',
            metadata: {}
        };

        try {
            const type = this.detectIframeType(iframeUrl);

            switch (type) {
                case 'pdf':
                    console.log('   📄 Processing PDF iframe...');
                    results.pdfExtracted = true;
                    results.ocrResults = await this.extractPDFContent(iframeUrl);
                    results.rawText = results.ocrResults.text;
                    results.metadata.pdfInfo = results.ocrResults.info;
                    break;

                case 'image':
                    console.log('   🖼️  Processing image iframe...');
                    results.ocrResults = await this.performOCR(iframeUrl);
                    results.rawText = results.ocrResults.text;
                    results.metadata.imageInfo = results.ocrResults.info;
                    break;

                case 'html':
                    console.log('   🌐 Processing HTML iframe...');
                    const htmlContent = await this.fetchHTML(iframeUrl);
                    results.rawText = this.extractText(cheerio.load(htmlContent));
                    results.metadata.htmlInfo = { url: iframeUrl, type: 'html' };
                    break;

                default:
                    console.log(`   ⚠️  Unknown iframe type: ${type}`);
                    results.rawText = `Unknown iframe content: ${iframeUrl}`;
            }

            return results;

        } catch (error) {
            console.error(`   ❌ Failed to process iframe: ${error.message}`);
            results.errors = [{ stage: 'iframe_processing', error: error.message }];
            return results;
        }
    }

    /**
     * Extract PDF content using PDF.js and OCR
     */
    async extractPDFContent(pdfUrl) {
        try {
            // Download PDF file
            console.log('   📥 Downloading PDF...');
            const pdfResponse = await axios.get(pdfUrl, {
                responseType: 'arraybuffer',
                timeout: 60000
            });

            const pdfBuffer = pdfResponse.data;
            const tempFilePath = path.join(__dirname, '..', '..', '..', 'temp', `pdf_${Date.now()}.pdf`);
            fs.writeFileSync(tempFilePath, pdfBuffer);

            // Extract text from PDF using pdf-lib
            console.log('   📖 Extracting text from PDF...');
            const pdfDoc = await PDFDocument.load(pdfBuffer);
            let pdfText = '';

            for (let i = 0; i < pdfDoc.getPageCount(); i++) {
                const page = pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                pdfText += textContent.items.map(item => item.str).join(' ') + '\n';
            }

            // Also perform OCR for better accuracy with scanned documents
            console.log('   🔍 Performing OCR on PDF...');
            const ocrResults = await this.performOCR(tempFilePath);

            // Clean up temp file
            fs.unlinkSync(tempFilePath);

            return {
                text: pdfText + '\n' + ocrResults.text,
                info: {
                    pageCount: pdfDoc.getPageCount(),
                    pdfTextLength: pdfText.length,
                    ocrTextLength: ocrResults.text.length,
                    extractionMethod: 'pdf-lib + OCR'
                }
            };

        } catch (error) {
            console.error(`   ❌ PDF extraction failed: ${error.message}`);
            return {
                text: '',
                info: { error: error.message }
            };
        }
    }

    /**
     * Perform OCR on image or PDF
     */
    async performOCR(filePathOrUrl) {
        try {
            // Initialize OCR worker if not already done
            if (!this.ocrWorker) {
                console.log('   🤖 Initializing OCR worker...');
                this.ocrWorker = TesseractWorker.create();
                await this.ocrWorker.load();
                await this.ocrWorker.loadLanguage('eng');
                await this.ocrWorker.initialize('eng');
            }

            // Download file if it's a URL
            let filePath = filePathOrUrl;
            if (filePathOrUrl.startsWith('http')) {
                const response = await axios.get(filePathOrUrl, {
                    responseType: 'arraybuffer'
                });
                filePath = path.join(__dirname, '..', '..', '..', 'temp', `ocr_${Date.now()}.png`);
                fs.writeFileSync(filePath, response.data);
            }

            console.log('   🔍 Running OCR...');
            const { data: { text } } = await this.ocrWorker.recognize(filePath);

            // Clean up temp file if we created it
            if (filePathOrUrl.startsWith('http')) {
                fs.unlinkSync(filePath);
            }

            return {
                text,
                info: {
                    ocrMethod: 'Tesseract.js',
                    textLength: text.length,
                    confidence: this.estimateOCRConfidence(text)
                }
            };

        } catch (error) {
            console.error(`   ❌ OCR failed: ${error.message}`);
            return {
                text: '',
                info: { error: error.message }
            };
        }
    }

    /**
     * Estimate OCR confidence based on text characteristics
     */
    estimateOCRConfidence(text) {
        if (!text || text.length === 0) return 0;

        // Count meaningful words vs noise
        const words = text.split(/\s+/);
        const meaningfulWords = words.filter(word =>
            word.length > 2 && !word.match(/^[0-9]+$/) && !word.match(/^[.,;:!?]+$/)
        );

        const wordCount = words.length;
        const meaningfulCount = meaningfulWords.length;
        const meaningfulRatio = meaningfulCount / Math.max(wordCount, 1);

        // Base confidence
        let confidence = 0.5;

        // Adjust based on content quality
        if (meaningfulRatio > 0.7) confidence += 0.2;
        if (meaningfulRatio > 0.5) confidence += 0.1;
        if (text.includes('slave') || text.includes('owner')) confidence += 0.1;
        if (text.includes('Montgomery') || text.includes('County')) confidence += 0.1;

        return Math.min(confidence, 0.95);
    }

    /**
     * Extract slave owner and enslaved person data
     */
    extractSlaveData(results, options) {
        const text = results.rawText;
        const metadata = options.metadata || {};

        // Use ML analysis to extract entities
        const mlAnalysis = this.mlAnalyzer.analyzePageContent(text, results.url);

        // Extract slave owners
        mlAnalysis.entities.owners.forEach(owner => {
            results.slaveOwners.push({
                name: owner,
                confidence: mlAnalysis.confidence,
                source: 'ml_analysis',
                evidence: this.getContextAroundName(text, owner),
                metadata: {
                    sourceType: mlAnalysis.sourceType,
                    documentType: mlAnalysis.documentType
                }
            });
        });

        // Extract enslaved persons
        mlAnalysis.entities.enslaved.forEach(enslaved => {
            results.enslavedPersons.push({
                name: enslaved,
                confidence: mlAnalysis.confidence,
                source: 'ml_analysis',
                evidence: this.getContextAroundName(text, enslaved),
                metadata: {
                    sourceType: mlAnalysis.sourceType,
                    documentType: mlAnalysis.documentType
                }
            });
        });

        // Extract relationships
        mlAnalysis.entities.relationships.forEach(relationship => {
            results.relationships.push({
                owner: relationship.owner,
                enslaved: relationship.enslaved,
                type: relationship.type,
                confidence: mlAnalysis.confidence,
                source: 'ml_analysis'
            });
        });

        // Add additional context from text
        this.extractAdditionalContext(text, results);
    }

    /**
     * Extract additional context from text
     */
    extractAdditionalContext(text, results) {
        // Extract locations
        const locationPattern = /Montgomery\s+County|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*,\s*MD/gi;
        let match;
        const locations = [];

        while ((match = locationPattern.exec(text)) !== null) {
            if (!locations.includes(match[0])) {
                locations.push(match[0]);
            }
        }

        if (locations.length > 0) {
            results.metadata.locations = locations;
        }

        // Extract dates
        const datePattern = /(?:186[0-9]|18[0-9]{2})/g;
        const dates = [];
        while ((match = datePattern.exec(text)) !== null) {
            if (!dates.includes(match[0])) {
                dates.push(match[0]);
            }
        }

        if (dates.length > 0) {
            results.metadata.dates = dates;
        }

        // Extract counts (slave numbers)
        const countPattern = /(\d+)\s+(?:slaves?|enslaved|persons?)/gi;
        const counts = [];
        while ((match = countPattern.exec(text)) !== null) {
            counts.push(parseInt(match[1]));
        }

        if (counts.length > 0) {
            results.metadata.slaveCounts = counts;
            results.metadata.totalSlaves = counts.reduce((sum, count) => sum + count, 0);
        }
    }

    /**
     * Get context around a name for evidence
     */
    getContextAroundName(text, name) {
        const index = text.indexOf(name);
        if (index === -1) return '';

        const start = Math.max(0, index - 100);
        const end = Math.min(text.length, index + name.length + 100);
        return text.substring(start, end);
    }

    /**
     * Update knowledge base with iframe handling patterns
     */
    async updateKnowledge(url, results) {
        const domain = this.knowledgeManager.extractDomain(url);
        const existingKnowledge = this.knowledgeManager.getSiteKnowledge(url);

        const knowledgeUpdate = {
            type: 'slave_statistics',
            patterns: {
                owner: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)*(?:\s*,\s*\d+)?(?:\s*slaves?)?/gi,
                enslaved: /(?:slave|servant|negro)\s+(?:named|called)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)*/gi,
                location: /Montgomery\s+County|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*,\s*MD/gi,
                date: /(?:186[0-9]|18[0-9]{2})/g
            },
            confidence: results.mlAnalysis?.confidence || 0.8,
            sourceType: results.mlAnalysis?.sourceType || 'primary',
            description: 'Maryland Slave Statistics with iframe PDF handling',
            iframeHandling: true,
            extractionMethod: 'pdf-lib + OCR',
            successRate: 1.0,
            attempts: 1,
            successes: 1
        };

        // Add or update knowledge
        this.knowledgeManager.addSiteKnowledge(url, knowledgeUpdate);
        console.log(`   📚 Updated knowledge base for ${domain}`);
    }

    /**
     * Make URL absolute
     */
    makeAbsoluteUrl(relativeUrl, baseUrl) {
        if (!relativeUrl) return null;

        if (relativeUrl.startsWith('http')) {
            return relativeUrl;
        }

        try {
            if (baseUrl) {
                return new URL(relativeUrl, baseUrl).href;
            } else {
                return new URL(relativeUrl, 'https://example.com').href;
            }
        } catch (error) {
            console.warn(`   ⚠️  Could not make absolute URL: ${relativeUrl}`);
            return null;
        }
    }

    /**
     * Fetch HTML content
     */
    async fetchHTML(url) {
        try {
            const response = await axios.get(url, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
                }
            });
            return response.data;
        } catch (error) {
            console.error(`   ❌ Failed to fetch ${url}:`, error.message);
            throw error;
        }
    }

    /**
     * Extract text from HTML
     */
    extractText($) {
        $('script, style, nav, footer, aside').remove();
        return $('body').text();
    }

    /**
     * Navigate to next page in sequence
     */
    async navigateToNextPage(currentUrl) {
        try {
            // Extract base URL pattern
            const urlPattern = /(.*am\d+--)\d+\.html$/;
            const match = currentUrl.match(urlPattern);

            if (!match) {
                console.log('   ⚠️  Could not determine next page pattern');
                return null;
            }

            const baseUrl = match[1];
            const currentPageNum = parseInt(currentUrl.match(/--(\d+)\.html$/)[1]);
            const nextPageNum = currentPageNum + 1;

            // Check if next page exists by attempting to fetch
            const nextUrl = `${baseUrl}${nextPageNum}.html`;
            console.log(`   🔗 Checking next page: ${nextUrl}`);

            try {
                const response = await axios.head(nextUrl, {
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
                    }
                });

                if (response.status === 200) {
                    console.log(`   ✅ Next page found: ${nextUrl}`);
                    return nextUrl;
                } else {
                    console.log(`   ⚠️  Next page not found (status: ${response.status})`);
                    return null;
                }
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    console.log('   ⚠️  No more pages (404)');
                    return null;
                }
                console.error(`   ❌ Error checking next page: ${error.message}`);
                return null;
            }

        } catch (error) {
            console.error(`   ❌ Navigation failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Upload extracted PDF to S3 storage
     */
    async uploadToS3(pdfContent, metadata) {
        try {
            const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

            const s3Client = new S3Client({
                region: process.env.S3_REGION || 'us-east-2',
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                }
            });

            // Generate unique S3 key
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const s3Key = `slave-records/maryland/montgomery-county/${timestamp}.pdf`;

            console.log(`   💾 Uploading to S3: ${s3Key}`);

            const uploadParams = {
                Bucket: process.env.S3_BUCKET || 'reparations-them',
                Key: s3Key,
                Body: pdfContent,
                ContentType: 'application/pdf',
                Metadata: {
                    source: metadata.sourceUrl,
                    type: 'slave_statistics',
                    location: metadata.locations?.join(', ') || 'Montgomery County, MD',
                    date: metadata.dates?.join(', ') || '1860',
                    owners: metadata.slaveOwners?.length || 0,
                    enslaved: metadata.totalSlaves || 0
                }
            };

            const uploadResult = await s3Client.send(new PutObjectCommand(uploadParams));

            console.log(`   ✅ S3 Upload successful: ${uploadResult.ETag}`);
            return {
                s3Url: `https://${uploadParams.Bucket}.s3.amazonaws.com/${s3Key}`,
                s3Key,
                etag: uploadResult.ETag
            };

        } catch (error) {
            console.error(`   ❌ S3 upload failed: ${error.message}`);
            return {
                error: error.message,
                s3Url: null,
                s3Key: null
            };
        }
    }

    /**
     * Verify extracted counts against expected values
     */
    verifyCounts(results, expectedCounts) {
        const verification = {
            ownerCountMatch: results.slaveOwners.length === expectedCounts.owners,
            enslavedCountMatch: results.enslavedPersons.length === expectedCounts.enslaved,
            totalCountMatch: results.slaveOwners.length + results.enslavedPersons.length ===
                            expectedCounts.owners + expectedCounts.enslaved,
            discrepancies: [],
            confidenceScore: 0.0
        };

        // Calculate confidence based on accuracy
        let confidence = 0.5; // Base confidence

        if (verification.ownerCountMatch) confidence += 0.2;
        if (verification.enslavedCountMatch) confidence += 0.2;
        if (verification.totalCountMatch) confidence += 0.1;

        // Add discrepancies for manual review
        if (!verification.ownerCountMatch) {
            verification.discrepancies.push({
                type: 'owner_count',
                expected: expectedCounts.owners,
                actual: results.slaveOwners.length,
                difference: results.slaveOwners.length - expectedCounts.owners
            });
        }

        if (!verification.enslavedCountMatch) {
            verification.discrepancies.push({
                type: 'enslaved_count',
                expected: expectedCounts.enslaved,
                actual: results.enslavedPersons.length,
                difference: results.enslavedPersons.length - expectedCounts.enslaved
            });
        }

        verification.confidenceScore = Math.min(confidence, 0.95);
        return verification;
    }

    /**
     * Close OCR worker
     */
    async close() {
        if (this.ocrWorker) {
            await this.ocrWorker.terminate();
            this.ocrWorker = null;
        }
    }
}

module.exports = IframeHandler;
