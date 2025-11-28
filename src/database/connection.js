/**
 * Database Connection Pool
 *
 * Centralized PostgreSQL connection management using the new config system.
 */

const { Pool } = require('pg');
const config = require('../../config');
const logger = require('../utils/logger');

// Create pool connection
const pool = config.database.connectionString
  ? new Pool({
      connectionString: config.database.connectionString,
      ssl: config.database.ssl
    })
  : new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
      ssl: config.database.ssl
    });

// Connection event handlers
pool.on('connect', () => {
  logger.info('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  logger.error('Unexpected database error on idle client', {
    error: err.message,
    stack: err.stack
  });

  // Log to monitoring service if configured
  if (config.monitoring.sentryDsn) {
    // Sentry.captureException(err);
  }

  // Don't exit process - allow app to recover
  // The pool will attempt to reconnect automatically
});

/**
 * Execute a query with timing and logging
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;

    logger.query(text, duration, res.rowCount);

    return res;
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
 * Get a client from the pool for transaction handling
 * @returns {Promise<PoolClient>} Database client
 */
async function getClient() {
  const client = await pool.connect();

  // Add query logging to client
  const originalQuery = client.query.bind(client);
  client.query = async function (text, params) {
    const start = Date.now();
    try {
      const res = await originalQuery(text, params);
      const duration = Date.now() - start;
      logger.query(text, duration, res.rowCount);
      return res;
    } catch (error) {
      logger.error('Database query error (client)', {
        query: text.substring(0, 100),
        error: error.message
      });
      throw error;
    }
  };

  return client;
}

/**
 * Execute a function within a transaction
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
    const result = await pool.query('SELECT 1 as health');
    return {
      healthy: true,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    logger.error('Database health check failed', {
      error: err.message
    });
    return {
      healthy: false,
      error: err.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Close all connections in the pool
 */
async function close() {
  await pool.end();
  logger.info('Database connection pool closed');
}

module.exports = {
  pool,
  query,
  getClient,
  transaction,
  checkHealth,
  close
};
