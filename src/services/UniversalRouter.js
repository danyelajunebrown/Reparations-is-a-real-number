/**
 * Universal URL Router
 * 
 * Smart routing layer that:
 * 1. Classifies URLs using SourceClassifier
 * 2. Routes to appropriate scraper in UnifiedScraper
 * 3. Decides whether to execute immediately or queue
 * 4. Provides unified interface for contribute page
 * 
 * This connects existing infrastructure without replacing it.
 */

const SourceClassifier = require('./SourceClassifier');
const UnifiedScraper = require('./scraping/UnifiedScraper');

class UniversalRouter {
    constructor(db) {
        this.db = db;
        this.classifier = new SourceClassifier();
        this.scraper = new UnifiedScraper(db);
    }

    /**
     * Analyze a URL and determine routing strategy
     * 
     * @param {string} url - The URL to analyze
     * @param {object} metadata - Optional metadata (title, description, etc.)
     * @returns {object} Routing information
     */
    async route(url, metadata = {}) {
        console.log(`\n🔀 UNIVERSAL ROUTER - Analyzing URL`);
        console.log(`   URL: ${url.substring(0, 80)}...`);

        // Step 1: Classify source type (primary/secondary/tertiary)
        const classification = this.classifier.classify(url, metadata);
        
        // Step 2: Detect scraper category
        const category = this.scraper.detectCategory(url);
        
        // Step 3: Determine requirements and execution strategy
        const requirements = this.getRequirements(category, url);
        
        // Step 4: Decide immediate vs queued execution
        const canExecuteImmediately = this.canExecuteImmediately(requirements);

        const routing = {
            classification: {
                sourceType: classification.sourceType,
                sourceName: classification.sourceName,
                confidence: classification.confidence,
                isPrimarySource: classification.isPrimarySource,
                shouldAutoConfirm: classification.shouldAutoConfirm,
                recommendedMethod: classification.recommendedMethod
            },
            scraper: {
                category: category,
                handler: this.getHandlerName(category),
                requirements: requirements
            },
            execution: {
                strategy: canExecuteImmediately ? 'immediate' : 'queued',
                reason: this.getExecutionReason(requirements),
                estimatedDuration: requirements.estimatedDuration
            },
            targetTables: this.getTargetTables(classification, category)
        };

        console.log(`   Source Type: ${classification.sourceType} (${classification.confidence}% confidence)`);
        console.log(`   Scraper: ${category}`);
        console.log(`   Execution: ${routing.execution.strategy} (${routing.execution.reason})`);
        console.log(`   Estimated Duration: ${requirements.estimatedDuration}s`);

        return routing;
    }

    /**
     * Extract data from URL using appropriate scraper
     * 
     * @param {string} url - The URL to extract from
     * @param {object} options - Extraction options
     * @returns {object} Extraction result or queue entry
     */
    async extract(url, options = {}) {
        const routing = await this.route(url, options.metadata);
        
        // If immediate execution is possible and preferred, do it
        if (routing.execution.strategy === 'immediate') {
            console.log(`\n⚡ Executing immediately...`);
            
            try {
                const result = await this.scraper.scrapeURL(url, {
                    category: routing.scraper.category,
                    ...options
                });
                
                return {
                    immediate: true,
                    routing: routing,
                    result: result,
                    message: 'Extraction completed successfully'
                };
                
            } catch (error) {
                console.error(`   ❌ Immediate execution failed: ${error.message}`);
                
                // Fall back to queueing if immediate fails
                console.log(`   🔄 Falling back to queue...`);
                return await this.queueForProcessing(url, routing, options);
            }
        }
        
        // Queue for background processing
        return await this.queueForProcessing(url, routing, options);
    }

    /**
     * Add URL to scraping queue for background processing
     */
    async queueForProcessing(url, routing, options) {
        console.log(`\n📋 Queueing for background processing...`);
        
        try {
            const queueEntry = await this.db.query(`
                INSERT INTO scraping_queue (
                    url, 
                    category, 
                    status, 
                    priority,
                    metadata,
                    requirements,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                ON CONFLICT (url) DO UPDATE
                SET updated_at = CURRENT_TIMESTAMP
                RETURNING queue_id, url, status, created_at
            `, [
                url,
                routing.scraper.category,
                'pending',
                options.priority || 'normal',
                JSON.stringify({
                    sourceType: routing.classification.sourceType,
                    confidence: routing.classification.confidence,
                    ...options.metadata
                }),
                JSON.stringify(routing.scraper.requirements)
            ]);

            const queue = queueEntry.rows[0];
            
            console.log(`   ✅ Queued as #${queue.queue_id}`);
            
            return {
                queued: true,
                routing: routing,
                queueId: queue.queue_id,
                queueUrl: url,
                status: queue.status,
                message: `Queued for processing. ${routing.execution.reason}`,
                estimatedWait: this.estimateQueueWait(routing.scraper.requirements)
            };
            
        } catch (error) {
            console.error(`   ❌ Queue error: ${error.message}`);
            throw new Error(`Failed to queue URL: ${error.message}`);
        }
    }

    /**
     * Get requirements for a scraper category
     */
    getRequirements(category, url) {
        const requirements = {
            needsBrowser: false,
            needsAuth: false,
            needsOCR: false,
            isComplex: false,
            estimatedDuration: 5 // seconds
        };

        switch (category) {
            case 'familysearch':
                // FamilySearch film viewer needs browser + auth
                if (url.includes('/ark:') || url.includes('/film/')) {
                    requirements.needsBrowser = true;
                    requirements.needsAuth = true;
                    requirements.needsOCR = true;
                    requirements.isComplex = true;
                    requirements.estimatedDuration = 60; // 1 minute per page
                }
                // Catalog pages are simpler
                else if (url.includes('/catalog/')) {
                    requirements.estimatedDuration = 10;
                }
                break;

            case 'beyondkin':
            case 'civilwardc':
            case 'rootsweb_census':
                // Simple HTTP scraping
                requirements.estimatedDuration = 3;
                break;

            case 'wikipedia':
            case 'findagrave':
                // HTTP scraping with some parsing
                requirements.estimatedDuration = 5;
                break;

            case 'archive':
                // May need OCR for documents
                if (url.includes('.pdf') || url.includes('item')) {
                    requirements.needsOCR = true;
                    requirements.estimatedDuration = 30;
                }
                break;

            case 'louisiana_slave_db':
            case 'ucl_lbs':
            case 'underwriting_souls':
                // New handlers - assume medium complexity
                requirements.estimatedDuration = 15;
                break;

            case 'generic':
                // Unknown - be conservative
                requirements.estimatedDuration = 10;
                break;
        }

        return requirements;
    }

    /**
     * Determine if URL can be executed immediately
     * 
     * Strategy: Execute immediately if:
     * - Doesn't need browser automation
     * - Doesn't need authentication
     * - Expected to complete in < 20 seconds
     */
    canExecuteImmediately(requirements) {
        // Never execute immediately if needs browser or auth
        if (requirements.needsBrowser || requirements.needsAuth) {
            return false;
        }

        // Never execute immediately if very complex
        if (requirements.isComplex) {
            return false;
        }

        // Execute immediately if expected to be fast
        return requirements.estimatedDuration < 20;
    }

    /**
     * Get human-readable reason for execution strategy
     */
    getExecutionReason(requirements) {
        if (requirements.needsAuth) {
            return 'Requires authentication - must queue';
        }
        if (requirements.needsBrowser) {
            return 'Requires browser automation - must queue';
        }
        if (requirements.isComplex) {
            return 'Complex operation - queueing recommended';
        }
        if (requirements.estimatedDuration >= 20) {
            return 'Long-running operation - queueing recommended';
        }
        return 'Simple HTTP operation - can execute immediately';
    }

    /**
     * Estimate wait time in queue
     */
    estimateQueueWait(requirements) {
        if (requirements.needsBrowser) {
            return '5-15 minutes (browser automation)';
        }
        if (requirements.needsOCR) {
            return '2-5 minutes (OCR processing)';
        }
        return '1-3 minutes (standard processing)';
    }

    /**
     * Get handler name for display
     */
    getHandlerName(category) {
        const handlers = {
            'beyondkin': 'Beyond Kin Scraper',
            'civilwardc': 'Civil War DC Scraper',
            'rootsweb_census': 'Rootsweb Census Scraper',
            'wikipedia': 'Wikipedia Scraper',
            'findagrave': 'FindAGrave Scraper',
            'familysearch': 'FamilySearch Scraper',
            'archive': 'Archive.org Scraper',
            'louisiana_slave_db': 'Louisiana Slave Database Scraper',
            'ucl_lbs': 'UCL Legacies of British Slavery Scraper',
            'underwriting_souls': 'Underwriting Souls Scraper',
            'generic': 'Generic Web Scraper'
        };
        return handlers[category] || 'Unknown Handler';
    }

    /**
     * Get target database tables based on source type and category
     */
    getTargetTables(classification, category) {
        const tables = {
            primary: ['unconfirmed_persons', 'source_documents'],
            secondary: ['unconfirmed_persons'],
            staging: ['unconfirmed_persons']
        };

        // High-confidence primary sources may promote directly
        if (classification.shouldAutoConfirm) {
            tables.confirmed = ['individuals', 'enslaved_individuals'];
        }

        // Rootsweb census goes to individuals for confirmed slaveholders
        if (category === 'rootsweb_census') {
            tables.confirmed = ['individuals', 'slaveholder_records'];
        }

        // Civil War DC petitions are primary sources
        if (category === 'civilwardc') {
            tables.primary = ['individuals', 'enslaved_individuals', 'unconfirmed_persons'];
        }

        return tables;
    }

    /**
     * Get queue status
     */
    async getQueueStatus(queueId) {
        const result = await this.db.query(`
            SELECT 
                queue_id,
                url,
                category,
                status,
                priority,
                metadata,
                requirements,
                error_message,
                attempts,
                created_at,
                started_at,
                completed_at,
                updated_at
            FROM scraping_queue
            WHERE queue_id = $1
        `, [queueId]);

        if (result.rows.length === 0) {
            return null;
        }

        const queue = result.rows[0];
        
        return {
            queueId: queue.queue_id,
            url: queue.url,
            category: queue.category,
            status: queue.status,
            priority: queue.priority,
            metadata: queue.metadata,
            requirements: queue.requirements,
            error: queue.error_message,
            attempts: queue.attempts,
            timestamps: {
                created: queue.created_at,
                started: queue.started_at,
                completed: queue.completed_at,
                updated: queue.updated_at
            },
            elapsedMs: queue.started_at ? 
                (Date.now() - new Date(queue.started_at).getTime()) : 0
        };
    }
}

module.exports = UniversalRouter;
