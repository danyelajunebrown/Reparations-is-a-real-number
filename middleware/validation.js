/**
 * Input Validation Middleware
 * Uses Joi for schema validation
 */

const Joi = require('joi');

// Validation schemas for different endpoints
const schemas = {
  uploadDocument: Joi.object({
    ownerName: Joi.string().min(2).max(100).required(),
    documentType: Joi.string()
      .valid('will', 'probate', 'census', 'slave_schedule', 'slave_manifest', 'estate_inventory', 'correspondence', 'deed', 'ship_manifest', 'sale_record', 'other')
      .required(),
    birthYear: Joi.number().integer().min(1600).max(1900).optional().allow(null),
    deathYear: Joi.number().integer().min(1600).max(2000).optional().allow(null),
    location: Joi.string().max(200).optional().allow(null, ''),
    pageNumber: Joi.number().integer().min(1).optional(),
    totalPages: Joi.number().integer().min(1).optional(),
    isMultiPage: Joi.boolean().optional(),
    parentDocumentId: Joi.string().alphanum().optional()
  }),

  processMetadata: Joi.object({
    documentId: Joi.string().required(),
    fileName: Joi.string().optional(),
    fullName: Joi.string().min(2).max(100).required(),
    birthYear: Joi.number().integer().min(1600).max(2100).optional().allow(null),
    deathYear: Joi.number().integer().min(1600).max(2100).optional().allow(null),
    gender: Joi.string().valid('Male', 'Female', 'Unknown').optional().allow(null),
    locations: Joi.alternatives().try(
      Joi.string(),
      Joi.array().items(Joi.string())
    ).optional(),
    spouses: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      birthYear: Joi.number().integer().optional(),
      deathYear: Joi.number().integer().optional(),
      gender: Joi.string().optional()
    })).optional(),
    children: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      birthYear: Joi.number().integer().optional(),
      deathYear: Joi.number().integer().optional(),
      gender: Joi.string().optional()
    })).optional(),
    parents: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      birthYear: Joi.number().integer().optional(),
      deathYear: Joi.number().integer().optional(),
      gender: Joi.string().optional()
    })).optional(),
    notes: Joi.string().max(5000).optional().allow(null, '')
  }),

  addEnslavedDescendant: Joi.object({
    fullName: Joi.string().min(2).max(100).required(),
    birthYear: Joi.number().integer().min(1600).max(2100).optional(),
    deathYear: Joi.number().integer().min(1600).max(2100).optional(),
    gender: Joi.string().valid('Male', 'Female', 'Unknown').optional(),
    enslavedBy: Joi.string().optional(),
    freedomYear: Joi.number().integer().min(1600).max(1900).optional(),
    directReparations: Joi.number().min(0).optional(),
    parentIds: Joi.array().items(Joi.string()).optional(),
    notes: Joi.string().max(5000).optional()
  }),

  calculateDebt: Joi.object({
    perpetratorId: Joi.string().required(),
    originalDebt: Joi.number().positive().max(1e15).required()
  }),

  calculateCredit: Joi.object({
    ancestorId: Joi.string().required(),
    originalCredit: Joi.number().positive().max(1e15).required()
  }),

  recordPayment: Joi.object({
    payerId: Joi.string().required(),
    recipientId: Joi.string().required(),
    amount: Joi.number().positive().max(1e15).required(),
    txHash: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).optional().allow(null),
    blockNumber: Joi.number().integer().positive().optional().allow(null),
    networkId: Joi.number().integer().valid(1, 5, 11155111, 1337, 31337).optional().allow(null)
  }),

  llmQuery: Joi.object({
    query: Joi.string().min(1).max(500).required(),
    sessionId: Joi.string().max(100).optional()
  }),

  clearChat: Joi.object({
    sessionId: Joi.string().max(100).optional()
  }),

  uploadDocumentWithText: Joi.object({
    ownerName: Joi.string().min(2).max(100).required(),
    documentType: Joi.string()
      .valid('will', 'probate', 'census', 'slave_schedule', 'slave_manifest', 'estate_inventory', 'correspondence', 'deed', 'ship_manifest', 'sale_record', 'other')
      .required(),
    textContent: Joi.string().min(10).max(500000).optional().allow(null, ''),
    textSource: Joi.string().valid('ocr', 'transcription', 'manual', 'archive').optional(),
    birthYear: Joi.number().integer().min(1600).max(1900).optional().allow(null),
    deathYear: Joi.number().integer().min(1600).max(2000).optional().allow(null),
    location: Joi.string().max(200).optional().allow(null, ''),
    pageNumber: Joi.number().integer().min(1).optional(),
    totalPages: Joi.number().integer().min(1).optional(),
    isMultiPage: Joi.boolean().optional(),
    parentDocumentId: Joi.string().alphanum().optional(),
    notes: Joi.string().max(5000).optional().allow(null, '')
  })
};

/**
 * Validation middleware factory
 * @param {string} schemaName - Name of the schema to use
 * @returns {Function} Express middleware
 */
function validate(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];

    if (!schema) {
      console.warn(`No validation schema found for: ${schemaName}`);
      return next();
    }

    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Get all errors, not just first
      stripUnknown: true  // Remove unknown fields
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message
        }))
      });
    }

    // Replace body with validated (and sanitized) data
    req.validatedBody = value;
    next();
  };
}

/**
 * Validate query parameters
 */
function validateQuery(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];

    if (!schema) {
      return next();
    }

    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Query validation failed',
        details: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message
        }))
      });
    }

    req.validatedQuery = value;
    next();
  };
}

module.exports = { validate, validateQuery, schemas };
