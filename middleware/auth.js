const jwt = require('jsonwebtoken');
const logger = require('../src/utils/logger');

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      throw new Error('No authentication token provided');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secure-jwt-secret-here');
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
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secure-jwt-secret-here');
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
