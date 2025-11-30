/**
 * Database Utilities
 * Resilient database operations with retry logic and error handling
 */

/**
 * Query with exponential backoff retry
 * Prevents scraper failures from database connection issues
 */
async function queryWithRetry(database, query, params = [], options = {}) {
    const maxRetries = options.maxRetries || 5;
    const baseDelay = options.baseDelay || 1000; // 1 second
    const maxDelay = options.maxDelay || 30000; // 30 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await database.query(query, params);
        } catch (error) {
            const isConnectionError =
                error.code === 'ECONNREFUSED' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                error.message?.includes('Connection') ||
                error.message?.includes('connect');

            if (isConnectionError && attempt < maxRetries) {
                const delayMs = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
                console.log(`⚠️  DB connection failed (attempt ${attempt}/${maxRetries}), retrying in ${(delayMs / 1000).toFixed(1)}s...`);
                await sleep(delayMs);
                continue;
            }

            // Not a connection error, or max retries reached
            throw error;
        }
    }
}

/**
 * Test database connection health
 */
async function testConnection(database) {
    try {
        await database.query('SELECT 1');
        return { healthy: true };
    } catch (error) {
        return {
            healthy: false,
            error: error.message,
            code: error.code
        };
    }
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get database connection info (for debugging)
 */
function getConnectionInfo(database) {
    if (database.pool) {
        return {
            totalCount: database.pool.totalCount,
            idleCount: database.pool.idleCount,
            waitingCount: database.pool.waitingCount
        };
    }
    return null;
}

module.exports = {
    queryWithRetry,
    testConnection,
    getConnectionInfo,
    sleep
};
