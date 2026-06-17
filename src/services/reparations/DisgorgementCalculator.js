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

class DisgorgementCalculator {
    constructor(database) {
        this.db = database;
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

        // land_transfer_events — consideration_usd is nominal USD at transfer_year.
        // We sum nominal here; the reconciler benchmarks levels, and a future
        // pass can compound transfer_year→present. We surface the year span so
        // that compounding is possible downstream rather than baked in silently.
        const land = await this.db.query(`
            SELECT
                COUNT(*)                              AS n,
                COUNT(consideration_usd)              AS n_valued,
                COALESCE(SUM(consideration_usd), 0)   AS sum_usd,
                MIN(transfer_year)                    AS min_year,
                MAX(transfer_year)                    AS max_year
            FROM land_transfer_events
            WHERE enslaver_person_id = $1
              AND implicates_enslaver = TRUE
        `, [enslaverPersonId]);

        const heirloom = await this.db.query(`
            SELECT
                COUNT(*)                                AS n,
                COUNT(appraised_value_usd)              AS n_valued,
                COALESCE(SUM(appraised_value_usd), 0)   AS sum_usd
            FROM flagrant_heirloom_assets
            WHERE enslaver_person_id = $1
              AND implicates_enslaver = TRUE
        `, [enslaverPersonId]);

        // wealth_transfer_events has no enslaver_person_id column; it links via
        // debtor_entity_id (polymorphic, currently always NULL). Until an
        // explicit resolution table exists we cannot attribute these rows to a
        // canonical enslaver, so the per-lineage contribution is 0. We report
        // the GLOBAL unattributed pool separately as a flag so the gap is visible.
        const wte = await this._unattributedWealthTransferPool();

        const landSum = Number(land.rows[0].sum_usd) || 0;
        const heirloomSum = Number(heirloom.rows[0].sum_usd) || 0;
        const total = landSum + heirloomSum; // wte excluded: unattributable today

        const components = {
            land_transfer: {
                usd: landSum,
                events: Number(land.rows[0].n) || 0,
                valued_events: Number(land.rows[0].n_valued) || 0,
                year_span: land.rows[0].min_year
                    ? [Number(land.rows[0].min_year), Number(land.rows[0].max_year)]
                    : null,
            },
            flagrant_heirloom: {
                usd: heirloomSum,
                assets: Number(heirloom.rows[0].n) || 0,
                valued_assets: Number(heirloom.rows[0].n_valued) || 0,
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
        if (Number(land.rows[0].n) > Number(land.rows[0].n_valued)) {
            flags.push('land_events_missing_consideration');
        }

        // Confidence reflects how much of the component is documentary vs absent.
        // Pure traced dollars → high (0.85); nothing traced → low (0.2) so the
        // reconciler down-weights this predictor for this lineage rather than
        // treating a $0 as a confident zero.
        const confidence = evidence === 'traced' ? 0.85 : 0.2;

        return {
            total_usd: Math.round(total * 100) / 100,
            components,
            evidence,
            confidence,
            flags,
            methodology: 'Disgorgement (unjust enrichment): sum of traced non-chattel '
                + 'transfers + heirloom assets implicating this enslaver. '
                + 'Nominal USD at documented year; not yet compounded to present.',
        };
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
