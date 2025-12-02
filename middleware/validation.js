const multer = require('multer');
const path = require('path');
const Joi = require('joi');

// File upload validation
const fileUploadValidation = multer({
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'image/heic',
      'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  }
});

// Request validation middleware
const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }
    next();
  };
};

// Validate document metadata
const validateDocumentMetadata = async (metadata) => {
  // Ensure required fields are present
  const required = ['ownerName', 'documentType'];
  for (const field of required) {
    if (!metadata[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validate document type
  const validTypes = ['will', 'deed', 'inventory', 'letter', 'legal', 'other'];
  if (!validTypes.includes(metadata.documentType)) {
    throw new Error(`Invalid document type: ${metadata.documentType}`);
  }

  // Clean and format metadata
  return {
    ownerName: metadata.ownerName.trim(),
    documentType: metadata.documentType,
    storageProvider: metadata.storageProvider || 's3',
    notes: metadata.notes || '',
    uploadedAt: new Date().toISOString()
  };
};

// Validation schemas
const validationSchemas = {
  uploadDocument: Joi.object({
    ownerName: Joi.string().min(2).max(100).required(),
    documentType: Joi.string().valid(
      'will', 'deed', 'inventory', 'letter', 'legal', 'other',
      'probate', 'census', 'slave_schedule', 'slave_manifest',
      'estate_inventory', 'correspondence', 'ship_manifest',
      'sale_record', 'tombstone'
    ).required(),
    notes: Joi.string().max(500).optional(),
    storageProvider: Joi.string().valid('local', 's3').optional(),
    // Additional optional fields from frontend form
    location: Joi.string().max(200).optional().allow(''),
    birthYear: Joi.number().integer().min(1600).max(1900).optional().allow(''),
    deathYear: Joi.number().integer().min(1600).max(1950).optional().allow('')
  }),
  
  searchDocuments: Joi.object({
    ownerName: Joi.string().min(1).max(100).optional(),
    documentType: Joi.string().valid('will', 'deed', 'inventory', 'letter', 'legal', 'other').optional(),
    startDate: Joi.date().optional(),
    endDate: Joi.date().optional(),
    keyword: Joi.string().max(100).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    offset: Joi.number().integer().min(0).optional()
  })
};

// Validation function
const validate = (schemaName) => {
  return (req, res, next) => {
    const schema = validationSchemas[schemaName];
    if (!schema) {
      return res.status(500).json({
        success: false,
        error: `Validation schema '${schemaName}' not found`
      });
    }

    const { error, value } = schema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    req.validatedBody = value;
    next();
  };
};

module.exports = {
  fileUploadValidation,
  validateRequest,
  validateDocumentMetadata,
  validate
};
