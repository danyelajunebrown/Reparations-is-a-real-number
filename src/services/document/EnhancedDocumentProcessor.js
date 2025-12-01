const { Queue } = require('bull');
const logger = require('../../utils/logger');
const DocumentService = require('../DocumentService');
const FileTypeDetector = require('./FileTypeDetector');
const S3StorageAdapter = require('./S3StorageAdapter');
const OCRProcessor = require('./OCRProcessor');
const { validateDocumentMetadata } = require('../../middleware/validation');

class EnhancedDocumentProcessor {
  constructor() {
    // Configure job queues
    this.uploadQueue = new Queue('document-upload');
    this.ocrQueue = new Queue('document-ocr');
    
    // Configure storage and processing adapters
    this.storageAdapter = new S3StorageAdapter();
    this.fileTypeDetector = new FileTypeDetector();
    this.ocrProcessor = new OCRProcessor();

    // Set up queue processing
    this.setupQueues();
  }

  setupQueues() {
    // Upload queue: Validate and store files
    this.uploadQueue.process(async (job) => {
      const { file, metadata } = job.data;
      
      try {
        // Validate file type
        const detectedType = await this.fileTypeDetector.detect(file.buffer);
        if (!this.fileTypeDetector.isAllowedType(detectedType)) {
          throw new Error(`Unsupported file type: ${detectedType.mime}`);
        }

        // Validate metadata
        const validatedMetadata = await validateDocumentMetadata(metadata);

        // Upload to S3
        const storageResult = await this.storageAdapter.uploadFile(file, validatedMetadata);

        // Enqueue for OCR processing
        await this.ocrQueue.add({
          file: storageResult,
          metadata: validatedMetadata
        });

        return storageResult;
      } catch (error) {
        logger.error('Document upload failed', {
          error: error.message,
          filename: file.originalname,
          metadata
        });
        throw error;
      }
    });

    // OCR queue: Process documents asynchronously
    this.ocrQueue.process(async (job) => {
      const { file, metadata } = job.data;
      
      try {
        // Perform OCR
        const ocrResults = await this.ocrProcessor.process(file);

        // Process document with full metadata
        const processingResults = await DocumentService.processDocument(
          file, 
          metadata, 
          { 
            storage: file, 
            ocr: ocrResults 
          }
        );

        // Log successful processing
        logger.operation('Document processed successfully', {
          documentId: processingResults.documentId,
          ocrConfidence: ocrResults.confidence
        });

        return processingResults;
      } catch (error) {
        logger.error('Document OCR processing failed', {
          error: error.message,
          filename: file.originalname,
          metadata
        });
        throw error;
      }
    });

    // Error handling for queues
    [this.uploadQueue, this.ocrQueue].forEach(queue => {
      queue.on('failed', (job, err) => {
        logger.error('Job failed', {
          type: queue.name,
          jobId: job.id,
          error: err.message
        });
      });
    });
  }

  /**
   * Initiate document upload process
   * @param {Object} file - Uploaded file
   * @param {Object} metadata - Document metadata
   * @returns {Promise<Object>} Upload job details
   */
  async uploadDocument(file, metadata) {
    try {
      const job = await this.uploadQueue.add({ file, metadata });
      return {
        jobId: job.id,
        status: 'queued'
      };
    } catch (error) {
      logger.error('Failed to queue document upload', {
        error: error.message,
        filename: file.originalname
      });
      throw error;
    }
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} Job status
   */
  async getJobStatus(jobId) {
    const job = await this.uploadQueue.getJob(jobId);
    
    if (!job) {
      throw new Error('Job not found');
    }

    return {
      id: job.id,
      state: job.state,
      progress: job.progress(),
      result: job.returnvalue,
      error: job.failedReason
    };
  }
}

module.exports = new EnhancedDocumentProcessor();
