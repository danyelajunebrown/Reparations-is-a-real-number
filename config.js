// Example config.js — update or merge into your existing config
// Make sure to set sensitive values (AWS keys) via environment variables in production.

module.exports = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'reparations',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASS || ''
  },

  storage: {
    // Local storage root used as fallback or for dev
    root: process.env.STORAGE_ROOT || './storage',

    // S3 configuration (optional). If enabled, uploaded files will be copied to S3.
    s3: {
      enabled: process.env.S3_ENABLED === 'true' || false,
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || 'us-east-1',
      // Credentials via env AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY recommended
      // Optionally use AWS_PROFILE on dev machines
    }
  },

  ipfs: {
    enabled: process.env.IPFS_ENABLED === 'true' || false,
    gateway: process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/'
  },

  googleVisionApiKey: process.env.GOOGLE_VISION_API_KEY || ''
};
