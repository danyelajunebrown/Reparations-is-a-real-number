// Modified enhanced-document-processor.js (key sections) — integrate StorageAdapter
// Replace or merge into your existing enhanced-document-processor.js
// Note: keep the rest of your existing processing pipeline; this shows Stage 1 refactor to use storage adapter.

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const StorageAdapter = require('./storage-adapter');

class EnhancedDocumentProcessor {
  constructor(config = {}) {
    // existing init...
    this.storageRoot = config.storageRoot || './storage';
    this.ownersPath = path.join(this.storageRoot, 'owners');
    this.tempPath = path.join(this.storageRoot, 'temp');

    this.db = config.database || null;
    this.ipfsEnabled = config.ipfsEnabled || false;
    this.ipfsGateway = config.ipfsGateway || 'https://ipfs.io/ipfs/';
    this.reparationsCalculator = config.reparationsCalculator || null;
    this.generateIPFSHash = config.generateIPFSHash || false;
    this.performOCRFlag = config.performOCR || false;

    // New: initialize storage adapter
    this.storageAdapter = new StorageAdapter({ storage: { root: this.storageRoot, s3: config.s3 || {} } });

    this.stats = { totalProcessed: 0, totalBytes: 0, totalSlavesCounted: 0 };
  }

  async initializeStorage() {
    try {
      await fs.mkdir(this.storageRoot, { recursive: true });
      await fs.mkdir(this.ownersPath, { recursive: true });
      await fs.mkdir(this.tempPath, { recursive: true });
      console.log('✓ Storage initialized');
    } catch (error) {
      console.error('Storage initialization error:', error);
    }
  }

  generateDocumentId() {
    return crypto.randomBytes(12).toString('hex');
  }

  async processDocument(uploadedFile, metadata) {
    console.log(`\nProcessing: ${uploadedFile.originalname}`);
    const result = { success: false, documentId: this.generateDocumentId(), stages: {} };

    try {
      // STAGE 1: Store file (now delegated to StorageAdapter)
      result.stages.storage = await this.storageAdapter.uploadFile(uploadedFile, metadata);

      // Compute a sha256 of file content for dedupe and/or IPFS (if desired)
      try {
        const fileBuffer = await fs.readFile(uploadedFile.path);
        const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        result.stages.storage.sha256 = sha256;
      } catch (err) {
        console.warn('sha256 compute failed:', err.message);
      }

      console.log('✓ Stage 1: File stored', result.stages.storage);

      // STAGE 2: optionally generate IPFS hash (existing code)...
      if (this.generateIPFSHash && this.ipfsEnabled) {
        // existing ipfs generation code here (no change suggested)
        result.stages.ipfs = await this.generateIPFSHashForFile(result.stages.storage);
      }

      // STAGE 3: OCR (if configured)
      if (this.performOCRFlag) {
        result.stages.ocr = await this.performOCR(uploadedFile.path, metadata.documentType);
      }

      // Continue with parsing, reparations calculations, DB save...
      // Save metadata record linking storage info and ipfs hash into DB
      if (this.db && this.db.saveDocument) {
        const docRecord = {
          documentId: result.documentId,
          ownerName: metadata.ownerName,  // FIXED: Standardized on ownerName
          birthYear: metadata.birthYear,
          deathYear: metadata.deathYear,
          location: metadata.location,
          storage: result.stages.storage,
          ipfs: result.stages.ipfs || null,
          ocr: result.stages.ocr || null,
          createdAt: new Date()
        };
        await this.db.saveDocument(docRecord);
        result.stages.db = { saved: true, id: docRecord.documentId || docRecord.documentId };
      }

      result.success = true;
    } catch (error) {
      console.error('Document processing error:', error);
      result.error = error.message || String(error);
    }

    return result;
  }

  // placeholder for your existing generateIPFSHashForFile and performOCR functions
  async generateIPFSHashForFile(storageInfo) {
    // keep your existing implementation, e.g., use local file to compute IPFS hash or call ipfs API.
    return null;
  }

  async performOCR(filePath, documentType) {
    // keep your existing OCR logic (Google Vision / AWS Textract / Tesseract)
    return null;
  }
}

module.exports = EnhancedDocumentProcessor;
