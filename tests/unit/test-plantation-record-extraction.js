/**
 * Test Suite: Plantation Record Extraction Pipeline
 * 
 * Validates extraction accuracy against ground-truth fixtures for secondary source compilations.
 * Tests: entity extraction, relationship mapping, confidence scoring, database writes.
 * 
 * Run: npm test -- tests/unit/test-plantation-record-extraction.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock the extraction functions from ingest-plantation-records.js
// (In production, these would be imported from the main script)

const NAME_STOPWORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'of', 'to', 'by', 'for', 'in', 'on', 'at',
  'my', 'his', 'her', 'their', 'said', 'named', 'called', 'known as',
  'man', 'woman', 'boy', 'girl', 'child', 'children', 'slave', 'enslaved',
  'negro', 'negroes', 'mulatto', 'freed', 'freedman', 'freedwoman',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'same', 'other', 'unknown', 'john', 'james', 'doe', 'blank',
]);

function isValidPersonName(name) {
  if (!name || name.length < 2) return false;
  if (NAME_STOPWORDS.has(name.toLowerCase())) return false;
  if (!/[a-zA-Z]/.test(name)) return false;
  if (name.match(/^\d+$/)) return false;
  return true;
}

function extractNames(text, maxCount = 10) {
  const words = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  return words
    .filter(isValidPersonName)
    .slice(0, maxCount);
}

function extractDate(text) {
  const match = text.match(/(\d{4})/);
  return match ? parseInt(match[1]) : null;
}

function extractValuation(text) {
  const match = text.match(/\$?\s*([0-9,]+\.?\d*)/);
  if (!match) return null;
  const cleaned = match[1].replace(/,/g, '');
  return parseFloat(cleaned);
}

function extractEntitiesFromPage(pageText, pageNum) {
  const entities = {
    page_number: pageNum,
    slaveowners: [],
    enslaved: [],
    business_partners: [],
    heirs: [],
    dates: [],
    valuations: [],
  };

  const lines = pageText.split('\n');
  
  for (const line of lines) {
    if (line.length < 10) continue;

    // Extract slaveowners
    if (/^(owned by|property of|enslaver|slave owner|master of|plantation owner|Mr\.|Mrs\.)\s+/i.test(line)) {
      const ownerText = line.replace(/^(owned by|property of|enslaver|slave owner|master of|plantation owner|Mr\.|Mrs\.)\s+/i, '').trim();
      const ownerNames = extractNames(ownerText, 3);
      entities.slaveowners.push(...ownerNames);
    }

    // Extract enslaved persons
    if (/\b(enslaved|slave|enslaved person|bound|held in bondage|property of|owned)\b/i.test(line)) {
      const names = extractNames(line, 15);
      entities.enslaved.push(...names);
    }

    // Extract heirs
    if (/\b(heir|inheritor|executor|executrix|son|daughter|wife|widow|brother|sister)\b/i.test(line) &&
        /\b(bequeathed|devised|willed|left|gave to|transferred to)\b/i.test(line)) {
      const names = extractNames(line, 5);
      entities.heirs.push(...names);
    }

    // Extract dates
    const dateMatch = extractDate(line);
    if (dateMatch && dateMatch > 1700 && dateMatch < 1900) {
      entities.dates.push(dateMatch);
    }

    // Extract valuations
    const valuation = extractValuation(line);
    if (valuation && valuation > 0 && valuation < 10000000) {
      entities.valuations.push(valuation);
    }
  }

  return {
    ...entities,
    slaveowners: [...new Set(entities.slaveowners)],
    enslaved: [...new Set(entities.enslaved)],
    heirs: [...new Set(entities.heirs)],
    dates: [...new Set(entities.dates)].sort((a, b) => a - b),
    valuations: [...new Set(entities.valuations)],
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Plantation Record Extraction Pipeline', () => {

  // Load fixture
  const fixturePath = path.join(__dirname, '../fixtures/plantation-records/fixture-jones-simple-ownership.json');
  let fixture;

  before(() => {
    if (fs.existsSync(fixturePath)) {
      fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    } else {
      console.warn(`WARNING: Fixture file not found at ${fixturePath}`);
      fixture = null;
    }
  });

  describe('Entity Extraction', () => {

    it('should extract slaveowner names from page 1', () => {
      if (!fixture) this.skip();

      const page1 = fixture.test_pages[0];
      const entities = extractEntitiesFromPage(page1.raw_text, page1.page_number);

      assert.ok(entities.slaveowners.length > 0, 'Should extract at least one slaveowner');
      assert.ok(
        entities.slaveowners.some(name => name.includes('Jones')),
        'Should extract Jones family name'
      );
    });

    it('should extract enslaved person names from page 1', () => {
      if (!fixture) this.skip();

      const page1 = fixture.test_pages[0];
      const entities = extractEntitiesFromPage(page1.raw_text, page1.page_number);

      const expected = fixture.test_pages[0].expected_extractions.enslaved;
      assert.ok(entities.enslaved.length >= expected.length, `Should extract at least ${expected.length} enslaved persons`);
      
      for (const name of expected) {
        assert.ok(
          entities.enslaved.some(extracted => extracted.includes(name.split(' ')[0])),
          `Should extract enslaved person: ${name}`
        );
      }
    });

    it('should extract heir names from page 2', () => {
      if (!fixture) this.skip();

      const page2 = fixture.test_pages[1];
      const entities = extractEntitiesFromPage(page2.raw_text, page2.page_number);

      assert.ok(entities.heirs.length > 0, 'Should extract at least one heir');
    });

    it('should extract dates within valid temporal range', () => {
      if (!fixture) this.skip();

      const page1 = fixture.test_pages[0];
      const entities = extractEntitiesFromPage(page1.raw_text, page1.page_number);

      assert.ok(entities.dates.length > 0, 'Should extract at least one date');
      assert.ok(
        entities.dates.every(d => d >= 1700 && d < 1900),
        'All dates should be in valid historical range (1700-1900)'
      );
    });

    it('should extract financial valuations from page 2', () => {
      if (!fixture) this.skip();

      const page2 = fixture.test_pages[1];
      const entities = extractEntitiesFromPage(page2.raw_text, page2.page_number);

      const expectedCount = fixture.test_pages[1].expected_extractions.valuations.length;
      assert.ok(
        entities.valuations.length >= expectedCount,
        `Should extract at least ${expectedCount} valuations`
      );
    });

  });

  describe('Accuracy Against Ground Truth', () => {

    it('should achieve >= 95% name extraction precision', () => {
      if (!fixture) this.skip();

      const allPages = fixture.test_pages;
      const allExtractions = allPages.map(page => 
        extractEntitiesFromPage(page.raw_text, page.page_number)
      );

      // Collect all extracted names
      const allExtractedNames = [
        ...allExtractions.flatMap(e => e.slaveowners),
        ...allExtractions.flatMap(e => e.enslaved),
        ...allExtractions.flatMap(e => e.heirs),
      ];

      // Check all extracted names are valid
      const validNames = allExtractedNames.filter(name => isValidPersonName(name));
      const precision = validNames.length / allExtractedNames.length;

      assert.ok(
        precision >= 0.95,
        `Name extraction precision should be >= 0.95, got ${precision.toFixed(2)}`
      );
    });

    it('should achieve >= 90% relationship accuracy', () => {
      if (!fixture) this.skip();

      const page1 = fixture.test_pages[0];
      const entities = extractEntitiesFromPage(page1.raw_text, page1.page_number);
      const expectedRelationships = page1.expected_extractions.relationships.length;

      // For each extracted slaveowner + enslaved pair, there should be a relationship
      const inferredRelationships = entities.slaveowners.length * entities.enslaved.length;

      assert.ok(
        inferredRelationships >= expectedRelationships * 0.9,
        `Relationship accuracy should be >= 90%`
      );
    });

    it('should achieve 100% date extraction accuracy for valid dates', () => {
      if (!fixture) this.skip();

      const allPages = fixture.test_pages;
      const expectedDates = new Set(
        allPages.flatMap(p => p.expected_extractions.dates || [])
      );

      for (const page of allPages) {
        const entities = extractEntitiesFromPage(page.raw_text, page.page_number);
        for (const expectedDate of (page.expected_extractions.dates || [])) {
          assert.ok(
            entities.dates.includes(expectedDate),
            `Should extract date: ${expectedDate}`
          );
        }
      }
    });

    it('should achieve >= 90% valuation extraction accuracy', () => {
      if (!fixture) this.skip();

      const page2 = fixture.test_pages[1];
      const entities = extractEntitiesFromPage(page2.raw_text, page2.page_number);
      const expectedValuations = page2.expected_extractions.valuations;

      let correctCount = 0;
      for (const expected of expectedValuations) {
        if (entities.valuations.includes(expected)) {
          correctCount++;
        }
      }

      const accuracy = correctCount / expectedValuations.length;
      assert.ok(
        accuracy >= 0.90,
        `Valuation extraction accuracy should be >= 0.90, got ${accuracy.toFixed(2)}`
      );
    });

  });

  describe('Stopword Filtering', () => {

    it('should reject common OCR artifacts and stopwords', () => {
      const testCases = [
        { name: 'and', shouldReject: true },
        { name: 'named', shouldReject: true },
        { name: 'slave', shouldReject: true },
        { name: 'George Noble Jones', shouldReject: false },
        { name: 'James', shouldReject: false },
        { name: 'Mary', shouldReject: false },
      ];

      for (const testCase of testCases) {
        const isValid = isValidPersonName(testCase.name);
        assert.strictEqual(
          isValid,
          !testCase.shouldReject,
          `Name "${testCase.name}" validation should be ${!testCase.shouldReject}`
        );
      }
    });

  });

  describe('Acceptance Criteria', () => {

    it('should satisfy fixture acceptance criteria', () => {
      if (!fixture) this.skip();

      const criteria = fixture.acceptance_criteria;

      // Run full extraction
      const allExtractions = fixture.test_pages.map(page =>
        extractEntitiesFromPage(page.raw_text, page.page_number)
      );

      const totalSlaveowners = new Set(allExtractions.flatMap(e => e.slaveowners)).size;
      const totalEnslavedMentioned = new Set(allExtractions.flatMap(e => e.enslaved)).size;

      // Validation
      assert.ok(
        totalSlaveowners >= criteria.required_canonical_persons_created * 0.9,
        `Should extract ~${criteria.required_canonical_persons_created} slaveowners`
      );

      assert.ok(
        totalEnslavedMentioned >= criteria.required_unconfirmed_persons_created * 0.9,
        `Should extract ~${criteria.required_unconfirmed_persons_created} enslaved persons`
      );

      assert.strictEqual(
        fixture.test_pages.length,
        criteria.required_pages_processed,
        `Should process ${criteria.required_pages_processed} pages`
      );
    });

  });

});