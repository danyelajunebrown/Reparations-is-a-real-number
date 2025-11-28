/**
 * Research Routes
 *
 * Natural language research queries and conversational assistant.
 */

const express = require('express');
const router = express.Router();

const ResearchService = require('../../services/ResearchService');
const logger = require('../../utils/logger');
const { asyncHandler } = require('../../../middleware/error-handler');
const { queryLimiter } = require('../../../middleware/rate-limit');

/**
 * POST /api/research/query
 * Process a natural language research query
 */
router.post('/query',
  queryLimiter,
  asyncHandler(async (req, res) => {
    const { query, sessionId } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Query is required and must be a string'
      });
    }

    const result = await ResearchService.processQuery(query, sessionId);

    res.json(result);
  })
);

/**
 * POST /api/research/clear-session
 * Clear a research session (conversation history)
 */
router.post('/clear-session',
  asyncHandler(async (req, res) => {
    const { sessionId = 'default' } = req.body;

    ResearchService.clearSession(sessionId);

    res.json({
      success: true,
      message: 'Session cleared successfully'
    });
  })
);

module.exports = router;
