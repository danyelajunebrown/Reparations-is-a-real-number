const vision = require('@google-cloud/vision');
const Tesseract = require('tesseract.js');
const logger = require('../../utils/logger');
const FileTypeDetector = require('./FileTypeDetector');

class OCRProcessor {
  constructor() {
    const config = require('../../../config');
    
    // Configure Google Vision client
    this.googleVisionClient = new vision.ImageAnnotatorClient({
      keyFilename: config.apiKeys.googleVisionKeyPath
    });

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

      // Validate file type is processable
      if (!this.isProcessableType(detectedType.mime)) {
        throw new Error(`Unsupported file type for OCR: ${detectedType.mime}`);
      }

      // Try Google Vision first
      const googleResults = await this.processWithGoogleVision(file);

      // If Google Vision fails or has low confidence, fall back to Tesseract
      if (googleResults.confidence < 0.8) {
        const tesseractResults = await this.processWithTesseract(file);
        
        // Compare and choose best results
        return this.chooseBestResults(googleResults, tesseractResults);
      }

      return googleResults;
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
      // Perform OCR
      const { data: { text, confidence, lines } } = await Tesseract.recognize(
        file.buffer,
        'eng',
        { 
          logger: (m) => logger.info('Tesseract Progress', m) 
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
