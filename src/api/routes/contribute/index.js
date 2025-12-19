/**
 * Contribute Routes Index
 *
 * This module re-exports the main contribute routes.
 * In the future, individual route groups can be split into separate files
 * and composed here.
 *
 * Current structure:
 * - contribute.js (main file, 3400+ lines)
 *
 * Future modular structure:
 * - search.js     - /search routes
 * - stats.js      - /stats, /browse routes
 * - person.js     - /person/:id routes
 * - data-quality.js - /data-quality routes
 * - training.js   - /training routes
 * - session.js    - /:sessionId routes
 * - extraction.js - extraction routes
 * - review.js     - /review-queue routes
 * - promotion.js  - /promote routes
 * - external.js   - external source routes
 */

const mainRouter = require('../contribute');

module.exports = mainRouter;
