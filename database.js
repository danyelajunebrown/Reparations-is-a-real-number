// database.js - COMPLETE VERSION
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
    } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
    console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

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
            metadata.owner,
            metadata.ownerBirthYear || null,
            metadata.ownerDeathYear || null,
            metadata.ownerLocation || null,
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
        
        await client.query('COMMIT');
        console.log(`✓ Saved metadata for document ${metadata.documentId}`);
        
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
    try {
        const result = await pool.query('SELECT * FROM stats_dashboard');
        return result.rows[0];
    } catch (error) {
        console.error('Error fetching stats:', error);
        return {
            total_documents: 0,
            total_enslaved_counted: 0,
            total_reparations_calculated: 0,
            unique_owners: 0
        };
    }
}

async function getVerificationQueue() {
    const result = await pool.query('SELECT * FROM verification_queue');
    return result.rows;
}

async function getBlockchainQueue() {
    const result = await pool.query('SELECT * FROM blockchain_queue');
    return result.rows;
}

module.exports = {
    pool,
    saveDocumentMetadata,
    getDocumentById,
    getDocumentsByOwner,
    getEnslavedPeopleByDocument,
    getStats,
    getVerificationQueue,
    getBlockchainQueue,
    query: (text, params) => pool.query(text, params)
};
