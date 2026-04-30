/**
 * Extractor registry. Plug-in pattern: adding a new extractor requires only
 * a new file in this directory + one require() line below. The pipeline
 * orchestrator and BlockClassifier discover extractors through this registry.
 */

const { NewspaperRunawayAdExtractor } = require('./newspaper-runaway-ad-extractor');
// Future: add will-extractor, estate-inventory-extractor, bill-of-sale-extractor,
// custody-event-register-extractor, multi-entry-parish-roll-extractor, etc.
// const { WillExtractor } = require('./will-extractor');
// const { EstateInventoryExtractor } = require('./estate-inventory-extractor');
// const { BillOfSaleExtractor } = require('./bill-of-sale-extractor');

const REGISTRY = {
    [NewspaperRunawayAdExtractor.documentClass]: NewspaperRunawayAdExtractor,
};

function getExtractor(documentClass) {
    const cls = REGISTRY[documentClass];
    if (!cls) throw new Error(`no extractor registered for document_class='${documentClass}'`);
    return new cls();
}

function listRegistered() {
    return Object.keys(REGISTRY);
}

/**
 * Pick the best-matching extractor for a block of unclassified text.
 * Each registered extractor's classifyConfidence(text) is queried; the
 * highest scorer wins (subject to a min-confidence threshold).
 *
 * @param {string} blockText
 * @param {number} [minConfidence=0.3]
 * @returns {{documentClass: string, confidence: number, extractor: BaseExtractor}|null}
 */
function classifyBlock(blockText, minConfidence = 0.3) {
    let best = null;
    for (const [cls, ExtractorClass] of Object.entries(REGISTRY)) {
        const conf = ExtractorClass.classifyConfidence ? ExtractorClass.classifyConfidence(blockText) : 0;
        if (conf > (best?.confidence || 0)) {
            best = { documentClass: cls, confidence: conf, extractor: new ExtractorClass() };
        }
    }
    if (!best || best.confidence < minConfidence) return null;
    return best;
}

module.exports = { getExtractor, listRegistered, classifyBlock };
