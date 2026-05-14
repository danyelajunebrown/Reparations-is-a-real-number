const rateLimit = require('express-rate-limit');

// General rate limiter.
// Stats endpoint is excluded here so it gets its own generous statsLimiter
// (registered separately) without being double-counted against this budget.
// req.path is relative to the mount point (/api), so the stats path is /contribute/stats.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/contribute/stats'
});

// Stats rate limiter - very permissive because the backend already caches
// results for 5 minutes. This endpoint is public (no auth) and is hit on
// every page load, so it needs a high cap. 500 req/15 min allows ~2 req/sec
// sustained across all users sharing a Render reverse-proxy IP.
const statsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: 'Too many stats requests, please try again shortly.',
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true // don't count failed requests against the limit
});

// Upload rate limiter - more restrictive
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 uploads per windowMs
  message: 'Too many uploads from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// Query rate limiter
const queryLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 queries per minute
  message: 'Too many queries from this IP, please slow down.',
  standardHeaders: true,
  legacyHeaders: false
});

// Moderate rate limiter
const moderateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  generalLimiter,
  statsLimiter,
  uploadLimiter,
  queryLimiter,
  moderateLimiter
};
