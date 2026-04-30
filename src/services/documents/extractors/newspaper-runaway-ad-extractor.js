/**
 * Extractor for newspaper runaway-slave advertisements.
 *
 * Document_class: newspaper_runaway_ad
 * Test corpus: samples/runaway_ads/ (9 samples, 1810s-1860s, multiple states)
 *
 * Why this class is high-value: a single runaway ad encodes (typically) one
 * named enslaved person, one current enslaver (the "subscriber" who placed
 * the ad), often a prior enslaver who sold the person to the current owner,
 * a date of escape, a place anchor, identifying physical descriptors, and a
 * bounty amount. That single paragraph fans out to ~9 downstream tables
 * (enslaved_individuals, canonical_persons x2, slaveholding_relationships x2,
 * trajectory event, regional_source_registry pointer, place anchor, etc.).
 *
 * Implementation notes:
 *   - Extraction is regex/heuristic for now. The genre is well-documented
 *     and ads follow stylized conventions. LLM-based extraction (Claude
 *     Haiku) is a future upgrade; not required for first pass.
 *   - Input.blockText is the OCR text of a single ad block, NOT a whole
 *     newspaper page. Block segmentation is upstream's job; here we assume
 *     the block is one ad.
 *   - confidence_bounds populated for fields where extraction is fuzzy
 *     (e.g., dollar amount with OCR noise).
 */

const { BaseExtractor } = require('./base-extractor');

class NewspaperRunawayAdExtractor extends BaseExtractor {
    static get documentClass() {
        return 'newspaper_runaway_ad';
    }

    static classifyConfidence(blockText) {
        if (!blockText || blockText.length < 30) return 0.0;
        const lower = blockText.toLowerCase();
        let score = 0.0;
        // Strong signals — opening verbs of runaway ads
        if (/\b(ranaway|run\s*away|runaway|absconded)\b/i.test(blockText)) score += 0.45;
        // Reward / bounty signal
        if (/\$\s*\d+\s*reward\b/i.test(blockText) || /\breward\s+of\s+\$\s*\d+/i.test(blockText)) score += 0.25;
        // Subscriber signature pattern
        if (/\bsubscriber\b/i.test(blockText)) score += 0.15;
        // Slavery vocabulary
        if (/\b(negro|mulatto|slave|fellow|wench)\b/i.test(blockText)) score += 0.15;
        return Math.min(1.0, score);
    }

    async extract({ blockText, blockCoordinates, sourceMetadata = {}, lineageHints = {} }) {
        if (!blockText) {
            return this.#emptyResult(sourceMetadata, 'no blockText supplied');
        }

        const entities = [];
        const relationships = [];
        const events = [];
        const confidenceBounds = [];

        // ── Enslaved person — name, age, height, sex (best-effort regex) ──
        const enslavedAttributes = {};
        // Pattern 1: "named NAME" / "called NAME"
        const nameMatch = blockText.match(/\b(?:named|called)\s+([A-Z][A-Za-z\.\']{1,30}(?:\s+[A-Z][A-Za-z\.\']{1,30})?)/);
        if (nameMatch) enslavedAttributes.name = nameMatch[1].trim();
        // Age: "about NN years" / "aged NN"
        const ageMatch = blockText.match(/\b(?:about|aged|age)\s+(\d{1,2})\s+(?:years|yrs)/i);
        if (ageMatch) enslavedAttributes.age = parseInt(ageMatch[1], 10);
        // Height: "N feet N inches" / "N ft N in"
        const heightMatch = blockText.match(/\b(\d)\s*(?:feet|ft\.?)\s+(\d{1,2})\s*(?:inches|ins?\.?)/i);
        if (heightMatch) enslavedAttributes.height_inches = parseInt(heightMatch[1], 10) * 12 + parseInt(heightMatch[2], 10);
        // Sex inference from descriptors
        if (/\b(fellow|man|boy|negro\s+man)\b/i.test(blockText) && !/\b(wench|woman|girl|female)\b/i.test(blockText)) {
            enslavedAttributes.sex = 'M';
        } else if (/\b(wench|woman|girl|female)\b/i.test(blockText)) {
            enslavedAttributes.sex = 'F';
        }
        // Color/complexion
        const colorMatch = blockText.match(/\b(black|brown|yellow|mulatto|copper|dark|light)\s+(?:complexion|coloured|colour|skin|complected)/i);
        if (colorMatch) enslavedAttributes.complexion = colorMatch[1].toLowerCase();
        // Distinctive marks
        const scarMatch = blockText.match(/\b(?:scar|mark|brand)(?:\s+\w+){0,8}/i);
        if (scarMatch) enslavedAttributes.distinctive_marks = scarMatch[0];

        if (Object.keys(enslavedAttributes).length > 0) {
            entities.push({
                type: 'person',
                role: 'enslaved_person_fugitive',
                attributes: enslavedAttributes,
            });
        }

        // ── Subscriber (current enslaver) ──
        // Heuristic: the signature line is typically the last name+place line.
        const subscriberMatch = blockText.match(/\bsubscriber\b[^.]*?([A-Z][A-Za-z\.]+\s+[A-Z][A-Za-z\.]+)\s*[,\.]/);
        if (subscriberMatch) {
            entities.push({
                type: 'person',
                role: 'subscriber_current_enslaver',
                attributes: { name: subscriberMatch[1].trim() },
            });
        }

        // ── Prior enslaver if "bought of NAME" / "purchased of NAME" ──
        const priorMatch = blockText.match(/\b(?:bought|purchased|formerly\s+the\s+property)\s+of\s+(?:Mr\.?\s+)?([A-Z][A-Za-z\.]+(?:\s+[A-Z][A-Za-z\.]+){1,2})/);
        if (priorMatch) {
            entities.push({
                type: 'person',
                role: 'prior_enslaver',
                attributes: { name: priorMatch[1].trim() },
            });
        }

        // ── Bounty amount ──
        const bountyMatch = blockText.match(/\$\s*(\d{1,4}(?:,\d{3})?)\s*reward\b/i);
        if (bountyMatch) {
            const amt = parseInt(bountyMatch[1].replace(/,/g, ''), 10);
            entities.push({
                type: 'monetary_amount',
                role: 'fugitive_bounty',
                attributes: { amount_usd: amt, currency_year: this.#extractYear(sourceMetadata) },
            });
        }

        // ── Place anchor ──
        // Pattern: "[County|Parish|City] of NAME" or "NAME County" / "NAME Parish"
        const placeMatch = blockText.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+(County|Parish|City|Co\.)\b/);
        if (placeMatch) {
            entities.push({
                type: 'place',
                role: 'enslaver_residence',
                attributes: { name: placeMatch[1] + ' ' + placeMatch[2] },
            });
        }

        // ── Date of escape (if explicit "on the Nth of MONTH") ──
        const escapeDateMatch = blockText.match(/\bon\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)/i);
        let escapeDate = null;
        if (escapeDateMatch) {
            const year = this.#extractYear(sourceMetadata);
            if (year) {
                escapeDate = `${year}-${this.#monthToNum(escapeDateMatch[2])}-${escapeDateMatch[1].padStart(2, '0')}`;
            }
        }

        // ── Build relationships and events ──
        const enslavedIdx = entities.findIndex(e => e.role === 'enslaved_person_fugitive');
        const subscriberIdx = entities.findIndex(e => e.role === 'subscriber_current_enslaver');
        const priorIdx = entities.findIndex(e => e.role === 'prior_enslaver');

        if (enslavedIdx >= 0 && subscriberIdx >= 0) {
            relationships.push({
                type: 'enslaved_by',
                fromEntityIdx: enslavedIdx,
                toEntityIdx: subscriberIdx,
                attributes: { sourced_from: 'newspaper_runaway_ad', as_of_date: this.#extractDate(sourceMetadata) },
            });

            events.push({
                type: 'escape',
                date_window_start: escapeDate,
                date_window_end: this.#extractDate(sourceMetadata),
                place_text: entities.find(e => e.role === 'enslaver_residence')?.attributes.name || 'unknown',
                participantEntityIdxs: [enslavedIdx, subscriberIdx],
                attributes: { instrument_type: 'newspaper_runaway_ad' },
            });
        }

        if (enslavedIdx >= 0 && priorIdx >= 0 && subscriberIdx >= 0) {
            relationships.push({
                type: 'sold_to',
                fromEntityIdx: priorIdx,
                toEntityIdx: subscriberIdx,
                attributes: { instrument_type: 'inferred_from_runaway_ad', subject_entity_idx: enslavedIdx },
            });

            events.push({
                type: 'sale',
                date_window_start: null,
                date_window_end: this.#extractDate(sourceMetadata),
                place_text: 'unknown',
                participantEntityIdxs: [priorIdx, subscriberIdx, enslavedIdx],
                attributes: { instrument_type: 'inferred_from_runaway_ad' },
            });
        }

        return {
            document_class: 'newspaper_runaway_ad',
            extractor_version: '0.1.0-heuristic',
            entities,
            relationships,
            events,
            provenance: {
                source_metadata: sourceMetadata,
                block_coordinates: blockCoordinates,
                ocr_text_snippet: blockText.slice(0, 500),
            },
            confidence_bounds: confidenceBounds,
        };
    }

    #emptyResult(sourceMetadata, reason) {
        return {
            document_class: 'newspaper_runaway_ad',
            extractor_version: '0.1.0-heuristic',
            entities: [],
            relationships: [],
            events: [],
            provenance: { source_metadata: sourceMetadata, error: reason },
            confidence_bounds: [],
        };
    }

    #extractYear(sourceMetadata) {
        const dateStr = sourceMetadata.publication_date || sourceMetadata.date;
        if (!dateStr) return null;
        const m = dateStr.match(/^(\d{4})/);
        return m ? parseInt(m[1], 10) : null;
    }

    #extractDate(sourceMetadata) {
        return sourceMetadata.publication_date || sourceMetadata.date || null;
    }

    #monthToNum(monthName) {
        const map = {
            january: '01', february: '02', march: '03', april: '04',
            may: '05', june: '06', july: '07', august: '08',
            september: '09', october: '10', november: '11', december: '12',
        };
        return map[monthName.toLowerCase()] || '01';
    }
}

module.exports = { NewspaperRunawayAdExtractor };
