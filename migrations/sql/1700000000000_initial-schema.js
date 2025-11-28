/**
 * Initial Database Schema Migration
 *
 * Creates all core tables for the reparations platform.
 */

exports.up = (pgm) => {
  // Documents table
  pgm.createTable('documents', {
    document_id: { type: 'varchar(255)', primaryKey: true },

    // Owner information
    owner_name: { type: 'varchar(500)', notNull: true },
    owner_birth_year: 'integer',
    owner_death_year: 'integer',
    owner_location: 'varchar(500)',
    owner_familysearch_id: 'varchar(255)',

    // Document metadata
    doc_type: { type: 'varchar(50)', notNull: true },
    filename: { type: 'varchar(500)', notNull: true },
    file_path: { type: 'text', notNull: true },
    relative_path: 'text',
    file_size: 'bigint',
    mime_type: 'varchar(100)',
    stored_at: { type: 'timestamp', default: pgm.func('current_timestamp') },

    // IPFS and blockchain
    ipfs_hash: 'varchar(255)',
    sha256_hash: { type: 'varchar(64)', notNull: true },
    ipfs_gateway_url: 'text',
    ipfs_pinned: { type: 'boolean', default: false },
    ipfs_pinned_at: 'timestamp',

    // OCR results
    ocr_text: 'text',
    ocr_confidence: 'decimal(3,2)',
    ocr_page_count: 'integer',
    ocr_service: 'varchar(50)',
    ocr_processed_at: 'timestamp',

    // Enslaved people counts
    total_enslaved: { type: 'integer', notNull: true },
    named_enslaved: 'integer',

    // Reparations
    total_reparations: { type: 'numeric(20,2)', notNull: true },
    per_person_reparations: 'numeric(20,2)',
    estimated_years: 'integer',

    // Verification
    verification_status: { type: 'varchar(50)', default: 'pending' },
    verification_confidence: 'varchar(20)',
    needs_human_review: { type: 'boolean', default: true },
    approved_at: 'timestamp',

    // Blockchain
    blockchain_submitted: { type: 'boolean', default: false },
    blockchain_tx_hash: 'varchar(66)',
    blockchain_block_number: 'bigint',
    blockchain_record_id: 'varchar(255)',
    blockchain_submitted_at: 'timestamp',
    blockchain_network_id: 'integer',

    // Metadata
    uploaded_by: 'varchar(255)',
    created_at: { type: 'timestamp', default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamp', default: pgm.func('current_timestamp') }
  });

  pgm.createIndex('documents', 'owner_name');
  pgm.createIndex('documents', 'doc_type');
  pgm.createIndex('documents', 'verification_status');
  pgm.createIndex('documents', 'blockchain_submitted');
  pgm.createIndex('documents', 'created_at');
  pgm.createIndex('documents', 'ipfs_hash', { unique: true, where: 'ipfs_hash IS NOT NULL' });

  // Enslaved people table
  pgm.createTable('enslaved_people', {
    id: 'id',
    document_id: {
      type: 'varchar(255)',
      notNull: true,
      references: 'documents(document_id)',
      onDelete: 'CASCADE'
    },
    name: { type: 'varchar(500)', notNull: true },
    gender: 'varchar(10)',
    age: 'varchar(50)',
    source: 'varchar(100)',
    family_relationship: 'varchar(100)',
    spouse: 'varchar(500)',
    parent: 'varchar(500)',
    bequeathed_to: 'varchar(500)',
    notes: 'text',
    individual_reparations: 'numeric(20,2)',
    created_at: { type: 'timestamp', default: pgm.func('current_timestamp') }
  });

  pgm.createIndex('enslaved_people', 'document_id');
  pgm.createIndex('enslaved_people', 'name');
  pgm.createIndex('enslaved_people', 'bequeathed_to');

  // Families table
  pgm.createTable('families', {
    id: 'id',
    document_id: {
      type: 'varchar(255)',
      notNull: true,
      references: 'documents(document_id)',
      onDelete: 'CASCADE'
    },
    parent1: 'varchar(500)',
    parent2: 'varchar(500)',
    created_at: { type: 'timestamp', default: pgm.func('current_timestamp') }
  });

  pgm.createIndex('families', 'document_id');

  // Family children table
  pgm.createTable('family_children', {
    family_id: {
      type: 'integer',
      notNull: true,
      references: 'families(id)',
      onDelete: 'CASCADE'
    },
    child_name: { type: 'varchar(500)', notNull: true }
  });

  pgm.addConstraint('family_children', 'family_children_pkey', {
    primaryKey: ['family_id', 'child_name']
  });

  // Reparations breakdown table
  pgm.createTable('reparations_breakdown', {
    id: 'id',
    document_id: {
      type: 'varchar(255)',
      notNull: true,
      references: 'documents(document_id)',
      onDelete: 'CASCADE'
    },
    wage_theft: 'numeric(20,2)',
    damages: 'numeric(20,2)',
    profit_share: 'numeric(20,2)',
    compound_interest: 'numeric(20,2)',
    penalty: 'numeric(20,2)',
    created_at: { type: 'timestamp', default: pgm.func('current_timestamp') }
  });

  pgm.createIndex('reparations_breakdown', 'document_id');

  // Individuals table (verified genealogical records)
  pgm.createTable('individuals', {
    id: 'id',
    full_name: { type: 'varchar(500)', notNull: true },
    birth_year: 'integer',
    death_year: 'integer',
    gender: 'varchar(10)',
    locations: 'jsonb',
    spouses: 'jsonb',
    children: 'jsonb',
    parents: 'jsonb',
    notes: 'text',
    source_type: { type: 'varchar(50)', default: 'document' },
    created_at: { type: 'timestamp', default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamp', default: pgm.func('current_timestamp') }
  });

  pgm.createIndex('individuals', 'full_name');
  pgm.createIndex('individuals', ['birth_year', 'death_year']);

  // Document-Individual linkage
  pgm.createTable('document_individuals', {
    id: 'id',
    document_id: {
      type: 'varchar(255)',
      notNull: true,
      references: 'documents(document_id)',
      onDelete: 'CASCADE'
    },
    individual_id: {
      type: 'integer',
      notNull: true,
      references: 'individuals(id)',
      onDelete: 'CASCADE'
    },
    relationship: 'varchar(100)',
    confidence_score: { type: 'integer', default: 100 },
    notes: 'text',
    created_at: { type: 'timestamp', default: pgm.func('current_timestamp') }
  });

  pgm.createIndex('document_individuals', 'document_id');
  pgm.createIndex('document_individuals', 'individual_id');

  // Verification reviews
  pgm.createTable('verification_reviews', {
    id: 'id',
    document_id: {
      type: 'varchar(255)',
      notNull: true,
      references: 'documents(document_id)',
      onDelete: 'CASCADE'
    },
    reviewer: { type: 'varchar(255)', notNull: true },
    decision: { type: 'varchar(50)', notNull: true },
    notes: 'text',
    timestamp: { type: 'timestamp', default: pgm.func('current_timestamp') }
  });

  pgm.createIndex('verification_reviews', 'document_id');
  pgm.createIndex('verification_reviews', 'reviewer');

  // Create useful views
  pgm.createView('stats_dashboard', {}, `
    SELECT
      COUNT(DISTINCT document_id) as total_documents,
      COUNT(DISTINCT owner_name) as total_owners,
      SUM(total_enslaved) as total_enslaved,
      SUM(total_reparations) as total_reparations,
      AVG(ocr_confidence) as avg_ocr_confidence,
      COUNT(*) FILTER (WHERE verification_status = 'verified') as verified_documents,
      COUNT(*) FILTER (WHERE blockchain_submitted = true) as blockchain_submitted
    FROM documents
  `);

  pgm.createView('verification_queue', {}, `
    SELECT
      document_id,
      owner_name,
      doc_type,
      total_enslaved,
      total_reparations,
      ocr_confidence,
      verification_status,
      created_at
    FROM documents
    WHERE verification_status = 'pending'
      AND needs_human_review = true
    ORDER BY created_at ASC
  `);

  pgm.createView('blockchain_queue', {}, `
    SELECT
      document_id,
      owner_name,
      total_enslaved,
      total_reparations,
      ipfs_hash,
      sha256_hash,
      verification_status,
      created_at
    FROM documents
    WHERE verification_status = 'verified'
      AND blockchain_submitted = false
    ORDER BY created_at ASC
  `);
};

exports.down = (pgm) => {
  // Drop views
  pgm.dropView('blockchain_queue');
  pgm.dropView('verification_queue');
  pgm.dropView('stats_dashboard');

  // Drop tables in reverse order (respecting foreign keys)
  pgm.dropTable('verification_reviews');
  pgm.dropTable('document_individuals');
  pgm.dropTable('individuals');
  pgm.dropTable('reparations_breakdown');
  pgm.dropTable('family_children');
  pgm.dropTable('families');
  pgm.dropTable('enslaved_people');
  pgm.dropTable('documents');
};
