/**
 * Database Schemas for Reparations Document Storage
 * Supports both MongoDB and PostgreSQL
 */

// ==================== MONGODB SCHEMA ====================

const mongooseSchema = {
    // Documents Collection
    documents: {
        // Unique identifier
        documentId: { type: String, required: true, unique: true, index: true },
        
        // Owner information
        owner: {
            name: { type: String, required: true, index: true },
            birthYear: { type: Number, index: true },
            deathYear: { type: Number, index: true },
            location: { type: String, index: true },
            familySearchId: { type: String, sparse: true }
        },
        
        // Document metadata
        document: {
            type: { type: String, enum: ['will', 'probate', 'census', 'slave_schedule', 'estate_inventory', 'correspondence', 'deed', 'other'], required: true, index: true },
            filename: { type: String, required: true },
            filePath: { type: String, required: true },
            relativePath: { type: String },
            fileSize: { type: Number },
            mimeType: { type: String },
            storedAt: { type: Date, default: Date.now }
        },
        
        // IPFS and blockchain
        ipfs: {
            hash: { type: String, required: true, unique: true, index: true }, // The immutable proof
            sha256: { type: String, required: true },
            gatewayUrl: { type: String },
            pinned: { type: Boolean, default: false },
            pinnedAt: { type: Date }
        },
        
        // OCR results
        ocr: {
            text: { type: String }, // Full extracted text
            confidence: { type: Number, min: 0, max: 1 },
            pageCount: { type: Number },
            service: { type: String, enum: ['google-vision', 'aws-textract', 'tesseract'] },
            processedAt: { type: Date }
        },
        
        // Enslaved people identified
        enslaved: {
            people: [{
                name: { type: String, required: true },
                gender: { type: String, enum: ['Male', 'Female', null] },
                age: { type: String }, // 'child', 'adult', or specific age
                source: { type: String }, // 'named_in_will', 'census', etc.
                familyRelationship: { type: String }, // 'wife', 'child', 'mother', etc.
                spouse: { type: String },
                parent: { type: String },
                bequeathedTo: { type: String }, // Heir who inherited them
                notes: { type: String }
            }],
            totalCount: { type: Number, required: true, index: true },
            namedCount: { type: Number },
            families: [{
                parents: [{ type: String }],
                children: [{ type: String }]
            }]
        },
        
        // Reparations calculation
        reparations: {
            total: { type: Number, required: true, index: true },
            perPerson: { type: Number },
            slaveCount: { type: Number },
            estimatedYears: { type: Number },
            breakdown: {
                wageTheft: { type: Number },
                damages: { type: Number },
                profitShare: { type: Number },
                compoundInterest: { type: Number },
                penalty: { type: Number }
            },
            byHeir: [{
                heir: { type: String },
                count: { type: Number },
                total: { type: Number },
                individuals: [{
                    name: { type: String },
                    amount: { type: Number }
                }]
            }],
            calculatedAt: { type: Date }
        },
        
        // Verification status
        verification: {
            status: { 
                type: String, 
                enum: ['pending', 'verified', 'disputed', 'rejected'], 
                default: 'pending',
                index: true
            },
            confidence: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW', 'GAP'] },
            needsHumanReview: { type: Boolean, default: true },
            reviewedBy: [{ type: String }],
            reviewNotes: [{ 
                reviewer: String, 
                note: String, 
                timestamp: Date 
            }],
            approvedAt: { type: Date }
        },
        
        // Blockchain submission
        blockchain: {
            submitted: { type: Boolean, default: false, index: true },
            transactionHash: { type: String, sparse: true },
            blockNumber: { type: Number },
            recordId: { type: String }, // Smart contract record ID
            submittedAt: { type: Date },
            networkId: { type: Number } // 1=mainnet, 5=goerli, etc.
        },
        
        // Research notes
        research: {
            citations: [{ type: String }],
            sources: [{ type: String }],
            gaps: [{
                type: { type: String },
                description: { type: String },
                priority: { type: String }
            }],
            additionalNotes: { type: String }
        },
        
        // Timestamps
        timestamps: {
            created: { type: Date, default: Date.now, index: true },
            updated: { type: Date, default: Date.now },
            lastAccessed: { type: Date }
        },
        
        // Uploader info
        uploadedBy: { type: String },
        
        // Tags for organization
        tags: [{ type: String, index: true }]
    }
};

// ==================== POSTGRESQL SCHEMA ====================

const postgresSchema = `
-- Main documents table
CREATE TABLE documents (
    document_id VARCHAR(255) PRIMARY KEY,
    
    -- Owner information
    owner_name VARCHAR(500) NOT NULL,
    owner_birth_year INTEGER,
    owner_death_year INTEGER,
    owner_location VARCHAR(500),
    owner_familysearch_id VARCHAR(255),
    
    -- Document metadata
    doc_type VARCHAR(50) NOT NULL,
    filename VARCHAR(500) NOT NULL,
    file_path TEXT NOT NULL,
    relative_path TEXT,
    file_size BIGINT,
    mime_type VARCHAR(100),
    stored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- IPFS and blockchain
    ipfs_hash VARCHAR(255) UNIQUE NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    ipfs_gateway_url TEXT,
    ipfs_pinned BOOLEAN DEFAULT FALSE,
    ipfs_pinned_at TIMESTAMP,
    
    -- OCR results
    ocr_text TEXT,
    ocr_confidence DECIMAL(3,2),
    ocr_page_count INTEGER,
    ocr_service VARCHAR(50),
    ocr_processed_at TIMESTAMP,
    
    -- Enslaved people counts
    total_enslaved INTEGER NOT NULL,
    named_enslaved INTEGER,
    
    -- Reparations
    total_reparations NUMERIC(20,2) NOT NULL,
    per_person_reparations NUMERIC(20,2),
    estimated_years INTEGER,
    
    -- Verification
    verification_status VARCHAR(50) DEFAULT 'pending',
    verification_confidence VARCHAR(20),
    needs_human_review BOOLEAN DEFAULT TRUE,
    approved_at TIMESTAMP,
    
    -- Blockchain
    blockchain_submitted BOOLEAN DEFAULT FALSE,
    blockchain_tx_hash VARCHAR(66),
    blockchain_block_number BIGINT,
    blockchain_record_id VARCHAR(255),
    blockchain_submitted_at TIMESTAMP,
    blockchain_network_id INTEGER,
    
    -- Metadata
    uploaded_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_owner_name (owner_name),
    INDEX idx_doc_type (doc_type),
    INDEX idx_verification_status (verification_status),
    INDEX idx_blockchain_submitted (blockchain_submitted),
    INDEX idx_created_at (created_at)
);

-- Enslaved people table (normalized)
CREATE TABLE enslaved_people (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    
    name VARCHAR(500) NOT NULL,
    gender VARCHAR(10),
    age VARCHAR(50),
    source VARCHAR(100),
    family_relationship VARCHAR(100),
    spouse VARCHAR(500),
    parent VARCHAR(500),
    bequeathed_to VARCHAR(500),
    notes TEXT,
    
    individual_reparations NUMERIC(20,2),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_document_id (document_id),
    INDEX idx_name (name),
    INDEX idx_bequeathed_to (bequeathed_to)
);

-- Family relationships table
CREATE TABLE families (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    
    parent1 VARCHAR(500),
    parent2 VARCHAR(500),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_document_id (document_id)
);

-- Family children junction table
CREATE TABLE family_children (
    family_id INTEGER REFERENCES families(id) ON DELETE CASCADE,
    child_name VARCHAR(500),
    
    PRIMARY KEY (family_id, child_name)
);

-- Verification reviews table
CREATE TABLE verification_reviews (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    
    reviewer VARCHAR(255) NOT NULL,
    decision VARCHAR(50) NOT NULL,
    notes TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_document_id (document_id),
    INDEX idx_reviewer (reviewer)
);

-- Research gaps table
CREATE TABLE research_gaps (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    
    gap_type VARCHAR(100) NOT NULL,
    description TEXT,
    priority VARCHAR(20),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_document_id (document_id),
    INDEX idx_priority (priority)
);

-- Citations table
CREATE TABLE citations (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    
    citation_text TEXT NOT NULL,
    source_type VARCHAR(100),
    url TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_document_id (document_id)
);

-- Reparations breakdown table
CREATE TABLE reparations_breakdown (
    document_id VARCHAR(255) PRIMARY KEY REFERENCES documents(document_id) ON DELETE CASCADE,
    
    wage_theft NUMERIC(20,2),
    damages NUMERIC(20,2),
    profit_share NUMERIC(20,2),
    compound_interest NUMERIC(20,2),
    penalty NUMERIC(20,2),
    
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Heirs and their shares
CREATE TABLE heir_shares (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    
    heir_name VARCHAR(500) NOT NULL,
    enslaved_count INTEGER,
    total_reparations NUMERIC(20,2),
    
    INDEX idx_document_id (document_id),
    INDEX idx_heir_name (heir_name)
);

-- Document tags
CREATE TABLE document_tags (
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    tag VARCHAR(100) NOT NULL,
    
    PRIMARY KEY (document_id, tag),
    INDEX idx_tag (tag)
);

-- Audit log for all changes
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    performed_by VARCHAR(255),
    details JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_document_id (document_id),
    INDEX idx_timestamp (timestamp)
);

-- Views for common queries

-- View: Owner summary
CREATE VIEW owner_summary AS
SELECT 
    owner_name,
    COUNT(*) as document_count,
    SUM(total_enslaved) as total_enslaved,
    SUM(total_reparations) as total_reparations,
    STRING_AGG(DISTINCT doc_type, ', ') as document_types,
    MAX(verification_status) as verification_status
FROM documents
GROUP BY owner_name;

-- View: Verification queue
CREATE VIEW verification_queue AS
SELECT 
    d.document_id,
    d.owner_name,
    d.doc_type,
    d.total_enslaved,
    d.total_reparations,
    d.verification_status,
    d.verification_confidence,
    d.created_at,
    COUNT(vr.id) as review_count
FROM documents d
LEFT JOIN verification_reviews vr ON d.document_id = vr.document_id
WHERE d.verification_status = 'pending'
GROUP BY d.document_id
ORDER BY d.created_at;

-- View: Blockchain submission queue
CREATE VIEW blockchain_queue AS
SELECT 
    document_id,
    owner_name,
    ipfs_hash,
    total_reparations,
    total_enslaved,
    verification_status,
    created_at
FROM documents
WHERE verification_status = 'verified'
  AND blockchain_submitted = FALSE
ORDER BY created_at;

-- View: Statistics dashboard
CREATE VIEW stats_dashboard AS
SELECT 
    COUNT(*) as total_documents,
    SUM(total_enslaved) as total_enslaved_counted,
    SUM(total_reparations) as total_reparations_calculated,
    AVG(total_reparations) as avg_reparations_per_document,
    COUNT(DISTINCT owner_name) as unique_owners,
    SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified_count,
    SUM(CASE WHEN blockchain_submitted THEN 1 ELSE 0 END) as blockchain_submitted_count,
    SUM(file_size) as total_storage_bytes
FROM documents;
`;

// ==================== DATABASE CONNECTION HELPERS ====================

// MongoDB Connection
const mongoConnection = `
const mongoose = require('mongoose');

async function connectMongoDB(uri) {
    try {
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✓ Connected to MongoDB');
        
        // Create indexes
        const Document = mongoose.model('Document', mongooseSchema.documents);
        await Document.createIndexes();
        
        return mongoose.connection;
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
}

module.exports = { connectMongoDB };
`;

// PostgreSQL Connection
const postgresConnection = `
const { Pool } = require('pg');

async function connectPostgreSQL(config) {
    const pool = new Pool({
        host: config.host || 'localhost',
        port: config.port || 5432,
        database: config.database || 'reparations',
        user: config.user,
        password: config.password
    });
    
    try {
        const client = await pool.connect();
        console.log('✓ Connected to PostgreSQL');
        client.release();
        return pool;
    } catch (error) {
        console.error('PostgreSQL connection error:', error);
        throw error;
    }
}

// Initialize schema
async function initializeSchema(pool) {
    const client = await pool.connect();
    try {
        await client.query(postgresSchema);
        console.log('✓ PostgreSQL schema initialized');
    } catch (error) {
        console.error('Schema initialization error:', error);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { connectPostgreSQL, initializeSchema };
`;

// ==================== EXAMPLE QUERIES ====================

const exampleQueries = {
    mongodb: {
        // Find all documents for an owner
        findByOwner: `
        db.documents.find({ 
            'owner.name': 'James Hopewell' 
        }).sort({ 'timestamps.created': -1 });
        `,
        
        // Find high-value reparations
        findHighValue: `
        db.documents.find({
            'reparations.total': { $gt: 50000000 }
        }).sort({ 'reparations.total': -1 });
        `,
        
        // Find documents needing verification
        findPendingVerification: `
        db.documents.find({
            'verification.status': 'pending',
            'verification.needsHumanReview': true
        }).sort({ 'timestamps.created': 1 });
        `,
        
        // Find by IPFS hash
        findByIPFS: `
        db.documents.findOne({ 
            'ipfs.hash': 'Qm...' 
        });
        `,
        
        // Aggregate reparations by owner
        aggregateByOwner: `
        db.documents.aggregate([
            {
                $group: {
                    _id: '$owner.name',
                    totalReparations: { $sum: '$reparations.total' },
                    totalEnslaved: { $sum: '$enslaved.totalCount' },
                    documentCount: { $sum: 1 }
                }
            },
            { $sort: { totalReparations: -1 } }
        ]);
        `
    },
    
    postgresql: {
        // Find all documents for an owner
        findByOwner: `
        SELECT * FROM documents 
        WHERE owner_name = 'James Hopewell' 
        ORDER BY created_at DESC;
        `,
        
        // Find high-value reparations
        findHighValue: `
        SELECT 
            document_id,
            owner_name,
            total_reparations,
            total_enslaved
        FROM documents 
        WHERE total_reparations > 50000000 
        ORDER BY total_reparations DESC;
        `,
        
        // Find documents needing verification
        findPendingVerification: `
        SELECT * FROM verification_queue;
        `,
        
        // Find by IPFS hash
        findByIPFS: `
        SELECT * FROM documents 
        WHERE ipfs_hash = 'Qm...';
        `,
        
        // Aggregate reparations by owner
        aggregateByOwner: `
        SELECT * FROM owner_summary 
        ORDER BY total_reparations DESC;
        `,
        
        // Get enslaved people with their families
        getWithFamilies: `
        SELECT 
            ep.*,
            f.parent1,
            f.parent2
        FROM enslaved_people ep
        LEFT JOIN families f ON ep.document_id = f.document_id
            AND (ep.parent = f.parent1 OR ep.parent = f.parent2)
        WHERE ep.document_id = 'doc_123';
        `,
        
        // Dashboard stats
        getStats: `
        SELECT * FROM stats_dashboard;
        `
    }
};

// Export everything
module.exports = {
    mongooseSchema,
    postgresSchema,
    mongoConnection,
    postgresConnection,
    exampleQueries
};
`;

await fs.writeFile(
    '/mnt/user-data/outputs/database-schemas.js',
    `/**
 * Database Schemas for Reparations Document Storage
 * Supports both MongoDB and PostgreSQL
 */

${postgresSchema}

// Export
module.exports = {
    postgresSchema
};
`
);
