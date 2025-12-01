/**
 * Document Routes
 *
 * Handles document upload, viewing, search, and metadata operations.
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();

const DocumentService = require('../../services/DocumentService');
const EnhancedDocumentProcessor = require('../../services/document/EnhancedDocumentProcessor');
const logger = require('../../utils/logger');
const { asyncHandler } = require('../../../middleware/error-handler');
const { authenticate, optionalAuth } = require('../../../middleware/auth');
const { validate } = require('../../../middleware/validation');
const { validateFile } = require('../../../middleware/file-validation');
const { uploadLimiter, moderateLimiter } = require('../../../middleware/rate-limit');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(), // Store file in memory for S3 upload
  limits: { fileSize: 100 * 1024 * 1024 } // Increased to 100MB
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

    try {
      // Use enhanced document processor for async upload
      const uploadJob = await EnhancedDocumentProcessor.uploadDocument(file, metadata);

      res.json({
        success: true,
        jobId: uploadJob.jobId,
        status: uploadJob.status,
        message: 'Document upload queued for processing'
      });
    } catch (error) {
      logger.error('Document upload failed', {
        error: error.message,
        filename: file.originalname
      });

      res.status(500).json({
        success: false,
        error: 'Failed to queue document upload',
        details: error.message
      });
    }
  })
);

/**
 * GET /api/documents/upload-status/:jobId
 * Check status of a document upload job
 */
router.get('/upload-status/:jobId',
  moderateLimiter,
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    try {
      const jobStatus = await EnhancedDocumentProcessor.getJobStatus(jobId);

      res.json({
        success: true,
        jobStatus
      });
    } catch (error) {
      logger.error('Failed to retrieve job status', {
        jobId,
        error: error.message
      });

      res.status(404).json({
        success: false,
        error: 'Job not found or failed',
        details: error.message
      });
    }
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
    const fs = require('fs');
    const path = require('path');

    // Set appropriate headers
    res.setHeader('Content-Type', document.mime_type || 'application/pdf');

    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${document.filename}"`);
    }

    // Try local file first (handle paths like "storage/..." or "./storage/..." or "/absolute/path")
    const localPath = filePath.startsWith('/') ? filePath : path.resolve(filePath);
    const fileExists = fs.existsSync(localPath);

    // Serve from local if file exists
    if (fileExists) {
      const fileStream = fs.createReadStream(localPath);
      fileStream.on('error', (err) => {
        logger.error('Local file stream error', { error: err.message, filePath, documentId });
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Error streaming file',
            details: err.message
          });
        }
      });
      fileStream.pipe(res);

    // Otherwise try S3 if enabled
    } else if (config.storage.s3.enabled) {
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
      // File not found locally and S3 not enabled/configured
      return res.status(404).json({
        success: false,
        error: 'Document file not found',
        path: filePath,
        checked: { local: localPath, s3Enabled: config.storage.s3.enabled }
      });
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
