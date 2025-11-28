/**
 * Document Routes
 *
 * Handles document upload, viewing, search, and metadata operations.
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();

const DocumentService = require('../../services/DocumentService');
const logger = require('../../utils/logger');
const { asyncHandler } = require('../../../middleware/error-handler');
const { authenticate, optionalAuth } = require('../../../middleware/auth');
const { validate } = require('../../../middleware/validation');
const { validateFile } = require('../../../middleware/file-validation');
const { uploadLimiter, moderateLimiter } = require('../../../middleware/rate-limit');

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

/**
 * POST /api/documents/upload
 * Upload and process a single document
 */
router.post('/upload',
  uploadLimiter,
  // authenticate, // DISABLED FOR TESTING - RE-ENABLE IN PRODUCTION
  upload.single('document'),
  validateFile,
  validate('uploadDocument'),
  asyncHandler(async (req, res) => {
    const { file, validatedBody: metadata } = req;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    logger.operation('Document upload started', {
      filename: file.originalname,
      owner: metadata.ownerName
    });

    // Get processor instance (from server initialization)
    const processor = req.app.get('documentProcessor');

    // Process document
    const processingResults = await processor.processDocument(file, metadata);

    // Save to database via service
    const result = await DocumentService.processDocument(file, metadata, processingResults);

    // Clean up temp file
    const fs = require('fs').promises;
    try {
      await fs.unlink(file.path);
    } catch (err) {
      logger.warn('Failed to delete temp file', { path: file.path });
    }

    res.json({
      success: true,
      documentId: result.documentId,
      message: 'Document uploaded and processed successfully',
      result: processingResults
    });
  })
);

/**
 * GET /api/documents/:documentId/file
 * Serve document file (must be before /:documentId route)
 */
router.get('/:documentId/file',
  moderateLimiter,
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const download = req.query.download === 'true';

    // Get document metadata
    const document = await DocumentService.getDocumentById(documentId);

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const filePath = document.file_path || document.relative_path;

    if (!filePath) {
      return res.status(404).json({
        success: false,
        error: 'File path not found in document metadata'
      });
    }

    const config = require('../../../config');
    const isS3Path = !filePath.startsWith('./') && !filePath.startsWith('/');

    // Set appropriate headers
    res.setHeader('Content-Type', document.mime_type || 'application/pdf');

    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${document.filename}"`);
    }

    // Serve from S3 if path is S3 key
    if (config.storage.s3.enabled && isS3Path) {
      const AWS = require('aws-sdk');
      const s3 = new AWS.S3({
        accessKeyId: config.storage.s3.accessKeyId,
        secretAccessKey: config.storage.s3.secretAccessKey,
        region: config.storage.s3.region
      });

      const params = {
        Bucket: config.storage.s3.bucket,
        Key: filePath
      };

      const stream = s3.getObject(params).createReadStream();

      stream.on('error', (err) => {
        logger.error('S3 stream error', { error: err.message, filePath, documentId });
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Error streaming file from S3',
            details: err.message
          });
        }
      });

      stream.pipe(res);

    } else {
      // Serve from local file system
      const fs = require('fs');
      const path = require('path');
      const absolutePath = path.resolve(filePath);

      if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({
          success: false,
          error: 'Document file not found on server',
          path: filePath
        });
      }

      const fileStream = fs.createReadStream(absolutePath);
      fileStream.pipe(res);
    }
  })
);

/**
 * GET /api/documents/:documentId
 * Get document by ID with all relations
 */
router.get('/:documentId',
  moderateLimiter,
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;

    const document = await DocumentService.getDocumentById(documentId);

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    res.json({
      success: true,
      document
    });
  })
);

/**
 * GET /api/documents/owner/:ownerName
 * Search documents by owner name
 */
router.get('/owner/:ownerName',
  moderateLimiter,
  asyncHandler(async (req, res) => {
    const { ownerName } = req.params;

    const documents = await DocumentService.searchByOwner(ownerName);

    res.json({
      success: true,
      count: documents.length,
      documents
    });
  })
);

/**
 * GET /api/documents/owner/:ownerName/summary
 * Get owner summary with statistics
 */
router.get('/owner/:ownerName/summary',
  moderateLimiter,
  asyncHandler(async (req, res) => {
    const { ownerName } = req.params;

    const summary = await DocumentService.getOwnerSummary(ownerName);

    if (!summary) {
      return res.status(404).json({
        success: false,
        error: 'Owner not found'
      });
    }

    res.json({
      success: true,
      summary
    });
  })
);

/**
 * POST /api/documents/search
 * Advanced document search
 */
router.post('/search',
  moderateLimiter,
  validate('searchDocuments'),
  asyncHandler(async (req, res) => {
    const filters = req.validatedBody;

    const results = await DocumentService.advancedSearch(filters);

    res.json({
      success: true,
      count: results.length,
      results
    });
  })
);

/**
 * GET /api/documents/view/:documentId
 * View/download document file
 */
router.get('/view/:documentId',
  moderateLimiter,
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;

    const document = await DocumentService.getDocumentById(documentId);

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const filePath = document.file_path || document.relative_path;

    if (!filePath) {
      return res.status(404).json({
        success: false,
        error: 'File path not found'
      });
    }

    // Check if S3 path or local path
    if (filePath.startsWith('./') || filePath.startsWith('/')) {
      // Local file
      const fs = require('fs');
      const path = require('path');
      const absolutePath = path.resolve(filePath);

      if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({
          success: false,
          error: 'File not found on server'
        });
      }

      res.sendFile(absolutePath);
    } else {
      // S3 file - stream from S3
      const config = require('../../../config');
      const AWS = require('aws-sdk');

      const s3 = new AWS.S3({
        accessKeyId: config.storage.s3.accessKeyId,
        secretAccessKey: config.storage.s3.secretAccessKey,
        region: config.storage.s3.region
      });

      const params = {
        Bucket: config.storage.s3.bucket,
        Key: filePath
      };

      const stream = s3.getObject(params).createReadStream();

      stream.on('error', (err) => {
        logger.error('S3 stream error', { error: err.message, filePath });
        res.status(500).json({
          success: false,
          error: 'Failed to retrieve file from storage'
        });
      });

      res.setHeader('Content-Type', document.mime_type || 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${document.filename}"`);

      stream.pipe(res);
    }
  })
);

/**
 * GET /api/documents/stats/global
 * Get global statistics
 */
router.get('/stats/global',
  moderateLimiter,
  asyncHandler(async (req, res) => {
    const stats = await DocumentService.getStatistics();

    res.json({
      success: true,
      stats
    });
  })
);

module.exports = router;
