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
        // DEFAULT IS NOW 'false' (2026-04-30): the deployed Custom Extractor
        // version `b249cf11f364e209` is currently broken — it rejects all
        // images including its own training set with INVALID_ARGUMENT,
        // cause unknown without GCP audit logs (Data Access logging not
        // yet enabled for Document AI). Foundation model is a quality
        // regression for our use case (it doesn't extract last_master /
        // last_mistress / plantation, which are the load-bearing fields
        // for enslaver attribution). Vision spatial parser produces
        // those fields (noisily). When the Custom Extractor is fixed,
        // flip this back to 'true' and re-run the affected branches.
        USE_DOCUMENT_AI: process.env.USE_DOCUMENT_AI || 'false',
        DOCUMENT_AI_PROCESSOR_PATH: process.env.DOCUMENT_AI_PROCESSOR_PATH,
        GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      },
      error_file: 'logs/pm2-freedmens-err.log',
      out_file:   'logs/pm2-freedmens-out.log',
      time: true,
    }
  ]
};
