// Snippet changes for server.js â€” initialize StorageAdapter and pass s3 config into EnhancedDocumentProcessor
// Merge into your server.js. Assumes config.js exports storage.s3.*.

const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const database = require('./database');
const EnhancedDocumentProcessor = require('./enhanced-document-processor');
const StorageAdapter = require('./storage-adapter');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('frontend/public'));

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 }
});

// initialize shared storage adapter (used by processor)
const storageAdapter = new StorageAdapter({ storage: { root: config.storage.root, s3: config.storage.s3 } });

const processor = new EnhancedDocumentProcessor({
  googleVisionApiKey: config.googleVisionApiKey,
  storageRoot: config.storage.root,
  s3: config.storage.s3,
  database: database,
  ipfsEnabled: config.ipfs.enabled,
  ipfsGateway: config.ipfs.gateway,
  generateIPFSHash: true,
  performOCR: true
});

// example upload route unchanged, processor.processDocument will use storage adapter internally
app.post('/api/upload-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    console.log(`Received upload: ${req.file.originalname}`);
    const metadata = {
      ownerName: req.body.ownerName,
      documentType: req.body.documentType,
      birthYear: parseInt(req.body.birthYear) || null,
      deathYear: parseInt(req.body.deathYear) || null,
      location: req.body.location || null
    };

    const result = await processor.processDocument(req.file, metadata);

    res.json({ success: true, message: 'Document processed successfully', result });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: error.message, error: error.stack });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Reparations Platform API',
    version: '2.0.0',
    endpoints: {
      upload: 'POST /api/upload-document',
      health: 'GET /health'
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Reparations server running on port ${PORT}`);
    console.log(`📁 Storage root: ${config.storage.root}`);
    console.log(`🔍 OCR enabled: ${processor.performOCR}`);
  });
}

module.exports = app;
