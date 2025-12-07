const vision = require('@google-cloud/vision');
const Tesseract = require('tesseract.js');
const logger = require('../../utils/logger');
const FileTypeDetector = require('./FileTypeDetector');
const fs = require('fs');
const path = require('path');

class OCRProcessor {
  constructor() {
    const config = require('../../../config');

    // Configure Google Vision client with multiple auth options
    let visionConfig = {};

    // Option 1: Credentials passed as JSON string in environment variable (for Render)
    if (config.apiKeys.googleVisionCredentials) {
      try {
        const credentials = JSON.parse(config.apiKeys.googleVisionCredentials);
        visionConfig = { credentials };
        logger.info('Google Vision: Using credentials from environment variable');
      } catch (e) {
        logger.error('Failed to parse GOOGLE_VISION_CREDENTIALS', { error: e.message });
      }
    }
    // Option 2: Credentials file path
    else if (config.apiKeys.googleVisionKeyPath) {
      const keyPath = path.resolve(config.apiKeys.googleVisionKeyPath);
      if (fs.existsSync(keyPath)) {
        visionConfig = { keyFilename: keyPath };
        logger.info('Google Vision: Using credentials file', { path: keyPath });
      } else {
        logger.warn('Google Vision credentials file not found', { path: keyPath });
      }
    }

    // Create client (may fail if no valid credentials)
    try {
      this.googleVisionClient = new vision.ImageAnnotatorClient(visionConfig);
      this.googleVisionAvailable = true;
      logger.info('Google Vision client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Google Vision client', { error: error.message });
      this.googleVisionClient = null;
      this.googleVisionAvailable = false;
    }

    this.fileTypeDetector = new FileTypeDetector();
  }

  /**
   * Determine the best OCR method based on file type
   * @param {Object} file - File to process
   * @returns {Promise<Object>} OCR results
   */
  async process(file) {
    try {
      // Detect file type
      const detectedType = await this.fileTypeDetector.detect(file.buffer);
      logger.info('OCR: Detected file type', { mime: detectedType.mime, ext: detectedType.ext });

      // Validate file type is processable
      if (!this.isProcessableType(detectedType.mime)) {
        throw new Error(`Unsupported file type for OCR: ${detectedType.mime}`);
      }

      // Try Google Vision first (if available)
      if (this.googleVisionAvailable && this.googleVisionClient) {
        try {
          logger.info('OCR: Attempting Google Vision');
          const googleResults = await this.processWithGoogleVision(file);

          // If Google Vision has good confidence, use it
          if (googleResults.confidence >= 0.8) {
            return googleResults;
          }

          // If low confidence, try Tesseract and compare
          logger.info('OCR: Google Vision low confidence, trying Tesseract', { confidence: googleResults.confidence });
          const tesseractResults = await this.processWithTesseract(file);
          return this.chooseBestResults(googleResults, tesseractResults);
        } catch (googleError) {
          logger.warn('OCR: Google Vision failed, falling back to Tesseract', { error: googleError.message });
        }
      } else {
        logger.info('OCR: Google Vision not available, using Tesseract only');
      }

      // Use Tesseract as primary/fallback
      return await this.processWithTesseract(file);

    } catch (error) {
      // Log detailed error
      logger.error('OCR Processing Failed', {
        error: error.message,
        filename: file.originalname
      });

      // Attempt Tesseract as last resort
      try {
        return await this.processWithTesseract(file);
      } catch (tesseractError) {
        logger.error('Tesseract OCR Fallback Failed', {
          error: tesseractError.message
        });

        // If all OCR methods fail, return minimal information
        return {
          text: '',
          confidence: 0,
          service: 'none',
          error: error.message
        };
      }
    }
  }

  /**
   * Check if file type is processable by OCR
   * @param {string} mimeType - MIME type to check
   * @returns {boolean} Whether file can be processed
   */
  isProcessableType(mimeType) {
    const processableTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'image/heic'
    ];

    return processableTypes.includes(mimeType);
  }

  /**
   * Process document with Google Vision API
   * @param {Object} file - File to process
   * @returns {Promise<Object>} OCR results
   */
  async processWithGoogleVision(file) {
    try {
      // Perform text detection
      const [result] = await this.googleVisionClient.textDetection(file.buffer);
      
      // Extract text and annotations
      const fullText = result.fullTextAnnotation?.text || '';
      const pages = result.fullTextAnnotation?.pages || [];

      // Calculate confidence
      const confidence = this.calculateConfidence(pages);

      // Log successful processing
      logger.operation('Google Vision OCR Completed', {
        filename: file.originalname,
        confidence,
        textLength: fullText.length
      });

      return {
        text: fullText,
        confidence,
        service: 'google-vision',
        pageCount: pages.length,
        raw: result
      };
    } catch (error) {
      logger.error('Google Vision OCR Failed', {
        error: error.message,
        filename: file.originalname
      });

      // Throw to trigger fallback
      throw error;
    }
  }

  /**
   * Process document with Tesseract.js
   * @param {Object} file - File to process
   * @returns {Promise<Object>} OCR results
   */
  async processWithTesseract(file) {
    try {
      // Check if file is PDF - Tesseract can't process PDFs directly
      const detectedType = await this.fileTypeDetector.detect(file.buffer);

      if (detectedType.mime === 'application/pdf') {
        logger.info('Tesseract: PDF detected, extracting text with pdf-parse');
        // For PDFs, use pdf-parse to extract text (not true OCR but works for text-based PDFs)
        const pdfParse = require('pdf-parse');
        try {
          const pdfData = await pdfParse(file.buffer);

          if (pdfData.text && pdfData.text.trim().length > 0) {
            logger.operation('PDF text extraction completed', {
              filename: file.originalname,
              textLength: pdfData.text.length,
              pages: pdfData.numpages
            });

            return {
              text: pdfData.text,
              confidence: 0.9, // High confidence for extracted text
              service: 'pdf-parse',
              pageCount: pdfData.numpages,
              raw: { info: pdfData.info }
            };
          } else {
            logger.warn('PDF has no extractable text (likely scanned image)', { filename: file.originalname });
            // Return empty - caller should try screenshot-based OCR
            return {
              text: '',
              confidence: 0,
              service: 'pdf-parse',
              pageCount: pdfData.numpages,
              error: 'PDF contains no extractable text - document may be a scanned image'
            };
          }
        } catch (pdfError) {
          logger.error('PDF parse failed', { error: pdfError.message });
          return {
            text: '',
            confidence: 0,
            service: 'pdf-parse',
            error: `PDF parsing failed: ${pdfError.message}`
          };
        }
      }

      // For images, use Tesseract
      logger.info('Tesseract: Processing image', { mime: detectedType.mime });
      const { data: { text, confidence, lines } } = await Tesseract.recognize(
        file.buffer,
        'eng',
        {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              logger.debug('Tesseract Progress', { progress: Math.round(m.progress * 100) + '%' });
            }
          }
        }
      );

      // Log successful processing
      logger.operation('Tesseract OCR Completed', {
        filename: file.originalname,
        confidence,
        textLength: text.length
      });

      return {
        text,
        confidence: confidence / 100, // Normalize to 0-1 scale
        service: 'tesseract',
        pageCount: 1, // Tesseract typically processes single page
        raw: { lines }
      };
    } catch (error) {
      logger.error('Tesseract OCR Failed', {
        error: error.message,
        filename: file.originalname
      });

      // Throw to trigger final fallback
      throw error;
    }
  }

  /**
   * Calculate confidence based on Vision API page analysis
   * @param {Array} pages - Vision API page annotations
   * @returns {number} Confidence score (0-1)
   */
  calculateConfidence(pages) {
    if (!pages || pages.length === 0) return 0;

    // Average confidence across all pages
    const pageConfidences = pages.map(page => {
      const blockConfidences = page.blocks
        .filter(block => block.confidence)
        .map(block => block.confidence);
      
      return blockConfidences.length > 0 
        ? blockConfidences.reduce((a, b) => a + b, 0) / blockConfidences.length
        : 0;
    });

    const avgConfidence = pageConfidences.reduce((a, b) => a + b, 0) / pageConfidences.length;
    
    // Normalize to 0-1 scale
    return Math.min(Math.max(avgConfidence, 0), 1);
  }

  /**
   * Choose the best OCR results between two services
   * @param {Object} googleResults - Google Vision results
   * @param {Object} tesseractResults - Tesseract results
   * @returns {Object} Best OCR results
   */
  chooseBestResults(googleResults, tesseractResults) {
    // Prefer results with higher confidence
    if (googleResults.confidence >= tesseractResults.confidence) {
      return googleResults;
    }

    return tesseractResults;
  }
}

module.exports = OCRProcessor;
