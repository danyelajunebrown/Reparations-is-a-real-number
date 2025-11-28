/**
 * Centralized Configuration System
 *
 * All environment variables are validated and loaded here.
 * This ensures consistent configuration across the application
 * and fails fast if required variables are missing.
 */

require('dotenv').config();
const Joi = require('joi');

// Define the schema for environment variables
const envSchema = Joi.object({
  // Server Configuration
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number()
    .default(3000),

  // Database Configuration
  DATABASE_URL: Joi.string()
    .uri()
    .optional()
    .description('PostgreSQL connection string (Render/production)'),
  POSTGRES_HOST: Joi.string()
    .default('localhost'),
  POSTGRES_PORT: Joi.number()
    .default(5432),
  POSTGRES_DB: Joi.string()
    .default('reparations'),
  POSTGRES_USER: Joi.string()
    .optional(),
  POSTGRES_PASSWORD: Joi.string()
    .optional()
    .allow(''),
  DB_SSL_REQUIRED: Joi.boolean()
    .default(false),

  // Storage Configuration
  STORAGE_ROOT: Joi.string()
    .default('./storage'),
  S3_ENABLED: Joi.boolean()
    .default(false),
  S3_BUCKET: Joi.string()
    .when('S3_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
  S3_REGION: Joi.string()
    .default('us-east-1'),
  AWS_ACCESS_KEY_ID: Joi.string()
    .when('S3_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
  AWS_SECRET_ACCESS_KEY: Joi.string()
    .when('S3_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional()
    }),

  // IPFS Configuration
  IPFS_ENABLED: Joi.boolean()
    .default(false),
  IPFS_GATEWAY: Joi.string()
    .uri()
    .default('https://ipfs.io/ipfs/'),

  // API Keys
  GOOGLE_VISION_API_KEY: Joi.string()
    .optional()
    .description('Google Vision API for OCR (optional - falls back to Tesseract)'),
  FAMILYSEARCH_API_KEY: Joi.string()
    .optional(),
  OPENROUTER_API_KEY: Joi.string()
    .optional()
    .description('OpenRouter API for LLM features'),
  OPENROUTER_MODEL: Joi.string()
    .default('meta-llama/llama-3.2-3b-instruct:free'),

  // Security
  JWT_SECRET: Joi.string()
    .min(32)
    .default('INSECURE_DEFAULT_JWT_SECRET_PLEASE_CHANGE_IN_PRODUCTION_32CHARS')
    .description('CRITICAL: Must be 32+ characters - using insecure default if not set'),
  API_KEYS: Joi.string()
    .optional()
    .description('Comma-separated list of valid API keys'),
  ALLOWED_ORIGINS: Joi.string()
    .optional()
    .description('Comma-separated list of allowed CORS origins'),

  // Monitoring
  SENTRY_DSN: Joi.string()
    .uri()
    .optional()
    .description('Sentry error tracking DSN'),

  // API URLs (for integrations)
  API_URL: Joi.string()
    .uri()
    .optional()
    .default('http://localhost:3000')
})
  .unknown(true); // Allow other env vars to exist
  // Note: Database validation removed - will use whatever is available

// Validate environment variables
const { error, value: env } = envSchema.validate(process.env, {
  abortEarly: false, // Show all errors, not just the first
  stripUnknown: false,
  convert: true // Convert strings to numbers/booleans
});

if (error) {
  console.error('❌ Configuration validation failed:');
  error.details.forEach((detail) => {
    console.error(`   - ${detail.message}`);
  });
  process.exit(1);
}

// Export structured configuration
const config = {
  // Server
  env: env.NODE_ENV,
  port: env.PORT,
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  // Database
  database: {
    // Prefer DATABASE_URL (Render/production), fall back to individual vars
    connectionString: env.DATABASE_URL,
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    ssl: env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false } // Render PostgreSQL uses internal SSL certs
      : env.DB_SSL_REQUIRED
        ? { rejectUnauthorized: false }
        : false
  },

  // Storage
  storage: {
    root: env.STORAGE_ROOT,
    s3: {
      enabled: env.S3_ENABLED,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY
    }
  },

  // IPFS
  ipfs: {
    enabled: env.IPFS_ENABLED,
    gateway: env.IPFS_GATEWAY
  },

  // API Keys
  apiKeys: {
    googleVision: env.GOOGLE_VISION_API_KEY,
    familySearch: env.FAMILYSEARCH_API_KEY,
    openRouter: env.OPENROUTER_API_KEY,
    openRouterModel: env.OPENROUTER_MODEL,
    validApiKeys: env.API_KEYS ? env.API_KEYS.split(',').map(k => k.trim()) : []
  },

  // Security
  security: {
    jwtSecret: env.JWT_SECRET,
    allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : []
  },

  // Monitoring
  monitoring: {
    sentryDsn: env.SENTRY_DSN
  },

  // External APIs
  externalApis: {
    baseUrl: env.API_URL
  }
};

// Security warning if using default JWT_SECRET
if (config.security.jwtSecret === 'INSECURE_DEFAULT_JWT_SECRET_PLEASE_CHANGE_IN_PRODUCTION_32CHARS') {
  console.warn('⚠️  WARNING: Using default JWT_SECRET! This is INSECURE for production.');
  console.warn('⚠️  Set JWT_SECRET environment variable with a secure 32+ character string.');
  if (config.isProduction) {
    console.error('❌ CRITICAL: Default JWT_SECRET in production environment!');
  }
}

// Log configuration on startup (without secrets)
if (config.isDevelopment) {
  console.log('✅ Configuration loaded successfully');
  console.log('   Environment:', config.env);
  console.log('   Port:', config.port);
  console.log('   Database:', config.database.connectionString ? 'DATABASE_URL' : 'Individual vars');
  console.log('   S3 Storage:', config.storage.s3.enabled ? 'ENABLED' : 'DISABLED');
  console.log('   IPFS:', config.ipfs.enabled ? 'ENABLED' : 'DISABLED');
  console.log('   Google Vision API:', config.apiKeys.googleVision ? 'CONFIGURED' : 'NOT CONFIGURED (using Tesseract)');
  console.log('   OpenRouter API:', config.apiKeys.openRouter ? 'CONFIGURED' : 'NOT CONFIGURED');
}

module.exports = config;
