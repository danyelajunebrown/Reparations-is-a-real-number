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
const llmAssistant = require('./llm-conversational-assistant');
const ColonialAmericanDocumentParser = require('./historical-document-parser');
const OCRComparisonTrainer = require('./ocr-comparison-trainer');
const EnslavedIndividualManager = require('./enslaved-individual-manager');

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
    // Always allow GitHub Pages domain
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'https://danyelajunebrown.github.io'
    ];

    // Add custom origins from env var if specified
    if (process.env.ALLOWED_ORIGINS) {
      allowedOrigins.push(...process.env.ALLOWED_ORIGINS.split(','));
    }

    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);

    // Check if origin starts with any allowed origin (handles subdirectories)
    const isAllowed = allowedOrigins.some(allowed => origin.startsWith(allowed));

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
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

// Initialize enslaved individual manager
const enslavedManager = new EnslavedIndividualManager(database);

// Initialize descendant calculator
const descendantCalc = new DescendantCalculator(database);

// Initialize FREE NLP Research Assistant (no API keys needed!)
const researchAssistant = new FreeNLPResearchAssistant(database, enslavedManager);

// Initialize Colonial American Document Parser (for pre-OCR'd text)
const documentParser = new ColonialAmericanDocumentParser({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free'
});

// Initialize OCR Comparison Trainer (for OCR quality improvement)
const ocrTrainer = new OCRComparisonTrainer(database);

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

    // Process the document
    const result = await processor.processDocument(req.file, metadata);

    // If precompleted OCR or accompanying text provided, enhance the results
    if (metadata.precompletedOCR || metadata.accompanyingText) {
      console.log('Processing with precompleted OCR/accompanying text...');

      const systemOCR = result.stages?.ocr?.text || '';
      const precompletedOCR = metadata.precompletedOCR || '';
      const accompanyingText = metadata.accompanyingText || '';

      // Compare OCR if both system and precompleted exist
      if (systemOCR && precompletedOCR) {
        const comparison = await ocrTrainer.compareOCR(systemOCR, precompletedOCR, {
          documentType: metadata.documentType,
          documentId: result.documentId,
          ownerName: metadata.ownerName,
          ocrSource: metadata.ocrSource || 'user_provided'
        });

        result.ocrComparison = {
          similarity: comparison.similarity,
          quality: comparison.quality,
          recommendation: comparison.recommendation,
          discrepancyCount: comparison.discrepancies.missingWords.length +
                           comparison.discrepancies.extraWords.length
        };

        // Use precompleted OCR if recommended
        if (comparison.recommendation === 'use_precompleted_ocr') {
          console.log(`Using precompleted OCR (similarity: ${(comparison.similarity * 100).toFixed(1)}%)`);
          result.stages.ocr.text = precompletedOCR;
          result.stages.ocr.source = 'precompleted';
          result.stages.ocr.originalSystemText = systemOCR;

          // Update database with precompleted OCR
          if (result.documentId) {
            await database.query(`
              UPDATE documents
              SET ocr_text = $1,
                  ocr_confidence = $2,
                  ocr_service = $3
              WHERE document_id = $4
            `, [precompletedOCR, 1.0, 'precompleted_' + (metadata.ocrSource || 'user'), result.documentId]);
          }
        }
      } else if (precompletedOCR && !systemOCR) {
        // No system OCR, just use precompleted
        console.log('Using precompleted OCR (no system OCR available)');
        if (!result.stages.ocr) result.stages.ocr = {};
        result.stages.ocr.text = precompletedOCR;
        result.stages.ocr.source = 'precompleted_only';
      }

      // Merge with accompanying text if provided
      if (accompanyingText) {
        const finalOCR = result.stages?.ocr?.text || precompletedOCR || '';
        const merged = ocrTrainer.mergeWithAccompanyingText(finalOCR, accompanyingText, {
          textSource: metadata.textSource || 'website'
        });

        result.textEnhancement = merged;

        // If there's valuable additional context, append it to notes
        if (merged.enhanced && merged.enhancedWords.length > 0) {
          const additionalContext = `\n\nAdditional context from ${merged.source}: ${accompanyingText.substring(0, 500)}${accompanyingText.length > 500 ? '...' : ''}`;

          await database.query(`
            UPDATE documents
            SET notes = COALESCE(notes, '') || $1
            WHERE document_id = $2
          `, [additionalContext, result.documentId]);
        }
      }
    }

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

    // Handle enslaved-person-primary documents
    if (sharedMetadata.subjectType === 'enslaved' && sharedMetadata.enslavedPersonName) {
      try {
        console.log('Creating enslaved individual record...');

        const enslavedId = await enslavedManager.findOrCreateEnslavedIndividual({
          fullName: sharedMetadata.enslavedPersonName,
          birthYear: sharedMetadata.birthYear,
          deathYear: sharedMetadata.deathYear,
          spouseName: sharedMetadata.spouseName,
          enslavedBy: sharedMetadata.ownerName, // optional
          location: sharedMetadata.location,
          notes: `Uploaded from ${sharedMetadata.documentType} document`
        });

        // Link document to enslaved individual
        await enslavedManager.linkToDocument(enslavedId, documentId);

        console.log(`✓ Document linked to enslaved individual: ${enslavedId}`);
      } catch (error) {
        console.error('Error creating enslaved individual record:', error);
        // Don't fail the upload if this fails
      }
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

// SECURED: Upload document with pre-OCR'd text (from archives, transcriptions)
app.post('/api/upload-document-with-text',
  uploadLimiter,
  // authenticate, // DISABLED FOR TESTING - re-enable in production
  validate('uploadDocumentWithText'),
  asyncHandler(async (req, res) => {
    const {
      textContent,
      textSource,
      ownerName,
      documentType,
      birthYear,
      deathYear,
      location,
      notes,
      ...metadata
    } = req.validatedBody;

    console.log(`Received pre-OCR'd text for ${ownerName} (${textContent.length} chars)`);

    const crypto = require('crypto');
    const documentId = crypto.randomBytes(12).toString('hex');

    // Parse the pre-OCR'd text using Colonial American parser
    const parseResult = await documentParser.parsePreParsedDocument(textContent, {
      documentType,
      ownerName,
      birthYear,
      deathYear,
      location,
      textSource: textSource || 'transcription',
      ...metadata
    });

    console.log(`Parsed ${parseResult.enslaved_people?.length || 0} enslaved people from text`);

    // Save to database
    const filename = `${ownerName.replace(/[^a-zA-Z0-9]/g, '_')}_${documentType}_transcription.txt`;

    const documentData = {
      documentId,
      ownerName,
      documentType,
      birthYear,
      deathYear,
      location,
      uploadDate: new Date(),

      storage: {
        storageType: 'text_only',
        filename: filename,
        filePath: `text_only/${documentId}/${filename}`,
        textContent: textContent,
        textSource: textSource || 'transcription',
        documentType: documentType
      },

      ocr: {
        text: textContent,
        confidence: textSource === 'transcription' ? 1.0 : 0.95,
        ocrService: textSource || 'pre-parsed'
      },

      parsing: {
        method: parseResult.method || 'llm',
        confidence: parseResult.confidence || 0.8,
        enslaved_people: parseResult.enslaved_people || [],
        owner_info: parseResult.owner_info || {},
        relationships: parseResult.relationships || []
      },

      enslaved: {
        totalCount: parseResult.enslaved_people?.length || 0,
        namedIndividuals: parseResult.enslaved_people?.filter(p => p.name).length || 0
      },

      reparations: {
        total: 0,
        perPerson: 0,
        estimatedYears: 0
      },

      blockchain: {
        verificationLevel: 'pending'
      },

      uploadedBy: req.user?.id || 'text-upload',
      notes: notes || null
    };

    await database.saveDocument(documentData);
    console.log(`Saved text document: ${documentId}`);

    // Train the parser if confidence is high
    if (parseResult.confidence > 0.8 && parseResult.enslaved_people?.length > 0) {
      console.log('Training parser from high-confidence example');
      try {
        await documentParser.trainFromExample(textContent, {
          enslaved_people: parseResult.enslaved_people,
          owner_info: parseResult.owner_info,
          relationships: parseResult.relationships
        }, {
          documentType,
          textSource
        });
        console.log('Parser training complete');
      } catch (trainError) {
        console.error('Parser training failed:', trainError.message);
        // Don't fail the request if training fails
      }
    }

    res.json({
      success: true,
      message: 'Pre-OCR\'d document processed successfully',
      documentId: documentId,
      parsed: {
        enslaved_count: parseResult.enslaved_people?.length || 0,
        confidence: parseResult.confidence,
        method: parseResult.method,
        trained: parseResult.confidence > 0.8
      },
      result: parseResult
    });
  })
);

// SECURED: Re-process existing document with improved parser
app.post('/api/reprocess-document',
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const { documentId } = req.body;

    if (!documentId) {
      return res.status(400).json({
        success: false,
        error: 'Document ID is required'
      });
    }

    console.log(`Re-processing document: ${documentId}`);

    // Fetch document from database
    const doc = await database.getDocumentById(documentId);

    if (!doc) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // Check if document has OCR text
    if (!doc.ocr_text) {
      return res.status(400).json({
        success: false,
        error: 'Document has no OCR text to re-process'
      });
    }

    // Re-parse the OCR text with current parser
    const parseResult = await documentParser.parsePreParsedDocument(doc.ocr_text, {
      documentType: doc.doc_type,
      ownerName: doc.owner_name,
      birthYear: doc.owner_birth_year,
      deathYear: doc.owner_death_year,
      location: doc.owner_location,
      textSource: 'reprocess'
    });

    console.log(`Re-parsed ${parseResult.enslaved_people?.length || 0} enslaved people`);

    // Update document in database with new counts
    await database.pool.query(`
      UPDATE documents
      SET total_enslaved = $1,
          named_enslaved = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE document_id = $3
    `, [
      parseResult.enslaved_people?.length || 0,
      parseResult.enslaved_people?.filter(p => p.name).length || 0,
      documentId
    ]);

    // Delete old enslaved_people records
    await database.pool.query(`
      DELETE FROM enslaved_people WHERE document_id = $1
    `, [documentId]);

    // Insert new enslaved_people records
    if (parseResult.enslaved_people && parseResult.enslaved_people.length > 0) {
      for (const person of parseResult.enslaved_people) {
        await database.pool.query(`
          INSERT INTO enslaved_people (
            document_id, name, gender, age, source
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
          documentId,
          person.name,
          person.gender || null,
          person.age || null,
          'reprocessed'
        ]);
      }
    }

    res.json({
      success: true,
      message: 'Document re-processed successfully',
      documentId: documentId,
      previous_count: doc.total_enslaved,
      new_count: parseResult.enslaved_people?.length || 0,
      improvement: (parseResult.enslaved_people?.length || 0) - doc.total_enslaved,
      parsed: {
        enslaved_count: parseResult.enslaved_people?.length || 0,
        confidence: parseResult.confidence,
        method: parseResult.method
      },
      result: parseResult
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

    // Session context for conversation tracking
    if (!global.conversationContexts) {
      global.conversationContexts = {};
    }
    const context = global.conversationContexts[sessionId || 'default'] || {};

    try {
      // Use LLM-powered conversational assistant if API key is configured
      if (process.env.OPENROUTER_API_KEY) {
        console.log('Using LLM conversational assistant');
        const result = await llmAssistant.processConversation(query, context);

        // Update context
        global.conversationContexts[sessionId || 'default'] = result.context;

        res.json({
          success: result.success,
          response: result.message,
          data: result.data,
          intent: result.intent
        });
      } else {
        // Fallback to FREE pattern-matching NLP system
        console.log('Using pattern-matching NLP assistant (no API key configured)');
        const result = await researchAssistant.query(query, sessionId || 'default');
        res.json(result);
      }
    } catch (error) {
      console.error('Research Assistant error:', error);

      // If LLM fails, try fallback to pattern matching
      if (process.env.OPENROUTER_API_KEY) {
        console.log('LLM failed, falling back to pattern matching');
        const result = await researchAssistant.query(query, sessionId || 'default');
        res.json(result);
      } else {
        throw error;
      }
    }
  })
);

// SECURED: Clear Research Assistant conversation history
app.post('/api/clear-chat',
  validate('clearChat'),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.validatedBody;

    // Clear both pattern-matching and LLM conversation contexts
    researchAssistant.clearSession(sessionId || 'default');

    if (global.conversationContexts) {
      delete global.conversationContexts[sessionId || 'default'];
    }

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

// ========================================
// PUBLIC RESEARCH CONTRIBUTION ENDPOINTS
// ========================================

// Submit URL for scraping (for contribute.html)
app.post('/api/submit-url',
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const { url, category, submittedBy } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid URL format' });
    }

    // Check if URL already in queue (pending or processing)
    const existingCheck = await database.query(
      `SELECT id, status FROM scraping_queue
       WHERE url = $1 AND status IN ('pending', 'processing')
       LIMIT 1`,
      [url]
    );

    if (existingCheck.rows.length > 0) {
      return res.json({
        success: true,
        message: 'This URL is already in the queue!',
        queueId: existingCheck.rows[0].id,
        status: existingCheck.rows[0].status
      });
    }

    // Set priority based on category
    // Beyond Kin gets highest priority (10) - explicit evidentiary documentation
    const priority = category === 'beyondkin' ? 10 : 5;

    // Insert into queue
    const result = await database.query(
      `INSERT INTO scraping_queue (url, category, submitted_by, status, priority)
       VALUES ($1, $2, $3, 'pending', $4)
       RETURNING id, url, status, submitted_at, priority`,
      [url, category || 'other', submittedBy || 'anonymous', priority]
    );

    const message = category === 'beyondkin'
      ? 'Beyond Kin submission received! High priority - will be reviewed soon.'
      : 'URL submitted successfully! Our research agent will process it soon.';

    res.json({
      success: true,
      message: message,
      queueEntry: result.rows[0],
      isBeyondKin: category === 'beyondkin'
    });
  })
);

// Get queue statistics (for contribute.html)
app.get('/api/queue-stats',
  queryLimiter,
  asyncHandler(async (req, res) => {
    const stats = await database.query(`
      SELECT * FROM queue_stats LIMIT 1
    `);

    // Also get recent documents count
    const docsResult = await database.query(`
      SELECT COUNT(*) as count
      FROM scraping_sessions
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
    `);

    res.json({
      pending_urls: stats.rows[0]?.pending_urls || 0,
      processing_urls: stats.rows[0]?.processing_urls || 0,
      completed_urls: stats.rows[0]?.completed_urls || 0,
      failed_urls: stats.rows[0]?.failed_urls || 0,
      persons_24h: stats.rows[0]?.persons_24h || 0,
      documents_24h: docsResult.rows[0]?.count || 0,
      sessions_24h: stats.rows[0]?.sessions_24h || 0
    });
  })
);

// ========================================
// REPARATIONS PORTAL ENDPOINTS
// ========================================

// Search for reparations by name, year, or ID (for portal.html)
app.post('/api/search-reparations',
  queryLimiter,
  asyncHandler(async (req, res) => {
    const { searchType, searchValue } = req.body;

    if (!searchType || !searchValue) {
      return res.status(400).json({ success: false, error: 'Search type and value required' });
    }

    let searchQuery;
    let queryParams;

    // Build query based on search type
    if (searchType === 'name') {
      searchQuery = `
        SELECT
          i.individual_id,
          i.full_name,
          i.birth_year,
          i.death_year,
          i.gender,
          i.locations,
          i.enslaved_status,
          i.slave_owner,
          COALESCE(SUM(r.total_reparations), 0) as total_reparations
        FROM individuals i
        LEFT JOIN reparations_breakdown r ON i.individual_id = r.individual_id
        WHERE LOWER(i.full_name) LIKE LOWER($1)
        GROUP BY i.individual_id
        ORDER BY total_reparations DESC
        LIMIT 50
      `;
      queryParams = [`%${searchValue}%`];
    } else if (searchType === 'year') {
      searchQuery = `
        SELECT
          i.individual_id,
          i.full_name,
          i.birth_year,
          i.death_year,
          i.gender,
          i.locations,
          i.enslaved_status,
          i.slave_owner,
          COALESCE(SUM(r.total_reparations), 0) as total_reparations
        FROM individuals i
        LEFT JOIN reparations_breakdown r ON i.individual_id = r.individual_id
        WHERE i.birth_year = $1
        GROUP BY i.individual_id
        ORDER BY total_reparations DESC
        LIMIT 50
      `;
      queryParams = [parseInt(searchValue)];
    } else if (searchType === 'id') {
      searchQuery = `
        SELECT
          i.individual_id,
          i.full_name,
          i.birth_year,
          i.death_year,
          i.gender,
          i.locations,
          i.enslaved_status,
          i.slave_owner,
          COALESCE(SUM(r.total_reparations), 0) as total_reparations
        FROM individuals i
        LEFT JOIN reparations_breakdown r ON i.individual_id = r.individual_id
        WHERE i.individual_id = $1
        GROUP BY i.individual_id
        LIMIT 1
      `;
      queryParams = [searchValue];
    } else {
      return res.status(400).json({ success: false, error: 'Invalid search type' });
    }

    const results = await database.query(searchQuery, queryParams);

    if (results.rows.length === 0) {
      return res.json({
        success: false,
        error: 'No records found for this search. Try different search terms or check back later as we continuously add new records.'
      });
    }

    // Calculate total reparations across all results
    const totalReparations = results.rows.reduce((sum, person) => {
      return sum + parseFloat(person.total_reparations || 0);
    }, 0);

    // Get documents for each person
    const ancestors = await Promise.all(results.rows.map(async (person) => {
      const docs = await database.query(
        `SELECT di.document_id, d.document_type, d.ipfs_hash
         FROM document_individuals di
         JOIN documents d ON di.document_id = d.document_id
         WHERE di.individual_id = $1
         LIMIT 10`,
        [person.individual_id]
      );

      return {
        name: person.full_name,
        birthYear: person.birth_year,
        deathYear: person.death_year,
        location: person.locations ? person.locations[0] : null,
        reparations: parseFloat(person.total_reparations || 0),
        documents: docs.rows.map(doc => ({
          type: doc.document_type,
          url: doc.ipfs_hash ? `${config.ipfs.gateway}${doc.ipfs_hash}` : `/api/documents/${doc.document_id}/file`
        }))
      };
    }));

    // Build breakdown
    const breakdown = {
      'Total Ancestors Found': ancestors.length,
      'Documented with Primary Sources': ancestors.filter(a => a.documents.length > 0).length,
      'Average Reparations per Ancestor': ancestors.length > 0 ? totalReparations / ancestors.length : 0
    };

    res.json({
      success: true,
      searchedFor: searchValue,
      totalReparations,
      ancestors,
      breakdown
    });
  })
);

// ========================================
// BEYOND KIN REVIEW QUEUE ENDPOINTS
// ========================================

// Get Beyond Kin pending reviews (for index.html review panel)
app.get('/api/beyond-kin/pending',
  queryLimiter,
  asyncHandler(async (req, res) => {
    const reviews = await database.query(`
      SELECT * FROM beyond_kin_pending_reviews
      ORDER BY days_pending DESC
      LIMIT 50
    `);

    const stats = await database.query(`
      SELECT * FROM beyond_kin_stats LIMIT 1
    `);

    res.json({
      success: true,
      reviews: reviews.rows,
      stats: stats.rows[0] || {}
    });
  })
);

// Get specific Beyond Kin review details
app.get('/api/beyond-kin/:id',
  queryLimiter,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const review = await database.query(
      `SELECT * FROM beyond_kin_review_queue WHERE id = $1`,
      [id]
    );

    if (review.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    res.json({
      success: true,
      review: review.rows[0]
    });
  })
);

// Approve Beyond Kin review (promote to confirmed)
app.post('/api/beyond-kin/:id/approve',
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reviewedBy, reviewNotes, documentId } = req.body;

    const result = await database.query(
      `UPDATE beyond_kin_review_queue
       SET review_status = 'approved',
           reviewed_by = $1,
           reviewed_at = CURRENT_TIMESTAMP,
           review_notes = $2,
           promoted_document_id = $3,
           promoted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [reviewedBy || 'program_lead', reviewNotes, documentId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    res.json({
      success: true,
      message: 'Beyond Kin entry approved and promoted to confirmed records',
      review: result.rows[0]
    });
  })
);

// Reject Beyond Kin review
app.post('/api/beyond-kin/:id/reject',
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reviewedBy, reviewNotes } = req.body;

    const result = await database.query(
      `UPDATE beyond_kin_review_queue
       SET review_status = 'rejected',
           reviewed_by = $1,
           reviewed_at = CURRENT_TIMESTAMP,
           review_notes = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [reviewedBy || 'program_lead', reviewNotes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    res.json({
      success: true,
      message: 'Beyond Kin entry rejected',
      review: result.rows[0]
    });
  })
);

// Mark Beyond Kin review as "needs document"
app.post('/api/beyond-kin/:id/needs-document',
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reviewedBy, reviewNotes } = req.body;

    const result = await database.query(
      `UPDATE beyond_kin_review_queue
       SET review_status = 'needs_document',
           reviewed_by = $1,
           reviewed_at = CURRENT_TIMESTAMP,
           review_notes = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [reviewedBy || 'program_lead', reviewNotes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    res.json({
      success: true,
      message: 'Marked as needs document - will track down source',
      review: result.rows[0]
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

// Initialize all database schemas on startup (for Render free tier auto-deployment)
async function initializeDatabaseSchemas() {
  try {
    console.log('Checking database schemas...');

    // Set a timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Schema init timeout')), 10000)
    );

    const schemaPromise = (async () => {
      // Create table if not exists
      await database.query(`
        CREATE TABLE IF NOT EXISTS ocr_comparisons (
          id SERIAL PRIMARY KEY,
          document_type VARCHAR(50),
          similarity_score DECIMAL(5,4),
          quality_assessment VARCHAR(50),
          recommendation VARCHAR(50),
          system_word_count INTEGER,
          precompleted_word_count INTEGER,
          discrepancy_count INTEGER,
          comparison_data JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create indexes
      await database.query(`
        CREATE INDEX IF NOT EXISTS idx_ocr_comparisons_document_type ON ocr_comparisons(document_type);
        CREATE INDEX IF NOT EXISTS idx_ocr_comparisons_similarity ON ocr_comparisons(similarity_score);
        CREATE INDEX IF NOT EXISTS idx_ocr_comparisons_quality ON ocr_comparisons(quality_assessment);
        CREATE INDEX IF NOT EXISTS idx_ocr_comparisons_created_at ON ocr_comparisons(created_at);
      `);

      // Create views
      await database.query(`
        CREATE OR REPLACE VIEW ocr_performance_stats AS
        SELECT
          document_type,
          COUNT(*) as total_comparisons,
          AVG(similarity_score) as avg_similarity,
          MIN(similarity_score) as min_similarity,
          MAX(similarity_score) as max_similarity,
          COUNT(CASE WHEN quality_assessment = 'excellent' THEN 1 END) as excellent_count,
          COUNT(CASE WHEN quality_assessment = 'good_with_improvements_needed' THEN 1 END) as good_count,
          COUNT(CASE WHEN quality_assessment = 'poor_needs_training' THEN 1 END) as poor_count,
          AVG(discrepancy_count) as avg_discrepancies
        FROM ocr_comparisons
        GROUP BY document_type
        ORDER BY total_comparisons DESC;
      `);

      await database.query(`
        CREATE OR REPLACE VIEW recent_ocr_comparisons AS
        SELECT
          id,
          document_type,
          similarity_score,
          quality_assessment,
          recommendation,
          discrepancy_count,
          created_at
        FROM ocr_comparisons
        ORDER BY created_at DESC
        LIMIT 100;
      `);

      // Enslaved-person-primary documents schema
      console.log('  Checking enslaved documents schema...');

      // Make owner_name nullable
      await database.query(`
        ALTER TABLE documents
        ALTER COLUMN owner_name DROP NOT NULL;
      `).catch(() => {}); // Ignore if already done

      // Add subject type columns
      await database.query(`
        ALTER TABLE documents
        ADD COLUMN IF NOT EXISTS primary_subject_type VARCHAR(50) DEFAULT 'owner',
        ADD COLUMN IF NOT EXISTS enslaved_individual_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id) ON DELETE SET NULL;
      `).catch(() => {});

      // Add spouse name to enslaved_individuals
      await database.query(`
        ALTER TABLE enslaved_individuals
        ADD COLUMN IF NOT EXISTS spouse_name VARCHAR(500);
      `).catch(() => {});

      // Create indexes
      await database.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_enslaved_individual ON documents(enslaved_individual_id);
        CREATE INDEX IF NOT EXISTS idx_documents_subject_type ON documents(primary_subject_type);
      `).catch(() => {});

      console.log('  ✓ Enslaved documents schema ready');

      // Enslaved individuals metadata (alternative names, middle name, children, etc.)
      console.log('  Checking enslaved individuals metadata schema...');

      await database.query(`
        ALTER TABLE enslaved_individuals
        ADD COLUMN IF NOT EXISTS alternative_names TEXT[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS middle_name VARCHAR(200),
        ADD COLUMN IF NOT EXISTS child_names TEXT[] DEFAULT '{}';
      `).catch(() => {});

      await database.query(`
        CREATE INDEX IF NOT EXISTS idx_enslaved_alternative_names
        ON enslaved_individuals USING GIN (alternative_names);
      `).catch(() => {});

      await database.query(`
        CREATE INDEX IF NOT EXISTS idx_enslaved_familysearch_id
        ON enslaved_individuals(familysearch_id);
      `).catch(() => {});

      console.log('  ✓ Enslaved metadata schema ready');
    })();

    // Race between schema init and timeout
    await Promise.race([schemaPromise, timeoutPromise]);

    console.log('✓ All database schemas ready');
  } catch (error) {
    console.warn('Database schema initialization warning:', error.message);
    // Don't fail server startup if this fails
  }
}

// Start server
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  // Initialize database schemas before starting server
  initializeDatabaseSchemas().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log('Reparations server running on port ' + PORT);
      console.log('Storage root: ' + config.storage.root);
      console.log('OCR enabled: ' + processor.performOCR);
    });
  }).catch(err => {
    console.error('Server startup error:', err);
    // Start server anyway even if OCR schema fails
    app.listen(PORT, '0.0.0.0', () => {
      console.log('Reparations server running on port ' + PORT);
      console.log('Storage root: ' + config.storage.root);
      console.log('OCR enabled: ' + processor.performOCR);
    });
  });
}

module.exports = app;
