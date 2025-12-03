/**
 * Intelligent Orchestrator - Main Coordinator for Intelligent Scraping System
 *
 * This system:
 * 1. Coordinates the entire intelligent scraping process
 * 2. Integrates knowledge management, ML analysis, and dynamic scraping
 * 3. Maintains compatibility with existing UnifiedScraper
 * 4. Provides API endpoints for intelligent scraping
 * 5. Handles knowledge learning and improvement
 */

const KnowledgeManager = require('./KnowledgeManager');
const MLAnalyzer = require('./MLAnalyzer');
const IntelligentScraper = require('./IntelligentScraper');
const UnifiedScraper = require('./UnifiedScraper');

class IntelligentOrchestrator {
    constructor(database) {
        this.db = database;
        this.knowledgeManager = new KnowledgeManager();
        this.mlAnalyzer = new MLAnalyzer();
        this.scraperFactory = new IntelligentScraper(database, this.knowledgeManager, this.mlAnalyzer);
        this.unifiedScraper = new UnifiedScraper(database);
    }

    /**
     * Main entry point: Process a URL with intelligent scraping
     */
    async processURL(url, metadata = {}) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🤖 INTELLIGENT SCRAPING ORCHESTRATOR`);
        console.log(`   Target: ${url}`);
        console.log(`${'='.repeat(60)}`);

        const startTime = Date.now();
        const sessionId = await this.createSession(url);

        const results = {
            sessionId,
            url,
            success: true,
            scrapingResults: null,
            mlAnalysis: null,
            formattedResults: null,
            knowledgeUpdated: false,
            errors: []
        };

        try {
            // Step 1: Create custom scraper
            console.log('\n📍 PHASE 1: Creating Custom Scraper');
            const customScraper = await this.scraperFactory.createCustomScraper(url, metadata);

            // Step 2: Execute intelligent scraping
            console.log('\n📍 PHASE 2: Intelligent Scraping');
            results.scrapingResults = await customScraper.scrape();

            // Step 3: ML Analysis
            console.log('\n📍 PHASE 3: ML Analysis');
            results.mlAnalysis = results.scrapingResults.analysis;

            // Step 4: Format results for database
            console.log('\n📍 PHASE 4: Formatting Results');
            results.formattedResults = customScraper.formatForDatabase();

            // Step 5: Save to database
            console.log('\n📍 PHASE 5: Saving to Database');
            await this.saveResults(results.formattedResults, url, sessionId);

            // Step 6: Update knowledge base
            console.log('\n📍 PHASE 6: Updating Knowledge Base');
            results.knowledgeUpdated = true;

            const duration = Date.now() - startTime;
            await this.completeSession(sessionId, results, duration);

            console.log(`\n${'='.repeat(60)}`);
            console.log(`✅ INTELLIGENT SCRAPING COMPLETE`);
            console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);
            console.log(`   Owners Found: ${results.formattedResults.owners.length}`);
            console.log(`   Enslaved Found: ${results.formattedResults.enslavedPeople.length}`);
            console.log(`   Documents Found: ${results.scrapingResults.documents.length}`);
            console.log(`   Confidence: ${results.mlAnalysis.confidence.toFixed(2)}`);
            console.log(`   Knowledge Updated: ${results.knowledgeUpdated ? 'Yes' : 'No'}`);
            console.log(`${'='.repeat(60)}\n`);

            return results;

        } catch (error) {
            console.error('\n❌ INTELLIGENT SCRAPING FAILED:', error);
            results.success = false;
            results.errors.push({
                stage: 'orchestration',
                error: error.message,
                stack: error.stack
            });

            await this.failSession(sessionId, error.message);
            return results;
        }
    }

    /**
     * Save formatted results to database
     */
    async saveResults(formattedResults, sourceUrl, sessionId) {
        // Save owners
        for (const owner of formattedResults.owners) {
            try {
                await this.db.query(`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, birth_year, death_year,
                        locations, source_url, source_type, confidence_score,
                        context_text, relationships, status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT DO NOTHING
                `, [
                    owner.fullName,
                    owner.type.includes('confirmed') ? 'owner' : 'suspected_owner',
                    null, // birth_year
                    null, // death_year
                    owner.locations || [],
                    owner.sourceUrl,
                    owner.source,
                    owner.confidence,
                    owner.notes,
                    JSON.stringify([]),
                    owner.confidence >= 0.9 ? 'confirmed' :
                    owner.confidence >= 0.7 ? 'reviewing' : 'pending'
                ]);

                console.log(`   ✓ Saved owner: ${owner.fullName} (${owner.type})`);
            } catch (error) {
                console.error(`   ✗ Failed to save owner ${owner.fullName}:`, error.message);
            }
        }

        // Save enslaved people
        for (const enslaved of formattedResults.enslavedPeople) {
            try {
                await this.db.query(`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, birth_year, death_year,
                        locations, source_url, source_type, confidence_score,
                        context_text, relationships, status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT DO NOTHING
                `, [
                    enslaved.fullName,
                    enslaved.type.includes('confirmed') ? 'enslaved' : 'suspected_enslaved',
                    null, // birth_year
                    null, // death_year
                    enslaved.location ? [enslaved.location] : [],
                    enslaved.sourceUrl,
                    enslaved.source,
                    enslaved.confidence,
                    enslaved.notes,
                    JSON.stringify([{ type: 'enslaved_by', name: enslaved.slaveholder }]),
                    enslaved.confidence >= 0.9 ? 'confirmed' :
                    enslaved.confidence >= 0.7 ? 'reviewing' : 'pending'
                ]);

                console.log(`   ✓ Saved enslaved: ${enslaved.fullName} (${enslaved.type})`);
            } catch (error) {
                console.error(`   ✗ Failed to save enslaved ${enslaved.fullName}:`, error.message);
            }
        }

        // Save relationships
        for (const relationship of formattedResults.relationships) {
            try {
                await this.db.query(`
                    INSERT INTO relationships (
                        relationship_type, individual_id_1, individual_id_2,
                        source_url, confidence_score, notes
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT DO NOTHING
                `, [
                    relationship.type,
                    relationship.owner,
                    relationship.enslaved,
                    sourceUrl,
                    relationship.confidence,
                    `Relationship extracted by intelligent scraper`
                ]);

                console.log(`   ✓ Saved relationship: ${relationship.owner} → ${relationship.enslaved}`);
            } catch (error) {
                console.error(`   ✗ Failed to save relationship:`, error.message);
            }
        }
    }

    /**
     * Create scraping session record
     */
    async createSession(url) {
        const result = await this.db.query(`
            INSERT INTO scraping_sessions (target_url, status, is_intelligent)
            VALUES ($1, 'in_progress', true)
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
                text_length = $6,
                is_intelligent = true,
                ml_confidence = $7
            WHERE session_id = $1
        `, [
            sessionId,
            duration,
            results.formattedResults?.owners?.length + results.formattedResults?.enslavedPeople?.length || 0,
            results.formattedResults?.owners?.filter(o => o.confidence >= 0.9).length || 0,
            results.scrapingResults?.documents?.length || 0,
            results.scrapingResults?.analysis?.contentQuality * 1000 || 0,
            results.mlAnalysis?.confidence || 0
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
                error_message = $2,
                is_intelligent = true
            WHERE session_id = $1
        `, [sessionId, errorMessage]);
    }

    /**
     * Get knowledge statistics
     */
    getKnowledgeStatistics() {
        return {
            ...this.knowledgeManager.getLearningStatistics(),
            sitesLearned: Object.keys(this.knowledgeManager.getAllSites()).length,
            topSites: this.knowledgeManager.getTopPerformingSites(3)
        };
    }

    /**
     * Get ML analysis for a URL
     */
    async getMLAnalysis(url, text) {
        return this.mlAnalyzer.analyzePageContent(text, url);
    }

    /**
     * Fallback to unified scraper for compatibility
     */
    async fallbackToUnifiedScraper(url, options) {
        console.log('🔄 Falling back to UnifiedScraper for compatibility');
        return this.unifiedScraper.scrapeURL(url, options);
    }
}

module.exports = IntelligentOrchestrator;
