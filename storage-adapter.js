// new file: storage-adapter.js
// Simple abstraction to upload files to local storage or S3.
// Add this file and require it from your EnhancedDocumentProcessor or server.

const fs = require('fs').promises;
const path = require('path');

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3'); // v3 AWS SDK

class StorageAdapter {
  constructor(config = {}) {
    this.config = config || {};
    this.localRoot = (config.storage && config.storage.root) || './storage';
    this.s3Enabled = config.storage && config.storage.s3 && config.storage.s3.enabled;
    if (this.s3Enabled) {
      this.s3Bucket = config.storage.s3.bucket;
      this.s3Region = config.storage.s3.region;
      this.s3 = new S3Client({ region: this.s3Region }); // credentials read from env or IAM role
    }
  }

  sanitizeFilename(name = '') {
    return String(name).replace(/[^a-z0-9_\-\.]/gi, '-').replace(/-+/g, '-');
  }

  async uploadFileToLocal(uploadedFile, metadata = {}) {
    const ownerName = this.sanitizeFilename(metadata.ownerName || 'unknown');
    const docType = this.sanitizeFilename(metadata.documentType || 'unknown');
    const ownerDir = path.join(this.localRoot, 'owners', ownerName, docType);
    await fs.mkdir(ownerDir, { recursive: true });

    const timestamp = Date.now();
    const ext = path.extname(uploadedFile.originalname || uploadedFile.name || '');
    const filename = `${ownerName}-${docType}-${timestamp}${ext}`;
    const destPath = path.join(ownerDir, filename);

    // copy from multer tmp path
    await fs.copyFile(uploadedFile.path, destPath);

    const stats = await fs.stat(destPath);

    return {
      provider: 'local',
      filePath: destPath,
      relativePath: path.relative(this.localRoot, destPath),
      filename,
      originalName: uploadedFile.originalname || uploadedFile.name,
      fileSize: stats.size,
      mimeType: uploadedFile.mimetype || 'application/octet-stream',
      storedAt: new Date().toISOString(),
      ownerDirectory: ownerName,
      documentType: docType
    };
  }

  async uploadFileToS3(uploadedFile, metadata = {}) {
    if (!this.s3Enabled) {
      throw new Error('S3 is not enabled in storage config');
    }

    const ownerName = this.sanitizeFilename(metadata.ownerName || 'unknown');
    const docType = this.sanitizeFilename(metadata.documentType || 'unknown');

    const timestamp = Date.now();
    const ext = path.extname(uploadedFile.originalname || uploadedFile.name || '');
    const filename = `${ownerName}-${docType}-${timestamp}${ext}`;
    const key = `owners/${ownerName}/${docType}/${filename}`;

    // FIXED: Use streaming for large files instead of loading into memory
    const fsSync = require('fs');
    const fileStream = fsSync.createReadStream(uploadedFile.path);
    const fileStats = await fs.stat(uploadedFile.path);

    const putParams = {
      Bucket: this.s3Bucket,
      Key: key,
      Body: fileStream, // Stream instead of buffer
      ContentType: uploadedFile.mimetype || 'application/octet-stream',
      ContentLength: fileStats.size
      // You can add ServerSideEncryption: 'AES256' or SSE-KMS with appropriate KMS key
    };

    await this.s3.send(new PutObjectCommand(putParams));

    // Generate object URL (non-signed). For private buckets you should generate presigned URLs.
    const url = `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${encodeURIComponent(key)}`;

    return {
      provider: 's3',
      bucket: this.s3Bucket,
      key,
      url,
      filename,
      originalName: uploadedFile.originalname || uploadedFile.name,
      fileSize: fileStats.size,
      mimeType: uploadedFile.mimetype || 'application/octet-stream',
      storedAt: new Date().toISOString(),
      ownerDirectory: ownerName,
      documentType: docType
    };
  }

  async uploadFile(uploadedFile, metadata = {}) {
    if (this.s3Enabled) {
      try {
        return await this.uploadFileToS3(uploadedFile, metadata);
      } catch (err) {
        // fall back to local storage if S3 fails
        console.error('S3 upload failed, falling back to local:', err);
        return await this.uploadFileToLocal(uploadedFile, metadata);
      }
    } else {
      return await this.uploadFileToLocal(uploadedFile, metadata);
    }
  }
}

module.exports = StorageAdapter;
