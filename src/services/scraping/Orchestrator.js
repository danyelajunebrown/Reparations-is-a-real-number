/**
 * Autonomous Research Orchestrator
 *
 * Main coordinator that ties together:
 * - Web scraping
 * - ML entity extraction
 * - Document downloading
 * - Database storage
 * - Document processing
 *
 * Usage:
 *   const orchestrator = new AutonomousResearchOrchestrator(database);
 *   const results = await orchestrator.processURL('https://...');
 */

const AutonomousWebScraper = require('./autonomous-web-scraper');
const GenealogyEntityExtractor = require('./genealogy-entity-extractor');
const LLMPageAnalyzer = require('./llm-page-analyzer');
const FormData = require('form-data');
const fs = require('fs');

class AutonomousResearchOrchestrator {
    constructor(database, config = {}) {
        this.db = database;
        this.scraper = new AutonomousWebScraper(database);
        this.extractor = new GenealogyEntityExtractor();
        this.pageAnalyzer = new LLMPageAnalyzer();

        this.config = {
            autoDownloadDocuments: config.autoDownloadDocuments !== false,
            autoUploadDocuments: config.autoUploadDocuments !== false,
            minConfidenceForConfirmed: config.minConfidenceForConfirmed || 0.85,
            serverUrl: config.serverUrl || 'http://localhost:3000',
            ...config
        };
    }

    /**
     * Main entry point: Process a URL completely
     * @param {string} url - URL to scrape and process
     * @param {object} options - Processing options
     * @returns {Promise<object>} Complete results
     */
    async processURL(url, options = {}) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🤖 AUTONOMOUS RESEARCH AGENT`);
        console.log(`   Target: ${url}`);
        if (options.isBeyondKin) {
            console.log(`   🌟 Beyond Kin submission (high priority)`);
        }
        console.log(`${'='.repeat(60)}`);

        const sessionId = await this.createSession(url);
        const startTime = Date.now();

        const results = {
            sessionId,
            url,
            success: true,
            scrapingResults: null,
            extractionResults: null,
            personsAdded: {
                unconfirmed: 0,  // All web-scraped persons are unconfirmed
                highConfidence: 0,  // confidence >= 0.7
                mediumConfidence: 0, // confidence 0.5-0.7
                lowConfidence: 0  // confidence < 0.5
            },
            documentsDownloaded: 0,
            documentsUploaded: 0,
            errors: []
        };

        try {
            // PHASE 1: Scrape the page
            console.log('\n📍 PHASE 1: Web Scraping');
            results.scrapingResults = await this.scraper.scrapeURL(url);

            if (results.scrapingResults.errors.length > 0) {
                results.errors.push(...results.scrapingResults.errors);
            }

            // PHASE 1.5: LLM-Powered Page Analysis (NEW!)
            console.log('\n📍 PHASE 1.5: AI Page Analysis');
            results.pageAnalysis = await this.pageAnalyzer.analyzePage(
                url,
                results.scrapingResults.rawText,
                results.scrapingResults.html
            );

            // Store analysis for later use
            const sourceType = results.pageAnalysis.source_type;
            const isPrimarySource = sourceType === 'primary';
            const isConfirmingDocument = results.pageAnalysis.is_confirming_document;

            console.log(`    • Source Type: ${sourceType} (${Math.round(results.pageAnalysis.confidence * 100)}% confident)`);
            console.log(`    • Document Type: ${results.pageAnalysis.document_type || 'N/A'}`);
            if (isConfirmingDocument) {
                console.log(`    🎯 PRIMARY SOURCE - Can confirm unconfirmed leads!`);
            }

            // PHASE 2: Extract entities from scraped text
            console.log('\n📍 PHASE 2: Entity Extraction');
            results.extractionResults = await this.extractor.extractPersons(
                results.scrapingResults.rawText,
                url
            );

            // Also extract from tables
            if (results.scrapingResults.tables.length > 0) {
                console.log(`    • Analyzing ${results.scrapingResults.tables.length} tables...`);
                for (const table of results.scrapingResults.tables) {
                    const tablePersons = this.extractor.extractFromTable(table);
                    results.extractionResults.persons.push(...tablePersons);
                }
            }

            // PHASE 3: Save persons to database (ALL as unconfirmed leads)
            console.log('\n📍 PHASE 3: Saving Persons to Database (Unconfirmed Leads)');
            await this.saveExtractedPersons(
                results.extractionResults.persons,
                url,
                sessionId,
                results.pageAnalysis
            );

            // All web-scraped persons are unconfirmed - categorize by confidence for review priority
            const highConfidence = results.extractionResults.persons.filter(
                p => p.confidence >= 0.7
            ).length;
            const mediumConfidence = results.extractionResults.persons.filter(
                p => p.confidence >= 0.5 && p.confidence < 0.7
            ).length;
            const lowConfidence = results.extractionResults.persons.filter(
                p => p.confidence < 0.5
            ).length;

            results.personsAdded.unconfirmed = results.extractionResults.persons.length;
            results.personsAdded.highConfidence = highConfidence;
            results.personsAdded.mediumConfidence = mediumConfidence;
            results.personsAdded.lowConfidence = lowConfidence;

            console.log(`    ✓ Added ${results.personsAdded.unconfirmed} unconfirmed leads to database`);
            console.log(`      • High confidence (≥0.7): ${highConfidence}`);
            console.log(`      • Medium confidence (0.5-0.7): ${mediumConfidence}`);
            console.log(`      • Low confidence (<0.5): ${lowConfidence}`);
            console.log(`    ℹ️  All require verification with primary sources`);

            // BEYOND KIN PROCESSING: If this is a Beyond Kin submission, extract and queue for review
            if (options.isBeyondKin) {
                console.log('\n📍 BEYOND KIN PROCESSING');

                // Try parsing as entry detail page first
                const entryPage = this.extractor.parseBeyondKinEntryPage(
                    results.scrapingResults.rawText,
                    url
                );

                if (entryPage && entryPage.slaveholderName) {
                    console.log('    ✓ Beyond Kin Entry Detail Page detected!');
                    console.log(`    • Slaveholder: ${entryPage.slaveholderName}`);
                    console.log(`    • Location: ${entryPage.locations.join(', ')}`);
                    console.log(`    • Enslaved Persons: ${entryPage.enslavedPersons.length} entries`);
                    if (entryPage.treeUrl) {
                        console.log(`    • Tree URL: ${entryPage.treeUrl}`);
                    }

                    // Calculate total EP count
                    const totalEPs = entryPage.enslavedPersons.reduce((sum, ep) => sum + ep.count, 0);

                    // Add to Beyond Kin review queue
                    await this.db.query(
                        `INSERT INTO beyond_kin_review_queue
                         (source_url, slaveholder_name, institution_name, enslaved_persons,
                          document_type, document_description, document_url, document_location,
                          extraction_confidence, scraping_session_id, submitted_by, priority)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 10)`,
                        [
                            url,
                            entryPage.slaveholderName,
                            entryPage.slaveholderName, // institution = slaveholder for entry pages
                            JSON.stringify(entryPage.enslavedPersons),
                            'Beyond Kin Directory Entry',
                            entryPage.comments || `${totalEPs} enslaved persons documented`,
                            entryPage.treeUrl || null,
                            entryPage.locations.join(', '),
                            0.90, // High confidence for structured entry pages
                            sessionId,
                            options.submittedBy || 'continuous_scraper'
                        ]
                    );

                    console.log(`    ✓ Added to Beyond Kin review queue (${totalEPs} total EPs)`);
                    results.beyondKinEntriesAdded = 1;

                } else {
                    // Try detecting formatted tree pages
                    const isBeyondKinFormat = this.extractor.detectBeyondKinFormat(results.scrapingResults.rawText);

                    if (isBeyondKinFormat) {
                        console.log('    ✓ Beyond Kin Tree format detected!');
                        const beyondKinPersons = this.extractor.extractBeyondKinEntries(
                            results.scrapingResults.rawText,
                            url
                        );
                        const slaveholders = this.extractor.extractBeyondKinSlaveholders(
                            results.scrapingResults.rawText,
                            url
                        );

                        console.log(`    • Found ${beyondKinPersons.length} Beyond Kin formatted persons`);
                        console.log(`    • Found ${slaveholders.length} slaveholder/institution pairs`);

                        // Add to Beyond Kin review queue
                        for (const sh of slaveholders) {
                            // Get enslaved persons for this slaveholder
                            const enslaved = beyondKinPersons.filter(p => p.slaveholder === sh.slaveholderName);

                            if (enslaved.length > 0) {
                                await this.db.query(
                                    `INSERT INTO beyond_kin_review_queue
                                     (source_url, slaveholder_name, institution_name, enslaved_persons,
                                      extraction_confidence, scraping_session_id, submitted_by, priority)
                                     VALUES ($1, $2, $3, $4, $5, $6, $7, 10)`,
                                    [
                                        url,
                                        sh.slaveholderName,
                                        sh.institutionName,
                                        JSON.stringify(enslaved.map(ep => ({
                                            given_name: ep.givenName,
                                            surname: ep.surname,
                                            description: ep.description,
                                            full_name: ep.fullName
                                        }))),
                                        0.95,
                                        sessionId,
                                        options.submittedBy || 'continuous_scraper'
                                    ]
                                );
                            }
                        }

                        console.log(`    ✓ Added ${slaveholders.length} entries to Beyond Kin review queue`);
                        results.beyondKinEntriesAdded = slaveholders.length;
                    } else {
                        console.log('    ⚠️  Marked as Beyond Kin but no Beyond Kin format detected');
                        console.log('    ℹ️  Processing as regular web scrape');
                    }
                }
            }

            // PHASE 3.5: PRIMARY SOURCE CONFIRMING DOCUMENTS (NEW!)
            if (isPrimarySource && isConfirmingDocument) {
                console.log('\n📍 PHASE 3.5: Processing Confirming Documents');
                console.log(`    🎯 This is a PRIMARY SOURCE that can confirm unconfirmed leads!`);

                // Download images (petition scans, document images, etc.)
                let downloadedImages = [];
                if (results.scrapingResults.images.length > 0) {
                    console.log(`    • Found ${results.scrapingResults.images.length} document images`);
                    downloadedImages = await this.scraper.downloadImages(results.scrapingResults.images);
                }

                // Download any linked documents too
                let downloadedDocs = [];
                if (results.scrapingResults.documents.length > 0) {
                    console.log(`    • Found ${results.scrapingResults.documents.length} linked documents`);
                    downloadedDocs = await this.scraper.downloadDocuments(results.scrapingResults.documents);
                }

                const allDownloads = [...downloadedImages, ...downloadedDocs].filter(d => d.success);
                results.documentsDownloaded = allDownloads.length;

                // Link confirming documents to persons and apply promotion logic
                console.log(`    • Linking ${allDownloads.length} documents to ${results.extractionResults.persons.length} persons...`);

                for (const person of results.extractionResults.persons) {
                    await this.processConfirmingDocuments(
                        person,
                        allDownloads,
                        url,
                        results.pageAnalysis
                    );
                }

                console.log(`    ✓ Confirming documents processed and linked`);

            } else if (this.config.autoDownloadDocuments && results.scrapingResults.documents.length > 0) {
                // FALLBACK: Regular document download (non-primary sources)
                console.log('\n📍 PHASE 4: Processing Documents (Non-Primary Source)');
                console.log(`    • Found ${results.scrapingResults.documents.length} documents`);

                const downloadResults = await this.scraper.downloadDocuments(
                    results.scrapingResults.documents
                );

                results.documentsDownloaded = downloadResults.filter(d => d.success).length;
                console.log(`    ✓ Downloaded ${results.documentsDownloaded} documents`);

                // PHASE 5: Auto-upload documents to system
                if (this.config.autoUploadDocuments) {
                    console.log('\n📍 PHASE 5: Auto-Uploading Documents');

                    for (const doc of downloadResults) {
                        if (doc.success) {
                            try {
                                const uploadResult = await this.uploadDocumentToSystem(doc, url);
                                if (uploadResult.success) {
                                    results.documentsUploaded++;
                                    console.log(`      ✓ Uploaded: ${doc.filename} → Document ID: ${uploadResult.documentId}`);
                                }
                            } catch (error) {
                                console.error(`      ✗ Upload failed: ${error.message}`);
                                results.errors.push({
                                    stage: 'document_upload',
                                    file: doc.filename,
                                    error: error.message
                                });
                            }
                        }
                    }

                    console.log(`    ✓ Uploaded ${results.documentsUploaded} documents to system`);
                }
            }

            // Update session with results
            const duration = Date.now() - startTime;
            await this.completeSession(sessionId, results, duration);

            // Add convenience counts for continuous scraper
            results.personsCount = results.extractionResults.persons.length;
            results.documentsCount = results.documentsDownloaded;

            console.log(`\n${'='.repeat(60)}`);
            console.log(`✅ SESSION COMPLETE`);
            console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);
            console.log(`   Persons Found: ${results.personsCount}`);
            console.log(`   Documents Downloaded: ${results.documentsCount}`);
            console.log(`   Documents Uploaded: ${results.documentsUploaded}`);
            if (results.beyondKinEntriesAdded) {
                console.log(`   Beyond Kin Entries: ${results.beyondKinEntriesAdded}`);
            }
            console.log(`${'='.repeat(60)}\n`);

            return results;

        } catch (error) {
            console.error('\n❌ ORCHESTRATION FAILED:', error);
            results.success = false;
            results.errors.push({
                stage: 'orchestration',
                error: error.message,
                stack: error.stack
            });

            await this.failSession(sessionId, error.message);

            return results;
        } finally {
            // CRITICAL FIX: Always close browser to prevent memory leaks
            // This was causing the 8-9 URL submission limit
            try {
                if (this.scraper && this.scraper.browser) {
                    console.log('\n🧹 Cleaning up browser resources...');
                    await this.scraper.close();
                    console.log('   ✓ Browser closed');
                }
            } catch (cleanupError) {
                console.error('   ⚠️ Cleanup warning:', cleanupError.message);
                // Don't throw - cleanup errors shouldn't fail the request
            }
        }
    }

    /**
     * Save extracted persons to appropriate database
     *
     * CRITICAL: ALL web-scraped data goes to unconfirmed_persons table.
     * NEVER auto-confirm based on web scraping - only primary sources can confirm.
     */
    async saveExtractedPersons(persons, sourceUrl, sessionId, pageAnalysis = null) {
        for (const person of persons) {
            try {
                // ALWAYS add to unconfirmed leads - web scraping is NEVER confirmation
                // Only primary historical documents can confirm slave ownership/enslaved status
                await this.addToUnconfirmedDB(person, sourceUrl, sessionId, pageAnalysis);
            } catch (error) {
                console.error(`    ✗ Failed to save ${person.fullName}:`, error.message);
            }
        }
    }

    /**
     * Add person to confirmed database (enslaved_individuals or individuals)
     *
     * NOTE: This method should ONLY be called when verifying with PRIMARY SOURCES.
     * It is kept for future manual verification workflows, but should NEVER
     * be called from web scraping. Web-scraped data is always unconfirmed.
     */
    async addToConfirmedDB(person) {
        // Determine which table based on person type
        if (person.type === 'enslaved') {
            await this.db.query(`
                INSERT INTO enslaved_individuals (
                    enslaved_id, full_name, birth_year, death_year, gender,
                    location, notes, verified
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, false
                )
                ON CONFLICT (enslaved_id) DO UPDATE
                SET updated_at = CURRENT_TIMESTAMP
            `, [
                `enslaved_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                person.fullName,
                person.birthYear,
                person.deathYear,
                person.gender,
                person.locations.join(', '),
                `Auto-extracted from ${person.sourceUrl}\nConfidence: ${person.confidence}\nEvidence: ${person.evidence.substring(0, 200)}`,
            ]);
        } else if (person.type === 'owner') {
            await this.db.query(`
                INSERT INTO individuals (
                    individual_id, full_name, birth_year, death_year,
                    notes
                ) VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (individual_id) DO UPDATE
                SET updated_at = CURRENT_TIMESTAMP
            `, [
                `owner_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                person.fullName,
                person.birthYear,
                person.deathYear,
                `Auto-extracted owner from ${person.sourceUrl}`
            ]);
        }
    }

    /**
     * Add person to unconfirmed leads database
     *
     * All web-scraped persons are marked as 'secondary' or 'tertiary' sources.
     * Only primary historical documents can move someone to confirmed status.
     */
    async addToUnconfirmedDB(person, sourceUrl, sessionId, pageAnalysis = null) {
        // Classify source type based on LLM analysis (or URL as fallback)
        const sourceType = this.classifySourceType(sourceUrl, pageAnalysis);

        await this.db.query(`
            INSERT INTO unconfirmed_persons (
                full_name, person_type, birth_year, death_year, gender,
                locations, source_url, source_type, context_text, confidence_score,
                relationships, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
            person.fullName,
            person.type,
            person.birthYear,
            person.deathYear,
            person.gender,
            person.locations,
            sourceUrl,
            sourceType,
            person.evidence,
            person.confidence,
            JSON.stringify(person.relationships || []),
            person.confidence >= 0.7 ? 'reviewing' : 'pending'
        ]);
    }

    /**
     * Classify source type based on URL
     * NOW DEPRECATED - Use LLM analysis from pageAnalysis instead
     * Kept for backward compatibility with old code
     */
    classifySourceType(url, pageAnalysis = null) {
        // If we have LLM analysis, use that!
        if (pageAnalysis && pageAnalysis.source_type) {
            return pageAnalysis.source_type;
        }

        // Fallback to simple heuristics (only if LLM unavailable)
        const lower = url.toLowerCase();

        // Wikipedia, encyclopedias = tertiary
        if (lower.includes('wikipedia.org') ||
            lower.includes('britannica.com') ||
            lower.includes('encyclopedia')) {
            return 'tertiary';
        }

        // Academic, historical sites = secondary
        if (lower.includes('.edu') ||
            lower.includes('history') ||
            lower.includes('ancestry.com') ||
            lower.includes('familysearch.org') ||
            lower.includes('findagrave.com')) {
            return 'secondary';
        }

        // Archives, library collections = could be primary
        if (lower.includes('archive.org') ||
            lower.includes('loc.gov') ||
            lower.includes('nara.gov') ||
            lower.includes('digitalarchive') ||
            lower.includes('civilwardc.org')) {
            return 'primary'; // But still needs human verification
        }

        // Default to secondary
        return 'secondary';
    }

    /**
     * Process confirming documents for a person
     * Links documents to person, calculates confidence, applies promotion logic
     */
    async processConfirmingDocuments(person, downloadedDocs, sourceUrl, pageAnalysis) {
        try {
            // Find this person in unconfirmed_persons (just added in PHASE 3)
            const personResult = await this.db.query(`
                SELECT lead_id, confidence_score, person_type
                FROM unconfirmed_persons
                WHERE full_name = $1
                AND source_url = $2
                ORDER BY created_at DESC
                LIMIT 1
            `, [person.fullName, sourceUrl]);

            if (personResult.rows.length === 0) {
                console.log(`      ⚠️  Could not find ${person.fullName} in unconfirmed_persons`);
                return;
            }

            const unconfirmedPerson = personResult.rows[0];
            const baseConfidence = parseFloat(unconfirmedPerson.confidence_score) || 0.5;

            // Calculate confidence boost based on document quality
            const confidenceBoost = this.calculateConfidenceBoost(pageAnalysis);

            // Final confidence = base + boost
            const finalConfidence = Math.min(baseConfidence + confidenceBoost, 1.0);

            // Determine promotion status based on hybrid logic
            let promotionStatus = 'pending_review';
            if (finalConfidence >= 0.9) {
                promotionStatus = 'auto_promoted';
            } else if (finalConfidence >= 0.7) {
                promotionStatus = 'manual_review_queue';
            }

            console.log(`      • ${person.fullName}: ${(baseConfidence * 100).toFixed(0)}% + ${(confidenceBoost * 100).toFixed(0)}% = ${(finalConfidence * 100).toFixed(0)}% → ${promotionStatus}`);

            // Insert each downloaded document as a confirming document
            for (const doc of downloadedDocs) {
                await this.db.query(`
                    INSERT INTO confirming_documents (
                        unconfirmed_person_id,
                        document_url,
                        document_type,
                        llm_confidence,
                        llm_reasoning,
                        downloaded_file_path,
                        download_status,
                        downloaded_at,
                        file_size,
                        promotion_status,
                        confidence_boost,
                        final_confidence
                    ) VALUES ($1, $2, $3, $4, $5, $6, 'downloaded', CURRENT_TIMESTAMP, $7, $8, $9, $10)
                `, [
                    unconfirmedPerson.lead_id,
                    doc.originalUrl || sourceUrl,
                    pageAnalysis.document_type || 'unknown',
                    pageAnalysis.confidence,
                    pageAnalysis.reasoning,
                    doc.filePath,
                    doc.fileSize || 0,
                    promotionStatus,
                    confidenceBoost,
                    finalConfidence
                ]);
            }

            // If auto-promoted, promote to confirmed database now
            if (promotionStatus === 'auto_promoted') {
                console.log(`      🚀 AUTO-PROMOTING ${person.fullName} (${(finalConfidence * 100).toFixed(0)}% confidence)`);
                await this.promoteToConfirmed(unconfirmedPerson.lead_id, person, finalConfidence);
            } else if (promotionStatus === 'manual_review_queue') {
                console.log(`      📋 Queued for human review: ${person.fullName} (${(finalConfidence * 100).toFixed(0)}%)`);
            }

        } catch (error) {
            console.error(`      ✗ Error processing confirming docs for ${person.fullName}:`, error.message);
        }
    }

    /**
     * Calculate confidence boost from primary source
     */
    calculateConfidenceBoost(pageAnalysis) {
        if (!pageAnalysis || pageAnalysis.source_type !== 'primary') {
            return 0;
        }

        // Base boost for primary sources
        let boost = 0.25;

        // Higher boost for official government documents
        const officialDocTypes = ['compensation_petition', 'census', 'slave_schedule', 'court_record'];
        if (officialDocTypes.includes(pageAnalysis.document_type)) {
            boost = 0.35;
        }

        // Adjust based on LLM confidence in its classification
        const llmConfidence = pageAnalysis.confidence || 0.8;
        boost = boost * llmConfidence;

        return boost;
    }

    /**
     * Promote unconfirmed person to confirmed database
     * This is called for auto-promoted persons (confidence >= 0.9)
     */
    async promoteToConfirmed(leadId, person, finalConfidence) {
        try {
            // For now, just update status in unconfirmed_persons
            // Later, this can create records in enslaved_people or individuals tables
            await this.db.query(`
                UPDATE unconfirmed_persons
                SET
                    status = 'confirmed',
                    confidence_score = $2,
                    reviewed_at = CURRENT_TIMESTAMP,
                    reviewed_by = 'auto_promotion_system'
                WHERE lead_id = $1
            `, [leadId, finalConfidence]);

            // Update confirming_documents records
            await this.db.query(`
                UPDATE confirming_documents
                SET
                    promoted_at = CURRENT_TIMESTAMP,
                    promoted_to_table = 'unconfirmed_persons',
                    promoted_to_id = $1::text
                WHERE unconfirmed_person_id = $1
                AND promotion_status = 'auto_promoted'
            `, [leadId]);

        } catch (error) {
            console.error(`      ✗ Auto-promotion failed:`, error.message);
        }
    }

    /**
     * Upload document to the system
     */
    async uploadDocumentToSystem(downloadedDoc, sourceUrl) {
        const formData = new FormData();

        // Add file
        formData.append('document', fs.createReadStream(downloadedDoc.filePath));

        // Add metadata
        formData.append('ownerName', downloadedDoc.metadata.guessedOwner || 'Unknown');
        formData.append('documentType', downloadedDoc.metadata.guessedType || 'other');
        formData.append('sourceUrl', sourceUrl);

        // Upload to server
        const response = await fetch(`${this.config.serverUrl}/api/upload-document`, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders()
        });

        const result = await response.json();
        return result;
    }

    /**
     * Create scraping session record
     */
    async createSession(url) {
        const result = await this.db.query(`
            INSERT INTO scraping_sessions (target_url, status)
            VALUES ($1, 'in_progress')
            RETURNING session_id
        `, [url]);

        return result.rows[0].session_id;
    }

    /**
     * Mark session as complete
     */
    async completeSession(sessionId, results, duration) {
        await this.db.query(`
            UPDATE scraping_sessions
            SET
                status = 'completed',
                completed_at = CURRENT_TIMESTAMP,
                duration_ms = $2,
                persons_found = $3,
                high_confidence_persons = $4,
                documents_found = $5,
                documents_downloaded = $6,
                text_length = $7,
                tables_found = $8
            WHERE session_id = $1
        `, [
            sessionId,
            duration,
            results.extractionResults?.persons?.length || 0,
            results.personsAdded.confirmed,
            results.scrapingResults?.documents?.length || 0,
            results.documentsDownloaded,
            results.scrapingResults?.rawText?.length || 0,
            results.scrapingResults?.tables?.length || 0
        ]);
    }

    /**
     * Mark session as failed
     */
    async failSession(sessionId, errorMessage) {
        await this.db.query(`
            UPDATE scraping_sessions
            SET
                status = 'failed',
                completed_at = CURRENT_TIMESTAMP,
                error_message = $2
            WHERE session_id = $1
        `, [sessionId, errorMessage]);
    }

    /**
     * Close all resources
     */
    async close() {
        await this.scraper.close();
    }
}

module.exports = AutonomousResearchOrchestrator;
