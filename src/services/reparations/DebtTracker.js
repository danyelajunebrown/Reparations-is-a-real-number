/**
 * Debt Tracking System for Reparations
 * Handles ancestor debt assignment, inheritance chains, descendant liability,
 * AND corporate entity debt tracking.
 *
 * Enhanced December 18, 2025 to support Farmer-Paellmann defendants
 * (In re African-American Slave Descendants Litigation, N.D. Ill. 2004)
 */

class DebtTracker {
    constructor() {
        // Individual slaveholder tracking
        this.debtRecords = [];
        this.ancestorDebts = new Map();
        this.inheritanceChains = new Map();

        // Corporate entity tracking (NEW)
        this.corporateDebts = new Map();
        this.corporateRecords = [];

        this.nextDebtId = 1;
    }

    /**
 * Add debt record for a slave owner based on document evidence
 */
addSlaveownerDebt(ancestorName, slaveCount, source, year, documentDetails = null) {
    const debtId = `debt_${this.nextDebtId++}`;
    
    if (!this.ancestorDebts.has(ancestorName)) {
        this.ancestorDebts.set(ancestorName, []);
    }

    // Calculate debt using your reparations calculator
    let calculatedDebt = 0;
    if (typeof reparationsCalculator !== 'undefined') {
        const calculation = reparationsCalculator.calculateComprehensiveReparations(slaveCount, 25);
        calculatedDebt = calculation.total;
    } else {
        // Fallback calculation if calculator not available
        calculatedDebt = slaveCount * 75000; // Rough estimate per person
    }

    const debtRecord = {
        id: debtId,
        ancestorName,
        slaveCount,
        source, // 'census', 'will', 'correspondence', 'baptismal', 'estate'
        year,
        calculatedDebt,
        documentDetails: documentDetails || {},
        timestamp: new Date().toISOString(),
        verified: false,
        notes: ''
    };

    this.ancestorDebts.get(ancestorName).push(debtRecord);
    this.debtRecords.push(debtRecord);

    console.log(`Added debt record: ${ancestorName} owes $${calculatedDebt.toLocaleString()} for ${slaveCount} slaves (${source}, ${year})`);

    return debtId;
}

/**
 * Handle inheritance from will - your billing logic
 */
addInheritanceRecord(originalOwner, inheritor, slaveCount, willYear, willDetails = null) {
    const inheritanceId = `inherit_${this.nextDebtId++}`;
    
    // First, reduce the original owner's debt count for these specific slaves
    this.adjustOwnerDebt(originalOwner, -slaveCount, `Bequeathed ${slaveCount} slaves to ${inheritor}`, willYear);
    
    // Then bill the inheritor for the inherited slaves
    const inheritedDebtId = this.addSlaveownerDebt(
        inheritor, 
        slaveCount, 
        'inheritance', 
        willYear,
        { inheritedFrom: originalOwner, willDetails }
    );

    // Track the inheritance chain
    const inheritance = {
        id: inheritanceId,
        originalOwner,
        inheritor,
        slaveCount,
        willYear,
        transferType: 'inheritance',
        originalDebtId: this.findDebtRecordId(originalOwner, willYear),
        inheritedDebtId,
        documentSource: willDetails
    };

    this.inheritanceChains.set(inheritanceId, inheritance);

    console.log(`Inheritance recorded: ${originalOwner} → ${inheritor} (${slaveCount} slaves, ${willYear})`);

    return inheritanceId;
}

/**
 * Adjust owner debt for transfers/corrections
 */
adjustOwnerDebt(ancestorName, slaveCountAdjustment, reason, year = null) {
    if (!this.ancestorDebts.has(ancestorName)) {
        this.ancestorDebts.set(ancestorName, []);
    }

    const adjustmentId = `adj_${this.nextDebtId++}`;
    
    let adjustmentDebt = 0;
    if (slaveCountAdjustment !== 0) {
        if (typeof reparationsCalculator !== 'undefined') {
            const calculation = reparationsCalculator.calculateComprehensiveReparations(
                Math.abs(slaveCountAdjustment), 25
            );
            adjustmentDebt = slaveCountAdjustment < 0 ? -calculation.total : calculation.total;
        } else {
            adjustmentDebt = slaveCountAdjustment * 75000;
        }
    }

    const adjustmentRecord = {
        id: adjustmentId,
        ancestorName,
        slaveCount: slaveCountAdjustment,
        source: 'adjustment',
        year: year || new Date().getFullYear(),
        reason,
        calculatedDebt: adjustmentDebt,
        timestamp: new Date().toISOString(),
        verified: true,
        notes: `Adjustment: ${reason}`
    };

    this.ancestorDebts.get(ancestorName).push(adjustmentRecord);
    this.debtRecords.push(adjustmentRecord);

    return adjustmentId;
}

/**
 * Calculate total debt for an ancestor (sum of all their records)
 */
calculateTotalAncestorDebt(ancestorName) {
    const debts = this.ancestorDebts.get(ancestorName) || [];
    return debts.reduce((total, debt) => total + debt.calculatedDebt, 0);
}

/**
 * Get breakdown of all debts for an ancestor
 */
getAncestorDebtBreakdown(ancestorName) {
    const debts = this.ancestorDebts.get(ancestorName) || [];
    const totalDebt = debts.reduce((sum, debt) => sum + debt.calculatedDebt, 0);
    const totalSlaves = debts.reduce((sum, debt) => sum + Math.max(0, debt.slaveCount), 0);

    return {
        ancestorName,
        totalDebt,
        totalSlaves,
        debtRecords: debts,
        sources: [...new Set(debts.map(debt => debt.source))],
        yearRange: {
            earliest: Math.min(...debts.map(debt => debt.year)),
            latest: Math.max(...debts.map(debt => debt.year))
        }
    };
}

/**
 * Find debt record ID for linking purposes
 */
findDebtRecordId(ancestorName, year) {
    const debts = this.ancestorDebts.get(ancestorName) || [];
    const record = debts.find(debt => debt.year === year);
    return record ? record.id : null;
}

/**
 * Verify a debt record (mark as confirmed)
 */
verifyDebtRecord(debtId, verificationNotes = '') {
    const record = this.debtRecords.find(debt => debt.id === debtId);
    if (record) {
        record.verified = true;
        record.notes += ` VERIFIED: ${verificationNotes}`;
        console.log(`Debt record ${debtId} verified`);
        return true;
    }
    return false;
}

/**
 * Get all ancestors with outstanding debts
 */
getAllDebtors() {
    const debtors = [];
    
    for (const [ancestorName, debts] of this.ancestorDebts) {
        const totalDebt = debts.reduce((sum, debt) => sum + debt.calculatedDebt, 0);
        if (totalDebt > 0) {
            debtors.push({
                ancestorName,
                totalDebt,
                debtRecordCount: debts.length,
                verified: debts.every(debt => debt.verified),
                sources: [...new Set(debts.map(debt => debt.source))]
            });
        }
    }

    return debtors.sort((a, b) => b.totalDebt - a.totalDebt);
}

/**
 * Get inheritance chains for an ancestor
 */
getInheritanceChains(ancestorName = null) {
    const chains = Array.from(this.inheritanceChains.values());
    
    if (ancestorName) {
        return chains.filter(chain => 
            chain.originalOwner === ancestorName || 
            chain.inheritor === ancestorName
        );
    }
    
    return chains;
}

/**
 * Calculate total system debt across all ancestors
 */
calculateSystemTotalDebt() {
    let totalDebt = 0;
    let totalSlaves = 0;
    let totalDebtors = 0;

    for (const [ancestorName, debts] of this.ancestorDebts) {
        const ancestorTotal = debts.reduce((sum, debt) => sum + debt.calculatedDebt, 0);
        const ancestorSlaves = debts.reduce((sum, debt) => sum + Math.max(0, debt.slaveCount), 0);
        
        if (ancestorTotal > 0) {
            totalDebt += ancestorTotal;
            totalSlaves += ancestorSlaves;
            totalDebtors++;
        }
    }

    return {
        totalDebt,
        totalSlaves,
        totalDebtors,
        averageDebtPerAncestor: totalDebtors > 0 ? totalDebt / totalDebtors : 0,
        averageDebtPerSlave: totalSlaves > 0 ? totalDebt / totalSlaves : 0
    };
}

/**
 * Export all debt data for blockchain submission
 */
exportForBlockchain() {
    const systemStats = this.calculateSystemTotalDebt();
    
    return {
        systemStats,
        debtRecords: this.debtRecords,
        ancestorTotals: Array.from(this.ancestorDebts.entries()).map(([name, debts]) => ({
            ancestorName: name,
            totalDebt: debts.reduce((sum, debt) => sum + debt.calculatedDebt, 0),
            totalSlaves: debts.reduce((sum, debt) => sum + Math.max(0, debt.slaveCount), 0),
            debtBreakdown: debts,
            verified: debts.every(debt => debt.verified)
        })),
        inheritanceChains: Array.from(this.inheritanceChains.values()),
        exportTimestamp: new Date().toISOString()
    };
}

/**
 * Import manual research data (for your family documentation)
 */
importManualResearch(researchData) {
    const { ancestors, inheritanceRecords, documentSources } = researchData;

    // Process each ancestor's documented slaveholding
    ancestors.forEach(ancestor => {
        const { name, records } = ancestor;
        
        records.forEach(record => {
            this.addSlaveownerDebt(
                name,
                record.slaveCount,
                record.source, // 'census', 'will', 'baptismal', etc.
                record.year,
                {
                    document: record.documentReference,
                    location: record.location,
                    details: record.details,
                    researcher: record.researcher || 'Manual entry'
                }
            );
        });
    });

    // Process inheritance records
    if (inheritanceRecords) {
        inheritanceRecords.forEach(inheritance => {
            this.addInheritanceRecord(
                inheritance.originalOwner,
                inheritance.inheritor,
                inheritance.slaveCount,
                inheritance.year,
                inheritance.willDetails
            );
        });
    }

    console.log(`Imported manual research for ${ancestors.length} ancestors`);
    return this.calculateSystemTotalDebt();
}

/**
 * Generate debt report for a specific ancestor
 */
generateAncestorReport(ancestorName) {
    const breakdown = this.getAncestorDebtBreakdown(ancestorName);
    const inheritances = this.getInheritanceChains(ancestorName);
    
    return {
        ancestorName,
        summary: {
            totalDebt: breakdown.totalDebt,
            totalSlaves: breakdown.totalSlaves,
            documentSources: breakdown.sources,
            yearRange: breakdown.yearRange,
            verified: breakdown.debtRecords.every(debt => debt.verified)
        },
        debtRecords: breakdown.debtRecords,
        inheritanceActivity: {
            inherited: inheritances.filter(i => i.inheritor === ancestorName),
            bequeathed: inheritances.filter(i => i.originalOwner === ancestorName)
        },
        reportGenerated: new Date().toISOString()
    };
}

// ========================================================================
// CORPORATE ENTITY DEBT TRACKING
// Added December 18, 2025 for Farmer-Paellmann defendants
// ========================================================================

/**
 * Add debt record for a corporate entity
 *
 * @param {string} entityName - Modern corporate name
 * @param {string} debtType - Type of debt (e.g., 'insurance_premiums', 'slave_trader_loans')
 * @param {Object} calculation - Calculation result from sector-specific calculator
 * @param {Object} source - Reference to financial_instruments or other evidence
 * @returns {string} Debt record ID
 */
addCorporateDebt(entityName, debtType, calculation, source = {}) {
    const debtId = `corp_debt_${this.nextDebtId++}`;

    if (!this.corporateDebts.has(entityName)) {
        this.corporateDebts.set(entityName, []);
    }

    const record = {
        id: debtId,
        entityName,
        debtType,
        calculation,
        historicalValue: calculation.historicalDebt || calculation.historicalPremiums || calculation.historicalValue || 0,
        modernValue: calculation.modernValue || 0,
        methodology: calculation.methodology || '',
        source,
        timestamp: new Date().toISOString(),
        verified: false,
        isCorporate: true
    };

    this.corporateDebts.get(entityName).push(record);
    this.corporateRecords.push(record);

    console.log(`[DebtTracker] Corporate debt added: ${entityName} owes $${(calculation.modernValue || 0).toLocaleString()} (${debtType})`);

    return debtId;
}

/**
 * Get total corporate debt by entity
 *
 * @param {string} entityName - Corporate entity name
 * @returns {Object} Debt summary for entity
 */
getCorporateDebtSummary(entityName) {
    const debts = this.corporateDebts.get(entityName) || [];

    const byType = {};
    for (const debt of debts) {
        byType[debt.debtType] = (byType[debt.debtType] || 0) + debt.modernValue;
    }

    return {
        entityName,
        totalDebt: debts.reduce((sum, d) => sum + d.modernValue, 0),
        debtCount: debts.length,
        byType,
        records: debts
    };
}

/**
 * Get all Farmer-Paellmann defendant debts
 *
 * @returns {Array} Debt summaries for all 17 defendants
 */
getFarmerPaellmannDebts() {
    const defendants = [
        // Banking & Finance
        'Bank of America (FleetBoston successor)',
        'JPMorgan Chase & Co.',
        'Brown Brothers Harriman & Company',
        'Barclays (Lehman successor)',
        // Insurance
        'CVS Health (Aetna successor)',
        'New York Life Insurance Company',
        "Lloyd's of London",
        'Southern Mutual Insurance Company',
        'American International Group (AIG)',
        // Railroads
        'CSX Corporation',
        'Norfolk Southern Corporation',
        'Union Pacific Corporation',
        'Canadian National Railway',
        // Tobacco
        'R.J. Reynolds Tobacco Company',
        'British American Tobacco (Brown & Williamson successor)',
        'Vector Group (Liggett successor)',
        'Loews Corporation'
    ];

    return defendants.map(name => this.getCorporateDebtSummary(name));
}

/**
 * Get all corporate debtors
 *
 * @returns {Array} All corporate entities with debt, sorted by amount
 */
getAllCorporateDebtors() {
    const debtors = [];

    for (const [entityName, debts] of this.corporateDebts) {
        const totalDebt = debts.reduce((sum, d) => sum + d.modernValue, 0);
        if (totalDebt > 0) {
            debtors.push({
                entityName,
                totalDebt,
                debtRecordCount: debts.length,
                debtTypes: [...new Set(debts.map(d => d.debtType))],
                verified: debts.every(d => d.verified),
                isCorporate: true
            });
        }
    }

    return debtors.sort((a, b) => b.totalDebt - a.totalDebt);
}

/**
 * Calculate combined system debt (individuals + corporations)
 *
 * @returns {Object} Combined debt statistics
 */
calculateCombinedSystemDebt() {
    const individualStats = this.calculateSystemTotalDebt();

    let corporateTotal = 0;
    let corporateCount = 0;
    let corporateEnslaved = 0;

    for (const [entityName, debts] of this.corporateDebts) {
        const entityTotal = debts.reduce((sum, d) => sum + d.modernValue, 0);
        if (entityTotal > 0) {
            corporateTotal += entityTotal;
            corporateCount++;
            // Estimate enslaved affected from calculations
            for (const debt of debts) {
                if (debt.calculation) {
                    corporateEnslaved += debt.calculation.estimatedEnslaved ||
                                         debt.calculation.totalEnslaved ||
                                         debt.calculation.enslavedAffected || 0;
                }
            }
        }
    }

    const combinedTotal = individualStats.totalDebt + corporateTotal;

    return {
        individuals: {
            totalDebtors: individualStats.totalDebtors,
            totalDebt: individualStats.totalDebt,
            totalEnslaved: individualStats.totalSlaves
        },
        corporations: {
            totalEntities: corporateCount,
            totalDebt: corporateTotal,
            estimatedEnslaved: corporateEnslaved,
            farmerPaellmannDefendants: 17
        },
        combined: {
            totalDebt: combinedTotal,
            percentageIndividual: combinedTotal > 0 ? (individualStats.totalDebt / combinedTotal) * 100 : 0,
            percentageCorporate: combinedTotal > 0 ? (corporateTotal / combinedTotal) * 100 : 0
        }
    };
}

/**
 * Get combined leaderboard (individuals + corporations)
 *
 * @param {number} limit - Number of top debtors to return
 * @returns {Array} Top debtors across both categories
 */
getCombinedLeaderboard(limit = 50) {
    const individuals = this.getAllDebtors().map(d => ({
        ...d,
        name: d.ancestorName,
        type: 'individual'
    }));

    const corporations = this.getAllCorporateDebtors().map(d => ({
        ...d,
        name: d.entityName,
        type: 'corporate'
    }));

    const combined = [...individuals, ...corporations];
    combined.sort((a, b) => b.totalDebt - a.totalDebt);

    return combined.slice(0, limit);
}

/**
 * Export all debt data including corporate for blockchain
 */
exportForBlockchainWithCorporate() {
    const individualExport = this.exportForBlockchain();
    const corporateStats = this.calculateCombinedSystemDebt();

    return {
        ...individualExport,
        corporateDebts: {
            totalEntities: this.corporateDebts.size,
            totalDebt: corporateStats.corporations.totalDebt,
            entities: Array.from(this.corporateDebts.entries()).map(([name, debts]) => ({
                entityName: name,
                totalDebt: debts.reduce((sum, d) => sum + d.modernValue, 0),
                debtBreakdown: debts
            }))
        },
        combinedStats: corporateStats.combined,
        exportTimestamp: new Date().toISOString()
    };
}

/**
 * Clear all debt records (for testing)
 */
clearAllRecords() {
    this.debtRecords = [];
    this.ancestorDebts.clear();
    this.inheritanceChains.clear();
    this.corporateDebts.clear();
    this.corporateRecords = [];
    this.nextDebtId = 1;
    console.log('All debt records cleared (individual and corporate)');
}

/**
 * Get statistics for monitoring
 */
getSystemStats() {
    return {
        totalRecords: this.debtRecords.length,
        totalAncestors: this.ancestorDebts.size,
        totalInheritances: this.inheritanceChains.size,
        ...this.calculateSystemTotalDebt()
    };
}
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DebtTracker;
} else if (typeof window !== 'undefined') {
    window.DebtTracker = DebtTracker;
}
