/**
 * Insurance Calculator for Slavery-Related Policies
 *
 * Calculates reparations debt for insurance companies that:
 * - Wrote life insurance policies on enslaved persons (Aetna, New York Life/Nautilus, Southern Mutual, AIG)
 * - Insured slave trade vessels (Lloyd's of London)
 * - Covered enslaved persons as property
 *
 * Legal Reference: Farmer-Paellmann v. FleetBoston Financial Corporation
 * SCAC ¶¶: 136-143 (Aetna), 155-162 (New York Life), 173-174 (Lloyd's),
 *          218-219 (Southern Mutual), 221-223 (AIG)
 */

class InsuranceCalculator {
    constructor(config = {}) {
        this.baseYear = config.baseYear || 1850;
        this.currentYear = config.currentYear || new Date().getFullYear();

        // Insurance-specific appreciation rate (higher for financial instruments)
        this.appreciationRate = config.appreciationRate || 0.065; // 6.5% annually

        // Historical average values (from period research)
        this.avgLifePolicyPremium = config.avgLifePolicyPremium || 45;      // $45 annual premium
        this.avgLifePolicyCoverage = config.avgLifePolicyCoverage || 500;   // $500 coverage per enslaved
        this.avgMarinePremiumRate = config.avgMarinePremiumRate || 0.08;    // 8% of cargo value
        this.avgValuePerEnslaved = config.avgValuePerEnslaved || 400;       // $400 market value

        // Damages multiplier for commodifying human lives
        this.humanDignityMultiplier = config.humanDignityMultiplier || 2.0;
    }

    /**
     * Calculate debt from life insurance policies on enslaved persons
     *
     * Used for: Aetna (¶¶ 136-143), New York Life/Nautilus (¶¶ 155-162),
     *           Southern Mutual (¶¶ 218-219), AIG predecessors (¶¶ 221-223)
     *
     * @param {Array} policies - Array of policy records
     * @returns {Object} Calculation results
     */
    calculateLifeInsuranceDebt(policies) {
        let totalPremiums = 0;
        let totalCoverage = 0;
        let enslavedAffected = 0;
        let policyCount = 0;

        for (const policy of policies) {
            const premium = policy.premium_amount || this.avgLifePolicyPremium;
            const coverage = policy.coverage_amount || this.avgLifePolicyCoverage;
            const count = policy.enslaved_count || 1;

            totalPremiums += premium * count;
            totalCoverage += coverage * count;
            enslavedAffected += count;
            policyCount++;
        }

        // Calculate years elapsed from policy year or base year
        const avgPolicyYear = policies.length > 0
            ? Math.round(policies.reduce((sum, p) => sum + (p.instrument_year || this.baseYear), 0) / policies.length)
            : this.baseYear;
        const yearsElapsed = this.currentYear - avgPolicyYear;

        // Compound premiums to present value
        const compoundedPremiums = totalPremiums * Math.pow(1 + this.appreciationRate, yearsElapsed);

        // Add human dignity damages
        const dignityDamages = compoundedPremiums * (this.humanDignityMultiplier - 1);

        const totalDebt = Math.round(compoundedPremiums + dignityDamages);

        return {
            // Historical values
            historicalPremiums: totalPremiums,
            historicalCoverage: totalCoverage,
            avgPolicyYear,

            // Affected persons
            enslavedAffected,
            policyCount,

            // Calculation details
            yearsElapsed,
            appreciationRate: this.appreciationRate,
            compoundedPremiums: Math.round(compoundedPremiums),
            dignityDamages: Math.round(dignityDamages),

            // Final debt
            modernValue: totalDebt,

            // Methodology
            methodology: 'Life insurance premiums compounded at 6.5% annually, plus human dignity damages multiplier',
            calculation: `(${totalPremiums} × (1 + ${this.appreciationRate})^${yearsElapsed}) × ${this.humanDignityMultiplier} = ${totalDebt.toLocaleString()}`,
            debtType: 'insurance_life_policy'
        };
    }

    /**
     * Calculate debt from marine insurance on slave trade vessels
     *
     * Used for: Lloyd's of London (¶¶ 173-174)
     *
     * @param {Array} voyages - Array of insured voyage records
     * @returns {Object} Calculation results
     */
    calculateMarineInsuranceDebt(voyages) {
        let totalPremiums = 0;
        let totalCargoValue = 0;
        let enslavedTransported = 0;
        let voyageCount = 0;

        for (const voyage of voyages) {
            const enslaved = voyage.enslaved_count || 0;
            const cargoValue = voyage.cargo_value || (enslaved * this.avgValuePerEnslaved);
            const premium = voyage.premium_amount || (cargoValue * this.avgMarinePremiumRate);

            totalPremiums += premium;
            totalCargoValue += cargoValue;
            enslavedTransported += enslaved;
            voyageCount++;
        }

        // Calculate years elapsed
        const avgVoyageYear = voyages.length > 0
            ? Math.round(voyages.reduce((sum, v) => sum + (v.voyage_year || this.baseYear), 0) / voyages.length)
            : this.baseYear;
        const yearsElapsed = this.currentYear - avgVoyageYear;

        // Compound premiums
        const compoundedPremiums = totalPremiums * Math.pow(1 + this.appreciationRate, yearsElapsed);

        // Marine insurance enabled the trade - additional culpability factor
        const enablementMultiplier = 3.0; // Higher because it enabled the entire trade
        const totalDebt = Math.round(compoundedPremiums * enablementMultiplier);

        return {
            historicalPremiums: totalPremiums,
            historicalCargoValue: totalCargoValue,
            avgVoyageYear,
            enslavedTransported,
            voyageCount,
            yearsElapsed,
            appreciationRate: this.appreciationRate,
            compoundedPremiums: Math.round(compoundedPremiums),
            enablementMultiplier,
            modernValue: totalDebt,
            methodology: 'Marine insurance premiums on slave vessels compounded at 6.5%, with 3x enablement multiplier for facilitating the trade',
            calculation: `(${totalPremiums} × (1 + ${this.appreciationRate})^${yearsElapsed}) × ${enablementMultiplier} = ${totalDebt.toLocaleString()}`,
            debtType: 'insurance_marine'
        };
    }

    /**
     * Calculate debt for an insurance company using aggregate policy data
     *
     * @param {Object} companyData - Aggregate data about the company's policies
     * @returns {Object} Total debt calculation
     */
    calculateCompanyDebt(companyData) {
        const {
            companyName,
            historicalName,
            policyType,            // 'life' or 'marine'
            estimatedPolicies,
            estimatedEnslaved,
            estimatedPremiums,
            activeYears           // e.g., { start: 1830, end: 1865 }
        } = companyData;

        // Use midpoint of active years for compounding
        const midpointYear = activeYears
            ? Math.round((activeYears.start + activeYears.end) / 2)
            : this.baseYear;
        const yearsElapsed = this.currentYear - midpointYear;

        // Calculate based on available data
        let baseDebt;
        if (estimatedPremiums) {
            baseDebt = estimatedPremiums;
        } else if (estimatedEnslaved && policyType === 'life') {
            baseDebt = estimatedEnslaved * this.avgLifePolicyPremium;
        } else if (estimatedEnslaved && policyType === 'marine') {
            baseDebt = estimatedEnslaved * this.avgValuePerEnslaved * this.avgMarinePremiumRate;
        } else {
            baseDebt = 0;
        }

        // Compound to present value
        const compoundedValue = baseDebt * Math.pow(1 + this.appreciationRate, yearsElapsed);

        // Apply appropriate multiplier
        const multiplier = policyType === 'marine' ? 3.0 : this.humanDignityMultiplier;
        const totalDebt = Math.round(compoundedValue * multiplier);

        return {
            companyName,
            historicalName,
            policyType,
            estimatedPolicies,
            estimatedEnslaved,
            midpointYear,
            yearsElapsed,
            historicalValue: baseDebt,
            compoundedValue: Math.round(compoundedValue),
            multiplier,
            modernValue: totalDebt,
            methodology: `Estimated ${policyType} insurance premiums compounded at ${this.appreciationRate * 100}% annually with ${multiplier}x multiplier`,
            debtType: `insurance_${policyType}_aggregate`
        };
    }

    /**
     * Calculate debt for all Farmer-Paellmann insurance defendants
     *
     * @returns {Array} Calculations for each defendant
     */
    calculateFarmerPaellmannInsurers() {
        const defendants = [
            {
                companyName: 'CVS Health (Aetna successor)',
                historicalName: 'Aetna predecessor-in-interest',
                scacReference: '¶¶ 136-143',
                policyType: 'life',
                estimatedEnslaved: 10000,  // Placeholder - needs research
                activeYears: { start: 1853, end: 1865 }
            },
            {
                companyName: 'New York Life Insurance Company',
                historicalName: 'Nautilus Insurance',
                scacReference: '¶¶ 155-162',
                policyType: 'life',
                estimatedEnslaved: 5000,   // Placeholder - needs research
                activeYears: { start: 1845, end: 1865 }
            },
            {
                companyName: "Lloyd's of London",
                historicalName: "Lloyd's of London",
                scacReference: '¶¶ 173-174',
                policyType: 'marine',
                estimatedEnslaved: 500000, // Trans-Atlantic trade scale
                activeYears: { start: 1688, end: 1807 }
            },
            {
                companyName: 'Southern Mutual Insurance Company',
                historicalName: 'Southern Mutual Insurance',
                scacReference: '¶¶ 218-219',
                policyType: 'life',
                estimatedEnslaved: 3000,   // Placeholder - Louisiana focus
                activeYears: { start: 1848, end: 1865 }
            },
            {
                companyName: 'American International Group (AIG)',
                historicalName: 'AIG predecessors',
                scacReference: '¶¶ 221-223',
                policyType: 'life',
                estimatedEnslaved: 2000,   // Placeholder - needs research
                activeYears: { start: 1850, end: 1865 }
            }
        ];

        return defendants.map(defendant => ({
            ...this.calculateCompanyDebt(defendant),
            scacReference: defendant.scacReference,
            isFarmerPaellmannDefendant: true
        }));
    }

    /**
     * Get total debt for all insurance defendants
     */
    getTotalInsuranceDebt() {
        const calculations = this.calculateFarmerPaellmannInsurers();
        const totalDebt = calculations.reduce((sum, c) => sum + c.modernValue, 0);
        const totalEnslaved = calculations.reduce((sum, c) => sum + (c.estimatedEnslaved || 0), 0);

        return {
            defendants: calculations,
            totalDebt,
            totalEnslaved,
            summary: `${calculations.length} insurance defendants owe ${totalDebt.toLocaleString()} in modern value`
        };
    }
}

module.exports = InsuranceCalculator;
