/**
 * Google Document AI wrapper for the freedmens-bank-ledger-v1 Custom Extractor.
 *
 * Usage:
 *   const processor = new FreedmensBankProcessor();
 *   const result = await processor.extract(imageBuffer, { mimeType: 'image/png' });
 *   // result: { fields: { depositor_name, last_master, plantation, ... },
 *   //           confidence: 0.87,
 *   //           missing_required: ['depositor_name'],
 *   //           raw_entities: [...] }
 *
 * Auth: requires GOOGLE_APPLICATION_CREDENTIALS env var pointing at a
 * service-account JSON with the Document AI API User + Dataset Administrator
 * roles on project GCP_PROJECT_ID.
 *
 * Region: processor is in `us` region; SDK must be configured with
 * apiEndpoint='us-documentai.googleapis.com' — the global endpoint
 * returns PERMISSION_DENIED for region-local processors.
 */

const pkg = require('@google-cloud/documentai');
const { DocumentProcessorServiceClient } = pkg.v1;

const PROCESSOR_LOCATION = process.env.DOCUMENT_AI_LOCATION || 'us';
const DEFAULT_ENDPOINT = `${PROCESSOR_LOCATION}-documentai.googleapis.com`;

// Fields the DAA pipeline treats as required for Freedmens records
const REQUIRED_FIELDS = ['depositor_name'];

// Confidence floor below which we route to parse_failure_queue
const MIN_ENGINE_CONFIDENCE = 0.50;

class FreedmensBankProcessor {
    constructor(options = {}) {
        const projectId = options.projectId || process.env.GCP_PROJECT_ID;
        const processorId = options.processorId || process.env.DOCUMENT_AI_FREEDMENS_PROCESSOR_ID
            || process.env.DOCUMENT_AI_PROCESSOR_ID;
        if (!projectId || !processorId) {
            throw new Error('FreedmensBankProcessor: GCP_PROJECT_ID + DOCUMENT_AI_PROCESSOR_ID must be set');
        }
        this.processorName = `projects/${projectId}/locations/${PROCESSOR_LOCATION}/processors/${processorId}`;
        this.client = new DocumentProcessorServiceClient({
            apiEndpoint: options.endpoint || DEFAULT_ENDPOINT,
        });
    }

    /**
     * Extract fields from a single Freedmens Bank ledger page image.
     *
     * @param {Buffer} imageBuffer
     * @param {object} options
     * @param {string} options.mimeType — 'image/png' or 'image/jpeg'
     * @param {string} [options.processorVersion] — optional specific version
     *   (e.g. 'projects/.../processorVersions/abc123' — a fine-tuned version)
     * @returns {{
     *   fields: Object<string,string>,
     *   confidence: number,
     *   missingRequired: string[],
     *   rawEntities: Array,
     *   fullText: string
     * }}
     */
    async extract(imageBuffer, options = {}) {
        const mimeType = options.mimeType || 'image/png';
        const request = {
            name: options.processorVersion || this.processorName,
            rawDocument: {
                content: imageBuffer.toString('base64'),
                mimeType,
            },
        };

        const [response] = await this.client.processDocument(request);
        const doc = response.document;

        // Flatten entities to fields. The Custom Extractor returns a root
        // entity ("custom_extraction_document_type") with its schema
        // fields as either top-level entities or nested properties,
        // depending on the processor version. Handle both shapes.
        const fields = {};
        let totalConf = 0, fieldCount = 0;

        const collect = entList => {
            for (const ent of entList || []) {
                if (ent.type === 'custom_extraction_document_type') {
                    collect(ent.properties);
                    continue;
                }
                const val = (ent.mentionText || '').replace(/\s+/g, ' ').trim();
                if (!val) continue;
                // If the field already has a value, pick whichever has higher confidence
                if (!fields[ent.type] || (ent.confidence || 0) > (fields[`${ent.type}_conf`] || 0)) {
                    fields[ent.type] = val;
                    fields[`${ent.type}_conf`] = ent.confidence || 0;
                }
                totalConf += ent.confidence || 0;
                fieldCount++;
            }
        };
        collect(doc.entities);

        // Strip the _conf sibling keys out of the final object (keep them
        // separately for any calling code that wants per-field confidence)
        const perFieldConf = {};
        const cleanFields = {};
        for (const [k, v] of Object.entries(fields)) {
            if (k.endsWith('_conf')) perFieldConf[k.replace(/_conf$/, '')] = v;
            else cleanFields[k] = v;
        }

        const confidence = fieldCount ? (totalConf / fieldCount) : 0;
        const missingRequired = REQUIRED_FIELDS.filter(f => !cleanFields[f]);

        return {
            fields: cleanFields,
            perFieldConf,
            confidence,
            missingRequired,
            rawEntities: doc.entities,
            fullText: doc.text,
            isClean: confidence >= MIN_ENGINE_CONFIDENCE && missingRequired.length === 0,
        };
    }

    /**
     * Process + hand off to parse_failure_queue if the result is sub-threshold.
     *
     * @param {Buffer} imageBuffer
     * @param {object} context — metadata for failure queueing
     * @param {string} context.sourceIdentifier — human-readable, e.g.
     *   'charleston-r21/acct-102.png'
     * @param {string} [context.s3Key]
     * @param {string} [context.sourceUrl]
     * @param {object} [options]
     * @param {pg.Pool} [options.db] — to insert failure row
     * @returns {Promise<{result, queued: boolean, failureId?: string}>}
     */
    async extractWithQueueing(imageBuffer, context, options = {}) {
        const mimeType = options.mimeType || 'image/png';
        let result;
        let engineError = null;
        try {
            result = await this.extract(imageBuffer, { mimeType });
        } catch (e) {
            engineError = e;
        }

        const db = options.db;
        const shouldQueue = engineError || !result.isClean;
        let failureId = null;

        if (shouldQueue && db) {
            const failureReason = engineError
                ? 'parse_exception'
                : result.missingRequired.length
                    ? 'required_fields_empty'
                    : 'sub_threshold_confidence';
            const insert = await db.query(`
                INSERT INTO parse_failure_queue (
                    document_type, source_identifier, s3_key, source_url,
                    engine_attempted, engine_processor_id, engine_confidence,
                    extracted_fields,
                    failure_reason, required_fields_missing, error_message
                ) VALUES (
                    'freedmens_bank_ledger_page', $1, $2, $3,
                    'document_ai_custom_extractor', $4, $5,
                    $6::jsonb,
                    $7, $8::text[], $9
                )
                RETURNING failure_id
            `, [
                context.sourceIdentifier,
                context.s3Key || null,
                context.sourceUrl || null,
                this.processorName,
                result?.confidence || null,
                JSON.stringify(result?.fields || {}),
                failureReason,
                result?.missingRequired || [],
                engineError?.message || null,
            ]);
            failureId = insert.rows[0].failure_id;
        }

        return {
            result,
            queued: !!failureId,
            failureId,
            engineError,
        };
    }
}

module.exports = FreedmensBankProcessor;
module.exports.REQUIRED_FIELDS = REQUIRED_FIELDS;
module.exports.MIN_ENGINE_CONFIDENCE = MIN_ENGINE_CONFIDENCE;
