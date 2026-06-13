/**
 * Internet Archive PII allowlist gate — FAIL CLOSED.
 *
 * The Internet Archive is world-readable (no private mode), retains old versions,
 * and resists deletion. One accidental upload of a living person's PII is
 * effectively irreversible. Therefore this gate is the ONLY path to ia-archive.mjs,
 * and it DENIES BY DEFAULT: a record is archivable only if it affirmatively
 * matches the historical allowlist AND clears every liveness/PII check. Anything
 * unrecognized, ambiguous, or incomplete is denied.
 *
 * ALLOW  — pre-1900 / clearly-historical public source documents (wills, probate,
 *          estate inventories, slave schedules, insurance registries, corporate
 *          disclosures, Freedman's Bank ledgers) and derived nodes for persons who
 *          are unambiguously historical (deceased long enough that they and their
 *          immediate family are not living). This is consonant with the memorial
 *          purpose — Enslaved.org publishes exactly this.
 * DENY   — the participants table and any DAA instrument naming a living obligor;
 *          confirmed living opt-in descendants; the project lead's own personal/
 *          financial/medical material; and ANY record carrying PII fields.
 *
 * The test of liveness: if the person (or their immediate family) could be alive,
 * their data does not go to a permanent world-readable archive.
 */

// Tables/sources that may NEVER be archived (checked first, hard deny).
const DENY_TABLES = new Set([
  'participants', 'participant', 'intake_submissions', 'premiere_intake',
  'confirmed_descendants', 'living_descendants', 'opt_in_descendants',
  'daa_instruments', 'daa', 'reparations_disbursements', 'wealth_fingerprint',
  'users', 'accounts', 'sessions', 'project_lead', 'owner_pii',
]);

// Field names whose presence indicates PII — any one ⇒ hard deny.
const PII_FIELDS = [
  'email', 'e_mail', 'phone', 'telephone', 'ssn', 'social_security',
  'address', 'street', 'zip', 'postal', 'income', 'salary', 'net_worth',
  'networth', 'bank_account', 'account_number', 'routing', 'dob',
  'date_of_birth', 'medical', 'diagnosis', 'password', 'ip_address',
];

// Person types that denote a LIVING subject ⇒ deny.
const LIVING_PERSON_TYPES = new Set([
  'participant', 'descendant', 'living', 'opt_in', 'opt-in', 'applicant',
  'beneficiary_living', 'claimant_living', 'project_lead',
]);

// Source tables that MAY contain archivable historical material (necessary, not
// sufficient — still subject to liveness + PII + doc-type checks).
const ALLOW_TABLES = new Set([
  'person_documents', 'canonical_persons', 'enslaved_individuals',
  'historical_persons', 'will_extractions', 'wealth_transfer_events',
  'slaveholding_relationships', 'reparations_line_items', 'slavevoyages_voyages',
]);

// Historical document types eligible for archival.
const ALLOW_DOC_TYPES = new Set([
  'will', 'probate', 'estate_inventory', 'estate_account', 'guardian_account',
  'slave_schedule', '1860_slave_schedule', '1850_slave_schedule',
  'insurance_registry', 'corporate_disclosure', 'freedmans_bank_ledger',
  'freedmens_bank_ledger', 'bill_of_sale', 'deed', 'census', 'manifest',
  'compensated_emancipation_petition', 'tax_record', 'newspaper',
]);

// A person born after this and not known-deceased could plausibly be alive (or
// have living immediate family whose interests attach). Conservative by design.
const LIVING_BIRTH_CUTOFF = 1910;
// A document dated at/after this is treated as potentially concerning living people.
const HISTORICAL_DOC_CUTOFF = 1925;

function hasPiiField(record) {
  const keys = Object.keys(record || {}).map((k) => k.toLowerCase());
  return PII_FIELDS.find((p) => keys.some((k) => k === p || k.includes(p))) || null;
}

/**
 * @param {object} record - { sourceTable, documentType, documentYear, personType,
 *                            birthYear, deathYear, isLiving, ...otherFields }
 * @returns {{allowed:boolean, reason:string}}  allowed=false unless proven safe.
 */
export function checkArchivable(record) {
  if (!record || typeof record !== 'object') return deny('no record / not an object');
  const table = String(record.sourceTable || '').toLowerCase();

  // 1. hard table denylist
  if (!table) return deny('missing sourceTable (fail closed)');
  if (DENY_TABLES.has(table)) return deny(`denylisted table: ${table}`);

  // 2. any PII field present ⇒ deny
  const pii = hasPiiField(record);
  if (pii) return deny(`PII field present: ${pii}`);

  // 3. explicit living markers ⇒ deny
  if (record.isLiving === true) return deny('record marked isLiving');
  const pType = String(record.personType || '').toLowerCase();
  if (pType && LIVING_PERSON_TYPES.has(pType)) return deny(`living person type: ${pType}`);

  // 4. table must be on the allowlist
  if (!ALLOW_TABLES.has(table)) return deny(`table not on historical allowlist: ${table}`);

  // 5. liveness by dates (conservative; deny on ambiguity)
  const by = num(record.birthYear), dy = num(record.deathYear), docY = num(record.documentYear);
  if (dy != null) {
    // known death year: archivable only if clearly historical
    if (dy >= HISTORICAL_DOC_CUTOFF) return deny(`death year ${dy} too recent`);
  } else if (by != null) {
    // no death year: must be born early enough to be unambiguously deceased
    if (by >= LIVING_BIRTH_CUTOFF) return deny(`birth year ${by} ≥ ${LIVING_BIRTH_CUTOFF}, no death year — could be living`);
  } else if (docY == null) {
    // no death, no birth, no document year — cannot establish historicity
    return deny('no death/birth/document year — cannot establish historicity (fail closed)');
  }

  // 6. if it's a document, the doc type + date must be historical
  if (record.documentType != null) {
    const dt = String(record.documentType).toLowerCase();
    if (!ALLOW_DOC_TYPES.has(dt)) return deny(`document type not allowlisted: ${dt}`);
    if (docY != null && docY >= HISTORICAL_DOC_CUTOFF) return deny(`document year ${docY} too recent`);
  }

  return { allowed: true, reason: `historical ${record.documentType || record.personType || table} — archivable` };
}

/** Throwing wrapper — the upload path calls this so a denial hard-stops. */
export function assertArchivable(record) {
  const r = checkArchivable(record);
  if (!r.allowed) {
    const e = new Error(`IA archival DENIED: ${r.reason}`);
    e.code = 'ARCHIVE_DENIED';
    throw e;
  }
  return r;
}

const deny = (reason) => ({ allowed: false, reason });
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export const _internals = { DENY_TABLES, PII_FIELDS, LIVING_PERSON_TYPES, ALLOW_TABLES, ALLOW_DOC_TYPES, LIVING_BIRTH_CUTOFF, HISTORICAL_DOC_CUTOFF };
