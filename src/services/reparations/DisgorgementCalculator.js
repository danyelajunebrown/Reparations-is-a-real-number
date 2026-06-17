'use strict';

/**
 * DisgorgementCalculator
 *
 * Sums the TRACED, DOCUMENTED non-chattel enrichment attributable to an enslaver
 * lineage — the third obligation predictor. Before this, the wealth-tracing
 * tables (migrations 038 + 088) only GATED whether a DAA could run (the probate
 * gate reads land_transfer_events); their dollar values were never summed into
 * the obligation. This makes the disgorgement theory a first-class predictor
 * alongside Craemer (labor-value) and the SCF wealth-gap.
 *
 * SOURCES (all keyed to canonical_persons.id via enslaver_person_id where the
 * schema allows):
 *   • land_transfer_events.consideration_usd       — implicates_enslaver = TRUE
 *   • flagrant_heirloom_assets.appraised_value_usd — implicates_enslaver = TRUE
 *   • wealth_transfer_events.non_chattel_assets_value_usd — the Astor-style
 *     mortgage-foreclosure non-chattel enrichment. CAVEAT: this table has NO
 *     resolved canonical linkage yet (debtor_entity_id is NULL on every live
 *     row), so it contributes 0 to any specific lineage today. We still wire
 *     the join so it activates automatically when linkage is populated, and we
 *     FLAG the unattributed pool rather than silently folding it in.
 *
 * MISSING-DATA DISCIPLINE (build directive): disgorgement is near-empty for
 * almost every lineage right now. We do NOT impute it up to look complete.
 * A lineage with no traced enrichment gets disgorgement = 0 with
 * evidence='none', and that flows through as LOW confidence in the reconciler —
 * an explicit, flagged, low-confidence path, never a silent constant.
 */

const RateResolver = require('./rate-resolver');

class DisgorgementCalculator {
    constructor(database, opts = {}) {
        this.db = database;
        // Bring traced enrichment forward to present via the rate-resolver
        // (anchored where a series exists, labeled proxy otherwise). Unjust-
        // enrichment law: COMPOUND for egregious wrongs at the WRONGDOER's rate
        // of return — here the enterprise_roi anchor family. (GitHub #79, #83.)
        this.rateResolver = opts.rateResolver || new RateResolver(database);
        this.presentYear = opts.presentYear || 2026;
    }

    /**
     * Compute the disgorgement component for a single enslaver lineage.
     *
     * @param {number} enslaverPersonId - canonical_persons.id of the enslaver
     * @returns {Promise<Object>} { total_usd, components, evidence, confidence, flags }
     */
    async forEnslaver(enslaverPersonId) {
        if (!enslaverPersonId) {
            return this._empty('no_enslaver_id');
        }

        // Enslaver's place (for the rate-resolver reference class).
        const placeRow = await this.db.query(
            `SELECT primary_state FROM canonical_persons WHERE id = $1`, [enslaverPersonId]);
        const placeState = placeRow.rows[0]?.primary_state || null;

        // land_transfer_events + flagrant_heirloom_assets — fetch valued rows with
        // their year and COMPOUND each to present via the rate-resolver (wrongdoer's
        // rate of return / enterprise_roi anchor). Nominal is also tracked so the
        // compounding is transparent, not baked-in-silently. (#79)
        const landRows = await this.db.query(`
            SELECT consideration_usd AS usd, transfer_year AS year
            FROM land_transfer_events
            WHERE enslaver_person_id = $1 AND implicates_enslaver = TRUE
        `, [enslaverPersonId]);
        const heirloomRows = await this.db.query(`
            SELECT appraised_value_usd AS usd, appraised_year AS year
            FROM flagrant_heirloom_assets
            WHERE enslaver_person_id = $1 AND implicates_enslaver = TRUE
        `, [enslaverPersonId]);

        // Two passes following the anchor lattice (nested by aggressiveness):
        //   FLOOR   = price_index (inflation / real-value preservation) — the
        //             defensible MINIMUM the obligation is floored at. Unbounded
        //             compounding at the aggressive wrongdoer-ROI rate over ~175
        //             years explodes to economically absurd figures (a single
        //             estate → hundreds of billions), so it must NOT be the floor.
        //   CEILING = enterprise_roi (wrongdoer's actual gain) — reported as the
        //             aggressive upper estimate, the top of the disagreement region.
        const landFloor = await this._compoundRows(landRows.rows, 'land', placeState, 'price_index');
        const heirFloor = await this._compoundRows(heirloomRows.rows, 'estate_nonchattel', placeState, 'price_index');
        const landCeil = await this._compoundRows(landRows.rows, 'land', placeState, 'enterprise_roi');
        const heirCeil = await this._compoundRows(heirloomRows.rows, 'estate_nonchattel', placeState, 'enterprise_roi');
        const land = landFloor, heirloom = heirFloor; // floor drives the components/total

        // wealth_transfer_events: still unattributed (debtor_entity_id NULL). See flag.
        const wte = await this._unattributedWealthTransferPool();

        const landSum = land.compounded;
        const heirloomSum = heirloom.compounded;
        const total = landSum + heirloomSum;                 // FLOOR present-value
        const totalCeiling = landCeil.compounded + heirCeil.compounded; // aggressive upper

        const components = {
            land_transfer: {
                usd: Math.round(landSum * 100) / 100,
                usd_nominal: Math.round(land.nominal * 100) / 100,
                events: landRows.rows.length,
                valued_events: land.valued,
                year_span: land.yearSpan,
                rate_basis: land.rateBasis,
            },
            flagrant_heirloom: {
                usd: Math.round(heirloomSum * 100) / 100,
                usd_nominal: Math.round(heirloom.nominal * 100) / 100,
                assets: heirloomRows.rows.length,
                valued_assets: heirloom.valued,
                rate_basis: heirloom.rateBasis,
            },
            wealth_transfer_events: {
                usd: 0,
                attributed: false,
                note: 'Non-chattel foreclosure enrichment exists in wealth_transfer_events '
                    + 'but is unlinked to canonical enslavers (debtor_entity_id NULL). '
                    + 'Contributes 0 until linkage is populated.',
                global_unattributed_pool_usd: wte.sum_usd,
                global_unattributed_events: wte.n_valued,
            },
        };

        const evidence = total > 0 ? 'traced' : 'none';
        const flags = [];
        if (evidence === 'none') flags.push('disgorgement_no_traced_evidence');
        if (wte.sum_usd > 0) flags.push('wealth_transfer_events_unattributed');
        if (landRows.rows.length > land.valued) flags.push('land_events_missing_consideration');
        // Surface whether the compounding used a real anchor or a labeled proxy.
        const rateBases = [...new Set([...land.rateBasisList, ...heirloom.rateBasisList])];
        if (rateBases.includes('proxy')) flags.push('disgorgement_rate_proxied');

        // Confidence reflects how much of the component is documentary vs absent.
        const confidence = evidence === 'traced' ? 0.85 : 0.2;

        return {
            total_usd: Math.round(total * 100) / 100,              // FLOOR (price_index)
            total_ceiling_usd: Math.round(totalCeiling * 100) / 100, // aggressive (enterprise_roi)
            total_nominal_usd: Math.round((land.nominal + heirloom.nominal) * 100) / 100,
            compounding_band: { floor_family: 'price_index', ceiling_family: 'enterprise_roi' },
            components,
            evidence,
            confidence,
            flags,
            rate_basis: rateBases.join(',') || 'none',
            methodology: 'Disgorgement (unjust enrichment): traced non-chattel transfers + '
                + 'heirloom assets implicating this enslaver. Compounded to present via the '
                + 'rate-resolver across the anchor lattice — FLOOR at price_index (real-value '
                + 'preservation), CEILING at enterprise_roi (wrongdoer gain). total_usd is the '
                + 'floor; raw aggressive compounding over ~175yr explodes and is the ceiling only.',
        };
    }

    /**
     * Compound a set of {usd, year} rows to present via the rate-resolver.
     * Rows with null value contribute 0 (descriptive provenance only).
     */
    async _compoundRows(rows, assetClass, placeState, family) {
        let nominal = 0, compounded = 0, valued = 0, minY = null, maxY = null;
        const rateBasisList = [];
        for (const row of rows) {
            const usd = row.usd == null ? null : Number(row.usd);
            const year = row.year == null ? null : Number(row.year);
            if (usd == null || Number.isNaN(usd)) continue;
            valued++;
            nominal += usd;
            if (year != null) { minY = minY == null ? year : Math.min(minY, year); maxY = maxY == null ? year : Math.max(maxY, year); }
            if (year == null) { compounded += usd; rateBasisList.push('no_year'); continue; }
            const pv = await this.rateResolver.bringToPresent(usd, year, this.presentYear,
                { predictor: 'disgorgement', assetClass, placeState, family });
            compounded += pv.present_value;
            rateBasisList.push(pv.basis);
        }
        const rateBasis = rateBasisList.length
            ? (rateBasisList.includes('anchored') ? (rateBasisList.includes('proxy') ? 'mixed' : 'anchored') : 'proxy')
            : 'none';
        return { nominal, compounded, valued, yearSpan: minY != null ? [minY, maxY] : null, rateBasis, rateBasisList };
    }

    async _unattributedWealthTransferPool() {
        try {
            const r = await this.db.query(`
                SELECT
                    COUNT(non_chattel_assets_value_usd)            AS n_valued,
                    COALESCE(SUM(non_chattel_assets_value_usd), 0)  AS sum_usd
                FROM wealth_transfer_events
            `);
            return { n_valued: Number(r.rows[0].n_valued) || 0, sum_usd: Number(r.rows[0].sum_usd) || 0 };
        } catch (e) {
            return { n_valued: 0, sum_usd: 0 };
        }
    }

    _empty(reason) {
        return {
            total_usd: 0,
            components: {},
            evidence: 'none',
            confidence: 0.2,
            flags: [reason],
            methodology: 'Disgorgement: no enslaver id resolved.',
        };
    }
}

module.exports = DisgorgementCalculator;
