/**
 * S3 Service - Unified AWS S3 Operations
 *
 * Uses AWS SDK v3 exclusively for consistent behavior.
 * Provides presigned URL generation for secure document access.
 */

const https = require('https');
const { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand, GetBucketLocationCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const config = require('../../../config');
const logger = require('../../utils/logger');

// Map a file extension to a content type. Used so presigned VIEW URLs can force
// the correct Content-Type via ResponseContentType — desktop browsers sniff
// bytes and render regardless, but mobile Safari trusts the served Content-Type
// and the filename extension, so a missing/octet-stream type renders nothing.
const EXT_CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf',
};
function extOf(key) {
  const m = (key || '').split('?')[0].toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : null;
}
function contentTypeForKey(key) {
  const e = extOf(key);
  return e ? EXT_CONTENT_TYPES[e] : undefined;
}

class S3Service {
  constructor() {
    if (!config.storage.s3.enabled) {
      this.client = null;
      this.bucket = null;
      return;
    }

    this.bucket = config.storage.s3.bucket;
    this.region = config.storage.s3.region;

    this.client = this._makeClient(this.region);

    // Auto-detect and self-correct region mismatch at startup.
    // This guards against Render env vars having the wrong S3_REGION
    // (e.g. us-east-1 when bucket is in us-east-2), which causes presigned
    // URLs to be signed for the wrong endpoint and return HTTP 301.
    this._regionVerifiedPromise = this._verifyAndCorrectRegion();
  }

  _makeClient(region) {
    return new S3Client({
      region,
      credentials: {
        accessKeyId: config.storage.s3.accessKeyId,
        secretAccessKey: config.storage.s3.secretAccessKey
      },
      followRegionRedirects: true,
      // AWS SDK v3 (≥3.750) automatically appends x-amz-checksum-mode=ENABLED
      // to GetObject presigned URLs, which causes HTTP 403 for objects that
      // were uploaded without a checksum (the vast majority of our S3 objects).
      // Setting these to 'when_required' disables the automatic injection.
      requestChecksumCalculation: 'when_required',
      responseChecksumValidation: 'when_required',
    });
  }

  /**
   * Verify the configured region matches the bucket's actual region.
   * If not, recreate the client with the correct region.
   * Called once at startup; awaited before any presigned URL generation.
   *
   * Two-method approach:
   *   1. GetBucketLocation via SDK (requires s3:GetBucketLocation IAM perm)
   *   2. Unauthenticated redirect probe — S3 returns PermanentRedirect with the
   *      correct endpoint in the XML body. No credentials needed.
   */
  async _verifyAndCorrectRegion() {
    if (!this.client) return;

    // ── Method 1: SDK GetBucketLocation ──────────────────────────────────────
    try {
      const cmd = new GetBucketLocationCommand({ Bucket: this.bucket });
      const result = await this.client.send(cmd);
      // AWS returns null/empty for us-east-1 (legacy default region)
      const actualRegion = result.LocationConstraint || 'us-east-1';
      if (actualRegion !== this.region) {
        logger.warn(
          `S3 region mismatch (GetBucketLocation): configured="${this.region}", actual="${actualRegion}". ` +
          `Recreating client. Fix: set S3_REGION=${actualRegion} in Render env vars.`
        );
        this.region = actualRegion;
        this.client = this._makeClient(actualRegion);
      } else {
        logger.info(`S3 region verified via GetBucketLocation: ${this.region} ✓`);
      }
      return;
    } catch (e) {
      logger.warn(
        `GetBucketLocation failed (likely missing IAM permission s3:GetBucketLocation): ${e.message}. ` +
        `Falling back to redirect probe.`
      );
    }

    // ── Method 2: Unauthenticated redirect probe ──────────────────────────────
    // S3 returns HTTP 301 + PermanentRedirect XML (including the correct
    // <Endpoint>) for ANY request to the wrong regional endpoint — no auth needed.
    try {
      const probeRegion = await this._probeRegionViaRedirect();
      if (probeRegion && probeRegion !== this.region) {
        logger.warn(
          `S3 region mismatch (redirect probe): configured="${this.region}", actual="${probeRegion}". ` +
          `Recreating client. Fix: set S3_REGION=${probeRegion} in Render env vars.`
        );
        this.region = probeRegion;
        this.client = this._makeClient(probeRegion);
      } else if (probeRegion) {
        logger.info(`S3 region verified via redirect probe: ${this.region} ✓`);
      }
    } catch (e) {
      logger.warn(`S3 region redirect probe failed (non-fatal): ${e.message}`);
    }
  }

  /**
   * Make an unauthenticated GET to the bucket root.
   * If the configured region is wrong, S3 responds HTTP 301 with:
   *   <Code>PermanentRedirect</Code>
   *   <Endpoint>bucket.s3.CORRECT-REGION.amazonaws.com</Endpoint>
   *
   * We parse that endpoint to extract the actual region.
   * Returns the detected region string, or null if it cannot be determined.
   * Does NOT require any AWS credentials or IAM permissions.
   */
  _probeRegionViaRedirect() {
    return new Promise((resolve, reject) => {
      const probeUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/`;
      const req = https.get(probeUrl, { timeout: 8000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => { if (body.length < 4096) body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 301 || res.statusCode === 307) {
            // Parse <Endpoint> from AWS XML error body
            // e.g. <Endpoint>reparations-them.s3.us-east-2.amazonaws.com</Endpoint>
            const match = body.match(/<Endpoint>([^<]+)<\/Endpoint>/);
            if (match) {
              // extract region from "bucket.s3.REGION.amazonaws.com"
              const regionMatch = match[1].match(/\.s3[.-]([a-z]{2}-[a-z]+-\d+)\.amazonaws\.com/);
              if (regionMatch) {
                resolve(regionMatch[1]);
                return;
              }
            }
            // Redirect but couldn't parse region — try Location header
            if (res.headers.location) {
              const locMatch = res.headers.location.match(/\.s3[.-]([a-z]{2}-[a-z]+-\d+)\.amazonaws\.com/);
              if (locMatch) { resolve(locMatch[1]); return; }
            }
          }
          // HTTP 403 = correct region (access denied, bucket exists at this endpoint)
          // HTTP 200 = correct region (bucket listing, unlikely for private bucket)
          resolve(this.region);
        });
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('region probe timeout after 8s')); });
      req.setTimeout(8000);
    });
  }

  /**
   * Check if S3 is enabled and configured
   */
  isEnabled() {
    return this.client !== null && this.bucket !== null;
  }

  /**
   * Generate a presigned URL for viewing (inline) a document
   * @param {string} key - S3 object key
   * @param {number} expiresIn - URL expiration in seconds (default 15 minutes)
   * @param {string} filename - Optional filename for Content-Disposition
   * @returns {Promise<string>} Presigned URL
   */
  async getViewUrl(key, expiresIn = 900, filename = null) {
    if (!this.isEnabled()) {
      throw new Error('S3 is not enabled');
    }

    // Ensure region is correct before signing (no-op if already verified)
    await this._regionVerifiedPromise;

    // Force the correct Content-Type from the key's extension (the stored S3
    // object metadata is frequently NULL/octet-stream — fine for desktop which
    // sniffs, but mobile Safari renders nothing without a real image type).
    const contentType = contentTypeForKey(key);
    // Ensure the inline filename carries the right extension. The caller often
    // passes a person's name (e.g. "Egbert Thompson") with no extension; without
    // one, Safari opening the URL directly has no type hint.
    const ext = extOf(key);
    let dispName = filename || path.basename(key);
    if (ext && !new RegExp(`\\.${ext}$`, 'i').test(dispName)) dispName += `.${ext}`;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `inline; filename="${dispName}"`,
      ...(contentType ? { ResponseContentType: contentType } : {})
    });

    try {
      const url = await getSignedUrl(this.client, command, { expiresIn });
      logger.info('S3 presigned view URL generated', { key, expiresIn, contentType });
      return url;
    } catch (error) {
      logger.error('Failed to generate S3 presigned URL', {
        key,
        bucket: this.bucket,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate a presigned URL for downloading a document
   * @param {string} key - S3 object key
   * @param {number} expiresIn - URL expiration in seconds (default 15 minutes)
   * @param {string} filename - Filename for Content-Disposition
   * @returns {Promise<string>} Presigned URL
   */
  async getDownloadUrl(key, expiresIn = 900, filename = null) {
    if (!this.isEnabled()) {
      throw new Error('S3 is not enabled');
    }

    // Ensure region is correct before signing (no-op if already verified)
    await this._regionVerifiedPromise;

    const downloadFilename = filename || path.basename(key);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${downloadFilename}"`
    });

    try {
      const url = await getSignedUrl(this.client, command, { expiresIn });
      logger.info('S3 presigned download URL generated', { key, expiresIn, filename: downloadFilename });
      return url;
    } catch (error) {
      logger.error('Failed to generate S3 download URL', {
        key,
        bucket: this.bucket,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if an object exists in S3
   * @param {string} key - S3 object key
   * @returns {Promise<{exists: boolean, metadata: Object|null}>}
   */
  async objectExists(key) {
    if (!this.isEnabled()) {
      return { exists: false, metadata: null, error: 'S3 not enabled' };
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const response = await this.client.send(command);

      return {
        exists: true,
        metadata: {
          contentType: response.ContentType,
          contentLength: response.ContentLength,
          lastModified: response.LastModified,
          eTag: response.ETag
        }
      };
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return { exists: false, metadata: null };
      }

      logger.error('S3 object existence check failed', {
        key,
        bucket: this.bucket,
        error: error.message,
        errorName: error.name
      });

      return {
        exists: false,
        metadata: null,
        error: error.message
      };
    }
  }

  /**
   * Get object metadata without downloading the file
   * @param {string} key - S3 object key
   * @returns {Promise<Object>}
   */
  async getMetadata(key) {
    const result = await this.objectExists(key);
    if (!result.exists) {
      throw new Error(`Object not found: ${key}`);
    }
    return result.metadata;
  }

  /**
   * Upload a buffer or stream to S3
   * @param {string} key - S3 object key
   * @param {Buffer|ReadableStream} body - File content
   * @param {string} contentType - MIME type (e.g. 'image/jpeg')
   * @param {Object} metadata - Optional metadata key-value pairs
   * @returns {Promise<{key: string, url: string}>}
   */
  async upload(key, body, contentType = 'application/octet-stream', metadata = {}) {
    if (!this.isEnabled()) {
      throw new Error('S3 is not enabled');
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata
    });

    try {
      await this.client.send(command);
      const url = this.getPublicUrl(key);
      return { key, url };
    } catch (error) {
      logger.error('S3 upload failed', { key, bucket: this.bucket, error: error.message });
      throw error;
    }
  }

  /**
   * Construct the public URL for an S3 object (for reference, not for access)
   * Note: This URL only works if the bucket/object is public
   * @param {string} key - S3 object key
   * @returns {string} Public URL
   */
  getPublicUrl(key) {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodeURIComponent(key)}`;
  }

  /**
   * Determine if a file path looks like an S3 key vs local path
   * @param {string} filePath - The file path to check
   * @returns {boolean} True if it looks like an S3 key
   */
  static looksLikeS3Key(filePath) {
    if (!filePath) return false;

    // S3 keys don't start with / or ./
    if (filePath.startsWith('/') || filePath.startsWith('./')) {
      return false;
    }

    // S3 keys typically have the structure: prefix/folder/file
    // Our S3 keys look like: owners/owner-name/doc-type/filename.ext
    if (filePath.startsWith('owners/') || filePath.startsWith('storage/owners/')) {
      return true;
    }

    // Check if it has at least one slash (folder structure)
    return filePath.includes('/') && !filePath.includes('\\');
  }

  /**
   * Normalize an S3 key (remove leading 'storage/' if present)
   * @param {string} key - The S3 key to normalize
   * @returns {string} Normalized key
   */
  static normalizeS3Key(key) {
    if (!key) return key;

    // Remove leading 'storage/' if present (legacy path format)
    if (key.startsWith('storage/')) {
      return key.substring(8);
    }

    return key;
  }
}

// Export singleton instance
module.exports = new S3Service();
