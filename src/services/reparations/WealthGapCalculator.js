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

class WealthGapCalculator {
    constructor() {
        // ── Survey of Consumer Finances Constants ────────────────────
        //
        // 2019 SCF (most recent complete data):
        //   Mean white household wealth: $983,400
        //   Mean Black household wealth: $142,500
        //   Gap per household: $840,900
        //   ~10M Black households → total gap: ~$8.41T
        //
        // 2016 SCF (Darity & Mullen's figure):
        //   Gap per household: $795,000
        //   Total gap: ~$7.95T
        //
        // We use 2019 as it's more current. Darity's per-capita: ~$240K.
        //
        // Source: Federal Reserve Board, "Changes in U.S. Family Finances
        //   from 2016 to 2019," Federal Reserve Bulletin 106(5), Sept 2020.

        this.MEAN_WHITE_HOUSEHOLD_WEALTH = 983400;  // 2019 SCF
        this.MEAN_BLACK_HOUSEHOLD_WEALTH = 142500;  // 2019 SCF
        this.GAP_PER_HOUSEHOLD = this.MEAN_WHITE_HOUSEHOLD_WEALTH - this.MEAN_BLACK_HOUSEHOLD_WEALTH; // $840,900
        this.BLACK_HOUSEHOLDS = 10000000;  // ~10M (Census Bureau)
        this.TOTAL_GAP = this.GAP_PER_HOUSEHOLD * this.BLACK_HOUSEHOLDS; // ~$8.41T

        // Estimated number of living white Americans descended from slaveholders.
        // This is the denominator for share-of-gap.
        // Ager et al. (2021): slaveholder families recovered fully → their descendants
        // disproportionately hold white wealth today.
        //
        // Conservative estimate: ~40M Americans have at least one slaveholder ancestor
        // (based on ~400K slaveholders in 1860 × ~100 descendants each over 6-7 generations)
        // This is rough — needs refinement with actual genealogical data.
        this.ESTIMATED_SLAVEHOLDER_DESCENDANTS = 40000000;

        // Per-descendant share of the total gap
        this.BASE_SHARE_PER_DESCENDANT = this.TOTAL_GAP / this.ESTIMATED_SLAVEHOLDER_DESCENDANTS;
        // ~$210,250 per descendant
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

        // Step 1: Base share (equal division of total gap)
        const baseShare = this.BASE_SHARE_PER_DESCENDANT;

        // Step 2: Wealth-adjusted share
        // If the acknowledger is wealthier than the mean white household,
        // their share should be proportionally larger.
        // If poorer, proportionally smaller.
        const totalWealth = Math.max(0, netWorth + (inheritanceExpected || 0));
        const wealthRatio = totalWealth > 0
            ? totalWealth / this.MEAN_WHITE_HOUSEHOLD_WEALTH
            : annualIncome > 0
                ? (annualIncome * 20) / this.MEAN_WHITE_HOUSEHOLD_WEALTH // Impute wealth as 20x income if no net worth data
                : 0.5; // Default to half if no data at all

        const wealthAdjustedShare = baseShare * Math.max(0.1, wealthRatio); // Floor at 10% of base

        // Step 3: Slaveholder scale adjustment
        // More documented slaveholder ancestors = proportionally more responsibility
        const slaveholderMultiplier = Math.min(3.0, 1.0 + (numSlaveholderAncestors - 1) * 0.2);

        // Step 4: Descendant proportion adjustment
        // If we know there are 1000 living descendants, each carries 1/1000th
        // If unknown, use the population estimate
        const descendantShare = numLivingDescendants
            ? 1.0 / numLivingDescendants
            : 1.0; // Full share if we don't know the descendant count

        // Step 5: Inheritance factor
        // Direct inheritance from slaveholder line is the most traceable wealth transfer
        const inheritanceFactor = inheritanceReceived > 0
            ? 1.0 + Math.min(1.0, inheritanceReceived / this.MEAN_WHITE_HOUSEHOLD_WEALTH)
            : 1.0;

        // Final calculation
        const totalObligation = wealthAdjustedShare * slaveholderMultiplier * descendantShare * inheritanceFactor;

        return {
            // Core result
            totalObligation: Math.round(totalObligation * 100) / 100,

            // Breakdown
            baseShare: Math.round(baseShare * 100) / 100,
            wealthRatio: Math.round(wealthRatio * 1000) / 1000,
            wealthAdjustedShare: Math.round(wealthAdjustedShare * 100) / 100,
            slaveholderMultiplier: Math.round(slaveholderMultiplier * 100) / 100,
            descendantShare,
            inheritanceFactor: Math.round(inheritanceFactor * 100) / 100,

            // Context
            methodology: 'Darity & Mullen wealth-gap closure (share-of-gap approach)',
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
