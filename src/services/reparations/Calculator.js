/**
 * Reparations Calculator Module
 * 
 * This module provides comprehensive calculation methods for determining
 * reparations owed based on historical slavery data and economic factors.
 * 
 * @author Reparations Platform Team
 * @version 1.0.0
 */

class ReparationsCalculator {
    constructor(config = {}) {
        // Base economic parameters
        this.baseYear = config.baseYear || 1800;
        this.currentYear = config.currentYear || new Date().getFullYear();
        this.inflationRate = config.inflationRate || 0.035; // 3.5% annual inflation
        
        // Wage calculation parameters
        this.dailyWageBase = config.dailyWageBase || 120; // Base daily wage in historical dollars
        this.workDaysPerYear = config.workDaysPerYear || 300; // Approximate work days per year
        
        // Damage calculation parameters
        this.humanDignityValue = config.humanDignityValue || 15000; // Base value for human dignity violation
        this.dignityMultiplier = config.dignityMultiplier || 1.5; // Multiplier for compounded harm
        
        // Profit sharing parameters
        this.profitPerPersonPerYear = config.profitPerPersonPerYear || 300; // Estimated annual profit per enslaved person
        this.profitShareRate = config.profitShareRate || 0.4; // 40% of profits owed to descendants
        
        // Interest and penalty rates
        this.compoundInterestRate = config.compoundInterestRate || 0.04; // 4% compound interest
        this.penaltyRate = config.penaltyRate || 0.02; // 2% penalty for delayed payment
    }

    /**
     * Calculate inflation multiplier from base year to current year
     * @returns {number} Inflation multiplier
     */
    calculateInflationMultiplier() {
        const years = this.currentYear - this.baseYear;
        return Math.pow(1 + this.inflationRate, years);
    }

    /**
     * Calculate compound interest multiplier
     * @returns {number} Compound interest multiplier
     */
    calculateCompoundInterestMultiplier() {
        const years = this.currentYear - this.baseYear;
        return Math.pow(1 + this.compoundInterestRate, years);
    }

    /**
     * Calculate wage theft component
     * @param {number} enslavedCount - Number of enslaved individuals
     * @param {number} years - Years of enslavement
     * @returns {number} Wage theft amount in current dollars
     */
    calculateWageTheft(enslavedCount, years) {
        const baseWages = enslavedCount * this.dailyWageBase * years;
        const inflationAdjusted = baseWages * this.calculateInflationMultiplier();
        return Math.round(inflationAdjusted);
    }

    /**
     * Calculate damages for human rights violations
     * @param {number} enslavedCount - Number of enslaved individuals
     * @param {number} years - Years of enslavement
     * @returns {number} Damages amount in current dollars
     */
    calculateDamages(enslavedCount, years) {
        const baseDamages = enslavedCount * this.humanDignityValue * years;
        const compoundedDamages = baseDamages * this.dignityMultiplier;
        return Math.round(compoundedDamages);
    }

    /**
     * Calculate profit share owed to descendants
     * @param {number} enslavedCount - Number of enslaved individuals
     * @param {number} years - Years of enslavement
     * @returns {number} Profit share amount in current dollars
     */
    calculateProfitShare(enslavedCount, years) {
        const baseProfit = enslavedCount * this.profitPerPersonPerYear * years;
        const inflationAdjusted = baseProfit * this.calculateInflationMultiplier();
        const profitShare = inflationAdjusted * this.profitShareRate;
        return Math.round(profitShare);
    }

    /**
     * Calculate compound interest on unpaid debt
     * @param {number} principalAmount - Original debt amount
     * @returns {number} Compound interest amount
     */
    calculateCompoundInterest(principalAmount) {
        const interestMultiplier = this.calculateCompoundInterestMultiplier();
        return Math.round(principalAmount * (interestMultiplier - 1));
    }

    /**
     * Calculate penalty for delayed justice
     * @param {number} totalAmount - Total debt amount
     * @returns {number} Penalty amount
     */
    calculatePenalty(totalAmount) {
        const years = this.currentYear - this.baseYear;
        const penaltyAmount = totalAmount * this.penaltyRate * years;
        return Math.round(penaltyAmount);
    }

    /**
     * Comprehensive reparations calculation with detailed breakdown
     * @param {number} enslavedCount - Number of enslaved individuals
     * @param {number} years - Years of enslavement
     * @param {Object} options - Additional calculation options
     * @returns {Object} Detailed breakdown of reparations calculation
     */
    calculateComprehensiveReparations(enslavedCount, years, options = {}) {
        // Validate inputs
        if (enslavedCount <= 0 || years <= 0) {
            throw new Error('Enslaved count and years must be positive numbers');
        }

        // Core calculations
        const wageTheft = this.calculateWageTheft(enslavedCount, years);
        const damages = this.calculateDamages(enslavedCount, years);
        const profitShare = this.calculateProfitShare(enslavedCount, years);
        
        // Subtotal before interest and penalties
        const subtotal = wageTheft + damages + profitShare;
        
        // Interest and penalty calculations
        const compoundInterest = options.includeInterest !== false ? 
            this.calculateCompoundInterest(subtotal) : 0;
        const penalty = options.includePenalty !== false ? 
            this.calculatePenalty(subtotal) : 0;
        
        // Final total
        const total = subtotal + compoundInterest + penalty;
        
        return {
            // Core components
            wageTheft,
            damages,
            profitShare,
            subtotal,
            
            // Additional components
            compoundInterest,
            penalty,
            
            // Final calculation
            total,
            
            // Metadata
            metadata: {
                enslavedCount,
                years,
                calculationDate: new Date().toISOString(),
                baseYear: this.baseYear,
                currentYear: this.currentYear,
                inflationMultiplier: this.calculateInflationMultiplier(),
                compoundInterestMultiplier: this.calculateCompoundInterestMultiplier(),
                parameters: {
                    inflationRate: this.inflationRate,
                    dailyWageBase: this.dailyWageBase,
                    humanDignityValue: this.humanDignityValue,
                    profitPerPersonPerYear: this.profitPerPersonPerYear,
                    profitShareRate: this.profitShareRate,
                    compoundInterestRate: this.compoundInterestRate,
                    penaltyRate: this.penaltyRate
                }
            }
        };
    }

    /**
     * Calculate reparations for multiple ancestors
     * @param {Array} ancestorData - Array of ancestor objects {name, enslavedCount, years}
     * @param {Object} options - Calculation options
     * @returns {Object} Combined reparations calculation
     */
    calculateMultipleAncestors(ancestorData, options = {}) {
        if (!Array.isArray(ancestorData) || ancestorData.length === 0) {
            throw new Error('Ancestor data must be a non-empty array');
        }

        const calculations = ancestorData.map(ancestor => {
            if (!ancestor.name || !ancestor.enslavedCount || !ancestor.years) {
                throw new Error('Each ancestor must have name, enslavedCount, and years properties');
            }
            
            return {
                ancestor: ancestor.name,
                ...this.calculateComprehensiveReparations(ancestor.enslavedCount, ancestor.years, options)
            };
        });

        // Calculate totals across all ancestors
        const totals = calculations.reduce((acc, calc) => {
            acc.wageTheft += calc.wageTheft;
            acc.damages += calc.damages;
            acc.profitShare += calc.profitShare;
            acc.compoundInterest += calc.compoundInterest;
            acc.penalty += calc.penalty;
            acc.total += calc.total;
            return acc;
        }, {
            wageTheft: 0,
            damages: 0,
            profitShare: 0,
            compoundInterest: 0,
            penalty: 0,
            total: 0
        });

        return {
            breakdowns: calculations,
            totals,
            metadata: {
                ancestorCount: ancestorData.length,
                calculationDate: new Date().toISOString(),
                grandTotal: totals.total
            }
        };
    }

    /**
     * Distribute total reparations among descendants
     * @param {number} totalReparations - Total reparations amount
     * @param {Array} descendants - Array of descendant objects
     * @param {string} distributionMethod - Method for distribution ('equal', 'weighted', etc.)
     * @returns {Object} Distribution breakdown
     */
    distributeReparations(totalReparations, descendants, distributionMethod = 'equal') {
        if (!Array.isArray(descendants) || descendants.length === 0) {
            throw new Error('Descendants must be a non-empty array');
        }

        if (totalReparations <= 0) {
            throw new Error('Total reparations must be a positive number');
        }

        let distribution = [];

        switch (distributionMethod) {
            case 'equal':
                const sharePerDescendant = Math.round(totalReparations / descendants.length);
                distribution = descendants.map(descendant => ({
                    name: descendant.name || 'Unknown',
                    share: sharePerDescendant,
                    percentage: (100 / descendants.length).toFixed(2)
                }));
                break;
                
            case 'weighted':
                // Future implementation for weighted distribution based on various factors
                throw new Error('Weighted distribution not yet implemented');
                
            default:
                throw new Error(`Unknown distribution method: ${distributionMethod}`);
        }

        return {
            totalReparations,
            distributionMethod,
            distribution,
            metadata: {
                descendantCount: descendants.length,
                distributionDate: new Date().toISOString()
            }
        };
    }

    /**
     * Generate a human-readable report
     * @param {Object} calculationResult - Result from comprehensive calculation
     * @returns {string} Formatted report
     */
    generateReport(calculationResult) {
        if (!calculationResult || !calculationResult.total) {
            throw new Error('Invalid calculation result');
        }

        const { metadata } = calculationResult;
        
        return `
REPARATIONS CALCULATION REPORT
==============================

Calculation Date: ${new Date(metadata.calculationDate).toLocaleDateString()}
Base Year: ${metadata.baseYear}
Current Year: ${metadata.currentYear}

ENSLAVED INDIVIDUALS: ${metadata.enslavedCount}
YEARS OF ENSLAVEMENT: ${metadata.years}

BREAKDOWN:
- Wage Theft: $${calculationResult.wageTheft.toLocaleString()}
- Human Dignity Damages: $${calculationResult.damages.toLocaleString()}
- Profit Share: $${calculationResult.profitShare.toLocaleString()}
- Compound Interest: $${calculationResult.compoundInterest.toLocaleString()}
- Penalty for Delayed Justice: $${calculationResult.penalty.toLocaleString()}

TOTAL REPARATIONS OWED: $${calculationResult.total.toLocaleString()}

ECONOMIC FACTORS:
- Inflation Rate: ${(metadata.parameters.inflationRate * 100).toFixed(1)}%
- Compound Interest Rate: ${(metadata.parameters.compoundInterestRate * 100).toFixed(1)}%
- Inflation Multiplier: ${metadata.inflationMultiplier.toFixed(2)}x
- Total Value Increase: ${metadata.compoundInterestMultiplier.toFixed(2)}x

Note: This calculation is based on documented historical data and established 
economic principles for determining fair compensation for unpaid labor and 
human rights violations.
        `.trim();
    }

    /**
     * Export calculation parameters for transparency
     * @returns {Object} Current calculation parameters
     */
    exportParameters() {
        return {
            baseYear: this.baseYear,
            currentYear: this.currentYear,
            inflationRate: this.inflationRate,
            dailyWageBase: this.dailyWageBase,
            workDaysPerYear: this.workDaysPerYear,
            humanDignityValue: this.humanDignityValue,
            dignityMultiplier: this.dignityMultiplier,
            profitPerPersonPerYear: this.profitPerPersonPerYear,
            profitShareRate: this.profitShareRate,
            compoundInterestRate: this.compoundInterestRate,
            penaltyRate: this.penaltyRate
        };
    }

    /**
     * Update calculation parameters
     * @param {Object} newParameters - New parameter values
     */
    updateParameters(newParameters) {
        Object.keys(newParameters).forEach(key => {
            if (this.hasOwnProperty(key)) {
                this[key] = newParameters[key];
            }
        });
    }
}

// Export for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReparationsCalculator;
} else if (typeof window !== 'undefined') {
    window.ReparationsCalculator = ReparationsCalculator;
}

// Export default instance with standard parameters
const standardCalculator = new ReparationsCalculator();

if (typeof module !== 'undefined' && module.exports) {
    module.exports.standard = standardCalculator;
} else if (typeof window !== 'undefined') {
    window.standardReparationsCalculator = standardCalculator;
}
