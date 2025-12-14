/**
 * Petition Tracker - Historical Reparations Petitions System
 *
 * CRITICAL CONCEPTUAL FRAMEWORK:
 * This tracker monitors PETITIONS for reparations and compares what was
 * AWARDED vs what was actually PAID. The gap between promise and payment
 * reveals systemic failure and creates additional debt (broken promise penalty).
 *
 * KEY DISTINCTION FROM CompensationTracker:
 * - CompensationTracker: Tracks payments TO owners (wrong party paid)
 * - PetitionTracker: Tracks payments TO enslaved (promises broken)
 *
 * Both INCREASE debt owed to descendants, but for different reasons:
 * - Compensation TO owners proves debt exists (minimum owed)
 * - Broken promises TO enslaved compound the injury (additional penalty)
 *
 * EXAMPLE CASE: Belinda Sutton (1783)
 * - Petition filed: Feb 14, 1783
 * - Award granted: £15 annually + £12 back payment
 * - Payments made: Only 2 (£27 total = 23% of expected)
 * - Status: BROKEN PROMISE
 * - Additional debt: £90 unpaid + penalty for breach of trust
 *
 * @author Reparations Platform Team
 * @version 1.0.0
 */

class PetitionTracker {
    constructor(db = null) {
        this.db = db;

        // In-memory storage when no database available
        this.petitions = [];
        this.payments = [];
        this.fulfillmentAnalyses = [];
        this.nextPetitionId = 1;

        // Historical currency conversion rates to modern USD
        this.conversionRates = {
            'GBP_1783': 850,  // £1 in 1783 ≈ $850 today
            'GBP_1784': 850,
            'GBP_1787': 850,
            'GBP_1790': 850,
            'USD_1783': 40,   // $1 in 1783 ≈ $40 today
            'USD_1862': 30,
            'DEFAULT': 50
        };

        // Broken promise penalty rates
        this.penaltyRate = 0.50; // 50% penalty on unpaid amounts
        this.interestRate = 0.02; // 2% annual compound interest on unpaid
    }

    /**
     * Record a reparations petition
     * This tracks the REQUEST for reparations and governmental response
     */
    async recordPetition(petitionData) {
        const {
            petitionerName,
            petitionerEnslavedId,
            petitionerRelationship = 'self',
            
            enslaverName,
            enslaverIndividualId,
            
            petitionDate,
            petitionNumber,
            petitionTitle,
            petitionSummary,
            petitionFullText,
            
            amountRequested,
            currency = 'USD',
            requestType = 'annual_pension',
            yearsOfService,
            
            petitionedAuthority,
            jurisdiction,
            caseReference,
            
            petitionStatus = 'pending',
            decisionDate,
            decisionText,
            
            amountAwarded,
            awardedCurrency,
            awardTerms,
            awardDuration,
            awardConditions,
            
            primarySourceUrl,
            archiveSource,
            archiveReference,
            documentPath,
            
            notes
        } = petitionData;

        // Calculate modern values
        const conversionKey = `${currency}_${new Date(petitionDate).getFullYear()}`;
        const conversionRate = this.conversionRates[conversionKey] || this.conversionRates.DEFAULT;
        
        const modernValueRequested = amountRequested ? amountRequested * conversionRate : null;
        const modernValueAwarded = amountAwarded ? amountAwarded * conversionRate : null;

        const petition = {
            id: this.nextPetitionId++,
            
            petitionerName,
            petitionerEnslavedId,
            petitionerRelationship,
            
            enslaverName,
            enslaverIndividualId,
            
            petitionDate,
            petitionNumber,
            petitionTitle,
            petitionSummary,
            petitionFullText,
            
            amountRequested,
            currency,
            requestType,
            yearsOfService,
            
            petitionedAuthority,
            jurisdiction,
            caseReference,
            
            petitionStatus,
            decisionDate,
            decisionText,
            
            amountAwarded,
            awardedCurrency: awardedCurrency || currency,
            awardTerms,
            awardDuration,
            awardConditions,
            
            modernValueRequested,
            modernValueAwarded,
            
            primarySourceUrl,
            archiveSource,
            archiveReference,
            documentPath,
            
            verified: false,
            notes,
            
            createdAt: new Date().toISOString()
        };

        // Store in memory
        this.petitions.push(petition);

        console.log(`[PetitionTracker] Recorded petition by ${petitionerName} against ${enslaverName}`);
        console.log(`[PetitionTracker] Status: ${petitionStatus} | Awarded: ${awardedCurrency || currency} ${amountAwarded || 'N/A'}`);

        // Save to database if available
        if (this.db) {
            const dbId = await this.savePetitionToDatabase(petition);
            petition.dbId = dbId;
        }

        return petition;
    }

    /**
     * Record a payment made (or partially made) on a petition
     */
    async recordPayment(paymentData) {
        const {
            petitionId,
            recipientName,
            recipientEnslavedId,
            
            paymentAmount,
            currency,
            paymentDate,
            paymentYear,
            
            paymentMethod,
            paymentRecordReference,
            paymentSource,
            
            paymentVerified = false,
            verificationSource,
            documentProofUrl,
            
            paymentType = 'installment',
            amountDue,
            
            notes
        } = paymentData;

        // Calculate modern value
        const year = paymentYear || new Date(paymentDate).getFullYear();
        const conversionKey = `${currency}_${year}`;
        const conversionRate = this.conversionRates[conversionKey] || this.conversionRates.DEFAULT;
        const modernValueEstimate = paymentAmount * conversionRate;

        // Calculate shortfall if amount due provided
        const shortfall = amountDue ? amountDue - paymentAmount : null;

        const payment = {
            id: this.payments.length + 1,
            petitionId,
            
            recipientName,
            recipientEnslavedId,
            
            paymentAmount,
            currency,
            paymentDate,
            paymentYear: year,
            
            modernValueEstimate,
            conversionRate,
            
            paymentMethod,
            paymentRecordReference,
            paymentSource,
            
            paymentVerified,
            verificationSource,
            documentProofUrl,
            
            paymentType,
            amountDue,
            shortfall,
            
            notes,
            createdAt: new Date().toISOString()
        };

        this.payments.push(payment);

        console.log(`[PetitionTracker] Recorded payment: ${currency} ${paymentAmount} to ${recipientName}`);

        // Save to database and trigger fulfillment analysis update
        if (this.db) {
            await this.savePaymentToDatabase(payment);
            // Database trigger will auto-update fulfillment analysis
        } else {
            // Manual fulfillment calculation if no database
            this.calculateFulfillment(petitionId);
        }

        return payment;
    }

    /**
     * Calculate fulfillment analysis for a petition
     * Compares promised payments vs actual payments
     */
    calculateFulfillment(petitionId) {
        const petition = this.petitions.find(p => p.id === petitionId);
        if (!petition) {
            console.error(`[PetitionTracker] Petition ${petitionId} not found`);
            return null;
        }

        const petitionPayments = this.payments.filter(p => p.petitionId === petitionId);
        
        // Calculate totals from payments
        const totalPaid = petitionPayments.reduce((sum, p) => sum + p.paymentAmount, 0);
        const paymentCount = petitionPayments.length;
        const firstPayment = petitionPayments.length > 0 
            ? petitionPayments.sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate))[0].paymentDate
            : null;
        const lastPayment = petitionPayments.length > 0
            ? petitionPayments.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0].paymentDate
            : null;

        // Estimate expected payments based on award duration
        let expectedCount = 0;
        let expectedTotal = 0;

        if (petition.awardDuration === 'lifetime') {
            // Estimate ~7 years average after petition
            expectedCount = 7;
            expectedTotal = (petition.amountAwarded || 0) * expectedCount;
        } else if (petition.awardDuration === 'one_time') {
            expectedCount = 1;
            expectedTotal = petition.amountAwarded || 0;
        } else if (petition.awardDuration && petition.awardDuration.includes('year')) {
            // Parse "10 years" format
            const years = parseInt(petition.awardDuration);
            expectedCount = years || 10;
            expectedTotal = (petition.amountAwarded || 0) * expectedCount;
        } else {
            // Default assumption
            expectedCount = 10;
            expectedTotal = (petition.amountAwarded || 0) * expectedCount;
        }

        // Calculate fulfillment percentage
        const fulfillmentPercentage = expectedTotal > 0 
            ? (totalPaid / expectedTotal) * 100 
            : 0;

        // Determine status
        let fulfillmentStatus;
        if (fulfillmentPercentage >= 95) {
            fulfillmentStatus = 'fully_paid';
        } else if (fulfillmentPercentage > 0 && paymentCount > 0) {
            // Check if payments stopped early
            if (lastPayment) {
                const stopDate = new Date(lastPayment);
                const petDate = new Date(petition.petitionDate);
                const yearsActive = (stopDate - petDate) / (365 * 24 * 60 * 60 * 1000);
                
                if (yearsActive < 3) {
                    fulfillmentStatus = 'payments_stopped';
                } else {
                    fulfillmentStatus = 'partially_paid';
                }
            } else {
                fulfillmentStatus = 'partially_paid';
            }
        } else if (petition.petitionStatus === 'granted') {
            fulfillmentStatus = 'never_paid';
        } else {
            fulfillmentStatus = 'abandoned';
        }

        // Calculate unpaid amount and modern value
        const amountUnpaid = expectedTotal - totalPaid;
        const conversionKey = `${petition.awardedCurrency || petition.currency}_${new Date(petition.petitionDate).getFullYear()}`;
        const conversionRate = this.conversionRates[conversionKey] || this.conversionRates.DEFAULT;
        const unpaidModernValue = amountUnpaid * conversionRate;
        const paidModernValue = totalPaid * conversionRate;

        // Calculate broken promise penalty
        const brokenPromisePenalty = unpaidModernValue * this.penaltyRate;

        // Calculate compound interest on unpaid amount
        const currentYear = new Date().getFullYear();
        const petitionYear = new Date(petition.petitionDate).getFullYear();
        const yearsDelayed = currentYear - petitionYear;
        const compoundInterest = unpaidModernValue * Math.pow(1 + this.interestRate, yearsDelayed) - unpaidModernValue;

        const totalAdditionalDebt = unpaidModernValue + brokenPromisePenalty + compoundInterest;

        const analysis = {
            petitionId,
            
            totalAmountAwarded: petition.amountAwarded,
            awardedCurrency: petition.awardedCurrency || petition.currency,
            awardDurationYears: expectedCount,
            expectedPaymentCount: expectedCount,
            expectedTotalPayments: expectedTotal,
            
            totalAmountPaid: totalPaid,
            paymentCount,
            firstPaymentDate: firstPayment,
            lastPaymentDate: lastPayment,
            
            amountUnpaid,
            fulfillmentPercentage: Math.round(fulfillmentPercentage * 100) / 100,
            paymentsMissed: expectedCount - paymentCount,
            
            unpaidModernValue,
            paidModernValue,
            
            fulfillmentStatus,
            failureReason: this.determineFailureReason(petition, petitionPayments),
            
            brokenPromisePenalty,
            compoundInterestOwed: compoundInterest,
            totalAdditionalDebt,
            
            calculatedAt: new Date().toISOString()
        };

        // Store or update
        const existingIndex = this.fulfillmentAnalyses.findIndex(a => a.petitionId === petitionId);
        if (existingIndex >= 0) {
            this.fulfillmentAnalyses[existingIndex] = analysis;
        } else {
            this.fulfillmentAnalyses.push(analysis);
        }

        return analysis;
    }

    /**
     * Determine why payments failed or stopped
     */
    determineFailureReason(petition, payments) {
        if (payments.length === 0) {
            return 'No payments ever made despite award being granted';
        }

        if (payments.length < 3) {
            return 'Payments stopped after only ' + payments.length + ' installment(s). Likely estate depleted or petitioner abandoned.';
        }

        const lastPayment = payments.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0];
        const lastDate = new Date(lastPayment.paymentDate);
        const currentYear = new Date().getFullYear();
        const lastPaymentYear = lastDate.getFullYear();

        if (currentYear - lastPaymentYear > 100) {
            return `Payments ceased in ${lastPaymentYear}. Historical record suggests systematic abandonment.`;
        }

        return 'Payments incomplete. Further investigation needed.';
    }

    /**
     * Import Belinda Sutton's case (example)
     */
    async importBelindaSuttonCase() {
        console.log('[PetitionTracker] Importing Belinda Sutton case...');

        // 1. Main petition (Feb 14, 1783)
        const petition = await this.recordPetition({
            petitionerName: 'Belinda Sutton (Belinda Royall)',
            petitionerRelationship: 'self',
            
            enslaverName: 'Isaac Royall Jr.',
            
            petitionDate: '1783-02-14',
            petitionTitle: "Belinda's Petition to the Massachusetts General Court",
            petitionSummary: 'Petition for support from confiscated Loyalist estate after 50 years enslavement',
            petitionFullText: null, // Will be populated from OCR
            
            amountRequested: 15, // £15 annually
            currency: 'GBP',
            requestType: 'annual_pension',
            yearsOfService: 50,
            
            petitionedAuthority: 'Massachusetts General Court',
            jurisdiction: 'Massachusetts',
            
            petitionStatus: 'granted',
            decisionDate: '1783-02-14',
            decisionText: 'Petition granted. £15 annually plus £12 back payment from Isaac Royall confiscated estate.',
            
            amountAwarded: 15,
            awardedCurrency: 'GBP',
            awardTerms: '£15 annually from Isaac Royall confiscated estate, plus £12 immediate back payment',
            awardDuration: 'lifetime',
            
            primarySourceUrl: 'https://royallhouse.org/wp-content/uploads/2013/11/Belindas_Petition.pdf',
            archiveSource: 'Massachusetts State Archives',
            archiveReference: 'SC1/series 45X, vol. 137, p. 285',
            documentPath: 'multi-purpose-evidence/belinda-sutton-case/',
            
            notes: 'First successful reparations petition in America. Payments stopped after only 2 installments despite lifetime award. Case documented by Royall House Museum.'
        });

        // 2. First payment (back payment)
        await this.recordPayment({
            petitionId: petition.id,
            recipientName: 'Belinda Sutton',
            
            paymentAmount: 12,
            currency: 'GBP',
            paymentDate: '1783-03-01',
            paymentYear: 1783,
            
            paymentMethod: 'treasury_warrant',
            paymentSource: 'Isaac Royall Estate',
            
            paymentVerified: true,
            paymentType: 'back_payment',
            amountDue: 12,
            
            notes: 'Initial back payment from confiscated Royall estate'
        });

        // 3. Second payment (first annual)
        await this.recordPayment({
            petitionId: petition.id,
            recipientName: 'Belinda Sutton',
            
            paymentAmount: 15,
            currency: 'GBP',
            paymentDate: '1784-03-01',
            paymentYear: 1784,
            
            paymentMethod: 'treasury_warrant',
            paymentSource: 'Isaac Royall Estate',
            
            paymentVerified: true,
            paymentType: 'installment',
            amountDue: 15,
            
            notes: 'First (and possibly only) annual pension payment. Estate depleted afterward.'
        });

        // Calculate fulfillment
        const analysis = this.calculateFulfillment(petition.id);

        console.log('\n[PetitionTracker] BELINDA SUTTON CASE SUMMARY');
        console.log('===============================================');
        console.log(`Petition Date: 1783-02-14`);
        console.log(`Award: £15 annually (lifetime) + £12 back payment`);
        console.log(`Expected Total: £${analysis.expectedTotalPayments} over ${analysis.awardDurationYears} years`);
        console.log(`Actually Paid: £${analysis.totalAmountPaid} (${analysis.paymentCount} payments)`);
        console.log(`Unpaid: £${analysis.amountUnpaid}`);
        console.log(`Fulfillment: ${analysis.fulfillmentPercentage}%`);
        console.log(`Status: ${analysis.fulfillmentStatus}`);
        console.log(`\nMODERN VALUE:`);
        console.log(`Unpaid amount: $${analysis.unpaidModernValue.toLocaleString()}`);
        console.log(`Broken promise penalty: $${analysis.brokenPromisePenalty.toLocaleString()}`);
        console.log(`Compound interest: $${analysis.compoundInterestOwed.toLocaleString()}`);
        console.log(`TOTAL ADDITIONAL DEBT: $${analysis.totalAdditionalDebt.toLocaleString()}`);
        console.log('===============================================\n');

        return { petition, analysis };
    }

    /**
     * Save petition to database
     */
    async savePetitionToDatabase(petition) {
        if (!this.db) return null;

        try {
            const result = await this.db.query(`
                INSERT INTO historical_reparations_petitions (
                    petitioner_name,
                    petitioner_enslaved_id,
                    petitioner_relationship,
                    enslaver_name,
                    enslaver_individual_id,
                    petition_date,
                    petition_number,
                    petition_title,
                    petition_summary,
                    petition_full_text,
                    amount_requested,
                    currency,
                    request_type,
                    years_of_service,
                    petitioned_authority,
                    jurisdiction,
                    case_reference,
                    petition_status,
                    decision_date,
                    decision_text,
                    amount_awarded,
                    awarded_currency,
                    award_terms,
                    award_duration,
                    award_conditions,
                    modern_value_requested,
                    modern_value_awarded,
                    primary_source_url,
                    archive_source,
                    archive_reference,
                    document_path,
                    notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
                RETURNING id
            `, [
                petition.petitionerName,
                petition.petitionerEnslavedId,
                petition.petitionerRelationship,
                petition.enslaverName,
                petition.enslaverIndividualId,
                petition.petitionDate,
                petition.petitionNumber,
                petition.petitionTitle,
                petition.petitionSummary,
                petition.petitionFullText,
                petition.amountRequested,
                petition.currency,
                petition.requestType,
                petition.yearsOfService,
                petition.petitionedAuthority,
                petition.jurisdiction,
                petition.caseReference,
                petition.petitionStatus,
                petition.decisionDate,
                petition.decisionText,
                petition.amountAwarded,
                petition.awardedCurrency,
                petition.awardTerms,
                petition.awardDuration,
                petition.awardConditions,
                petition.modernValueRequested,
                petition.modernValueAwarded,
                petition.primarySourceUrl,
                petition.archiveSource,
                petition.archiveReference,
                petition.documentPath,
                petition.notes
            ]);

            const dbId = result.rows[0].id;
            console.log(`[PetitionTracker] Saved petition to database: ID ${dbId}`);
            return dbId;
        } catch (error) {
            console.error('[PetitionTracker] Database save error:', error.message);
            return null;
        }
    }

    /**
     * Save payment to database
     */
    async savePaymentToDatabase(payment) {
        if (!this.db) return null;

        try {
            const result = await this.db.query(`
                INSERT INTO historical_reparations_payments (
                    petition_id,
                    recipient_name,
                    recipient_enslaved_id,
                    payment_amount,
                    currency,
                    payment_date,
                    payment_year,
                    modern_value_estimate,
                    conversion_rate,
                    payment_method,
                    payment_record_reference,
                    payment_source,
                    payment_verified,
                    verification_source,
                    document_proof_url,
                    payment_type,
                    amount_due,
                    shortfall,
                    notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                RETURNING id
            `, [
                payment.petitionId,
                payment.recipientName,
                payment.recipientEnslavedId,
                payment.paymentAmount,
                payment.currency,
                payment.paymentDate,
                payment.paymentYear,
                payment.modernValueEstimate,
                payment.conversionRate,
                payment.paymentMethod,
                payment.paymentRecordReference,
                payment.paymentSource,
                payment.paymentVerified,
                payment.verificationSource,
                payment.documentProofUrl,
                payment.paymentType,
                payment.amountDue,
                payment.shortfall,
                payment.notes
            ]);

            const dbId = result.rows[0].id;
            console.log(`[PetitionTracker] Saved payment to database: ID ${dbId}`);
            return dbId;
        } catch (error) {
            console.error('[PetitionTracker] Payment save error:', error.message);
            return null;
        }
    }

    /**
     * Get broken promises summary from database
     */
    async getBrokenPromisesSummary() {
        if (!this.db) {
            return this.fulfillmentAnalyses.filter(a => 
                a.fulfillmentStatus !== 'fully_paid'
            );
        }

        try {
            const result = await this.db.query(`
                SELECT * FROM broken_promises_summary
                ORDER BY unpaid_modern_value DESC
            `);

            return result.rows;
        } catch (error) {
            console.error('[PetitionTracker] Query error:', error.message);
            return [];
        }
    }

    /**
     * Get comprehensive debt including broken promises
     */
    async getComprehensiveDebt(enslaverName) {
        if (!this.db) return null;

        try {
            const result = await this.db.query(`
                SELECT * FROM comprehensive_debt_with_broken_promises
                WHERE enslaver_name = $1
            `, [enslaverName]);

            return result.rows[0] || null;
        } catch (error) {
            console.error('[PetitionTracker] Query error:', error.message);
            return null;
        }
    }

    /**
     * Generate broken promises report
     */
    generateBrokenPromisesReport() {
        const brokenPromises = this.fulfillmentAnalyses.filter(a => 
            a.fulfillmentStatus !== 'fully_paid' && a.fulfillmentPercentage < 100
        );

        if (brokenPromises.length === 0) {
            return 'No broken promises recorded yet.';
        }

        const totalUnpaid = brokenPromises.reduce((sum, a) => sum + a.unpaidModernValue, 0);
        const totalPenalties = brokenPromises.reduce((sum, a) => sum + a.brokenPromisePenalty, 0);
        const totalInterest = brokenPromises.reduce((sum, a) => sum + a.compoundInterestOwed, 0);
        const totalAdditional = brokenPromises.reduce((sum, a) => sum + a.totalAdditionalDebt, 0);

        const avgFulfillment = brokenPromises.reduce((sum, a) => sum + a.fulfillmentPercentage, 0) / brokenPromises.length;

        return `
================================================================================
              BROKEN PROMISES REPORT
          Historical Reparations Petitions Analysis
================================================================================

PETITIONS TRACKED: ${this.petitions.length}
BROKEN PROMISES: ${brokenPromises.length}

FULFILLMENT STATISTICS:
-----------------------
Average Fulfillment Rate: ${avgFulfillment.toFixed(2)}%
Fully Paid: ${this.fulfillmentAnalyses.filter(a => a.fulfillmentStatus === 'fully_paid').length}
Partially Paid: ${this.fulfillmentAnalyses.filter(a => a.fulfillmentStatus === 'partially_paid').length}
Payments Stopped: ${this.fulfillmentAnalyses.filter(a => a.fulfillmentStatus === 'payments_stopped').length}
Never Paid: ${this.fulfillmentAnalyses.filter(a => a.fulfillmentStatus === 'never_paid').length}

FINANCIAL IMPACT (Modern USD):
------------------------------
Total Unpaid (promised but not delivered): $${totalUnpaid.toLocaleString()}
Broken Promise Penalties (50%): $${totalPenalties.toLocaleString()}
Compound Interest (2% annual): $${totalInterest.toLocaleString()}
TOTAL ADDITIONAL DEBT: $${totalAdditional.toLocaleString()}

CASE DETAILS:
------------
${brokenPromises.map(a => {
    const petition = this.petitions.find(p => p.id === a.petitionId);
    return `${petition.petitionerName} vs ${petition.enslaverName}:
  Awarded: ${petition.awardedCurrency} ${petition.amountAwarded} (${petition.awardDuration})
  Paid: ${a.fulfillmentPercentage.toFixed(1)}% (${a.paymentCount} of ${a.expectedPaymentCount} payments)
  Unpaid Modern Value: $${a.unpaidModernValue.toLocaleString()}
  Additional Debt: $${a.totalAdditionalDebt.toLocaleString()}`;
}).join('\n\n')}

================================================================================
NOTE: Broken promises COMPOUND the original injustice. Not only were people
      enslaved, but when governments acknowledged the debt and made awards,
      they FAILED TO PAY. This betrayal adds penalties to the debt owed.
================================================================================
        `.trim();
    }
}

// Export for Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PetitionTracker;
} else if (typeof window !== 'undefined') {
    window.PetitionTracker = PetitionTracker;
}
