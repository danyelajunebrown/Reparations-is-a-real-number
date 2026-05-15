const fs = require('fs').promises;
const path = require('path');

// Mock OCR text from ground truth - we'll test the extractor produces valid JSON
// This simulates feeding the extractor known good OCR text
const MOCK_GOOD_OCR = `
Will of George W. Biscoe of Georgetown, D.C.
Signed this nineteenth day of July, 1859.
In the name of God Amen. I, George W. Biscoe...
I give to my wife Ann Maria Biscoe the use of Mary and Caroline during Emma's life.
I give to my daughter Emma Biscoe in trust, with Ann Maria Biscoe as trustee.
This trust includes Mary, Caroline, and Caroline's children.
The trust shall be for Emma's sole and separate use, free and discharged.
I have given advancement to my daughter Angelica Chew.
Witnessed by Walter H.S. Taylor, Margaret S.B. Tuck, J. Calvert.
`;

const MOCK_MARY_ANN_OCR = `
Will of Mary Ann Weaver of Washington, D.C.
Executrix: Rev. Edward J. Drinkhouse
Witnesses: Edward J. Drinkhouse, Samuel Barnes, Catherine Hall
I give to my daughter Angeline Drinkhouse the sum of $3,916.78 from my dower and inherited money.
I give to my son Theodore Barnes the sum of $3,916.78 from my dower and inherited money.
I give to my grandson William Horatio Barnes the sum of $1,645.70 from my dower and inherited money.
I give to my daughter Mary Ann E. Hall the sum of $2,771.08 from my inherited parental money.
I have dower money of $12,250.34 held by my husband.
I own the properties Drover's Rest and Harlem Farm, both with graveyards.
Codicil dated May 20, 1891: Mary Ann E. Hall receives share in late sale of Drover's Rest.
`;

describe('Extractor JSON Schema Validation', () => {
  /**
   * Validates that extraction output is valid JSON and meets required schema constraints
   */
  function validateExtractorJSON(extraction) {
    const failures = [];

    try {
      // Basic JSON parsing check
      if (typeof extraction !== 'object' || extraction === null) {
        failures.push('Extraction is not a valid object');
        return { valid: false, failures };
      }

      // Required top-level fields
      if (!extraction.testator || !extraction.testator.name) {
        failures.push('Missing required field: testator.name');
      }

      if (!extraction.enslaved_persons_extraction_note) {
        failures.push('Missing required field: enslaved_persons_extraction_note');
      }

      if (!Array.isArray(extraction.witnesses)) {
        failures.push('Missing or invalid field: witnesses must be an array');
      }

      // Enslaved persons array validation
      if (Array.isArray(extraction.enslaved_persons) && extraction.enslaved_persons.length > 0) {
        for (let i = 0; i < extraction.enslaved_persons.length; i++) {
          const person = extraction.enslaved_persons[i];
          if (!person.estate_interest_type) {
            failures.push(`Enslaved person at index ${i} missing estate_interest_type`);
          }

          // All enslaved persons must have either name or group_description
          if (!person.name && !person.group_description) {
            failures.push(`Enslaved person at index ${i} has neither name nor group_description`);
          }
        }

        // If enslaved_persons is non-empty, enslaved_persons_extraction_note must be set correctly
        if (extraction.enslaved_persons_extraction_note !== 'enslaved_named_see_array') {
          failures.push('enslaved_persons_extraction_note must equal "enslaved_named_see_array" when enslaved_persons array is non-empty');
        }
      }

      // Monetary bequests validation
      if (Array.isArray(extraction.monetary_bequests)) {
        for (let i = 0; i < extraction.monetary_bequests.length; i++) {
          const bequest = extraction.monetary_bequests[i];
          if (!bequest.bequest_fund_source) {
            failures.push(`Monetary bequest at index ${i} missing bequest_fund_source`);
          }
        }
      }

      // Acknowledged debts validation - must be separate from monetary bequests
      if (Array.isArray(extraction.acknowledged_debts) && Array.isArray(extraction.monetary_bequests)) {
        // Check for common error: putting acknowledged debt in monetary_bequests
        const debtInBequests = extraction.monetary_bequests.find(b => 
          b.beneficiary && b.beneficiary.toLowerCase().includes('self')
        );
        if (debtInBequests) {
          failures.push('CRITICAL: Acknowledged debt appears in monetary_bequests array. These should be in acknowledged_debts only.');
        }
      }

      // Trust instruments validation
      if (Array.isArray(extraction.trust_instruments)) {
        for (let i = 0; i < extraction.trust_instruments.length; i++) {
          const trust = extraction.trust_instruments[i];
          if (trust.trustee === trust.beneficial_owner) {
            failures.push(`Trust instrument at index ${i}: trustee === beneficial_owner — collapse bug detected`);
          }
        }
      }

      return {
        valid: failures.length === 0,
        failures,
      };
    } catch (error) {
      return {
        valid: false,
        failures: [`Validation error: ${error.message}`],
      };
    }
  }

  test('Validates George Biscoe extraction JSON structure', () => {
    // This will test the actual extractor once we implement it
    const mockExtraction = {
      testator: {
        name: "George W. Biscoe",
        place: "Georgetown, D.C.",
        signing_date: "1859-07-19",
      },
      enslaved_persons: [
        { name: "Mary", estate_interest_type: "trust" },
        { name: "Caroline", estate_interest_type: "trust" },
      ],
      enslaved_persons_extraction_note: "enslaved_named_see_array",
      witnesses: [
        { name: "Walter H.S. Taylor" },
        { name: "Margaret S.B. Tuck" },
      ],
      trust_instruments: [
        {
          trustee: "Ann Maria Biscoe",
          beneficial_owner: "Emma Biscoe",
          kind: "separate_use_trust",
        },
      ],
    };

    const result = validateExtractorJSON(mockExtraction);
    expect(result.valid).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  test('Fails validation when enslaved person missing estate_interest_type', () => {
    const invalidExtraction = {
      testator: { name: "Test" },
      enslaved_persons: [
        { name: "Mary" }, // Missing estate_interest_type
      ],
      enslaved_persons_extraction_note: "enslaved_named_see_array",
      witnesses: [],
    };

    const result = validateExtractorJSON(invalidExtraction);
    expect(result.valid).toBe(false);
    expect(result.failures).toContain('Enslaved person at index 0 missing estate_interest_type');
  });

  test('Fails validation when trust has trustee === beneficial_owner (collapse bug)', () => {
    const invalidExtraction = {
      testator: { name: "Test" },
      enslaved_persons: [],
      enslaved_persons_extraction_note: "none_mentioned",
      witnesses: [],
      trust_instruments: [
        {
          trustee: "Ann Maria Biscoe",
          beneficial_owner: "Ann Maria Biscoe", // Same person - collapse bug
          kind: "separate_use_trust",
        },
      ],
    };

    const result = validateExtractorJSON(invalidExtraction);
    expect(result.valid).toBe(false);
    expect(result.failures.some(f => f.includes('collapse bug'))).toBe(true);
  });

  test('Fails validation when acknowledged debt appears in monetary bequests', () => {
    const invalidExtraction = {
      testator: { name: "Test" },
      enslaved_persons: [],
      enslaved_persons_extraction_note: "none_mentioned",
      witnesses: [],
      monetary_bequests: [
        { beneficiary: "Mary Ann Weaver (self)", amount: 12250.34 }, // Should be in acknowledged_debts
      ],
      acknowledged_debts: [],
    };

    const result = validateExtractorJSON(invalidExtraction);
    expect(result.valid).toBe(false);
    expect(result.failures.some(f => f.includes('CRITICAL') && f.includes('acknowledged debt'))).toBe(true);
  });

  test('Validates Mary Ann Weaver extraction with proper fund sources', () => {
    const validExtraction = {
      testator: {
        name: "Mary Ann Weaver",
        place: "Washington, D.C.",
      },
      enslaved_persons: [],
      enslaved_persons_extraction_note: "none_mentioned",
      witnesses: [
        { name: "Edward J. Drinkhouse" },
      ],
      monetary_bequests: [
        { beneficiary: "Angeline Drinkhouse", amount: 3916.78, bequest_fund_source: "mixed_dower_and_inherited" },
      ],
      acknowledged_debts: [
        { creditor: "Mary Ann Weaver (self)", amount: 12250.34 },
      ],
    };

    const result = validateExtractorJSON(validExtraction);
    expect(result.valid).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  test('Fails validation when monetary bequest missing fund source', () => {
    const invalidExtraction = {
      testator: { name: "Test" },
      enslaved_persons: [],
      enslaved_persons_extraction_note: "none_mentioned",
      witnesses: [],
      monetary_bequests: [
        { beneficiary: "Angeline Drinkhouse", amount: 3916.78 }, // Missing bequest_fund_source
      ],
      acknowledged_debts: [],
    };

    const result = validateExtractorJSON(invalidExtraction);
    expect(result.valid).toBe(false);
    expect(result.failures.some(f => f.includes('missing bequest_fund_source')).toBe(true);
  });

  test('Validates that enslaved_persons_extraction_note is set correctly', () => {
    const testCases = [
      {
        description: 'enslaved persons present',
        input: {
          enslaved_persons: [{ name: "Mary" }],
          enslaved_persons_extraction_note: "enslaved_named_see_array",
        },
        shouldPass: true,
      },
      {
        description: 'enslaved persons missing',
        input: {
          enslaved_persons: [],
          enslaved_persons_extraction_note: "none_mentioned",
        },
        shouldPass: true,
      },
      {
        description: 'enslaved persons present but note is wrong',
        input: {
          enslaved_persons: [{ name: "Mary" }],
          enslaved_persons_extraction_note: "none_mentioned", // Wrong
        },
        shouldPass: false,
      },
    ];

    for (const testCase of testCases) {
      const extraction = {
        testator: { name: "Test" },
        witnesses: [],
        ...testCase.input,
      };
      const result = validateExtractorJSON(extraction);
      
      expect(result.valid).toBe(testCase.shouldPass);
      
      if (!testCase.shouldPass) {
        expect(result.failures.some(f => f.includes('enslaved_persons_extraction_note'))).toBe(true);
      }
    }
  });
});
