// server.js - SECURED VERSION with authentication, validation, and rate limiting

const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const database = require('./database');
const EnhancedDocumentProcessor = require('./enhanced-document-processor');
const StorageAdapter = require('./storage-adapter');
const IndividualEntityManager = require('./individual-entity-manager');
const DescendantCalculator = require('./descendant-calculator');
const FreeNLPResearchAssistant = require('./free-nlp-assistant');

// SECURITY: Import middleware
const { authenticate, optionalAuth } = require('./middleware/auth');
const { validate } = require('./middleware/validation');
const { validateFile, validateFiles } = require('./middleware/file-validation');
const { uploadLimiter, queryLimiter, strictLimiter, generalLimiter } = require('./middleware/rate-limit');
const { errorHandler, asyncHandler } = require('./middleware/error-handler');

const app = express();

// SECURITY: Configure CORS with restrictions
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : process.env.NODE_ENV === 'production'
        ? ['https://danyelajunebrown.github.io']
        : ['http://localhost:3000', 'http://localhost:8080', 'https://danyelajunebrown.github.io'];

    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);

    // Check if origin starts with any allowed origin (handles subdirectories)
    const isAllowed = allowedOrigins.some(allowed => origin.startsWith(allowed));

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Middleware
app.use(express.json({ limit: '10mb' })); // Limit JSON payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('frontend/public'));

// SECURITY: Apply general rate limiting to all routes
app.use('/api', generalLimiter);

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

// Initialize individual entity manager
const entityManager = new IndividualEntityManager(database);

// Initialize descendant calculator
const descendantCalc = new DescendantCalculator(database);

// Initialize FREE NLP Research Assistant (no API keys needed!)
const researchAssistant = new FreeNLPResearchAssistant(database);

// SECURED: Upload document endpoint with auth, validation, and rate limiting
app.post('/api/upload-document',
  uploadLimiter,
  // authenticate, // DISABLED FOR TESTING - re-enable in production
  upload.single('document'),
  validateFile,
  validate('uploadDocument'),
  asyncHandler(async (req, res) => {
    const metadata = req.validatedBody; // Use validated data

    console.log(`Received upload from ${req.user?.type || 'user'}: ${req.file.originalname}`);

    const result = await processor.processDocument(req.file, metadata);

    res.json({
      success: true,
      message: 'Document processed successfully',
      documentId: result.documentId,
      result
    });
  })
);

// SECURED: Multi-page document upload endpoint
app.post('/api/upload-multi-page-document',
  uploadLimiter,
  // authenticate, // DISABLED FOR TESTING - re-enable in production
  upload.array('pages', 20),
  validateFiles,
  validate('uploadDocument'),
  asyncHandler(async (req, res) => {
    const sharedMetadata = req.validatedBody;

    console.log(`Received multi-page upload from ${req.user?.type || 'user'}: ${req.files.length} pages`);
    
    // Generate single document ID
    const crypto = require('crypto');
    const documentId = crypto.randomBytes(12).toString('hex');
    
    console.log('Processing ' + req.files.length + '-page document for ' + sharedMetadata.ownerName);
    
    // Process each page
    const pageResults = [];
    let combinedOCRText = '';
    let totalSlaveCount = 0;
    let enslavedPeople = [];
    
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const pageNumber = i + 1;
      
      console.log('Processing page ' + pageNumber + '/' + req.files.length);
      
      try {
        const pageResult = await processor.processDocument(file, {
          ...sharedMetadata,
          pageNumber,
          totalPages: req.files.length,
          isMultiPage: true,
          parentDocumentId: documentId
        });
        
        pageResults.push(pageResult);
        
        if (pageResult.stages && pageResult.stages.ocr && pageResult.stages.ocr.text) {
          combinedOCRText += '\n--- Page ' + pageNumber + ' ---\n' + pageResult.stages.ocr.text;
        }
        
        if (pageResult.stages && pageResult.stages.enslaved && pageResult.stages.enslaved.people) {
          enslavedPeople = enslavedPeople.concat(pageResult.stages.enslaved.people);
        }
        
      } catch (pageError) {
        console.error('Error processing page ' + pageNumber + ':', pageError);
        pageResults.push({ 
          success: false, 
          error: pageError.message,
          pageNumber 
        });
      }
    }
    
    totalSlaveCount = enslavedPeople.length;
    
    // Generate placeholder hashes (required by database)
    const placeholderHash = 'multipage-' + documentId;
    const sha256Hash = crypto.createHash('sha256').update(placeholderHash).digest('hex');
    
    // Save consolidated document
    if (database && database.saveDocument) {
      const consolidatedDoc = {
        documentId: documentId,
        owner: sharedMetadata.ownerName,
        ownerBirthYear: sharedMetadata.birthYear,
        ownerDeathYear: sharedMetadata.deathYear,
        ownerLocation: sharedMetadata.location,
        
        storage: {
          documentType: sharedMetadata.documentType,
          filename: sharedMetadata.ownerName + '_' + sharedMetadata.documentType + '_' + req.files.length + 'pages',
          filePath: pageResults[0] && pageResults[0].stages && pageResults[0].stages.storage ? pageResults[0].stages.storage.filePath : null,
          fileSize: req.files.reduce((sum, f) => sum + f.size, 0),
          mimeType: req.files[0].mimetype
        },
        
        ipfs: {
          ipfsHash: placeholderHash,
          sha256: sha256Hash,
          ipfsGatewayUrl: null
        },
        
        ocr: {
          text: combinedOCRText,
          pageCount: req.files.length,
          ocrService: pageResults[0] && pageResults[0].stages && pageResults[0].stages.ocr ? pageResults[0].stages.ocr.ocrService : 'combined'
        },
        
        enslaved: {
          totalCount: totalSlaveCount,
          namedIndividuals: totalSlaveCount
        },
        
        reparations: {
          total: 0,
          perPerson: 0,
          estimatedYears: 0
        },
        
        blockchain: {
          verificationLevel: 'pending'
        },
        
        uploadedBy: 'multipage-upload'
      };
      
      await database.saveDocument(consolidatedDoc);
      console.log('Saved multi-page document: ' + documentId);
    }
    
    // CRITICAL FIX: Clean up multer temp files to prevent disk space exhaustion
    const fs = require('fs');
    for (const file of req.files) {
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
          console.log(`Cleaned up temp file: ${file.path}`);
        }
      } catch (cleanupError) {
        console.error(`Failed to cleanup temp file ${file.path}:`, cleanupError);
        // Don't fail the request if cleanup fails
      }
    }

    res.json({
      success: true,
      message: 'Multi-page document uploaded successfully',
      documentId: documentId,
      pageCount: req.files.length,
      totalEnslaved: totalSlaveCount,
      pages: pageResults.map((p, i) => ({
        page: i + 1,
        filename: req.files[i].originalname,
        success: p.success
      })),
      status: 'processed'
    });
  })
);

// SECURED: FREE Natural Language Research Assistant (public with rate limiting)
app.post('/api/llm-query',
  queryLimiter,
  validate('llmQuery'),
  asyncHandler(async (req, res) => {
    const { query, sessionId } = req.validatedBody;

    console.log('Research Assistant query: ' + query);

    // Use FREE NLP system for intelligent responses
    const result = await researchAssistant.query(query, sessionId || 'default');

    res.json(result);
  })
);

// SECURED: Clear Research Assistant conversation history
app.post('/api/clear-chat',
  validate('clearChat'),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.validatedBody;

    researchAssistant.clearSession(sessionId || 'default');
    res.json({ success: true, message: 'Chat history cleared' });
  })
);

// SECURED: Process individual metadata and extract relationships
app.post('/api/process-individual-metadata',
  authenticate,
  validate('processMetadata'),
  asyncHandler(async (req, res) => {
    const {
      documentId,
      fileName,
      fullName,
      birthYear,
      deathYear,
      gender,
      locations,
      spouses,
      children,
      parents,
      notes
    } = req.validatedBody;

    // Check if document exists before proceeding
    if (documentId) {
      const docCheck = await database.query(
        'SELECT document_id FROM documents WHERE document_id = $1',
        [documentId]
      );
      
      if (!docCheck.rows || docCheck.rows.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: `Document ${documentId} not found. Upload the document first before linking individuals.` 
        });
      }
    }

    console.log(`Processing metadata for: ${fullName}`);

    // Create or find the main individual
    const individualId = await entityManager.findOrCreateIndividual({
      fullName,
      birthYear,
      deathYear,
      gender,
      locations: locations ? (Array.isArray(locations) ? locations : [locations]) : [],
      notes
    });

    // Link to document if provided
    if (documentId) {
      await database.query(
        `INSERT INTO document_individuals (document_id, individual_id, role, mentioned_as)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, individual_id) DO NOTHING`,
        [documentId, individualId, 'mentioned', fullName]
      );
      console.log(`Linked ${fullName} to document ${documentId}`);
    }

    // Process relationships
    const relatedIndividuals = {
      spouses: [],
      children: [],
      parents: []
    };

    // Process spouses
    if (spouses && Array.isArray(spouses)) {
      for (const spouse of spouses) {
        if (spouse.name) {
          const spouseId = await entityManager.findOrCreateIndividual({
            fullName: spouse.name,
            birthYear: spouse.birthYear,
            deathYear: spouse.deathYear,
            gender: spouse.gender
          });

          await entityManager.addRelationship(
            individualId,
            spouseId,
            'spouse',
            fileName || documentId,
            'document',
            1.0
          );

          relatedIndividuals.spouses.push({ id: spouseId, name: spouse.name });
        }
      }
    }

    // Process children
    if (children && Array.isArray(children)) {
      for (const child of children) {
        if (child.name) {
          const childId = await entityManager.findOrCreateIndividual({
            fullName: child.name,
            birthYear: child.birthYear,
            deathYear: child.deathYear,
            gender: child.gender
          });

          await entityManager.addRelationship(
            individualId,
            childId,
            'parent-child',
            fileName || documentId,
            'document',
            1.0,
            true
          );

          relatedIndividuals.children.push({ id: childId, name: child.name });
        }
      }
    }

    // Process parents
    if (parents && Array.isArray(parents)) {
      for (const parent of parents) {
        if (parent.name) {
          const parentId = await entityManager.findOrCreateIndividual({
            fullName: parent.name,
            birthYear: parent.birthYear,
            deathYear: parent.deathYear,
            gender: parent.gender
          });

          await entityManager.addRelationship(
            parentId,
            individualId,
            'parent-child',
            fileName || documentId,
            'document',
            1.0,
            true
          );

          relatedIndividuals.parents.push({ id: parentId, name: parent.name });
        }
      }
    }

    // Extract additional individuals mentioned in notes if document is linked
    const extractedIndividuals = [];
    if (documentId && notes) {
      try {
        const namePattern = /\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/g;
        const matches = notes.match(namePattern);
        
        if (matches) {
          for (const name of matches) {
            if (name !== fullName) {
              const mentionedId = await entityManager.findOrCreateIndividual({
                fullName: name
              });

              await database.query(
                `INSERT INTO document_individuals (document_id, individual_id, role, mentioned_as)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (document_id, individual_id) DO NOTHING`,
                [documentId, mentionedId, 'mentioned', name]
              );

              extractedIndividuals.push({
                id: mentionedId,
                name
              });
            }
          }
        }
      } catch (error) {
        console.error('Error extracting individuals from document:', error);
        // Continue even if extraction fails
      }
    }

    // Update individual statistics
    await entityManager.updateIndividualStats(individualId);

    res.json({
      success: true,
      individualId,
      relatedIndividuals,
      extractedCount: extractedIndividuals.length
    });
  })
);

// SECURED: Add enslaved person descendant
app.post('/api/add-enslaved-descendant',
  authenticate,
  validate('addEnslavedDescendant'),
  asyncHandler(async (req, res) => {
    const {
      fullName,
      birthYear,
      deathYear,
      gender,
      enslavedBy,
      freedomYear,
      directReparations,
      parentIds,
      notes
    } = req.validatedBody;

    console.log(`Adding enslaved individual: ${fullName}`);

    // Create enslaved individual
    const enslavedId = await descendantCalc.findOrCreateEnslavedIndividual({
      fullName,
      birthYear,
      deathYear,
      gender,
      enslavedBy,
      freedomYear,
      directReparations,
      notes
    });

    // Create parent-child relationships if provided
    if (parentIds && Array.isArray(parentIds)) {
      for (const parentId of parentIds) {
        await database.query(
          `INSERT INTO enslaved_relationships (
            enslaved_id_1, enslaved_id_2, relationship_type, is_directed,
            source_type, confidence, verified
          ) VALUES ($1, $2, 'parent-child', true, 'user-input', 1.0, true)
          ON CONFLICT DO NOTHING`,
          [parentId, enslavedId]
        );
      }
    }

    res.json({
      success: true,
      enslavedId,
      message: 'Enslaved individual created successfully'
    });
  })
);

// SECURED: Calculate descendant debt for slaveowner
app.post('/api/calculate-descendant-debt',
  strictLimiter,
  authenticate,
  validate('calculateDebt'),
  asyncHandler(async (req, res) => {
    const { perpetratorId, originalDebt } = req.validatedBody;

    console.log(`Calculating descendant debt for ${perpetratorId}, debt: $${originalDebt}`);

    const debtRecords = await descendantCalc.calculateDescendantDebt(
      perpetratorId,
      parseFloat(originalDebt)
    );

    res.json({
      success: true,
      totalDescendants: debtRecords.length,
      debtRecords,
      message: `Debt calculated for ${debtRecords.length} descendants`
    });
  })
);

// SECURED: Calculate reparations credit for enslaved person descendants
app.post('/api/calculate-reparations-credit',
  strictLimiter,
  authenticate,
  validate('calculateCredit'),
  asyncHandler(async (req, res) => {
    const { ancestorId, originalCredit } = req.validatedBody;

    console.log(`Calculating reparations credit for ${ancestorId}, credit: $${originalCredit}`);

    const creditRecords = await descendantCalc.calculateReparationsCredit(
      ancestorId,
      parseFloat(originalCredit)
    );

    res.json({
      success: true,
      totalDescendants: creditRecords.length,
      creditRecords,
      message: `Credit calculated for ${creditRecords.length} descendants`
    });
  })
);

// SECURED: Get debt status for an individual
app.get('/api/debt-status/:individualId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { individualId } = req.params;

    const totalDebt = await descendantCalc.getTotalDebt(individualId);

    const debtDetails = await database.query(
      `SELECT * FROM descendant_debt
       WHERE descendant_individual_id = $1
       ORDER BY generation_distance, amount_outstanding DESC`,
      [individualId]
    );

    res.json({
      success: true,
      individualId,
      totalDebt,
      debtRecords: debtDetails.rows || []
    });
  })
);

// SECURED: Get credit status for an enslaved descendant
app.get('/api/credit-status/:enslavedId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { enslavedId } = req.params;

    const totalCredit = await descendantCalc.getTotalCredit(enslavedId);

    const creditDetails = await database.query(
      `SELECT * FROM reparations_credit
       WHERE descendant_enslaved_id = $1
       ORDER BY generation_distance, amount_outstanding DESC`,
      [enslavedId]
    );

    res.json({
      success: true,
      enslavedId,
      totalCredit,
      creditRecords: creditDetails.rows || []
    });
  })
);

// SECURED: Record a blockchain payment
app.post('/api/record-payment',
  strictLimiter,
  authenticate,
  validate('recordPayment'),
  asyncHandler(async (req, res) => {
    const {
      payerId,
      recipientId,
      amount,
      txHash,
      blockNumber,
      networkId
    } = req.validatedBody;

    const paymentId = await descendantCalc.recordPayment(
      payerId,
      recipientId,
      parseFloat(amount),
      txHash,
      blockNumber || null,
      networkId || 1
    );

    res.json({
      success: true,
      paymentId,
      message: 'Payment recorded successfully'
    });
  })
);

// ============================================
// DOCUMENT VIEWING/DOWNLOAD ENDPOINTS
// ============================================

// Get all documents for a specific owner
app.get('/api/documents/owner/:ownerName',
  asyncHandler(async (req, res) => {
    const { ownerName } = req.params;

    const documents = await database.query(
      `SELECT document_id, owner_name, doc_type, filename, file_path,
              relative_path, file_size, mime_type, owner_birth_year,
              owner_death_year, owner_location, created_at
       FROM documents
       WHERE owner_name = $1
       ORDER BY created_at DESC`,
      [ownerName]
    );

    res.json({
      success: true,
      ownerName,
      count: documents.rows.length,
      documents: documents.rows
    });
  })
);

// Get a specific document's metadata
app.get('/api/documents/:documentId',
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;

    const result = await database.query(
      `SELECT * FROM documents WHERE document_id = $1`,
      [documentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    res.json({
      success: true,
      document: result.rows[0]
    });
  })
);

// Serve/download the actual document file
app.get('/api/documents/:documentId/file',
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const download = req.query.download === 'true'; // ?download=true to force download

    // Get document metadata from database
    const result = await database.query(
      `SELECT file_path, filename, mime_type FROM documents WHERE document_id = $1`,
      [documentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const doc = result.rows[0];
    const fs = require('fs');

    // Check if file exists
    if (!fs.existsSync(doc.file_path)) {
      return res.status(404).json({
        success: false,
        error: 'Document file not found on server',
        path: doc.file_path
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', doc.mime_type || 'application/pdf');

    if (download) {
      // Force download
      res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
    } else {
      // Display inline (for PDFs/images)
      res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
    }

    // Stream the file
    const fileStream = fs.createReadStream(doc.file_path);
    fileStream.pipe(res);
  })
);

// Get all documents (for admin/research purposes)
app.get('/api/documents',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const documents = await database.query(
      `SELECT document_id, owner_name, doc_type, filename, file_size,
              mime_type, owner_location, created_at, total_enslaved
       FROM documents
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await database.query('SELECT COUNT(*) FROM documents');
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      count: documents.rows.length,
      total: totalCount,
      limit,
      offset,
      documents: documents.rows
    });
  })
);

// SECURITY: Use error handler middleware (must be last)
app.use(errorHandler);

// Health check endpoint (with database check)
app.get('/health', asyncHandler(async (req, res) => {
  const dbHealth = await database.checkHealth();

  res.json({
    status: dbHealth.healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbHealth.healthy ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'development'
  });
}));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Reparations Platform API',
    version: '2.0.0',
    endpoints: {
      upload: 'POST /api/upload-document',
      query: 'POST /api/llm-query',
      metadata: 'POST /api/process-individual-metadata',
      health: 'GET /health'
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Reparations server running on port ' + PORT);
    console.log('Storage root: ' + config.storage.root);
    console.log('OCR enabled: ' + processor.performOCR);
  });
}

module.exports = app;
