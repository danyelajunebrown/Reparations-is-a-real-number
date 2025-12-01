/**
 * Health Check Routes
 *
 * System health and diagnostic endpoints.
 */

const express = require('express');
const router = express.Router();

const db = require('../../database/connection');
const logger = require('../../utils/logger');
const { asyncHandler } = require('../../../middleware/error-handler');

/**
 * GET /api/health
 * Basic health check
 */
router.get('/',
  asyncHandler(async (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * GET /api/health/detailed
 * Detailed health check with database status
 */
router.get('/detailed',
  asyncHandler(async (req, res) => {
    const dbHealth = await db.checkHealth();

    const health = {
      status: dbHealth.healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: dbHealth,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        unit: 'MB'
      },
      uptime: Math.round(process.uptime()),
      version: process.version
    };

    const statusCode = dbHealth.healthy ? 200 : 503;
    res.status(statusCode).json(health);
  })
);

module.exports = router;
