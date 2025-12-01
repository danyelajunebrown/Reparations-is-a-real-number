/**
 * Base Repository
 *
 * Provides common database operations for all repositories.
 * Extends this class to create entity-specific repositories.
 */

const db = require('../database/connection');
const logger = require('../utils/logger');

class BaseRepository {
  /**
   * @param {string} tableName - Name of the database table
   * @param {string} primaryKey - Name of the primary key column (default: 'id')
   */
  constructor(tableName, primaryKey = 'id') {
    this.tableName = tableName;
    this.primaryKey = primaryKey;
  }

  /**
   * Find a single record by primary key
   * @param {any} id - Primary key value
   * @returns {Promise<Object|null>} Record or null if not found
   */
  async findById(id) {
    const query = `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = $1`;
    const result = await db.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Find a single record by custom criteria
   * @param {Object} criteria - Column-value pairs
   * @returns {Promise<Object|null>} Record or null if not found
   */
  async findOne(criteria) {
    const { whereClause, values } = this.buildWhereClause(criteria);
    const query = `SELECT * FROM ${this.tableName} WHERE ${whereClause} LIMIT 1`;
    const result = await db.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Find all records matching criteria
   * @param {Object} criteria - Column-value pairs
   * @param {Object} options - Query options (orderBy, limit, offset)
   * @returns {Promise<Array>} Array of records
   */
  async findAll(criteria = {}, options = {}) {
    let query = `SELECT * FROM ${this.tableName}`;

    const values = [];
    if (Object.keys(criteria).length > 0) {
      const { whereClause, values: whereValues } = this.buildWhereClause(criteria);
      query += ` WHERE ${whereClause}`;
      values.push(...whereValues);
    }

    if (options.orderBy) {
      query += ` ORDER BY ${options.orderBy}`;
    }

    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    if (options.offset) {
      query += ` OFFSET ${options.offset}`;
    }

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Count records matching criteria
   * @param {Object} criteria - Column-value pairs
   * @returns {Promise<number>} Count
   */
  async count(criteria = {}) {
    let query = `SELECT COUNT(*) as count FROM ${this.tableName}`;

    const values = [];
    if (Object.keys(criteria).length > 0) {
      const { whereClause, values: whereValues } = this.buildWhereClause(criteria);
      query += ` WHERE ${whereClause}`;
      values.push(...whereValues);
    }

    const result = await db.query(query, values);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Insert a new record
   * @param {Object} data - Column-value pairs
   * @returns {Promise<Object>} Inserted record
   */
  async create(data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

    const query = `
      INSERT INTO ${this.tableName} (${columns.join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `;

    const result = await db.query(query, values);
    logger.operation(`Created ${this.tableName}`, {
      id: result.rows[0][this.primaryKey]
    });
    return result.rows[0];
  }

  /**
   * Update a record by primary key
   * @param {any} id - Primary key value
   * @param {Object} data - Column-value pairs to update
   * @returns {Promise<Object|null>} Updated record or null
   */
  async update(id, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');

    const query = `
      UPDATE ${this.tableName}
      SET ${setClause}, updated_at = NOW()
      WHERE ${this.primaryKey} = $${columns.length + 1}
      RETURNING *
    `;

    const result = await db.query(query, [...values, id]);
    if (result.rows[0]) {
      logger.operation(`Updated ${this.tableName}`, { id });
    }
    return result.rows[0] || null;
  }

  /**
   * Delete a record by primary key
   * @param {any} id - Primary key value
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async delete(id) {
    const query = `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = $1`;
    const result = await db.query(query, [id]);
    const deleted = result.rowCount > 0;
    if (deleted) {
      logger.operation(`Deleted ${this.tableName}`, { id });
    }
    return deleted;
  }

  /**
   * Execute a raw SQL query
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} Query results
   */
  async raw(query, params = []) {
    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Execute a function within a transaction
   * @param {Function} callback - Async function receiving client
   * @returns {Promise<any>} Result of callback
   */
  async transaction(callback) {
    return db.transaction(callback);
  }

  /**
   * Build WHERE clause from criteria object
   * @private
   * @param {Object} criteria - Column-value pairs
   * @returns {Object} { whereClause, values }
   */
  buildWhereClause(criteria) {
    const conditions = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(criteria)) {
      if (value === null) {
        conditions.push(`${key} IS NULL`);
      } else if (Array.isArray(value)) {
        conditions.push(`${key} = ANY($${paramIndex})`);
        values.push(value);
        paramIndex++;
      } else {
        conditions.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    return {
      whereClause: conditions.join(' AND '),
      values
    };
  }

  /**
   * Check if a record exists
   * @param {Object} criteria - Column-value pairs
   * @returns {Promise<boolean>} True if exists
   */
  async exists(criteria) {
    const count = await this.count(criteria);
    return count > 0;
  }

  /**
   * Insert multiple records in a single query
   * @param {Array<Object>} records - Array of objects to insert
   * @returns {Promise<Array>} Inserted records
   */
  async createMany(records) {
    if (records.length === 0) return [];

    const columns = Object.keys(records[0]);
    const values = [];
    const placeholders = [];

    let paramIndex = 1;
    for (const record of records) {
      const rowPlaceholders = columns.map(() => `$${paramIndex++}`);
      placeholders.push(`(${rowPlaceholders.join(', ')})`);
      values.push(...Object.values(record));
    }

    const query = `
      INSERT INTO ${this.tableName} (${columns.join(', ')})
      VALUES ${placeholders.join(', ')}
      RETURNING *
    `;

    const result = await db.query(query, values);
    logger.operation(`Bulk created ${this.tableName}`, {
      count: result.rows.length
    });
    return result.rows;
  }
}

module.exports = BaseRepository;
