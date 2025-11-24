/**
 * Rate Limiting Middleware
 * Prevents abuse and DoS attacks
 */

const rateLimit = require('express-rate-limit');

/**
 * Limiter for document uploads and URL submissions
 * Generous limits to support bulk research contributions
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 uploads/submissions per 15 minutes per IP (supports bulk research)
  message: {
    success: false,
    error: 'Too many uploads',
    message: 'You have exceeded the upload limit. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: (req, res) => {
    console.warn(`Rate limit exceeded for upload from IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Too many uploads',
      message: 'You have exceeded the upload limit. Please try again in 15 minutes.'
    });
  }
});

/**
 * Limiter for research queries
 * Moderate limit for public queries
 */
const queryLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 queries per minute per IP
  message: {
    success: false,
    error: 'Too many requests',
    message: 'Please slow down and try again shortly.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for authenticated API keys (trusted sources)
    return req.user && req.user.type === 'api-key';
  }
});

/**
 * Strict limiter for sensitive operations
 * Payment recording, debt calculations, etc.
 * NOTE: Queue processing now uses moderate limits, not strict
 */
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 requests per 15 minutes
  message: {
    success: false,
    error: 'Rate limit exceeded',
    message: 'Too many requests for this operation. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`Strict rate limit exceeded for ${req.path} from IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'You have exceeded the rate limit for this sensitive operation.'
    });
  }
});

/**
 * Moderate limiter for queue processing operations
 * More generous than strict limiter to support bulk operations
 */
const moderateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 requests per 5 minutes
  message: {
    success: false,
    error: 'Too many requests',
    message: 'Please wait a moment before trying again.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * General API limiter
 * Applied to all API routes as baseline protection
 */
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute (generous for general use)
  message: {
    success: false,
    error: 'Too many requests',
    message: 'Please slow down and try again shortly.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Login attempt limiter
 * Prevent brute force attacks (for future authentication endpoints)
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  message: {
    success: false,
    error: 'Too many login attempts',
    message: 'Account temporarily locked. Please try again in 15 minutes.'
  },
  skipSuccessfulRequests: true, // Don't count successful logins
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  uploadLimiter,
  queryLimiter,
  strictLimiter,
  moderateLimiter,
  generalLimiter,
  loginLimiter
};
