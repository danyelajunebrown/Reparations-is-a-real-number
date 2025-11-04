// server.js - Complete corrected version

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

// Upload document endpoint
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

// Simple database query endpoint - NO LLM, NO API KEYS
app.post('/api/llm-query', async (req, res) => {
  const { query } = req.body;
  
  try {
    const lower = query.toLowerCase();
    let response = '';
    let evidence = null;
    
    // Direct database queries based on keywords
    if (lower.includes('hopewell') || lower.includes('james')) {
      const ownerData = await database.query(`
        SELECT d.*, 
               json_agg(json_build_object(
                 'name', ep.name,
                 'gender', ep.gender,
                 'family_relationship', ep.family_relationship,
                 'bequeathed_to', ep.bequeathed_to
               )) as enslaved_people
        FROM documents d
        LEFT JOIN enslaved_people ep ON d.document_id = ep.document_id
        WHERE d.owner_name ILIKE '%Hopewell%'
        GROUP BY d.document_id
      `);
      
      if (ownerData.rows && ownerData.rows.length > 0) {
        const owner = ownerData.rows[0];
        response = `${owner.owner_name}\n${owner.owner_location}\nDied: ${owner.owner_death_year}\n${owner.total_enslaved} enslaved\n$${(owner.total_reparations / 1000000).toFixed(1)}M reparations`;
        evidence = { type: 'owner_profile', data: owner };
      } else {
        response = 'No records found for Hopewell';
      }
      
    } else if (lower.includes('minna')) {
      const personData = await database.query(`
        SELECT ep.*, d.owner_name, d.doc_type
        FROM enslaved_people ep
        JOIN documents d ON ep.document_id = d.document_id
        WHERE ep.name ILIKE '%Minna%'
      `);
      
      if (personData.rows && personData.rows.length > 0) {
        const person = personData.rows[0];
        response = `${person.name}\nOwner: ${person.owner_name}\n${person.family_relationship}\nBequeathed to: ${person.bequeathed_to}`;
        evidence = { type: 'person_detail', data: person };
      } else {
        response = 'No records found for Minna';
      }
      
    } else if (lower.includes('stats') || lower.includes('how many') || lower.includes('total')) {
      const stats = await database.getStats();
      response = `Database Stats:\nDocuments: ${stats.total_documents}\nOwners: ${stats.unique_owners}\nEnslaved: ${stats.total_enslaved_counted}\nTotal Reparations: $${(stats.total_reparations_calculated / 1000000).toFixed(1)}M`;
      evidence = { type: 'statistics', data: stats };
      
    } else {
      response = 'Try asking about:\n- "James Hopewell"\n- "Minna"\n- "statistics"';
    }
    
    res.json({ success: true, response, evidence });
    
  } catch (error) {
    console.error('Query error:', error);
    res.json({ success: false, error: error.message });
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

// Health check endpoint
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
      query: 'POST /api/llm-query',
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
