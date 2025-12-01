/**
 * Re-process all documents with improved parser
 * This will update enslaved people counts using the new structural pattern detection
 */

const axios = require('axios');

const API_URL = process.env.API_URL || 'https://reparations-platform.onrender.com';

async function reprocessAllDocuments() {
  try {
    console.log('🔄 Re-processing all documents with improved parser...\n');

    // Step 1: Get all documents from Research Assistant
    console.log('1️⃣  Fetching document list...');
    const listResponse = await axios.post(`${API_URL}/api/llm-query`, {
      query: 'list all documents'
    });

    if (!listResponse.data.success) {
      console.error('Failed to fetch documents');
      return;
    }

    // Extract document IDs from database
    // We need to query the database directly or add an endpoint to list all document IDs
    // For now, let's use the owner names to query

    const ownersResponse = await axios.post(`${API_URL}/api/llm-query`, {
      query: 'who are the slave owners?'
    });

    console.log(`Found ${ownersResponse.data.data?.length || 0} owners\n`);

    // Step 2: For each owner, get their documents
    for (const owner of ownersResponse.data.data || []) {
      console.log(`\n📄 Processing documents for: ${owner.owner_name}`);
      console.log(`   Documents: ${owner.document_count}`);

      // Query for this owner's details to get document IDs
      const detailsResponse = await axios.post(`${API_URL}/api/llm-query`, {
        query: `tell me about ${owner.owner_name}`
      });

      // Note: We need document IDs from the API
      // For now, let's provide manual IDs
      console.log(`   Current enslaved count: ${owner.total_enslaved || 'N/A'}`);
    }

    console.log('\n⚠️  Manual step required:');
    console.log('To re-process a specific document, use:');
    console.log('  POST https://reparations-platform.onrender.com/api/reprocess-document');
    console.log('  Body: { "documentId": "your-document-id-here" }');
    console.log('\nGet document IDs from your uploads or database.');

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Helper function to reprocess a single document
async function reprocessDocument(documentId) {
  try {
    console.log(`\n🔄 Re-processing document: ${documentId}`);

    const response = await axios.post(`${API_URL}/api/reprocess-document`, {
      documentId: documentId
    });

    if (response.data.success) {
      console.log('✅ Success!');
      console.log(`   Previous count: ${response.data.previous_count}`);
      console.log(`   New count: ${response.data.new_count}`);
      console.log(`   Improvement: ${response.data.improvement > 0 ? '+' : ''}${response.data.improvement}`);
      console.log(`   Method: ${response.data.parsed.method}`);
      console.log(`   Confidence: ${response.data.parsed.confidence}`);
    } else {
      console.error('❌ Failed:', response.data.error);
    }

    return response.data;
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

// Export for use
module.exports = { reprocessDocument, reprocessAllDocuments };

// If run directly, show usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node reprocess-all-documents.js <documentId>');
    console.log('  node reprocess-all-documents.js all');
    console.log('\nExamples:');
    console.log('  node reprocess-all-documents.js 784959f60b4d684c77c870b9');
    console.log('  node reprocess-all-documents.js all');
    process.exit(0);
  }

  if (args[0] === 'all') {
    reprocessAllDocuments();
  } else {
    reprocessDocument(args[0]);
  }
}
