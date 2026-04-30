// Load environment from .env file
require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'reparations-server',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      // Use dotenv-loaded environment variables
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        DATABASE_URL: process.env.DATABASE_URL,
        S3_ENABLED: process.env.S3_ENABLED,
        S3_BUCKET: process.env.S3_BUCKET,
        S3_REGION: process.env.S3_REGION,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY,
        PORT: process.env.PORT || 3000,
        JWT_SECRET: process.env.JWT_SECRET,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
      },
      env_production: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL,
        S3_ENABLED: process.env.S3_ENABLED,
        S3_BUCKET: process.env.S3_BUCKET,
        S3_REGION: process.env.S3_REGION,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_file: 'logs/pm2-combined.log',
      time: true
    },
    {
      name: 'freedmens-runner',
      script: 'scripts/run-freedmens-full-11.sh',
      interpreter: 'bash',
      instances: 1,
      autorestart: false,  // finite job; don't loop it
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        DATABASE_URL: process.env.DATABASE_URL,
        S3_ENABLED: process.env.S3_ENABLED,
        S3_BUCKET: process.env.S3_BUCKET,
        S3_REGION: process.env.S3_REGION,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY,
        // Document AI extraction. PM2's `env: {...}` is exhaustive: vars
        // not listed get stripped from the spawned process. Keeping this
        // block ensures USE_DOCUMENT_AI propagates when the operator
        // explicitly sets it.
        //
        // Default 'true' — the project is built around the Custom
        // Extractor and Vision is not an acceptable substitute (Vision
        // produces garbage fields like master="Cave & Bla, very small"
        // that contaminate the enslaver-attribution pipeline). When the
        // Custom Extractor is having issues, the runner now hard-stops
        // after 5 consecutive Doc AI failures rather than silently
        // continuing on Vision (filed in extract-freedmens-fields.js
        // and run-freedmens-systematic.js, 2026-04-30).
        USE_DOCUMENT_AI: process.env.USE_DOCUMENT_AI || 'true',
        DOCUMENT_AI_PROCESSOR_PATH: process.env.DOCUMENT_AI_PROCESSOR_PATH,
        GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      },
      error_file: 'logs/pm2-freedmens-err.log',
      out_file:   'logs/pm2-freedmens-out.log',
      time: true,
    }
  ]
};
