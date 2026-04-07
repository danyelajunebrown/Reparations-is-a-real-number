/**
 * ICHEIC-Adapted Multi-Jurisdiction Calculator
 *
 * Adapts the ICHEIC (International Commission on Holocaust Era Insurance
 * Claims) methodology for trans-Atlantic slavery restitution.
 *
 * ICHEIC approach: face value at historical exchange rates → present value
 * via compound interest at country-specific rates.
 *
 * KEY PRECEDENT: The UK Slavery Abolition Act 1833 compensation loan of
 * £20M was compounded at ~3.5% and only paid off in 2015 — 182 years.
 * This is GOVERNMENT-SANCTIONED compound interest on slavery debt.
 *
 * CITATIONS:
 * - ICHEIC Final Report (2007): methodology for historical asset valuation
 * - UK National Debt Office: Slavery Abolition loan records
 * - Brattle Group (2023): country-specific damage quantification, Table 16
 * - Craemer (2015): 3% conservative floor rate
 * - MeasuringWorth.com: historical currency conversion
 */

class ICHEICCalculator {
    constructor() {
        // ── Country-Specific Interest Rates ─────────────────────────
        // Each rate is sourced from the closest available historical precedent.
        this.RATES = {
            'US': {
                rate: 0.03,
                source: 'Craemer (2015), p. 645 — conservative floor rate',
                slaveryPeriod: { start: 1619, end: 1865 },
                brattleTotal: 30134  // $30,134B from Table 16
            },
            'UK': {
                rate: 0.035,
                source: 'UK Slavery Abolition Act 1833 loan — compounded at ~3.5% until 2015',
                slaveryPeriod: { start: 1627, end: 1834 },
                brattleTotal: 24011  // Table 16 (Britain column total)
            },
            'France': {
                rate: 0.025,
                source: 'Brattle Group lower bound rate (2.3% rounded up)',
                slaveryPeriod: { start: 1625, end: 1848 },
                brattleTotal: 9288
            },
            'Netherlands': {
                rate: 0.03,
                source: 'Dutch government bond rates, 18th-19th century',
                slaveryPeriod: { start: 1630, end: 1863 },
                brattleTotal: 4886
            },
            'Spain': {
                rate: 0.025,
                source: 'Brattle Group lower bound',
                slaveryPeriod: { start: 1502, end: 1886 },
                brattleTotal: 17107
            },
            'Portugal': {
                rate: 0.02,
                source: 'Conservative estimate — limited historical data',
                slaveryPeriod: { start: 1500, end: 1888 },
                brattleTotal: 20582
            },
            'Brazil': {
                rate: 0.04,
                source: 'Higher rate reflects longer period and larger scale',
                slaveryPeriod: { start: 1532, end: 1888 },
                brattleTotal: 4434  // Table 16 (Brazil row)
            },
            'Denmark': {
                rate: 0.025,
                source: 'Brattle Group lower bound',
                slaveryPeriod: { start: 1672, end: 1848 },
                brattleTotal: 681
            },
            'Sweden': {
                rate: 0.025,
                source: 'Brattle Group lower bound',
                slaveryPeriod: { start: 1784, end: 1847 },
                brattleTotal: 12
            }
        };

        this.CURRENT_YEAR = new Date().getFullYear();
    }

    /**
     * Calculate present value of a documented historical asset/labor value.
     *
     * @param {Object} params
     * @param {number} params.historicalValue - Value in historical currency units
     * @param {number} params.year - Year of the historical value
     * @param {string} params.jurisdiction - Country code (US, UK, France, etc.)
     * @param {string} params.assetType - 'labor', 'sale_price', 'insurance_value', 'probate_value', 'compensation'
     * @returns {Object} Present value calculation with full breakdown
     */
    calculatePresentValue(params) {
        const { historicalValue, year, jurisdiction, assetType = 'labor' } = params;

        const config = this.RATES[jurisdiction];
        if (!config) {
            return { error: `Unknown jurisdiction: ${jurisdiction}. Available: ${Object.keys(this.RATES).join(', ')}` };
        }

        const yearsToPresent = this.CURRENT_YEAR - year;
        const rate = config.rate;
        const presentValue = historicalValue * Math.pow(1 + rate, yearsToPresent);

        return {
            historicalValue,
            presentValue: Math.round(presentValue * 100) / 100,
            year,
            jurisdiction,
            assetType,
            interestRate: rate,
            yearsCompounded: yearsToPresent,
            compoundFactor: Math.round(Math.pow(1 + rate, yearsToPresent) * 100) / 100,
            rateSource: config.source,
            methodology: 'ICHEIC-adapted: historical face value × (1 + r)^years',
            precedent: jurisdiction === 'UK'
                ? 'UK Slavery Abolition Act 1833: £20M loan compounded at ~3.5% for 182 years (paid off 2015)'
                : 'Adapted from ICHEIC methodology (2007) with country-specific rates',
            brattleCeiling: config.brattleTotal ? `$${config.brattleTotal}B total for ${jurisdiction} (Brattle 2023, Table 16)` : null
        };
    }

    /**
     * Calculate reparations for a documented enslaved person using ICHEIC methodology.
     * Uses documented sale price, insurance value, or probate valuation as the face value.
     *
     * @param {Object} params
     * @param {number} params.documentedValue - Known historical value ($)
     * @param {number} params.year - Year of valuation
     * @param {string} params.jurisdiction - Country
     * @param {string} params.valueSource - 'sale_price', 'insurance_value', 'probate_valuation', 'compensation_payment'
     * @param {number} params.yearsEnslaved - Optional: years of enslavement for labor component
     */
    calculateEnslavedPersonReparations(params) {
        const {
            documentedValue, year, jurisdiction,
            valueSource = 'unknown', yearsEnslaved = null
        } = params;

        const assetCalc = this.calculatePresentValue({
            historicalValue: documentedValue,
            year,
            jurisdiction,
            assetType: valueSource
        });

        // If we know years enslaved, also calculate Craemer labor value for comparison
        let laborCalc = null;
        if (yearsEnslaved && year) {
            const dailyWage = 0.80; // Craemer
            const workingDays = 300;
            const annualWage = dailyWage * workingDays;
            const baseLabor = annualWage * yearsEnslaved;
            const endYear = year + yearsEnslaved;
            const yearsToPresent = this.CURRENT_YEAR - endYear;
            const laborPresentValue = baseLabor * Math.pow(1.03, yearsToPresent);

            laborCalc = {
                baseLabor: Math.round(baseLabor * 100) / 100,
                presentValue: Math.round(laborPresentValue * 100) / 100,
                methodology: 'Craemer (2015): $0.80/day × 300 days × years × (1.03)^years_to_present'
            };
        }

        return {
            icheic: assetCalc,
            craemer: laborCalc,
            recommended: laborCalc
                ? Math.max(assetCalc.presentValue, laborCalc.presentValue)
                : assetCalc.presentValue,
            note: laborCalc
                ? (assetCalc.presentValue >= laborCalc.presentValue
                    ? 'ICHEIC asset-based calculation exceeds Craemer labor-based calculation'
                    : 'Craemer labor-based calculation exceeds ICHEIC asset-based calculation')
                : 'No labor data available — using ICHEIC asset-based calculation only'
        };
    }

    /**
     * Get the Brattle Group total for a jurisdiction.
     */
    getBrattleTotal(jurisdiction) {
        const config = this.RATES[jurisdiction];
        return config ? {
            jurisdiction,
            totalBillions: config.brattleTotal,
            slaveryPeriod: config.slaveryPeriod,
            source: 'Brattle Group (2023), Table 16, p. 44'
        } : null;
    }

    /**
     * List all available jurisdictions with their rates.
     */
    listJurisdictions() {
        return Object.entries(this.RATES).map(([code, config]) => ({
            code,
            rate: config.rate,
            ratePercent: (config.rate * 100).toFixed(1) + '%',
            source: config.source,
            slaveryPeriod: config.slaveryPeriod,
            brattleTotal: config.brattleTotal ? `$${config.brattleTotal}B` : 'N/A'
        }));
    }
}

module.exports = ICHEICCalculator;
