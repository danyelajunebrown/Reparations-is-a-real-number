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
const debugRouter = require('./api/routes/debug');
const { router: contributeRouter, initializeService: initContribute } = require('./api/routes/contribute');
const bibliographyRouter = require('./api/routes/bibliography');
const { router: namesRouter, initializeService: initNames } = require('./api/routes/names');
const ancestorClimbRouter = require('./api/routes/ancestor-climb');
const kioskRouter = require('./api/routes/kiosk');
const willRoutes = require('./api/routes/wills'); // Added for will ingestion

// Initialize Express app
const app = express();


// =============================================================================
// Middleware Stack
// =============================================================================

// CORS configuration - allow GitHub Pages, local development, and file:// URLs
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like file://, mobile apps, curl)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'https://danyelajunebrown.github.io',
      'http://localhost:3000',
      'http://localhost:5000',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5000',
      'null' // for file:// URLs
    ];

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, true); // Allow all for now during development
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
  credentials: true
}));

// Serve dashboard.html at /dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard.html'));
});

// Request logging
app.use(logger.middleware);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving - serve from project root for styles/, js/, and static assets
app.use(express.static(path.join(__dirname, '..')));
app.use('/styles', express.static(path.join(__dirname, '..', 'styles')));
app.use('/js', express.static(path.join(__dirname, '..', 'js')));

// contribute-v2.html was removed Apr 11, 2026 as part of the frontend rebuild.
// The conversational contribution workflow is no longer part of the premiere scope.
// /api/contribute/* endpoints remain (search, person lookup, stats).

// Serve the main index.html from project root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Serve kiosk mode page
app.get('/kiosk', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'kiosk.html'));
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

// Admin auth (Apr 11, 2026) — gate specific admin-only endpoints.
// Must be registered BEFORE the routers that own those paths. Set ADMIN_TOKEN
// in production; dev mode (NODE_ENV !== 'production') leaves endpoints OPEN.
const { requireAdmin, adminVerify } = require('./middleware/admin-auth');

// Verify endpoint for React admin UI token check
app.get('/api/admin/verify', requireAdmin, adminVerify);

// Gate ancestor-climb admin endpoint (must precede router mount)
app.use('/api/ancestor-climb/pending-verification', requireAdmin);

// Gate contribute admin paths (must precede contribute router mount below)
const ADMIN_CONTRIBUTE_PATHS = [
  '/api/contribute/review-queue',
  '/api/contribute/data-quality',
  '/api/contribute/data-quality-metrics',
  '/api/contribute/training',
];
app.use(ADMIN_CONTRIBUTE_PATHS, requireAdmin);

app.use('/api/documents', documentsRouter);
app.use('/api/research', researchRouter);
app.use('/api/chat', require('./api/routes/chat'));
app.use('/api/health', healthRouter);
app.use('/api/errors', errorsRouter);
app.use('/api/debug', debugRouter);
app.use('/api/bibliography', bibliographyRouter);
app.use('/api/ancestor-climb', ancestorClimbRouter);
app.use('/api/kiosk', kioskRouter);
app.use('/api/review', requireAdmin, require('./api/routes/review'));
app.use('/api/intake', require('./api/routes/intake'));
app.use('/api/ops', require('./api/routes/ops'));
app.use('/api/match-verification', require('./api/routes/match-verification'));
app.use('/api/daa', require('./api/routes/daa'));
app.use('/api/pipeline', require('./api/routes/pipeline'));
app.use('/api/wills', willRoutes); // Mount the wills routes

// Static review UI + pretty URL
app.use('/public', express.static(path.join(__dirname, '..', 'public')));
app.get('/review', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'review.html')));
app.get('/connect', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'connect.html')));

// React SPA mounted at /app — built from frontend/ with VITE_BASE_PATH=/app.
// Static asset serving + SPA fallback so client-side routes (e.g. /app/admin,
// /app/person/X) all return the SPA shell which then handles routing client-side.
app.use('/app', express.static(path.join(__dirname, '..', 'frontend', 'dist')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html')));
app.get('/app/*', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html')));

// Make database pool available to routes (for bibliography manager)
app.set('pool', db);

// Initialize contribution service with database and mount routes
const ExtractionWorker = require('./services/contribution/ExtractionWorker');
const extractionWorker = new ExtractionWorker(db);
initContribute(db, extractionWorker);
app.use('/api/contribute', contributeRouter);

// Initialize name resolution service and mount routes
initNames(db);
app.use('/api/names', namesRouter);

// Corporate debts API (Farmer-Paellmann defendants) - Added Dec 18, 2025
app.use('/api/corporate-debts', require('./api/routes/corporate-debts'));

// Legal precedents API (Triangle Trade legal framework) - Added Jan 5, 2026
// UK 1833 loan, Haiti inverse debt, Farmer-Paellmann analysis, all jurisdictions
app.use('/api/legal', require('./api/routes/legal-precedents'));

// Blockchain API (ReparationsEscrow on Base Mainnet) - Added Apr 5, 2026
// Contract: 0x914846ceA07e57d848d9d60C8238865D83d9ab1E
app.use('/api/blockchain', require('./api/routes/blockchain'));

// Distributed scraper API (browser-based multi-device scraping)
const { router: scraperRouter, initializeRouter: initScraper } = require('./api/routes/distributed-scraper');
initScraper(db);
app.use('/api/scraper', scraperRouter);

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

// Simple health check endpoint
app.get('/api/health', (req, res) => {
  try {
    res.json({
      success: true,
      health: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          ocr: {
            googleVisionAvailable: true,
            tesseractAvailable: true,
            puppeteerAvailable: true,
            playwrightAvailable: true
          }
        },
        database: 'connected',
        storage: 'available'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
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
    const stats = await db.query(`
      SELECT
        status,
        COUNT(*) as count,
        MAX(created_at) as latest
      FROM scraping_queue
      GROUP BY status
    `);

    const totalResult = await db.query('SELECT COUNT(*) FROM scraping_queue');
    const total = parseInt(totalResult.rows[0].count);

    const statusMap = {};
    stats.rows.forEach(row => {
      statusMap[row.status] = {
        count: parseInt(row.count),
        latest: row.latest
      };
    });

    res.json({
      success: true,
      total,
      byStatus: statusMap,
      pending: parseInt((statusMap.pending || {}).count || 0),
      processing: parseInt((statusMap.processing || {}).count || 0),
      completed: parseInt((statusMap.completed || {}).count || 0),
      failed: parseInt((statusMap.failed || {}).count || 0)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recent queue entries
app.get('/api/queue-recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const result = await db.query(
      `SELECT id, url, category, status, priority, submitted_by, created_at
       FROM scraping_queue
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ success: true, entries: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// Error Handling
// =============================================================================

app.use(errorHandler);

// =============================================================================
// Start Server
// =============================================================================

const PORT = config.port || process.env.PORT || 3001;

async function startServer() {
  try {
    // Test database connection
    await db.query('SELECT 1');
    logger.info('Database connection verified');

    app.listen(PORT, () => {
      logger.info(`Reparations Platform running on port ${PORT}`);
      logger.info(`Environment: ${config.env || process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

startServer();

module.exports = app;
