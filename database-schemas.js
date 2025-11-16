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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_owner_name ON documents(owner_name);
CREATE INDEX idx_doc_type ON documents(doc_type);
CREATE INDEX idx_verification_status ON documents(verification_status);
CREATE INDEX idx_blockchain_submitted ON documents(blockchain_submitted);
CREATE INDEX idx_created_at ON documents(created_at);

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

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_enslaved_people_document_id ON enslaved_people(document_id);
CREATE INDEX idx_enslaved_people_name ON enslaved_people(name);
CREATE INDEX idx_enslaved_people_bequeathed_to ON enslaved_people(bequeathed_to);

-- Family relationships table
CREATE TABLE families (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    
    parent1 VARCHAR(500),
    parent2 VARCHAR(500),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_families_document_id ON families(document_id);

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
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_verification_reviews_document_id ON verification_reviews(document_id);
CREATE INDEX idx_verification_reviews_reviewer ON verification_reviews(reviewer);

-- Research gaps table
CREATE TABLE research_gaps (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    
    gap_type VARCHAR(100) NOT NULL,
    description TEXT,
    priority VARCHAR(20),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_research_gaps_document_id ON research_gaps(document_id);
CREATE INDEX idx_research_gaps_priority ON research_gaps(priority);

-- Citations table
CREATE TABLE citations (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    
    citation_text TEXT NOT NULL,
    source_type VARCHAR(100),
    url TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_citations_document_id ON citations(document_id);

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
    total_reparations NUMERIC(20,2)
);

CREATE INDEX idx_heir_shares_document_id ON heir_shares(document_id);
CREATE INDEX idx_heir_shares_heir_name ON heir_shares(heir_name);

-- Document tags
CREATE TABLE document_tags (
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    tag VARCHAR(100) NOT NULL,

    PRIMARY KEY (document_id, tag)
);

CREATE INDEX idx_document_tags_tag ON document_tags(tag);

-- ==================== INDIVIDUAL ENTITY TRACKING ====================

-- Individual slaveowners table (unified entity tracking)
CREATE TABLE individuals (
    individual_id VARCHAR(255) PRIMARY KEY,

    -- Personal information
    full_name VARCHAR(500) NOT NULL,
    birth_year INTEGER,
    death_year INTEGER,
    gender VARCHAR(20),

    -- Locations (can be multiple, comma-separated or JSON array)
    locations TEXT,

    -- Family connections
    spouse_ids TEXT[], -- Array of individual_ids
    parent_ids TEXT[], -- Array of individual_ids
    child_ids TEXT[], -- Array of individual_ids

    -- External IDs
    familysearch_id VARCHAR(255),
    ancestry_id VARCHAR(255),

    -- Aggregated stats
    total_documents INTEGER DEFAULT 0,
    total_enslaved INTEGER DEFAULT 0,
    total_reparations NUMERIC(20,2) DEFAULT 0,

    -- Metadata
    verified BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_individuals_full_name ON individuals(full_name);
CREATE INDEX idx_individuals_birth_year ON individuals(birth_year);
CREATE INDEX idx_individuals_death_year ON individuals(death_year);
CREATE INDEX idx_individuals_verified ON individuals(verified);

-- Relationships between individuals (more detailed than arrays)
CREATE TABLE individual_relationships (
    id SERIAL PRIMARY KEY,

    individual_id_1 VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE CASCADE,
    individual_id_2 VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE CASCADE,

    -- Relationship type: 'parent-child', 'spouse', 'sibling', 'heir-benefactor', 'neighbor', 'business-partner'
    relationship_type VARCHAR(50) NOT NULL,

    -- For directed relationships (e.g., parent->child, benefactor->heir)
    -- individual_id_1 is the source, individual_id_2 is the target
    is_directed BOOLEAN DEFAULT FALSE,

    -- Source of this relationship information
    source_document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE SET NULL,
    source_type VARCHAR(100), -- 'will', 'census', 'deed', 'inference'

    -- Confidence and verification
    confidence DECIMAL(3,2) DEFAULT 1.00,
    verified BOOLEAN DEFAULT FALSE,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_individual_relationships_individual_1 ON individual_relationships(individual_id_1);
CREATE INDEX idx_individual_relationships_individual_2 ON individual_relationships(individual_id_2);
CREATE INDEX idx_individual_relationships_type ON individual_relationships(relationship_type);
CREATE INDEX idx_individual_relationships_source_doc ON individual_relationships(source_document_id);

-- Junction table: which individuals are mentioned in which documents
CREATE TABLE document_individuals (
    document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE CASCADE,
    individual_id VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE CASCADE,

    -- Role in this document: 'owner', 'heir', 'witness', 'neighbor', 'executor'
    role_in_document VARCHAR(50) NOT NULL,

    -- For heirs: how many enslaved people they inherited
    inherited_enslaved_count INTEGER,
    inherited_reparations NUMERIC(20,2),

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (document_id, individual_id, role_in_document)
);

CREATE INDEX idx_document_individuals_document_id ON document_individuals(document_id);
CREATE INDEX idx_document_individuals_individual_id ON document_individuals(individual_id);
CREATE INDEX idx_document_individuals_role ON document_individuals(role_in_document);

-- ==================== ENSLAVED PERSON DESCENDANT TRACKING ====================

-- Enslaved person entities (similar to individuals but for enslaved people)
CREATE TABLE enslaved_individuals (
    enslaved_id VARCHAR(255) PRIMARY KEY,

    -- Personal information
    full_name VARCHAR(500) NOT NULL,
    birth_year INTEGER,
    death_year INTEGER,
    gender VARCHAR(20),

    -- Original enslavement info
    enslaved_by_individual_id VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE SET NULL,
    freedom_year INTEGER,

    -- Family connections (descendant tracking)
    spouse_ids TEXT[],
    parent_ids TEXT[],
    child_ids TEXT[],

    -- External IDs
    familysearch_id VARCHAR(255),
    ancestry_id VARCHAR(255),

    -- Reparations owed to this individual
    direct_reparations NUMERIC(20,2) DEFAULT 0,
    inherited_reparations NUMERIC(20,2) DEFAULT 0, -- From ancestors
    total_reparations_owed NUMERIC(20,2) DEFAULT 0,

    -- Payment tracking
    amount_paid NUMERIC(20,2) DEFAULT 0,
    amount_outstanding NUMERIC(20,2) DEFAULT 0,

    -- Metadata
    verified BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_enslaved_individuals_full_name ON enslaved_individuals(full_name);
CREATE INDEX idx_enslaved_individuals_enslaved_by ON enslaved_individuals(enslaved_by_individual_id);
CREATE INDEX idx_enslaved_individuals_verified ON enslaved_individuals(verified);

-- Relationships between enslaved individuals
CREATE TABLE enslaved_relationships (
    id SERIAL PRIMARY KEY,

    enslaved_id_1 VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id) ON DELETE CASCADE,
    enslaved_id_2 VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id) ON DELETE CASCADE,

    relationship_type VARCHAR(50) NOT NULL, -- 'parent-child', 'spouse', 'sibling'
    is_directed BOOLEAN DEFAULT FALSE,

    source_document_id VARCHAR(255) REFERENCES documents(document_id) ON DELETE SET NULL,
    source_type VARCHAR(100),

    confidence DECIMAL(3,2) DEFAULT 1.00,
    verified BOOLEAN DEFAULT FALSE,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_enslaved_relationships_id_1 ON enslaved_relationships(enslaved_id_1);
CREATE INDEX idx_enslaved_relationships_id_2 ON enslaved_relationships(enslaved_id_2);
CREATE INDEX idx_enslaved_relationships_type ON enslaved_relationships(relationship_type);

-- Descendant debt tracking (for slaveowner descendants)
CREATE TABLE descendant_debt (
    id SERIAL PRIMARY KEY,

    -- The descendant who inherited the debt
    descendant_individual_id VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE CASCADE,

    -- The original perpetrator
    perpetrator_individual_id VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE CASCADE,

    -- Generational distance (1 = child, 2 = grandchild, etc.)
    generation_distance INTEGER NOT NULL,

    -- Debt calculations
    original_debt NUMERIC(20,2) NOT NULL, -- Debt from perpetrator
    inherited_portion NUMERIC(20,2) NOT NULL, -- This descendant's share
    inheritance_factor DECIMAL(5,4) DEFAULT 1.0, -- Multiplier based on distance/siblings

    -- Payment tracking
    amount_paid NUMERIC(20,2) DEFAULT 0,
    amount_outstanding NUMERIC(20,2) NOT NULL,

    -- Metadata
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_descendant_debt_descendant ON descendant_debt(descendant_individual_id);
CREATE INDEX idx_descendant_debt_perpetrator ON descendant_debt(perpetrator_individual_id);
CREATE INDEX idx_descendant_debt_outstanding ON descendant_debt(amount_outstanding);

-- Reparations credit tracking (for enslaved person descendants)
CREATE TABLE reparations_credit (
    id SERIAL PRIMARY KEY,

    -- The descendant who inherited the credit
    descendant_enslaved_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id) ON DELETE CASCADE,

    -- The original enslaved ancestor
    ancestor_enslaved_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id) ON DELETE CASCADE,

    -- Generational distance
    generation_distance INTEGER NOT NULL,

    -- Credit calculations
    original_credit NUMERIC(20,2) NOT NULL, -- Reparations owed to ancestor
    inherited_portion NUMERIC(20,2) NOT NULL, -- This descendant's share
    inheritance_factor DECIMAL(5,4) DEFAULT 1.0,

    -- Payment tracking
    amount_received NUMERIC(20,2) DEFAULT 0,
    amount_outstanding NUMERIC(20,2) NOT NULL,

    -- Metadata
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reparations_credit_descendant ON reparations_credit(descendant_enslaved_id);
CREATE INDEX idx_reparations_credit_ancestor ON reparations_credit(ancestor_enslaved_id);
CREATE INDEX idx_reparations_credit_outstanding ON reparations_credit(amount_outstanding);

-- Blockchain payment ledger
CREATE TABLE payment_ledger (
    id SERIAL PRIMARY KEY,

    -- Payment details
    payment_type VARCHAR(50) NOT NULL, -- 'debt_payment', 'reparations_payment'
    amount NUMERIC(20,2) NOT NULL,

    -- Payer (slaveowner descendant)
    payer_individual_id VARCHAR(255) REFERENCES individuals(individual_id) ON DELETE SET NULL,

    -- Recipient (enslaved person descendant)
    recipient_enslaved_id VARCHAR(255) REFERENCES enslaved_individuals(enslaved_id) ON DELETE SET NULL,

    -- Links to debt/credit records
    descendant_debt_id INTEGER REFERENCES descendant_debt(id) ON DELETE SET NULL,
    reparations_credit_id INTEGER REFERENCES reparations_credit(id) ON DELETE SET NULL,

    -- Blockchain info
    blockchain_tx_hash VARCHAR(66),
    blockchain_block_number BIGINT,
    blockchain_network_id INTEGER,

    -- Metadata
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE INDEX idx_payment_ledger_payer ON payment_ledger(payer_individual_id);
CREATE INDEX idx_payment_ledger_recipient ON payment_ledger(recipient_enslaved_id);
CREATE INDEX idx_payment_ledger_tx_hash ON payment_ledger(blockchain_tx_hash);

-- Audit log for all changes
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    performed_by VARCHAR(255),
    details JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_document_id ON audit_log(document_id);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);

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

-- View: Individual entity network
CREATE VIEW individual_network AS
SELECT
    i.individual_id,
    i.full_name,
    i.birth_year,
    i.death_year,
    i.locations,
    i.total_documents,
    i.total_enslaved,
    i.total_reparations,
    COUNT(DISTINCT ir.id) as relationship_count,
    STRING_AGG(DISTINCT di.role_in_document, ', ') as document_roles
FROM individuals i
LEFT JOIN individual_relationships ir
    ON i.individual_id = ir.individual_id_1
    OR i.individual_id = ir.individual_id_2
LEFT JOIN document_individuals di
    ON i.individual_id = di.individual_id
GROUP BY i.individual_id;
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
