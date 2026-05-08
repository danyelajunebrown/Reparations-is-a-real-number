/**
 * Debug Routes
 *
 * Safe read-only diagnostic endpoints. No credentials or secrets are exposed.
 * Used to verify runtime configuration on Render after env var changes.
 */

const express = require('express');
const router = express.Router();
const S3Service = require('../../services/storage/S3Service');
const config = require('../../../config');

/**
 * GET /api/debug/s3-config
 * Returns the S3 configuration as Render sees it at runtime.
 * Use this to verify that S3_REGION is set correctly after updating env vars.
 *
 * Example:
 *   curl https://reparations-platform.onrender.com/api/debug/s3-config
 */
router.get('/s3-config', async (req, res) => {
  const isEnabled = S3Service.isEnabled();

  // Wait for region self-correction to complete (if in progress)
  if (isEnabled && S3Service._regionVerifiedPromise) {
    try {
      await S3Service._regionVerifiedPromise;
    } catch (e) { /* non-fatal */ }
  }

  res.json({
    s3Enabled: isEnabled,
    configuredRegion: config.storage.s3.region,   // what the env var says
    activeRegion: S3Service.region || null,         // what the client is actually using (may differ after auto-correction)
    bucket: config.storage.s3.bucket || null,
    regionMismatch: isEnabled
      ? (config.storage.s3.region !== S3Service.region)
      : null,
    note: isEnabled
      ? 'activeRegion is what presigned URLs are signed with. If regionMismatch=true, auto-correction fired.'
      : 'S3 is not enabled (S3_ENABLED env var is not set to true)',
    // Deliberately NOT returning accessKeyId or secretAccessKey
  });
});

/**
 * GET /api/debug/s3-test/:key
 * Generate a presigned URL for a specific S3 key and return diagnostics.
 * The URL itself is returned so you can verify it in a browser.
 *
 * Example:
 *   curl "https://reparations-platform.onrender.com/api/debug/s3-test/owners%2FJames-Hopewell%2Fwill%2FJames-Hopewell-Will-1817-complete.pdf"
 */
router.get('/s3-test/:key(*)', async (req, res) => {
  const key = req.params.key;

  if (!S3Service.isEnabled()) {
    return res.status(400).json({ error: 'S3 not enabled' });
  }

  try {
    if (S3Service._regionVerifiedPromise) {
      await S3Service._regionVerifiedPromise;
    }

    const viewUrl = await S3Service.getViewUrl(key, 60); // 60s expiry for testing

    // Parse the URL to show which region was used
    let signedRegion = '?';
    try {
      signedRegion = new URL(viewUrl).hostname; // e.g. reparations-them.s3.us-east-2.amazonaws.com
    } catch (e) {}

    return res.json({
      success: true,
      key,
      activeRegion: S3Service.region,
      signedEndpoint: signedRegion,
      viewUrl,
      note: 'Paste viewUrl in browser to verify document loads. URL expires in 60 seconds.'
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      key,
      error: e.message,
      activeRegion: S3Service.region
    });
  }
});

module.exports = router;
