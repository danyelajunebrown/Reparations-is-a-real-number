// test-upload.js
// Quick test script to upload a document

const FormData = require('form-data');
const fs = require('fs');
const fetch = require('node-fetch');

async function testUpload() {
  console.log('\n========================================');
  console.log('TESTING DOCUMENT UPLOAD');
  console.log('========================================\n');

  // Create a simple test PDF file
  const testPdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj
4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(Test Document) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000214 00000 n
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
307
%%EOF`;

  const testFilePath = './test-document.pdf';
  fs.writeFileSync(testFilePath, testPdfContent);
  console.log('✅ Created test PDF:', testFilePath);

  // Create FormData
  const formData = new FormData();
  formData.append('pages', fs.createReadStream(testFilePath));
  formData.append('ownerName', 'Test Owner');
  formData.append('documentType', 'will');
  formData.append('birthYear', '1800');
  formData.append('deathYear', '1850');
  formData.append('location', 'Virginia');
  formData.append('pageCount', '1');

  console.log('\n📤 Uploading to http://localhost:3000/api/upload-multi-page-document...\n');

  try {
    const response = await fetch('http://localhost:3000/api/upload-multi-page-document', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    console.log('Response Status:', response.status);
    console.log('Response Data:', JSON.stringify(data, null, 2));

    if (data.success) {
      console.log('\n✅ SUCCESS! Document uploaded');
      console.log('Document ID:', data.documentId);
    } else {
      console.log('\n❌ FAILED');
      console.log('Error:', data.error);
      if (data.debug) {
        console.log('Debug info:', data.debug);
      }
    }

  } catch (error) {
    console.log('\n❌ ERROR:', error.message);
  } finally {
    // Cleanup
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
      console.log('\n🧹 Cleaned up test file');
    }
  }
}

testUpload();
