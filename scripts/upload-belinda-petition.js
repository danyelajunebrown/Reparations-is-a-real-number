/**
 * Upload Belinda Sutton's Petition to S3
 * Creates multi-purpose evidence directory structure
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('../config');

async function uploadBelindaPetition() {
    console.log('[Upload] Starting Belinda Sutton petition upload...\n');

    // Initialize S3 client
    const s3Config = config.storage.s3;
    const s3Client = new S3Client({
        region: s3Config.region,
        credentials: {
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey
        }
    });

    const bucketName = s3Config.bucket;
    
    // Path to downloaded PDF
    const localPdfPath = '/Users/danyelabrown/Downloads/Belindas_Petition.pdf';
    
    // S3 destination path
    const s3Key = 'multi-purpose-evidence/belinda-sutton-case/1783-02-petition-original.pdf';
    
    try {
        // Read the PDF file
        console.log(`[Upload] Reading file: ${localPdfPath}`);
        const fileBuffer = fs.readFileSync(localPdfPath);
        const fileSize = fileBuffer.length;
        
        // Calculate SHA256 hash
        const hash = crypto.createHash('sha256');
        hash.update(fileBuffer);
        const sha256 = hash.digest('hex');
        
        console.log(`[Upload] File size: ${fileSize} bytes`);
        console.log(`[Upload] SHA256: ${sha256}`);
        
        // Upload to S3
        console.log(`[Upload] Uploading to S3: ${bucketName}/${s3Key}`);
        
        const uploadParams = {
            Bucket: bucketName,
            Key: s3Key,
            Body: fileBuffer,
            ContentType: 'application/pdf',
            Metadata: {
                'original-filename': 'Belindas_Petition.pdf',
                'document-type': 'reparations_petition',
                'petition-date': '1783-02-14',
                'petitioner': 'Belinda Sutton',
                'enslaver': 'Isaac Royall Jr',
                'jurisdiction': 'Massachusetts',
                'sha256': sha256,
                'evidence-type': 'multi-purpose', // proves enslavement + award + broken promise
                'proves-enslavement': 'true',
                'proves-debt-request': 'true',
                'proves-award-granted': 'true',
                'source': 'Royall House Museum',
                'archive-reference': 'SC1/series 45X, vol. 137, p. 285'
            }
        };
        
        const command = new PutObjectCommand(uploadParams);
        await s3Client.send(command);
        
        console.log('✅ Upload successful!\n');
        
        // Return document info
        const documentInfo = {
            filename: 'Belindas_Petition.pdf',
            s3Key: s3Key,
            s3Url: `https://${bucketName}.s3.${s3Config.region}.amazonaws.com/${s3Key}`,
            fileSize: fileSize,
            sha256: sha256,
            mimeType: 'application/pdf',
            documentType: 'original_petition',
            provesEnslavement: true,
            provesDebtRequest: true,
            provesAwardGranted: true,
            archiveSource: 'Massachusetts State Archives',
            archiveReference: 'SC1/series 45X, vol. 137, p. 285',
            originalUrl: 'https://royallhouse.org/wp-content/uploads/2013/11/Belindas_Petition.pdf'
        };
        
        console.log('[Upload] Document Information:');
        console.log('═══════════════════════════════════════════════════');
        console.log(`Filename: ${documentInfo.filename}`);
        console.log(`S3 Key: ${documentInfo.s3Key}`);
        console.log(`S3 URL: ${documentInfo.s3Url}`);
        console.log(`File Size: ${documentInfo.fileSize.toLocaleString()} bytes`);
        console.log(`SHA256: ${documentInfo.sha256}`);
        console.log(`Document Type: ${documentInfo.documentType}`);
        console.log(`Archive: ${documentInfo.archiveSource}`);
        console.log(`Reference: ${documentInfo.archiveReference}`);
        console.log(`\nEvidence Types:`);
        console.log(`  ✓ Proves enslavement`);
        console.log(`  ✓ Proves debt request`);
        console.log(`  ✓ Proves award granted`);
        console.log('═══════════════════════════════════════════════════\n');
        
        return documentInfo;
        
    } catch (error) {
        console.error('❌ Upload failed:', error.message);
        throw error;
    }
}

// Run if executed directly
if (require.main === module) {
    uploadBelindaPetition()
        .then((info) => {
            console.log('Upload completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { uploadBelindaPetition };
