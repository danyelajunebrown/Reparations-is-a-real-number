/**
 * Add this to server.js
 * API endpoint for adding flexible evidence
 */

// Add to imports:
// const EvidenceManager = require('./evidence-manager');
// const evidenceManager = new EvidenceManager({ storage: config.storage });

// Add this endpoint:

app.post('/api/add-evidence',
  uploadLimiter,
  // authenticate,  // Enable in production
  upload.single('file'),  // Optional file upload
  asyncHandler(async (req, res) => {
    const {
      evidenceType,
      title,
      description,
      textContent,
      imageUrl,
      sourceUrl,
      subjectPersonId,
      subjectPersonName,
      location,
      date,
      collectedBy,
      proves,  // JSON string
      confidence,
      citations,  // JSON string
      notes,
      customMetadata,  // JSON string
      relatedPersons  // JSON string
    } = req.body;

    // Handle uploaded file
    let filePath = null;
    if (req.file) {
      // Store file
      const stored = await evidenceManager.storageAdapter.uploadFile(req.file, {
        type: evidenceType,
        title: title
      });
      filePath = stored.filePath;
    }

    // Add evidence
    const result = await evidenceManager.addEvidence({
      evidenceType,
      title,
      description,
      textContent,
      imageUrl,
      sourceUrl,
      filePath,
      subjectPersonId,
      subjectPersonName,
      location,
      date,
      collectedBy: collectedBy || req.user?.id || 'anonymous',
      proves: proves ? JSON.parse(proves) : [],
      confidence: confidence ? parseFloat(confidence) : 0.8,
      citations: citations ? JSON.parse(citations) : [],
      notes,
      customMetadata: customMetadata ? JSON.parse(customMetadata) : {},
      relatedPersons: relatedPersons ? JSON.parse(relatedPersons) : []
    });

    res.json({
      success: true,
      evidenceId: result.evidenceId,
      message: `Evidence "${title}" added successfully`,
      knownTypes: evidenceManager.getKnownEvidenceTypes()
    });
  })
);

// Get evidence for a person
app.get('/api/person/:personId/evidence',
  asyncHandler(async (req, res) => {
    const { personId } = req.params;

    const person = await evidenceManager.getPersonWithEvidence(personId);

    res.json({
      success: true,
      person: person,
      evidenceCount: person.evidence.length
    });
  })
);

// Get lineage tree
app.get('/api/lineage/:personId',
  asyncHandler(async (req, res) => {
    const { personId } = req.params;
    const { maxDepth = 10, includeEvidence = true, includeDebt = true } = req.query;

    const tree = await evidenceManager.buildLineageTree(personId, {
      maxDepth: parseInt(maxDepth),
      includeEvidence: includeEvidence === 'true',
      includeDebt: includeDebt === 'true'
    });

    res.json({
      success: true,
      tree: tree
    });
  })
);

// Get known evidence types (system learns these)
app.get('/api/evidence-types',
  asyncHandler(async (req, res) => {
    const types = evidenceManager.getKnownEvidenceTypes();

    res.json({
      success: true,
      evidenceTypes: types,
      count: types.length,
      message: 'System adapts to new evidence types automatically'
    });
  })
);
