/**
 * Wealth Gap Calculator — Darity & Mullen Model
 *
 * Operationalizes the wealth-gap closure model from "From Here to Equality"
 * (2020) for individual DAAs using the SHARE-OF-GAP approach.
 *
 * The total racial wealth gap: ~$7.95 trillion (2016 SCF)
 *   = mean white household wealth (~$900K) - mean Black household wealth (~$140K)
 *   × ~10 million Black households
 *
 * Share-of-gap approach:
 *   Each acknowledger's share = (acknowledger's wealth / total white wealth) × total gap
 *   Adjusted for: number of documented slaveholder ancestors, generation distance,
 *   proportion of living descendants
 *
 * This produces a DIFFERENT number than Craemer (labor-value approach).
 * The DAA should show both and use the higher as the obligation floor.
 *
 * CITATIONS:
 * - Darity & Mullen. "From Here to Equality" (2020), Ch. 12-13
 * - Federal Reserve Survey of Consumer Finances (2016, 2019, 2022)
 * - Darity, Mullen & Slaughter. "The Cumulative Costs of Racism."
 *   Roosevelt Institute (2021)
 *
 * POLICY DECISION (by project lead, Apr 6, 2026):
 *   Share-of-gap approach selected over individual-wealth-advantage.
 *   Financial disclosure data (income, net worth, real estate equity,
 *   inheritance) collected via intake form to compute individual share.
 */

const MACRO = require('./macro-config');

class WealthGapCalculator {
    constructor() {
        // ── Survey of Consumer Finances Constants ────────────────────
        // SINGLE-SOURCED from macro-config (WEALTH_GAP block). These were
        // hardcoded here (983400 / 142500 / 10M / 40M); they now read from the
        // one canonical module so the $8.41T SCF mean-gap operationalization
        // can't drift from the rest of the pipeline. NOTE this is Darity's SCF
        // mean-gap operationalization — DISTINCT from the $14T demographic
        // per-capita one in DARITY (see macro-config header).
        //
        // Source: Federal Reserve Board, "Changes in U.S. Family Finances
        //   from 2016 to 2019," Federal Reserve Bulletin 106(5), Sept 2020.
        const wg = MACRO.WEALTH_GAP;
        const derived = MACRO.deriveWealthGap();

        this.MEAN_WHITE_HOUSEHOLD_WEALTH = wg.mean_white_household_usd.value;
        this.MEAN_BLACK_HOUSEHOLD_WEALTH = wg.mean_black_household_usd.value;
        this.GAP_PER_HOUSEHOLD = derived.gapPerHousehold;          // $840,900
        this.BLACK_HOUSEHOLDS = wg.black_households.value;         // ~10M
        this.TOTAL_GAP = derived.totalGap;                        // ~$8.41T
        this.ESTIMATED_SLAVEHOLDER_DESCENDANTS = wg.estimated_slaveholder_descendants.value;
        this.BASE_SHARE_PER_DESCENDANT = derived.baseSharePerDescendant; // ~$210,250
    }

    /**
     * Calculate an individual acknowledger's share of the wealth gap.
     *
     * @param {Object} params
     * @param {number} params.annualIncome - Gross annual income
     * @param {number} params.netWorth - Estimated net worth (can be negative)
     * @param {number} params.realEstateEquity - Real estate equity
     * @param {number} params.inheritanceReceived - Total inheritance received
     * @param {number} params.inheritanceExpected - Expected future inheritance
     * @param {number} params.numSlaveholderAncestors - Number of documented slaveholder ancestors
     * @param {number} params.numLivingDescendants - Estimated living descendants of those slaveholders
     * @returns {Object} Calculation with breakdown
     */
    calculateIndividualShare(params) {
        const {
            annualIncome = 0,
            netWorth = 0,
            realEstateEquity = 0,
            inheritanceReceived = 0,
            inheritanceExpected = 0,
            numSlaveholderAncestors = 1,
            numLivingDescendants = null
        } = params;

        // ── REWRITE (Jun 2026): the hand-picked multipliers are gone. ──
        // Removed: 0.2-per-ancestor step + 3.0 cap (slaveholderMultiplier),
        //          0.1 floor on the wealth tilt, 20×-income imputation,
        //          and the 0.5 "default to half if no data" — all undisciplined
        //          constants that the build directive flagged.
        //
        // The level now comes from the SCF per-descendant base share (an OBSERVED
        // aggregate ÷ descendant count); individual variation is a MEAN-PRESERVING
        // wealth tilt around that base, and every imputation is FLAGGED rather than
        // silently filled. The absolute level is disciplined to subpopulation
        // sub-aggregates by ObligationReconciler.reconcilePopulation — this method
        // produces the per-descendant estimate + its imputation provenance.

        const imputations = [];

        // Base per-descendant share (TOTAL_GAP ÷ estimated descendants). Already
        // per-capita: it is NOT divided again by a descendant count here. The
        // lineage-level division across living descendants happens in the ledger
        // (estimated_living_descendants), which is where the old descendantShare
        // belonged. Defaulting that to 1.0 here was the 100%-to-everyone bug.
        const baseShare = this.BASE_SHARE_PER_DESCENDANT;

        // Wealth tilt: how this descendant's wealth compares to the mean white
        // household. No arbitrary floor; if wealth is unknown we FLAG the
        // imputation and use a neutral tilt of 1.0 (the subpopulation mean),
        // which is mean-preserving — not the old 0.5 or 20×-income guesses.
        const totalWealth = netWorth + (inheritanceExpected || 0);
        let wealthRatio;
        if (totalWealth > 0) {
            wealthRatio = totalWealth / this.MEAN_WHITE_HOUSEHOLD_WEALTH;
        } else if (annualIncome > 0) {
            // Income-as-wealth is a proxy. We use a capitalization factor but
            // CARRY IT AS A FLAGGED IMPUTATION rather than burying 20× in the math.
            const CAPITALIZATION_FACTOR = 12; // ≈ wealth/income ratio, US median (Fed SCF); flagged
            wealthRatio = (annualIncome * CAPITALIZATION_FACTOR) / this.MEAN_WHITE_HOUSEHOLD_WEALTH;
            imputations.push({ field: 'wealthRatio', basis: `income × ${CAPITALIZATION_FACTOR} capitalization proxy`, confidence: 0.4 });
        } else {
            wealthRatio = 1.0; // neutral, mean-preserving
            imputations.push({ field: 'wealthRatio', basis: 'no wealth or income data — neutral tilt (1.0)', confidence: 0.15 });
        }

        const wealthAdjustedShare = baseShare * wealthRatio;

        // Inheritance tilt: documented inheritance from the slaveholder line is the
        // most traceable transfer. Bounded additive tilt (an inheritance equal to
        // mean white wealth at most doubles the share). Documented, not magic.
        const inheritanceFactor = inheritanceReceived > 0
            ? 1.0 + Math.min(1.0, inheritanceReceived / this.MEAN_WHITE_HOUSEHOLD_WEALTH)
            : 1.0;

        // descendantShare: only applied if a real living-descendant count is given.
        // Unknown → NOT divided (no 1.0 "full share" default); the lineage ledger
        // owns the division. Flagged so callers know the level is per-descendant.
        let descendantShare = 1.0;
        if (numLivingDescendants && numLivingDescendants > 0) {
            descendantShare = 1.0 / numLivingDescendants;
        } else {
            imputations.push({ field: 'descendantShare', basis: 'living-descendant count unknown — division deferred to lineage ledger (estimated_living_descendants)', confidence: 0.3 });
        }

        const totalObligation = wealthAdjustedShare * inheritanceFactor * descendantShare;

        return {
            // Core result
            totalObligation: Math.round(totalObligation * 100) / 100,

            // Imputation provenance (explicit, never silent)
            imputations,
            isImputed: imputations.length > 0,

            // Breakdown
            baseShare: Math.round(baseShare * 100) / 100,
            wealthRatio: Math.round(wealthRatio * 1000) / 1000,
            wealthAdjustedShare: Math.round(wealthAdjustedShare * 100) / 100,
            descendantShare,
            inheritanceFactor: Math.round(inheritanceFactor * 100) / 100,
            numSlaveholderAncestors,

            // Context
            methodology: 'Darity & Mullen wealth-gap closure (share-of-gap approach; mean-preserving wealth tilt, level disciplined by population benchmarking)',
            citations: {
                model: 'Darity & Mullen, "From Here to Equality" (2020)',
                data: 'Federal Reserve, Survey of Consumer Finances (2019)',
                wealthPersistence: 'Ager, Boustan & Eriksson, AER (2021)'
            },

            // Inputs echoed back
            inputs: {
                annualIncome,
                netWorth,
                realEstateEquity,
                inheritanceReceived,
                numSlaveholderAncestors,
                numLivingDescendants
            },

            // System constants
            constants: {
                meanWhiteWealth: this.MEAN_WHITE_HOUSEHOLD_WEALTH,
                meanBlackWealth: this.MEAN_BLACK_HOUSEHOLD_WEALTH,
                gapPerHousehold: this.GAP_PER_HOUSEHOLD,
                totalGap: this.TOTAL_GAP,
                estimatedDescendants: this.ESTIMATED_SLAVEHOLDER_DESCENDANTS,
                baseSharePerDescendant: this.BASE_SHARE_PER_DESCENDANT
            }
        };
    }

    /**
     * Compare Darity-Mullen result with Craemer result for same person.
     * The DAA should use the HIGHER of the two as the obligation floor.
     */
    compareWithCraemer(dmResult, craemerTotalDebt) {
        const dmTotal = dmResult.totalObligation;
        const higher = Math.max(dmTotal, craemerTotalDebt);
        const methodology = dmTotal >= craemerTotalDebt ? 'darity_mullen' : 'craemer';

        return {
            darityMullen: dmTotal,
            craemer: craemerTotalDebt,
            recommended: higher,
            recommendedMethodology: methodology,
            ratio: craemerTotalDebt > 0 ? Math.round((dmTotal / craemerTotalDebt) * 100) / 100 : null,
            note: methodology === 'darity_mullen'
                ? 'Wealth-gap model produces higher obligation than labor-value model'
                : 'Labor-value model (Craemer) produces higher obligation than wealth-gap model'
        };
    }
}

module.exports = WealthGapCalculator;
