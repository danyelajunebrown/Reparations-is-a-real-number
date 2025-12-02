// storage-adapter.js
// Abstraction layer for file storage with automatic file type detection
// Supports: Local filesystem, AWS S3, with proper mime type detection

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const fileType = require('file-type'); // v12 API: use as function, not class

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3'); // v3 AWS SDK

class StorageAdapter {
  constructor(config = {}) {
    this.config = config || {};
    this.localRoot = (config.storage && config.storage.root) || './storage';
    this.s3Enabled = config.storage && config.storage.s3 && config.storage.s3.enabled;
    if (this.s3Enabled) {
      this.s3Bucket = config.storage.s3.bucket;
      this.s3Region = config.storage.s3.region;
      this.s3 = new S3Client({ region: this.s3Region, followRegionRedirects: true }); // credentials read from env or IAM role
    }
  }

  sanitizeFilename(name = '') {
    return String(name).replace(/[^a-z0-9_\-\.]/gi, '-').replace(/-+/g, '-');
  }

  /**
   * Detect actual file type from content (magic numbers/file signatures)
   * Returns: { ext, mime } or null if undetectable
   * Uses file-type v12 API (buffer-based)
   */
  async detectFileType(filePath) {
    try {
      // Read file buffer for detection
      const buffer = await fs.readFile(filePath);

      // file-type v12: call function directly on buffer
      const detected = await fileType(buffer);
      if (detected) {
        console.log(`✓ Detected file type: ${detected.mime} (.${detected.ext})`);
        return detected;
      }

      // Fallback: Check if it's plain text
      const sample = buffer.toString('utf8', 0, Math.min(512, buffer.length));

      // Check if it's valid UTF-8 text (no binary characters)
      const isBinaryFree = !/[\x00-\x08\x0E-\x1F]/.test(sample);
      if (isBinaryFree) {
        console.log('✓ Detected as plain text file');
        return { ext: 'txt', mime: 'text/plain' };
      }

      console.warn('⚠ Could not detect file type, using generic binary');
      return { ext: 'bin', mime: 'application/octet-stream' };
    } catch (error) {
      console.error('File type detection error:', error);
      return null;
    }
  }

  async uploadFileToLocal(uploadedFile, metadata = {}) {
    const ownerName = this.sanitizeFilename(metadata.ownerName || 'unknown');
    const docType = this.sanitizeFilename(metadata.documentType || 'unknown');
    const ownerDir = path.join(this.localRoot, 'owners', ownerName, docType);
    await fs.mkdir(ownerDir, { recursive: true });

    // CRITICAL: Detect actual file type from content
    const detectedType = await this.detectFileType(uploadedFile.path);
    const uploadedExt = path.extname(uploadedFile.originalname || uploadedFile.name || '').toLowerCase();
    const uploadedMime = uploadedFile.mimetype;

    // Determine correct extension and mime type
    let actualExt, actualMime;
    if (detectedType) {
      actualExt = '.' + detectedType.ext;
      actualMime = detectedType.mime;

      // Warn if mismatch
      if (uploadedExt && uploadedExt !== actualExt) {
        console.warn(`⚠ File type mismatch: uploaded as ${uploadedExt} but actual type is ${actualExt}`);
        console.warn(`  File: ${uploadedFile.originalname}`);
        console.warn(`  Claimed MIME: ${uploadedMime}, Actual MIME: ${actualMime}`);
      }
    } else {
      // Use uploaded type as fallback
      actualExt = uploadedExt || '.bin';
      actualMime = uploadedMime || 'application/octet-stream';
    }

    const timestamp = Date.now();
    const filename = `${ownerName}-${docType}-${timestamp}${actualExt}`;
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
      mimeType: actualMime, // Use detected mime type
      detectedType: detectedType ? `${detectedType.mime} (.${detectedType.ext})` : null,
      uploadedType: uploadedMime,
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

    // CRITICAL: Detect actual file type from content
    const detectedType = await this.detectFileType(uploadedFile.path);
    const uploadedExt = path.extname(uploadedFile.originalname || uploadedFile.name || '').toLowerCase();
    const uploadedMime = uploadedFile.mimetype;

    // Determine correct extension and mime type
    let actualExt, actualMime;
    if (detectedType) {
      actualExt = '.' + detectedType.ext;
      actualMime = detectedType.mime;

      // Warn if mismatch
      if (uploadedExt && uploadedExt !== actualExt) {
        console.warn(`⚠ S3 Upload - File type mismatch: uploaded as ${uploadedExt} but actual type is ${actualExt}`);
        console.warn(`  File: ${uploadedFile.originalname}`);
        console.warn(`  Claimed MIME: ${uploadedMime}, Actual MIME: ${actualMime}`);
      }
    } else {
      // Use uploaded type as fallback
      actualExt = uploadedExt || '.bin';
      actualMime = uploadedMime || 'application/octet-stream';
    }

    const timestamp = Date.now();
    const filename = `${ownerName}-${docType}-${timestamp}${actualExt}`;
    const key = `owners/${ownerName}/${docType}/${filename}`;

    // Use streaming for large files instead of loading into memory
    const fileStream = fsSync.createReadStream(uploadedFile.path);
    const fileStats = await fs.stat(uploadedFile.path);

    const putParams = {
      Bucket: this.s3Bucket,
      Key: key,
      Body: fileStream, // Stream instead of buffer
      ContentType: actualMime, // Use detected mime type
      ContentLength: fileStats.size,
      Metadata: {
        'original-filename': uploadedFile.originalname || uploadedFile.name,
        'detected-type': detectedType ? detectedType.mime : 'unknown',
        'uploaded-type': uploadedMime || 'unknown'
      }
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
      mimeType: actualMime, // Use detected mime type
      detectedType: detectedType ? `${detectedType.mime} (.${detectedType.ext})` : null,
      uploadedType: uploadedMime,
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
