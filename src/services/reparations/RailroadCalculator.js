/**
 * Railroad Calculator for Slave Labor Construction
 *
 * Calculates reparations debt for railroad companies built with enslaved labor:
 * - CSX Corporation (numerous predecessor lines) - ¶¶ 129-133
 * - Norfolk Southern Corporation (numerous predecessor lines) - ¶¶ 163-165
 * - Union Pacific Railroad (numerous predecessor lines) - ¶¶ 177-179
 * - Canadian National Railway (seven predecessor lines) - ¶¶ 213-215
 *
 * Legal Reference: Farmer-Paellmann v. FleetBoston Financial Corporation
 *
 * Historical Context:
 * Southern railroads were predominantly built using enslaved labor.
 * Enslaved workers cleared land, graded roadbeds, laid track, and operated lines.
 * Many enslaved workers died during construction due to dangerous conditions.
 */

class RailroadCalculator {
    constructor(config = {}) {
        this.baseYear = config.baseYear || 1850;
        this.currentYear = config.currentYear || new Date().getFullYear();

        // Labor value appreciation rate
        this.appreciationRate = config.appreciationRate || 0.06; // 6% for labor value

        // Historical labor values
        this.dailyWageEquivalent = config.dailyWageEquivalent || 1.50;  // $1.50/day in 1850s
        this.workDaysPerYear = config.workDaysPerYear || 300;
        this.avgYearsWorked = config.avgYearsWorked || 5;

        // Danger premium for railroad work (higher mortality)
        this.dangerMultiplier = config.dangerMultiplier || 1.5;

        // Modern wage theft base per enslaved person
        this.modernWageTheftBase = config.modernWageTheftBase || 75000;
    }

    /**
     * Calculate debt from unpaid slave labor in railroad construction
     *
     * @param {Array} laborRecords - Array of labor records
     * @returns {Object} Calculation results
     */
    calculateRailroadLaborDebt(laborRecords) {
        let totalLaborYears = 0;
        let totalEnslaved = 0;
        let totalMileage = 0;

        for (const record of laborRecords) {
            const enslaved = record.enslaved_count || 0;
            const yearsWorked = record.years_worked || this.avgYearsWorked;

            totalLaborYears += enslaved * yearsWorked;
            totalEnslaved += enslaved;
            totalMileage += record.miles_constructed || 0;
        }

        const avgYear = laborRecords.length > 0
            ? Math.round(laborRecords.reduce((sum, r) => sum + (r.construction_year || this.baseYear), 0) / laborRecords.length)
            : this.baseYear;
        const yearsElapsed = this.currentYear - avgYear;

        // Calculate using historical wages
        const annualWage = this.dailyWageEquivalent * this.workDaysPerYear;
        const historicalDebt = totalLaborYears * annualWage * this.dangerMultiplier;

        // Compound to present value
        const compoundedValue = historicalDebt * Math.pow(1 + this.appreciationRate, yearsElapsed);

        // Infrastructure multiplier - railroads created lasting wealth
        const infrastructureMultiplier = 2.0;
        const totalDebt = Math.round(compoundedValue * infrastructureMultiplier);

        return {
            totalEnslaved,
            totalLaborYears,
            totalMileage,
            avgYear,
            yearsElapsed,
            dailyWage: this.dailyWageEquivalent,
            dangerMultiplier: this.dangerMultiplier,
            historicalDebt,
            appreciationRate: this.appreciationRate,
            compoundedValue: Math.round(compoundedValue),
            infrastructureMultiplier,
            modernValue: totalDebt,
            methodology: 'Unpaid railroad construction wages ($1.50/day × 300 days × danger premium) compounded at 6% annually, with 2x infrastructure multiplier for lasting wealth creation',
            calculation: `(${totalLaborYears} labor-years × $${annualWage}/year × ${this.dangerMultiplier}) × (1 + ${this.appreciationRate})^${yearsElapsed} × ${infrastructureMultiplier} = ${totalDebt.toLocaleString()}`,
            debtType: 'railroad_construction_labor'
        };
    }

    /**
     * Calculate debt for a railroad company using aggregate estimates
     *
     * @param {Object} companyData - Aggregate data about the company's slave labor use
     * @returns {Object} Calculation results
     */
    calculateCompanyDebt(companyData) {
        const {
            companyName,
            historicalName,
            estimatedEnslaved,
            estimatedMiles,
            activeYears,          // e.g., { start: 1830, end: 1865 }
            predecessorCount = 1  // Number of predecessor lines
        } = companyData;

        // Estimate labor years based on mileage and workforce
        // Rough estimate: 1000 labor-years per 100 miles of track
        const estimatedLaborYears = estimatedEnslaved
            ? estimatedEnslaved * this.avgYearsWorked
            : (estimatedMiles / 100) * 1000;

        const midpointYear = activeYears
            ? Math.round((activeYears.start + activeYears.end) / 2)
            : this.baseYear;
        const yearsElapsed = this.currentYear - midpointYear;

        // Calculate using historical wages
        const annualWage = this.dailyWageEquivalent * this.workDaysPerYear;
        const historicalDebt = estimatedLaborYears * annualWage * this.dangerMultiplier;

        // Compound to present value
        const compoundedValue = historicalDebt * Math.pow(1 + this.appreciationRate, yearsElapsed);

        // Scale multiplier based on number of predecessor lines
        const predecessorMultiplier = 1 + (predecessorCount - 1) * 0.1;
        const infrastructureMultiplier = 2.0 * predecessorMultiplier;
        const totalDebt = Math.round(compoundedValue * infrastructureMultiplier);

        return {
            companyName,
            historicalName,
            estimatedEnslaved: estimatedEnslaved || Math.round(estimatedLaborYears / this.avgYearsWorked),
            estimatedMiles,
            estimatedLaborYears: Math.round(estimatedLaborYears),
            predecessorCount,
            midpointYear,
            yearsElapsed,
            historicalDebt: Math.round(historicalDebt),
            compoundedValue: Math.round(compoundedValue),
            infrastructureMultiplier,
            modernValue: totalDebt,
            methodology: `Estimated ${Math.round(estimatedLaborYears).toLocaleString()} labor-years of enslaved railroad construction work compounded at ${this.appreciationRate * 100}% annually with infrastructure multiplier`,
            debtType: 'railroad_aggregate'
        };
    }

    /**
     * Calculate debt using modern wage theft approach per enslaved person
     *
     * @param {number} enslavedCount - Number of enslaved workers
     * @param {number} constructionYear - Year of construction
     * @returns {Object} Calculation results
     */
    calculateModernWageTheftApproach(enslavedCount, constructionYear = 1850) {
        const yearsElapsed = this.currentYear - constructionYear;

        // Base wage theft per person
        const baseDebt = enslavedCount * this.modernWageTheftBase;

        // Compound
        const compoundedValue = baseDebt * Math.pow(1 + this.appreciationRate, yearsElapsed);

        // Railroad construction was especially dangerous
        const totalDebt = Math.round(compoundedValue * this.dangerMultiplier);

        return {
            enslavedCount,
            constructionYear,
            yearsElapsed,
            wageTheftPerPerson: this.modernWageTheftBase,
            baseDebt,
            compoundedValue: Math.round(compoundedValue),
            dangerMultiplier: this.dangerMultiplier,
            modernValue: totalDebt,
            methodology: `$${this.modernWageTheftBase.toLocaleString()} wage theft per enslaved × ${this.dangerMultiplier} danger premium, compounded at ${this.appreciationRate * 100}%`,
            debtType: 'railroad_modern_wage_theft'
        };
    }

    /**
     * Calculate debt for all Farmer-Paellmann railroad defendants
     *
     * Historical estimates based on Southern railroad construction records
     */
    calculateFarmerPaellmannRailroads() {
        const defendants = [
            {
                companyName: 'CSX Corporation',
                historicalName: 'Numerous predecessor railroad lines',
                scacReference: '¶¶ 129-133',
                // CSX predecessors: Seaboard, Atlantic Coast Line, Louisville & Nashville, etc.
                estimatedMiles: 5000,
                estimatedEnslaved: 15000,
                predecessorCount: 12,
                activeYears: { start: 1830, end: 1865 },
                allegation: 'constructed or run, at least in part, by slave labor'
            },
            {
                companyName: 'Norfolk Southern Corporation',
                historicalName: 'Numerous predecessor railroad lines',
                scacReference: '¶¶ 163-165',
                // Norfolk Southern predecessors: Norfolk & Western, Southern Railway
                estimatedMiles: 4000,
                estimatedEnslaved: 12000,
                predecessorCount: 10,
                activeYears: { start: 1835, end: 1865 },
                allegation: 'constructed or run by slave labor; derived benefits of unpaid slave labor; provided financial support to slave owners and slave traders'
            },
            {
                companyName: 'Union Pacific Corporation',
                historicalName: 'Numerous predecessor railroad lines',
                scacReference: '¶¶ 177-179',
                // Union Pacific had less Southern exposure but still used slave labor
                estimatedMiles: 2000,
                estimatedEnslaved: 5000,
                predecessorCount: 6,
                activeYears: { start: 1840, end: 1865 },
                allegation: 'constructed or run in part by slave labor'
            },
            {
                companyName: 'Canadian National Railway',
                historicalName: 'Seven predecessor railroad lines',
                scacReference: '¶¶ 213-215',
                // CN had US predecessor lines built with slave labor
                estimatedMiles: 1500,
                estimatedEnslaved: 4000,
                predecessorCount: 7,
                activeYears: { start: 1840, end: 1865 },
                allegation: 'constructed and/or run in part by slave labor'
            }
        ];

        return defendants.map(defendant => {
            const calculation = this.calculateCompanyDebt(defendant);
            return {
                ...calculation,
                scacReference: defendant.scacReference,
                allegation: defendant.allegation,
                isFarmerPaellmannDefendant: true
            };
        });
    }

    /**
     * Get total debt for all railroad defendants
     */
    getTotalRailroadDebt() {
        const calculations = this.calculateFarmerPaellmannRailroads();
        const totalDebt = calculations.reduce((sum, c) => sum + c.modernValue, 0);
        const totalEnslaved = calculations.reduce((sum, c) => sum + (c.estimatedEnslaved || 0), 0);
        const totalMiles = calculations.reduce((sum, c) => sum + (c.estimatedMiles || 0), 0);

        return {
            defendants: calculations,
            totalDebt,
            totalEnslaved,
            totalMiles,
            summary: `${calculations.length} railroad defendants owe ${totalDebt.toLocaleString()} in modern value for ~${totalEnslaved.toLocaleString()} enslaved workers who built ~${totalMiles.toLocaleString()} miles of track`
        };
    }

    /**
     * Calculate per-mile debt estimate for research purposes
     *
     * Useful for estimating debt when only mileage is known
     */
    getPerMileEstimate() {
        // Based on historical records: ~20 enslaved workers per mile of track
        // Average 5 years to construct a mile
        const workersPerMile = 20;
        const yearsPerMile = 5;
        const laborYearsPerMile = workersPerMile * yearsPerMile;

        const annualWage = this.dailyWageEquivalent * this.workDaysPerYear;
        const historicalDebtPerMile = laborYearsPerMile * annualWage * this.dangerMultiplier;

        // Compound from 1850 (representative year)
        const yearsElapsed = this.currentYear - 1850;
        const modernDebtPerMile = historicalDebtPerMile * Math.pow(1 + this.appreciationRate, yearsElapsed) * 2.0;

        return {
            workersPerMile,
            yearsPerMile,
            laborYearsPerMile,
            historicalDebtPerMile: Math.round(historicalDebtPerMile),
            modernDebtPerMile: Math.round(modernDebtPerMile),
            methodology: 'Estimate: 20 workers × 5 years per mile of track, with danger premium and infrastructure multiplier'
        };
    }
}

module.exports = RailroadCalculator;
