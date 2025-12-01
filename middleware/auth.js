/**
 * Authentication Middleware
 * Supports both JWT tokens and API keys
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION_USE_RANDOM_STRING';
const API_KEYS = new Set((process.env.API_KEYS || '').split(',').filter(k => k.trim()));

// Warn if using default secret in production
if (JWT_SECRET === 'CHANGE_ME_IN_PRODUCTION_USE_RANDOM_STRING' && process.env.NODE_ENV === 'production') {
  console.error('⚠️  WARNING: Using default JWT secret in production! Set JWT_SECRET environment variable.');
}

/**
 * JWT authentication for user endpoints
 */
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Please provide a valid Bearer token in Authorization header'
    });
  }

  const token = authHeader.substring(7);

  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({
        success: false,
        error: 'Token expired',
        message: 'Your session has expired. Please log in again.'
      });
    }
    return res.status(403).json({
      success: false,
      error: 'Invalid token',
      message: 'The provided token is invalid'
    });
  }
};

/**
 * API key authentication for service-to-service
 */
const authenticateAPIKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || !API_KEYS.has(apiKey)) {
    return res.status(401).json({
      success: false,
      error: 'Valid API key required',
      message: 'Please provide a valid API key in X-API-Key header'
    });
  }

  // Set user context for API key
  req.user = { type: 'api-key', authenticated: true };
  next();
};

/**
 * Either JWT or API key authentication
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  // Try API key first
  if (apiKey && API_KEYS.has(apiKey)) {
    req.user = { type: 'api-key', authenticated: true };
    return next();
  }

  // Try JWT
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateJWT(req, res, next);
  }

  return res.status(401).json({
    success: false,
    error: 'Authentication required',
    message: 'Please provide either a Bearer token or API key'
  });
};

/**
 * Generate JWT token (for login endpoints)
 */
const generateToken = (payload, expiresIn = '24h') => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

/**
 * Optional authentication - proceeds even without auth
 * Sets req.authenticated = true/false
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  req.authenticated = false;

  if (apiKey && API_KEYS.has(apiKey)) {
    req.user = { type: 'api-key', authenticated: true };
    req.authenticated = true;
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const user = jwt.verify(token, JWT_SECRET);
      req.user = user;
      req.authenticated = true;
    } catch (err) {
      // Continue without auth
    }
  }

  next();
};

module.exports = {
  authenticate,
  authenticateJWT,
  authenticateAPIKey,
  optionalAuth,
  generateToken
};
