/**

- Debt Tracking System for Reparations
- Handles ancestor debt assignment, inheritance chains, and descendant liability
  */

class DebtTracker {
constructor() {
this.debtRecords = [];
this.ancestorDebts = new Map();
this.inheritanceChains = new Map();
this.nextDebtId = 1;
}

```
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

/**
 * Clear all debt records (for testing)
 */
clearAllRecords() {
    this.debtRecords = [];
    this.ancestorDebts.clear();
    this.inheritanceChains.clear();
    this.nextDebtId = 1;
    console.log('All debt records cleared');
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
```

}

// Export for different environments
if (typeof module !== ‘undefined’ && module.exports) {
module.exports = DebtTracker;
} else if (typeof window !== ‘undefined’) {
window.DebtTracker = DebtTracker;
}
