// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const config = require('./config');
const database = require('./database');
const EnhancedDocumentProcessor = require('./enhanced-document-processor');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('frontend/public'));

const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 50 * 1024 * 1024 }
});

const processor = new EnhancedDocumentProcessor({
    googleVisionApiKey: config.googleVisionApiKey,
    storageRoot: config.storage.root,
    database: database,
    ipfsEnabled: config.ipfs.enabled,
    ipfsGateway: config.ipfs.gateway
});

console.log('🚀 Reparations Platform Server');
console.log('================================');
console.log(`📊 Database: ${config.database.database}`);
console.log(`💾 Storage: ${config.storage.root}`);
console.log(`🔑 Google Vision API: ${config.googleVisionApiKey ? '✓ Configured' : '✗ Not configured'}\n`);

app.get('/api/health', async (req, res) => {
    try {
        const stats = await database.getStats();
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected',
            stats: stats
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

app.post('/api/upload-document', upload.single('document'), async (req, res) => {
    try {
        console.log(`\n📤 Received upload: ${req.file.originalname}`);
        
        const metadata = {
            ownerName: req.body.ownerName,
            documentType: req.body.documentType,
            birthYear: parseInt(req.body.birthYear) || null,
            deathYear: parseInt(req.body.deathYear) || null,
            location: req.body.location || null
        };
        
        const result = await processor.processDocument(req.file, metadata);
        
        res.json({
            success: true,
            message: 'Document processed successfully',
            result: {
                documentId: result.documentId,
                totalEnslaved: result.stages.parsing.enslavedPeople.length,
                totalReparations: result.stages.reparations.total,
                ipfsHash: result.stages.ipfs.ipfsHash,
                processingTime: result.processingTime
            }
        });
        
    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const stats = await database.getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/documents/:id', async (req, res) => {
    try {
        const doc = await database.getDocumentById(req.params.id);
        if (!doc) {
            return res.status(404).json({ error: 'Document not found' });
        }
        
        const enslavedPeople = await database.getEnslavedPeopleByDocument(req.params.id);
        
        res.json({ ...doc, enslavedPeople });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/owners/:name/documents', async (req, res) => {
    try {
        const docs = await database.getDocumentsByOwner(req.params.name);
        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/verification-queue', async (req, res) => {
    try {
        const queue = await database.getVerificationQueue();
        res.json(queue);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/documents/:id/verify', async (req, res) => {
    try {
        const { status, reviewerName, notes } = req.body;
        await database.updateVerificationStatus(req.params.id, status, reviewerName, notes);
        res.json({ success: true, message: `Document ${status}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/blockchain-queue', async (req, res) => {
    try {
        const queue = await database.getBlockchainQueue();
        res.json(queue);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/documents/:id/blockchain', async (req, res) => {
    try {
        const { txHash, blockNumber, recordId } = req.body;
        await database.recordBlockchainSubmission(req.params.id, txHash, blockNumber, recordId);
        res.json({ success: true, message: 'Blockchain submission recorded' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const { q, type, status } = req.query;
        const results = await database.searchDocuments(q, {
            docType: type,
            verificationStatus: status
        });
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = config.server.port;
const HOST = config.server.host;

app.listen(PORT, HOST, () => {
    console.log('================================');
    console.log(`✅ Server running on http://${HOST}:${PORT}`);
    console.log('================================\n');
});

process.on('SIGTERM', async () => {
    await database.pool.end();
    process.exit(0);
});

module.exports = app;
