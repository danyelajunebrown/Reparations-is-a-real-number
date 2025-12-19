/**
 * Test to detect whether OCR text is from a Slave Schedule or Regular Census
 *
 * Slave Schedule characteristics:
 * - "Name of Slaveholder" or "Slave Owner" header
 * - Columns: Age, Sex, Color (for enslaved persons, usually NO NAMES)
 * - "Black" / "Mulatto" entries
 * - Minimal occupation data
 *
 * Regular Census characteristics:
 * - Names for ALL persons listed
 * - "Occupation" column with actual job entries
 * - "Value of Real Estate" column
 * - "Birthplace" column (state/country names)
 */

function detectDocumentType(ocrText) {
    const text = ocrText.toLowerCase();

    // Slave Schedule indicators (high confidence)
    const slaveSchedulePatterns = {
        headers: [
            /name\s+of\s+slave\s*holders?/i,
            /slave\s+owner/i,
            /number\s+of\s+slaves/i,
            /fugitives?\s+from\s+the\s+state/i,
            /manumitted/i,
            /deaf.*dumb.*blind.*insane/i
        ],
        columns: [
            /\bage\b.*\bsex\b.*\bcolor\b/i,
            /\bblack\b.*\bmulatto\b/i,
            /\b[BMbm]\b\s+\b[BMbm]\b/  // B/M entries for color
        ]
    };

    // Regular Census indicators
    const regularCensusPatterns = {
        headers: [
            /occupation\s*,?\s*trade\s*,?\s*or\s*profession/i,
            /value\s+of\s+(real\s+)?estate/i,
            /place\s+of\s+birth/i,
            /whether\s+married/i,
            /attended\s+school/i,
            /cannot\s+read\s+and\s+write/i
        ],
        occupations: [
            /farmer/i,
            /laborer/i,
            /merchant/i,
            /blacksmith/i,
            /carpenter/i,
            /shoemaker/i,
            /teacher/i,
            /physician/i,
            /clerk/i,
            /overseer/i
        ]
    };

    let slaveScheduleScore = 0;
    let regularCensusScore = 0;

    // Check slave schedule patterns
    for (const pattern of slaveSchedulePatterns.headers) {
        if (pattern.test(text)) {
            slaveScheduleScore += 3;  // Headers are strong indicators
        }
    }
    for (const pattern of slaveSchedulePatterns.columns) {
        if (pattern.test(text)) {
            slaveScheduleScore += 2;
        }
    }

    // Check regular census patterns
    for (const pattern of regularCensusPatterns.headers) {
        if (pattern.test(text)) {
            regularCensusScore += 3;
        }
    }

    // Count occupation matches (strong indicator of regular census)
    let occupationMatches = 0;
    for (const pattern of regularCensusPatterns.occupations) {
        const matches = text.match(new RegExp(pattern, 'gi'));
        if (matches) {
            occupationMatches += matches.length;
        }
    }
    if (occupationMatches >= 3) {
        regularCensusScore += 4;  // Multiple occupations = regular census
    } else if (occupationMatches >= 1) {
        regularCensusScore += 2;
    }

    // Check for numeric patterns typical of slave schedules
    // Age + Sex + Color patterns without names
    const ageColorPattern = /\b\d{1,2}\s+[MF]\s+[BM]\b/gi;
    const ageColorMatches = text.match(ageColorPattern);
    if (ageColorMatches && ageColorMatches.length >= 5) {
        slaveScheduleScore += 3;
    }

    // Determine document type
    const result = {
        slaveScheduleScore,
        regularCensusScore,
        documentType: 'unknown',
        confidence: 0,
        indicators: []
    };

    if (slaveScheduleScore > regularCensusScore && slaveScheduleScore >= 3) {
        result.documentType = 'slave_schedule';
        result.confidence = Math.min(1, slaveScheduleScore / 10);
    } else if (regularCensusScore > slaveScheduleScore && regularCensusScore >= 3) {
        result.documentType = 'regular_census';
        result.confidence = Math.min(1, regularCensusScore / 10);
    } else if (slaveScheduleScore === 0 && regularCensusScore === 0) {
        result.documentType = 'unknown';
        result.confidence = 0;
    } else {
        result.documentType = 'uncertain';
        result.confidence = 0.3;
    }

    return result;
}

// Test cases
console.log('=== DOCUMENT TYPE DETECTION TEST ===\n');

// Slave Schedule sample text
const slaveScheduleText = `
SCHEDULE 2 - SLAVE INHABITANTS
Name of Slave Owner: John Smith
Description of Slaves:
1  35  M  B
2  28  F  B
3  12  M  M
4  8   F  B
5  4   M  B
Number of Slaves: 5
Fugitives from the State: 0
Manumitted: 0
Deaf, Dumb, Blind, Insane, or Idiotic: 0
`;

// Regular Census sample text
const regularCensusText = `
SCHEDULE 1 - FREE INHABITANTS
Name: Nancy C Wilson
Age: 45
Sex: F
Color: W
Occupation: Farmer
Value of Real Estate: 2500
Place of Birth: Virginia
Married within the year: No
Attended School: No

Name: James Wilson
Age: 22
Sex: M
Color: W
Occupation: Laborer
Place of Birth: Alabama
`;

// Title page (should be unknown)
const titlePageText = `
SEVENTH CENSUS
UNITED STATES
1850
STATE OF ALABAMA
County of Bibb
`;

console.log('Test 1: Slave Schedule OCR');
const result1 = detectDocumentType(slaveScheduleText);
console.log(`  Type: ${result1.documentType}`);
console.log(`  Confidence: ${(result1.confidence * 100).toFixed(0)}%`);
console.log(`  Scores: Slave=${result1.slaveScheduleScore}, Census=${result1.regularCensusScore}`);
console.log(`  PASS: ${result1.documentType === 'slave_schedule' ? '✓' : '✗'}\n`);

console.log('Test 2: Regular Census OCR');
const result2 = detectDocumentType(regularCensusText);
console.log(`  Type: ${result2.documentType}`);
console.log(`  Confidence: ${(result2.confidence * 100).toFixed(0)}%`);
console.log(`  Scores: Slave=${result2.slaveScheduleScore}, Census=${result2.regularCensusScore}`);
console.log(`  PASS: ${result2.documentType === 'regular_census' ? '✓' : '✗'}\n`);

console.log('Test 3: Title Page (should be unknown)');
const result3 = detectDocumentType(titlePageText);
console.log(`  Type: ${result3.documentType}`);
console.log(`  Confidence: ${(result3.confidence * 100).toFixed(0)}%`);
console.log(`  Scores: Slave=${result3.slaveScheduleScore}, Census=${result3.regularCensusScore}`);
console.log(`  PASS: ${result3.documentType === 'unknown' ? '✓' : '✗'}\n`);

// Export for use in other scripts
module.exports = { detectDocumentType };
