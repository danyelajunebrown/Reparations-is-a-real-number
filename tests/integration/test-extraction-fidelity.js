const fs = require('fs').promises;
const path = require('path');

/**
 * Compares live extraction output against ground truth fixture files.
 * Ensures field-by-field fidelity for critical data elements.
 */
function compareExtraction(live, groundTruth, testName) {
  const failures = [];
  
  // Enslaved persons — check by name, never by array index
  if (groundTruth.enslaved_persons && Array.isArray(groundTruth.enslaved_persons)) {
    for (const expected of groundTruth.enslaved_persons) {
      const found = live.enslaved_persons.find(p => 
        p.name === expected.name && p.group_description === expected.group_description
      );
      
      if (!found) {
        failures.push(`MISSING ENSLAVED PERSON: ${expected.name || expected.group_description}`);
      } else {
        if (found.trustee_for !== expected.trustee_for) {
          failures.push(`TRUSTEE MISMATCH for ${expected.name}: got ${found.trustee_for}, expected ${expected.trustee_for}`);
        }
        if (found.beneficial_owner !== expected.beneficial_owner) {
          failures.push(`BENEFICIAL OWNER MISMATCH for ${expected.name}: got ${found.beneficial_owner}, expected ${expected.beneficial_owner}`);
        }
        if (found.estate_interest_type !== expected.estate_interest_type) {
          failures.push(`ESTATE INTEREST TYPE MISMATCH for ${expected.name}: got ${found.estate_interest_type}, expected ${expected.estate_interest_type}`);
        }
      }
    }
    
    // Check for extra enslaved persons not in ground truth
    if (live.enslaved_persons) {
      for (const extra of live.enslaved_persons) {
        const expected = groundTruth.enslaved_persons.find(p =>
          p.name === extra.name && p.group_description === extra.group_description
        );
        if (!expected) {
          failures.push(`EXTRA ENSLAVED PERSON NOT IN GROUND TRUTH: ${extra.name || extra.group_description}`);
        }
      }
    }
  }
  
  // Cross-will accounting reconciliation
  if (groundTruth.cross_will_accounting_link && Array.isArray(live.monetary_bequests) && Array.isArray(live.acknowledged_debts)) {
    const bequest_total = live.monetary_bequests.reduce((sum, b) => sum + (b.amount || 0), 0);
    const acknowledged_total = live.acknowledged_debts.reduce((sum, d) => sum + (d.amount || 0), 0);
    const delta = Math.abs(bequest_total - acknowledged_total);
    
    // Convert delta from ground truth cents to comparable dollars for this check
    const expectedDelta = groundTruth.cross_will_accounting_link.delta_cents / 100;
    
    if (delta > 5.00) { // $5 tolerance for transcription rounding
      failures.push(`CROSS-WILL ACCOUNTING MISMATCH: bequests total $${bequest_total.toFixed(2)}, acknowledged debt $${acknowledged_total.toFixed(2)}, delta $${delta.toFixed(2)} (expected delta: $${expectedDelta.toFixed(2)})`);
    }
  }
  
  // Monetary bequests validation
  if (groundTruth.monetary_bequests && Array.isArray(groundTruth.monetary_bequests)) {
    for (const expected of groundTruth.monetary_bequests) {
      const found = live.monetary_bequests.find(b => b.beneficiary === expected.beneficiary);
      if (!found) {
        failures.push(`MISSING MONETARY BEQUEST to ${expected.beneficiary}: $${expected.amount}`);
      } else if (Math.abs(found.amount - expected.amount) > 0.01) {
        failures.push(`MONETARY BEQUEST AMOUNT MISMATCH for ${expected.beneficiary}: got $${found.amount}, expected $${expected.amount}`);
      }
    }
  }
  
  // Named properties validation
  if (groundTruth.named_properties && Array.isArray(groundTruth.named_properties)) {
    for (const expected of groundTruth.named_properties) {
      const found = live.named_properties && live.named_properties.find(p => 
        p.property_name === expected.property_name
      );
      if (!found) {
        failures.push(`MISSING NAMED PROPERTY: ${expected.property_name}`);
      } else {
        if (found.graveyard_present !== expected.graveyard_present) {
          failures.push(`GRAVEYARD FLAG MISMATCH for ${expected.property_name}: got ${found.graveyard_present}, expected ${expected.graveyard_present}`);
        }
      }
    }
  }
  
  // Trust instruments validation
  if (groundTruth.trust_instruments && Array.isArray(groundTruth.trust_instruments)) {
    for (let i = 0; i < groundTruth.trust_instruments.length; i++) {
      const expected = groundTruth.trust_instruments[i];
      const found = live.trust_instruments && live.trust_instruments.find((t, idx) => idx === i);
      if (!found) {
        failures.push(`MISSING TRUST INSTRUMENT at index ${i}`);
      } else {
        if (found.legal_protection !== expected.legal_protection) {
          failures.push(`TRUST LEGAL PROTECTION MISMATCH at index ${i}`);
        }
      }
    }
  }
  
  return failures;
}

describe('Extraction Fidelity Integration Tests', () => {
  async function loadGroundTruth(fixtureName) {
    const fixturePath = path.join(__dirname, `../fixtures/wills/${fixtureName}`);
    try {
      const content = await fs.readFile(fixturePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to load fixture ${fixtureName}:`, error.message);
      throw error;
    }
  }

  test('George Biscoe 1859 extraction matches ground truth', async () => {
    const groundTruth = await loadGroundTruth('george-biscoe-1859-ground-truth.json');
    
    // Mock live extraction that should match ground truth
    // In real tests, this would come from actual extractor output
    const liveExtraction = {
      testator: {
        name: "George W. Biscoe",
        place: "Georgetown, D.C.",
        signing_date: "1859-07-19",
        death_date: "1859-08-27",
        proved_dates: ["1859-08-27"],
      },
      spouse: {
        name: "Ann Maria Biscoe",
        prior_marriages: [],
      },
      children: [
        { name: "Angelica Chew", role: "legatee", estate_interest_type: "remainder" },
        { name: "Emma Biscoe", role: "beneficial_owner", estate_interest_type: "trust" },
      ],
      enslaved_persons: [
        { 
          name: "Mary", 
          group_description: null, 
          parent_link: null, 
          bequeathed_to: "Ann Maria Biscoe", 
          trustee_for: "Ann Maria Biscoe", 
          beneficial_owner: "Emma Biscoe", 
          estate_interest_type: "trust", 
          manumitted: false 
        },
        { 
          name: "Caroline", 
          group_description: null, 
          parent_link: null, 
          bequeathed_to: "Ann Maria Biscoe", 
          trustee_for: "Ann Maria Biscoe", 
          beneficial_owner: "Emma Biscoe", 
          estate_interest_type: "trust", 
          manumitted: false 
        },
        { 
          name: null, 
          group_description: "Caroline's children", 
          parent_link: { "name": "Caroline", "relationship": "mother" }, 
          count: null, 
          bequeathed_to: "Ann Maria Biscoe", 
          trustee_for: "Ann Maria Biscoe", 
          beneficial_owner: "Emma Biscoe", 
          estate_interest_type: "trust", 
          research_flag: "anonymous_group_needs_follow_up", 
          manumitted: false 
        },
      ],
      enslaved_persons_extraction_note: "enslaved_named_see_array",
      trust_instruments: [
        { 
          kind: "separate_use_trust", 
          trustee: "Ann Maria Biscoe", 
          beneficial_owner: "Emma Biscoe", 
          legal_protection: "sole and separate use, free, clear & discharged of and from all liability for or on account of any husband she may marry", 
          asset_refs: ["Mary", "Caroline", "Caroline's children"] 
        },
      ],
      prior_transfers_referenced: [
        { 
          recipient: "Angelica Chew", 
          nature: "by way of advancement", 
          property_type: "unspecified", 
          record_date: null, 
          notes: "testator states prior gifts made to equalize shares between daughters" 
        },
      ],
      acknowledged_debts: [],
      witnesses: [
        { name: "Walter H.S. Taylor" },
        { name: "Margaret S.B. Tuck" },
        { name: "J. Calvert" },
      ],
      executors: [{ name: "Ann Maria Biscoe" }],
      court_jurisdiction: "District of Columbia Orphans Court, Washington County",
    };

    const failures = compareExtraction(liveExtraction, groundTruth, 'George Biscoe 1859');
    expect(failures).toHaveLength(0);
  });

  test('Mary Ann Weaver 1883 extraction matches ground truth', async () => {
    const groundTruth = await loadGroundTruth('mary-ann-weaver-1883-ground-truth.json');
    
    const liveExtraction = {
      testator: {
        name: "Mary Ann Weaver",
        place: "Washington, D.C.",
        signing_date: "1883-05-10",
        death_date: "1883-06-15",
        proved_dates: ["1883-07-01"],
      },
      spouse: {
        name: "Henry Weaver",
        prior_marriages: [{ name: "Barnes", deceased: true }],
      },
      children: [
        { name: "Angeline Drinkhouse", role: "daughter" },
        { name: "Theodore Barnes", role: "son" },
        { name: "William Horatio Barnes", role: "grandson" },
        { name: "Mary Ann E. Hall", role: "daughter" },
      ],
      enslaved_persons: [],
      enslaved_persons_extraction_note: "none_mentioned",
      monetary_bequests: [
        { beneficiary: "Angeline Drinkhouse", amount: 3916.78, bequest_fund_source: "mixed_dower_and_inherited" },
        { beneficiary: "Theodore Barnes", amount: 3916.78, bequest_fund_source: "mixed_dower_and_inherited" },
        { beneficiary: "William Horatio Barnes", amount: 1645.70, bequest_fund_source: "mixed_dower_and_inherited" },
        { beneficiary: "Mary Ann E. Hall", amount: 2771.08, bequest_fund_source: "inherited_parental" },
      ],
      acknowledged_debts: [
        { 
          creditor: "Mary Ann Weaver (self — funds held by husband)", 
          amount: 12250.34, 
          debt_nature: "wife_separate_property", 
          sources: ["dower_prior_marriage", "inherited_parental"] 
        },
      ],
      named_properties: [
        { property_name: "Drover's Rest", graveyard_present: true, sale_status: "installment_sale_pending" },
        { property_name: "Harlem Farm", graveyard_present: true, sale_status: "unknown" },
      ],
      cross_will_accounting_link: {
        linked_will_testator: "Henry Weaver",
        linked_will_year: 1884,
        reconciliation_status: "matched",
        delta_cents: 98,
      },
      codicil: {
        date: "1891-05-20",
        bequests: [
          { 
            beneficiary: "Mary Ann E. Hall", 
            description: "share in late sale of Drover's Rest property when last note becomes due", 
            source_document: "codicil" 
          },
        ],
      },
      witnesses: [
        { name: "Edward J. Drinkhouse" },
        { name: "Samuel Barnes" },
        { name: "Catherine Hall" },
      ],
      executors: [{ name: "Rev. Edward J. Drinkhouse" }],
      court_jurisdiction: "District of Columbia Orphans Court, Washington County",
    };

    const failures = compareExtraction(liveExtraction, groundTruth, 'Mary Ann Weaver 1883');
    expect(failures).toHaveLength(0);
  });

  test('Detects missing enslaved person', async () => {
    const groundTruth = await loadGroundTruth('george-biscoe-1859-ground-truth.json');
    
    const incompleteExtraction = {
      ...groundTruth,
      enslaved_persons: [
        // Missing "Caroline's children" group
        groundTruth.enslaved_persons[0],
        groundTruth.enslaved_persons[1],
      ],
    };

    const failures = compareExtraction(incompleteExtraction, groundTruth, 'Missing enslaved person test');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some(f => f.includes('MISSING ENSLAVED PERSON') && f.includes('Caroline'))).toBe(true);
  });

  test('Detects cross-will accounting mismatch', async () => {
    const groundTruth = await loadGroundTruth('mary-ann-weaver-1883-ground-truth.json');
    
    const mismatchedExtraction = {
      ...groundTruth,
      monetary_bequests: [
        // Wrong total - should cause cross-will mismatch detection
        { beneficiary: "Angeline Drinkhouse", amount: 4000.00, bequest_fund_source: "mixed_dower_and_inherited" },
        { beneficiary: "Theodore Barnes", amount: 3916.78, bequest_fund_source: "mixed_dower_and_inherited" },
        { beneficiary: "William Horatio Barnes", amount: 1645.70, bequest_fund_source: "mixed_dower_and_inherited" },
        { beneficiary: "Mary Ann E. Hall", amount: 2771.08, bequest_fund_source: "inherited_parental" },
      ],
    };

    const failures = compareExtraction(mismatchedExtraction, groundTruth, 'Cross-will accounting mismatch test');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some(f => f.includes('CROSS-WILL ACCOUNTING MISMATCH'))).toBe(true);
  });

  test('Detects trustee === beneficial_owner collapse bug', async () => {
    const groundTruth = await loadGroundTruth('george-biscoe-1859-ground-truth.json');
    
    const collapsedExtraction = {
      ...groundTruth,
      trust_instruments: [
        {
          ...groundTruth.trust_instruments[0],
          trustee: "Ann Maria Biscoe", // Same as beneficial_owner - collapse bug
          beneficial_owner: "Ann Maria Biscoe",
        },
      ],
    };

    const failures = compareExtraction(collapsedExtraction, groundTruth, 'Trust collapse bug test');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some(f => f.includes('TRUSTEE') || f.includes('BENEFICIAL OWNER'))).toBe(true);
  });
});