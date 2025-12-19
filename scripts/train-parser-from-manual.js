/**
 * Train Parser from Manual Extractions
 *
 * This script loads the ground truth data from our manual Ravenel paper
 * extractions and trains the DocumentParser to improve accuracy.
 *
 * It creates learned patterns that the parser can use to:
 * - Recognize columnar layouts
 * - Filter garbage words
 * - Detect family relationships
 * - Extract values/prices
 * - Classify document types
 *
 * Usage: node scripts/train-parser-from-manual.js
 */

const fs = require('fs');
const path = require('path');

// Load training data
const TRAINING_DATA_FILE = path.join(__dirname, 'ravenel-extraction-training-data.json');
const OUTPUT_PATTERNS_FILE = path.join(__dirname, '../data/learned-patterns.json');
const OUTPUT_EXAMPLES_FILE = path.join(__dirname, '../data/training-examples.json');

async function main() {
    console.log('='.repeat(70));
    console.log('PARSER TRAINING FROM MANUAL EXTRACTIONS');
    console.log('='.repeat(70));

    // Load training data
    console.log('\n1. Loading training data...');
    const trainingData = JSON.parse(fs.readFileSync(TRAINING_DATA_FILE, 'utf8'));
    const documents = trainingData.training_dataset.documents;

    console.log(`   Found ${documents.length} manually extracted documents`);

    // Calculate totals
    let totalManual = 0;
    let totalScraper = 0;
    documents.forEach(doc => {
        totalManual += doc.manual_found;
        totalScraper += doc.scraper_found;
    });

    console.log(`   Total manual extractions: ${totalManual}`);
    console.log(`   Total scraper extractions: ${totalScraper}`);
    console.log(`   Overall accuracy: ${((totalScraper / totalManual) * 100).toFixed(1)}%`);

    // Build training examples from manual data
    console.log('\n2. Building training examples...');
    const trainingExamples = [];
    const knownNames = new Set();
    const knownOwners = new Set();
    const learnedPatterns = [];

    for (const doc of documents) {
        console.log(`   Processing: Film ${doc.film} Image ${doc.image} (${doc.type})`);

        // Add all names to known names list
        if (doc.names) {
            doc.names.forEach(name => knownNames.add(name));
        }

        // Add family group members
        if (doc.family_groups) {
            doc.family_groups.forEach(group => {
                if (group.head) knownNames.add(group.head);
                if (group.wife) knownNames.add(group.wife);
                if (group.members) group.members.forEach(m => knownNames.add(m));
                if (group.children) group.children.forEach(c => knownNames.add(c));
                if (group.grandchildren) group.grandchildren.forEach(g => knownNames.add(g));
            });
        }

        // Add owners
        if (doc.owner) knownOwners.add(doc.owner);
        if (doc.seller) knownOwners.add(doc.seller);
        if (doc.debtor) knownOwners.add(doc.debtor);

        // Build training example
        const example = {
            film: doc.film,
            image: doc.image,
            documentType: doc.type,
            date: doc.date || null,
            layout: doc.layout || 'unknown',
            names: doc.names || [],
            familyGroups: doc.family_groups || [],
            owner: doc.owner || null,
            manualCount: doc.manual_found,
            scraperCount: doc.scraper_found,
            accuracy: doc.accuracy,
            addedAt: new Date().toISOString()
        };

        trainingExamples.push(example);

        // Learn document type patterns
        learnedPatterns.push({
            type: 'document_classification',
            documentType: doc.type,
            indicators: getDocumentTypeIndicators(doc),
            confidence: 0.9
        });

        // Learn layout patterns
        if (doc.layout) {
            learnedPatterns.push({
                type: 'layout_detection',
                layout: doc.layout,
                columnCounts: doc.column_counts || [],
                documentType: doc.type,
                confidence: 0.85
            });
        }

        // Learn family relationship patterns
        if (doc.family_groups) {
            doc.family_groups.forEach(group => {
                learnedPatterns.push({
                    type: 'family_relationship',
                    pattern: describeFamilyStructure(group),
                    documentType: doc.type,
                    confidence: 0.8
                });
            });
        }

        // Learn notable features (occupations, day-names, etc.)
        if (doc.notable_features) {
            Object.keys(doc.notable_features).forEach(feature => {
                learnedPatterns.push({
                    type: 'notable_feature',
                    feature: feature,
                    examples: doc.notable_features[feature],
                    documentType: doc.type,
                    confidence: 0.85
                });
            });
        }
    }

    console.log(`   Names learned: ${knownNames.size}`);
    console.log(`   Owners learned: ${knownOwners.size}`);
    console.log(`   Patterns learned: ${learnedPatterns.length}`);

    // Build parser improvements from our findings
    console.log('\n3. Building parser improvement rules...');
    const parserImprovements = trainingData.parser_improvements_needed;

    const improvementRules = parserImprovements.map(improvement => ({
        issue: improvement.issue,
        solution: improvement.solution,
        priority: improvement.priority,
        implemented: false,
        implementationNotes: getImplementationNotes(improvement.issue)
    }));

    console.log(`   ${improvementRules.length} improvement rules identified`);

    // Save learned patterns
    console.log('\n4. Saving learned patterns...');

    // Ensure data directory exists
    const dataDir = path.dirname(OUTPUT_PATTERNS_FILE);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Save patterns file
    const patternsData = {
        knownNames: Array.from(knownNames),
        knownOwners: Array.from(knownOwners),
        patterns: learnedPatterns,
        improvementRules: improvementRules,
        stats: {
            totalDocuments: documents.length,
            totalNamesLearned: knownNames.size,
            totalOwnersLearned: knownOwners.size,
            overallAccuracy: ((totalScraper / totalManual) * 100).toFixed(1) + '%',
            accuracyByDocType: calculateAccuracyByType(documents)
        },
        lastUpdated: new Date().toISOString()
    };

    fs.writeFileSync(OUTPUT_PATTERNS_FILE, JSON.stringify(patternsData, null, 2));
    console.log(`   Saved: ${OUTPUT_PATTERNS_FILE}`);

    // Save training examples
    fs.writeFileSync(OUTPUT_EXAMPLES_FILE, JSON.stringify(trainingExamples, null, 2));
    console.log(`   Saved: ${OUTPUT_EXAMPLES_FILE}`);

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('TRAINING COMPLETE');
    console.log('='.repeat(70));
    console.log(`\nParser now knows:`);
    console.log(`  - ${knownNames.size} enslaved person names`);
    console.log(`  - ${knownOwners.size} slaveholder names`);
    console.log(`  - ${learnedPatterns.length} extraction patterns`);
    console.log(`  - ${improvementRules.length} improvement rules`);

    console.log('\nAccuracy by document type:');
    const accuracyByType = calculateAccuracyByType(documents);
    Object.entries(accuracyByType).forEach(([type, stats]) => {
        console.log(`  ${type}: ${stats.accuracy}% (${stats.scraperTotal}/${stats.manualTotal})`);
    });

    console.log('\nNext steps:');
    console.log('  1. Update familysearch-scraper.js to use DocumentParser');
    console.log('  2. Implement columnar layout detection');
    console.log('  3. Reprocess documents with improved parser');
}

/**
 * Get indicators for document type classification
 */
function getDocumentTypeIndicators(doc) {
    const indicators = [];

    switch (doc.type) {
        case 'bill_of_sale':
            indicators.push('sold', 'purchased', 'buyer', 'seller', 'consideration');
            break;
        case 'mortgage':
            indicators.push('mortgage', 'debt', 'security', 'creditor', 'debtor');
            break;
        case 'estate_inventory':
            indicators.push('inventory', 'estate', 'deceased', 'appraisal', 'value');
            break;
        case 'family_chart':
            indicators.push('family', 'wife', 'children', 'descendant');
            break;
        case 'plantation_inventory':
            indicators.push('plantation', 'hands', 'workers', 'list');
            break;
        case 'workers_list':
            indicators.push('list', 'names', 'workers', 'negroes');
            break;
    }

    return indicators;
}

/**
 * Describe family structure for pattern learning
 */
function describeFamilyStructure(group) {
    const parts = [];
    if (group.head) parts.push('head');
    if (group.wife) parts.push('wife');
    if (group.children && group.children.length > 0) parts.push(`${group.children.length}_children`);
    if (group.grandchildren && group.grandchildren.length > 0) parts.push(`${group.grandchildren.length}_grandchildren`);
    if (group.members && group.members.length > 0) parts.push(`${group.members.length}_members`);
    return parts.join('_with_');
}

/**
 * Get implementation notes for each improvement
 */
function getImplementationNotes(issue) {
    const notes = {
        'No columnar layout detection':
            'Detect columns by analyzing spacing between words. If >3 spaces or tab characters separate text blocks, treat as columns. Parse each column as separate list.',
        'Garbage word extraction':
            'Use NameValidator.isValidName() before adding any name. Check against known enslaved names list first.',
        'Day-name bias':
            'Check context: if "Monday" appears after date pattern (e.g., "Jan 5 Monday"), ignore. If appears in name list context, include as potential name.',
        'No family relationship detection':
            'Look for patterns: "wife", "husband", "child of", "son of", "daughter of", "mother", "father", "grandchild". Create family_groups in output.',
        'No value/price extraction':
            'Match currency patterns: $XXX, £XXX, followed by period or comma. Associate with nearest name.',
        'No document type classification':
            'Check first 200 chars for keywords: "sold" -> sale, "mortgage" -> mortgage, "inventory" -> inventory, "will" -> will, "list" -> workers_list'
    };

    return notes[issue] || 'Implementation pending';
}

/**
 * Calculate accuracy broken down by document type
 */
function calculateAccuracyByType(documents) {
    const byType = {};

    documents.forEach(doc => {
        if (!byType[doc.type]) {
            byType[doc.type] = { manualTotal: 0, scraperTotal: 0 };
        }
        byType[doc.type].manualTotal += doc.manual_found;
        byType[doc.type].scraperTotal += doc.scraper_found;
    });

    Object.keys(byType).forEach(type => {
        const stats = byType[type];
        stats.accuracy = ((stats.scraperTotal / stats.manualTotal) * 100).toFixed(1);
    });

    return byType;
}

// Run training
main().catch(err => {
    console.error('Training failed:', err);
    process.exit(1);
});
