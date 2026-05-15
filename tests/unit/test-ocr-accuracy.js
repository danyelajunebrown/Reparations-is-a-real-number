const fs = require('fs').promises;
const path = require('path');
const OCRService = require('../../src/services/document/OCRService');

const BISCOE_OCR_ASSERTIONS = [
  // Names of enslaved persons — these MUST appear in OCR output
  { must_contain: "Mary", failure_msg: "Enslaved person 'Mary' not found in OCR — will produce missing enslaved_individuals row" },
  { must_contain: "Caroline", failure_msg: "Enslaved person 'Caroline' not found in OCR" },
  { must_contain: "Caroline's children", failure_msg: "Anonymous group 'Caroline's children' not found — group entry will be dropped" },
  // Trust language — must survive OCR
  { must_contain: "sole and separate use", failure_msg: "Coverture protection clause not OCR'd — trust_instruments will lack legal_protection field" },
  { must_contain: "Ann Maria Biscoe", failure_msg: "Trustee name not OCR'd" },
  // Prior transfer reference
  { must_contain: "advancement", failure_msg: "Advancement clause not OCR'd — prior_transfers_referenced will be empty" },
  // Dates
  { must_contain: "Nineteenth day of July", failure_msg: "Signing date not OCR'd" },
];

const MARY_ANN_WEAVER_OCR_ASSERTIONS = [
  { must_contain: "12,250", failure_msg: "Critical $12,250.34 figure not OCR'd — cross_will_accounting_link will fail to reconcile" },
  { must_contain: "Horatio Barnes", failure_msg: "Prior husband name not OCR'd — relationship_candidates will miss Barnes family structure" },
  { must_contain: "Drover's Rest", failure_msg: "Named property not OCR'd — named_properties array will be empty" },
  { must_contain: "Harlem Farm", failure_msg: "Second named property not OCR'd" },
  { must_contain: "Theodore Barnes", failure_msg: "Son's name not OCR'd — blended family structure lost" },
  { must_contain: "William Horatio Barnes", failure_msg: "Grandson not OCR'd" },
  { must_contain: "dower money", failure_msg: "Dower source language not OCR'd — bequest_fund_source will default to unspecified" },
  { must_contain: "codicil", failure_msg: "Codicil not detected in OCR — codicil bequests will be silently dropped" },
  { must_contain: "Drinkhouse", failure_msg: "Executor surname not OCR'd — executor-as-family-member pattern undetectable" },
];

describe('OCR Accuracy Tests', () => {
  let ocrService;

  beforeAll(() => {
    ocrService = new OCRService();
  });

  async function runOCRAssertions(pdfPath, assertions, testName) {
    if (!await fs.access(pdfPath).catch(() => false)) {
      console.warn(`PDF not found: ${pdfPath} — skipping ${testName}`);
      return;
    }

    console.log(`Running OCR on ${pdfPath}...`);
    const ocrResult = await ocrService.performOCR(pdfPath, 'will');
    const ocrText = ocrResult.text;

    const failures = [];
    let passedAssertions = 0;

    for (const assertion of assertions) {
      if (!ocrText.includes(assertion.must_contain)) {
        failures.push(assertion.failure_msg);
      } else {
        passedAssertions++;
      }
    }

    const passRate = passedAssertions / assertions.length;
    console.log(`${testName}: ${passedAssertions}/${assertions.length} assertions passed (${(passRate * 100).toFixed(0)}%)`);

    if (failures.length > 0) {
      console.error(`${testName} Failures:\n${failures.join('\n')}`);
    }

    return {
      passed: passRate >= 0.80,
      passRate,
      failures,
      ocrText,
    };
  }

  test('George Biscoe will OCR accuracy', async () => {
    const pdfPath = path.join(__dirname, '../fixtures/wills/pdfs/george-biscoe-1859.pdf');
    const result = await runOCRAssertions(pdfPath, BISCOE_OCR_ASSERTIONS, 'George Biscoe 1859');
    
    expect(result.passed).toBe(true);
    expect(result.passRate).toBeGreaterThanOrEqual(0.80);
    expect(result.failures).toHaveLength(0);
  });

  test('Mary Ann Weaver will OCR accuracy', async () => {
    const pdfPath = path.join(__dirname, '../fixtures/wills/pdfs/mary-ann-weaver-1883.pdf');
    const result = await runOCRAssertions(pdfPath, MARY_ANN_WEAVER_OCR_ASSERTIONS, 'Mary Ann Weaver 1883');
    
    expect(result.passed).toBe(true);
    expect(result.passRate).toBeGreaterThanOrEqual(0.80);
    expect(result.failures).toHaveLength(0);
  });

  test('Halts on low OCR accuracy', async () => {
    // This test uses a dummy PDF that should produce very poor OCR
    const pdfPath = path.join(__dirname, '../fixtures/wills/pdfs/blank.pdf');
    const result = await runOCRAssertions(pdfPath, BISCOE_OCR_ASSERTIONS, 'Low Accuracy Test');
    
    expect(result.passed).toBe(false);
    expect(result.passRate).toBeLessThan(0.80);
  });
});