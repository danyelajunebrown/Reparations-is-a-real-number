/**
 * Tiered Payment Calculator
 *
 * Replaces the flat 2% payment percentage with a progressive tiered structure.
 *
 * Tiers:
 *   1. Income brackets (marginal rates, like tax brackets)
 *   2. Slaveholder scale multiplier (more enslaved = higher obligation)
 *   3. Corporate connection adjustment
 *   4. Optional net-worth component
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  WARNING: PLACEHOLDER THRESHOLDS — NOT FINALIZED                ║
 * ║                                                                  ║
 * ║  These rates are structural placeholders. The actual thresholds  ║
 * ║  MUST be set based on:                                           ║
 * ║    - More participant data (need 20+ use cases minimum)          ║
 * ║    - Consultation with Darity & Mullen (contacted Apr 6, 2026)   ║
 * ║    - Legal review by attorney                                    ║
 * ║    - Comparison with Craemer and D&M calculations                ║
 * ║                                                                  ║
 * ║  DO NOT present these rates to participants as final.            ║
 * ║  The system will log a reminder every time this calculator runs. ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Citations:
 * - US progressive tax bracket structure (model, not direct application)
 * - ICHEIC tiered payment categories (EVZ Foundation: €2,560-€7,670)
 * - ICC Trust Fund for Victims: proportional allocation model
 */

class TieredPaymentCalculator {
    constructor() {
        // ══════ PLACEHOLDER FLAG ══════
        this.THRESHOLDS_FINALIZED = false;
        this.THRESHOLDS_LAST_REVIEWED = null;
        // ══════════════════════════════

        // Income brackets — marginal rates (like tax brackets)
        // Each bracket defines: up to this income, pay this rate on the amount in this bracket
        this.INCOME_BRACKETS = [
            { upTo: 30000,   rate: 0.005, label: 'Under $30K' },        // 0.5%
            { upTo: 75000,   rate: 0.01,  label: '$30K-$75K' },         // 1.0%
            { upTo: 150000,  rate: 0.02,  label: '$75K-$150K' },        // 2.0%
            { upTo: 300000,  rate: 0.03,  label: '$150K-$300K' },       // 3.0%
            { upTo: 500000,  rate: 0.04,  label: '$300K-$500K' },       // 4.0%
            { upTo: Infinity, rate: 0.05, label: '$500K+' }             // 5.0%
        ];

        // Slaveholder scale multiplier
        // Based on documented number of enslaved persons held by the matched slaveholder
        this.SLAVEHOLDER_SCALE = [
            { upTo: 5,    multiplier: 1.0, label: 'Small slaveholder (1-5)' },
            { upTo: 20,   multiplier: 1.3, label: 'Medium slaveholder (6-20)' },
            { upTo: 50,   multiplier: 1.6, label: 'Large slaveholder (21-50)' },
            { upTo: 200,  multiplier: 2.0, label: 'Major slaveholder (51-200)' },
            { upTo: Infinity, multiplier: 2.5, label: 'Plantation-scale (200+)' }
        ];

        // Corporate connection adjustment
        // If the acknowledger's current wealth derives from a company with documented slavery ties
        this.CORPORATE_ADJUSTMENT = {
            none: 1.0,
            indirect: 1.2,   // Works for a company with slavery ties
            direct: 1.5,     // Inherited wealth from a company with slavery ties
            owner: 2.0       // Owns/controls a company with documented slavery ties
        };
    }

    /**
     * Calculate tiered annual payment.
     *
     * @param {Object} params
     * @param {number} params.annualIncome - Gross annual income
     * @param {number} params.netWorth - Estimated net worth
     * @param {number} params.enslavedCount - Number of documented enslaved persons held by matched slaveholder(s)
     * @param {string} params.corporateConnection - 'none', 'indirect', 'direct', 'owner'
     * @returns {Object} Payment calculation with tier breakdown
     */
    calculate(params) {
        const {
            annualIncome = 0,
            netWorth = 0,
            enslavedCount = 1,
            corporateConnection = 'none'
        } = params;

        // ══════ REMINDER CHECK ══════
        if (!this.THRESHOLDS_FINALIZED) {
            console.warn('[TieredPaymentCalculator] WARNING: Using PLACEHOLDER thresholds. These have not been finalized. Need: 20+ participant use cases, Darity/Mullen consultation, legal review.');
        }

        // Step 1: Income-based payment (marginal brackets)
        let incomePayment = 0;
        let remaining = annualIncome;
        const bracketBreakdown = [];
        let prevUpTo = 0;

        for (const bracket of this.INCOME_BRACKETS) {
            const taxableInBracket = Math.min(remaining, bracket.upTo - prevUpTo);
            if (taxableInBracket <= 0) break;

            const payment = taxableInBracket * bracket.rate;
            incomePayment += payment;
            bracketBreakdown.push({
                bracket: bracket.label,
                income: taxableInBracket,
                rate: bracket.rate,
                ratePercent: (bracket.rate * 100).toFixed(1) + '%',
                payment: Math.round(payment * 100) / 100
            });

            remaining -= taxableInBracket;
            prevUpTo = bracket.upTo;
        }

        // Step 2: Slaveholder scale multiplier
        const scaleEntry = this.SLAVEHOLDER_SCALE.find(s => enslavedCount <= s.upTo);
        const scaleMultiplier = scaleEntry ? scaleEntry.multiplier : 1.0;
        const scaleLabel = scaleEntry ? scaleEntry.label : 'Unknown';

        // Step 3: Corporate connection adjustment
        const corpMultiplier = this.CORPORATE_ADJUSTMENT[corporateConnection] || 1.0;

        // Step 4: Net worth component (optional — 0.1% of net worth if positive)
        const netWorthComponent = netWorth > 0 ? netWorth * 0.001 : 0; // 0.1% of net worth

        // Final annual payment
        const basePayment = incomePayment;
        const adjustedPayment = basePayment * scaleMultiplier * corpMultiplier;
        const totalAnnualPayment = adjustedPayment + netWorthComponent;

        // Effective rate
        const effectiveRate = annualIncome > 0 ? totalAnnualPayment / annualIncome : 0;

        // Compare with flat 2%
        const flat2Percent = annualIncome * 0.02;

        return {
            annualPayment: Math.round(totalAnnualPayment * 100) / 100,
            monthlyPayment: Math.round((totalAnnualPayment / 12) * 100) / 100,

            // Breakdown
            incomeComponent: Math.round(basePayment * 100) / 100,
            scaleMultiplier,
            scaleLabel,
            corporateMultiplier: corpMultiplier,
            corporateConnection,
            netWorthComponent: Math.round(netWorthComponent * 100) / 100,
            effectiveRate: Math.round(effectiveRate * 10000) / 10000,
            effectiveRatePercent: (effectiveRate * 100).toFixed(2) + '%',

            // Bracket detail
            brackets: bracketBreakdown,

            // Comparison
            flatRate: {
                annualPayment: Math.round(flat2Percent * 100) / 100,
                rate: '2.0%',
                difference: Math.round((totalAnnualPayment - flat2Percent) * 100) / 100,
                note: totalAnnualPayment > flat2Percent
                    ? 'Tiered rate is higher than flat 2%'
                    : 'Tiered rate is lower than flat 2% (progressive benefit for lower incomes)'
            },

            // Status
            thresholdsFinalized: this.THRESHOLDS_FINALIZED,
            warning: this.THRESHOLDS_FINALIZED ? null : 'PLACEHOLDER THRESHOLDS — not finalized. See TieredPaymentCalculator.js header.',

            inputs: { annualIncome, netWorth, enslavedCount, corporateConnection }
        };
    }

    /**
     * Mark thresholds as finalized after review.
     * Call this only after Darity/Mullen consultation + legal review + 20+ use cases.
     */
    finalizeThresholds() {
        this.THRESHOLDS_FINALIZED = true;
        this.THRESHOLDS_LAST_REVIEWED = new Date().toISOString();
        console.log('[TieredPaymentCalculator] Thresholds marked as finalized at ' + this.THRESHOLDS_LAST_REVIEWED);
    }
}

module.exports = TieredPaymentCalculator;
