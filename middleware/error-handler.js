/**
 * Error Handling Middleware
 * Sanitizes errors before sending to client
 */

/**
 * Sanitize error for client response
 * Never expose stack traces in production
 */
function sanitizeError(err, includeStack = false) {
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Default error structure
  const sanitized = {
    success: false,
    message: err.message || 'An error occurred',
    code: err.code || 'INTERNAL_ERROR'
  };

  // Only include stack in development if explicitly requested
  if (isDevelopment && includeStack) {
    sanitized.stack = err.stack;
  }

  // Include additional safe fields if present
  if (err.statusCode) {
    sanitized.statusCode = err.statusCode;
  }

  if (err.details) {
    sanitized.details = err.details;
  }

  return sanitized;
}

/**
 * Express error handling middleware
 * Should be added as the last middleware in the chain
 */
function errorHandler(err, req, res, next) {
  // Log full error server-side
  console.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Send to error tracking service if configured
  if (process.env.SENTRY_DSN) {
    // Sentry.captureException(err);
  }

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Send sanitized error to client
  res.status(statusCode).json(sanitizeError(err, false));
}

/**
 * Create a custom error with status code
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Async handler wrapper to catch errors in async route handlers
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  sanitizeError,
  errorHandler,
  AppError,
  asyncHandler
};
