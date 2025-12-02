const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const crypto = require('crypto');
const path = require('path');
const logger = require('../../utils/logger');
const FileTypeDetector = require('./FileTypeDetector');

class S3StorageAdapter {
  constructor() {
    const config = require('../../../config');
    
    // Configure S3 client
    this.s3Client = new S3Client({
      region: config.storage.s3.region,
      credentials: {
        accessKeyId: config.storage.s3.accessKeyId,
        secretAccessKey: config.storage.s3.secretAccessKey
      },
      followRegionRedirects: true
    });

    this.bucket = config.storage.s3.bucket;
    this.fileTypeDetector = new FileTypeDetector();
  }

  /**
   * Generate a unique file path for S3 storage
   * @param {Object} file - Uploaded file
   * @param {Object} metadata - Document metadata
   * @returns {string} Generated file path
   */
  generateFilePath(file, metadata) {
    // Create a hash of the file content for uniqueness
    const fileHash = crypto
      .createHash('sha256')
      .update(file.buffer)
      .digest('hex')
      .substring(0, 16);

    // Sanitize owner name for path
    const sanitizedOwner = metadata.ownerName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-');

    // Determine file extension
    const detectedType = this.fileTypeDetector.detect(file.buffer);
    const ext = this.fileTypeDetector.getExtensionFromMimeType(detectedType.mime);

    // Construct file path
    return path.join(
      'owners', 
      sanitizedOwner, 
      metadata.documentType || 'unknown',
      `${sanitizedOwner}-${fileHash}.${ext}`
    );
  }

  /**
   * Upload file to S3
   * @param {Object} file - Uploaded file
   * @param {Object} metadata - Document metadata
   * @returns {Promise<Object>} Upload result
   */
  async uploadFile(file, metadata) {
    try {
      // Generate unique file path
      const key = this.generateFilePath(file, metadata);

      // Prepare upload parameters
      const uploadParams = {
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          owner: metadata.ownerName,
          documentType: metadata.documentType || 'unknown'
        }
      };

      // Use multipart upload for large files
      const upload = new Upload({
        client: this.s3Client,
        params: uploadParams
      });

      // Track upload progress
      upload.on('httpUploadProgress', (progress) => {
        logger.info('S3 Upload Progress', {
          key,
          loaded: progress.loaded,
          total: progress.total
        });
      });

      // Perform upload
      const result = await upload.done();

      // Log successful upload
      logger.operation('File uploaded to S3', {
        key,
        bucket: this.bucket,
        size: file.buffer.length,
        mimetype: file.mimetype
      });

      return {
        ...file,
        s3Key: key,
        s3Bucket: this.bucket,
        uploadedAt: new Date().toISOString()
      };
    } catch (error) {
      // Detailed error logging
      logger.error('S3 Upload Failed', {
        error: error.message,
        filename: file.originalname,
        bucket: this.bucket
      });

      // Throw a more informative error
      throw new Error(`S3 Upload Failed: ${error.message}`);
    }
  }

  /**
   * Retrieve file from S3
   * @param {string} key - S3 object key
   * @returns {Promise<Buffer>} File buffer
   */
  async retrieveFile(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const response = await this.s3Client.send(command);

      // Stream to buffer
      return new Promise((resolve, reject) => {
        const chunks = [];
        response.Body.on('data', (chunk) => chunks.push(chunk));
        response.Body.on('error', reject);
        response.Body.on('end', () => {
          const buffer = Buffer.concat(chunks);
          
          logger.info('File retrieved from S3', {
            key,
            size: buffer.length
          });

          resolve(buffer);
        });
      });
    } catch (error) {
      logger.error('S3 File Retrieval Failed', {
        error: error.message,
        key,
        bucket: this.bucket
      });

      throw new Error(`S3 File Retrieval Failed: ${error.message}`);
    }
  }

  /**
   * Check if file exists in S3
   * @param {string} key - S3 object key
   * @returns {Promise<boolean>} Whether file exists
   */
  async fileExists(key) {
    try {
      await this.s3Client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      }));
      return true;
    } catch (error) {
      // If error is "Not Found", return false
      if (error.name === 'NotFound') {
        return false;
      }
      
      // Log other errors
      logger.error('S3 File Existence Check Failed', {
        error: error.message,
        key,
        bucket: this.bucket
      });

      throw error;
    }
  }
}

module.exports = S3StorageAdapter;
