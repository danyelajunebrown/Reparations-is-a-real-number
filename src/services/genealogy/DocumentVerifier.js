/**
 * DocumentVerifier Service
 * 
 * Verifies slaveholder matches by checking for supporting documents:
 * 1. Documents table (wills, deeds, slave schedules)
 * 2. Person_documents junction table (S3 archived documents)
 * 3. S3 bucket existence checks
 * 4. Enslaved persons extraction from documents
 * 5. Inheritance path verification
 * 
 * This elevates matches from "unverified" to "documented" when primary sources exist.
 */

const { neon } = require('@neondatabase/serverless');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');

class DocumentVerifier {
    constructor(databaseUrl, s3Config = {}) {
        this.sql = neon(databaseUrl);
        
        // S3 client (optional - only if checking S3 existence)
        this.s3Client = null;
        if (s3Config.bucket) {
            this.s3Client = new S3Client({
                region: s3Config.region || 'us-east-1',
                credentials: s3Config.credentials
            });
            this.s3Bucket = s3Config.bucket;
        }
    }

    /**
     * Main verification method
     * 
     * @param {string} slaveholderName - Name of slaveholder to verify
     * @param {string} modernPersonName - Name of modern descendant
     * @param {Array<string>} lineagePath - Array of ancestor names from modern to slaveholder
     * @returns {Object} Verification result with document evidence
     */
    async verifyMatch(slaveholderName, modernPersonName, lineagePath) {
        const result = {
            slaveholderName,
            modernPersonName,
            hasDocuments: false,
            documentCount: 0,
            documentTypes: [],
            documents: [],
            enslavedPersonsDocumented: [],
            inheritanceVerified: false,
            verificationLevel: 'unverified', // 'unverified', 'partial', 'documented'
            verificationDetails: []
        };

        try {
            // 1. Find documents in documents table
            const documents = await this.findDocuments(slaveholderName);
            if (documents.length > 0) {
                result.hasDocuments = true;
                result.documentCount = documents.length;
                result.documents = documents;
                result.documentTypes = [...new Set(documents.map(d => d.doc_type))];
                result.verificationDetails.push(`Found ${documents.length} document(s) in database`);
            }

            // 2. Find archived documents via person_documents junction
            const archivedDocs = await this.findArchivedDocs(slaveholderName);
            if (archivedDocs.length > 0) {
                result.hasDocuments = true;
                result.documentCount += archivedDocs.length;
                result.documents.push(...archivedDocs);
                result.verificationDetails.push(`Found ${archivedDocs.length} archived document(s)`);
            }

            // 3. Check S3 standard paths (if S3 client configured)
            if (this.s3Client) {
                const s3Docs = await this.checkS3Documents(slaveholderName);
                if (s3Docs.length > 0) {
                    result.hasDocuments = true;
                    result.verificationDetails.push(`Found ${s3Docs.length} S3 document(s)`);
                    result.documents.push(...s3Docs);
                }
            }

            // 4. Extract enslaved persons from documents (if any found)
            if (result.hasDocuments) {
                const enslaved = await this.getEnslavedFromDocs(documents);
                result.enslavedPersonsDocumented = enslaved;
                if (enslaved.length > 0) {
                    result.verificationDetails.push(`Documented ${enslaved.length} enslaved person(s)`);
                }
            }

            // 5. Verify inheritance path
            if (lineagePath && lineagePath.length > 0 && result.enslavedPersonsDocumented.length > 0) {
                const inheritanceLink = await this.verifyInheritancePath(
                    lineagePath,
                    result.enslavedPersonsDocumented,
                    slaveholderName
                );
                
                if (inheritanceLink) {
                    result.inheritanceVerified = true;
                    result.verificationDetails.push(inheritanceLink.description);
                }
            }

            // 6. Determine verification level
            if (result.inheritanceVerified && result.enslavedPersonsDocumented.length > 0) {
                result.verificationLevel = 'documented'; // Best: inheritance + enslaved persons
            } else if (result.hasDocuments && result.documentTypes.includes('will')) {
                result.verificationLevel = 'documented'; // Has will (primary source)
            } else if (result.hasDocuments) {
                result.verificationLevel = 'partial'; // Has docs but no will or inheritance
            }

        } catch (error) {
            result.error = error.message;
            result.verificationDetails.push(`Error during verification: ${error.message}`);
        }

        return result;
    }

    /**
     * Find documents by slaveholder name in documents table
     */
    async findDocuments(slaveholderName) {
        try {
            const docs = await this.sql`
                SELECT 
                    document_id,
                    owner_name,
                    doc_type,
                    file_path,
                    s3_key,
                    ocr_text,
                    ocr_confidence,
                    verification_status,
                    created_at
                FROM documents
                WHERE LOWER(owner_name) = LOWER(${slaveholderName})
                ORDER BY 
                    CASE doc_type
                        WHEN 'will' THEN 1
                        WHEN 'deed' THEN 2
                        WHEN 'slave_schedule' THEN 3
                        ELSE 4
                    END,
                    created_at DESC
                LIMIT 10
            `;
            return docs || [];
        } catch (e) {
            console.error('Error finding documents:', e.message);
            return [];
        }
    }

    /**
     * Find archived documents via person_documents junction table
     */
    async findArchivedDocs(slaveholderName) {
        try {
            const docs = await this.sql`
                SELECT DISTINCT
                    pd.archive_url,
                    pd.document_type,
                    pd.document_date,
                    pd.notes
                FROM person_documents pd
                WHERE LOWER(pd.person_name) = LOWER(${slaveholderName})
                ORDER BY pd.document_date DESC
                LIMIT 10
            `;
            return docs || [];
        } catch (e) {
            console.error('Error finding archived docs:', e.message);
            return [];
        }
    }

    /**
     * Check S3 for standard document paths
     * 
     * Checks: owners/{Name}/will/, /deed/, /schedule/
     */
    async checkS3Documents(slaveholderName) {
        if (!this.s3Client) return [];

        const docs = [];
        const sanitizedName = slaveholderName.replace(/[^a-zA-Z0-9-]/g, '-');
        const docTypes = ['will', 'deed', 'schedule'];

        for (const docType of docTypes) {
            const key = `owners/${sanitizedName}/${docType}/`;
            
            try {
                const command = new HeadObjectCommand({
                    Bucket: this.s3Bucket,
                    Key: key
                });
                
                await this.s3Client.send(command);
                docs.push({
                    s3_key: key,
                    doc_type: docType,
                    source: 's3_check',
                    exists: true
                });
            } catch (e) {
                // Object doesn't exist - that's fine
            }
        }

        return docs;
    }

    /**
     * Extract enslaved persons from documents
     * 
     * Looks for enslaved persons mentioned in wills, deeds, slave schedules
     */
    async getEnslavedFromDocs(documents) {
        const enslaved = [];

        for (const doc of documents) {
            try {
                // Check if we have enslaved persons linked to this document
                const linkedEnslaved = await this.sql`
                    SELECT 
                        full_name,
                        person_type,
                        confidence_score,
                        source_url
                    FROM unconfirmed_persons
                    WHERE source_url LIKE ${`%${doc.document_id}%`}
                    AND person_type IN ('enslaved', 'suspected_enslaved')
                    LIMIT 20
                `;

                enslaved.push(...linkedEnslaved);

                // Also check enslaved_individuals table for confirmed records
                if (doc.owner_name) {
                    const confirmed = await this.sql`
                        SELECT 
                            name as full_name,
                            'enslaved' as person_type,
                            1.0 as confidence_score,
                            document_id as source_url
                        FROM enslaved_individuals
                        WHERE enslaved_by_name = ${doc.owner_name}
                        LIMIT 20
                    `;
                    enslaved.push(...confirmed);
                }
            } catch (e) {
                console.error('Error getting enslaved from doc:', e.message);
            }
        }

        // Deduplicate by name
        const seen = new Set();
        return enslaved.filter(person => {
            if (seen.has(person.full_name.toLowerCase())) return false;
            seen.add(person.full_name.toLowerCase());
            return true;
        });
    }

    /**
     * Verify inheritance path through lineage
     * 
     * Checks if any ancestor in the lineage path appears in inheritance documents
     * (wills, estate records) connecting to the slaveholder
     */
    async verifyInheritancePath(lineagePath, enslavedPersons, slaveholderName) {
        // Check each ancestor in the path (except the first - modern person)
        for (let i = 1; i < lineagePath.length - 1; i++) {
            const ancestor = lineagePath[i];
            
            try {
                // Look for inheritance documents mentioning this ancestor
                const inheritanceDocs = await this.sql`
                    SELECT 
                        document_id,
                        owner_name,
                        doc_type,
                        ocr_text
                    FROM documents
                    WHERE doc_type IN ('will', 'estate', 'inventory', 'probate')
                    AND (
                        LOWER(owner_name) = LOWER(${slaveholderName})
                        OR ocr_text ILIKE ${`%${ancestor}%`}
                    )
                    LIMIT 5
                `;

                if (inheritanceDocs.length > 0) {
                    // Check if enslaved persons are mentioned in these docs
                    for (const doc of inheritanceDocs) {
                        if (!doc.ocr_text) continue;
                        
                        const ocrLower = doc.ocr_text.toLowerCase();
                        const matchingEnslaved = enslavedPersons.filter(person => 
                            ocrLower.includes(person.full_name.toLowerCase())
                        );

                        if (matchingEnslaved.length > 0) {
                            return {
                                verified: true,
                                ancestorName: ancestor,
                                documentId: doc.document_id,
                                documentType: doc.doc_type,
                                enslavedMatched: matchingEnslaved.map(p => p.full_name),
                                description: `Inheritance verified: ${ancestor} appears in ${doc.doc_type} (${doc.document_id}) with ${matchingEnslaved.length} enslaved person(s)`
                            };
                        }
                    }
                }
            } catch (e) {
                console.error('Error verifying inheritance:', e.message);
            }
        }

        return null;
    }

    /**
     * Quick check: Does this slaveholder have any documents?
     * 
     * Faster than full verification - just returns boolean
     */
    async hasDocuments(slaveholderName) {
        try {
            const count = await this.sql`
                SELECT COUNT(*) as count
                FROM documents
                WHERE LOWER(owner_name) = LOWER(${slaveholderName})
            `;
            return count[0]?.count > 0;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get verification summary for multiple slaveholders
     * 
     * Useful for batch processing matches
     */
    async verifyBatch(slaveholderNames) {
        const results = [];
        
        for (const name of slaveholderNames) {
            const verification = await this.verifyMatch(name, null, []);
            results.push({
                name,
                hasDocuments: verification.hasDocuments,
                verificationLevel: verification.verificationLevel,
                documentCount: verification.documentCount
            });
        }

        return results;
    }
}

module.exports = DocumentVerifier;
