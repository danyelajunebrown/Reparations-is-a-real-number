/**
 * Error Logging Routes
 *
 * Handles error logging from frontend and admin error viewing.
 */

const express = require('express');
const router = express.Router();
const ErrorLogger = require('../../services/ErrorLogger');
const { asyncHandler } = require('../../../middleware/error-handler');
const { generalLimiter } = require('../../../middleware/rate-limit');

/**
 * POST /api/errors/log
 * Log an error from the frontend
 */
router.post('/log',
  generalLimiter,
  asyncHandler(async (req, res) => {
    const errorData = req.body;

    // Validate required fields
    if (!errorData || typeof errorData !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid error data'
      });
    }

    // Add request metadata
    errorData.ip = req.ip;
    errorData.userAgent = errorData.userAgent || req.headers['user-agent'];
    errorData.source = errorData.source || 'frontend';

    // Log the error
    const errorId = await ErrorLogger.logFrontendError(errorData);

    res.json({
      success: true,
      errorId,
      message: 'Error logged successfully'
    });
  })
);

/**
 * GET /api/errors/recent
 * Get recent errors (admin/debug endpoint)
 */
router.get('/recent',
  generalLimiter,
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const type = req.query.type;
    const category = req.query.category;
    const documentId = req.query.documentId;

    const filters = {};
    if (type) filters.type = type;
    if (category) filters.category = category;
    if (documentId) filters.documentId = documentId;

    const errors = await ErrorLogger.getRecentErrors(limit, filters);

    res.json({
      success: true,
      count: errors.length,
      errors
    });
  })
);

/**
 * GET /api/errors/stats
 * Get error statistics
 */
router.get('/stats',
  generalLimiter,
  asyncHandler(async (req, res) => {
    const stats = await ErrorLogger.getStats();

    res.json({
      success: true,
      stats
    });
  })
);

/**
 * DELETE /api/errors/clear-old
 * Clear errors older than specified days
 */
router.delete('/clear-old',
  generalLimiter,
  asyncHandler(async (req, res) => {
    const daysOld = parseInt(req.query.days) || 30;

    const deletedCount = await ErrorLogger.clearOldErrors(daysOld);

    res.json({
      success: true,
      deletedCount,
      message: `Cleared ${deletedCount} errors older than ${daysOld} days`
    });
  })
);

module.exports = router;
