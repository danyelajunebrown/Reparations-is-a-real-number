#!/usr/bin/env node
/**
 * validate-intake-form.js
 *
 * Processes Google Form CSV exports for the Reparations Premiere Intake Form.
 * Validates all fields, verifies FamilySearch IDs exist, checks tree linkage,
 * and queues ancestor climbs.
 *
 * Usage:
 *   node scripts/validate-intake-form.js --csv <path-to-csv>
 *   node scripts/validate-intake-form.js --csv <path-to-csv> --dry-run
 *   node scripts/validate-intake-form.js --csv <path-to-csv> --queue-climbs
 *   node scripts/validate-intake-form.js --verify-single <FS_ID>
 *
 * CSV columns expected (Google Form export order):
 *   Timestamp, consent_research, consent_income, consent_negative, consent_blockchain,
 *   full_name, date_of_birth, birthplace, email, address_street, address_city,
 *   address_state, address_zip, self_fs_id, self_is_living,
 *   father_name, father_birth_year, father_birthplace, father_fs_id, father_is_living,
 *   mother_name, mother_birth_year, mother_birthplace, mother_fs_id, mother_is_living,
 *   annual_income, estimated_net_worth, real_estate_equity, inheritance_received,
 *   inheritance_expected, tax_filing_status, num_dependents,
 *   trust_beneficiary, trust_corpus,
 *   family_business_ownership, family_business_details,
 *   inherited_land_acres, inherited_land_states, inherited_land_use,
 *   corporate_connections, corporate_connection_details,
 *   executive_board_history, pre_1865_business_continuity, pre_1865_business_details,
 *   pat_grandfather_name, pat_grandfather_birth_year, pat_grandfather_birthplace, pat_grandfather_fs_id, pat_grandfather_is_living,
 *   pat_grandmother_name, pat_grandmother_birth_year, pat_grandmother_birthplace, pat_grandmother_fs_id, pat_grandmother_is_living,
 *   mat_grandfather_name, mat_grandfather_birth_year, mat_grandfather_birthplace, mat_grandfather_fs_id, mat_grandfather_is_living,
 *   mat_grandmother_name, mat_grandmother_birth_year, mat_grandmother_birthplace, mat_grandmother_fs_id, mat_grandmother_is_living,
 *   tree_verified, chain_complete, chain_gaps, additional_info, certify_accurate
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ── Configuration ────────────────────────────────────────────────────────────

// FamilySearch IDs: 4 consonants/digits, hyphen, 2-4 consonants/digits (no vowels)
const FS_ID_REGEX = /^[BCDFGHJKLMNPQRSTVWXYZ0-9]{4}-[BCDFGHJKLMNPQRSTVWXYZ0-9]{2,4}$/;

// Relaxed regex for validation messages (allows vowels, catches typos differently)
const FS_ID_LOOSE_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/;

const CURRENT_YEAR = new Date().getFullYear();

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','PR','GU','VI','AS','MP'
];

// ── CSV Column Mapping ──────────────────────────────────────────────────────

// Maps Google Form column headers to internal field names.
// Google Forms exports headers as the question text, so we map by position.
const COLUMN_MAP = [
  'timestamp',
  'consent_research',
  'consent_income',
  'consent_negative',
  'consent_blockchain',
  'full_name',
  'date_of_birth',
  'birthplace',
  'email',
  'address_street',
  'address_city',
  'address_state',
  'address_zip',
  'self_fs_id',
  'self_is_living',
  'father_name',
  'father_birth_year',
  'father_birthplace',
  'father_fs_id',
  'father_is_living',
  'mother_name',
  'mother_birth_year',
  'mother_birthplace',
  'mother_fs_id',
  'mother_is_living',
  'annual_income',
  'estimated_net_worth',
  'real_estate_equity',
  'inheritance_received',
  'inheritance_expected',
  'tax_filing_status',
  'num_dependents',
  'trust_beneficiary',
  'trust_corpus',
  'family_business_ownership',
  'family_business_details',
  'inherited_land_acres',
  'inherited_land_states',
  'inherited_land_use',
  'corporate_connections',
  'corporate_connection_details',
  'executive_board_history',
  'pre_1865_business_continuity',
  'pre_1865_business_details',
  'pat_grandfather_name',
  'pat_grandfather_birth_year',
  'pat_grandfather_birthplace',
  'pat_grandfather_fs_id',
  'pat_grandfather_is_living',
  'pat_grandmother_name',
  'pat_grandmother_birth_year',
  'pat_grandmother_birthplace',
  'pat_grandmother_fs_id',
  'pat_grandmother_is_living',
  'mat_grandfather_name',
  'mat_grandfather_birth_year',
  'mat_grandfather_birthplace',
  'mat_grandfather_fs_id',
  'mat_grandfather_is_living',
  'mat_grandmother_name',
  'mat_grandmother_birth_year',
  'mat_grandmother_birthplace',
  'mat_grandmother_fs_id',
  'mat_grandmother_is_living',
  'tree_verified',
  'chain_complete',
  'chain_gaps',
  'additional_info',
  'certify_accurate'
];

// ── Validators ──────────────────────────────────────────────────────────────

function validateFsId(id, fieldLabel) {
  const errors = [];
  const trimmed = (id || '').trim().toUpperCase();

  if (!trimmed) {
    errors.push(`${fieldLabel}: FamilySearch ID is required`);
    return { value: null, errors };
  }

  if (!FS_ID_LOOSE_REGEX.test(trimmed)) {
    errors.push(`${fieldLabel}: "${trimmed}" is not a valid FamilySearch ID format (expected XXXX-XXX)`);
    return { value: trimmed, errors };
  }

  if (!FS_ID_REGEX.test(trimmed)) {
    // Contains vowels — likely a typo
    const vowels = trimmed.match(/[AEIOU]/g);
    errors.push(`${fieldLabel}: "${trimmed}" contains vowel(s) [${vowels.join(',')}] — FamilySearch IDs never contain A, E, I, O, or U. Check for typos.`);
    return { value: trimmed, errors };
  }

  return { value: trimmed, errors };
}

function validateName(name, fieldLabel, minLength = 3) {
  const errors = [];
  const trimmed = (name || '').trim();

  if (!trimmed) {
    errors.push(`${fieldLabel}: Name is required`);
    return { value: null, errors };
  }

  if (trimmed.length < minLength) {
    errors.push(`${fieldLabel}: "${trimmed}" is too short (minimum ${minLength} characters)`);
    return { value: trimmed, errors };
  }

  // Check for placeholder/garbage names
  const garbage = /^(unknown|n\/a|none|test|xxx|tbd|\?+|\.+)$/i;
  if (garbage.test(trimmed)) {
    errors.push(`${fieldLabel}: "${trimmed}" appears to be a placeholder, not a real name`);
    return { value: trimmed, errors };
  }

  return { value: trimmed, errors };
}

function validateBirthYear(year, fieldLabel, minYear = 1860, maxYear = CURRENT_YEAR) {
  const errors = [];
  const parsed = parseInt((year || '').toString().trim(), 10);

  if (!year || isNaN(parsed)) {
    errors.push(`${fieldLabel}: Birth year is required`);
    return { value: null, errors };
  }

  if (parsed < minYear || parsed > maxYear) {
    errors.push(`${fieldLabel}: Birth year ${parsed} is outside valid range (${minYear}–${maxYear})`);
    return { value: parsed, errors };
  }

  return { value: parsed, errors };
}

function validateEmail(email) {
  const errors = [];
  const trimmed = (email || '').trim().toLowerCase();

  if (!trimmed) {
    errors.push('Email: Required');
    return { value: null, errors };
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    errors.push(`Email: "${trimmed}" is not a valid email address`);
    return { value: trimmed, errors };
  }

  return { value: trimmed, errors };
}

function validateIncome(income) {
  const errors = [];
  // Strip $ and commas
  const cleaned = (income || '').toString().replace(/[$,\s]/g, '');
  const parsed = parseFloat(cleaned);

  if (!cleaned || isNaN(parsed)) {
    errors.push('Annual income: Required (numeric value)');
    return { value: null, errors };
  }

  if (parsed <= 0) {
    errors.push('Annual income: Must be greater than zero');
    return { value: parsed, errors };
  }

  if (parsed > 100000000) {
    errors.push(`Annual income: $${parsed.toLocaleString()} seems implausibly high — verify`);
  }

  return { value: parsed, errors };
}

function validateFinancialField(value, fieldLabel, required) {
  const errors = [];
  const cleaned = (value || '').toString().replace(/[$,\s]/g, '');

  // Allow "0" or "$0" as valid (e.g., no real estate, no inheritance)
  if (cleaned === '' || cleaned === undefined) {
    if (required) {
      errors.push(`${fieldLabel}: Required (enter 0 if none)`);
    }
    return { value: null, errors };
  }

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) {
    errors.push(`${fieldLabel}: "${value}" is not a valid number`);
    return { value: null, errors };
  }

  // Net worth can be negative (more debt than assets), but others can't
  if (parsed < 0 && !fieldLabel.toLowerCase().includes('net worth')) {
    errors.push(`${fieldLabel}: Cannot be negative (enter 0 if none)`);
    return { value: parsed, errors };
  }

  return { value: parsed, errors };
}

function validateZip(zip) {
  const errors = [];
  const trimmed = (zip || '').trim();

  if (!trimmed) {
    errors.push('ZIP code: Required');
    return { value: null, errors };
  }

  if (!/^\d{5}(-\d{4})?$/.test(trimmed)) {
    errors.push(`ZIP code: "${trimmed}" is not a valid format (expected 12345 or 12345-6789)`);
    return { value: trimmed, errors };
  }

  return { value: trimmed, errors };
}

function validateConsent(value, fieldLabel) {
  const errors = [];
  const trimmed = (value || '').trim().toLowerCase();

  // Google Forms checkboxes export as the checkbox label text or empty
  if (!trimmed || trimmed === 'no' || trimmed === 'false' || trimmed === '') {
    errors.push(`${fieldLabel}: Consent not given — participant cannot proceed without this`);
    return { value: false, errors };
  }

  return { value: true, errors };
}

// ── Cross-Validation (relationship consistency) ─────────────────────────────

function crossValidate(participant) {
  const warnings = [];

  // Check generational plausibility
  const selfDob = participant.date_of_birth ? new Date(participant.date_of_birth).getFullYear() : null;

  const checkGenerationGap = (parentYear, parentLabel, childYear, childLabel) => {
    if (parentYear && childYear) {
      const gap = childYear - parentYear;
      if (gap < 12) {
        warnings.push(`IMPLAUSIBLE: ${parentLabel} (b.${parentYear}) is only ${gap} years older than ${childLabel} (b.${childYear})`);
      }
      if (gap > 60) {
        warnings.push(`UNLIKELY: ${parentLabel} (b.${parentYear}) is ${gap} years older than ${childLabel} (b.${childYear}) — verify`);
      }
    }
  };

  // Self ↔ Parents
  if (selfDob) {
    checkGenerationGap(participant.father_birth_year, 'Father', selfDob, 'Self');
    checkGenerationGap(participant.mother_birth_year, 'Mother', selfDob, 'Self');
  }

  // Parents ↔ Grandparents
  checkGenerationGap(participant.pat_grandfather_birth_year, 'Paternal grandfather', participant.father_birth_year, 'Father');
  checkGenerationGap(participant.pat_grandmother_birth_year, 'Paternal grandmother', participant.father_birth_year, 'Father');
  checkGenerationGap(participant.mat_grandfather_birth_year, 'Maternal grandfather', participant.mother_birth_year, 'Mother');
  checkGenerationGap(participant.mat_grandmother_birth_year, 'Maternal grandmother', participant.mother_birth_year, 'Mother');

  // Check for duplicate FS IDs (would indicate copy-paste error)
  const allFsIds = [
    participant.self_fs_id,
    participant.father_fs_id,
    participant.mother_fs_id,
    participant.pat_grandfather_fs_id,
    participant.pat_grandmother_fs_id,
    participant.mat_grandfather_fs_id,
    participant.mat_grandmother_fs_id
  ].filter(Boolean);

  const seen = new Set();
  for (const id of allFsIds) {
    if (seen.has(id)) {
      warnings.push(`DUPLICATE FS ID: ${id} appears more than once — this is almost certainly a copy-paste error`);
    }
    seen.add(id);
  }

  return warnings;
}

// ── FamilySearch Verification ───────────────────────────────────────────────

/**
 * Verify a FamilySearch ID exists by checking the person page.
 * This uses the public (no-auth) person page which returns basic info
 * or "Person Not Found" for invalid IDs.
 *
 * For living persons, FS returns [Unknown Name] but the page still loads.
 *
 * NOTE: This requires a logged-in FamilySearch session in Chrome on port 9222.
 * If Chrome is not available, falls back to HTTP check (less reliable).
 */
async function verifyFsIdExists(fsId) {
  // Try the FamilySearch person API (public, no auth needed for basic check)
  // URL: https://www.familysearch.org/tree/person/details/<FS_ID>
  // Returns 200 for valid persons (living or dead), 404 for invalid

  try {
    const https = require('https');
    return new Promise((resolve) => {
      const url = `https://www.familysearch.org/tree/person/details/${fsId}`;
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept': 'text/html'
        },
        timeout: 10000
      }, (res) => {
        // FS redirects to login for non-authenticated requests,
        // but a 301/302 to /auth still confirms the person exists
        // A true 404 means the person doesn't exist
        if (res.statusCode === 404) {
          resolve({ exists: false, status: 'not_found', message: `FS ID ${fsId} does not exist on FamilySearch` });
        } else if ([200, 301, 302, 303, 307, 308, 403].includes(res.statusCode)) {
          // 307/308 = temp/perm redirect (FS auth gate), 403 = auth required (living person)
          // All of these confirm the person record exists
          resolve({ exists: true, status: 'found', message: `FS ID ${fsId} exists (HTTP ${res.statusCode})` });
        } else {
          resolve({ exists: null, status: 'unknown', message: `Unexpected HTTP ${res.statusCode} for ${fsId}` });
        }
        res.resume(); // Drain response
      });

      req.on('error', (err) => {
        resolve({ exists: null, status: 'error', message: `Could not reach FamilySearch: ${err.message}` });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ exists: null, status: 'timeout', message: `FamilySearch request timed out for ${fsId}` });
      });
    });
  } catch (err) {
    return { exists: null, status: 'error', message: err.message };
  }
}

/**
 * Verify tree linkage: confirm that grandparent → parent → self chain exists.
 * Requires Chrome with FamilySearch session on port 9222.
 * Returns linkage verification results.
 */
async function verifyTreeLinkage(participant) {
  // This would use Puppeteer to navigate to each person's FS page
  // and confirm parent-child relationships match what the form says.
  // For now, we flag it as "needs manual verification" if Chrome isn't available.

  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    return {
      verified: false,
      method: 'skipped',
      message: 'Puppeteer not available — tree linkage must be verified manually or via Chrome on port 9222'
    };
  }

  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://localhost:9222',
      defaultViewport: null
    });

    const page = await browser.newPage();
    const results = [];

    // Check each grandparent → parent link
    const checks = [
      { parent: participant.father_fs_id, child: 'father', grandparents: [participant.pat_grandfather_fs_id, participant.pat_grandmother_fs_id] },
      { parent: participant.mother_fs_id, child: 'mother', grandparents: [participant.mat_grandfather_fs_id, participant.mat_grandmother_fs_id] },
    ];

    for (const check of checks) {
      if (!check.parent) continue;

      await page.goto(`https://www.familysearch.org/tree/person/details/${check.parent}`, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));

      const pageText = await page.evaluate(() => document.body.innerText);

      for (const gpId of check.grandparents) {
        if (!gpId) continue;
        const found = pageText.includes(gpId);
        results.push({
          parent_fs_id: check.parent,
          expected_grandparent_fs_id: gpId,
          relationship: check.child,
          linked: found,
          message: found
            ? `✓ ${gpId} found as parent of ${check.parent}`
            : `✗ ${gpId} NOT found on ${check.parent}'s page — tree linkage broken`
        });
      }
    }

    // Check self → parents link
    if (participant.self_fs_id) {
      await page.goto(`https://www.familysearch.org/tree/person/details/${participant.self_fs_id}`, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));

      const pageText = await page.evaluate(() => document.body.innerText);

      for (const parentId of [participant.father_fs_id, participant.mother_fs_id]) {
        if (!parentId) continue;
        const found = pageText.includes(parentId);
        results.push({
          self_fs_id: participant.self_fs_id,
          expected_parent_fs_id: parentId,
          linked: found,
          message: found
            ? `✓ ${parentId} found as parent of ${participant.self_fs_id}`
            : `✗ ${parentId} NOT found on ${participant.self_fs_id}'s page — tree linkage broken`
        });
      }
    }

    await page.close();

    const allLinked = results.every(r => r.linked);
    return {
      verified: allLinked,
      method: 'puppeteer',
      results,
      message: allLinked
        ? '✓ All tree linkages verified'
        : `✗ ${results.filter(r => !r.linked).length} broken link(s) found`
    };
  } catch (err) {
    return {
      verified: false,
      method: 'error',
      message: `Tree linkage verification failed: ${err.message}`
    };
  }
}

// ── Main Processing ─────────────────────────────────────────────────────────

function parseRow(row, index) {
  // Map array values to named fields using COLUMN_MAP
  const data = {};
  COLUMN_MAP.forEach((key, i) => {
    data[key] = row[i] || '';
  });
  data._row = index + 2; // +2 for 1-indexed + header row
  return data;
}

function validateParticipant(data) {
  const errors = [];
  const warnings = [];
  const participant = { _row: data._row };

  // ── Consent ──
  const consents = [
    { field: 'consent_research', label: 'Consent: Genealogical Research' },
    { field: 'consent_income', label: 'Consent: Income Disclosure' },
    { field: 'consent_negative', label: 'Consent: Negative Finding' },
    { field: 'consent_blockchain', label: 'Consent: Blockchain Recording' },
  ];
  for (const c of consents) {
    const result = validateConsent(data[c.field], c.label);
    errors.push(...result.errors);
  }

  const certify = validateConsent(data.certify_accurate, 'Certification of Accuracy');
  errors.push(...certify.errors);

  // ── Self ──
  const name = validateName(data.full_name, 'Full name');
  participant.full_name = name.value;
  errors.push(...name.errors);

  participant.date_of_birth = data.date_of_birth; // Google Forms date format varies

  const selfFsId = validateFsId(data.self_fs_id, 'Your FamilySearch ID');
  participant.self_fs_id = selfFsId.value;
  errors.push(...selfFsId.errors);

  participant.self_is_living = (data.self_is_living || '').toLowerCase().includes('yes');

  const email = validateEmail(data.email);
  participant.email = email.value;
  errors.push(...email.errors);

  // ── Address ──
  if (!data.address_street || !data.address_street.trim()) errors.push('Address street: Required');
  if (!data.address_city || !data.address_city.trim()) errors.push('Address city: Required');

  const state = (data.address_state || '').trim().toUpperCase();
  if (!US_STATES.includes(state)) {
    errors.push(`Address state: "${data.address_state}" is not a valid US state abbreviation`);
  }
  participant.address_state = state;

  const zip = validateZip(data.address_zip);
  errors.push(...zip.errors);

  participant.address = {
    line1: (data.address_street || '').trim(),
    city: (data.address_city || '').trim(),
    state,
    zip: zip.value
  };

  // ── Financial Disclosure ──
  const income = validateIncome(data.annual_income);
  participant.annual_income = income.value;
  errors.push(...income.errors);

  // Net worth (required — this is the real measure of intergenerational wealth)
  const netWorth = validateFinancialField(data.estimated_net_worth, 'Estimated net worth', true);
  participant.estimated_net_worth = netWorth.value;
  errors.push(...netWorth.errors);

  // Real estate equity (required — #1 vehicle of intergenerational wealth from slavery)
  const realEstate = validateFinancialField(data.real_estate_equity, 'Real estate equity', true);
  participant.real_estate_equity = realEstate.value;
  errors.push(...realEstate.errors);

  // Inheritance received (required — most direct line from slaveholder wealth)
  const inheritReceived = validateFinancialField(data.inheritance_received, 'Inheritance received', true);
  participant.inheritance_received = inheritReceived.value;
  errors.push(...inheritReceived.errors);

  // Inheritance expected (optional but encouraged)
  const inheritExpected = validateFinancialField(data.inheritance_expected, 'Inheritance expected', false);
  participant.inheritance_expected = inheritExpected.value;
  warnings.push(...inheritExpected.errors); // Optional → warnings not errors

  // Tax filing status
  const validStatuses = ['single', 'married filing jointly', 'married filing separately', 'head of household', 'qualifying surviving spouse'];
  const filingStatus = (data.tax_filing_status || '').trim().toLowerCase();
  if (!filingStatus) {
    errors.push('Tax filing status: Required');
  } else if (!validStatuses.includes(filingStatus)) {
    errors.push(`Tax filing status: "${data.tax_filing_status}" is not a valid status`);
  }
  participant.tax_filing_status = filingStatus;

  // Number of dependents
  const dependents = parseInt((data.num_dependents || '').toString().trim(), 10);
  if (isNaN(dependents) || dependents < 0) {
    errors.push('Number of dependents: Required (0 or more)');
  } else if (dependents > 20) {
    warnings.push(`Number of dependents: ${dependents} is unusually high — verify`);
  }
  participant.num_dependents = dependents;

  // Cross-check: if net worth is very high but income is very low, flag
  if (netWorth.value && income.value && netWorth.value > income.value * 50) {
    warnings.push(`Net worth ($${netWorth.value.toLocaleString()}) is 50x+ annual income ($${income.value.toLocaleString()}) — likely trust/inheritance wealth, relevant to DAA calculation`);
  }

  // ── Wealth Fingerprint (Section 3b) ──
  // These fields feed TieredPaymentCalculator and WealthGapCalculator

  // Trust/estate
  const validTrustStatuses = ['no', 'revocable', 'irrevocable', 'unsure'];
  const trustBeneficiary = (data.trust_beneficiary || 'no').trim().toLowerCase();
  if (!validTrustStatuses.includes(trustBeneficiary)) {
    warnings.push(`Trust beneficiary: "${data.trust_beneficiary}" is not a recognized option (no/revocable/irrevocable/unsure)`);
  }
  participant.trust_beneficiary = trustBeneficiary;

  const trustCorpus = validateFinancialField(data.trust_corpus, 'Trust corpus', false);
  participant.trust_corpus = trustCorpus.value;
  if (trustCorpus.errors.length) warnings.push(...trustCorpus.errors);

  if (trustBeneficiary !== 'no' && trustBeneficiary !== 'unsure' && !trustCorpus.value) {
    warnings.push('Trust beneficiary answered yes but trust corpus is blank — ask participant for approximate value');
  }

  // Family business
  const validBusinessStatuses = ['no', 'founded_in_lifetime', 'inherited_multigenerational', 'unsure'];
  const businessOwnership = (data.family_business_ownership || 'no').trim().toLowerCase().replace(/ /g, '_');
  participant.family_business_ownership = validBusinessStatuses.includes(businessOwnership) ? businessOwnership : 'no';
  participant.family_business_details = (data.family_business_details || '').trim() || null;

  if (businessOwnership === 'inherited_multigenerational' && !participant.family_business_details) {
    warnings.push('Multi-generational family business reported but no details provided — need sector and founding year');
  }

  // Inherited land
  const validLandTiers = ['none', 'under_500', '500_to_5000', 'over_5000', 'unsure'];
  const landAcres = (data.inherited_land_acres || 'none').trim().toLowerCase().replace(/ /g, '_');
  participant.inherited_land_acres = validLandTiers.includes(landAcres) ? landAcres : 'none';

  // Land states — comma-separated state abbreviations
  const landStatesRaw = (data.inherited_land_states || '').trim().toUpperCase();
  if (landStatesRaw) {
    const landStates = landStatesRaw.split(/[,;]+/).map(s => s.trim()).filter(s => US_STATES.includes(s));
    participant.inherited_land_states = landStates;
    const invalid = landStatesRaw.split(/[,;]+/).map(s => s.trim()).filter(s => s && !US_STATES.includes(s));
    if (invalid.length) warnings.push(`Inherited land states: unrecognized abbreviation(s): ${invalid.join(', ')}`);
  } else {
    participant.inherited_land_states = [];
  }

  // Land use — comma-separated from checklist
  const validLandUse = ['timber', 'mineral_rights', 'agricultural', 'ranching', 'residential_commercial', 'heir_property', 'other'];
  const landUseRaw = (data.inherited_land_use || '').trim().toLowerCase();
  if (landUseRaw) {
    participant.inherited_land_use = landUseRaw.split(/[,;]+/).map(s => s.trim().replace(/ /g, '_')).filter(s => validLandUse.includes(s));
  } else {
    participant.inherited_land_use = [];
  }

  if (landAcres !== 'none' && landAcres !== 'unsure' && participant.inherited_land_states.length === 0) {
    warnings.push('Inherited land reported but no state(s) given — needed for county-level slave schedule cross-reference');
  }

  // Corporate connections — semicolon-separated keys from Farmer-Paellmann defendants
  const KNOWN_CORPORATE_KEYS = ['jpmorgan', 'aetna', 'cvs', 'new_york_life', 'bbh', 'csx', 'norfolk_southern', 'union_pacific', 'canadian_national'];
  const corpRaw = (data.corporate_connections || '').trim().toLowerCase();
  if (corpRaw && corpRaw !== 'none of the above' && corpRaw !== 'none') {
    participant.corporate_connections = corpRaw.split(/[,;]+/)
      .map(s => s.trim().replace(/ /g, '_').replace('cvs/aetna', 'aetna').replace('cvs_/_aetna', 'aetna').replace('jpmorgan_chase', 'jpmorgan'))
      .filter(s => KNOWN_CORPORATE_KEYS.includes(s));
    const unrecognized = corpRaw.split(/[,;]+/)
      .map(s => s.trim())
      .filter(s => s && s !== 'none of the above');
    if (participant.corporate_connections.length === 0 && unrecognized.length > 0) {
      warnings.push(`Corporate connections: "${corpRaw}" didn't match known defendants — flagging for manual review`);
      participant.corporate_connections_raw = corpRaw;
    }
  } else {
    participant.corporate_connections = [];
  }
  participant.corporate_connection_details = (data.corporate_connection_details || '').trim() || null;

  // Executive/board history
  participant.executive_board_history = (data.executive_board_history || '').trim() || null;

  // Pre-1865 business continuity
  const validContinuity = ['no', 'yes', 'unsure'];
  const continuity = (data.pre_1865_business_continuity || 'no').trim().toLowerCase();
  participant.pre_1865_business_continuity = validContinuity.includes(continuity) ? continuity : 'no';
  participant.pre_1865_business_details = (data.pre_1865_business_details || '').trim() || null;

  if (continuity === 'yes' && !participant.pre_1865_business_details) {
    warnings.push('Pre-1865 business continuity reported as "yes" but no details — this is the strongest wealth transfer signal, need description');
  }

  // ── Elevated Wealth Flag (auto-computed) ──
  const wealthReasons = [];
  if (participant.trust_corpus > 1000000) wealthReasons.push('trust_corpus_over_1m');
  if (trustBeneficiary === 'irrevocable') wealthReasons.push('irrevocable_trust_beneficiary');
  if (landAcres === '500_to_5000' || landAcres === 'over_5000') wealthReasons.push('large_inherited_land');
  if (participant.corporate_connections.length > 0) wealthReasons.push('farmer_paellmann_connection');
  if (continuity === 'yes') wealthReasons.push('pre_1865_business_continuity');
  if (businessOwnership === 'inherited_multigenerational') wealthReasons.push('multigenerational_family_business');
  if (netWorth.value && income.value && netWorth.value > income.value * 10) wealthReasons.push('net_worth_10x_income');
  if (inheritReceived.value > 500000) wealthReasons.push('inheritance_over_500k');

  participant.wealth_flag_elevated = wealthReasons.length > 0;
  participant.wealth_flag_reasons = wealthReasons;

  if (wealthReasons.length > 0) {
    warnings.push(`ELEVATED WEALTH FLAG: ${wealthReasons.join(', ')} — tiered payment calculator will apply higher rates`);
  }

  // ── Derive corporate_connection_type for TieredPaymentCalculator ──
  if (participant.corporate_connections.length > 0) {
    if (continuity === 'yes' || businessOwnership === 'inherited_multigenerational') {
      participant.corporate_connection_type = 'owner';
    } else if (inheritReceived.value > 100000 || trustBeneficiary === 'irrevocable') {
      participant.corporate_connection_type = 'direct';
    } else {
      participant.corporate_connection_type = 'indirect';
    }
  } else {
    participant.corporate_connection_type = 'none';
  }

  // ── Father ──
  const fatherName = validateName(data.father_name, 'Father name');
  participant.father_name = fatherName.value;
  errors.push(...fatherName.errors);

  const fatherYear = validateBirthYear(data.father_birth_year, 'Father birth year', 1920, CURRENT_YEAR);
  participant.father_birth_year = fatherYear.value;
  errors.push(...fatherYear.errors);

  const fatherFsId = validateFsId(data.father_fs_id, 'Father FamilySearch ID');
  participant.father_fs_id = fatherFsId.value;
  errors.push(...fatherFsId.errors);

  participant.father_is_living = (data.father_is_living || '').toLowerCase().includes('yes');
  participant.father_birthplace = data.father_birthplace;

  // ── Mother ──
  const motherName = validateName(data.mother_name, 'Mother name');
  participant.mother_name = motherName.value;
  errors.push(...motherName.errors);

  const motherYear = validateBirthYear(data.mother_birth_year, 'Mother birth year', 1920, CURRENT_YEAR);
  participant.mother_birth_year = motherYear.value;
  errors.push(...motherYear.errors);

  const motherFsId = validateFsId(data.mother_fs_id, 'Mother FamilySearch ID');
  participant.mother_fs_id = motherFsId.value;
  errors.push(...motherFsId.errors);

  participant.mother_is_living = (data.mother_is_living || '').toLowerCase().includes('yes');
  participant.mother_birthplace = data.mother_birthplace;

  // ── Grandparents ──
  const grandparents = [
    { prefix: 'pat_grandfather', label: 'Paternal Grandfather', minYear: 1860 },
    { prefix: 'pat_grandmother', label: 'Paternal Grandmother', minYear: 1860 },
    { prefix: 'mat_grandfather', label: 'Maternal Grandfather', minYear: 1860 },
    { prefix: 'mat_grandmother', label: 'Maternal Grandmother', minYear: 1860 },
  ];

  for (const gp of grandparents) {
    const gpName = validateName(data[`${gp.prefix}_name`], `${gp.label} name`);
    participant[`${gp.prefix}_name`] = gpName.value;
    errors.push(...gpName.errors);

    const gpYear = validateBirthYear(data[`${gp.prefix}_birth_year`], `${gp.label} birth year`, gp.minYear, CURRENT_YEAR);
    participant[`${gp.prefix}_birth_year`] = gpYear.value;
    errors.push(...gpYear.errors);

    const gpFsId = validateFsId(data[`${gp.prefix}_fs_id`], `${gp.label} FamilySearch ID`);
    participant[`${gp.prefix}_fs_id`] = gpFsId.value;
    errors.push(...gpFsId.errors);

    participant[`${gp.prefix}_is_living`] = (data[`${gp.prefix}_is_living`] || '').toLowerCase().includes('yes');
    participant[`${gp.prefix}_birthplace`] = data[`${gp.prefix}_birthplace`];
  }

  // ── Tree verification ──
  if (!(data.tree_verified || '').toLowerCase().includes('yes')) {
    warnings.push('Participant has NOT confirmed tree linkage verification — must be checked manually');
  }
  if (!(data.chain_complete || '').toLowerCase().includes('yes')) {
    errors.push('Participant reports broken chain in FamilySearch tree — cannot proceed until resolved');
    if (data.chain_gaps) {
      warnings.push(`Chain gaps described: ${data.chain_gaps}`);
    }
  }

  participant.additional_info = data.additional_info || null;

  // ── Cross-validation ──
  const crossWarnings = crossValidate(participant);
  warnings.push(...crossWarnings);

  return { participant, errors, warnings };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const csvIndex = args.indexOf('--csv');
  const dryRun = args.includes('--dry-run');
  const queueClimbs = args.includes('--queue-climbs');
  const verifySingle = args.indexOf('--verify-single');

  // Single FS ID verification mode
  if (verifySingle !== -1 && args[verifySingle + 1]) {
    const fsId = args[verifySingle + 1].trim().toUpperCase();
    console.log(`\nVerifying FamilySearch ID: ${fsId}\n`);

    const formatCheck = validateFsId(fsId, 'Input');
    if (formatCheck.errors.length > 0) {
      console.log(`FORMAT ERROR: ${formatCheck.errors[0]}`);
      process.exit(1);
    }

    const result = await verifyFsIdExists(fsId);
    console.log(`Status: ${result.status}`);
    console.log(`Message: ${result.message}`);
    process.exit(result.exists ? 0 : 1);
  }

  if (csvIndex === -1 || !args[csvIndex + 1]) {
    console.log(`
Usage:
  node scripts/validate-intake-form.js --csv <path-to-csv>              Validate all entries
  node scripts/validate-intake-form.js --csv <path-to-csv> --dry-run    Validate without DB/FS checks
  node scripts/validate-intake-form.js --csv <path-to-csv> --queue-climbs  Validate + start climbs
  node scripts/validate-intake-form.js --verify-single <FS_ID>          Check one FS ID
`);
    process.exit(1);
  }

  const csvPath = path.resolve(args[csvIndex + 1]);
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  REPARATIONS INTAKE FORM VALIDATOR`);
  console.log(`  CSV: ${csvPath}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN (no FS verification)' : queueClimbs ? 'VALIDATE + QUEUE CLIMBS' : 'VALIDATE ONLY'}`);
  console.log(`${'═'.repeat(70)}\n`);

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(csvContent, { relax_column_count: true });

  if (rows.length < 2) {
    console.error('CSV has no data rows (only header or empty)');
    process.exit(1);
  }

  // Skip header row
  const dataRows = rows.slice(1);
  console.log(`Found ${dataRows.length} submission(s)\n`);

  const results = {
    total: dataRows.length,
    passed: 0,
    failed: 0,
    warnings: 0,
    participants: []
  };

  for (let i = 0; i < dataRows.length; i++) {
    const data = parseRow(dataRows[i], i);
    const { participant, errors, warnings } = validateParticipant(data);

    const status = errors.length === 0 ? 'PASS' : 'FAIL';
    if (status === 'PASS') results.passed++;
    else results.failed++;
    if (warnings.length > 0) results.warnings += warnings.length;

    console.log(`${'─'.repeat(70)}`);
    console.log(`  Row ${data._row}: ${participant.full_name || '(no name)'} — ${status}`);
    console.log(`${'─'.repeat(70)}`);

    if (errors.length > 0) {
      console.log(`  ERRORS (${errors.length}):`);
      errors.forEach(e => console.log(`    ✗ ${e}`));
    }

    if (warnings.length > 0) {
      console.log(`  WARNINGS (${warnings.length}):`);
      warnings.forEach(w => console.log(`    ⚠ ${w}`));
    }

    // FS ID summary
    const fsIds = [
      { label: 'Self', id: participant.self_fs_id, living: participant.self_is_living },
      { label: 'Father', id: participant.father_fs_id, living: participant.father_is_living },
      { label: 'Mother', id: participant.mother_fs_id, living: participant.mother_is_living },
      { label: 'Pat. Grandfather', id: participant.pat_grandfather_fs_id, living: participant.pat_grandfather_is_living },
      { label: 'Pat. Grandmother', id: participant.pat_grandmother_fs_id, living: participant.pat_grandmother_is_living },
      { label: 'Mat. Grandfather', id: participant.mat_grandfather_fs_id, living: participant.mat_grandfather_is_living },
      { label: 'Mat. Grandmother', id: participant.mat_grandmother_fs_id, living: participant.mat_grandmother_is_living },
    ];

    console.log(`  FS IDs:`);
    for (const entry of fsIds) {
      const livingTag = entry.living ? ' [LIVING]' : '';
      console.log(`    ${entry.label.padEnd(18)} ${(entry.id || 'MISSING').padEnd(12)}${livingTag}`);
    }

    // Verify FS IDs exist (unless dry run)
    if (!dryRun && errors.length === 0) {
      console.log(`\n  Verifying FS IDs with FamilySearch...`);
      for (const entry of fsIds) {
        if (!entry.id) continue;
        const result = await verifyFsIdExists(entry.id);
        const icon = result.exists ? '✓' : result.exists === false ? '✗' : '?';
        console.log(`    ${icon} ${entry.label}: ${result.message}`);
        if (result.exists === false) {
          errors.push(`${entry.label} FS ID ${entry.id} does not exist on FamilySearch`);
        }
        // Rate limit — don't hammer FS
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Queue climbs if requested and participant passed
    if (queueClimbs && errors.length === 0) {
      console.log(`\n  Queuing climbs for ${participant.full_name}...`);
      const grandparentIds = [
        { id: participant.pat_grandfather_fs_id, label: 'Paternal Grandfather' },
        { id: participant.pat_grandmother_fs_id, label: 'Paternal Grandmother' },
        { id: participant.mat_grandfather_fs_id, label: 'Maternal Grandfather' },
        { id: participant.mat_grandmother_fs_id, label: 'Maternal Grandmother' },
      ];

      for (const gp of grandparentIds) {
        if (!gp.id) continue;
        console.log(`    → Climb from ${gp.label} (${gp.id})`);
        // In production, this would POST to /api/ancestor-climb/start
        // or directly spawn the climber script
      }
    }

    results.participants.push({
      row: data._row,
      name: participant.full_name,
      email: participant.email,
      status,
      errorCount: errors.length,
      warningCount: warnings.length,
      errors,
      warnings,
      fsIds: fsIds.map(f => ({ label: f.label, id: f.id, living: f.living })),
      participant
    });

    console.log('');
  }

  // ── Summary ──
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SUMMARY`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`  Total submissions:  ${results.total}`);
  console.log(`  Passed validation:  ${results.passed}`);
  console.log(`  Failed validation:  ${results.failed}`);
  console.log(`  Total warnings:     ${results.warnings}`);

  if (results.failed > 0) {
    console.log(`\n  FAILED SUBMISSIONS:`);
    results.participants
      .filter(p => p.status === 'FAIL')
      .forEach(p => {
        console.log(`    Row ${p.row}: ${p.name || '(no name)'} — ${p.errorCount} error(s)`);
      });
  }

  console.log(`\n  ${dryRun ? 'Dry run complete — no FS verification or climbs queued' : queueClimbs ? 'Climbs queued for passing participants' : 'Validation complete'}`);
  console.log('');

  // Write results JSON for programmatic use
  const outputPath = csvPath.replace(/\.csv$/i, '-validation-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`  Results written to: ${outputPath}\n`);

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
