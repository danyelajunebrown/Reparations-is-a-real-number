'use strict';

/**
 * rate-resolver.js  (GitHub #83; resolves #65, feeds #79)
 *
 * The compound/discount rate is a REFERENCE-CLASS-INDEXED PARAMETER, not a constant.
 * This resolver is the single seam every compounding path (line items, disgorgement,
 * Craemer) calls to turn a (predictor, asset_class, place, era, year) into a rate —
 * anchored to a documented observation in `anchor_rate_series` when one exists, and
 * otherwise a LABELED PROXY (never a silent constant).
 *
 * WHY THIS SHAPE (research-grounded):
 *   • Craemer (2015/2020): the rate dominates the result ($18.6T @3% → $6.2 quadrillion
 *     @6%, wage-based) and "remains to be determined by negotiation" → a parameter, not a fact.
 *   • Law (prejudgment interest / make-whole): default SIMPLE, but COMPOUND for egregious
 *     wrongs / fiduciary breach; rate = harmed party's opportunity cost OR (disgorgement)
 *     the WRONGDOER's actual rate of return, with the uncertainty burden on the wrongdoer.
 *   • ICHEIC: brought policies forward at country long-term BOND rates (the bond_yield anchor).
 *   • Bahamas-compensation study: inflation-anchor vs investment-anchor differ ~30× — which
 *     anchor FAMILY you pick is the load-bearing choice, so we make it explicit per case.
 *
 * ANCHOR FAMILIES, nested by aggressiveness (the relationships, not a flat list):
 *   price_index < deposit_interest < bond_yield < farmland_appreciation
 *              < realized_return < enterprise_roi
 *   (purchasing-power floor → victim opportunity cost → risk-free → asset-specific
 *    → wrongdoer realized → wrongdoer gain). Each predictor has a NATURAL family:
 *      - disgorgement / unjust enrichment → enterprise_roi or realized_return (wrongdoer's gain)
 *      - Craemer labor-value             → bond_yield or deposit_interest (victim opportunity cost)
 *      - land line items                 → farmland_appreciation (asset-specific)
 *      - conservative floor / unknown    → price_index
 *
 * MULTICALIBRATION ALIGNMENT: the resolver assigns rates per reference class; the
 * calibration layer (benchmarking + consistency + reconcile) then DISCIPLINES the
 * resulting estimates against the macro control totals so anchored rates cannot blow
 * past the envelope (the guardrail on Craemer's rate explosion). referenceClass()
 * emits the (family, asset_class, place, era) key the calibration layer groups on.
 *
 * Today `anchor_rate_series` is empty, so every call returns a labeled proxy. As the
 * anchor-scraping fronts (#84–#89) land rows, resolution sharpens automatically with
 * NO code change. This module commits to NO anchor number — only to the seam.
 */

const MACRO = require('./macro-config');

// Default anchor family per predictor (overridable per call).
const PREDICTOR_FAMILY = {
    disgorgement: 'enterprise_roi',
    unjust_enrichment: 'enterprise_roi',
    craemer: 'bond_yield',
    labor_value: 'bond_yield',
    line_item: 'price_index',
    land: 'farmland_appreciation',
    wealth_gap: null, // wealth-gap is already present-valued; no compounding
};

// Labeled proxies (the swappable placeholders, used ONLY until anchors exist).
// Conservative floor = Craemer's 0.03; line-item legacy = 0.05. Both single-sourced
// from macro-config and flagged low-confidence so they down-weight in calibration.
const PROXY = {
    conservative_floor: { rate: MACRO.RATES.craemerCompound.value, cite: MACRO.RATES.craemerCompound.cite, confidence: 0.2 },
    line_item_legacy:   { rate: MACRO.RATES.lineItemCompound.value, cite: MACRO.RATES.lineItemCompound.cite, confidence: 0.2 },
};

class RateResolver {
    /**
     * @param {object} [db] - optional pg pool/client. Without it, resolver is
     *   proxy-only (no anchor lookup) — useful for synchronous/offline callers.
     */
    constructor(db = null) {
        this.db = db;
    }

    /**
     * Resolve the rate for one case. Async because anchor lookup hits the DB.
     *
     * @param {object} q
     * @param {string} q.predictor   - 'disgorgement'|'craemer'|'line_item'|'land'|...
     * @param {string} [q.assetClass]
     * @param {string} [q.placeState]
     * @param {string} [q.placeRegion]
     * @param {string} [q.era]
     * @param {number} [q.year]       - the base year the value is denominated in
     * @param {string} [q.family]     - override the anchor family
     * @returns {Promise<object>} { rate, compounding, family, basis, provenance, confidence }
     */
    async resolveRate(q = {}) {
        // Preserve an explicit null family (e.g. wealth_gap = no compounding):
        // distinguish "predictor known, family deliberately null" from "unknown".
        const family = q.family !== undefined ? q.family
            : (q.predictor in PREDICTOR_FAMILY ? PREDICTOR_FAMILY[q.predictor] : 'price_index');
        if (family === null) {
            return { rate: 0, compounding: 'compound', family: 'none', basis: 'not_applicable',
                provenance: 'wealth-gap is already present-valued; no compounding', confidence: 1 };
        }

        if (this.db) {
            const anchor = await this._lookupAnchor(family, q);
            if (anchor) {
                return {
                    rate: Number(anchor.annual_rate),
                    compounding: anchor.compounding,
                    family,
                    basis: 'anchored',
                    provenance: {
                        source: anchor.source_name, url: anchor.source_url, citation: anchor.source_citation,
                        anchor_id: anchor.id, match: { asset_class: anchor.asset_class, place_state: anchor.place_state, year_range: [anchor.year_start, anchor.year_end] },
                    },
                    confidence: Number(anchor.confidence) || 0.7,
                };
            }
        }

        // Labeled proxy fallback — flagged, low-confidence, swappable.
        const proxyKey = q.predictor === 'line_item' ? 'line_item_legacy' : 'conservative_floor';
        const px = PROXY[proxyKey];
        return {
            rate: px.rate, compounding: 'compound', family, basis: 'proxy',
            provenance: { proxy: proxyKey, note: 'No anchor_rate_series match — labeled proxy until anchor data lands (GitHub #84-#89).', citation: px.cite },
            confidence: px.confidence,
        };
    }

    // Best-matching anchor: prefer most specific (asset+state+year), widen to wildcards.
    async _lookupAnchor(family, q) {
        const { rows } = await this.db.query(`
            SELECT *,
                   (CASE WHEN asset_class IS NOT NULL THEN 4 ELSE 0 END
                  + CASE WHEN place_state  IS NOT NULL THEN 2 ELSE 0 END
                  + CASE WHEN (year_start IS NOT NULL AND year_end IS NOT NULL) THEN 1 ELSE 0 END) AS specificity
            FROM anchor_rate_series
            WHERE anchor_family = $1
              AND (asset_class IS NULL OR asset_class = $2)
              AND (place_state  IS NULL OR place_state  = $3)
              AND (year_start   IS NULL OR $4::int IS NULL OR $4 BETWEEN year_start AND year_end)
            ORDER BY specificity DESC, confidence DESC NULLS LAST
            LIMIT 1
        `, [family, q.assetClass || null, q.placeState || null, q.year || null]);
        return rows[0] || null;
    }

    /**
     * Bring a nominal amount from fromYear to toYear at a resolved rate.
     * @returns {object} { present_value, factor, years, rate, compounding, basis, confidence, provenance }
     */
    async bringToPresent(amountUsd, fromYear, toYear, q = {}) {
        const r = await this.resolveRate({ ...q, year: fromYear });
        const years = Math.max(0, (toYear || 2026) - fromYear);
        const factor = r.compounding === 'simple' ? (1 + r.rate * years) : Math.pow(1 + r.rate, years);
        return {
            present_value: Math.round(amountUsd * factor * 100) / 100,
            factor, years, rate: r.rate, compounding: r.compounding,
            family: r.family, basis: r.basis, confidence: r.confidence, provenance: r.provenance,
        };
    }

    /** Reference-class key the calibration layer groups on (multicalibration alignment). */
    referenceClass(q = {}) {
        const family = q.family || PREDICTOR_FAMILY[q.predictor] || 'price_index';
        return [family, q.assetClass || '*', q.placeState || q.placeRegion || '*', q.era || '*'].join('|');
    }
}

module.exports = RateResolver;
module.exports.PREDICTOR_FAMILY = PREDICTOR_FAMILY;
module.exports.PROXY = PROXY;
