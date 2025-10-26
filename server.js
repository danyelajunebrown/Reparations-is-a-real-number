// Snippet changes for server.js — initialize StorageAdapter and pass s3 config into EnhancedDocumentProcessor
// Merge into your server.js. Assumes config.js exports storage.s3.*.

const express = require('express');
const multer = require('multer');
const path = require('path');
const config = require('./config');
const database = require('./database');
const EnhancedDocumentProcessor = require('./enhanced-document-processor');
const StorageAdapter = require('./storage-adapter');

const app = express();
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
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = app;
