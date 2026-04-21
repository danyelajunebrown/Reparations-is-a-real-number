// Define the entity schema for the freedmens-bank-ledger-v1 Document AI
// Custom Extractor processor. A generative-AI custom extractor needs at
// least one entity type declared before it can process documents — the
// entity types tell the foundation model what to look for.
//
// This script walks the processor through the 26 named fields of the
// Charleston-Roll-21-style Freedmen's Bank depositor form, plus a
// superset that covers the field variants observed across the 28
// branches (Baltimore, Huntsville, DC Roll 4, etc.). Fields the form
// doesn't include on a given branch will simply come back empty.
//
// Schema design per the form inventory in memory/project_freedmens_form_inventory.md
//
// Usage:
//   node scripts/define-docai-schema-freedmens.mjs         # dry-run — print what would be set
//   node scripts/define-docai-schema-freedmens.mjs --apply # write schema to processor

import 'dotenv/config';
// Dataset + schema mgmt lives on the v1beta3 DocumentServiceClient — the
// stable v1 client only has processor-level operations. Per the Google SDK
// docs, this is the current recommended path for schema definition.
import pkg from '@google-cloud/documentai';
const { DocumentServiceClient } = pkg.v1beta3;

const APPLY = process.argv.includes('--apply');
const client = new DocumentServiceClient({ apiEndpoint: 'us-documentai.googleapis.com' });

const PROCESSOR = `projects/${process.env.GCP_PROJECT_ID}/locations/us/processors/${process.env.DOCUMENT_AI_PROCESSOR_ID}`;

// Each entity type: name, description, occurrence (once vs many), value_type
const ENTITY_TYPES = [
    // ── Account identity ─────────────────────────────────────────────
    { name: 'account_number',        description: 'The depositor account number (e.g. "No. 100")', occurrence: 'OPTIONAL_ONCE' },
    { name: 'date_of_entry',         description: 'Date the depositor opened the account', occurrence: 'OPTIONAL_ONCE' },

    // ── Depositor biographical ───────────────────────────────────────
    { name: 'depositor_name',        description: 'Full name of the depositor (the freedperson)', occurrence: 'REQUIRED_ONCE' },
    { name: 'birthplace',            description: 'Place (state/county/country) where the depositor was born', occurrence: 'OPTIONAL_ONCE' },
    { name: 'where_brought_up',      description: 'Place where the depositor was raised (often distinct from birthplace — indicates post-emancipation migration or sale)', occurrence: 'OPTIONAL_ONCE' },
    { name: 'age',                   description: 'Depositor age at time of account opening', occurrence: 'OPTIONAL_ONCE' },
    { name: 'residence',             description: 'Current residence (city/county/state)', occurrence: 'OPTIONAL_ONCE' },
    { name: 'complexion',            description: 'Complexion / skin color descriptor recorded on the form', occurrence: 'OPTIONAL_ONCE' },
    { name: 'occupation',            description: 'Depositor occupation', occurrence: 'OPTIONAL_ONCE' },
    { name: 'employer',              description: 'Present employer (distinct from former master; on Raleigh form uses this label exclusively)', occurrence: 'OPTIONAL_ONCE' },

    // ── Family ───────────────────────────────────────────────────────
    { name: 'marital_status',        description: 'Married, single, widowed', occurrence: 'OPTIONAL_ONCE' },
    { name: 'spouse_name',           description: 'Name of spouse (wife or husband)', occurrence: 'OPTIONAL_ONCE' },
    { name: 'spouse_residence',      description: 'Residence of spouse if different', occurrence: 'OPTIONAL_ONCE' },
    { name: 'father_name',           description: 'Father of depositor', occurrence: 'OPTIONAL_ONCE' },
    { name: 'mother_name',           description: 'Mother of depositor', occurrence: 'OPTIONAL_ONCE' },
    { name: 'siblings_names',        description: 'Names of brothers and sisters of depositor (comma-separated list)', occurrence: 'OPTIONAL_MULTIPLE' },
    { name: 'children_names',        description: 'Names of depositor children', occurrence: 'OPTIONAL_MULTIPLE' },
    { name: 'family_residences',     description: 'Residences of father, mother, brothers, sisters', occurrence: 'OPTIONAL_ONCE' },
    { name: 'spouse_father',         description: 'Father of spouse', occurrence: 'OPTIONAL_ONCE' },
    { name: 'spouse_mother',         description: 'Mother of spouse', occurrence: 'OPTIONAL_ONCE' },
    { name: 'spouse_siblings',       description: 'Brothers and sisters of spouse', occurrence: 'OPTIONAL_MULTIPLE' },

    // ── Enslavement record (CRITICAL) ─────────────────────────────────
    { name: 'last_master',           description: 'Name of last master of depositor (the enslaver who held this person at emancipation)', occurrence: 'OPTIONAL_ONCE' },
    { name: 'last_mistress',         description: 'Name of last mistress of depositor (female enslaver variant)', occurrence: 'OPTIONAL_ONCE' },
    { name: 'plantation',            description: 'Plantation or master\'s property name where depositor was held', occurrence: 'OPTIONAL_ONCE' },
    { name: 'slave_residence',       description: 'Location (city/county/state) where depositor resided while enslaved', occurrence: 'OPTIONAL_ONCE' },
    { name: 'old_title',             description: 'Name or title the depositor was known by while enslaved (often the only recorded enslaved name — critical for cross-referencing slave schedules)', occurrence: 'OPTIONAL_ONCE' },

    // ── Civil War / post-emancipation ─────────────────────────────────
    { name: 'union_lines',           description: 'Details about crossing Union lines during the war', occurrence: 'OPTIONAL_ONCE' },
    { name: 'post_emancipation',     description: 'Post-emancipation employment or residence facts', occurrence: 'OPTIONAL_ONCE' },

    // ── Signature + metadata ──────────────────────────────────────────
    { name: 'signature',             description: 'Signature / mark of depositor', occurrence: 'OPTIONAL_ONCE' },
    { name: 'further_facts',         description: 'Any further facts written on the form, often including relationships, tribe, or personal history', occurrence: 'OPTIONAL_ONCE' },
    { name: 'remarks',               description: 'Remarks field', occurrence: 'OPTIONAL_ONCE' },
];

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log(`Processor: ${PROCESSOR}`);
console.log(`Entity types to define: ${ENTITY_TYPES.length}\n`);

for (const e of ENTITY_TYPES) console.log(`  ${e.name.padEnd(24)} ${e.occurrence.padEnd(20)} ${e.description.slice(0, 60)}`);

if (!APPLY) {
    console.log('\nDRY-RUN — re-run with --apply to write schema to processor.');
    process.exit(0);
}

// Build schema per GCP API
// Document AI schema management: UpdateDatasetSchema
// The Custom Extractor processor has an associated dataset schema that
// defines its entity types. We need to update that dataset schema.

// Get the dataset
const datasetName = `${PROCESSOR}/dataset`;

// Document AI Custom Extractor schema shape:
//   One root entity type (the document class itself)
//   Properties of that root define the extractable fields
// Each property: name, valueType (string/number/date/etc.), occurrenceType
const documentSchema = {
    displayName: 'freedmens-bank-ledger-schema',
    description: 'Entity schema for Freedmen\'s Bank depositor form extraction across all 28 FS branch variants.',
    entityTypes: [{
        // Google's Custom Extractor requires root entity name to be exactly this
        name: 'custom_extraction_document_type',
        baseTypes: ['document'],
        properties: ENTITY_TYPES.map(e => ({
            name: e.name,
            description: e.description,
            valueType: 'string',
            occurrenceType: e.occurrence,
        })),
    }],
};

console.log('\nWriting schema via updateDatasetSchema…');

try {
    const [updated] = await client.updateDatasetSchema({
        datasetSchema: {
            name: `${datasetName}/datasetSchema`,
            documentSchema,
        },
        updateMask: { paths: ['document_schema'] },
    });
    console.log('✓ Schema updated');
    console.log(`  entity types now on processor: ${updated.documentSchema?.entityTypes?.length || 0}`);
} catch (e) {
    console.log('✗ updateDatasetSchema failed:', e.message.split('\n')[0]);
    // Diagnostic: try to list what the current schema looks like
    try {
        const [cur] = await client.getDatasetSchema({ name: `${datasetName}/datasetSchema` });
        console.log('Current schema:', JSON.stringify(cur.documentSchema?.entityTypes?.map(x => x.name) || []));
    } catch (e2) {
        console.log('also failed to fetch current schema:', e2.message.split('\n')[0]);
    }
}
