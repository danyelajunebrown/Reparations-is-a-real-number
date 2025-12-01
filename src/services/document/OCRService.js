/**
 * OCR Service - Handles document text extraction
 * Supports: Tesseract.js (free), Google Vision API (paid), and direct PDF text extraction
 */

const Tesseract = require('tesseract.js');
const vision = require('@google-cloud/vision');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const path = require('path');

class OCRService {
  constructor(config = {}) {
    this.googleVisionEnabled = !!process.env.GOOGLE_VISION_API_KEY;
    this.tesseractEnabled = true; // Always available (no API key needed)

    if (this.googleVisionEnabled) {
      this.visionClient = new vision.ImageAnnotatorClient({
        keyFilename: process.env.GOOGLE_VISION_CREDENTIALS_PATH || undefined,
        apiKey: process.env.GOOGLE_VISION_API_KEY || undefined
      });
      console.log('✓ Google Vision API enabled');
    } else {
      console.log('ℹ Google Vision API not configured - using Tesseract.js');
    }
  }

  /**
   * Main OCR function - automatically selects best method
   */
  async performOCR(filePath, documentType, options = {}) {
    const { preferredService = 'auto', originalFilename = '', mimeType: providedMimeType = '' } = options;

    console.log(`Starting OCR: ${originalFilename || path.basename(filePath)}`);

    try {
      // Check file type using original filename (multer temp files have no extension)
      const ext = originalFilename ? path.extname(originalFilename).toLowerCase() : path.extname(filePath).toLowerCase();
      const mimeType = providedMimeType || this.getMimeType(ext);

      // If it's a plain text file, read it directly (no OCR needed)
      if (ext === '.txt' || mimeType === 'text/plain') {
        console.log('✓ Plain text file detected, reading directly (no OCR needed)');
        const textContent = await fs.readFile(filePath, 'utf-8');
        return {
          text: textContent,
          confidence: 1.0,
          pageCount: 1,
          method: 'direct-read',
          service: 'text-file-reader',
          duration: 0
        };
      }

      // If it's a PDF, try direct text extraction first (fastest)
      if (ext === '.pdf') {
        const pdfResult = await this.extractPDFText(filePath);
        if (pdfResult.text && pdfResult.text.trim().length > 100) {
          console.log('✓ PDF text extracted directly (no OCR needed)');
          return {
            text: pdfResult.text,
            confidence: 1.0,
            pageCount: pdfResult.pageCount,
            method: 'pdf-parse',
            service: 'pdf-direct-extraction'
          };
        }
        console.log('PDF has no extractable text, falling back to OCR');
      }

      // Determine OCR service to use
      let service = preferredService;
      if (service === 'auto') {
        service = this.googleVisionEnabled ? 'google-vision' : 'tesseract';
      }

      // Perform OCR
      if (service === 'google-vision' && this.googleVisionEnabled) {
        return await this.performGoogleVisionOCR(filePath, mimeType);
      } else {
        return await this.performTesseractOCR(filePath);
      }

    } catch (error) {
      console.error('OCR error:', error);

      // If primary method failed, try fallback
      if (this.googleVisionEnabled && !error.message.includes('Tesseract')) {
        console.log('Falling back to Tesseract...');
        try {
          return await this.performTesseractOCR(filePath);
        } catch (fallbackError) {
          throw new Error(`All OCR methods failed: ${error.message}`);
        }
      }

      throw error;
    }
  }

  /**
   * Extract text directly from PDF (no OCR needed for born-digital PDFs)
   */
  async extractPDFText(filePath) {
    try {
      const dataBuffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(dataBuffer);

      return {
        text: pdfData.text,
        pageCount: pdfData.numpages,
        info: pdfData.info
      };
    } catch (error) {
      console.warn('PDF text extraction failed:', error.message);
      return { text: '', pageCount: 0 };
    }
  }

  /**
   * Perform OCR using Tesseract.js (FREE)
   */
  async performTesseractOCR(filePath) {
    console.log('Using Tesseract.js OCR...');
    const startTime = Date.now();

    let worker;
    try {
      worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            process.stdout.write(`\rOCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      const { data } = await worker.recognize(filePath);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n✓ Tesseract OCR complete in ${duration}s (confidence: ${data.confidence}%)`);

      return {
        text: data.text,
        confidence: data.confidence / 100, // Convert to 0-1 scale
        pageCount: 1,
        method: 'tesseract',
        service: 'tesseract.js',
        blocks: data.blocks?.length || 0,
        words: data.words?.length || 0,
        duration: parseFloat(duration)
      };

    } catch (error) {
      console.error('Tesseract OCR failed:', error);
      throw new Error(`Tesseract OCR failed: ${error.message}`);
    } finally {
      // Always terminate worker to free resources
      if (worker) {
        try {
          await worker.terminate();
        } catch (terminateError) {
          console.warn('Failed to terminate Tesseract worker:', terminateError.message);
        }
      }
    }
  }

  /**
   * Perform OCR using Google Vision API (PAID - better accuracy)
   */
  async performGoogleVisionOCR(filePath, mimeType) {
    console.log('Using Google Vision API OCR...');
    const startTime = Date.now();

    try {
      // Read file as buffer
      const imageBuffer = await fs.readFile(filePath);

      // Call Google Vision API
      const [result] = await this.visionClient.documentTextDetection({
        image: { content: imageBuffer }
      });

      const fullTextAnnotation = result.fullTextAnnotation;

      if (!fullTextAnnotation) {
        throw new Error('No text found in image');
      }

      // Calculate average confidence
      const pages = fullTextAnnotation.pages || [];
      let totalConfidence = 0;
      let confidenceCount = 0;

      pages.forEach(page => {
        page.blocks?.forEach(block => {
          if (block.confidence) {
            totalConfidence += block.confidence;
            confidenceCount++;
          }
        });
      });

      const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0.5;
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`✓ Google Vision OCR complete in ${duration}s (confidence: ${Math.round(avgConfidence * 100)}%)`);

      return {
        text: fullTextAnnotation.text,
        confidence: avgConfidence,
        pageCount: pages.length,
        method: 'google-vision',
        service: 'google-cloud-vision',
        blocks: pages.reduce((sum, p) => sum + (p.blocks?.length || 0), 0),
        words: pages.reduce((sum, p) => sum + (p.blocks?.reduce((s, b) => s + (b.paragraphs?.reduce((ss, pa) => ss + (pa.words?.length || 0), 0) || 0), 0) || 0), 0),
        duration: parseFloat(duration)
      };

    } catch (error) {
      console.error('Google Vision OCR failed:', error);
      throw new Error(`Google Vision OCR failed: ${error.message}`);
    }
  }

  /**
   * Get MIME type from file extension
   */
  getMimeType(ext) {
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.bmp': 'image/bmp',
      '.gif': 'image/gif'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * OCR multiple files (batch processing)
   */
  async performBatchOCR(filePaths, options = {}) {
    const results = [];

    for (let i = 0; i < filePaths.length; i++) {
      console.log(`\nProcessing file ${i + 1}/${filePaths.length}`);
      try {
        const result = await this.performOCR(filePaths[i], options);
        results.push({ filePath: filePaths[i], success: true, ...result });
      } catch (error) {
        console.error(`Failed to OCR ${filePaths[i]}:`, error.message);
        results.push({ filePath: filePaths[i], success: false, error: error.message });
      }
    }

    return results;
  }
}

module.exports = OCRService;
