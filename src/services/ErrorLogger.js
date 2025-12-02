/**
 * Error Logger Service
 *
 * Provides robust error tracking for document operations.
 * Logs errors to file and console with full context.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class ErrorLogger {
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.logFile = path.join(this.logDir, 'document-errors.json');
    this.maxEntries = 1000;

    // Ensure log directory exists on startup
    this.ensureLogDir();
  }

  /**
   * Ensure the log directory exists
   */
  ensureLogDir() {
    try {
      if (!fsSync.existsSync(this.logDir)) {
        fsSync.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      console.error('[ErrorLogger] Failed to create log directory:', err);
    }
  }

  /**
   * Generate a unique error ID
   */
  generateErrorId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `err_${timestamp}_${random}`;
  }

  /**
   * Log an error with full context
   * @param {Object} errorData - Error details
   * @returns {Promise<string>} Error ID
   */
  async log(errorData) {
    const entry = {
      id: this.generateErrorId(),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      ...errorData
    };

    // Log to console with structured format
    const logLevel = errorData.severity === 'critical' ? 'error' : 'warn';
    console[logLevel]('[DOC_ERROR]', JSON.stringify(entry, null, 2));

    // Append to log file
    try {
      let logs = [];

      // Read existing logs
      try {
        const existing = await fs.readFile(this.logFile, 'utf8');
        logs = JSON.parse(existing);
        if (!Array.isArray(logs)) logs = [];
      } catch (readErr) {
        // File doesn't exist or is invalid, start fresh
        logs = [];
      }

      // Add new entry
      logs.push(entry);

      // Trim to max entries (keep most recent)
      if (logs.length > this.maxEntries) {
        logs = logs.slice(-this.maxEntries);
      }

      // Write back
      await fs.writeFile(this.logFile, JSON.stringify(logs, null, 2));

    } catch (writeErr) {
      console.error('[ErrorLogger] Failed to write log file:', writeErr);
    }

    return entry.id;
  }

  /**
   * Log a document access error
   */
  async logDocumentError({
    type,
    documentId,
    filePath,
    s3Key,
    bucket,
    message,
    stack,
    userId,
    userAgent,
    requestId
  }) {
    return this.log({
      category: 'document_access',
      type,
      documentId,
      filePath,
      s3Key,
      bucket,
      message,
      stack,
      userId,
      userAgent,
      requestId,
      severity: type.includes('NOT_FOUND') ? 'warning' : 'error'
    });
  }

  /**
   * Log a frontend-reported error
   */
  async logFrontendError({
    action,
    documentId,
    error,
    message,
    url,
    userAgent
  }) {
    return this.log({
      category: 'frontend',
      source: 'browser',
      action,
      documentId,
      error,
      message,
      url,
      userAgent,
      severity: 'warning'
    });
  }

  /**
   * Get recent errors
   * @param {number} limit - Max entries to return
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>}
   */
  async getRecentErrors(limit = 50, filters = {}) {
    try {
      const data = await fs.readFile(this.logFile, 'utf8');
      let logs = JSON.parse(data);

      if (!Array.isArray(logs)) return [];

      // Apply filters
      if (filters.type) {
        logs = logs.filter(l => l.type === filters.type);
      }
      if (filters.category) {
        logs = logs.filter(l => l.category === filters.category);
      }
      if (filters.documentId) {
        logs = logs.filter(l => l.documentId === filters.documentId);
      }
      if (filters.since) {
        const sinceDate = new Date(filters.since);
        logs = logs.filter(l => new Date(l.timestamp) >= sinceDate);
      }

      // Return most recent first
      return logs.slice(-limit).reverse();
    } catch (err) {
      console.error('[ErrorLogger] Failed to read logs:', err);
      return [];
    }
  }

  /**
   * Get error statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    try {
      const data = await fs.readFile(this.logFile, 'utf8');
      const logs = JSON.parse(data);

      if (!Array.isArray(logs)) return { totalErrors: 0, byType: {}, byCategory: {} };

      const byType = {};
      const byCategory = {};
      const last24h = [];
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

      logs.forEach(log => {
        // Count by type
        const type = log.type || 'UNKNOWN';
        byType[type] = (byType[type] || 0) + 1;

        // Count by category
        const category = log.category || 'uncategorized';
        byCategory[category] = (byCategory[category] || 0) + 1;

        // Count last 24h
        if (new Date(log.timestamp).getTime() > oneDayAgo) {
          last24h.push(log);
        }
      });

      return {
        totalErrors: logs.length,
        errorsLast24h: last24h.length,
        byType,
        byCategory,
        oldestError: logs[0]?.timestamp,
        newestError: logs[logs.length - 1]?.timestamp
      };
    } catch (err) {
      return { totalErrors: 0, byType: {}, byCategory: {}, error: err.message };
    }
  }

  /**
   * Clear old errors (older than specified days)
   * @param {number} daysOld - Delete errors older than this
   * @returns {Promise<number>} Number of entries deleted
   */
  async clearOldErrors(daysOld = 30) {
    try {
      const data = await fs.readFile(this.logFile, 'utf8');
      let logs = JSON.parse(data);

      if (!Array.isArray(logs)) return 0;

      const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
      const originalCount = logs.length;

      logs = logs.filter(log => new Date(log.timestamp).getTime() > cutoff);

      await fs.writeFile(this.logFile, JSON.stringify(logs, null, 2));

      return originalCount - logs.length;
    } catch (err) {
      console.error('[ErrorLogger] Failed to clear old errors:', err);
      return 0;
    }
  }
}

// Export singleton
module.exports = new ErrorLogger();
