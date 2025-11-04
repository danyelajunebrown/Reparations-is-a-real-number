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

// Add this to your existing server.js

// LLM Database Query endpoint
app.post('/api/llm-query', async (req, res) => {
  const { query, context } = req.body;
  
  try {
    // Parse user intent and build SQL
    const intent = parseUserIntent(query);
    let dbResults = {};
    
    // Query based on intent
    if (intent.type === 'owner_lookup') {
      dbResults.owners = await database.query(`
        SELECT d.*, 
               array_agg(json_build_object(
                 'name', ep.name,
                 'gender', ep.gender,
                 'family_relationship', ep.family_relationship,
                 'bequeathed_to', ep.bequeathed_to
               )) as enslaved_people
        FROM documents d
        LEFT JOIN enslaved_people ep ON d.document_id = ep.document_id
        WHERE d.owner_name ILIKE $1
        GROUP BY d.document_id
      `, [`%${intent.ownerName}%`]);
      
    } else if (intent.type === 'person_lookup') {
      dbResults.people = await database.query(`
        SELECT ep.*, d.owner_name, d.doc_type, d.ipfs_hash
        FROM enslaved_people ep
        JOIN documents d ON ep.document_id = d.document_id
        WHERE ep.name ILIKE $1
      `, [`%${intent.personName}%`]);
      
    } else if (intent.type === 'statistics') {
      const stats = await database.getStats();
      dbResults.stats = stats;
      
    } else if (intent.type === 'family_structure') {
      dbResults.families = await database.query(`
        SELECT f.*, 
               array_agg(fc.child_name) as children,
               d.owner_name, d.document_id
        FROM families f
        LEFT JOIN family_children fc ON f.id = fc.family_id
        JOIN documents d ON f.document_id = d.document_id
        WHERE f.parent1 ILIKE $1 OR f.parent2 ILIKE $1
        GROUP BY f.id, d.document_id, d.owner_name
      `, [`%${intent.personName}%`]);
    }
    
    // Call LLM with database context
    const llmResponse = await callLLM(query, dbResults);
    
    res.json({
      success: true,
      response: llmResponse.text,
      evidence: llmResponse.evidence,
      dbResults: dbResults
    });
    
  } catch (error) {
    console.error('LLM query error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Parse user intent from natural language
function parseUserIntent(query) {
  const lower = query.toLowerCase();
  
  // Owner lookup patterns
  if (lower.match(/about|tell me|who (was|is)|hopewell|biscoe/)) {
    const nameMatch = query.match(/about ([A-Z][a-z]+ [A-Z][a-z]+)|hopewell|biscoe/i);
    return {
      type: 'owner_lookup',
      ownerName: nameMatch ? nameMatch[1] || nameMatch[0] : ''
    };
  }
  
  // Person lookup (enslaved individuals)
  if (lower.match(/minna|enslaved person|slave named/)) {
    const nameMatch = query.match(/minna|([A-Z][a-z]+)(?= was enslaved)/i);
    return {
      type: 'person_lookup',
      personName: nameMatch ? nameMatch[0] : ''
    };
  }
  
  // Statistics
  if (lower.match(/how many|total|statistics|count/)) {
    return { type: 'statistics' };
  }
  
  // Family structures
  if (lower.match(/family|children|mother|father|parent/)) {
    const nameMatch = query.match(/([A-Z][a-z]+)(?='s| had)/i);
    return {
      type: 'family_structure',
      personName: nameMatch ? nameMatch[1] : ''
    };
  }
  
  return { type: 'general', query };
}

// Call actual LLM (Claude or OpenAI)
async function callLLM(userQuery, dbContext) {
  // Using Anthropic Claude
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a reparations research assistant with access to a genealogical database.

DATABASE CONTEXT:
${JSON.stringify(dbContext, null, 2)}

USER QUERY: ${userQuery}

Respond naturally and cite specific evidence from the database. If documents mention enslaved people, show their names and relationships. Format your response to include:
1. Direct answer to the query
2. Evidence from documents (with IPFS hashes if available)
3. Any family relationships found

IMPORTANT: Your response will be parsed. Include a JSON block at the end with:
{
  "evidence_type": "owner_profile|family_structure|statistics|document",
  "evidence_data": {...}
}
`
      }]
    })
  });
  
  const data = await response.json();
  const text = data.content[0].text;
  
  // Extract evidence JSON if present
  let evidence = null;
  const jsonMatch = text.match(/\{[\s\S]*"evidence_type"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      evidence = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse evidence JSON');
    }
  }
  
  return {
    text: text.replace(/\{[\s\S]*"evidence_type"[\s\S]*\}/, '').trim(),
    evidence: evidence || generateEvidenceFromContext(dbContext)
  };
}

// Fallback: generate evidence structure from DB results
function generateEvidenceFromContext(dbContext) {
  if (dbContext.owners && dbContext.owners.rows && dbContext.owners.rows.length > 0) {
    const owner = dbContext.owners.rows[0];
    return {
      evidence_type: 'owner_profile',
      evidence_data: {
        name: owner.owner_name,
        location: owner.owner_location,
        documents: [{
          type: owner.doc_type,
          ipfsHash: owner.ipfs_hash,
          totalEnslaved: owner.total_enslaved
        }],
        enslaved: owner.enslaved_people || []
      }
    };
  }
  
  if (dbContext.stats) {
    return {
      evidence_type: 'statistics',
      evidence_data: dbContext.stats
    };
  }
  
  return null;
}

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
