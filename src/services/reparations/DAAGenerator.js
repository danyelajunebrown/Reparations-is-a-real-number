/**
 * Debt Acknowledgment Agreement (DAA) Generator
 *
 * Generates voluntary debt acknowledgment agreements for slaveholder descendants
 * based on primary source documentation and academic research.
 *
 * Legal Framework:
 * - Belinda Sutton (1783): Persistent re-petition model
 * - Farmer-Paellmann (2002): Unjust enrichment theory
 *
 * Calculation Methodology (Craemer-based):
 * - Base: Historical free-labor hourly wage × 12 hours/day × 300 working days × years enslaved
 * - Interest: 3% compound annually to present year
 * - NO additional multipliers (compound interest already accounts for time value)
 *
 * CITATIONS:
 * - Craemer, Thomas. "Estimating Slavery Reparations: Present Value Comparisons of
 *   Historical Multigenerational Reparations Policies." Social Science Quarterly 96.2
 *   (2015): 639-655. doi:10.1111/ssqu.12151
 *   → 3% compound interest rate (conservative floor, below historical returns)
 *   → 12-hour work day for all enslaved persons aged 5+
 *   → Historical free-labor wages: $0.02-$0.08/hr (1790-1860)
 *
 * - Ager, Boustan & Eriksson. "The Intergenerational Effects of a Large Wealth Shock:
 *   White Planters after the Civil War." American Economic Review 111.11 (2021): 3767-3794.
 *   → Qualitative finding: slaveholder families fully recovered within 1-2 generations
 *     via social capital (NOT a numerical multiplier — cited for unjust enrichment argument)
 *
 * - Brattle Group Report (2023): $100-131 trillion total across 19 million people
 *   over 4 centuries (802 million person-years). Used as macro ceiling sanity check.
 *   → Per-person-year average: ~$125K-$163K (for cross-reference only)
 *
 * WHAT THIS FORMULA IS NOT:
 * - It is not the final methodology. It is Craemer's conservative floor estimate.
 * - Darity & Mullen's wealth-gap approach ($795K/household) may be superior for
 *   population-level calculations but requires adaptation for individual DAAs.
 * - The payment percentage (currently 2% of income) is placeholder pending tiered
 *   structure research (GitHub Issue #21).
 *
 * See GitHub Issues #2, #19, #21, #24 for ongoing methodology development.
 */

const { v4: uuidv4 } = require('uuid');

class DAAGenerator {
    constructor(database) {
        this.db = database;

        // ── Calculation Constants (all sourced) ─────────────────────────────
        //
        // Craemer (2015) uses historical free-labor hourly wages ($0.02-$0.08/hr
        // in 1790-1860) × 12 hours/day. We use $0.80/day as the midpoint of
        // the 1840-1860 range ($0.06/hr × 12hr ≈ $0.72, rounded to $0.80).
        // This is deliberately conservative — many enslaved people were skilled
        // workers (blacksmiths, carpenters) whose labor commanded higher rates.
        //
        // Source: Craemer (2015), Table 1, p. 644
        this.BASE_DAILY_WAGE = 0.80;

        // Enslaved persons typically worked 6 days/week, ~300 days/year.
        // Craemer's Scenario 1 uses 12hr/day, which we reflect in the daily wage.
        // Scenario 2 (24/7 = 8,760 hr/yr) would produce higher figures.
        //
        // Source: Craemer (2015), p. 643
        this.WORKING_DAYS_PER_YEAR = 300;

        // 3% annual compound interest rate.
        // Craemer describes this as "very conservative" — below historical
        // inflation, intended as an absolute minimum reasonable return.
        // Makes the estimate a floor, not a ceiling.
        // For comparison: ICHEIC used U.S. 30-year bond returns (~4-5%).
        //
        // Source: Craemer (2015), p. 645
        this.COMPOUND_INTEREST_RATE = 0.03;

        // Payment percentage — PLACEHOLDER pending tiered structure.
        // See GitHub Issue #21 for research on income-based tiers,
        // net-worth adjustments, and proportion-of-harm factors.
        this.PAYMENT_PERCENTAGE = 0.02;

        this.CURRENT_YEAR = new Date().getFullYear();

        // Macro ceiling sanity check (Brattle Group 2023)
        // $100-131T total / 802M person-years ≈ $125K-$163K per person-year
        // If our per-person-year figure exceeds this, something is wrong.
        this.BRATTLE_PER_PERSON_YEAR_CEILING = 163000;
    }

    /**
     * Calculate individual debt for one enslaved person
     *
     * Formula (Craemer 2015):
     *   Total = (daily_wage × working_days × years) × (1 + r)^years_to_present
     *
     * No additional multipliers. Compound interest at 3% already accounts for
     * time value of money. Adding separate inflation or wealth multipliers
     * would double-count.
     *
     * @param {number} yearsEnslaved - Years of unpaid labor (from documented dates)
     * @param {number} startYear - Year enslavement began (documented birth year or start)
     * @returns {Object} Calculation breakdown with citations
     */
    calculateIndividualDebt(yearsEnslaved, startYear) {
        const endYear = startYear + yearsEnslaved;
        const yearsToPresent = this.CURRENT_YEAR - endYear;

        // Step 1: Base wage theft (Craemer Scenario 1)
        const baseWageTheft = this.BASE_DAILY_WAGE *
                              this.WORKING_DAYS_PER_YEAR *
                              yearsEnslaved;

        // Step 2: Compound interest to present value (3%, Craemer)
        const presentValue = baseWageTheft *
                            Math.pow(1 + this.COMPOUND_INTEREST_RATE, yearsToPresent);

        // Step 3: Sanity check against Brattle Group macro ceiling
        const perPersonYear = presentValue / yearsEnslaved;
        const exceedsCeiling = perPersonYear > this.BRATTLE_PER_PERSON_YEAR_CEILING;

        return {
            baseWageTheft: Math.round(baseWageTheft * 100) / 100,
            presentValue: Math.round(presentValue * 100) / 100,
            // For backward compatibility, keep modernValue pointing to the final number
            modernValue: Math.round(presentValue * 100) / 100,
            yearsEnslaved,
            startYear,
            endYear,
            yearsToPresent,
            perPersonYear: Math.round(perPersonYear * 100) / 100,
            exceedsBrattleCeiling: exceedsCeiling,
            methodology: 'Craemer (2015): Base wage theft + 3% compound interest to present',
            formula: `($${this.BASE_DAILY_WAGE}/day × ${this.WORKING_DAYS_PER_YEAR} days × ${yearsEnslaved} yrs) × (1.03)^${yearsToPresent}`,
            citations: {
                wage: 'Craemer (2015), Table 1, p. 644 — historical free-labor hourly wages',
                interest: 'Craemer (2015), p. 645 — 3% conservative floor rate',
                ceiling: 'Brattle Group (2023) — $125K-$163K per person-year macro average'
            }
        };
    }

    /**
     * Generate complete DAA with all enslaved persons
     * 
     * @param {Object} params - DAA parameters
     * @returns {Object} Complete DAA record
     */
    async generateDAA(params) {
        const {
            acknowledgerName,
            acknowledgerEmail,
            acknowledgerAddress,
            slaveholderName,
            slaveholderCanonicalId,
            slaveholderFamilySearchId,
            primarySourceArk,
            primarySourceArchive,
            primarySourceReference,
            primarySourceDate,
            primarySourceType = 'will',
            generationFromSlaveholder,
            annualIncome,
            enslavedPersons, // Array of {name, yearsEnslaved, startYear, relationship}
            notes
        } = params;

        // Validate required fields
        if (!acknowledgerName) throw new Error('Acknowledger name required');
        if (!slaveholderName) throw new Error('Slaveholder name required');
        if (!annualIncome || annualIncome <= 0) throw new Error('Valid annual income required');
        // Allow zero enslaved persons for "negative finding" DAAs (no connections found)
        if (!enslavedPersons) enslavedPersons = [];

        // Generate agreement number
        const agreementNumberResult = await this.db.query(
            'SELECT generate_daa_agreement_number() as agreement_number'
        );
        const agreementNumber = agreementNumberResult.rows[0].agreement_number;

        // ── Confidence Propagation ────────────────────────────────────
        // The genealogical chain from the participant to the slaveholder
        // has uncertainty at each generation. We model this as:
        //
        //   chain_confidence = per_link_confidence ^ generation_distance
        //
        // Where per_link_confidence = 0.92 (conservative estimate that
        // each parent-child link in FamilySearch is ~92% reliable).
        //
        // This means:
        //   Gen 1:  0.92^1  = 92% confident
        //   Gen 4:  0.92^4  = 72% confident
        //   Gen 6:  0.92^6  = 61% confident
        //   Gen 8:  0.92^8  = 51% confident
        //   Gen 10: 0.92^10 = 43% confident
        //
        // The debt is weighted by this confidence — a Gen 4 match
        // contributes 72% of its full value, a Gen 10 match only 43%.
        // This prevents deep, uncertain matches from dominating the DAA.
        //
        // The match_confidence from the climber is also factored in:
        //   effective_confidence = chain_confidence × match_confidence
        //
        // If no generation data is provided, confidence defaults to 1.0
        // (no penalty — this is the case for non-climb matches).
        const PER_LINK_CONFIDENCE = 0.92;

        // Calculate debt for each enslaved person
        // Skip persons with unknown years (no fabricated defaults)
        const enslavedCalculations = enslavedPersons
            .filter(person => person.yearsEnslaved != null && person.startYear != null)
            .map(person => {
                const calc = this.calculateIndividualDebt(
                    person.yearsEnslaved,
                    person.startYear
                );

                // Apply confidence propagation if generation data is available
                const generationDistance = person.generationDistance || generationFromSlaveholder || null;
                const matchConfidence = person.matchConfidence || 1.0;
                const chainConfidence = generationDistance
                    ? Math.pow(PER_LINK_CONFIDENCE, generationDistance)
                    : 1.0;
                const effectiveConfidence = chainConfidence * matchConfidence;

                // Weight the debt by effective confidence
                const weightedValue = Math.round(calc.modernValue * effectiveConfidence * 100) / 100;

                return {
                    name: person.name,
                    ...calc,
                    // Confidence data
                    generationDistance,
                    chainConfidence: Math.round(chainConfidence * 1000) / 1000,
                    matchConfidence: Math.round(matchConfidence * 1000) / 1000,
                    effectiveConfidence: Math.round(effectiveConfidence * 1000) / 1000,
                    // Weighted value
                    weightedValue,
                    unweightedValue: calc.modernValue,
                    relationship: person.relationship || 'enslaved_by'
                };
            });

        // Track persons whose debt could not be calculated due to missing data
        const pendingCalculations = enslavedPersons
            .filter(person => person.yearsEnslaved == null || person.startYear == null)
            .map(person => ({
                name: person.name,
                reason: 'Insufficient documented dates to calculate debt — birth year, freedom year, or both are unknown',
                relationship: person.relationship || 'enslaved_by'
            }));

        // Calculate total debt using WEIGHTED values
        // The unweighted total is shown for transparency
        const totalDebt = enslavedCalculations.reduce(
            (sum, calc) => sum + calc.weightedValue,
            0
        );
        const totalDebtUnweighted = enslavedCalculations.reduce(
            (sum, calc) => sum + calc.unweightedValue,
            0
        );

        // Calculate annual payment (2% of income)
        const annualPayment = Math.round(annualIncome * this.PAYMENT_PERCENTAGE * 100) / 100;

        // Prepare calculation breakdown
        const calculationBreakdown = {
            methodology: {
                baseWage: `$${this.BASE_DAILY_WAGE}/day`,
                workingDays: this.WORKING_DAYS_PER_YEAR,
                interestRate: `${this.COMPOUND_INTEREST_RATE * 100}%`,
                note: 'Craemer (2015) conservative floor — no additional multipliers. Compound interest accounts for time value.'
            },
            citations: {
                primaryMethodology: 'Craemer, Thomas. "Estimating Slavery Reparations." Social Science Quarterly 96.2 (2015): 639-655',
                unjustEnrichment: 'Ager, Boustan & Eriksson. AER 111.11 (2021): 3767-3794 — slaveholder wealth persisted via social capital',
                macroFramework: 'Darity & Mullen. "From Here to Equality" (2020) — wealth-gap closure model',
                legalBasis: 'Dagan. "Restitution and Slavery." 84 B.U. L. Rev. 1139 (2004)',
                macroCeiling: 'Brattle Group (2023) — $100-131T total forensic economics estimate'
            },
            confidencePropagation: {
                perLinkConfidence: PER_LINK_CONFIDENCE,
                note: 'Each generational link assumed 92% reliable. Chain confidence = 0.92^generations. Debt weighted by effective_confidence (chain × match).',
                totalDebtWeighted: totalDebt,
                totalDebtUnweighted: totalDebtUnweighted,
                confidenceDiscount: totalDebtUnweighted > 0
                    ? Math.round((1 - totalDebt / totalDebtUnweighted) * 100) + '%'
                    : '0%'
            },
            enslavedPersons: enslavedCalculations,
            pendingCalculations,
            totalDebt,
            annualIncome,
            annualPayment,
            paymentPercentage: this.PAYMENT_PERCENTAGE,
            generatedAt: new Date().toISOString()
        };

        // Begin transaction
        const client = await this.db.connect();
        
        try {
            await client.query('BEGIN');

            // Insert main DAA record
            const daaResult = await client.query(`
                INSERT INTO debt_acknowledgment_agreements (
                    daa_id,
                    agreement_number,
                    acknowledger_name,
                    acknowledger_email,
                    acknowledger_address,
                    generation_from_slaveholder,
                    slaveholder_canonical_id,
                    slaveholder_name,
                    slaveholder_familysearch_id,
                    primary_source_ark,
                    primary_source_archive,
                    primary_source_reference,
                    primary_source_date,
                    primary_source_type,
                    total_debt,
                    calculation_methodology,
                    calculation_breakdown,
                    annual_payment,
                    payment_percentage,
                    acknowledger_annual_income,
                    status,
                    notes
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
                )
                RETURNING daa_id
            `, [
                uuidv4(),
                agreementNumber,
                acknowledgerName,
                acknowledgerEmail,
                acknowledgerAddress ? JSON.stringify(acknowledgerAddress) : null,
                generationFromSlaveholder,
                slaveholderCanonicalId,
                slaveholderName,
                slaveholderFamilySearchId,
                primarySourceArk,
                primarySourceArchive,
                primarySourceReference,
                primarySourceDate,
                primarySourceType,
                totalDebt,
                calculationBreakdown.methodology,
                JSON.stringify(calculationBreakdown),
                annualPayment,
                this.PAYMENT_PERCENTAGE,
                annualIncome,
                'draft',
                notes
            ]);

            const daaId = daaResult.rows[0].daa_id;

            // Insert enslaved persons
            for (const person of enslavedCalculations) {
                await client.query(`
                    INSERT INTO daa_enslaved_persons (
                        daa_id,
                        enslaved_name,
                        years_enslaved,
                        start_year,
                        end_year,
                        individual_debt,
                        base_wage_theft,
                        with_interest,
                        with_wealth_multiplier,
                        modern_value,
                        calculation_breakdown,
                        relationship_to_slaveholder
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                `, [
                    daaId,
                    person.name,
                    person.yearsEnslaved,
                    person.startYear,
                    person.endYear,
                    person.modernValue,
                    person.baseWageTheft,
                    person.withInterest,
                    person.presentValue, // was withMultiplier — no separate multiplier step in Craemer formula
                    person.modernValue,
                    JSON.stringify({
                        methodology: person.methodology,
                        formula: person.formula,
                        yearsToPresent: person.yearsToPresent
                    }),
                    person.relationship
                ]);
            }

            await client.query('COMMIT');

            return {
                daaId,
                agreementNumber,
                totalDebt,
                annualPayment,
                enslavedCount: enslavedPersons.length,
                calculationBreakdown
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get complete DAA record with all relations
     * 
     * @param {string} daaId - DAA UUID
     * @returns {Object} Complete DAA data
     */
    async getDAA(daaId) {
        // Get main DAA record
        const daaResult = await this.db.query(`
            SELECT * FROM debt_acknowledgment_agreements
            WHERE daa_id = $1
        `, [daaId]);

        if (daaResult.rows.length === 0) {
            throw new Error(`DAA not found: ${daaId}`);
        }

        const daa = daaResult.rows[0];

        // Get enslaved persons
        const enslavedResult = await this.db.query(`
            SELECT * FROM daa_enslaved_persons
            WHERE daa_id = $1
            ORDER BY individual_debt DESC
        `, [daaId]);

        // Get petitions
        const petitionsResult = await this.db.query(`
            SELECT * FROM daa_annual_petitions
            WHERE daa_id = $1
            ORDER BY petition_year DESC
        `, [daaId]);

        // Get payments
        const paymentsResult = await this.db.query(`
            SELECT * FROM daa_payments
            WHERE daa_id = $1
            ORDER BY payment_year DESC
        `, [daaId]);

        return {
            ...daa,
            enslavedPersons: enslavedResult.rows,
            petitions: petitionsResult.rows,
            payments: paymentsResult.rows
        };
    }

    /**
     * Record annual petition to government
     * 
     * @param {string} daaId - DAA UUID
     * @param {number} year - Petition year
     * @param {Object} deliveryInfo - Lob.com delivery details
     * @returns {Object} Petition record
     */
    async recordAnnualPetition(daaId, year, governmentEntity, deliveryInfo = {}) {
        const result = await this.db.query(`
            INSERT INTO daa_annual_petitions (
                daa_id,
                petition_year,
                petition_date,
                government_entity,
                recipient_name,
                recipient_address,
                lob_letter_id,
                tracking_number,
                expected_delivery_date,
                physical_mail_cost,
                email_sent,
                email_recipient
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING petition_id
        `, [
            daaId,
            year,
            new Date(),
            governmentEntity,
            deliveryInfo.recipientName,
            deliveryInfo.recipientAddress ? JSON.stringify(deliveryInfo.recipientAddress) : null,
            deliveryInfo.lobLetterId,
            deliveryInfo.trackingNumber,
            deliveryInfo.expectedDeliveryDate,
            deliveryInfo.cost,
            deliveryInfo.emailSent || false,
            deliveryInfo.emailRecipient
        ]);

        return {
            petitionId: result.rows[0].petition_id,
            year,
            governmentEntity
        };
    }

    /**
     * Record payment (2% of annual income)
     * 
     * @param {string} daaId - DAA UUID
     * @param {number} amount - Payment amount
     * @param {number} acknowledgerIncome - Income for that year
     * @param {Object} blockchainInfo - Transaction details
     * @returns {Object} Payment record
     */
    async recordPayment(daaId, amount, acknowledgerIncome, blockchainInfo = {}) {
        const year = new Date().getFullYear();

        const result = await this.db.query(`
            INSERT INTO daa_payments (
                daa_id,
                payment_year,
                payment_date,
                amount,
                acknowledger_income_that_year,
                payment_method,
                payment_processor,
                blockchain_tx_hash,
                blockchain_network,
                blockchain_confirmed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING payment_id
        `, [
            daaId,
            year,
            new Date(),
            amount,
            acknowledgerIncome,
            blockchainInfo.paymentMethod || 'blockchain_escrow',
            blockchainInfo.paymentProcessor || 'ethereum',
            blockchainInfo.txHash,
            blockchainInfo.network,
            blockchainInfo.confirmedAt
        ]);

        return {
            paymentId: result.rows[0].payment_id,
            year,
            amount
        };
    }

    /**
     * Get all DAAs (with optional filters)
     * 
     * @param {Object} filters - Query filters
     * @returns {Array} DAA summaries
     */
    async listDAAs(filters = {}) {
        let query = 'SELECT * FROM daa_summary';
        const conditions = [];
        const params = [];

        if (filters.status) {
            conditions.push(`status = $${params.length + 1}`);
            params.push(filters.status);
        }

        if (filters.acknowledgerName) {
            conditions.push(`acknowledger_name ILIKE $${params.length + 1}`);
            params.push(`%${filters.acknowledgerName}%`);
        }

        if (filters.slaveholderName) {
            conditions.push(`slaveholder_name ILIKE $${params.length + 1}`);
            params.push(`%${filters.slaveholderName}%`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY created_at DESC';

        if (filters.limit) {
            query += ` LIMIT ${parseInt(filters.limit)}`;
        }

        const result = await this.db.query(query, params);
        return result.rows;
    }

    /**
     * Calculate preview without creating record
     * 
     * @param {Array} enslavedPersons - Array of {name, yearsEnslaved, startYear}
     * @param {number} annualIncome - Acknowledger's income
     * @returns {Object} Preview calculation
     */
    calculatePreview(enslavedPersons, annualIncome) {
        const calculations = enslavedPersons.map(person => ({
            name: person.name,
            ...this.calculateIndividualDebt(person.yearsEnslaved, person.startYear)
        }));

        const totalDebt = calculations.reduce((sum, calc) => sum + calc.modernValue, 0);
        const annualPayment = Math.round(annualIncome * this.PAYMENT_PERCENTAGE * 100) / 100;
        const yearsToPayOff = Math.ceil(totalDebt / annualPayment);

        return {
            totalDebt,
            annualPayment,
            enslavedCount: enslavedPersons.length,
            yearsToPayOff,
            calculations,
            paymentPercentage: this.PAYMENT_PERCENTAGE
        };
    }

    /**
     * Get legal precedents for DAA documents
     */
    async getLegalPrecedents() {
        const result = await this.db.query(`
            SELECT * FROM daa_legal_precedents
            ORDER BY case_year ASC
        `);
        return result.rows;
    }

    /**
     * Get academic sources for DAA documents
     */
    async getAcademicSources() {
        const result = await this.db.query(`
            SELECT * FROM daa_academic_sources
            ORDER BY publication_year DESC
        `);
        return result.rows;
    }
}

module.exports = DAAGenerator;
