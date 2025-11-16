// database.js - FIXED FOR RENDER
// This version works with both DATABASE_URL (Render) and individual variables (local dev)
require('dotenv').config();
const { Pool } = require('pg');

// Create pool connection - handles both Render and local development
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
        ? {
            rejectUnauthorized: false // Render's PostgreSQL uses internal SSL certs
          }
        : process.env.DB_SSL_REQUIRED === 'true'
          ? { rejectUnauthorized: false } // Only for local dev with self-signed certs
          : false
    })
  : new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT) || 5432,
      database: process.env.POSTGRES_DB || 'reparations',
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false } // Accept self-signed certs (same as DATABASE_URL path)
        : false
    });

pool.on('connect', () => {
    console.log('Ã¢Å“â€œ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('Unexpected database error on idle client:', err);

    // Log to error tracking service if configured
    if (process.env.SENTRY_DSN) {
        // Sentry.captureException(err);
    }

    // FIXED: Don't exit process - allow app to recover
    // The pool will attempt to reconnect automatically
    // Optionally implement circuit breaker pattern for repeated failures
});

// Helper function to execute queries
async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log('Executed query', { text: text.substring(0, 50), duration, rows: res.rowCount });
        return res;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

async function saveDocumentMetadata(metadata) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(`
            INSERT INTO documents (
                document_id, owner_name, owner_birth_year, owner_death_year,
                owner_location, doc_type, filename, file_path, relative_path,
                file_size, mime_type, ipfs_hash, sha256_hash, ipfs_gateway_url,
                ocr_text, ocr_confidence, ocr_page_count, ocr_service,
                total_enslaved, named_enslaved, total_reparations,
                per_person_reparations, estimated_years,
                verification_confidence, uploaded_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25
            )
        `, [
            metadata.documentId,
            metadata.ownerName || metadata.owner,  // FIXED: Accept both ownerName and owner
            metadata.ownerBirthYear || metadata.birthYear || null,
            metadata.ownerDeathYear || metadata.deathYear || null,
            metadata.ownerLocation || metadata.location || null,
            metadata.storage?.documentType || 'unknown',
            metadata.storage?.filename,
            metadata.storage?.filePath,
            metadata.storage?.relativePath,
            metadata.storage?.fileSize,
            metadata.storage?.mimeType,
            metadata.ipfs?.ipfsHash,
            metadata.ipfs?.sha256,
            metadata.ipfs?.ipfsGatewayUrl,
            metadata.ocr?.text,
            metadata.ocr?.confidence,
            metadata.ocr?.pageCount,
            metadata.ocr?.ocrService,
            metadata.enslaved?.totalCount || 0,
            metadata.enslaved?.namedIndividuals || 0,
            metadata.reparations?.total || 0,
            metadata.reparations?.perPerson || 0,
            metadata.reparations?.estimatedYears || 0,
            metadata.blockchain?.verificationLevel,
            metadata.uploadedBy || 'system'
        ]);
        
        if (metadata.enslaved?.people) {
            for (const person of metadata.enslaved.people) {
                await client.query(`
                    INSERT INTO enslaved_people (
                        document_id, name, gender, age, source,
                        family_relationship, spouse, parent, bequeathed_to,
                        notes, individual_reparations
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `, [
                    metadata.documentId,
                    person.name,
                    person.gender || null,
                    person.age || null,
                    person.source || null,
                    person.familyRelationship || null,
                    person.spouse || null,
                    person.parent || null,
                    person.bequeathedTo || null,
                    person.notes || null,
                    person.individualReparations || 0
                ]);
            }
        }
        
        if (metadata.enslaved?.families) {
            for (const family of metadata.enslaved.families) {
                const result = await client.query(`
                    INSERT INTO families (document_id, parent1, parent2)
                    VALUES ($1, $2, $3)
                    RETURNING id
                `, [
                    metadata.documentId,
                    family.parents[0] || null,
                    family.parents[1] || null
                ]);
                
                const familyId = result.rows[0].id;
                
                if (family.children) {
                    for (const child of family.children) {
                        await client.query(`
                            INSERT INTO family_children (family_id, child_name)
                            VALUES ($1, $2)
                        `, [familyId, child]);
                    }
                }
            }
        }
        
        if (metadata.reparations?.breakdown) {
            const b = metadata.reparations.breakdown;
            await client.query(`
                INSERT INTO reparations_breakdown (
                    document_id, wage_theft, damages, profit_share,
                    compound_interest, penalty
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                metadata.documentId,
                b.wageTheft || 0,
                b.damages || 0,
                b.profitShare || 0,
                b.compoundInterest || 0,
                b.penalty || 0
            ]);
        }
        
        await client.query('COMMIT');
        console.log(`Ã¢Å“â€œ Saved metadata for document ${metadata.documentId} to PostgreSQL`);
        
        return { success: true, documentId: metadata.documentId };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error saving document metadata:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function getDocumentById(documentId) {
    const result = await pool.query(
        'SELECT * FROM documents WHERE document_id = $1',
        [documentId]
    );
    return result.rows[0];
}

async function getDocumentsByOwner(ownerName) {
    const result = await pool.query(
        'SELECT * FROM documents WHERE owner_name = $1 ORDER BY created_at DESC',
        [ownerName]
    );
    return result.rows;
}

async function getEnslavedPeopleByDocument(documentId) {
    const result = await pool.query(
        'SELECT * FROM enslaved_people WHERE document_id = $1',
        [documentId]
    );
    return result.rows;
}

async function getStats() {
    const result = await pool.query('SELECT * FROM stats_dashboard');
    return result.rows[0];
}

async function getVerificationQueue() {
    const result = await pool.query('SELECT * FROM verification_queue');
    return result.rows;
}

async function getBlockchainQueue() {
    const result = await pool.query('SELECT * FROM blockchain_queue');
    return result.rows;
}

// Health check function
async function checkHealth() {
    try {
        const result = await pool.query('SELECT 1 as health');
        return { healthy: true, timestamp: new Date().toISOString() };
    } catch (err) {
        console.error('Database health check failed:', err);
        return { healthy: false, error: err.message, timestamp: new Date().toISOString() };
    }
}

// Export functions
module.exports = {
    pool,
    query,
    saveDocumentMetadata,
    saveDocument: saveDocumentMetadata, // Alias for compatibility with processor
    getDocumentById,
    getDocumentsByOwner,
    getEnslavedPeopleByDocument,
    getStats,
    getVerificationQueue,
    getBlockchainQueue,
    checkHealth
};
