/**
 * Structured Logging System
 *
 * Uses Winston for consistent, structured logging across the application.
 * Replaces console.log with proper logging levels and formats.
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../../config');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue'
};

winston.addColors(colors);

// Custom format for development (pretty, colorized)
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;

    // Add metadata if present (excluding empty objects)
    const metaKeys = Object.keys(metadata);
    if (metaKeys.length > 0 && metaKeys.some(key => key !== 'service')) {
      msg += ` ${JSON.stringify(metadata, null, 2)}`;
    }

    return msg;
  })
);

// Custom format for production (JSON, structured)
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Determine which format to use
const logFormat = config.isProduction ? prodFormat : devFormat;

// Create transports array
const transports = [];

// Console transport (always enabled)
transports.push(
  new winston.transports.Console({
    level: config.isDevelopment ? 'debug' : 'info',
    format: logFormat
  })
);

// File transports (production only)
if (config.isProduction) {
  // Error log - only errors
  transports.push(
    new DailyRotateFile({
      filename: path.join('logs', 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
      format: prodFormat
    })
  );

  // Combined log - all levels
  transports.push(
    new DailyRotateFile({
      filename: path.join('logs', 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: prodFormat
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: config.isDevelopment ? 'debug' : 'info',
  levels,
  format: logFormat,
  transports,
  exitOnError: false
});

// Add stream for Morgan HTTP logging
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

/**
 * Create a child logger with additional context
 * @param {Object} metadata - Additional metadata to include in all logs
 * @returns {winston.Logger} Child logger
 */
logger.child = (metadata) => {
  return logger.child(metadata);
};

/**
 * Log database queries (structured)
 * @param {string} query - SQL query
 * @param {number} duration - Query duration in ms
 * @param {number} rowCount - Number of rows affected/returned
 */
logger.query = (query, duration, rowCount) => {
  logger.debug('Database query executed', {
    query: query.substring(0, 100), // Truncate long queries
    duration: `${duration}ms`,
    rowCount,
    type: 'database'
  });
};

/**
 * Log API requests (structured)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} duration - Request duration in ms
 */
logger.request = (req, res, duration) => {
  logger.http('HTTP Request', {
    method: req.method,
    url: req.originalUrl || req.url,
    status: res.statusCode,
    duration: `${duration}ms`,
    userAgent: req.get('user-agent'),
    ip: req.ip,
    type: 'http'
  });
};

/**
 * Log business operations (structured)
 * @param {string} operation - Operation name
 * @param {Object} metadata - Additional metadata
 */
logger.operation = (operation, metadata = {}) => {
  logger.info(`Operation: ${operation}`, {
    ...metadata,
    type: 'operation'
  });
};

/**
 * Log security events (structured)
 * @param {string} event - Security event type
 * @param {Object} metadata - Additional metadata
 */
logger.security = (event, metadata = {}) => {
  logger.warn(`Security: ${event}`, {
    ...metadata,
    type: 'security'
  });
};

// Create logs directory if it doesn't exist (production)
if (config.isProduction) {
  const fs = require('fs');
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// Middleware to add request ID to all logs in a request context
let requestCounter = 0;

logger.middleware = (req, res, next) => {
  const requestId = `req-${Date.now()}-${++requestCounter}`;
  req.requestId = requestId;

  // Create a child logger with request ID
  req.logger = logger.child({ requestId });

  // Log the start of the request
  const start = Date.now();

  // Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.request(req, res, duration);
  });

  next();
};

// Handle uncaught exceptions
if (config.isProduction) {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
      type: 'uncaughtException'
    });
    // Give logger time to write before exiting
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', {
      reason: reason instanceof Error ? reason.message : reason,
      stack: reason instanceof Error ? reason.stack : undefined,
      type: 'unhandledRejection'
    });
  });
}

module.exports = logger;
