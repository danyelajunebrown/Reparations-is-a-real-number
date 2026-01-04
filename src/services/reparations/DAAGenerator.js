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
 * Calculation Methodology:
 * - Base: $1/day × 300 working days × years enslaved
 * - Interest: 3% compound annually
 * - Wealth Multiplier: 2.5x (Ager/Boustan/Eriksson, AER 2021)
 * - Inflation: 5.1x (1860→2025)
 * - Payment: 2% of gross annual income
 */

const { v4: uuidv4 } = require('uuid');

class DAAGenerator {
    constructor(database) {
        this.db = database;
        
        // Calculation constants from research
        this.BASE_DAILY_WAGE = 1.00;           // $1/day baseline
        this.WORKING_DAYS_PER_YEAR = 300;      // Standard working days
        this.COMPOUND_INTEREST_RATE = 0.03;    // 3% annual compound interest
        this.WEALTH_MULTIPLIER = 2.5;          // Ager et al. (AER 2021)
        this.INFLATION_MULTIPLIER = 5.1;       // 1860→2025 adjustment
        this.PAYMENT_PERCENTAGE = 0.02;        // 2% of annual income
        this.CURRENT_YEAR = new Date().getFullYear();
    }

    /**
     * Calculate individual debt for one enslaved person
     * 
     * Formula:
     * Total = (Base × (1 + r)^years × Wealth Multiplier × Inflation)
     * 
     * @param {number} yearsEnslaved - Years of unpaid labor
     * @param {number} startYear - Year enslavement began
     * @returns {Object} Calculation breakdown
     */
    calculateIndividualDebt(yearsEnslaved, startYear) {
        const endYear = startYear + yearsEnslaved;
        const yearsToPresent = this.CURRENT_YEAR - endYear;
        
        // Step 1: Base wage theft
        const baseWageTheft = this.BASE_DAILY_WAGE * 
                              this.WORKING_DAYS_PER_YEAR * 
                              yearsEnslaved;
        
        // Step 2: Compound interest to present value
        const withInterest = baseWageTheft * 
                            Math.pow(1 + this.COMPOUND_INTEREST_RATE, yearsToPresent);
        
        // Step 3: Wealth multiplier (Ager research)
        const withMultiplier = withInterest * this.WEALTH_MULTIPLIER;
        
        // Step 4: Inflation adjustment
        const modernValue = withMultiplier * this.INFLATION_MULTIPLIER;
        
        return {
            baseWageTheft: Math.round(baseWageTheft * 100) / 100,
            withInterest: Math.round(withInterest * 100) / 100,
            withMultiplier: Math.round(withMultiplier * 100) / 100,
            modernValue: Math.round(modernValue * 100) / 100,
            yearsEnslaved,
            startYear,
            endYear,
            yearsToPresent,
            methodology: 'Base wage theft + compound interest (3%) + wealth multiplier (2.5x) + inflation (5.1x)',
            formula: `($${this.BASE_DAILY_WAGE} × ${this.WORKING_DAYS_PER_YEAR} × ${yearsEnslaved}) × (1.03)^${yearsToPresent} × ${this.WEALTH_MULTIPLIER} × ${this.INFLATION_MULTIPLIER}`
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
        if (!enslavedPersons || enslavedPersons.length === 0) {
            throw new Error('At least one enslaved person required');
        }

        // Generate agreement number
        const agreementNumberResult = await this.db.query(
            'SELECT generate_daa_agreement_number() as agreement_number'
        );
        const agreementNumber = agreementNumberResult.rows[0].agreement_number;

        // Calculate debt for each enslaved person
        const enslavedCalculations = enslavedPersons.map(person => {
            const calc = this.calculateIndividualDebt(
                person.yearsEnslaved,
                person.startYear
            );
            
            return {
                name: person.name,
                ...calc,
                relationship: person.relationship || 'enslaved_by'
            };
        });

        // Calculate total debt
        const totalDebt = enslavedCalculations.reduce(
            (sum, calc) => sum + calc.modernValue,
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
                wealthMultiplier: this.WEALTH_MULTIPLIER,
                inflationMultiplier: this.INFLATION_MULTIPLIER
            },
            sources: {
                wealthMultiplier: 'Ager, Boustan & Eriksson (AER 2021)',
                framework: 'Darity & Mullen (2020)',
                legalBasis: 'Dagan (BU Law Review 2004)'
            },
            enslavedPersons: enslavedCalculations,
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
                    person.withMultiplier,
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
