/**
 * BaseAgent - Foundation for all genealogy processing agents
 * 
 * Provides common functionality:
 * - Database connection management
 * - Queue processing
 * - Error handling and retry logic
 * - Logging
 * - Rate limiting
 * - Graceful shutdown
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { neon } = require('@neondatabase/serverless');

class BaseAgent {
  constructor(config = {}) {
    this.agentType = config.agentType || 'base_agent';
    this.rateLimit = config.rateLimit || 2000; // ms between requests
    this.batchSize = config.batchSize || 10; // items to process per iteration
    this.maxRetries = config.maxRetries || 3;
    this.running = false;
    this.stats = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      startTime: Date.now()
    };
    
    // Database connection
    this.sql = neon(process.env.DATABASE_URL);
    
    // Setup graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * Start the agent
   */
  async start() {
    console.log(`\n[${this.agentType}] Starting...`);
    this.running = true;
    
    try {
      await this.initialize();
      await this.run();
    } catch (err) {
      console.error(`[${this.agentType}] Fatal error:`, err);
      await this.handleFatalError(err);
    }
  }

  /**
   * Initialize agent (override in subclass)
   */
  async initialize() {
    // Subclasses can override for custom initialization
    console.log(`[${this.agentType}] Initialized`);
  }

  /**
   * Main processing loop
   */
  async run() {
    while (this.running) {
      try {
        const hasWork = await this.processNextBatch();
        
        if (!hasWork) {
          console.log(`[${this.agentType}] Queue empty, waiting...`);
          await this.sleep(30000); // Wait 30 seconds if no work
          continue;
        }
        
        // Print stats every 10 items
        if (this.stats.processed % 10 === 0 && this.stats.processed > 0) {
          this.printStats();
        }
        
        // Rate limit
        await this.sleep(this.rateLimit);
        
      } catch (err) {
        console.error(`[${this.agentType}] Batch processing error:`, err.message);
        await this.sleep(5000); // Wait 5 seconds on error
      }
    }
    
    console.log(`[${this.agentType}] Stopped`);
    this.printStats();
  }

  /**
   * Process next batch of items from queue
   * @returns {boolean} true if work was done, false if queue empty
   */
  async processNextBatch() {
    // Get pending items from queue
    const items = await this.getQueueItems(this.batchSize);
    
    if (items.length === 0) {
      return false;
    }
    
    console.log(`[${this.agentType}] Processing ${items.length} items...`);
    
    for (const item of items) {
      try {
        await this.markAsProcessing(item.id);
        
        const result = await this.processItem(item);
        
        if (result.success) {
          await this.markAsCompleted(item.id, result);
          this.stats.succeeded++;
        } else {
          await this.markAsError(item.id, result.error);
          this.stats.failed++;
        }
        
      } catch (err) {
        console.error(`[${this.agentType}] Error processing item ${item.id}:`, err.message);
        await this.markAsError(item.id, err.message);
        this.stats.failed++;
      }
      
      this.stats.processed++;
    }
    
    return true;
  }

  /**
   * Get items from agent processing queue (override for custom query)
   */
  async getQueueItems(limit) {
    return await this.sql`
      SELECT * FROM agent_processing_queue
      WHERE agent_type = ${this.agentType}
      AND status = 'pending'
      AND next_attempt <= NOW()
      ORDER BY priority ASC, created_at ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Mark item as being processed
   */
  async markAsProcessing(itemId) {
    await this.sql`
      UPDATE agent_processing_queue
      SET 
        status = 'processing',
        last_attempt = NOW(),
        attempts = attempts + 1
      WHERE id = ${itemId}
    `;
  }

  /**
   * Mark item as completed
   */
  async markAsCompleted(itemId, result = {}) {
    await this.sql`
      UPDATE agent_processing_queue
      SET 
        status = 'completed',
        completed_at = NOW()
      WHERE id = ${itemId}
    `;
  }

  /**
   * Mark item as error and schedule retry if under max attempts
   */
  async markAsError(itemId, errorMessage) {
    const item = await this.sql`
      SELECT attempts FROM agent_processing_queue WHERE id = ${itemId}
    `;
    
    if (item.length === 0) return;
    
    const attempts = item[0].attempts;
    
    if (attempts >= this.maxRetries) {
      // Max retries reached, mark as error
      await this.sql`
        UPDATE agent_processing_queue
        SET 
          status = 'error',
          error_message = ${errorMessage}
        WHERE id = ${itemId}
      `;
    } else {
      // Schedule retry
      await this.sql`
        UPDATE agent_processing_queue
        SET 
          status = 'pending',
          error_message = ${errorMessage},
          next_attempt = NOW() + INTERVAL '5 minutes'
        WHERE id = ${itemId}
      `;
    }
  }

  /**
   * Process a single item (MUST be overridden by subclass)
   */
  async processItem(item) {
    throw new Error('processItem() must be implemented by subclass');
  }

  /**
   * Add item to queue
   */
  async queueItem(unifiedPersonId, taskDetails = {}, priority = 5) {
    await this.sql`
      INSERT INTO agent_processing_queue (
        unified_person_id,
        agent_type,
        priority,
        task_details
      ) VALUES (
        ${unifiedPersonId},
        ${this.agentType},
        ${priority},
        ${JSON.stringify(taskDetails)}
      )
      ON CONFLICT DO NOTHING
    `;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log(`\n[${this.agentType}] Shutting down gracefully...`);
    this.running = false;
    
    // Give time for current batch to finish
    await this.sleep(2000);
    
    this.printStats();
    process.exit(0);
  }

  /**
   * Handle fatal errors
   */
  async handleFatalError(err) {
    console.error(`[${this.agentType}] FATAL ERROR:`, err);
    // Log to database or alert system
    process.exit(1);
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Print statistics
   */
  printStats() {
    const elapsed = (Date.now() - this.stats.startTime) / 1000;
    const rate = this.stats.processed / (elapsed / 60);
    
    console.log(`\n[${this.agentType}] Stats:`);
    console.log(`  Processed: ${this.stats.processed}`);
    console.log(`  Succeeded: ${this.stats.succeeded}`);
    console.log(`  Failed: ${this.stats.failed}`);
    console.log(`  Rate: ${rate.toFixed(1)}/min`);
    console.log(`  Runtime: ${(elapsed / 60).toFixed(1)} minutes\n`);
  }

  /**
   * Log to database
   */
  async log(level, message, details = {}) {
    // Could expand to store logs in database
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${this.agentType}] [${level}] ${message}`);
    
    if (Object.keys(details).length > 0) {
      console.log('  Details:', JSON.stringify(details, null, 2));
    }
  }
}

module.exports = BaseAgent;
