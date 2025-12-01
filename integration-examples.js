/**
 * Complete Integration Example
 * Shows how to use the Enhanced Document Processor with your reparations system
 * 
 * Flow: Upload → Process → Store → Database → Blockchain
 */

const EnhancedDocumentProcessor = require('./enhanced-document-processor');
const ReparationsCalculator = require('./reparations-calculator');
const { Pool } = require('pg'); // or mongoose for MongoDB

// ==================== SETUP ====================

async function setupSystem() {
    console.log('🚀 Initializing Reparations Document Processing System...\n');
    
    // 1. Initialize database
    const db = new Pool({
        host: 'localhost',
        database: 'reparations',
        user: 'your_user',
        password: 'your_password'
    });
    
    // 2. Initialize reparations calculator
    const reparationsCalculator = new ReparationsCalculator({
        baseYear: 1800,
        currentYear: 2024,
        inflationRate: 0.035,
        dailyWageBase: 120
    });
    
    // 3. Initialize document processor
    const processor = new EnhancedDocumentProcessor({
        storageRoot: './storage',
        googleVisionApiKey: process.env.GOOGLE_VISION_API_KEY,
        reparationsCalculator: reparationsCalculator,
        database: db
    });
    
    return { processor, reparationsCalculator, db };
}

// ==================== EXAMPLE 1: Process James Hopewell Will ====================

async function example1_ProcessJamesHopewellWill() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('EXAMPLE 1: Processing James Hopewell Will (1811)');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const { processor, db } = await setupSystem();
    
    // Simulate uploaded file (in real app, this comes from Express/multer)
    const uploadedFile = {
        path: '/mnt/user-data/uploads/Transcript.pdf',
        originalname: 'james-hopewell-will-1811.pdf',
        mimetype: 'application/pdf',
        size: 2485760 // ~2.5MB
    };
    
    const metadata = {
        ownerName: 'James Hopewell',
        birthYear: 1760,
        deathYear: 1816,
        location: 'St. Mary\'s County, Maryland',
        documentType: 'will',
        uploadedBy: 'researcher@genealogy.org'
    };
    
    // Process the document
    const result = await processor.processDocument(uploadedFile, metadata);
    
    if (result.success) {
        console.log('\n✅ PROCESSING COMPLETE!\n');
        console.log('📊 Results:');
        console.log(`   Document ID: ${result.documentId}`);
        console.log(`   IPFS Hash: ${result.stages.ipfs.ipfsHash}`);
        console.log(`   Enslaved People: ${result.stages.parsing.totalCount}`);
        console.log(`   Named Individuals: ${result.stages.parsing.namedIndividuals}`);
        console.log(`   Total Reparations: $${result.stages.reparations.total.toLocaleString()}`);
        console.log(`   Per Person: $${result.stages.reparations.perPerson.toLocaleString()}`);
        console.log(`   Processing Time: ${result.processingTime}ms`);
        
        // Show breakdown by heir
        console.log('\n💰 Reparations by Heir:');
        result.stages.reparations.byHeir.forEach(heir => {
            console.log(`   ${heir.heir}: $${heir.total.toLocaleString()} (${heir.count} people)`);
        });
        
        // Show blockchain payload
        console.log('\n⛓️  Blockchain Payload:');
        console.log(`   Ancestor: ${result.stages.blockchain.ancestorName}`);
        console.log(`   Genealogy Hash: ${result.stages.blockchain.genealogyHash}`);
        console.log(`   Total Owed: $${result.stages.blockchain.totalReparationsOwed.toLocaleString()}`);
        console.log(`   Verification Level: ${result.stages.blockchain.verificationLevel}`);
        
        return result;
    } else {
        console.error('❌ Processing failed:', result.error);
    }
}

// ==================== EXAMPLE 2: Batch Process Multiple Documents ====================

async function example2_BatchProcessing() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('EXAMPLE 2: Batch Processing Multiple Documents');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const { processor } = await setupSystem();
    
    const documents = [
        {
            file: { path: './docs/hopewell-will.pdf', originalname: 'hopewell-will.pdf', size: 2485760 },
            metadata: { ownerName: 'James Hopewell', deathYear: 1816, location: 'St. Mary\'s County, MD', documentType: 'will' }
        },
        {
            file: { path: './docs/biscoe-census-1850.pdf', originalname: 'biscoe-census.pdf', size: 1892456 },
            metadata: { ownerName: 'George W. Biscoe', deathYear: 1862, location: 'Georgetown, DC', documentType: 'census' }
        },
        {
            file: { path: './docs/hopewell-elizabeth-will.pdf', originalname: 'elizabeth-will.pdf', size: 1645234 },
            metadata: { ownerName: 'Elizabeth Hopewell', deathYear: 1787, location: 'St. Mary\'s County, MD', documentType: 'will' }
        }
    ];
    
    const results = [];
    
    for (const doc of documents) {
        const result = await processor.processDocument(doc.file, doc.metadata);
        results.push(result);
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Summary
    console.log('\n📈 BATCH PROCESSING SUMMARY:');
    console.log(`   Total Documents: ${results.length}`);
    console.log(`   Successful: ${results.filter(r => r.success).length}`);
    console.log(`   Failed: ${results.filter(r => !r.success).length}`);
    
    const totalEnslaved = results.reduce((sum, r) => 
        sum + (r.stages?.parsing?.totalCount || 0), 0);
    const totalReparations = results.reduce((sum, r) => 
        sum + (r.stages?.reparations?.total || 0), 0);
    
    console.log(`   Total Enslaved Counted: ${totalEnslaved}`);
    console.log(`   Total Reparations: $${totalReparations.toLocaleString()}`);
    
    return results;
}

// ==================== EXAMPLE 3: Query Database ====================

async function example3_QueryDatabase() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('EXAMPLE 3: Querying Database for Records');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const { db } = await setupSystem();
    
    // Query 1: Get all documents for James Hopewell
    console.log('📁 All documents for James Hopewell:');
    const hopewellDocs = await db.query(`
        SELECT 
            document_id,
            doc_type,
            total_enslaved,
            total_reparations,
            verification_status
        FROM documents
        WHERE owner_name = 'James Hopewell'
        ORDER BY created_at DESC
    `);
    console.table(hopewellDocs.rows);
    
    // Query 2: Get enslaved people from a specific document
    console.log('\n👥 Enslaved people from document:');
    const enslavedPeople = await db.query(`
        SELECT 
            name,
            gender,
            family_relationship,
            bequeathed_to,
            individual_reparations
        FROM enslaved_people
        WHERE document_id = $1
        ORDER BY name
    `, [hopewellDocs.rows[0]?.document_id]);
    console.table(enslavedPeople.rows);
    
    // Query 3: Get verification queue
    console.log('\n📋 Documents pending verification:');
    const pendingDocs = await db.query(`
        SELECT * FROM verification_queue
        LIMIT 10
    `);
    console.table(pendingDocs.rows);
    
    // Query 4: Get owner summary
    console.log('\n📊 Owner summary (top 10 by reparations):');
    const ownerSummary = await db.query(`
        SELECT * FROM owner_summary
        ORDER BY total_reparations DESC
        LIMIT 10
    `);
    console.table(ownerSummary.rows);
    
    // Query 5: Get statistics
    console.log('\n📈 System statistics:');
    const stats = await db.query(`SELECT * FROM stats_dashboard`);
    console.log(stats.rows[0]);
    
    await db.end();
}

// ==================== EXAMPLE 4: Export for Blockchain ====================

async function example4_ExportForBlockchain() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('EXAMPLE 4: Export Documents for Blockchain Submission');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const { processor, db } = await setupSystem();
    
    // Get all verified documents ready for blockchain
    const readyForBlockchain = await db.query(`
        SELECT * FROM blockchain_queue
        LIMIT 10
    `);
    
    console.log(`📦 Found ${readyForBlockchain.rows.length} documents ready for blockchain\n`);
    
    const blockchainPayloads = [];
    
    for (const doc of readyForBlockchain.rows) {
        const payload = {
            ancestorName: doc.owner_name,
            genealogyHash: doc.ipfs_hash,
            totalReparationsWei: processor.toWei(doc.total_reparations),
            slaveCount: doc.total_enslaved,
            notes: `Verified document from ${doc.created_at}`
        };
        
        blockchainPayloads.push(payload);
        
        console.log(`✓ ${doc.owner_name}: $${doc.total_reparations.toLocaleString()}`);
    }
    
    // Save to JSON file for blockchain submission script
    const fs = require('fs').promises;
    await fs.writeFile(
        './blockchain-batch.json',
        JSON.stringify(blockchainPayloads, null, 2)
    );
    
    console.log(`\n💾 Saved ${blockchainPayloads.length} payloads to blockchain-batch.json`);
    console.log('   Ready to submit with: node submit-to-blockchain.js');
    
    await db.end();
    return blockchainPayloads;
}

// ==================== EXAMPLE 5: Submit to Blockchain ====================

async function example5_SubmitToBlockchain() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('EXAMPLE 5: Submit to Blockchain Smart Contract');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const Web3 = require('web3');
    const web3 = new Web3('http://localhost:8545'); // or your network
    
    // Load contract
    const contractABI = require('./build/contracts/ReparationsEscrow.json').abi;
    const contractAddress = '0x...'; // Your deployed contract
    const contract = new web3.eth.Contract(contractABI, contractAddress);
    
    // Get accounts
    const accounts = await web3.eth.getAccounts();
    const fromAccount = accounts[0];
    
    // Load batch data
    const fs = require('fs').promises;
    const batch = JSON.parse(await fs.readFile('./blockchain-batch.json', 'utf8'));
    
    console.log(`📤 Submitting ${batch.length} records to blockchain...\n`);
    
    for (const record of batch) {
        try {
            const receipt = await contract.methods
                .submitAncestryRecord(
                    record.ancestorName,
                    record.genealogyHash,
                    record.totalReparationsWei,
                    record.notes
                )
                .send({ from: fromAccount, gas: 500000 });
            
            console.log(`✓ ${record.ancestorName}`);
            console.log(`   TX: ${receipt.transactionHash}`);
            console.log(`   Block: ${receipt.blockNumber}`);
            
            // Update database
            const { db } = await setupSystem();
            await db.query(`
                UPDATE documents
                SET blockchain_submitted = TRUE,
                    blockchain_tx_hash = $1,
                    blockchain_block_number = $2,
                    blockchain_submitted_at = NOW()
                WHERE ipfs_hash = $3
            `, [receipt.transactionHash, receipt.blockNumber, record.genealogyHash]);
            
        } catch (error) {
            console.error(`❌ Failed to submit ${record.ancestorName}:`, error.message);
        }
    }
    
    console.log('\n✅ Blockchain submission complete!');
}

// ==================== EXAMPLE 6: Full End-to-End ====================

async function example6_FullEndToEnd() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('EXAMPLE 6: Full End-to-End Processing');
    console.log('Upload → Process → Store → Database → Verify → Blockchain');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const { processor, db } = await setupSystem();
    
    // Step 1: Upload document
    console.log('📤 Step 1: Upload document...');
    const uploadedFile = {
        path: '/mnt/user-data/uploads/Transcript.pdf',
        originalname: 'james-hopewell-will-1811.pdf',
        size: 2485760
    };
    
    const metadata = {
        ownerName: 'James Hopewell',
        deathYear: 1816,
        location: 'St. Mary\'s County, Maryland',
        documentType: 'will'
    };
    
    // Step 2: Process document
    console.log('⚙️  Step 2: Process document...');
    const result = await processor.processDocument(uploadedFile, metadata);
    
    if (!result.success) {
        console.error('❌ Processing failed');
        return;
    }
    
    const documentId = result.documentId;
    console.log(`✓ Document ID: ${documentId}\n`);
    
    // Step 3: Human verification (simulated)
    console.log('👤 Step 3: Human verification...');
    await db.query(`
        UPDATE documents
        SET verification_status = 'verified',
            approved_at = NOW()
        WHERE document_id = $1
    `, [documentId]);
    
    await db.query(`
        INSERT INTO verification_reviews (document_id, reviewer, decision, notes)
        VALUES ($1, 'expert@genealogy.org', 'APPROVE', 'Verified all sources')
    `, [documentId]);
    
    console.log('✓ Document verified\n');
    
    // Step 4: Prepare for blockchain
    console.log('⛓️  Step 4: Prepare blockchain submission...');
    const blockchainPayload = result.stages.blockchain;
    console.log(`✓ Payload ready: ${blockchainPayload.ancestorName}\n`);
    
    // Step 5: Submit to blockchain (simulated)
    console.log('📡 Step 5: Submit to blockchain...');
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    await db.query(`
        UPDATE documents
        SET blockchain_submitted = TRUE,
            blockchain_tx_hash = $1,
            blockchain_submitted_at = NOW()
        WHERE document_id = $2
    `, [txHash, documentId]);
    
    console.log(`✓ Submitted! TX: ${txHash}\n`);
    
    // Step 6: Final status
    console.log('📊 Step 6: Final status...');
    const finalStatus = await db.query(`
        SELECT 
            document_id,
            owner_name,
            total_enslaved,
            total_reparations,
            verification_status,
            blockchain_submitted,
            blockchain_tx_hash
        FROM documents
        WHERE document_id = $1
    `, [documentId]);
    
    console.table(finalStatus.rows);
    
    console.log('\n✅ COMPLETE! Document is now on blockchain and searchable.');
    
    await db.end();
}

// ==================== RUN EXAMPLES ====================

async function main() {
    try {
        // Run example 1
        await example1_ProcessJamesHopewellWill();
        
        // Uncomment to run other examples:
        // await example2_BatchProcessing();
        // await example3_QueryDatabase();
        // await example4_ExportForBlockchain();
        // await example5_SubmitToBlockchain();
        // await example6_FullEndToEnd();
        
    } catch (error) {
        console.error('\n❌ Error:', error);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = {
    setupSystem,
    example1_ProcessJamesHopewellWill,
    example2_BatchProcessing,
    example3_QueryDatabase,
    example4_ExportForBlockchain,
    example5_SubmitToBlockchain,
    example6_FullEndToEnd
};
