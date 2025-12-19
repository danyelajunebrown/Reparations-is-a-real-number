/**
 * Banking Calculator for Slavery-Related Financial Activities
 *
 * Calculates reparations debt for banks and financial institutions that:
 * - Made loans to slave traders (FleetBoston/Providence Bank)
 * - Collected customs duties on slave ships (FleetBoston/Providence Bank)
 * - Loaned to planters, merchants, cotton brokers (Brown Brothers & Co.)
 * - Formed consortiums to insure slavery (JP Morgan predecessors)
 * - Profited as cotton factors/middlemen (Lehman Brothers)
 * - Directly owned plantations and enslaved persons (Brown Brothers Harriman)
 *
 * Legal Reference: Farmer-Paellmann v. FleetBoston Financial Corporation
 * SCAC ¶¶: 125-128 (FleetBoston), 145-152 (Brown Brothers), 168-171 (Lehman), 181-182 (JP Morgan)
 */

class BankingCalculator {
    constructor(config = {}) {
        this.baseYear = config.baseYear || 1850;
        this.currentYear = config.currentYear || new Date().getFullYear();

        // Banking appreciation rate (higher for financial instruments)
        this.appreciationRate = config.appreciationRate || 0.07; // 7% annually

        // Historical interest rates
        this.historicalLoanRate = config.historicalLoanRate || 0.08;      // 8% typical loan rate
        this.cottonFactorCommission = config.cottonFactorCommission || 0.025; // 2.5% commission

        // Value per enslaved person for direct slaveholding calculations
        this.valuePerEnslaved = config.valuePerEnslaved || 75000; // Conservative modern wage theft
    }

    /**
     * Calculate debt from loans to slave traders
     *
     * Used for: FleetBoston/Providence Bank (¶¶ 125-128)
     *
     * @param {Array} loans - Array of loan records
     * @returns {Object} Calculation results
     */
    calculateSlaveTraderLoans(loans) {
        let totalPrincipal = 0;
        let totalInterestEarned = 0;
        let loanCount = 0;

        for (const loan of loans) {
            const principal = loan.principal_amount || 0;
            const interest = loan.interest_earned || (principal * this.historicalLoanRate);

            totalPrincipal += principal;
            totalInterestEarned += interest;
            loanCount++;
        }

        const avgLoanYear = loans.length > 0
            ? Math.round(loans.reduce((sum, l) => sum + (l.instrument_year || this.baseYear), 0) / loans.length)
            : this.baseYear;
        const yearsElapsed = this.currentYear - avgLoanYear;

        // The bank profited from both principal use and interest
        const historicalProfit = totalPrincipal + totalInterestEarned;
        const compoundedValue = historicalProfit * Math.pow(1 + this.appreciationRate, yearsElapsed);

        // Financing slave trade deserves additional culpability
        const enablementMultiplier = 2.5;
        const totalDebt = Math.round(compoundedValue * enablementMultiplier);

        return {
            historicalPrincipal: totalPrincipal,
            historicalInterest: totalInterestEarned,
            historicalProfit,
            avgLoanYear,
            loanCount,
            yearsElapsed,
            appreciationRate: this.appreciationRate,
            compoundedValue: Math.round(compoundedValue),
            enablementMultiplier,
            modernValue: totalDebt,
            methodology: 'Loan principal + interest earned, compounded at 7% annually, with 2.5x enablement multiplier for financing slave trade',
            calculation: `(${historicalProfit} × (1 + ${this.appreciationRate})^${yearsElapsed}) × ${enablementMultiplier} = ${totalDebt.toLocaleString()}`,
            debtType: 'banking_slave_trader_loans'
        };
    }

    /**
     * Calculate debt from customs duties collected on slave ships
     *
     * Used for: FleetBoston/Providence Bank (¶¶ 125-128)
     *
     * @param {Array} duties - Array of customs duty records
     * @returns {Object} Calculation results
     */
    calculateCustomsDuties(duties) {
        let totalDuties = 0;
        let voyageCount = 0;

        for (const duty of duties) {
            totalDuties += duty.duties_collected || 0;
            voyageCount++;
        }

        const avgYear = duties.length > 0
            ? Math.round(duties.reduce((sum, d) => sum + (d.instrument_year || this.baseYear), 0) / duties.length)
            : this.baseYear;
        const yearsElapsed = this.currentYear - avgYear;

        const compoundedValue = totalDuties * Math.pow(1 + this.appreciationRate, yearsElapsed);
        const totalDebt = Math.round(compoundedValue);

        return {
            historicalDuties: totalDuties,
            voyageCount,
            avgYear,
            yearsElapsed,
            appreciationRate: this.appreciationRate,
            modernValue: totalDebt,
            methodology: 'Customs duties on slave trade vessels compounded at 7% annually',
            calculation: `${totalDuties} × (1 + ${this.appreciationRate})^${yearsElapsed} = ${totalDebt.toLocaleString()}`,
            debtType: 'banking_customs_duties'
        };
    }

    /**
     * Calculate debt from cotton factoring and plantation loans
     *
     * Used for: Brown Brothers & Co. (¶¶ 145-152), Lehman Brothers (¶¶ 168-171)
     *
     * @param {Array} advances - Array of cotton advance/loan records
     * @returns {Object} Calculation results
     */
    calculateCottonFactoring(advances) {
        let totalAdvances = 0;
        let totalCommissions = 0;
        let advanceCount = 0;

        for (const advance of advances) {
            const amount = advance.advance_amount || advance.principal_amount || 0;
            const commission = advance.commission || (amount * this.cottonFactorCommission);

            totalAdvances += amount;
            totalCommissions += commission;
            advanceCount++;
        }

        const avgYear = advances.length > 0
            ? Math.round(advances.reduce((sum, a) => sum + (a.instrument_year || this.baseYear), 0) / advances.length)
            : this.baseYear;
        const yearsElapsed = this.currentYear - avgYear;

        const historicalProfit = totalAdvances + totalCommissions;
        const compoundedValue = historicalProfit * Math.pow(1 + this.appreciationRate, yearsElapsed);

        // Factors were essential to the cotton economy built on slavery
        const enablementMultiplier = 2.0;
        const totalDebt = Math.round(compoundedValue * enablementMultiplier);

        return {
            historicalAdvances: totalAdvances,
            historicalCommissions: totalCommissions,
            historicalProfit,
            avgYear,
            advanceCount,
            yearsElapsed,
            appreciationRate: this.appreciationRate,
            compoundedValue: Math.round(compoundedValue),
            enablementMultiplier,
            modernValue: totalDebt,
            methodology: 'Cotton advances + factoring commissions compounded at 7% annually, with 2x enablement multiplier',
            calculation: `(${historicalProfit} × (1 + ${this.appreciationRate})^${yearsElapsed}) × ${enablementMultiplier} = ${totalDebt.toLocaleString()}`,
            debtType: 'banking_cotton_factoring'
        };
    }

    /**
     * Calculate debt from direct plantation ownership
     *
     * Used for: Brown Brothers Harriman (¶¶ 145-152)
     * "Louisiana court records from 1840s reveal ownership of two cotton plantations
     *  totaling 4,614 acres and 346 slaves"
     *
     * @param {Array} holdings - Array of plantation/slaveholding records
     * @returns {Object} Calculation results
     */
    calculatePlantationOwnership(holdings) {
        let totalEnslaved = 0;
        let totalAcreage = 0;
        let holdingCount = 0;

        for (const holding of holdings) {
            totalEnslaved += holding.enslaved_count || 0;
            totalAcreage += holding.acreage || 0;
            holdingCount++;
        }

        const avgYear = holdings.length > 0
            ? Math.round(holdings.reduce((sum, h) => sum + (h.record_year || this.baseYear), 0) / holdings.length)
            : this.baseYear;
        const yearsElapsed = this.currentYear - avgYear;

        // Direct slaveholding = full wage theft calculation
        const baseDebt = totalEnslaved * this.valuePerEnslaved;
        const compoundedValue = baseDebt * Math.pow(1 + this.appreciationRate, yearsElapsed);

        // Corporate slaveholders deserve higher accountability
        const corporateMultiplier = 1.5;
        const totalDebt = Math.round(compoundedValue * corporateMultiplier);

        return {
            totalEnslaved,
            totalAcreage,
            holdingCount,
            avgYear,
            yearsElapsed,
            valuePerEnslaved: this.valuePerEnslaved,
            baseDebt,
            appreciationRate: this.appreciationRate,
            compoundedValue: Math.round(compoundedValue),
            corporateMultiplier,
            modernValue: totalDebt,
            methodology: 'Wage theft for directly owned enslaved persons ($75,000 each) compounded at 7% annually, with 1.5x corporate multiplier',
            calculation: `(${totalEnslaved} × $${this.valuePerEnslaved.toLocaleString()} × (1 + ${this.appreciationRate})^${yearsElapsed}) × ${corporateMultiplier} = ${totalDebt.toLocaleString()}`,
            debtType: 'banking_direct_slaveholding'
        };
    }

    /**
     * Calculate debt from insurance consortium formation
     *
     * Used for: JP Morgan predecessors (¶¶ 181-182)
     * "Behind a consortium to raise money to insure slavery"
     *
     * @param {Object} consortiumData - Data about the consortium
     * @returns {Object} Calculation results
     */
    calculateInsuranceConsortium(consortiumData) {
        const {
            estimatedCapital = 1000000,  // Placeholder
            estimatedPolicies = 500,
            estimatedEnslaved = 5000,
            activeYears = { start: 1850, end: 1865 }
        } = consortiumData;

        const midpointYear = Math.round((activeYears.start + activeYears.end) / 2);
        const yearsElapsed = this.currentYear - midpointYear;

        // Consortium capital enabled insurance operations
        const compoundedCapital = estimatedCapital * Math.pow(1 + this.appreciationRate, yearsElapsed);

        // Plus liability for policies written
        const policyLiability = estimatedEnslaved * 45; // avg premium
        const compoundedPolicies = policyLiability * Math.pow(1 + this.appreciationRate, yearsElapsed);

        const totalCompounded = compoundedCapital + compoundedPolicies;
        const enablementMultiplier = 2.0;
        const totalDebt = Math.round(totalCompounded * enablementMultiplier);

        return {
            estimatedCapital,
            estimatedPolicies,
            estimatedEnslaved,
            midpointYear,
            yearsElapsed,
            compoundedCapital: Math.round(compoundedCapital),
            compoundedPolicies: Math.round(compoundedPolicies),
            enablementMultiplier,
            modernValue: totalDebt,
            methodology: 'Consortium capital + policy liability compounded at 7% annually, with 2x enablement multiplier',
            debtType: 'banking_insurance_consortium'
        };
    }

    /**
     * Calculate debt for Brown Brothers Harriman specifically
     * Most documented case: 4,614 acres, 346 enslaved
     */
    calculateBrownBrothersHarrimanDebt() {
        // Direct slaveholding from Louisiana court records
        const directHolding = this.calculatePlantationOwnership([{
            plantation_location: 'Louisiana',
            acreage: 4614,
            enslaved_count: 346,
            record_year: 1840,
            court_record_reference: 'Louisiana court records dating back to the 1840s'
        }]);

        // Cotton factoring operations - estimate based on "loaned millions"
        const factoring = this.calculateCottonFactoring([{
            advance_amount: 5000000, // "millions" - conservative estimate
            instrument_year: 1850
        }]);

        return {
            companyName: 'Brown Brothers Harriman & Company',
            historicalName: 'Brown Brothers & Co.',
            scacReference: '¶¶ 145-152',

            // Breakdown
            directSlaveholdingDebt: directHolding,
            cottonFactoringDebt: factoring,

            // Combined total
            totalModernValue: directHolding.modernValue + factoring.modernValue,

            // Evidence
            documentation: [
                'Louisiana court records dating back to the 1840s reveal ownership of two cotton plantations',
                'Totaling 4,614 acres and 346 slaves',
                'Loaned millions directly to planters, merchants and cotton brokers throughout the South'
            ],

            isFarmerPaellmannDefendant: true
        };
    }

    /**
     * Calculate debt for all Farmer-Paellmann banking defendants
     */
    calculateFarmerPaellmannBanks() {
        const defendants = [
            {
                companyName: 'Bank of America (FleetBoston successor)',
                historicalName: 'Providence Bank',
                scacReference: '¶¶ 125-128',
                // Estimate based on Providence's role as major port
                slaveTraderLoans: [{ principal_amount: 500000, instrument_year: 1800 }],
                customsDuties: [{ duties_collected: 100000, instrument_year: 1800 }]
            },
            {
                companyName: 'JPMorgan Chase & Co.',
                historicalName: 'Two predecessor banks (consortium)',
                scacReference: '¶¶ 181-182',
                consortiumData: {
                    estimatedCapital: 2000000,
                    estimatedEnslaved: 10000,
                    activeYears: { start: 1850, end: 1865 }
                }
            },
            {
                companyName: 'Barclays (Lehman successor)',
                historicalName: 'Henry Lehman & Brothers',
                scacReference: '¶¶ 168-171',
                cottonFactoring: [{ advance_amount: 2000000, instrument_year: 1855 }],
                directSlaveholding: [{ enslaved_count: 50, record_year: 1855 }]
            }
        ];

        const results = [];

        // Bank of America/FleetBoston
        const boa = defendants[0];
        const boaLoans = this.calculateSlaveTraderLoans(boa.slaveTraderLoans);
        const boaDuties = this.calculateCustomsDuties(boa.customsDuties);
        results.push({
            ...boa,
            calculations: { slaveTraderLoans: boaLoans, customsDuties: boaDuties },
            totalModernValue: boaLoans.modernValue + boaDuties.modernValue,
            isFarmerPaellmannDefendant: true
        });

        // JP Morgan
        const jpm = defendants[1];
        const jpmConsortium = this.calculateInsuranceConsortium(jpm.consortiumData);
        results.push({
            ...jpm,
            calculations: { insuranceConsortium: jpmConsortium },
            totalModernValue: jpmConsortium.modernValue,
            isFarmerPaellmannDefendant: true
        });

        // Brown Brothers Harriman (detailed calculation)
        results.push(this.calculateBrownBrothersHarrimanDebt());

        // Barclays/Lehman
        const barclays = defendants[2];
        const barclaysFactoring = this.calculateCottonFactoring(barclays.cottonFactoring);
        const barclaysSlaveholding = this.calculatePlantationOwnership(barclays.directSlaveholding);
        results.push({
            ...barclays,
            calculations: { cottonFactoring: barclaysFactoring, directSlaveholding: barclaysSlaveholding },
            totalModernValue: barclaysFactoring.modernValue + barclaysSlaveholding.modernValue,
            isFarmerPaellmannDefendant: true
        });

        return results;
    }

    /**
     * Get total debt for all banking defendants
     */
    getTotalBankingDebt() {
        const calculations = this.calculateFarmerPaellmannBanks();
        const totalDebt = calculations.reduce((sum, c) => sum + c.totalModernValue, 0);

        return {
            defendants: calculations,
            totalDebt,
            summary: `${calculations.length} banking/factor defendants owe ${totalDebt.toLocaleString()} in modern value`
        };
    }
}

module.exports = BankingCalculator;
