-- Create documents table for document upload/storage functionality
CREATE TABLE IF NOT EXISTS documents (
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
    storage_type VARCHAR(20) DEFAULT 'local', -- 'local', 's3', 'ipfs'
    
    -- S3 specific
    s3_key TEXT,
    s3_bucket VARCHAR(255),
    
    -- IPFS and blockchain (optional)
    ipfs_hash VARCHAR(255) UNIQUE,
    sha256_hash VARCHAR(64),
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
    total_enslaved INTEGER NOT NULL DEFAULT 0,
    named_enslaved INTEGER,
    
    -- Reparations
    total_reparations NUMERIC(20,2) NOT NULL DEFAULT 0,
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_owner_name ON documents(owner_name);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_verification_status ON documents(verification_status);
CREATE INDEX IF NOT EXISTS idx_documents_blockchain_submitted ON documents(blockchain_submitted);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
CREATE INDEX IF NOT EXISTS idx_documents_storage_type ON documents(storage_type);
