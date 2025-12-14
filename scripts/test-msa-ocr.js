/**
 * MSA Montgomery County OCR Test
 * Compares Google Vision OCR output against human transcription
 * Downloads PDF and sends directly to Google Vision document OCR
 */

const axios = require('axios');
const fs = require('fs');

const PDF_URL = process.argv[2] || 'https://msa.maryland.gov/megafile/msa/speccol/sc2900/sc2908/000001/000812/pdf/am812--15.pdf';

async function testOCR() {
    console.log('=== MSA Montgomery County OCR Test ===');
    console.log('URL:', PDF_URL);
    console.log('');

    // Download the PDF first
    console.log('1. Downloading PDF...');
    const pdfResponse = await axios.get(PDF_URL, {
        responseType: 'arraybuffer',
        headers: {
            'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
        }
    });
    const pdfBuffer = Buffer.from(pdfResponse.data);
    console.log('   Downloaded:', (pdfBuffer.length / 1024).toFixed(1), 'KB');

    // Send PDF directly to Google Vision Document API
    // The files:annotate endpoint can handle PDF files
    console.log('');
    console.log('2. Sending PDF to Google Vision API...');
    console.log('   (Google Vision processes PDF as a document)');

    const visionResponse = await axios.post(
        'https://vision.googleapis.com/v1/files:annotate?key=' + process.env.GOOGLE_VISION_API_KEY,
        {
            requests: [{
                inputConfig: {
                    content: pdfBuffer.toString('base64'),
                    mimeType: 'application/pdf'
                },
                features: [
                    { type: 'DOCUMENT_TEXT_DETECTION' }
                ],
                pages: [1] // First page only
            }]
        }
    );

    const responses = visionResponse.data.responses || [];
    if (responses.length === 0 || !responses[0].responses) {
        console.log('   No text detected!');
        console.log('   Response:', JSON.stringify(visionResponse.data, null, 2));
        return;
    }

    // Get text from all pages
    let ocrText = '';
    for (const pageResponse of responses[0].responses) {
        const textAnnotation = pageResponse.fullTextAnnotation;
        if (textAnnotation && textAnnotation.text) {
            ocrText += textAnnotation.text + '\n';
        }
    }

    if (!ocrText.trim()) {
        console.log('   No text detected in PDF!');
        return;
    }

    console.log('   Characters extracted:', ocrText.length);
    console.log('   Words extracted:', ocrText.split(/\s+/).length);
    console.log('');
    console.log('=== FULL OCR OUTPUT ===');
    console.log('');
    console.log(ocrText);
    console.log('');
    console.log('=== END OCR OUTPUT ===');

    // Save the OCR output for comparison
    fs.writeFileSync('/tmp/msa-ocr-output.txt', ocrText);
    console.log('');
    console.log('OCR output saved to /tmp/msa-ocr-output.txt');

    // Show comparison with expected names
    console.log('');
    console.log('=== EXPECTED NAMES (User Transcription) ===');
    console.log('Owner: Edward W. Owen');
    console.log('Enslaved: William Key (male, 53), Alfred Swailes (male, 41), Regis Swailes (male, 35, 3 fingers injured),');
    console.log('         Isaac Johnson (male, 30), Berry Swailes (male, 28), Samuel Butler (male, 30),');
    console.log('         Sally Swailes (female, 28), Nelly Swailes (female, 58), Charity Johnson (female, 55),');
    console.log('         Rachel Johnson (female, 37), Louisa Dutch (female, 20), Richard Lincoln (male, 19),');
    console.log('         Mary Johnson (female, 17), Jane Johnson (female, 15), William Henry Johnson (male, 13),');
    console.log('         George Johnson (male, 10), Swan Johnson (female, 7), John Johnson (male, 5),');
    console.log('         Kolman Plummer (male, 5), Phillip Johnson (male, 3), Henry Dutch (male, 4)');
    console.log('');

    // Check how many names OCR found
    const expectedNames = ['Edward W. Owen', 'William Key', 'Alfred Swailes', 'Regis Swailes', 'Isaac Johnson',
        'Berry Swailes', 'Samuel Butler', 'Sally Swailes', 'Nelly Swailes', 'Charity Johnson',
        'Rachel Johnson', 'Louisa Dutch', 'Richard Lincoln', 'Mary Johnson', 'Jane Johnson',
        'William Henry Johnson', 'George Johnson', 'Swan Johnson', 'John Johnson',
        'Kolman Plummer', 'Phillip Johnson', 'Henry Dutch'];

    const ocrLower = ocrText.toLowerCase();
    let found = 0;
    let notFound = [];

    for (const name of expectedNames) {
        // Check for last name at minimum
        const lastName = name.split(' ').pop().toLowerCase();
        const firstName = name.split(' ')[0].toLowerCase();
        if (ocrLower.includes(lastName) || ocrLower.includes(firstName)) {
            found++;
        } else {
            notFound.push(name);
        }
    }

    console.log(`=== NAME MATCH RESULTS ===`);
    console.log(`Found ${found}/${expectedNames.length} names (${(found/expectedNames.length*100).toFixed(1)}%)`);
    if (notFound.length > 0) {
        console.log('Not found:', notFound.join(', '));
    }
}

testOCR().catch(err => {
    console.error('Error:', err.message);
    if (err.response) {
        console.error('Response:', JSON.stringify(err.response.data, null, 2));
    }
});
