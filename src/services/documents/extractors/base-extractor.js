/**
 * Base extractor interface for the document-ingestion pipeline.
 *
 * Per memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md §3.3 +
 * the broader rescope discussed 2026-04-29 (record_books / letters / runaway
 * ads / not just wills).
 *
 * Every concrete extractor (will, newspaper_runaway_ad, estate_inventory,
 * bill_of_sale, custody_event_register, multi_entry_parish_roll, ...)
 * implements this interface and returns the same uniform StructuredExtraction
 * shape so the class-agnostic DocumentFanout can route entities to downstream
 * tables without per-class plumbing.
 *
 * Concrete extractors are registered via extractors/index.js and invoked by
 * the DocumentPipeline based on BlockClassifier output.
 */

class BaseExtractor {
    /**
     * @returns {string} Stable document_class identifier (e.g.
     * 'newspaper_runaway_ad', 'will', 'bill_of_sale'). Drives extractor
     * registry lookup AND populates evidence_source_table in compendium rows.
     */
    static get documentClass() {
        throw new Error('subclass must override documentClass');
    }

    /**
     * Run extraction on a single block (which may be a whole single-document
     * file like a will, OR a single ad within a newspaper page, OR one entry
     * in a register). The block has already been segmented + classified by
     * earlier pipeline stages.
     *
     * @param {object} input
     * @param {string} input.blockText - OCR text of just this block
     * @param {object} [input.blockCoordinates] - bounding box on the source page (px or relative)
     * @param {object} [input.sourceMetadata] - the block's metadata.json equivalent
     *                                          (loc_id, publication_date, source_url, etc.)
     * @param {object} [input.lineageHints] - optional: canonical_persons names + ancestor_climb_matches
     *                                        names from the participant context, to bias name resolution
     *
     * @returns {Promise<StructuredExtraction>}
     */
    async extract(input) {
        throw new Error('subclass must override extract()');
    }

    /**
     * Optional: classifier confidence helper. Given a block's text, return
     * a score 0..1 indicating how strongly this extractor's class matches
     * the block. Used by the BlockClassifier to disambiguate when multiple
     * extractors might claim the same block.
     *
     * Defaults to 0 (no claim). Concrete extractors override with regex /
     * keyword heuristics.
     *
     * @param {string} blockText
     * @returns {number} confidence 0..1
     */
    static classifyConfidence(blockText) {
        return 0.0;
    }
}

/**
 * StructuredExtraction shape (typed entities + relationships).
 *
 * Returned by every extractor; consumed by the DocumentFanout. The fanout
 * routes each entity to the right downstream table based on its type tag,
 * not on the document class — so adding a new extractor doesn't require
 * fanout changes.
 *
 * @typedef {object} StructuredExtraction
 * @property {string} document_class - matches extractor.documentClass
 * @property {string} extractor_version - semver-ish string for traceability
 * @property {Entity[]} entities - typed entities (persons, places, properties)
 * @property {Relationship[]} relationships - typed edges between entities
 * @property {Event[]} events - typed events (sales, manumissions, escapes, etc.)
 * @property {object} provenance - raw refs back to source: ocr_text, page_image,
 *                                 source_url, document_id, block_coordinates
 * @property {ConfidenceBound[]} confidence_bounds - Eltis-style per-claim bounds
 *                                                   for inferred fields (low, high, methodology_id)
 *
 * @typedef {object} Entity
 * @property {string} type - 'person' | 'place' | 'property' | 'corporate_entity' | 'monetary_amount' | ...
 * @property {string} role - context-specific role: 'testator', 'enslaver', 'enslaved_person',
 *                            'witness', 'beneficiary', 'fugitive', 'subscriber', 'prior_owner', etc.
 * @property {object} attributes - type-specific (name, age, sex, color, occupation, address, ...)
 * @property {object} [resolution] - canonical_person_id / place_id matches with confidence
 *
 * @typedef {object} Relationship
 * @property {string} type - 'enslaved_by' | 'sold_to' | 'inherited_from' | 'witnessed' |
 *                            'married_to' | 'parent_of' | 'leased_to' | ...
 * @property {string|number} fromEntityIdx - index into entities[]
 * @property {string|number} toEntityIdx
 * @property {object} [attributes] - date, place, instrument_type, etc.
 *
 * @typedef {object} Event
 * @property {string} type - 'sale' | 'manumission' | 'escape' | 'death' | 'birth' |
 *                            'inheritance' | 'mortgage' | 'court_filing' | ...
 * @property {string} date_window_start
 * @property {string} date_window_end
 * @property {string} place_text
 * @property {number[]} participantEntityIdxs - which entities[] are involved
 * @property {object} [attributes] - amount, currency_year, instrument_id, ...
 *
 * @typedef {object} ConfidenceBound
 * @property {string} fieldPath - JSONPath-ish: 'entities[2].attributes.age'
 * @property {number} low
 * @property {number} high
 * @property {string} [methodology_id] - M060 row UUID for inferred fields
 */

module.exports = { BaseExtractor };
