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
