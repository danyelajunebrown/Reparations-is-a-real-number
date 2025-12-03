/**
 * Reparations Platform - Refactored Server
 *
 * Clean, modular Express server using modern architecture patterns.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

// New infrastructure
const config = require('../config');
const logger = require('./utils/logger');
const db = require('./database/connection');

// Middleware
const { errorHandler } = require('../middleware/error-handler');
const { generalLimiter } = require('../middleware/rate-limit');

// Legacy processors (to be refactored)
const EnhancedDocumentProcessor = require('./services/document/EnhancedDocumentProcessor');
const StorageAdapter = require('./services/document/S3StorageAdapter');

// Routes
const documentsRouter = require('./api/routes/documents');
const researchRouter = require('./api/routes/research');
const healthRouter = require('./api/routes/health');
const errorsRouter = require('./api/routes/errors');

// Initialize Express app
const app = express();

// =============================================================================
// CORS Configuration
// =============================================================================

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'https://danyelajunebrown.github.io',
      ...config.security.allowedOrigins
    ];

    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is allowed
    const isAllowed = allowedOrigins.some(allowed =>
      origin === allowed || origin.startsWith(allowed)
    );

    if (isAllowed) {
      logger.debug('CORS request allowed', { origin });
      callback(null, true);
    } else {
      logger.security('CORS request blocked', { origin, allowedOrigins });
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// =============================================================================
// Middleware Stack
// =============================================================================

// Request logging
app.use(logger.middleware);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving
app.use(express.static('frontend/public'));

// Serve specific test files
app.get('/test-upload.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'test-upload.html'));
});

app.get('/test-viewer.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'test-viewer.html'));
});

// Rate limiting
app.use('/api', generalLimiter);

// =============================================================================
// Initialize Shared Components
// =============================================================================

// Storage adapter
const storageAdapter = new StorageAdapter({
  storage: {
    root: config.storage.root,
    s3: config.storage.s3
  }
});

// Document processor is already instantiated
const documentProcessor = EnhancedDocumentProcessor;

// Make processor available to routes
app.set('documentProcessor', documentProcessor);

// =============================================================================
// Mount Routes
// =============================================================================

app.use('/api/documents', documentsRouter);
app.use('/api/research', researchRouter);
app.use('/api/health', healthRouter);
app.use('/api/errors', errorsRouter);

// Legacy compatibility routes (redirect to new routes)
app.post('/api/upload-document', (req, res) => {
  logger.warn('Legacy endpoint /api/upload-document called, redirecting to /api/documents/upload');
  res.redirect(307, '/api/documents/upload');
});

app.post('/api/llm-query', (req, res) => {
  logger.warn('Legacy endpoint /api/llm-query called, redirecting to /api/research/query');
  res.redirect(307, '/api/research/query');
});

app.get('/health', (req, res) => {
  res.redirect(307, '/api/health');
});

// =============================================================================
// Legacy API Endpoints (for frontend compatibility)
// =============================================================================

// Carousel data endpoint - returns documents and people for the carousel display
app.get('/api/carousel-data', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    // Get documents from database
    const docsResult = await db.query(`
      SELECT
        document_id,
        owner_name,
        owner_birth_year,
        owner_death_year,
        owner_location,
        doc_type,
        total_enslaved,
        total_reparations,
        created_at
      FROM documents
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    // Transform to carousel card format
    const cards = docsResult.rows.map(doc => ({
      id: doc.document_id,
      type: 'owner',
      name: doc.owner_name || 'Unknown Owner',
      birthYear: doc.owner_birth_year,
      deathYear: doc.owner_death_year,
      location: doc.owner_location,
      documentType: doc.doc_type,
      enslavedCount: doc.total_enslaved || 0,
      reparations: doc.total_reparations || 0,
      documentIds: [doc.document_id]
    }));

    res.json({
      success: true,
      cards,
      breakdown: {
        owners: cards.length,
        enslaved: 0
      }
    });
  } catch (error) {
    logger.error('Carousel data error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to load carousel data',
      cards: []
    });
  }
});

// Beyond Kin endpoints
app.get('/api/beyond-kin/pending', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM beyond_kin_review
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json({ success: true, reviews: result.rows });
  } catch (error) {
    // Table might not exist
    res.json({ success: true, reviews: [] });
  }
});

app.post('/api/beyond-kin/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      `UPDATE beyond_kin_review SET status = 'approved' WHERE id = $1`,
      [id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/beyond-kin/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      `UPDATE beyond_kin_review SET status = 'rejected' WHERE id = $1`,
      [id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/beyond-kin/:id/needs-document', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      `UPDATE beyond_kin_review SET status = 'needs_document' WHERE id = $1`,
      [id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Process individual metadata endpoint
app.post('/api/process-individual-metadata', async (req, res) => {
  try {
    const { documentId, metadata } = req.body;
    // Store metadata - simplified version
    logger.info('Processing metadata', { documentId, metadata });
    res.json({ success: true, message: 'Metadata processed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// Document Listing and Search Endpoints
// =============================================================================

// List all documents with pagination
app.get('/api/documents', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const documents = await db.query(
      `SELECT document_id, owner_name, doc_type, filename, file_size,
              mime_type, owner_location, created_at, total_enslaved
       FROM documents
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await db.query('SELECT COUNT(*) FROM documents');
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      count: documents.rows.length,
      total: totalCount,
      limit,
      offset,
      documents: documents.rows
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search documents across multiple fields
app.get('/api/search-documents', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const searchTerm = query.trim();
    const normalizedSearch = searchTerm
      .toLowerCase()
      .replace(/['\s-]/g, '')
      .replace(/^de/, 'd');

    logger.info(`Searching for: "${searchTerm}"`);

    const searchQuery = `
      SELECT DISTINCT
        d.document_id,
        d.owner_name,
        d.filename,
        d.doc_type,
        d.file_size,
        d.mime_type,
        d.owner_location,
        d.owner_birth_year,
        d.owner_death_year,
        d.owner_familysearch_id,
        d.total_enslaved,
        d.total_reparations,
        d.created_at
      FROM documents d
      WHERE
        LOWER(d.owner_name) LIKE '%' || LOWER($1) || '%'
        OR LOWER(REPLACE(REPLACE(REPLACE(d.owner_name, '''', ''), ' ', ''), '-', ''))
           LIKE '%' || $2 || '%'
        OR d.owner_familysearch_id = $1
      ORDER BY d.created_at DESC
      LIMIT 100
    `;

    const results = await db.query(searchQuery, [searchTerm, normalizedSearch]);

    res.json({
      success: true,
      query: searchTerm,
      count: results.rows.length,
      documents: results.rows
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// Queue and Scraping Endpoints (for contribute.html)
// =============================================================================

// Submit URL for scraping
app.post('/api/submit-url', async (req, res) => {
  try {
    const { url, category, submittedBy, metadata } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid URL format' });
    }

    // Check if URL already in queue
    const existingCheck = await db.query(
      `SELECT id, status FROM scraping_queue
       WHERE url = $1 AND status IN ('pending', 'processing')
       LIMIT 1`,
      [url]
    );

    if (existingCheck.rows.length > 0) {
      return res.json({
        success: true,
        message: 'This URL is already in the queue!',
        queueId: existingCheck.rows[0].id,
        status: existingCheck.rows[0].status
      });
    }

    // Set priority based on category and source type
    let priority = 5;
    if (category === 'beyondkin') priority = 10;
    if (category === 'civilwardc') priority = 10; // Primary source
    if (category === 'slaveholders1860') priority = 10; // Primary source
    if (metadata?.isPrimary) priority = 10;

    // Build metadata object for scraper
    const scraperMetadata = {
      ...metadata,
      category,
      submittedAt: new Date().toISOString()
    };

    const result = await db.query(
      `INSERT INTO scraping_queue (url, category, submitted_by, status, priority, metadata)
       VALUES ($1, $2, $3, 'pending', $4, $5::jsonb)
       RETURNING id, url, status, submitted_at, priority`,
      [url, category || 'other', submittedBy || 'anonymous', priority, JSON.stringify(scraperMetadata)]
    );

    // Generate appropriate message based on source type
    let message = 'URL submitted successfully!';
    if (category === 'beyondkin') {
      message = 'Beyond Kin submission received! High priority - suspected owners/enslaved.';
    } else if (category === 'civilwardc') {
      message = 'Civil War DC petition submitted! Primary source - confirmed owners/enslaved.';
    } else if (category === 'slaveholders1860') {
      message = 'Large Slaveholders 1860 submitted! Primary source - confirmed owners.';
    } else if (category === 'surnames1870') {
      message = 'Surname Matches 1870 submitted! Suspected enslaved descendants.';
    } else if (metadata?.isPrimary) {
      message = 'Primary source submitted! Can confirm owner/enslaved status.';
    }

    res.json({
      success: true,
      message,
      queueEntry: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get queue statistics
app.get('/api/queue-stats', async (req, res) => {
  try {
    const stats = await db.query(`SELECT * FROM queue_stats LIMIT 1`);
    const docsResult = await db.query(`
      SELECT COUNT(*) as count FROM scraping_sessions
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
    `);

    res.json({
      pending_urls: stats.rows[0]?.pending_urls || 0,
      processing_urls: stats.rows[0]?.processing_urls || 0,
      completed_urls: stats.rows[0]?.completed_urls || 0,
      failed_urls: stats.rows[0]?.failed_urls || 0,
      persons_24h: stats.rows[0]?.persons_24h || 0,
      documents_24h: docsResult.rows[0]?.count || 0
    });
  } catch (error) {
    // Return zeros if tables don't exist
    res.json({
      pending_urls: 0,
      processing_urls: 0,
      completed_urls: 0,
      failed_urls: 0,
      persons_24h: 0,
      documents_24h: 0
    });
  }
});

// Get population statistics
app.get('/api/population-stats', async (req, res) => {
  try {
    const totalResult = await db.query(`SELECT COUNT(*) as total FROM individuals`);
    const slaveholdersResult = await db.query(`
      SELECT COUNT(DISTINCT individual_id) as count FROM individuals
      WHERE total_enslaved > 0
    `);
    const enslavedResult = await db.query(`SELECT COUNT(*) as count FROM enslaved_people`);

    const totalIndividuals = parseInt(totalResult.rows[0]?.total) || 0;
    const slaveholdersFound = parseInt(slaveholdersResult.rows[0]?.count) || 0;
    const enslavedFound = parseInt(enslavedResult.rows[0]?.count) || 0;
    const targetSlaveholders = 393975;

    res.json({
      total_individuals: totalIndividuals,
      slaveholders_found: slaveholdersFound,
      enslaved_found: enslavedFound,
      target_slaveholders: targetSlaveholders,
      progress_percent: ((slaveholdersFound / targetSlaveholders) * 100).toFixed(4)
    });
  } catch (error) {
    res.json({
      total_individuals: 0,
      slaveholders_found: 0,
      enslaved_found: 0,
      target_slaveholders: 393975,
      progress_percent: '0.0000'
    });
  }
});

// Get detailed extraction statistics (confirmed vs suspected)
app.get('/api/extraction-stats', async (req, res) => {
  try {
    // Query unconfirmed_persons table for breakdown by person_type and status
    const unconfirmedStats = await db.query(`
      SELECT
        person_type,
        status,
        COUNT(*) as count
      FROM unconfirmed_persons
      GROUP BY person_type, status
      ORDER BY person_type, status
    `);

    // Query individuals table (confirmed slaveholders)
    const confirmedIndividuals = await db.query(`
      SELECT COUNT(*) as count FROM individuals
    `);

    // Query enslaved_individuals table if it exists
    let confirmedEnslaved = { rows: [{ count: 0 }] };
    try {
      confirmedEnslaved = await db.query(`
        SELECT COUNT(*) as count FROM enslaved_individuals
      `);
    } catch (e) {
      // Table might not exist
    }

    // Build breakdown
    const breakdown = {
      confirmed_owners: parseInt(confirmedIndividuals.rows[0]?.count) || 0,
      confirmed_enslaved: parseInt(confirmedEnslaved.rows[0]?.count) || 0,
      suspected_owners: 0,
      suspected_enslaved: 0,
      pending_review: 0,
      total_unconfirmed: 0
    };

    // Parse unconfirmed_persons results
    const byType = {};
    unconfirmedStats.rows.forEach(row => {
      const key = `${row.person_type}_${row.status}`;
      byType[key] = parseInt(row.count) || 0;
      breakdown.total_unconfirmed += parseInt(row.count) || 0;

      if (row.person_type === 'suspected_owner' || row.person_type === 'owner') {
        if (row.status === 'pending' || row.status === 'reviewing') {
          breakdown.suspected_owners += parseInt(row.count) || 0;
        }
      }
      if (row.person_type === 'suspected_enslaved' || row.person_type === 'enslaved') {
        if (row.status === 'pending' || row.status === 'reviewing') {
          breakdown.suspected_enslaved += parseInt(row.count) || 0;
        }
      }
      if (row.status === 'pending') {
        breakdown.pending_review += parseInt(row.count) || 0;
      }
    });

    res.json({
      success: true,
      breakdown,
      detailed: byType,
      raw: unconfirmedStats.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      breakdown: {
        confirmed_owners: 0,
        confirmed_enslaved: 0,
        suspected_owners: 0,
        suspected_enslaved: 0,
        pending_review: 0,
        total_unconfirmed: 0
      }
    });
  }
});

// Trigger queue processing
app.post('/api/trigger-queue-processing', async (req, res) => {
  try {
    const batchSize = Math.min(parseInt(req.body.batchSize) || 3, 5);

    const result = await db.query(
      `SELECT * FROM scraping_queue
       WHERE status = 'pending'
       ORDER BY priority DESC, submitted_at ASC
       LIMIT $1`,
      [batchSize]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        message: 'No pending URLs in queue',
        processed: 0
      });
    }

    // Respond immediately
    res.json({
      success: true,
      message: `Processing ${result.rows.length} URLs in background`,
      queuedCount: result.rows.length
    });

    // Process in background (don't await)
    processQueueInBackground(result.rows).catch(error => {
      logger.error('Background queue processing error', { error: error.message });
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Process ALL pending URLs in the queue (auto-process full backlog)
app.post('/api/process-full-backlog', async (req, res) => {
  try {
    // Get count of pending items
    const countResult = await db.query(
      `SELECT COUNT(*) as count FROM scraping_queue WHERE status = 'pending'`
    );
    const pendingCount = parseInt(countResult.rows[0].count);

    if (pendingCount === 0) {
      return res.json({
        success: true,
        message: 'No pending URLs in queue',
        processed: 0
      });
    }

    // Get all pending URLs, prioritized
    const result = await db.query(
      `SELECT * FROM scraping_queue
       WHERE status = 'pending'
       ORDER BY priority DESC, submitted_at ASC`
    );

    // Respond immediately with count
    res.json({
      success: true,
      message: `Processing ALL ${result.rows.length} pending URLs in background`,
      queuedCount: result.rows.length,
      estimatedTime: `${Math.ceil(result.rows.length * 5 / 60)} minutes (at ~5s per URL)`
    });

    // Process in background with rate limiting
    processFullBacklog(result.rows).catch(error => {
      logger.error('Full backlog processing error', { error: error.message });
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Background processing for full backlog with rate limiting
async function processFullBacklog(entries) {
  const UnifiedScraper = require('./services/scraping/UnifiedScraper');
  const scraper = new UnifiedScraper(db);

  let processed = 0;
  let failed = 0;
  const startTime = Date.now();

  logger.info(`Starting full backlog processing: ${entries.length} URLs`);

  for (const entry of entries) {
    try {
      logger.info(`[${processed + 1}/${entries.length}] Processing: ${entry.url}`);

      await db.query(
        `UPDATE scraping_queue SET status = 'processing', processing_started_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [entry.id]
      );

      const result = await scraper.scrapeURL(entry.url, {
        category: entry.category,
        queueEntryId: entry.id,
        submittedBy: entry.submitted_by
      });

      await db.query(
        `UPDATE scraping_queue
         SET status = $1,
             processing_completed_at = CURRENT_TIMESTAMP,
             metadata = jsonb_set(
               COALESCE(metadata, '{}'::jsonb),
               '{result}',
               $2::jsonb
             )
         WHERE id = $3`,
        [
          result.success ? 'completed' : 'failed',
          JSON.stringify({
            ownersFound: result.owners.length,
            enslavedFound: result.enslavedPeople.length,
            duration: result.duration,
            errors: result.errors
          }),
          entry.id
        ]
      );

      processed++;
      logger.info(`   ✅ Complete: ${result.owners.length} owners, ${result.enslavedPeople.length} enslaved`);

      // Rate limit: wait 1 second between requests to be polite to source servers
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      failed++;
      logger.error(`   ❌ Failed: ${entry.url}`, { error: error.message });
      await db.query(
        `UPDATE scraping_queue SET status = 'failed', error_message = $1 WHERE id = $2`,
        [error.message, entry.id]
      );
    }
  }

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`BACKLOG PROCESSING COMPLETE`);
  logger.info(`   Total: ${entries.length}`);
  logger.info(`   Processed: ${processed}`);
  logger.info(`   Failed: ${failed}`);
  logger.info(`   Duration: ${duration} minutes`);
  logger.info(`${'='.repeat(60)}\n`);
}

// Background processing function - Uses UnifiedScraper
async function processQueueInBackground(entries) {
  try {
    const UnifiedScraper = require('./services/scraping/UnifiedScraper');
    const scraper = new UnifiedScraper(db);

    for (const entry of entries) {
      try {
        logger.info(`Processing queue entry: ${entry.url} (category: ${entry.category})`);

        await db.query(
          `UPDATE scraping_queue SET status = 'processing', processing_started_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [entry.id]
        );

        const startTime = Date.now();
        const result = await scraper.scrapeURL(entry.url, {
          category: entry.category,
          queueEntryId: entry.id,
          submittedBy: entry.submitted_by
        });

        // Update queue with results
        await db.query(
          `UPDATE scraping_queue
           SET status = $1,
               processing_completed_at = CURRENT_TIMESTAMP,
               metadata = jsonb_set(
                 COALESCE(metadata, '{}'::jsonb),
                 '{result}',
                 $2::jsonb
               )
           WHERE id = $3`,
          [
            result.success ? 'completed' : 'failed',
            JSON.stringify({
              ownersFound: result.owners.length,
              enslavedFound: result.enslavedPeople.length,
              duration: result.duration,
              errors: result.errors
            }),
            entry.id
          ]
        );

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        logger.info(`Completed: ${entry.url} in ${duration}s - ${result.owners.length} owners, ${result.enslavedPeople.length} enslaved`);

      } catch (error) {
        logger.error(`Failed processing: ${entry.url}`, { error: error.message });
        await db.query(
          `UPDATE scraping_queue SET status = 'failed', error_message = $1 WHERE id = $2`,
          [error.message, entry.id]
        );
      }
    }
  } catch (error) {
    logger.error('UnifiedScraper not available', { error: error.message });
  }
}

// =============================================================================
// Reparations Portal Endpoints (for portal.html)
// =============================================================================

// Search for reparations
app.post('/api/search-reparations', async (req, res) => {
  try {
    const { searchType, searchValue } = req.body;

    if (!searchType || !searchValue) {
      return res.status(400).json({ success: false, error: 'Search type and value required' });
    }

    let searchQuery;
    let queryParams;

    if (searchType === 'name') {
      searchQuery = `
        SELECT i.individual_id, i.full_name, i.birth_year, i.death_year,
               i.locations, COALESCE(SUM(r.total_reparations), 0) as total_reparations
        FROM individuals i
        LEFT JOIN reparations_breakdown r ON i.individual_id = r.individual_id
        WHERE LOWER(i.full_name) LIKE LOWER($1)
        GROUP BY i.individual_id
        ORDER BY total_reparations DESC LIMIT 50
      `;
      queryParams = [`%${searchValue}%`];
    } else if (searchType === 'year') {
      searchQuery = `
        SELECT i.individual_id, i.full_name, i.birth_year, i.death_year,
               i.locations, COALESCE(SUM(r.total_reparations), 0) as total_reparations
        FROM individuals i
        LEFT JOIN reparations_breakdown r ON i.individual_id = r.individual_id
        WHERE i.birth_year = $1
        GROUP BY i.individual_id
        ORDER BY total_reparations DESC LIMIT 50
      `;
      queryParams = [parseInt(searchValue)];
    } else if (searchType === 'id') {
      searchQuery = `
        SELECT i.individual_id, i.full_name, i.birth_year, i.death_year,
               i.locations, COALESCE(SUM(r.total_reparations), 0) as total_reparations
        FROM individuals i
        LEFT JOIN reparations_breakdown r ON i.individual_id = r.individual_id
        WHERE i.individual_id = $1
        GROUP BY i.individual_id LIMIT 1
      `;
      queryParams = [searchValue];
    } else {
      return res.status(400).json({ success: false, error: 'Invalid search type' });
    }

    const results = await db.query(searchQuery, queryParams);

    if (results.rows.length === 0) {
      return res.json({
        success: false,
        error: 'No records found for this search.'
      });
    }

    const totalReparations = results.rows.reduce((sum, p) => sum + parseFloat(p.total_reparations || 0), 0);

    const ancestors = results.rows.map(person => ({
      name: person.full_name,
      birthYear: person.birth_year,
      deathYear: person.death_year,
      location: person.locations ? person.locations[0] : null,
      reparations: parseFloat(person.total_reparations || 0),
      documents: []
    }));

    res.json({
      success: true,
      results: {
        searchedFor: searchValue,
        totalReparations,
        ancestors,
        breakdown: {
          'Total Ancestors Found': ancestors.length,
          'Documented with Primary Sources': 0,
          'Average Reparations per Ancestor': ancestors.length > 0 ? totalReparations / ancestors.length : 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get descendants for a person
app.post('/api/get-descendants', async (req, res) => {
  try {
    const { personName, personType, generations } = req.body;
    const maxGenerations = Math.min(generations || 2, 3);

    // Simplified query - just get children from relationships
    const result = await db.query(`
      SELECT i.individual_id, i.full_name, i.birth_year, i.death_year
      FROM individuals i
      JOIN relationships r ON i.individual_id = r.individual_id_2
      JOIN individuals parent ON r.individual_id_1 = parent.individual_id
      WHERE LOWER(parent.full_name) = LOWER($1)
        AND r.relationship_type = 'parent-child'
      LIMIT 50
    `, [personName]);

    const descendants = result.rows.map(row => ({
      name: row.full_name,
      birthYear: row.birth_year,
      deathYear: row.death_year,
      generation: 1,
      inheritedDebt: 0
    }));

    res.json({
      success: true,
      personName,
      personType,
      descendants,
      generationCount: descendants.length > 0 ? 1 : 0
    });
  } catch (error) {
    res.json({
      success: true,
      personName: req.body.personName,
      personType: req.body.personType,
      descendants: [],
      generationCount: 0
    });
  }
});

// =============================================================================
// Utility Endpoints
// =============================================================================

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
  res.json({
    success: true,
    message: 'CORS is working!',
    yourOrigin: req.headers.origin || 'NO ORIGIN HEADER',
    timestamp: new Date().toISOString()
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Reparations Platform API',
    version: '2.0.0',
    endpoints: {
      documents: '/api/documents',
      search: '/api/search-documents',
      upload: '/api/documents/upload',
      carousel: '/api/carousel-data',
      health: '/api/health'
    }
  });
});

// =============================================================================
// Error Handling
// =============================================================================

// 404 handler
app.use((req, res) => {
  logger.warn('404 Not Found', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip
  });

  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use(errorHandler);

// =============================================================================
// Server Startup
// =============================================================================

async function startServer() {
  try {
    // Verify database connection
    const dbHealth = await db.checkHealth();
    if (!dbHealth.healthy) {
      logger.error('Database health check failed', dbHealth);
      process.exit(1);
    }

    logger.info('Database connection verified');

    // Start listening
    const port = config.port;
    app.listen(port, () => {
      logger.info(`🚀 Reparations Platform server started`, {
        port,
        environment: config.env,
        nodeVersion: process.version
      });

      if (config.isDevelopment) {
        logger.info(`📍 Local URL: http://localhost:${port}`);
        logger.info(`📍 API Base: http://localhost:${port}/api`);
      }
    });
  } catch (error) {
    logger.error('Server startup failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  await db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server');
  await db.close();
  process.exit(0);
});

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = app;
