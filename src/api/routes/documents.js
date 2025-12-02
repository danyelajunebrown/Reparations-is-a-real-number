/**
 * Document Routes
 *
 * Handles document upload, viewing, search, and metadata operations.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const DocumentService = require('../../services/DocumentService');
const EnhancedDocumentProcessor = require('../../services/document/EnhancedDocumentProcessor');
const S3Service = require('../../services/storage/S3Service');
const ErrorLogger = require('../../services/ErrorLogger');
const logger = require('../../utils/logger');
const config = require('../../../config');
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
 * Upload and process a single document (synchronous, no Redis required)
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
      // Direct S3 upload (no Redis/Bull queue required)
      const crypto = require('crypto');
      const documentId = crypto.randomBytes(12).toString('hex');

      // Sanitize owner name for S3 key
      const sanitizedOwner = metadata.ownerName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-');

      // Determine file extension
      const ext = path.extname(file.originalname) || '.pdf';

      // Create S3 key
      const s3Key = `owners/${sanitizedOwner}/${metadata.documentType}/${sanitizedOwner}-${metadata.documentType}-${Date.now()}${ext}`;

      // Upload to S3
      if (S3Service.isEnabled()) {
        const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

        const s3Client = new S3Client({
          region: config.storage.s3.region,
          credentials: {
            accessKeyId: config.storage.s3.accessKeyId,
            secretAccessKey: config.storage.s3.secretAccessKey
          },
          followRegionRedirects: true
        });

        const uploadCommand = new PutObjectCommand({
          Bucket: config.storage.s3.bucket,
          Key: s3Key,
          Body: file.buffer,
          ContentType: file.mimetype
        });

        await s3Client.send(uploadCommand);

        logger.info('File uploaded to S3', { s3Key, bucket: config.storage.s3.bucket });

        // Save to database
        const DocumentRepository = require('../../repositories/DocumentRepository');
        await DocumentRepository.create({
          document_id: documentId,
          owner_name: metadata.ownerName,
          doc_type: metadata.documentType,
          filename: file.originalname,
          file_path: s3Key,
          file_size: file.size,
          mime_type: file.mimetype,
          stored_at: new Date().toISOString(),
          uploaded_by: 'web-upload',
          verification_status: 'pending',
          needs_human_review: true,
          // Required columns with default values (will be updated after OCR processing)
          total_enslaved: 0,
          total_reparations: 0,
          // Optional metadata from form
          owner_location: metadata.location || null,
          owner_birth_year: metadata.birthYear || null,
          owner_death_year: metadata.deathYear || null
        });

        res.json({
          success: true,
          documentId: documentId,
          s3Key: s3Key,
          message: 'Document uploaded successfully to S3',
          result: {
            documentId: documentId,
            filename: file.originalname,
            storageType: 's3'
          }
        });

      } else {
        // Fallback to local storage
        const localDir = path.join(config.storage.root, 'owners', sanitizedOwner, metadata.documentType);
        const localPath = path.join(localDir, `${sanitizedOwner}-${metadata.documentType}-${Date.now()}${ext}`);

        // Create directory
        const fsPromises = require('fs').promises;
        await fsPromises.mkdir(localDir, { recursive: true });
        await fsPromises.writeFile(localPath, file.buffer);

        logger.info('File saved locally', { localPath });

        // Save to database
        const DocumentRepository = require('../../repositories/DocumentRepository');
        await DocumentRepository.create({
          document_id: documentId,
          owner_name: metadata.ownerName,
          doc_type: metadata.documentType,
          filename: file.originalname,
          file_path: localPath,
          file_size: file.size,
          mime_type: file.mimetype,
          stored_at: new Date().toISOString(),
          uploaded_by: 'web-upload',
          verification_status: 'pending',
          needs_human_review: true,
          // Required columns with default values
          total_enslaved: 0,
          total_reparations: 0,
          // Optional metadata from form
          owner_location: metadata.location || null,
          owner_birth_year: metadata.birthYear || null,
          owner_death_year: metadata.deathYear || null
        });

        res.json({
          success: true,
          documentId: documentId,
          message: 'Document uploaded successfully (local storage)',
          result: {
            documentId: documentId,
            filename: file.originalname,
            storageType: 'local'
          }
        });
      }

    } catch (error) {
      logger.error('Document upload failed', {
        error: error.message,
        stack: error.stack,
        filename: file.originalname
      });

      await ErrorLogger.logDocumentError({
        type: 'UPLOAD_FAILED',
        message: error.message,
        filename: file.originalname,
        ownerName: metadata.ownerName
      });

      res.status(500).json({
        success: false,
        error: 'Failed to upload document',
        details: error.message,
        debug: {
          configuredRegion: config.storage.s3.region,
          bucket: config.storage.s3.bucket,
          s3Enabled: config.storage.s3.enabled
        }
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
 * GET /api/documents/:documentId/access
 * Get presigned URLs for viewing/downloading a document
 * This is the NEW preferred endpoint - returns URLs instead of streaming
 */
router.get('/:documentId/access',
  moderateLimiter,
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const expiresIn = parseInt(req.query.expiresIn) || 900; // Default 15 minutes

    // Get document metadata
    const document = await DocumentService.getDocumentById(documentId);

    if (!document) {
      await ErrorLogger.logDocumentError({
        type: 'DOCUMENT_NOT_FOUND',
        documentId,
        message: 'Document ID not found in database'
      });

      return res.status(404).json({
        success: false,
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Document not found in database',
        documentId
      });
    }

    const filePath = document.file_path || document.relative_path || document.s3_key;

    if (!filePath) {
      await ErrorLogger.logDocumentError({
        type: 'NO_FILE_PATH',
        documentId,
        message: 'Document has no file path stored'
      });

      return res.status(404).json({
        success: false,
        error: 'NO_FILE_PATH',
        message: 'Document metadata has no file path',
        documentId
      });
    }

    // Determine storage type
    const isS3Path = S3Service.constructor.looksLikeS3Key(filePath);
    const localPath = filePath.startsWith('/') ? filePath : path.resolve(filePath);
    const localExists = fs.existsSync(localPath);

    // CASE 1: File exists locally - serve via stream endpoint
    if (localExists) {
      logger.info('Document access: serving from local storage', { documentId, filePath });

      return res.json({
        success: true,
        documentId,
        storageType: 'local',
        viewUrl: `/api/documents/${documentId}/stream`,
        downloadUrl: `/api/documents/${documentId}/stream?download=true`,
        expiresIn: null,
        expiresAt: null,
        metadata: {
          filename: document.filename,
          mimeType: document.mime_type,
          fileSize: document.file_size,
          ownerName: document.owner_name,
          docType: document.doc_type
        }
      });
    }

    // CASE 2: Try S3 if enabled
    if (S3Service.isEnabled()) {
      // Try the path as-is first, then try normalized version
      const s3Key = S3Service.constructor.normalizeS3Key(filePath);
      const checkResult = await S3Service.objectExists(s3Key);

      if (checkResult.exists) {
        logger.info('Document access: generating S3 presigned URLs', { documentId, s3Key });

        try {
          const viewUrl = await S3Service.getViewUrl(s3Key, expiresIn, document.filename);
          const downloadUrl = await S3Service.getDownloadUrl(s3Key, expiresIn, document.filename);

          return res.json({
            success: true,
            documentId,
            storageType: 's3',
            viewUrl,
            downloadUrl,
            expiresIn,
            expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
            metadata: {
              filename: document.filename,
              mimeType: document.mime_type || checkResult.metadata?.contentType,
              fileSize: document.file_size || checkResult.metadata?.contentLength,
              ownerName: document.owner_name,
              docType: document.doc_type
            }
          });
        } catch (urlError) {
          await ErrorLogger.logDocumentError({
            type: 'S3_URL_GENERATION_FAILED',
            documentId,
            s3Key,
            message: urlError.message
          });

          return res.status(500).json({
            success: false,
            error: 'S3_URL_GENERATION_FAILED',
            message: 'Failed to generate access URL',
            documentId
          });
        }
      }

      // S3 object not found
      await ErrorLogger.logDocumentError({
        type: 'S3_OBJECT_NOT_FOUND',
        documentId,
        s3Key,
        bucket: config.storage.s3.bucket,
        message: 'File not found in S3 bucket'
      });

      return res.status(404).json({
        success: false,
        error: 'FILE_NOT_FOUND',
        message: 'Document file not found in storage',
        documentId,
        debugInfo: {
          storageType: 's3',
          s3Key,
          bucket: config.storage.s3.bucket,
          localPathChecked: localPath,
          localExists: false
        }
      });
    }

    // CASE 3: File not found anywhere
    await ErrorLogger.logDocumentError({
      type: 'FILE_NOT_FOUND',
      documentId,
      filePath,
      message: 'File not found locally and S3 not enabled'
    });

    return res.status(404).json({
      success: false,
      error: 'FILE_NOT_FOUND',
      message: 'Document file not found',
      documentId,
      debugInfo: {
        filePath,
        localPathChecked: localPath,
        s3Enabled: S3Service.isEnabled()
      }
    });
  })
);

/**
 * GET /api/documents/:documentId/stream
 * Stream local files only - for use with /access endpoint
 */
router.get('/:documentId/stream',
  moderateLimiter,
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const download = req.query.download === 'true';

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
        error: 'No file path'
      });
    }

    const localPath = filePath.startsWith('/') ? filePath : path.resolve(filePath);

    if (!fs.existsSync(localPath)) {
      await ErrorLogger.logDocumentError({
        type: 'LOCAL_FILE_NOT_FOUND',
        documentId,
        filePath: localPath
      });

      return res.status(404).json({
        success: false,
        error: 'File not found on server'
      });
    }

    res.setHeader('Content-Type', document.mime_type || 'application/pdf');
    res.setHeader('Content-Disposition',
      download
        ? `attachment; filename="${document.filename}"`
        : `inline; filename="${document.filename}"`
    );

    const fileStream = fs.createReadStream(localPath);
    fileStream.on('error', (err) => {
      logger.error('Local file stream error', { error: err.message, localPath, documentId });
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Stream error' });
      }
    });
    fileStream.pipe(res);
  })
);

/**
 * GET /api/documents/:documentId/file
 * LEGACY endpoint - redirects to presigned URL or streams file
 * Kept for backwards compatibility
 */
router.get('/:documentId/file',
  moderateLimiter,
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const download = req.query.download === 'true';

    // Get document metadata
    const document = await DocumentService.getDocumentById(documentId);

    if (!document) {
      await ErrorLogger.logDocumentError({
        type: 'DOCUMENT_NOT_FOUND',
        documentId,
        message: 'Legacy /file endpoint - document not found'
      });

      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const filePath = document.file_path || document.relative_path;

    if (!filePath) {
      await ErrorLogger.logDocumentError({
        type: 'NO_FILE_PATH',
        documentId,
        message: 'Legacy /file endpoint - no file path'
      });

      return res.status(404).json({
        success: false,
        error: 'File path not found in document metadata'
      });
    }

    // Try local file first
    const localPath = filePath.startsWith('/') ? filePath : path.resolve(filePath);

    if (fs.existsSync(localPath)) {
      res.setHeader('Content-Type', document.mime_type || 'application/pdf');
      res.setHeader('Content-Disposition',
        download
          ? `attachment; filename="${document.filename}"`
          : `inline; filename="${document.filename}"`
      );

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
      return fileStream.pipe(res);
    }

    // Try S3 with presigned URL redirect
    if (S3Service.isEnabled()) {
      const s3Key = S3Service.constructor.normalizeS3Key(filePath);
      const checkResult = await S3Service.objectExists(s3Key);

      if (checkResult.exists) {
        try {
          // Generate presigned URL and redirect
          const url = download
            ? await S3Service.getDownloadUrl(s3Key, 900, document.filename)
            : await S3Service.getViewUrl(s3Key, 900, document.filename);

          logger.info('Legacy /file endpoint: redirecting to S3 presigned URL', { documentId, s3Key });
          return res.redirect(302, url);
        } catch (urlError) {
          await ErrorLogger.logDocumentError({
            type: 'S3_URL_GENERATION_FAILED',
            documentId,
            s3Key,
            message: urlError.message
          });

          return res.status(500).json({
            success: false,
            error: 'Failed to generate access URL',
            details: urlError.message
          });
        }
      }

      // S3 object not found
      await ErrorLogger.logDocumentError({
        type: 'S3_OBJECT_NOT_FOUND',
        documentId,
        s3Key,
        bucket: config.storage.s3.bucket
      });

      return res.status(404).json({
        success: false,
        error: 'FILE_NOT_FOUND',
        message: 'Document file not found in storage',
        documentId,
        debugInfo: {
          s3Key,
          bucket: config.storage.s3.bucket,
          localChecked: localPath
        }
      });
    }

    // File not found anywhere
    await ErrorLogger.logDocumentError({
      type: 'FILE_NOT_FOUND',
      documentId,
      filePath,
      message: 'Legacy /file - not found locally, S3 disabled'
    });

    return res.status(404).json({
      success: false,
      error: 'Document file not found',
      path: filePath,
      checked: { local: localPath, s3Enabled: config.storage.s3.enabled }
    });
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
