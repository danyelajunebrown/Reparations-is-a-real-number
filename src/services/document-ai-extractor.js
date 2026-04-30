/**
 * Document AI Extractor
 *
 * Calls the deployed `Freedmans_Bank_Deposit_Reader` Custom Extractor on a
 * single ledger image and returns predictions in a shape compatible with
 * the existing spatial-parser output in scripts/extract-freedmens-fields.js
 * (an array of records, each with {acct, headerName, fields}). That lets
 * the rest of the pipeline (depositor matching, DB writeback) consume
 * either OCR pipeline interchangeably behind a USE_DOCUMENT_AI flag.
 *
 * Per-field confidence thresholds are baked in from metrics-2.json (the
 * deployed version's optimalConfidence values) and the precision-regression
 * gates filed as issues #45 (last_mistress) and #46 (husband):
 *   - husband:        DROPPED entirely (issue #46 — 0% precision)
 *   - last_mistress:  require confidence >= 0.89 (issue #45 — 43% precision)
 *   - other fields:   use optimalConfidence from metrics where available,
 *                     else default 0.5
 *
 * Credentials: relies on Application Default Credentials. Set
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 * in .env. The service account needs roles/documentai.apiUser on the
 * project. The existing /Users/danyelica/.gcp/documentai-key.json file
 * likely has this role (used by Document AI training).
 */

const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

const DEFAULT_PROCESSOR_PATH =
    'projects/157967637685/locations/us/processors/30049eebf8debcf4/processorVersions/b249cf11f364e209';

// optimalConfidence values from metrics-2.json (Freedmans_Bank_Deposit_Reader)
// Some fields report optimalConfidence=0 which means accept all predictions;
// we still apply a floor of 0.4 so we don't pick up low-noise predictions
// that the metrics happen to evaluate at confidence 0.
const FIELD_THRESHOLDS = {
    account_number:        0.40,
    age:                   0.78,
    birthplace:            0.40,
    Brothers:              0.97,
    children_names:        0.46,
    complexion:            0.48,
    date_of_entry:         0.40,
    depositor_name:        0.40,
    employer:              0.40,
    father_name:           0.42,
    height:                0.40,
    husband:               9.99, // effectively DROP (issue #46)
    last_master:           0.40,
    last_mistress:         0.89, // issue #45
    marital_status:        0.97,
    mother_name:           0.40,
    nam_of_last_owner_of_depositor: 0.40,
    occupation:            0.40,
    plantation:            0.97,
    Regiment_and_Company:  0.76,
    remarks:               0.95,
    residence:             0.40,
    signature:             0.93,
    Sisters:               0.83,
    siblings_names:        0.58,
    spouse_name:           0.40,
    where_brought_up:      0.40,
    Wife:                  0.40,
};

// Single shared client. The SDK reuses connections.
let _client = null;
function getClient() {
    if (_client) return _client;
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        throw new Error(
            'Document AI requires GOOGLE_APPLICATION_CREDENTIALS to point at a service-account JSON. ' +
            'Set it in .env (likely /Users/danyelica/.gcp/documentai-key.json on Mac Mini). ' +
            'API keys do not authenticate Document AI predict calls.'
        );
    }
    // Custom Extractors are hosted regionally; use the us endpoint.
    _client = new DocumentProcessorServiceClient({ apiEndpoint: 'us-documentai.googleapis.com' });
    return _client;
}

/**
 * Group flat entities into per-record clusters by vertical position.
 *
 * Document AI returns a flat list of entities even when the page contains
 * multiple records (e.g. Baltimore's 4-record-per-page form). Each entity
 * carries a pageAnchor.pageRefs[0].boundingPoly.normalizedVertices that
 * locates it on the page. Records on a numbered form (Charleston Roll 21)
 * stack vertically, so y-coordinate clustering is enough.
 *
 * For pages with one record (numbered form pre-image-324) this returns a
 * single-element array. For multi-record pages it returns one cluster per
 * detected vertical band.
 */
function groupEntitiesByRecord(entities) {
    if (entities.length === 0) return [];
    const withY = entities.map(e => {
        const v = e.pageAnchor?.pageRefs?.[0]?.boundingPoly?.normalizedVertices || [];
        const y = v.length ? v.reduce((a, p) => a + (p.y || 0), 0) / v.length : 0.5;
        return { ...e, _y: y };
    });
    withY.sort((a, b) => a._y - b._y);

    // Cluster: a new cluster when an account_number entity is encountered,
    // OR when the y-gap from the previous entity exceeds a threshold.
    // Numbered forms have one acct per page; unnumbered forms have multiple.
    const Y_GAP_THRESHOLD = 0.12; // normalized 0–1 page coordinates
    const clusters = [];
    let current = [];
    let lastY = -Infinity;
    for (const e of withY) {
        if (e.type === 'account_number' && current.length > 0) {
            clusters.push(current);
            current = [];
        } else if (e._y - lastY > Y_GAP_THRESHOLD && current.length > 0) {
            clusters.push(current);
            current = [];
        }
        current.push(e);
        lastY = e._y;
    }
    if (current.length > 0) clusters.push(current);
    return clusters;
}

/**
 * Convert a cluster of entities into the {acct, headerName, fields} record
 * shape the existing spatial parser produces. Applies per-field confidence
 * thresholds; entities below threshold (or in a dropped field like
 * `husband`) are excluded.
 */
function entitiesToRecord(cluster) {
    const fields = {};
    let acct = null;
    let depositorName = null;

    for (const e of cluster) {
        const threshold = FIELD_THRESHOLDS[e.type] ?? 0.50;
        if ((e.confidence ?? 0) < threshold) continue;

        const value = (e.mentionText || e.normalizedValue?.text || '').trim();
        if (!value) continue;

        if (e.type === 'account_number') {
            const n = parseInt(value.replace(/[^\d]/g, ''), 10);
            if (Number.isFinite(n)) acct = n;
        } else if (e.type === 'depositor_name') {
            depositorName = value;
            fields.depositor_name = value;
        } else {
            // Most fields map 1:1; we track the first prediction per field
            // (the SDK gives one entity per type per record-cluster usually).
            if (!fields[e.type]) fields[e.type] = value;
        }
    }

    return {
        acct,
        headerName: depositorName,
        fields,
        // Mark this record as Document-AI-sourced so downstream matching can
        // distinguish from spatial-parser records and apply different rules
        // (e.g. confidence weighting in MatchVerifier).
        _source: 'document_ai',
        _entity_count: cluster.length,
    };
}

/**
 * Run Document AI inference on an image and return records[] in the same
 * shape that ocrAndParsePage produces in extract-freedmens-fields.js.
 *
 * @param {Buffer} imageBuffer  raw screenshot bytes (PNG or JPEG)
 * @param {object} opts
 * @param {string} opts.processorPath  full resource name; defaults to
 *                                     Freedmans_Bank_Deposit_Reader
 * @param {string} opts.mimeType       defaults to 'image/png'
 * @returns {Promise<{records: Array, raw: object}>}
 */
async function extractFromImage(imageBuffer, opts = {}) {
    const client = getClient();
    const processorPath = opts.processorPath || DEFAULT_PROCESSOR_PATH;
    const mimeType = opts.mimeType || 'image/png';

    const [result] = await client.processDocument({
        name: processorPath,
        rawDocument: {
            content: imageBuffer.toString('base64'),
            mimeType,
        },
    });

    const entities = result.document?.entities || [];
    const clusters = groupEntitiesByRecord(entities);
    const records = clusters.map(entitiesToRecord).filter(r =>
        // Drop empty records: must have at least an acct OR a name OR one
        // useful field. A cluster of all-husband-only entities (which we
        // drop above-threshold) shouldn't produce a phantom record.
        r.acct != null || r.headerName || Object.keys(r.fields).length > 0
    );

    return { records, raw: result.document };
}

module.exports = {
    extractFromImage,
    DEFAULT_PROCESSOR_PATH,
    FIELD_THRESHOLDS,
    // Exported for testing
    _groupEntitiesByRecord: groupEntitiesByRecord,
    _entitiesToRecord: entitiesToRecord,
};
