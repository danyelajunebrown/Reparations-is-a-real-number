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

        // Enslaver's place (for the rate-resolver reference class + Indigenous-provenance lookup).
        const placeRow = await this.db.query(
            `SELECT primary_state, primary_county FROM canonical_persons WHERE id = $1`, [enslaverPersonId]);
        const placeState = placeRow.rows[0]?.primary_state || null;
        const placeCounty = placeRow.rows[0]?.primary_county || null;

        // Link 0 — Indigenous land provenance (migration 125). If the enslaver's land traces to a
        // Native cession, land VALUE is used only as wealth-over-time CONTEXT and is routed to a
        // SEPARATE Native-restitution class — NEVER into the enslaved-descendant's claim. User
        // directive 2026-07-17: DAAs "make NO claim to the land of the Native peoples." A parcel-level
        // link (properties.property_id) would be preferred; county/state is the coarse fallback.
        const indigRow = await this.db.query(
            `SELECT native_nation, successor_nation, origin_instrument, cession_recital, descendant_claimable
               FROM indigenous_land_provenance
              WHERE descendant_claimable = FALSE
                AND ( (county ILIKE $1 AND state ILIKE $2) OR (region_type='state' AND state ILIKE $2) )
              ORDER BY (county IS NOT NULL) DESC LIMIT 1`,
            [placeCounty, placeState]);
        const indigenous = indigRow.rows[0] || null;

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

        // ── LAND NON-CLAIM GUARDRAIL (user directive 2026-07-17) ─────────────────────────────────
        // Land is a VALUATION INSTRUMENT (it measures enslaver wealth over time), NEVER an asset the
        // enslaved-descendant claims. Where the land traces to a Native cession (indigenous_land_
        // provenance), its compounded value is routed to native_land_restitution_usd — owed to the
        // Native nation, restituted SEPARATELY — and is EXCLUDED from descendant_claimable_usd. This
        // is the hard code guardrail that stops the system from monetizing Native land into a
        // descendant's reparations obligation. Any DAA descendant-claim MUST read descendant_claimable_usd.
        const landIsNativeRestitution = !!indigenous;   // land encumbered by an unresolved Native claim
        const nativeLandRestitutionUsd = landIsNativeRestitution ? Math.round(landSum * 100) / 100 : 0;
        // Descendant-claimable disgorgement = heirloom enrichment only when land is Native-restitution.
        // (Heirloom = trusts/stock/art/silver — enslaver enrichment, not Native land.) When there is
        // NO Indigenous provenance on file, land is not yet routed away — but it is FLAGGED for review,
        // never silently claimed (fail toward non-claim: absence of a provenance record is not license).
        const descendantClaimableUsd = landIsNativeRestitution
            ? Math.round(heirloomSum * 100) / 100
            : Math.round(total * 100) / 100;
        if (landSum > 0 && !landIsNativeRestitution) flags.push('land_value_present_without_indigenous_provenance_REVIEW');
        if (landIsNativeRestitution && landSum > 0) flags.push('land_value_routed_to_native_restitution');

        const landClaim = {
            class: landIsNativeRestitution ? 'native_land_restitution' : 'unclassified_land_review',
            claimable_by_descendant: false,                 // land is NEVER descendant-claimable
            owed_to: landIsNativeRestitution ? (indigenous.successor_nation || 'native_nation') : 'unresolved',
            disposition: 'restituted_separately',
            native_nation: indigenous ? indigenous.native_nation : null,
            origin_instrument: indigenous ? indigenous.origin_instrument : null,
            cession_recital: indigenous ? indigenous.cession_recital : null,
            note: 'Land value is wealth-over-time CONTEXT, not a descendant claim. A DAA must sum '
                + 'descendant_claimable_usd, never total_usd.',
        };

        return {
            // total_usd is the WEALTH-CONTEXT total (land + heirloom). It is NOT descendant-claimable
            // when it contains Native land value — use descendant_claimable_usd for any obligation.
            total_usd: Math.round(total * 100) / 100,              // FLOOR (price_index) — wealth context
            descendant_claimable_usd: descendantClaimableUsd,      // the ONLY figure a descendant DAA may claim
            native_land_restitution_usd: nativeLandRestitutionUsd, // owed to the Native nation, settled separately
            contains_native_land_value: landIsNativeRestitution && landSum > 0,
            land_claim: landClaim,
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
                + 'floor WEALTH-CONTEXT figure; land value is routed to native_land_restitution_usd '
                + '(owed to the Native nation, settled SEPARATELY) and EXCLUDED from '
                + 'descendant_claimable_usd — DAAs make no claim to Native land (directive 2026-07-17).',
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
