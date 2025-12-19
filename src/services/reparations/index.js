/**
 * Reparations Services Module
 *
 * This module provides the complete financial tracking system for reparations:
 *
 * 1. Calculator - Calculates what is owed based on historical data
 * 2. DebtTracker - Tracks debts owed BY slave owners TO descendants
 * 3. CompensationTracker - Documents historical payments TO owners (as evidence)
 *
 * CONCEPTUAL MODEL:
 * ================
 *
 *   EVIDENCE LEDGER (Historical Facts)
 *   ├── What owners received (CompensationTracker)
 *   │   └── British 1833: £20M, DC 1862: $1M, etc.
 *   └── What was stolen (DebtTracker)
 *       └── Wages, dignity, freedom
 *
 *   CALCULATION ENGINE (Calculator)
 *   ├── Wage theft calculation
 *   ├── Damages calculation
 *   ├── Compound interest
 *   └── Distribution to descendants
 *
 *   REPARATIONS BLOCKCHAIN (Future)
 *   ├── Documents payments TO descendants
 *   ├── Each payment reduces debt
 *   └── Transparent, immutable record
 *
 * KEY INSIGHT:
 * Compensation TO owners PROVES debt exists - it doesn't reduce it.
 * The enslaved received ZERO. Their descendants are owed at minimum
 * what the owners received, plus damages for the violation itself.
 */

const ReparationsCalculator = require('./Calculator');
const DebtTracker = require('./DebtTracker');
const CompensationTracker = require('./CompensationTracker');

// Sector-specific calculators for corporate entities (Added Dec 18, 2025)
const InsuranceCalculator = require('./InsuranceCalculator');
const BankingCalculator = require('./BankingCalculator');
const RailroadCalculator = require('./RailroadCalculator');

/**
 * Unified Reparations System
 * Combines all three trackers into a single coherent system
 */
class ReparationsSystem {
    constructor(db = null) {
        this.db = db;
        this.calculator = new ReparationsCalculator();
        this.debtTracker = new DebtTracker();
        this.compensationTracker = new CompensationTracker(db);

        // Sector-specific calculators for corporate debt (Added Dec 18, 2025)
        this.insuranceCalculator = new InsuranceCalculator();
        this.bankingCalculator = new BankingCalculator();
        this.railroadCalculator = new RailroadCalculator();
    }

    /**
     * Process a compensation record and link it to debt evidence
     */
    processCompensationEvidence(payment) {
        // Record the compensation payment
        const record = this.compensationTracker.recordCompensationPayment(payment);

        // Link to debt tracker (creates/confirms debt record)
        const debtId = this.compensationTracker.linkToDebtTracker(
            this.debtTracker,
            record
        );

        return {
            compensationRecord: record,
            debtId,
            provenDebt: record.debtEvidence.totalProvenDebt
        };
    }

    /**
     * Import British compensation claims from UCL LBS
     */
    async importBritishClaims(claims) {
        const results = [];

        for (const claim of claims) {
            const record = await this.compensationTracker.importBritishCompensationClaim(claim);
            const debtId = this.compensationTracker.linkToDebtTracker(
                this.debtTracker,
                record
            );
            results.push({ record, debtId });
        }

        return {
            imported: results.length,
            totalProvenDebt: results.reduce(
                (sum, r) => sum + r.record.debtEvidence.totalProvenDebt,
                0
            )
        };
    }

    /**
     * Import DC Compensated Emancipation claims
     */
    importDCClaims(claims) {
        const results = [];

        for (const claim of claims) {
            const record = this.compensationTracker.importDCEmancipationClaim(claim);
            const debtId = this.compensationTracker.linkToDebtTracker(
                this.debtTracker,
                record
            );
            results.push({ record, debtId });
        }

        return {
            imported: results.length,
            totalProvenDebt: results.reduce(
                (sum, r) => sum + r.record.debtEvidence.totalProvenDebt,
                0
            )
        };
    }

    /**
     * Initialize system from database (load existing records)
     */
    async initialize() {
        if (!this.db) {
            console.log('[ReparationsSystem] No database connection - running in memory-only mode');
            return false;
        }

        console.log('[ReparationsSystem] Initializing from database...');

        // Load compensation claims from database
        await this.compensationTracker.loadFromDatabase({ limit: 5000 });

        console.log('[ReparationsSystem] Initialization complete');
        return true;
    }

    /**
     * Get database statistics
     */
    async getDatabaseStats() {
        if (!this.db) return null;
        return await this.compensationTracker.getDatabaseStatistics();
    }

    /**
     * Save a compensation record with full database integration
     */
    async saveCompensationEvidence(payment) {
        // Record in memory
        const record = this.compensationTracker.recordCompensationPayment(payment);

        // Link to debt tracker
        const debtId = this.compensationTracker.linkToDebtTracker(
            this.debtTracker,
            record
        );

        // Save to database
        if (this.db) {
            const dbId = await this.compensationTracker.saveToDatabase(record);
            record.dbId = dbId;
        }

        return {
            compensationRecord: record,
            debtId,
            provenDebt: record.debtEvidence.totalProvenDebt,
            savedToDatabase: !!record.dbId
        };
    }

    /**
     * Sync all in-memory records to database
     */
    async syncToDatabase() {
        if (!this.db) {
            return { compensationSynced: 0, errors: 0 };
        }

        const result = await this.compensationTracker.syncToDatabase();
        return { compensationSynced: result.synced, errors: result.errors };
    }

    /**
     * Calculate total system state
     */
    getSystemState() {
        const compensationEvidence = this.compensationTracker.getSystemTotals();
        const debtTotals = this.debtTracker.calculateSystemTotalDebt();

        return {
            // Evidence from compensation records
            compensationEvidence: {
                recordCount: compensationEvidence.totalRecords,
                paidToOwners: compensationEvidence.totalPaidToOwners,
                provenDebt: compensationEvidence.totalProvenDebt,
                enslavedAffected: compensationEvidence.totalEnslavedAffected
            },

            // Full debt tracking
            debtTracking: {
                totalDebtors: debtTotals.totalDebtors,
                totalDebt: debtTotals.totalDebt,
                totalEnslaved: debtTotals.totalSlaves,
                averagePerDebtor: debtTotals.averageDebtPerAncestor
            },

            // The gap that reparations must fill
            reparationsOwed: {
                minimumFromCompensation: compensationEvidence.totalProvenDebt,
                calculatedFromDebt: debtTotals.totalDebt,
                // Use the higher of the two as floor
                minimumTotal: Math.max(
                    compensationEvidence.totalProvenDebt,
                    debtTotals.totalDebt
                )
            },

            // What has been paid to descendants so far
            reparationsPaid: {
                total: 0, // TODO: Track actual reparations payments
                remaining: Math.max(
                    compensationEvidence.totalProvenDebt,
                    debtTotals.totalDebt
                )
            }
        };
    }

    /**
     * Generate comprehensive report
     */
    generateReport() {
        const state = this.getSystemState();

        return `
================================================================================
                    REPARATIONS SYSTEM STATUS REPORT
================================================================================

SECTION 1: COMPENSATION EVIDENCE (Historical Payments TO Owners)
----------------------------------------------------------------
Records Documented:      ${state.compensationEvidence.recordCount.toLocaleString()}
Paid to Owners:          $${state.compensationEvidence.paidToOwners.toLocaleString()} (modern value)
Enslaved People Affected: ${state.compensationEvidence.enslavedAffected.toLocaleString()}
Proven Minimum Debt:     $${state.compensationEvidence.provenDebt.toLocaleString()}

NOTE: These compensation payments PROVE debt exists. The enslaved received $0.

SECTION 2: DEBT TRACKING (What Is Owed)
---------------------------------------
Documented Debtors:      ${state.debtTracking.totalDebtors.toLocaleString()}
Total Calculated Debt:   $${state.debtTracking.totalDebt.toLocaleString()}
Enslaved People:         ${state.debtTracking.totalEnslaved.toLocaleString()}
Average per Debtor:      $${state.debtTracking.averagePerDebtor.toLocaleString()}

SECTION 3: REPARATIONS STATUS
-----------------------------
Minimum Owed (from compensation): $${state.reparationsOwed.minimumFromCompensation.toLocaleString()}
Calculated Debt Total:            $${state.reparationsOwed.calculatedFromDebt.toLocaleString()}
MINIMUM TOTAL OWED:               $${state.reparationsOwed.minimumTotal.toLocaleString()}

Paid to Descendants:              $${state.reparationsPaid.total.toLocaleString()}
REMAINING DEBT:                   $${state.reparationsPaid.remaining.toLocaleString()}

================================================================================
                         END OF REPORT
================================================================================
        `.trim();
    }

    /**
     * Export all data for blockchain integration
     */
    exportForBlockchain() {
        return {
            systemState: this.getSystemState(),
            compensationEvidence: this.compensationTracker.exportForBlockchain(),
            debtRecords: this.debtTracker.exportForBlockchainWithCorporate(),
            exportTimestamp: new Date().toISOString()
        };
    }

    // ========================================================================
    // CORPORATE DEBT CALCULATIONS (Added Dec 18, 2025)
    // For Farmer-Paellmann defendants
    // ========================================================================

    /**
     * Calculate and register debt for all Farmer-Paellmann insurance defendants
     */
    calculateInsuranceDefendantsDebt() {
        const calculations = this.insuranceCalculator.calculateFarmerPaellmannInsurers();

        for (const calc of calculations) {
            this.debtTracker.addCorporateDebt(
                calc.companyName,
                calc.debtType || 'insurance',
                calc,
                { scacReference: calc.scacReference }
            );
        }

        return calculations;
    }

    /**
     * Calculate and register debt for all Farmer-Paellmann banking defendants
     */
    calculateBankingDefendantsDebt() {
        const calculations = this.bankingCalculator.calculateFarmerPaellmannBanks();

        for (const calc of calculations) {
            this.debtTracker.addCorporateDebt(
                calc.companyName,
                calc.debtType || 'banking',
                calc,
                { scacReference: calc.scacReference }
            );
        }

        return calculations;
    }

    /**
     * Calculate and register debt for all Farmer-Paellmann railroad defendants
     */
    calculateRailroadDefendantsDebt() {
        const calculations = this.railroadCalculator.calculateFarmerPaellmannRailroads();

        for (const calc of calculations) {
            this.debtTracker.addCorporateDebt(
                calc.companyName,
                calc.debtType || 'railroad_labor',
                calc,
                { scacReference: calc.scacReference }
            );
        }

        return calculations;
    }

    /**
     * Calculate debt for all 17 Farmer-Paellmann defendants
     * Returns comprehensive breakdown by sector
     */
    calculateAllFarmerPaellmannDebt() {
        console.log('[ReparationsSystem] Calculating debt for all Farmer-Paellmann defendants...');

        const insurance = this.calculateInsuranceDefendantsDebt();
        const banking = this.calculateBankingDefendantsDebt();
        const railroads = this.calculateRailroadDefendantsDebt();

        // Note: Tobacco companies require different calculation approach
        // (asset beneficiary rather than direct involvement)

        const totalInsurance = insurance.reduce((sum, c) => sum + (c.modernValue || 0), 0);
        const totalBanking = banking.reduce((sum, c) => sum + (c.totalModernValue || c.modernValue || 0), 0);
        const totalRailroads = railroads.reduce((sum, c) => sum + (c.modernValue || 0), 0);

        const grandTotal = totalInsurance + totalBanking + totalRailroads;

        console.log(`[ReparationsSystem] Total Farmer-Paellmann debt: $${grandTotal.toLocaleString()}`);

        return {
            bySector: {
                insurance: { defendants: insurance.length, total: totalInsurance, calculations: insurance },
                banking: { defendants: banking.length, total: totalBanking, calculations: banking },
                railroads: { defendants: railroads.length, total: totalRailroads, calculations: railroads },
                tobacco: { defendants: 4, total: 0, note: 'Tobacco calculation requires asset beneficiary analysis' }
            },
            summary: {
                totalDefendants: insurance.length + banking.length + railroads.length + 4,
                farmerPaellmannDefendants: 17,
                calculatedDebt: grandTotal,
                tobaccoPending: true
            },
            legalReference: 'In re African-American Slave Descendants Litigation, 304 F. Supp. 2d 1027 (N.D. Ill. 2004)'
        };
    }

    /**
     * Get combined system state including corporate debt
     */
    getCombinedSystemState() {
        const baseState = this.getSystemState();
        const combinedDebt = this.debtTracker.calculateCombinedSystemDebt();

        return {
            ...baseState,
            corporateDebt: combinedDebt.corporations,
            combinedTotal: combinedDebt.combined,
            leaderboard: this.debtTracker.getCombinedLeaderboard(20)
        };
    }
}

// Export individual classes and unified system
module.exports = {
    // Core system
    ReparationsCalculator,
    DebtTracker,
    CompensationTracker,
    ReparationsSystem,

    // Sector-specific calculators (Added Dec 18, 2025)
    InsuranceCalculator,
    BankingCalculator,
    RailroadCalculator,

    // Factory function to create initialized system with database
    createReparationsSystem: async (db) => {
        const system = new ReparationsSystem(db);
        await system.initialize();
        return system;
    }
};
