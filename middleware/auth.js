const jwt = require('jsonwebtoken');
const logger = require('../src/utils/logger');

// ── Security: fail fast if JWT_SECRET is not configured ─────────────────────
// A missing JWT_SECRET causes the fallback weak secret to be used, making
// every token trivially forgeable. This must blow up at startup, not silently.
if (!process.env.JWT_SECRET) {
  throw new Error(
    'FATAL: JWT_SECRET environment variable is not set. ' +
    'Generate a strong secret (e.g. `openssl rand -hex 64`) and add it ' +
    'to your .env file before starting the server. ' +
    'Do NOT use a hardcoded default in production.'
  );
}

const JWT_SECRET = process.env.JWT_SECRET;

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      throw new Error('No authentication token provided');
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.userId = decoded.id;
    
    next();
  } catch (error) {
    logger.error('Authentication failed', { error: error.message });
    res.status(401).json({
      success: false,
      error: 'Please authenticate'
    });
  }
};

// Optional authentication - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      req.userId = decoded.id;
    }
    
    next();
  } catch (error) {
    // Just log the error and continue without auth
    logger.debug('Optional auth failed', { error: error.message });
    next();
  }
};

module.exports = {
  authenticate,
  optionalAuth
};
