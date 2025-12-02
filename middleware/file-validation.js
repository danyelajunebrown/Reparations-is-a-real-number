const FileTypeDetector = require('../src/services/document/FileTypeDetector');
const logger = require('../src/utils/logger');

const fileTypeDetector = new FileTypeDetector();

// Validate uploaded file
const validateFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const file = req.file;

    // Check file size (100MB max)
    if (file.size > 100 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'File size exceeds 100MB limit'
      });
    }

    // Detect file type using magic numbers
    const detectedType = await fileTypeDetector.detect(file.buffer);
    
    if (!fileTypeDetector.isAllowedType(detectedType)) {
      logger.warn('Invalid file type detected', {
        filename: file.originalname,
        detectedType: detectedType.mime,
        uploadedType: file.mimetype
      });
      
      return res.status(400).json({
        success: false,
        error: `Invalid file type: ${detectedType.mime}. Allowed types: PDF, JPEG, PNG, TIFF, HEIC, TXT`
      });
    }

    // Add detected type info to file object
    req.file.detectedType = detectedType;
    req.file.isValidated = true;

    logger.info('File validated successfully', {
      filename: file.originalname,
      size: file.size,
      detectedType: detectedType.mime
    });

    next();
  } catch (error) {
    logger.error('File validation error', {
      error: error.message,
      filename: req.file?.originalname
    });
    
    res.status(500).json({
      success: false,
      error: 'File validation failed'
    });
  }
};

module.exports = {
  validateFile
};
