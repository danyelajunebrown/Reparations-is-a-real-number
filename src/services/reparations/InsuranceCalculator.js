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
        // ═══════════════════════════════════════════════════════════════
        // DATA SOURCES — All figures from primary source disclosures
        //
        // Insurance: CA Dept of Insurance, Slavery Era Insurance Registry
        //   Report to the CA Legislature (May 2002), SB 2199
        //   URL: https://www.insurance.ca.gov/01-consumers/150-other-prog/10-seir/upload/Slavery-Report.pdf
        //
        // Lloyd's: Lloyd's own acknowledgment + White & Seth, "Underwriting
        //   Souls" / The Conversation (2020) — 41% marine market share,
        //   75-90% dominant share; Lloyd's 1771 Founders research page
        // ═══════════════════════════════════════════════════════════════
        const defendants = [
            {
                companyName: 'CVS Health (Aetna successor)',
                historicalName: 'Aetna predecessor-in-interest',
                scacReference: '¶¶ 136-143',
                policyType: 'life',
                // CA DOI Report pp. 5-6: 7 policies, 16 enslaved names (minimum — ledger book submitted later)
                // Caveat: Large amount of records destroyed in 1994 per Aetna's own disclosure
                documentedPolicies: 7,
                documentedEnslavedNames: 16,
                estimatedEnslaved: null, // Actual count unknown — 7 policies covered "multiple lives"
                dataQuality: 'PRIMARY_SOURCE',
                citation: 'CA DOI Slavery Era Insurance Registry Report (May 2002), pp. 5-6',
                activeYears: { start: 1853, end: 1865 }
            },
            {
                companyName: 'New York Life Insurance Company',
                historicalName: 'Nautilus Insurance',
                scacReference: '¶¶ 155-162',
                policyType: 'life',
                // CA DOI Report pp. 7-8: 339 of first 1,000 policies on enslaved lives
                // 484 enslaved names, 233 slaveholder names submitted
                // Policies usually <$500, term of 1 year. 3 death claims totaling $1,050
                documentedPolicies: 339,
                documentedEnslavedNames: 484,
                documentedSlaveholderNames: 233,
                estimatedEnslaved: 484, // Directly documented
                dataQuality: 'PRIMARY_SOURCE',
                citation: 'CA DOI Slavery Era Insurance Registry Report (May 2002), pp. 7-8',
                activeYears: { start: 1845, end: 1848 } // Trustees voted to end sales in 1848
            },
            {
                companyName: "Lloyd's of London",
                historicalName: "Lloyd's of London",
                scacReference: '¶¶ 173-174',
                policyType: 'marine',
                // Lloyd's own acknowledgment: insured ships transporting est. 3.2M enslaved persons
                // White & Seth: 41% of marine insurance market in 1790s; Lloyd's dominant share 75-90%
                // 9 founding members had slavery ties; 11 subscribers received 1834 compensation
                enslavedTransported: 3200000, // Lloyd's own figure
                marineMarketShare: 0.41, // White & Seth, 1790s
                dominantMarketShare: { low: 0.75, high: 0.90 }, // Lloyd's share within marine
                estimatedEnslaved: null, // Not directly applicable — Lloyd's insured the ships, not individual lives
                dataQuality: 'DOCUMENTED',
                citation: 'Lloyd\'s acknowledgment (Insurance Times); White & Seth via The Conversation (2020); Lloyd\'s 1771 Founders',
                activeYears: { start: 1688, end: 1807 }
            },
            {
                companyName: 'Southern Mutual Insurance Company',
                historicalName: 'Southern Mutual Insurance',
                scacReference: '¶¶ 218-219',
                policyType: 'life',
                // PRIMARY SOURCE: UGA Digital Humanities, "Southern Mutual Slave Insurance, 1851-1855"
                // URL: https://digihum.libs.uga.edu/items/show/42
                // Source: UGA Library, African American Experience in Athens collection
                //
                // Founded 1847 (not 1857 as UGA metadata erroneously states) in Griffin, GA
                // by Rev. John U. Parsons. Relocated to Athens 1848.
                // Five insurance lines: Fire, Marine, Storage, Life, Servant.
                // Servant (slave) policies DISCONTINUED 1855.
                //
                // Policy register subset: policy numbers ~590 through ~1779+
                // 27 pages of register digitized (pages 1-13 + pages 14-27)
                // ~30+ individually named enslaved persons visible in subset
                // Aggregate insured value ~$23,154 across visible entries
                // Largest single policy: Mrs. Wm. Pope Jr., policy #827,
                //   16 servants, $6,350 — portfolio-scale slaveholding
                //
                // Named enslaved individuals documented: Maria, Rachel, Lucy, Bill,
                //   Peter (2x), William, Elijah, Henry, Clark, Jeff, Alexander,
                //   Andrew, Luke, Lamar, Anthony, Mary, Patsy, Sophia, Priscilla,
                //   Eliza, Vetus, Louisa, Ned, Stoney, Root, Robert
                //
                // NOTE: This is a SUBSET of the full register. Policy numbers
                // range into 1700s suggesting hundreds more policies existed.
                // Full claims records (payouts on death/injury) not yet located.
                //
                // PDFs stored: storage/corporate-disclosures/insurance/southern-mutual-*.pdf
                documentedPoliciesInSubset: 30, // Visible in digitized pages
                documentedEnslavedNames: 26,    // Individually named in visible entries
                policyNumberRange: { low: 590, high: 1779 },
                estimatedTotalPolicies: null,    // Full register not digitized
                estimatedEnslaved: null,         // Cannot extrapolate from subset
                largestPolicy: { policyNumber: 827, enslaver: 'Mrs. Wm. Pope Jr.', enslavedCount: 16, amount: 6350 },
                dataQuality: 'PRIMARY_SOURCE',
                citation: 'UGA Digital Humanities, "Southern Mutual Slave Insurance, 1851-1855," African American Experience in Athens, https://digihum.libs.uga.edu/items/show/42. UGA Library.',
                activeYears: { start: 1847, end: 1855 } // Servant policies discontinued 1855
            },
            {
                companyName: 'American International Group (AIG)',
                historicalName: 'AIG predecessors (US Life Insurance Co. of NY)',
                scacReference: '¶¶ 221-223',
                policyType: 'life',
                // CA DOI Report: 1 confirmed policy ($550 on "Charles") via magazine article
                // Additional names from US Life bound registries — count undisclosed
                // Physical access required: CDI Public Viewing Room, LA or Oakland; UCSB Wyles Mss 97
                documentedPolicies: 1,
                estimatedEnslaved: null, // Bound registry count not publicly available
                dataQuality: 'PARTIAL',
                citation: 'CA DOI Slavery Era Insurance Registry Report (May 2002); bound registries require physical access',
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
