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

        // OCR text is typically lowercase / mixed; capitalization is unreliable.
        // All regexes below use /i and don't require uppercase initial letters.
        const text = blockText;
        const entities = [];
        const relationships = [];
        const events = [];
        const confidenceBounds = [];

        // ── Enslaved person — name, age, height, sex ──
        const enslavedAttributes = {};
        // Name: "named X [Y]" / "called X [Y]" — allow lowercase OCR
        const nameMatch = text.match(/\b(?:named|called)\s+([a-z]{2,20}(?:\s+[a-z]{2,20})?)/i);
        if (nameMatch) {
            const candidate = nameMatch[1].trim();
            // Filter out false positives: stopwords / function words after "named"
            if (!/^(the|a|an|to|in|at|on|of|for|with|by|him|her|his|hers)\b/i.test(candidate)) {
                enslavedAttributes.name = candidate.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }
        }
        // Age: "aged about NN" / "about NN years" / "NN years of age"
        const ageMatch = text.match(/\b(?:aged\s+about|about|aged|age)\s+(\d{1,2})\s+(?:years|yrs|year)\b/i)
                      || text.match(/\b(\d{1,2})\s+years?\s+(?:of\s+)?age\b/i);
        if (ageMatch) enslavedAttributes.age = parseInt(ageMatch[1], 10);
        // Height
        const heightMatch = text.match(/\b(\d)\s*(?:feet|ft\.?)\s*(\d{1,2})\s*(?:inches|ins?\.?)/i);
        if (heightMatch) enslavedAttributes.height_inches = parseInt(heightMatch[1], 10) * 12 + parseInt(heightMatch[2], 10);
        // Sex
        if (/\b(fellow|man|boy|negro\s+man)\b/i.test(text) && !/\b(wench|woman|girl|female)\b/i.test(text)) {
            enslavedAttributes.sex = 'M';
        } else if (/\b(wench|woman|girl|female)\b/i.test(text)) {
            enslavedAttributes.sex = 'F';
        }
        // Color/complexion
        const colorMatch = text.match(/\b(black|brown|yellow|mulatto|copper|dark|light)\s+(?:complexion|coloured|colour|skin|complected)/i);
        if (colorMatch) enslavedAttributes.complexion = colorMatch[1].toLowerCase();
        // Distinctive marks (limit to 8 trailing words to avoid runaway captures)
        const scarMatch = text.match(/\b(?:scar|mark|brand)(?:\s+(?!ranaway|absconded|reward|the\s+above)\w+){0,8}/i);
        if (scarMatch) enslavedAttributes.distinctive_marks = scarMatch[0];

        if (Object.keys(enslavedAttributes).length > 0) {
            entities.push({
                type: 'person',
                role: 'enslaved_person_fugitive',
                attributes: enslavedAttributes,
            });
        }

        // ── Subscriber (current enslaver) ──
        // The signature line is typically near the end: a name (1-3 words) followed
        // by a place/date. We scan the LAST 100 chars before the trailing "march"/
        // "may"/etc. month-name (the date stamp). The token sequence between
        // "[place]" and "[month]" is usually the subscriber's name.
        const sigPattern = /([a-z]{2,20}(?:\s+[a-z]{1,3}\.?)?\s+[a-z]{2,20})\s+(?:near|residing|of\s+county|of\s+the|of)\s+\w+\s+\w*\s*(?:march|may|june|july|august|september|october|november|december|january|february|april)/i;
        const sigMatch = text.match(sigPattern);
        if (sigMatch) {
            const cand = sigMatch[1].trim();
            if (!/^(the|a|an|to|in|of|for|with|by|will|has|been|that|this)\b/i.test(cand)) {
                entities.push({
                    type: 'person',
                    role: 'subscriber_current_enslaver',
                    attributes: { name: this.#properCase(cand) },
                });
            }
        }

        // ── Prior enslaver if "bought of NAME" / "purchased of NAME" ──
        const priorMatch = text.match(/\b(?:bought|purchased|formerly\s+the\s+property)\s+of\s+(?:mr\.?\s+|mrs\.?\s+)?([a-z]{2,20}(?:\s+[a-z]\.?\s+)?(?:\s+[a-z]{2,20}){0,2})/i);
        if (priorMatch) {
            const cand = priorMatch[1].trim();
            entities.push({
                type: 'person',
                role: 'prior_enslaver',
                attributes: { name: this.#properCase(cand) },
            });
        }

        // ── Bounty amount — both numeric "$N" and spelled-out forms ──
        let bountyAmt = null;
        const numericBounty = text.match(/\$\s*(\d{1,4}(?:,\d{3})?)\s*(?:reward\b|dollars?\b)/i)
                           || text.match(/(?:reward|sum)\s+(?:of\s+)?\$\s*(\d{1,4})/i);
        if (numericBounty) {
            bountyAmt = parseInt(numericBounty[1].replace(/,/g, ''), 10);
        } else {
            // Spelled-out: "fifty dollars", "twenty dollars", "one hundred dollars"
            const spelled = text.match(/\b(ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|one\s+hundred|two\s+hundred|five\s+hundred|one\s+thousand)\s+dollars?\b/i);
            if (spelled) bountyAmt = this.#spelledNumberToInt(spelled[1]);
        }
        if (bountyAmt !== null) {
            entities.push({
                type: 'monetary_amount',
                role: 'fugitive_bounty',
                attributes: { amount_usd: bountyAmt, currency_year: this.#extractYear(sourceMetadata) },
            });
        }

        // ── Place anchor ──
        // Pattern 1: "X County" / "X Parish" — case-insensitive
        const countyMatch = text.match(/\b([a-z]{3,20})\s+(county|parish)\b/i);
        // Pattern 2: well-known city/town names from antebellum US slavery geography
        const KNOWN_PLACES = [
            'alexandria','baltimore','richmond','norfolk','charleston','savannah','mobile',
            'new\\s+orleans','natchez','memphis','st\\.?\\s+louis','louisville','lexington',
            'fairfax','washington','georgetown','annapolis','frederick','montgomery',
            'kentucky','virginia','maryland','tennessee','louisiana','mississippi',
            'alabama','georgia','south\\s+carolina','north\\s+carolina','florida','texas',
        ];
        const placeAlternation = new RegExp(`\\b(${KNOWN_PLACES.join('|')})\\b`, 'i');
        const knownPlaceMatch = text.match(placeAlternation);
        if (countyMatch) {
            entities.push({
                type: 'place',
                role: 'enslaver_residence',
                attributes: { name: this.#properCase(countyMatch[1] + ' ' + countyMatch[2]) },
            });
        } else if (knownPlaceMatch) {
            entities.push({
                type: 'place',
                role: 'enslaver_residence',
                attributes: { name: this.#properCase(knownPlaceMatch[1]) },
            });
        }

        // ── Date of escape ("on the Nth instant" or "Nth of MONTH") ──
        const escapeDateMatch = text.match(/\bon\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|instant)/i);
        let escapeDate = null;
        if (escapeDateMatch) {
            const year = this.#extractYear(sourceMetadata);
            if (year) {
                let monthStr = escapeDateMatch[2];
                if (monthStr.toLowerCase() === 'instant' && sourceMetadata.publication_date) {
                    monthStr = sourceMetadata.publication_date.match(/^\d{4}-(\d{2})/)?.[1] || '01';
                } else {
                    monthStr = this.#monthToNum(monthStr);
                }
                escapeDate = `${year}-${monthStr}-${escapeDateMatch[1].padStart(2, '0')}`;
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

    #properCase(s) {
        return s.split(/\s+/).map(w => {
            if (w.length === 0) return w;
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }).join(' ');
    }

    #spelledNumberToInt(s) {
        const map = {
            ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50,
            sixty: 60, seventy: 70, eighty: 80, ninety: 90,
            hundred: 100, 'one hundred': 100, 'two hundred': 200,
            'five hundred': 500, 'one thousand': 1000,
        };
        return map[s.toLowerCase().replace(/\s+/g, ' ').trim()] || null;
    }
}

module.exports = { NewspaperRunawayAdExtractor };
