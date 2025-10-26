// database.js
// PostgreSQL database connection and helper functions
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'reparations',
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
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
        console.log(`✓ Saved metadata for document ${metadata.documentId} to PostgreSQL`);
        
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
    const result = await
