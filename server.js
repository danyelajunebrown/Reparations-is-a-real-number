// server.js - Complete corrected version

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

// Initialize individual entity manager
const entityManager = new IndividualEntityManager(database);

// Initialize descendant calculator
const descendantCalc = new DescendantCalculator(database);

// Initialize FREE NLP Research Assistant (no API keys needed!)
const researchAssistant = new FreeNLPResearchAssistant(database);

// Upload document endpoint
app.post('/api/upload-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Multi-page document upload endpoint
app.post('/api/upload-multi-page-document', upload.array('pages', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }
    
    console.log('Received multi-page upload: ' + req.files.length + ' pages');
    
    // Extract shared metadata
    const sharedMetadata = {
      ownerName: req.body.ownerName,
      documentType: req.body.documentType,
      birthYear: parseInt(req.body.birthYear) || null,
      deathYear: parseInt(req.body.deathYear) || null,
      location: req.body.location || null
    };
    
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
        
      } catch (pageError) {
        console.error('Error processing page ' + pageNumber + ':', pageError);
        pageResults.push({ 
          success: false, 
          error: pageError.message,
          pageNumber 
        });
      }
    }
    
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
          fileSize: req.files.reduce((sum, f) => sum + f.size, 0)
        },
        
        ocr: {
          text: combinedOCRText,
          pageCount: req.files.length
        },
        
        enslaved: {
          totalCount: totalSlaveCount
        },
        
        reparations: {
          total: 0
        },
        
        createdAt: new Date()
      };
      
      await database.saveDocument(consolidatedDoc);
      console.log('Saved multi-page document: ' + documentId);
    }
    
    res.json({ 
      success: true, 
      message: 'Multi-page document uploaded successfully',
      documentId: documentId,
      pageCount: req.files.length,
      pages: pageResults.map((p, i) => ({
        page: i + 1,
        filename: req.files[i].originalname,
        success: p.success
      })),
      status: 'processed'
    });
    
  } catch (error) {
    console.error('Multi-page upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message, 
      error: error.stack 
    });
  }
});
    
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

// FREE Natural Language Research Assistant (no API keys needed!)
app.post('/api/llm-query', async (req, res) => {
  const { query, sessionId } = req.body;
  
  if (!query) {
    return res.status(400).json({ success: false, error: 'Query is required' });
  }
  
  try {
    console.log('Research Assistant query: ' + query);
    
    // Use FREE NLP system for intelligent responses
    const result = await researchAssistant.query(query, sessionId || 'default');
    
    res.json(result);
    
  } catch (error) {
    console.error('Research Assistant error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

// Clear Research Assistant conversation history
app.post('/api/clear-chat', async (req, res) => {
  const { sessionId } = req.body;
  try {
    researchAssistant.clearSession(sessionId || 'default');
    res.json({ success: true, message: 'Chat history cleared' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Process individual metadata and extract relationships
app.post('/api/process-individual-metadata', async (req, res) => {
  try {
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
    } = req.body;

    if (!fullName) {
      return res.status(400).json({ success: false, error: 'Full name is required' });
    }

    console.log(`Processing individual metadata: ${fullName}`);

    // Parse comma-separated lists
    const spousesList = spouses ? spouses.split(',').map(s => s.trim()).filter(s => s) : [];
    const childrenList = children ? children.split(',').map(s => s.trim()).filter(s => s) : [];
    const parentsList = parents ? parents.split(',').map(s => s.trim()).filter(s => s) : [];

    // Create or update the main individual
    const individualId = await entityManager.findOrCreateIndividual({
      fullName,
      birthYear,
      deathYear,
      gender,
      locations,
      notes
    });

    console.log(`Individual created/found: ${individualId}`);

    // Link this individual to the document as the owner
    if (documentId && documentId !== 'N/A') {
      // First verify the document exists
      const docExists = await database.query(
        'SELECT document_id FROM documents WHERE document_id = $1',
        [documentId]
      );
      
      if (docExists.rows && docExists.rows.length > 0) {
        await entityManager.linkIndividualToDocument(individualId, documentId, 'owner');
        console.log('Linked ' + fullName + ' to document ' + documentId);
      } else {
        console.warn('Document ' + documentId + ' not found in database - skipping link');
      }
    }

    // Create or find related individuals and establish relationships
    const relatedIndividuals = [];

    // Process spouses
    for (const spouseName of spousesList) {
      const spouseId = await entityManager.findOrCreateIndividual({
        fullName: spouseName
      });
      await entityManager.createRelationship(individualId, spouseId, 'spouse', {
        isDirected: false,
        sourceType: 'user-input',
        confidence: 1.0,
        verified: true
      });
      relatedIndividuals.push({ name: spouseName, relationship: 'spouse', id: spouseId });
    }

    // Process children
    for (const childName of childrenList) {
      const childId = await entityManager.findOrCreateIndividual({
        fullName: childName
      });
      await entityManager.createRelationship(individualId, childId, 'parent-child', {
        isDirected: true,
        sourceType: 'user-input',
        confidence: 1.0,
        verified: true
      });
      relatedIndividuals.push({ name: childName, relationship: 'child', id: childId });
    }

    // Process parents
    for (const parentName of parentsList) {
      const parentId = await entityManager.findOrCreateIndividual({
        fullName: parentName
      });
      await entityManager.createRelationship(parentId, individualId, 'parent-child', {
        isDirected: true,
        sourceType: 'user-input',
        confidence: 1.0,
        verified: true
      });
      relatedIndividuals.push({ name: parentName, relationship: 'parent', id: parentId });
    }

    // Background: Extract additional individuals from document OCR text
    let extractedIndividuals = [];
    if (documentId && documentId !== 'N/A') {
      try {
        // Get document OCR text
        const docResult = await database.query(
          `SELECT ocr_text, doc_type FROM documents WHERE document_id = $1`,
          [documentId]
        );

        if (docResult.rows && docResult.rows.length > 0) {
          const { ocr_text, doc_type } = docResult.rows[0];

          if (ocr_text) {
            // Extract related individuals from OCR
            extractedIndividuals = await entityManager.extractRelatedIndividuals(
              ocr_text,
              doc_type,
              documentId
            );

            console.log(`Extracted ${extractedIndividuals.length} individuals from document`);

            // Create individuals and relationships for extracted names
            for (const extracted of extractedIndividuals) {
              const extractedId = await entityManager.findOrCreateIndividual({
                fullName: extracted.name
              });

              // Link to document
              await entityManager.linkIndividualToDocument(
                extractedId,
                documentId,
                extracted.role
              );

              // Create relationship with main owner
              let relationshipType = 'associated';
              if (extracted.role === 'heir') {
                relationshipType = 'parent-child'; // Heirs are typically children
              } else if (extracted.role === 'neighbor') {
                relationshipType = 'neighbor';
              }

              await entityManager.createRelationship(individualId, extractedId, relationshipType, {
                isDirected: extracted.role === 'heir',
                sourceDocumentId: documentId,
                sourceType: doc_type,
                confidence: extracted.confidence,
                verified: false
              });

              relatedIndividuals.push({
                name: extracted.name,
                relationship: extracted.role,
                id: extractedId,
                confidence: extracted.confidence
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

  } catch (error) {
    console.error('Error processing individual metadata:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add enslaved person descendant
app.post('/api/add-enslaved-descendant', async (req, res) => {
  try {
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
    } = req.body;

    if (!fullName) {
      return res.status(400).json({ success: false, error: 'Full name is required' });
    }

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

  } catch (error) {
    console.error('Error adding enslaved descendant:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Calculate descendant debt for slaveowner
app.post('/api/calculate-descendant-debt', async (req, res) => {
  try {
    const { perpetratorId, originalDebt } = req.body;

    if (!perpetratorId || !originalDebt) {
      return res.status(400).json({ success: false, error: 'perpetratorId and originalDebt are required' });
    }

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

  } catch (error) {
    console.error('Error calculating descendant debt:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Calculate reparations credit for enslaved person descendants
app.post('/api/calculate-reparations-credit', async (req, res) => {
  try {
    const { ancestorId, originalCredit } = req.body;

    if (!ancestorId || !originalCredit) {
      return res.status(400).json({ success: false, error: 'ancestorId and originalCredit are required' });
    }

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

  } catch (error) {
    console.error('Error calculating reparations credit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get debt status for an individual
app.get('/api/debt-status/:individualId', async (req, res) => {
  try {
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

  } catch (error) {
    console.error('Error getting debt status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get credit status for an enslaved descendant
app.get('/api/credit-status/:enslavedId', async (req, res) => {
  try {
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

  } catch (error) {
    console.error('Error getting credit status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Record a blockchain payment
app.post('/api/record-payment', async (req, res) => {
  try {
    const {
      payerId,
      recipientId,
      amount,
      txHash,
      blockNumber,
      networkId
    } = req.body;

    if (!payerId || !recipientId || !amount) {
      return res.status(400).json({ success: false, error: 'payerId, recipientId, and amount are required' });
    }

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

  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ success: false, error: error.message });
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
