const fileType = require('file-type');
const logger = require('../../utils/logger');

class FileTypeDetector {
  // Allowed MIME types for document uploads
  static ALLOWED_TYPES = [
    'application/pdf',     // PDF documents
    'image/jpeg',          // JPEG images
    'image/png',           // PNG images
    'image/tiff',          // TIFF images
    'image/heic',          // HEIC images (Apple)
    'text/plain',          // Plain text files
    'application/msword',  // Microsoft Word (legacy)
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // Modern Word
  ];

  /**
   * Detect file type using magic numbers
   * @param {Buffer} buffer - File buffer
   * @returns {Promise<Object>} Detected file type
   */
  async detect(buffer) {
    try {
      // file-type v12 uses synchronous API: fileType(buffer)
      // v16+ uses async: fileType.fromBuffer(buffer)
      let detectedType;

      if (typeof fileType === 'function') {
        // Old API (v12 and below) - synchronous
        detectedType = fileType(buffer);
      } else if (fileType.fromBuffer) {
        // New API (v16+) - async
        detectedType = await fileType.fromBuffer(buffer);
      } else {
        throw new Error('Unsupported file-type package version');
      }

      // If file-type can't detect, try content-based detection
      if (!detectedType) {
        return this.fallbackDetection(buffer);
      }

      logger.info('File type detected', {
        mime: detectedType.mime,
        ext: detectedType.ext
      });

      return detectedType;
    } catch (error) {
      logger.error('File type detection failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Fallback detection for files file-type can't identify
   * @param {Buffer} buffer - File buffer
   * @returns {Object} Detected file type
   */
  fallbackDetection(buffer) {
    // Check if it's a plain text file
    const sample = buffer.toString('utf8', 0, Math.min(512, buffer.length));
    const isBinaryFree = !/[\x00-\x08\x0E-\x1F]/.test(sample);

    if (isBinaryFree) {
      return {
        mime: 'text/plain',
        ext: 'txt'
      };
    }

    // If all else fails, treat as binary
    return {
      mime: 'application/octet-stream',
      ext: 'bin'
    };
  }

  /**
   * Check if the detected file type is allowed
   * @param {Object} detectedType - Detected file type
   * @returns {boolean} Whether the file type is allowed
   */
  isAllowedType(detectedType) {
    if (!detectedType || !detectedType.mime) {
      logger.warn('Unrecognized file type');
      return false;
    }

    const isAllowed = FileTypeDetector.ALLOWED_TYPES.includes(detectedType.mime);

    if (!isAllowed) {
      logger.warn('Unsupported file type', {
        mime: detectedType.mime
      });
    }

    return isAllowed;
  }

  /**
   * Get file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} File extension
   */
  getExtensionFromMimeType(mimeType) {
    const mimeToExt = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/tiff': 'tiff',
      'image/heic': 'heic',
      'text/plain': 'txt',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
    };

    return mimeToExt[mimeType] || 'bin';
  }
}

module.exports = FileTypeDetector;
