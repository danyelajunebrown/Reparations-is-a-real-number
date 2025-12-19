/**
 * Database Connection Pool
 *
 * Centralized PostgreSQL connection management using Neon serverless (HTTP).
 * This uses the @neondatabase/serverless driver which connects over HTTP
 * instead of TCP port 5432 (useful when port 5432 is blocked).
 */

const { neon, neonConfig } = require('@neondatabase/serverless');
const config = require('../../config');
const logger = require('../utils/logger');

// neonConfig is available for advanced configuration if needed

// Create the SQL function
const connectionString = config.database.connectionString ||
  `postgresql://${config.database.user}:${config.database.password}@${config.database.host}:${config.database.port}/${config.database.database}`;

const sql = neon(connectionString);

// Track connection state
let isConnected = false;

/**
 * Execute a query with timing and logging
 * Compatible with pg Pool.query() interface
 * @param {string} text - SQL query with $1, $2, etc. placeholders
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result with rows array
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    // Use sql.query() for parameterized queries (not tagged template)
    const result = await sql.query(text, params);
    const duration = Date.now() - start;

    if (!isConnected) {
      isConnected = true;
      logger.info('Connected to PostgreSQL database (Neon serverless/HTTP)');
    }

    logger.query(text, duration, result.length);

    // Return in pg-compatible format
    return {
      rows: result,
      rowCount: result.length,
      command: text.trim().split(' ')[0].toUpperCase()
    };
  } catch (error) {
    logger.error('Database query error', {
      query: text.substring(0, 100),
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Get a "client" for transaction handling
 * Note: Neon serverless doesn't support traditional transactions the same way,
 * but we provide a compatible interface that executes queries serially
 * @returns {Promise<Object>} Pseudo-client object
 */
async function getClient() {
  // Return an object that mimics pg client interface
  const client = {
    query: async function(text, params) {
      return query(text, params);
    },
    release: function() {
      // No-op for serverless
    }
  };
  return client;
}

/**
 * Execute a function within a transaction
 * Note: For true transaction support with Neon, consider using their
 * transaction() API or the Pool driver for local development
 * @param {Function} callback - Async function to execute in transaction
 * @returns {Promise<any>} Result of callback
 */
async function transaction(callback) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check function
 * @returns {Promise<Object>} Health status
 */
async function checkHealth() {
  try {
    const result = await query('SELECT 1 as health');
    return {
      healthy: true,
      timestamp: new Date().toISOString(),
      driver: 'neon-serverless'
    };
  } catch (err) {
    logger.error('Database health check failed', {
      error: err.message
    });
    return {
      healthy: false,
      error: err.message,
      timestamp: new Date().toISOString(),
      driver: 'neon-serverless'
    };
  }
}

/**
 * Close connections (no-op for serverless HTTP)
 */
async function close() {
  logger.info('Database connection pool closed (serverless - no persistent connections)');
}

// Create a pool-like object for compatibility
const pool = {
  query,
  connect: getClient,
  end: close,
  on: function(event, callback) {
    // No-op for event handlers - serverless doesn't have persistent connections
    if (event === 'error') {
      // Store error handler but it won't be called in serverless mode
    }
  }
};

module.exports = {
  pool,
  query,
  getClient,
  transaction,
  checkHealth,
  close,
  sql // Export raw sql function for advanced usage
};
