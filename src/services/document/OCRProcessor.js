const vision = require('@google-cloud/vision');
const Tesseract = require('tesseract.js');
const axios = require('axios');
const logger = require('../../utils/logger');
const FileTypeDetector = require('./FileTypeDetector');
const CursiveOCREnhancer = require('./CursiveOCREnhancer');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

class OCRProcessor {
  constructor() {
    const config = require('../../../config');

    // Store API key for REST API calls (simpler auth method)
    this.googleVisionApiKey = config.apiKeys.googleVision;

    // Configure Google Vision client with multiple auth options
    let visionConfig = {};
    let useClientLibrary = false;

    // Option 1: Credentials passed as JSON string in environment variable (for Render)
    if (config.apiKeys.googleVisionCredentials) {
      try {
        const credentials = JSON.parse(config.apiKeys.googleVisionCredentials);
        visionConfig = { credentials };
        useClientLibrary = true;
        logger.info('Google Vision: Using credentials from environment variable');
      } catch (e) {
        logger.error('Failed to parse GOOGLE_VISION_CREDENTIALS', { error: e.message });
      }
    }
    // Option 2: Credentials file path
    else if (config.apiKeys.googleVisionKeyPath) {
      const keyPath = path.resolve(config.apiKeys.googleVisionKeyPath);
      if (fs.existsSync(keyPath)) {
        // Check if it's a valid credentials file (not placeholder)
        try {
          const creds = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
          if (creds.project_id && creds.project_id !== 'your-project-id') {
            visionConfig = { keyFilename: keyPath };
            useClientLibrary = true;
            logger.info('Google Vision: Using credentials file', { path: keyPath });
          } else {
            logger.warn('Google Vision credentials file has placeholder values');
          }
        } catch (e) {
          logger.warn('Google Vision credentials file invalid', { error: e.message });
        }
      } else {
        logger.warn('Google Vision credentials file not found', { path: keyPath });
      }
    }

    // Create client library (for service account auth)
    if (useClientLibrary) {
      try {
        this.googleVisionClient = new vision.ImageAnnotatorClient(visionConfig);
        this.googleVisionAvailable = true;
        this.useRestApi = false;
        logger.info('Google Vision client initialized successfully (service account)');
      } catch (error) {
        logger.error('Failed to initialize Google Vision client', { error: error.message });
        this.googleVisionClient = null;
        this.googleVisionAvailable = false;
      }
    }
    // Option 3: Use API key with REST API (simpler, no service account needed)
    else if (this.googleVisionApiKey) {
      this.googleVisionAvailable = true;
      this.useRestApi = true;
      this.googleVisionClient = null;
      logger.info('Google Vision: Using API key with REST API');
    } else {
      this.googleVisionClient = null;
      this.googleVisionAvailable = false;
      this.useRestApi = false;
      logger.info('Google Vision: Not configured, will use Tesseract fallback');
    }

    this.fileTypeDetector = new FileTypeDetector();

    // Initialize cursive OCR enhancer for handwritten document improvement
    this.cursiveEnhancer = null; // Will be initialized with database if available
  }

  /**
   * Initialize the cursive OCR enhancer with database connection
   * This enables learning from previous corrections
   * @param {Object} db - Database connection pool
   */
  initializeCursiveEnhancer(db) {
    this.cursiveEnhancer = new CursiveOCREnhancer(db);
    logger.info('Cursive OCR Enhancer initialized with database connection');
  }

  /**
   * Determine the best OCR method based on file type
   * @param {Object} file - File to process
   * @param {Object} options - Processing options
   * @param {number[]} options.pages - Specific page numbers to process (1-indexed)
   * @param {number} options.startPage - Start page (1-indexed, default 1)
   * @param {number} options.endPage - End page (1-indexed, default all)
   * @param {boolean} options.skipCoverPages - Skip first N pages that look like covers
   * @returns {Promise<Object>} OCR results
   */
  async process(file, options = {}) {
    try {
      // Detect file type
      const detectedType = await this.fileTypeDetector.detect(file.buffer);
      logger.info('OCR: Detected file type', { mime: detectedType.mime, ext: detectedType.ext });

      // Validate file type is processable
      if (!this.isProcessableType(detectedType.mime)) {
        throw new Error(`Unsupported file type for OCR: ${detectedType.mime}`);
      }

      // For PDFs, use multi-page processing
      if (detectedType.mime === 'application/pdf') {
        logger.info('OCR: Processing multi-page PDF', { options });
        return await this.processMultiPagePDF(file, options);
      }

      // Try Google Vision first (if available via client library or REST API)
      if (this.googleVisionAvailable && (this.googleVisionClient || this.useRestApi)) {
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
   * Process multi-page PDF with page selection support
   * @param {Object} file - PDF file to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Combined OCR results from all pages
   */
  async processMultiPagePDF(file, options = {}) {
    const pdfParse = require('pdf-parse');

    try {
      // First, try to extract text directly (works for text-based PDFs)
      const pdfData = await pdfParse(file.buffer);
      const totalPages = pdfData.numpages;

      logger.info('PDF: Analyzing document', {
        totalPages,
        hasText: pdfData.text?.trim().length > 0,
        textLength: pdfData.text?.length || 0
      });

      // Determine which pages to process
      let pagesToProcess = [];
      if (options.pages && options.pages.length > 0) {
        // Specific pages requested
        pagesToProcess = options.pages.filter(p => p >= 1 && p <= totalPages);
      } else {
        // Use start/end range
        const startPage = options.startPage || 1;
        const endPage = options.endPage || totalPages;
        for (let i = startPage; i <= Math.min(endPage, totalPages); i++) {
          pagesToProcess.push(i);
        }
      }

      // Skip cover pages if requested (skip pages that look like covers/TOC)
      if (options.skipCoverPages && pagesToProcess.length > 2) {
        // Default: skip first 2 pages for archival documents
        const skipCount = typeof options.skipCoverPages === 'number' ? options.skipCoverPages : 2;
        pagesToProcess = pagesToProcess.slice(skipCount);
        logger.info('PDF: Skipping cover pages', { skipCount, remainingPages: pagesToProcess.length });
      }

      logger.info('PDF: Pages to process', { pagesToProcess, totalPages, options });

      // If PDF has extractable text, we still need to respect page selection
      if (pdfData.text && pdfData.text.trim().length > 100) {
        logger.info('PDF: Text-based PDF detected');

        // Check if page selection is requested
        const needsPageFilter = (options.startPage && options.startPage > 1) ||
                               options.endPage ||
                               (options.pages && options.pages.length > 0);

        if (needsPageFilter) {
          // Extract only selected pages using pdf-lib
          logger.info('PDF: Page selection requested, extracting specific pages', { pagesToProcess });

          try {
            const pdfDoc = await PDFDocument.load(file.buffer);
            const selectedPagesDoc = await PDFDocument.create();

            // Copy only the selected pages
            for (const pageNum of pagesToProcess) {
              if (pageNum <= pdfDoc.getPageCount()) {
                const [copiedPage] = await selectedPagesDoc.copyPages(pdfDoc, [pageNum - 1]); // 0-indexed
                selectedPagesDoc.addPage(copiedPage);
              }
            }

            const selectedPagesBuffer = await selectedPagesDoc.save();

            // Parse text from selected pages only
            const selectedPdfData = await pdfParse(Buffer.from(selectedPagesBuffer));

            logger.info('PDF: Extracted text from selected pages', {
              selectedPages: pagesToProcess.length,
              textLength: selectedPdfData.text?.length || 0
            });

            return {
              text: selectedPdfData.text,
              confidence: 0.9,
              service: 'pdf-parse-filtered',
              pageCount: totalPages,
              pagesProcessed: pagesToProcess,
              raw: { info: selectedPdfData.info, totalPages, selectedPages: pagesToProcess }
            };
          } catch (pageFilterError) {
            logger.error('PDF: Failed to filter pages, falling back to full text', { error: pageFilterError.message });
            // Fall through to return full text
          }
        }

        // No page selection or page filter failed - return full text
        logger.info('PDF: Using full text extraction');
        return {
          text: pdfData.text,
          confidence: 0.9,
          service: 'pdf-parse',
          pageCount: totalPages,
          pagesProcessed: Array.from({ length: totalPages }, (_, i) => i + 1),
          raw: { info: pdfData.info }
        };
      }

      // Scanned PDF - need OCR on each page
      logger.info('PDF: Document appears to be scanned, using page-by-page OCR');

      // Load PDF with pdf-lib to extract pages
      const pdfDoc = await PDFDocument.load(file.buffer);
      const allResults = [];
      let combinedText = '';
      let totalConfidence = 0;

      for (const pageNum of pagesToProcess) {
        try {
          logger.info(`PDF: Processing page ${pageNum}/${totalPages}`);

          // Extract single page as new PDF
          const singlePagePdf = await PDFDocument.create();
          const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [pageNum - 1]); // 0-indexed
          singlePagePdf.addPage(copiedPage);
          const singlePageBuffer = await singlePagePdf.save();

          // Convert PDF page to image for OCR
          // Note: This requires an external tool or service
          // For now, we'll try Google Vision on the PDF directly

          const pageFile = {
            buffer: Buffer.from(singlePageBuffer),
            originalname: `page_${pageNum}.pdf`,
            mimetype: 'application/pdf'
          };

          let pageResult;
          if (this.googleVisionAvailable && this.googleVisionClient) {
            pageResult = await this.processWithGoogleVision(pageFile);
          } else {
            // Try to convert PDF page to image for Tesseract
            logger.info(`PDF: Google Vision not available, attempting PDF to image conversion for Tesseract`);
            try {
              const imageBuffer = await this.convertPdfPageToImage(Buffer.from(singlePageBuffer));
              if (imageBuffer) {
                const imageFile = {
                  buffer: imageBuffer,
                  originalname: `page_${pageNum}.png`,
                  mimetype: 'image/png'
                };
                pageResult = await this.processWithTesseract(imageFile);
              } else {
                logger.warn(`PDF: Could not convert page ${pageNum} to image`);
                continue;
              }
            } catch (conversionError) {
              logger.warn(`PDF: Page ${pageNum} conversion failed: ${conversionError.message}`);
              continue;
            }
          }

          if (pageResult.text && pageResult.text.trim().length > 0) {
            allResults.push({
              page: pageNum,
              text: pageResult.text,
              confidence: pageResult.confidence
            });
            combinedText += `\n--- Page ${pageNum} ---\n${pageResult.text}\n`;
            totalConfidence += pageResult.confidence;
          }
        } catch (pageError) {
          logger.error(`PDF: Failed to process page ${pageNum}`, { error: pageError.message });
        }
      }

      const avgConfidence = allResults.length > 0 ? totalConfidence / allResults.length : 0;

      return {
        text: combinedText,
        confidence: avgConfidence,
        service: 'google-vision-multipage',
        pageCount: totalPages,
        pagesProcessed: allResults.map(r => r.page),
        pageResults: allResults,
        raw: { pageCount: totalPages }
      };

    } catch (error) {
      logger.error('PDF: Multi-page processing failed', { error: error.message });

      // Fall back to single-page processing
      return await this.processWithTesseract(file);
    }
  }

  /**
   * Get PDF page count without full processing
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<number>} Number of pages
   */
  async getPDFPageCount(pdfBuffer) {
    try {
      const pdfParse = require('pdf-parse');
      const pdfData = await pdfParse(pdfBuffer, { max: 0 }); // Don't extract text, just metadata
      return pdfData.numpages;
    } catch (error) {
      logger.error('Failed to get PDF page count', { error: error.message });
      return 0;
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
   * Supports both client library (service account) and REST API (API key)
   * @param {Object} file - File to process
   * @returns {Promise<Object>} OCR results
   */
  async processWithGoogleVision(file) {
    // Use REST API if we have an API key but no client library
    if (this.useRestApi && this.googleVisionApiKey) {
      return this.processWithGoogleVisionRestApi(file);
    }

    // Use client library (service account auth)
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
   * Process document with Google Vision REST API (using API key)
   * This is simpler than service account auth and works for most use cases
   * @param {Object} file - File to process
   * @returns {Promise<Object>} OCR results
   */
  async processWithGoogleVisionRestApi(file) {
    try {
      // Convert image buffer to base64
      const base64Image = file.buffer.toString('base64');

      // Call Vision API REST endpoint
      const response = await axios.post(
        `https://vision.googleapis.com/v1/images:annotate?key=${this.googleVisionApiKey}`,
        {
          requests: [{
            image: { content: base64Image },
            features: [
              { type: 'DOCUMENT_TEXT_DETECTION' }, // Better for handwriting
              { type: 'TEXT_DETECTION' }
            ]
          }]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 120000, // 2 minutes for large images
          maxContentLength: 50 * 1024 * 1024, // 50MB max
          maxBodyLength: 50 * 1024 * 1024
        }
      );

      const result = response.data.responses[0];

      // Check for errors
      if (result.error) {
        throw new Error(result.error.message);
      }

      // Extract text - prefer fullTextAnnotation (DOCUMENT_TEXT_DETECTION) for handwriting
      const fullText = result.fullTextAnnotation?.text || result.textAnnotations?.[0]?.description || '';
      const pages = result.fullTextAnnotation?.pages || [];

      // Calculate confidence from pages
      let confidence = 0.85; // Default confidence for Vision API
      if (pages.length > 0) {
        const blockConfidences = [];
        for (const page of pages) {
          for (const block of (page.blocks || [])) {
            if (block.confidence) {
              blockConfidences.push(block.confidence);
            }
          }
        }
        if (blockConfidences.length > 0) {
          confidence = blockConfidences.reduce((a, b) => a + b, 0) / blockConfidences.length;
        }
      }

      logger.operation('Google Vision REST API OCR Completed', {
        filename: file.originalname,
        confidence: confidence.toFixed(2),
        textLength: fullText.length
      });

      return {
        text: fullText,
        confidence,
        service: 'google-vision-rest',
        pageCount: pages.length || 1,
        raw: result
      };

    } catch (error) {
      logger.error('Google Vision REST API OCR Failed', {
        error: error.message,
        filename: file.originalname
      });
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

  /**
   * Enhance OCR results using cursive letter reference and learned corrections
   * This improves accuracy for handwritten historical documents
   * @param {Object} ocrResults - Raw OCR results
   * @param {Object} options - Enhancement options
   * @returns {Promise<Object>} Enhanced OCR results
   */
  async enhanceWithCursiveReference(ocrResults, options = {}) {
    // Skip if no enhancer or if disabled
    if (!this.cursiveEnhancer || options.skipEnhancement) {
      return ocrResults;
    }

    // Skip enhancement for high-confidence results (likely typed/printed documents)
    if (ocrResults.confidence > 0.95 && !options.forceEnhancement) {
      logger.info('OCR: Skipping cursive enhancement for high-confidence result');
      return ocrResults;
    }

    try {
      logger.info('OCR: Applying cursive enhancement', {
        originalConfidence: ocrResults.confidence,
        textLength: ocrResults.text?.length || 0
      });

      const enhanced = await this.cursiveEnhancer.enhance(
        ocrResults.text,
        ocrResults.confidence,
        options
      );

      logger.info('OCR: Cursive enhancement complete', {
        corrections: enhanced.correctionCount,
        newConfidence: enhanced.confidence
      });

      return {
        ...ocrResults,
        text: enhanced.text,
        originalText: enhanced.originalText,
        confidence: enhanced.confidence,
        cursiveCorrections: enhanced.corrections,
        correctionCount: enhanced.correctionCount,
        enhanced: enhanced.enhancementApplied
      };

    } catch (error) {
      logger.warn('OCR: Cursive enhancement failed, using raw results', {
        error: error.message
      });
      return ocrResults;
    }
  }

  /**
   * Process with enhancement (convenience method)
   * @param {Object} file - File to process
   * @param {Object} options - Processing options including enhancement settings
   * @returns {Promise<Object>} Enhanced OCR results
   */
  async processWithEnhancement(file, options = {}) {
    // First, get raw OCR results
    const rawResults = await this.process(file, options);

    // Then apply cursive enhancement
    return this.enhanceWithCursiveReference(rawResults, options);
  }

  /**
   * Convert a single-page PDF to an image buffer for OCR
   * Uses pdf.js for rendering if available, otherwise tries to extract embedded images
   * @param {Buffer} pdfBuffer - Single page PDF buffer
   * @returns {Promise<Buffer|null>} PNG image buffer or null if conversion failed
   */
  async convertPdfPageToImage(pdfBuffer) {
    try {
      // Try using pdf.js (pdfjs-dist) for rendering
      let pdfjsLib;
      try {
        pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      } catch (e) {
        logger.info('pdfjs-dist not available, trying alternative methods');
      }

      if (pdfjsLib) {
        // Use pdf.js to render PDF to canvas
        const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        // Set up canvas for rendering
        const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for better OCR quality

        // Create a canvas using sharp or node-canvas
        // Since we don't have node-canvas, we'll try a different approach
        logger.info('PDF.js loaded, but canvas rendering requires node-canvas');
      }

      // Alternative: Try to extract embedded images from the PDF using sharp
      // Many scanned PDFs are just images embedded in PDF wrapper
      try {
        // Check if the PDF contains raw image data we can extract
        const pdfString = pdfBuffer.toString('binary');

        // Look for JPEG markers
        const jpegStart = pdfString.indexOf('\xFF\xD8\xFF');
        if (jpegStart !== -1) {
          // Find the end of JPEG
          let jpegEnd = pdfString.indexOf('\xFF\xD9', jpegStart);
          if (jpegEnd !== -1) {
            jpegEnd += 2; // Include the end marker
            const jpegData = Buffer.from(pdfString.slice(jpegStart, jpegEnd), 'binary');

            // Validate and convert with sharp
            const imageBuffer = await sharp(jpegData)
              .png()
              .toBuffer();

            logger.info('Successfully extracted embedded JPEG from PDF', {
              originalSize: jpegData.length,
              pngSize: imageBuffer.length
            });
            return imageBuffer;
          }
        }

        // Look for PNG markers
        const pngStart = pdfString.indexOf('\x89PNG');
        if (pngStart !== -1) {
          // Find PNG end marker (IEND)
          const pngEnd = pdfString.indexOf('IEND', pngStart);
          if (pngEnd !== -1) {
            const pngData = Buffer.from(pdfString.slice(pngStart, pngEnd + 8), 'binary');

            logger.info('Successfully extracted embedded PNG from PDF', { size: pngData.length });
            return pngData;
          }
        }

        logger.info('No embedded images found in PDF using simple extraction');
      } catch (extractError) {
        logger.warn('Image extraction from PDF failed', { error: extractError.message });
      }

      // Last resort: Try to use Puppeteer/Playwright to render the PDF
      // This is slower but more reliable for complex PDFs
      try {
        const puppeteer = require('puppeteer');

        logger.info('Attempting PDF rendering via Puppeteer');
        const browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
          const page = await browser.newPage();

          // Create a data URL from the PDF
          const pdfBase64 = pdfBuffer.toString('base64');
          const dataUrl = `data:application/pdf;base64,${pdfBase64}`;

          // Navigate to PDF viewer
          await page.goto(`https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(dataUrl)}`, {
            waitUntil: 'networkidle0',
            timeout: 30000
          });

          // Wait for PDF to render
          await new Promise(r => setTimeout(r, 3000));

          // Take screenshot of the PDF viewer
          const screenshot = await page.screenshot({
            fullPage: false,
            type: 'png'
          });

          logger.info('Successfully rendered PDF via Puppeteer', { screenshotSize: screenshot.length });
          return screenshot;
        } finally {
          await browser.close();
        }
      } catch (puppeteerError) {
        logger.warn('Puppeteer PDF rendering failed', { error: puppeteerError.message });
      }

      logger.warn('All PDF to image conversion methods failed');
      return null;

    } catch (error) {
      logger.error('PDF to image conversion failed', { error: error.message });
      return null;
    }
  }
}

module.exports = OCRProcessor;
