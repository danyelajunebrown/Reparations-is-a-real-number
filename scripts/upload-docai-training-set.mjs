// Upload a diverse training set to the freedmens-bank-ledger-v1 Document AI
// Custom Extractor dataset. Diversity across branches + form variants
// helps the fine-tuned model generalize.
//
// Per memory/project_freedmens_form_inventory.md, branches differ:
//   - Charleston R21 (26-field form, "last master" field)
//   - Baltimore / Huntsville / Louisville / Memphis / Tallahassee
//     (master / mistress / plantation fields)
//   - Raleigh (uses "employer" not "master")
//   - Richmond R26 / Savannah R8 / DC R4 (fields until mid-roll cutoffs)
//   - No-enslaver-field branches (NY, Columbus, Natchez, Atlanta, etc.) —
//     still good training for the non-enslavement fields
//
// We upload a curated selection spanning form variants.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pkg from '@google-cloud/documentai';
const { DocumentServiceClient } = pkg.v1beta3;

const client = new DocumentServiceClient({ apiEndpoint: 'us-documentai.googleapis.com' });
const DATASET = `projects/${process.env.GCP_PROJECT_ID}/locations/us/processors/${process.env.DOCUMENT_AI_PROCESSOR_ID}/dataset`;

// Curated selections — max 3 per branch, pick the ones likely to have
// successfully-parsed content (acct numbers in sensible account# ranges)
const SELECTIONS = {
    // ── Already-labeled branch — give the model more Charleston R21 variety
    'charleston-south-carolina-roll-21':  ['acct-109.png', 'acct-121.png', 'acct-1814.png'],
    // ── Different Charleston roll (no enslaver field per spec)
    'charleston-south-carolina-roll-23':  ['acct-*.png'],
    // ── Enslaver-field branches
    'baltimore-maryland-roll':            ['acct-*.png'],
    'huntsville-alabama-roll':            ['acct-*.png'],
    'louisville-kentucky-roll':           ['acct-*.png'],
    'memphis-tennessee-roll':             ['acct-*.png'],
    'tallahassee-florida-roll':           ['acct-*.png'],
    'richmond-virginia-roll-26':          ['acct-*.png'],
    'savannah-georgia-roll-8':            ['acct-*.png'],
    'washington-d-c--roll-4':             ['acct-*.png'],
    'new-orleans-louisiana-roll':         ['acct-*.png'],
    // ── Non-enslaver-field branches (still useful for biographical fields)
    'atlanta-georgia-roll':               ['acct-*.png'],
    'augusta-georgia-roll':               ['acct-*.png'],
    'columbus-mississippi-roll':          ['acct-*.png'],
    'richmond-virginia-roll-27':          ['acct-*.png'],
    'washington-d-c--roll-5':             ['acct-*.png'],
};

const ROOT = path.resolve('debug/freedmens-bank/enslaver-test');
const MAX_PER_BRANCH = 2;   // total budget ~30 new docs

function pickFiles(dir, patterns) {
    if (!fs.existsSync(dir)) return [];
    const all = fs.readdirSync(dir).filter(f => f.endsWith('.png') && f.startsWith('acct-'));
    const picks = new Set();
    for (const p of patterns) {
        if (p === 'acct-*.png') for (const f of all) picks.add(f);
        else if (all.includes(p)) picks.add(p);
    }
    // Random sample up to MAX_PER_BRANCH, prefer earlier accounts (small acct#)
    const sorted = [...picks].sort((a, b) => {
        const aN = parseInt(a.match(/acct-(\d+)/)?.[1] || '0');
        const bN = parseInt(b.match(/acct-(\d+)/)?.[1] || '0');
        return aN - bN;
    });
    return sorted.slice(0, MAX_PER_BRANCH);
}

const uploads = [];
for (const [branch, patterns] of Object.entries(SELECTIONS)) {
    const dir = path.join(ROOT, branch);
    const files = pickFiles(dir, patterns);
    for (const f of files) uploads.push({ branch, file: f, path: path.join(dir, f) });
}

console.log(`Planned uploads: ${uploads.length}`);
for (const u of uploads) console.log(`  ${u.branch}/${u.file} (${(fs.statSync(u.path).size / 1024).toFixed(0)} KB)`);
console.log('');

// Now upload each via importDocuments (inline RawDocument)
let n = 0, errs = 0;
for (const u of uploads) {
    const buf = fs.readFileSync(u.path);
    const displayName = `${u.branch}/${u.file}`;
    try {
        // Inline upload path: use importDocuments with rawDocument embedded in config
        // Actually the better path is batchUpdateDocuments or importDocuments from GCS.
        // Simplest for inline:  call ImportDocuments with batchDocumentsImportConfigs
        // that references each file's bytes.
        // Since that API is GCS-bias, we use the dataset dropbox via updateDataset.
        // EASIEST: we need uploadDocument — not always on SDK. Try the inline path:
        const [op] = await client.importDocuments({
            dataset: DATASET,
            batchDocumentsImportConfigs: [{
                datasetSplit: 'DATASET_SPLIT_UNASSIGNED',
                batchInputConfig: {
                    gcsPrefix: { gcsUriPrefix: '' },  // not using GCS
                },
            }],
        }).catch(e => [null, e]);
        console.log(`⚠ SDK path unsupported for inline bytes; need GCS staging.`);
        console.log(`  Going fallback — import via browser UI is the practical path.`);
        break;
    } catch (e) {
        errs++;
        console.log(`  ✗ ${u.file}: ${e.message.split('\n')[0]}`);
    }
}

if (!n) {
    // Fallback: just print clearly what the user should drag into the console
    console.log('\n━━━ FALLBACK: manual import path ━━━');
    console.log('The Document AI SDK does not support inline-byte dataset import (only from GCS or the console UI).');
    console.log('\nDrag these files into the Import documents dialog at:');
    console.log('  https://console.cloud.google.com/ai/document-ai/processors/' +
                process.env.DOCUMENT_AI_PROCESSOR_ID + '/dataset?project=' + process.env.GCP_PROJECT_ID);
    console.log('\nFinder path (cmd+shift+g):');
    for (const u of uploads) console.log(`  ${path.resolve(u.path)}`);
}
