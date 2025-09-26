/**

- Document Processing Module for OCR and Slave Count Extraction
- Handles cursive handwriting recognition and historical document parsing
  */

class DocumentProcessor {
constructor() {
this.apiKey = null;
this.ocrService = ‘google’; // ‘google’ or ‘aws’
}

```
setOCRService(apiKey, service = 'google') {
    this.apiKey = apiKey;
    this.ocrService = service;
}

async processDocumentImage(imageUrl, documentType) {
    if (!this.apiKey) {
        throw new Error('OCR API key not configured');
    }

    try {
        const ocrResult = await this.performOCR(imageUrl);
        
        if (documentType === 'will') {
            return this.extractSlaveCountFromWill(ocrResult.text);
        } else if (documentType === 'census') {
            return this.extractSlaveCountFromCensus(ocrResult.text);
        } else if (documentType === 'correspondence') {
            return this.extractSlaveCountFromCorrespondence(ocrResult.text);
        }
        
        return { text: ocrResult.text, slaveCount: 0, details: [] };
    } catch (error) {
        console.error('OCR processing error:', error);
        throw error;
    }
}

async performOCR(imageUrl) {
    if (this.ocrService === 'google') {
        return await this.googleVisionOCR(imageUrl);
    } else {
        return await this.awsTextractOCR(imageUrl);
    }
}

async googleVisionOCR(imageUrl) {
    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            requests: [{
                image: { source: { imageUri: imageUrl } },
                features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
            }]
        })
    });
    
    const data = await response.json();
    return { text: data.responses[0]?.fullTextAnnotation?.text || '' };
}

extractSlaveCountFromWill(text) {
    const details = [];
    let totalCount = 0;

    // Pattern matching for slave mentions in wills
    const patterns = [
        /(\d+)\s+(negro|slave|slaves)/gi,
        /(negro|slave)\s+named\s+(\w+)/gi,
        /my\s+(negro|slave|slaves)/gi,
        /bequeath.*?(\d+).*?(negro|slave|slaves)/gi,
        /give.*?(\d+).*?(negro|slave|slaves)/gi
    ];

    patterns.forEach(pattern => {
        const matches = [...text.matchAll(pattern)];
        matches.forEach(match => {
            if (match[1] && !isNaN(match[1])) {
                const count = parseInt(match[1]);
                totalCount += count;
                details.push({
                    type: 'numerical_reference',
                    count: count,
                    context: match[0],
                    category: 'will_bequest'
                });
            } else {
                // Individual named slaves
                totalCount += 1;
                details.push({
                    type: 'named_individual',
                    count: 1,
                    context: match[0],
                    name: match[2] || 'unnamed',
                    category: 'will_bequest'
                });
            }
        });
    });

    return { text, slaveCount: totalCount, details };
}

extractSlaveCountFromCensus(text) {
    const details = [];
    let totalCount = 0;

    // Look for slave schedule patterns
    const schedulePattern = /slave\s+schedule/gi;
    const numberPattern = /(\d+)/g;
    
    if (schedulePattern.test(text)) {
        const numbers = [...text.matchAll(numberPattern)];
        // Census slave schedules typically list ages/counts
        numbers.forEach(match => {
            const num = parseInt(match[1]);
            if (num > 0 && num < 100) { // Reasonable age range
                totalCount += 1;
                details.push({
                    type: 'census_entry',
                    count: 1,
                    context: `Age ${num}`,
                    category: 'slave_schedule'
                });
            }
        });
    }

    return { text, slaveCount: totalCount, details };
}

extractSlaveCountFromCorrespondence(text) {
    const details = [];
    let totalCount = 0;

    // Look for business correspondence mentioning slaves
    const patterns = [
        /sold\s+(\d+)\s+(negro|slave|slaves)/gi,
        /purchased\s+(\d+)\s+(negro|slave|slaves)/gi,
        /(\d+)\s+(negro|slave|slaves)\s+for\s+sale/gi
    ];

    patterns.forEach(pattern => {
        const matches = [...text.matchAll(pattern)];
        matches.forEach(match => {
            const count = parseInt(match[1]);
            totalCount += count;
            details.push({
                type: 'transaction_reference',
                count: count,
                context: match[0],
                category: 'correspondence'
            });
        });
    });

    return { text, slaveCount: totalCount, details };
}
```

}

// Export for different environments
if (typeof module !== ‘undefined’ && module.exports) {
module.exports = DocumentProcessor;
} else if (typeof window !== ‘undefined’) {
window.DocumentProcessor = DocumentProcessor;
}
