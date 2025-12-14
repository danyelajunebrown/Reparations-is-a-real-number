/**
 * Compensation Tracker - Historical Payment Evidence System
 *
 * CRITICAL CONCEPTUAL FRAMEWORK:
 * Compensation payments TO slave owners are NOT credits against reparations debt.
 * They are EVIDENCE that proves:
 *   1. Governments acknowledged enslaved people had monetary value
 *   2. The money was paid to the WRONG PARTY (owners, not enslaved)
 *   3. A debt was recognized - just paid in the wrong direction
 *
 * Historical compensation events:
 *   - British Slavery Abolition Act 1833: £20 million (~£17 billion today)
 *   - DC Compensated Emancipation Act 1862: ~$1 million (~$30 million today)
 *   - Various state-level compensated emancipation schemes
 *
 * These payments INCREASE the documented moral debt because they prove
 * the system valued human beings as property and compensated the "owners"
 * while giving NOTHING to those who were actually harmed.
 *
 * @author Reparations Platform Team
 * @version 1.0.0
 */

class CompensationTracker {
    constructor(db = null) {
        this.db = db;

        // In-memory storage when no database available
        this.compensationRecords = [];
        this.compensationByOwner = new Map();
        this.compensationByRegion = new Map();
        this.nextRecordId = 1;

        // Historical conversion rates to modern USD
        this.conversionRates = {
            // British pounds to modern USD (accounting for inflation + purchasing power)
            'GBP_1833': 850, // £1 in 1833 ≈ $850 today
            'GBP_1834': 850,
            // US dollars to modern USD
            'USD_1862': 30,  // $1 in 1862 ≈ $30 today
            'USD_1865': 25,
            // Default multiplier for unknown years
            'DEFAULT': 50
        };

        // Known compensation programs
        this.compensationPrograms = {
            'british_abolition_1833': {
                name: 'British Slavery Abolition Act',
                year: 1833,
                totalPaid: 20000000, // £20 million
                currency: 'GBP',
                region: 'British Empire',
                description: 'Compensation paid to slave owners upon abolition of slavery in British colonies',
                modernValue: 17000000000, // ~£17 billion / ~$20 billion
                enslavedCount: 800000, // Approximately 800,000 enslaved people
                paidToEnslaved: 0, // ZERO paid to the enslaved
                notes: 'The British government took out a loan to pay this compensation. The loan was not fully paid off until 2015 - meaning British taxpayers (including descendants of the enslaved) paid for slaveholder compensation for 182 years.'
            },
            'dc_compensated_emancipation_1862': {
                name: 'DC Compensated Emancipation Act',
                year: 1862,
                totalPaid: 1000000, // ~$1 million
                currency: 'USD',
                region: 'Washington DC',
                description: 'Federal government paid DC slave owners up to $300 per enslaved person',
                modernValue: 30000000, // ~$30 million today
                enslavedCount: 3100, // About 3,100 enslaved people freed
                paidToEnslaved: 0, // ZERO paid to the enslaved (some received $100 for emigration)
                averagePerPerson: 300,
                notes: 'Only compensated emancipation in US. Owners received ~$300/person. Enslaved received nothing except optional $100 emigration payment.'
            }
        };
    }

    /**
     * Record a compensation payment that was made TO an owner
     * This creates EVIDENCE of debt, not a credit against it
     *
     * @param {Object} payment - Payment details
     * @returns {Object} Record with debt implications
     */
    recordCompensationPayment(payment) {
        const recordId = `comp_${this.nextRecordId++}`;

        const {
            ownerName,
            ownerId,           // Reference to british_slave_owners or individuals table
            enslavedCount,
            amountPaid,
            currency,
            year,
            program,           // e.g., 'british_abolition_1833', 'dc_compensated_emancipation_1862'
            region,
            claimNumber,       // Official claim reference
            sourceDocument,
            enslavedPersons,   // Array of names if known
            notes
        } = payment;

        // Calculate modern value
        const conversionKey = `${currency}_${year}`;
        const conversionRate = this.conversionRates[conversionKey] || this.conversionRates.DEFAULT;
        const modernValue = amountPaid * conversionRate;

        // Calculate implied value per enslaved person
        const valuePerPerson = enslavedCount > 0 ? amountPaid / enslavedCount : 0;
        const modernValuePerPerson = enslavedCount > 0 ? modernValue / enslavedCount : 0;

        const record = {
            id: recordId,

            // Payment recipient (the owner who was compensated)
            ownerName,
            ownerId,

            // What they were compensated for
            enslavedCount,
            enslavedPersons: enslavedPersons || [],

            // Payment details
            amountPaid,
            currency,
            year,
            program,
            region,
            claimNumber,

            // Modern equivalents
            modernValue,
            valuePerPerson,
            modernValuePerPerson,
            conversionRate,

            // Debt evidence implications
            debtEvidence: {
                // This payment PROVES the following debt exists:
                provenDebt: modernValue,
                // Because: Owner was paid X, but enslaved person received 0
                // The enslaved person is owed at LEAST what the owner received
                minimumOwedToEnslaved: modernValue,
                // Plus additional damages for the violation itself
                additionalDamages: this.calculateAdditionalDamages(enslavedCount, year),
                // Total debt this payment proves
                totalProvenDebt: modernValue + this.calculateAdditionalDamages(enslavedCount, year),

                explanation: `Owner ${ownerName} received ${currency} ${amountPaid.toLocaleString()} ` +
                           `(${modernValue.toLocaleString()} modern USD) for ${enslavedCount} enslaved people. ` +
                           `The enslaved received $0. This payment proves a minimum debt of ` +
                           `${modernValue.toLocaleString()} modern USD owed to their descendants.`
            },

            // Source documentation
            sourceDocument,
            notes,

            // Metadata
            recordedAt: new Date().toISOString(),
            verified: false
        };

        // Store in memory
        this.compensationRecords.push(record);

        // Index by owner
        if (!this.compensationByOwner.has(ownerName)) {
            this.compensationByOwner.set(ownerName, []);
        }
        this.compensationByOwner.get(ownerName).push(record);

        // Index by region
        if (!this.compensationByRegion.has(region)) {
            this.compensationByRegion.set(region, []);
        }
        this.compensationByRegion.get(region).push(record);

        console.log(`[CompensationTracker] Recorded: ${ownerName} received ${currency} ${amountPaid.toLocaleString()} for ${enslavedCount} enslaved people`);
        console.log(`[CompensationTracker] This PROVES minimum debt of $${modernValue.toLocaleString()} owed to descendants`);

        return record;
    }

    /**
     * Calculate additional damages beyond the compensation amount
     * The compensation only represents "property value" - not human dignity
     */
    calculateAdditionalDamages(enslavedCount, year) {
        const currentYear = new Date().getFullYear();
        const yearsOfDelay = currentYear - year;

        // Base damages for human dignity violation
        const dignityDamagesPerPerson = 50000; // Conservative base

        // Compound factor for delayed justice (2% per year)
        const delayMultiplier = Math.pow(1.02, yearsOfDelay);

        return Math.round(enslavedCount * dignityDamagesPerPerson * delayMultiplier);
    }

    /**
     * Save compensation record to database
     */
    async saveToDatabase(record) {
        if (!this.db) return null;

        try {
            // First, try to find or create the colony
            let colonyId = null;
            if (record.region) {
                const colonyResult = await this.db.query(`
                    SELECT id FROM british_colonies WHERE name ILIKE $1 OR modern_country ILIKE $1
                    LIMIT 1
                `, [record.region]);
                colonyId = colonyResult.rows[0]?.id;
            }

            // Insert into compensation_claims table (from migration 009)
            const result = await this.db.query(`
                INSERT INTO compensation_claims (
                    claim_number,
                    colony_id,
                    claimant_name,
                    claimant_role,
                    enslaved_count,
                    original_claim_amount,
                    awarded_amount,
                    claim_status,
                    award_date,
                    modern_value_estimate,
                    lbs_claim_id,
                    lbs_url,
                    notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (claim_number) DO UPDATE SET
                    awarded_amount = EXCLUDED.awarded_amount,
                    modern_value_estimate = EXCLUDED.modern_value_estimate
                RETURNING id
            `, [
                record.claimNumber || record.id,
                colonyId,
                record.ownerName,
                record.claimantRole || 'owner',
                record.enslavedCount,
                record.amountPaid,
                record.amountPaid,
                'awarded',
                record.year ? `${record.year}-01-01` : null,
                record.modernValue,
                record.lbsClaimId || null,
                record.sourceDocument || null,
                record.notes || record.debtEvidence?.explanation
            ]);

            const claimId = result.rows[0]?.id;

            // Also insert into british_slave_owners if this is a British claim
            if (record.program === 'british_abolition_1833' && record.ownerName) {
                await this.db.query(`
                    INSERT INTO british_slave_owners (
                        full_name,
                        total_enslaved_owned,
                        total_compensation_received,
                        lbs_person_id,
                        lbs_url,
                        notes
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (full_name) DO UPDATE SET
                        total_enslaved_owned = COALESCE(british_slave_owners.total_enslaved_owned, 0) + EXCLUDED.total_enslaved_owned,
                        total_compensation_received = COALESCE(british_slave_owners.total_compensation_received, 0) + EXCLUDED.total_compensation_received
                `, [
                    record.ownerName,
                    record.enslavedCount,
                    record.amountPaid,
                    record.ownerId || null,
                    record.sourceDocument || null,
                    `Compensation recorded: ${record.currency} ${record.amountPaid}`
                ]).catch(() => {}); // Ignore conflicts
            }

            console.log(`[CompensationTracker] Saved to database: claim ID ${claimId}`);
            return claimId;
        } catch (error) {
            console.error('[CompensationTracker] Database save error:', error.message);
            return null;
        }
    }

    /**
     * Load compensation records from database
     */
    async loadFromDatabase(options = {}) {
        if (!this.db) return [];

        try {
            const { limit = 1000, colony = null, minAmount = 0 } = options;

            let query = `
                SELECT
                    cc.id,
                    cc.claim_number,
                    cc.claimant_name,
                    cc.claimant_role,
                    cc.enslaved_count,
                    cc.awarded_amount,
                    cc.modern_value_estimate,
                    cc.award_date,
                    cc.lbs_claim_id,
                    cc.lbs_url,
                    cc.notes,
                    bc.name as colony_name,
                    bc.region
                FROM compensation_claims cc
                LEFT JOIN british_colonies bc ON cc.colony_id = bc.id
                WHERE cc.awarded_amount >= $1
            `;
            const params = [minAmount];

            if (colony) {
                query += ` AND (bc.name ILIKE $2 OR bc.region ILIKE $2)`;
                params.push(`%${colony}%`);
            }

            query += ` ORDER BY cc.awarded_amount DESC LIMIT $${params.length + 1}`;
            params.push(limit);

            const result = await this.db.query(query, params);

            // Import each record into memory
            for (const row of result.rows) {
                const record = this.importBritishCompensationClaim({
                    claimNumber: row.claim_number,
                    claimantName: row.claimant_name,
                    claimantRole: row.claimant_role,
                    enslavedCount: row.enslaved_count,
                    awardedAmount: parseFloat(row.awarded_amount) || 0,
                    colony: row.colony_name,
                    region: row.region,
                    lbsClaimId: row.lbs_claim_id,
                    lbsUrl: row.lbs_url,
                    notes: row.notes
                });
                record.dbId = row.id;
            }

            console.log(`[CompensationTracker] Loaded ${result.rows.length} records from database`);
            return result.rows;
        } catch (error) {
            console.error('[CompensationTracker] Database load error:', error.message);
            return [];
        }
    }

    /**
     * Get compensation statistics from database
     */
    async getDatabaseStatistics() {
        if (!this.db) return null;

        try {
            const stats = await this.db.query(`
                SELECT
                    COUNT(*) as total_claims,
                    SUM(enslaved_count) as total_enslaved,
                    SUM(awarded_amount) as total_awarded,
                    SUM(modern_value_estimate) as total_modern_value,
                    AVG(awarded_amount) as avg_per_claim,
                    AVG(awarded_amount / NULLIF(enslaved_count, 0)) as avg_per_enslaved
                FROM compensation_claims
                WHERE awarded_amount > 0
            `);

            const byColony = await this.db.query(`
                SELECT
                    bc.name as colony,
                    bc.region,
                    COUNT(*) as claims,
                    SUM(cc.enslaved_count) as enslaved,
                    SUM(cc.awarded_amount) as total_awarded
                FROM compensation_claims cc
                JOIN british_colonies bc ON cc.colony_id = bc.id
                GROUP BY bc.id, bc.name, bc.region
                ORDER BY total_awarded DESC
            `);

            const topOwners = await this.db.query(`
                SELECT
                    full_name,
                    title,
                    total_enslaved_owned,
                    total_compensation_received,
                    member_of_parliament
                FROM british_slave_owners
                WHERE total_compensation_received > 0
                ORDER BY total_compensation_received DESC
                LIMIT 20
            `);

            return {
                summary: stats.rows[0],
                byColony: byColony.rows,
                topOwners: topOwners.rows,
                queriedAt: new Date().toISOString()
            };
        } catch (error) {
            console.error('[CompensationTracker] Statistics query error:', error.message);
            return null;
        }
    }

    /**
     * Sync in-memory records to database
     */
    async syncToDatabase() {
        if (!this.db) {
            console.log('[CompensationTracker] No database connection, skipping sync');
            return { synced: 0, errors: 0 };
        }

        let synced = 0;
        let errors = 0;

        for (const record of this.compensationRecords) {
            try {
                const dbId = await this.saveToDatabase(record);
                if (dbId) {
                    record.dbId = dbId;
                    synced++;
                }
            } catch (error) {
                errors++;
            }
        }

        console.log(`[CompensationTracker] Synced ${synced} records, ${errors} errors`);
        return { synced, errors };
    }

    /**
     * Import British compensation claims from UCL LBS data
     * Accepts both snake_case (from DB) and camelCase (from JS) property names
     */
    importBritishCompensationClaim(lbsClaim) {
        const payment = {
            ownerName: lbsClaim.claimant_name || lbsClaim.claimantName || lbsClaim.ownerName || lbsClaim.name,
            ownerId: lbsClaim.lbs_person_id || lbsClaim.lbsPersonId,
            enslavedCount: lbsClaim.enslaved_count || lbsClaim.enslavedCount || 0,
            amountPaid: lbsClaim.awarded_amount || lbsClaim.awardedAmount || lbsClaim.compensationReceived || 0,
            currency: 'GBP',
            year: lbsClaim.year || 1834, // Most British compensation paid 1834-1840
            program: 'british_abolition_1833',
            region: lbsClaim.colony || lbsClaim.region || 'British Caribbean',
            claimNumber: lbsClaim.claim_number || lbsClaim.claimNumber,
            sourceDocument: lbsClaim.lbs_url || lbsClaim.lbsUrl || 'UCL Legacies of British Slavery Database',
            notes: lbsClaim.notes
        };

        return this.recordCompensationPayment(payment);
    }

    /**
     * Import DC Compensated Emancipation claim
     * Accepts both snake_case (from DB) and camelCase (from JS) property names
     */
    importDCEmancipationClaim(dcClaim) {
        const payment = {
            ownerName: dcClaim.owner_name || dcClaim.ownerName,
            enslavedCount: dcClaim.enslaved_count || dcClaim.enslavedCount || 1,
            amountPaid: dcClaim.amount_paid || dcClaim.amountPaid || dcClaim.compensationReceived || 300,
            currency: 'USD',
            year: dcClaim.year || 1862,
            program: 'dc_compensated_emancipation_1862',
            region: 'Washington DC',
            claimNumber: dcClaim.petition_number || dcClaim.petitionNumber,
            sourceDocument: dcClaim.source_url || dcClaim.sourceUrl || 'National Archives RG 217',
            enslavedPersons: dcClaim.enslaved_names || dcClaim.enslavedNames || [],
            notes: dcClaim.notes
        };

        return this.recordCompensationPayment(payment);
    }

    /**
     * Get total compensation evidence for a specific owner
     */
    getOwnerCompensationEvidence(ownerName) {
        const records = this.compensationByOwner.get(ownerName) || [];

        if (records.length === 0) {
            return {
                ownerName,
                found: false,
                message: 'No compensation records found for this owner'
            };
        }

        const totals = records.reduce((acc, record) => {
            acc.totalReceived += record.modernValue;
            acc.totalEnslaved += record.enslavedCount;
            acc.provenDebt += record.debtEvidence.totalProvenDebt;
            return acc;
        }, { totalReceived: 0, totalEnslaved: 0, provenDebt: 0 });

        return {
            ownerName,
            found: true,
            recordCount: records.length,
            ...totals,
            records,
            summary: `${ownerName} received compensation for ${totals.totalEnslaved} enslaved people. ` +
                    `Modern value: $${totals.totalReceived.toLocaleString()}. ` +
                    `This proves minimum reparations debt of $${totals.provenDebt.toLocaleString()}.`
        };
    }

    /**
     * Get compensation statistics by program
     */
    getProgramStatistics(programKey) {
        const program = this.compensationPrograms[programKey];
        if (!program) {
            return { error: 'Unknown program' };
        }

        const relatedRecords = this.compensationRecords.filter(r => r.program === programKey);

        return {
            program: program.name,
            year: program.year,
            historicalTotal: {
                amount: program.totalPaid,
                currency: program.currency
            },
            modernValueTotal: program.modernValue,
            enslavedCount: program.enslavedCount,
            averagePerPerson: program.totalPaid / program.enslavedCount,
            paidToEnslaved: program.paidToEnslaved,

            // The key insight
            injustice: {
                paidToOwners: program.modernValue,
                paidToEnslaved: 0,
                debtOweToDescendants: program.modernValue,
                perPersonDebt: program.modernValue / program.enslavedCount
            },

            // Records we have documented
            documentedRecords: relatedRecords.length,
            documentedTotal: relatedRecords.reduce((sum, r) => sum + r.modernValue, 0),

            notes: program.notes
        };
    }

    /**
     * Calculate system-wide compensation evidence totals
     */
    getSystemTotals() {
        const totals = {
            totalRecords: this.compensationRecords.length,
            totalPaidToOwners: 0,
            totalEnslavedAffected: 0,
            totalProvenDebt: 0,
            byProgram: {},
            byRegion: {}
        };

        for (const record of this.compensationRecords) {
            totals.totalPaidToOwners += record.modernValue;
            totals.totalEnslavedAffected += record.enslavedCount;
            totals.totalProvenDebt += record.debtEvidence.totalProvenDebt;

            // By program
            if (!totals.byProgram[record.program]) {
                totals.byProgram[record.program] = { count: 0, value: 0, enslaved: 0 };
            }
            totals.byProgram[record.program].count++;
            totals.byProgram[record.program].value += record.modernValue;
            totals.byProgram[record.program].enslaved += record.enslavedCount;

            // By region
            if (!totals.byRegion[record.region]) {
                totals.byRegion[record.region] = { count: 0, value: 0, enslaved: 0 };
            }
            totals.byRegion[record.region].count++;
            totals.byRegion[record.region].value += record.modernValue;
            totals.byRegion[record.region].enslaved += record.enslavedCount;
        }

        return totals;
    }

    /**
     * Export compensation data for blockchain/ledger integration
     * NOTE: These are EVIDENCE records, not payment credits
     */
    exportForBlockchain() {
        return {
            recordType: 'COMPENSATION_EVIDENCE',
            description: 'Historical payments TO slave owners - proves debt owed TO descendants',

            // Clear labeling that this is evidence, not credits
            isCredit: false,
            isEvidence: true,

            records: this.compensationRecords.map(record => ({
                id: record.id,
                type: 'OWNER_COMPENSATION',
                recipient: record.ownerName,
                recipientRole: 'slave_owner',
                amount: record.amountPaid,
                currency: record.currency,
                year: record.year,
                modernValue: record.modernValue,
                enslavedCount: record.enslavedCount,
                provenDebt: record.debtEvidence.totalProvenDebt,

                // Critical: This payment proves debt, doesn't reduce it
                debtImplication: 'INCREASES_PROVEN_DEBT',
                minimumOwedToDescendants: record.debtEvidence.minimumOwedToEnslaved
            })),

            systemTotals: this.getSystemTotals(),

            exportTimestamp: new Date().toISOString(),

            legalNote: 'These records document historical compensation paid to slave owners. ' +
                      'They serve as legal evidence that governments acknowledged the monetary value ' +
                      'of enslaved labor and paid the wrong party. The enslaved and their descendants ' +
                      'are owed AT MINIMUM what was paid to the owners, plus damages for human rights violations.'
        };
    }

    /**
     * Generate report comparing what owners received vs what enslaved are owed
     */
    generateInjusticeReport() {
        const totals = this.getSystemTotals();

        return `
================================================================================
              COMPENSATION INJUSTICE REPORT
              Evidence of Debt Owed to Descendants
================================================================================

HISTORICAL COMPENSATION TO SLAVE OWNERS:
----------------------------------------
Total Records:           ${totals.totalRecords.toLocaleString()}
Total Paid to Owners:    $${totals.totalPaidToOwners.toLocaleString()} (modern value)
Enslaved People Affected: ${totals.totalEnslavedAffected.toLocaleString()}

WHAT THE ENSLAVED RECEIVED:
--------------------------
Total Paid to Enslaved:  $0

THE INJUSTICE GAP:
-----------------
Money given to owners:   $${totals.totalPaidToOwners.toLocaleString()}
Money given to enslaved: $0
Gap:                     $${totals.totalPaidToOwners.toLocaleString()}

MINIMUM PROVEN DEBT:
-------------------
(Compensation + Damages for delayed justice)
Total Proven Debt:       $${totals.totalProvenDebt.toLocaleString()}
Per Person Affected:     $${Math.round(totals.totalProvenDebt / (totals.totalEnslavedAffected || 1)).toLocaleString()}

BY PROGRAM:
----------
${Object.entries(totals.byProgram).map(([program, data]) =>
    `${program}: ${data.count} claims, $${data.value.toLocaleString()}, ${data.enslaved} enslaved`
).join('\n')}

BY REGION:
---------
${Object.entries(totals.byRegion).map(([region, data]) =>
    `${region}: ${data.count} claims, $${data.value.toLocaleString()}, ${data.enslaved} enslaved`
).join('\n')}

================================================================================
NOTE: This compensation data PROVES debt exists. It does NOT reduce what is owed.
      The enslaved and their descendants are owed what was stolen from them,
      plus compound interest for 150+ years of delayed justice.
================================================================================
        `.trim();
    }

    /**
     * Link compensation record to debt tracker
     * When a compensation payment is found, it creates evidence in the debt system
     */
    linkToDebtTracker(debtTracker, record) {
        if (!debtTracker) return null;

        // The compensation proves the owner had enslaved people
        // This should CREATE or CONFIRM debt records, not reduce them

        const debtId = debtTracker.addSlaveownerDebt(
            record.ownerName,
            record.enslavedCount,
            'compensation_record', // Source type
            record.year,
            {
                compensationReceived: record.amountPaid,
                currency: record.currency,
                program: record.program,
                claimNumber: record.claimNumber,
                sourceDocument: record.sourceDocument,
                note: 'Debt confirmed by compensation record - owner was paid, enslaved received nothing'
            }
        );

        console.log(`[CompensationTracker] Linked to DebtTracker: ${record.ownerName} - debt ID ${debtId}`);

        return debtId;
    }

    /**
     * Clear all records (for testing)
     */
    clearRecords() {
        this.compensationRecords = [];
        this.compensationByOwner.clear();
        this.compensationByRegion.clear();
        this.nextRecordId = 1;
        console.log('[CompensationTracker] All records cleared');
    }
}

// Export for Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CompensationTracker;
} else if (typeof window !== 'undefined') {
    window.CompensationTracker = CompensationTracker;
}
