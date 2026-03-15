/**
 * LegalPrecedentService.js
 * 
 * Service for querying and applying legal precedents across Triangle Trade jurisdictions.
 * Supports DAA generation with jurisdiction-specific legal citations.
 * 
 * Key Precedents:
 * - UK 1833 Loan (paid 2015): Primary precedent for intergenerational debt transfer
 * - Haiti Independence Debt: Counter-precedent showing inverse reparations
 * - Netherlands 2023: Contemporary proof of ongoing obligation
 * - Farmer-Paellmann 2004: Strategic lessons from failure
 * 
 * Per Mullen & Darity:
 * - Government taxation (C) is ONLY ethical mechanism
 * - Individual DAAs (A) are our "way in" to demonstrate feasibility
 * - Class action (B) is secondary, learned from Farmer-Paellmann
 */

const { pool: sharedPool } = require('../../database/connection');

class LegalPrecedentService {
    constructor() {
        this.pool = sharedPool;
    }

    // =========================================================================
    // CORE PRECEDENT QUERIES
    // =========================================================================

    /**
     * Get the UK 1833 loan data - PRIMARY PRECEDENT
     * This is the cornerstone argument: if UK could enforce 182-year debt TO owners,
     * same mechanism applies TO descendants of enslaved.
     */
    async getUK1833Precedent() {
        const result = await this.pool.query(`
            SELECT 
                loan_amount_original,
                loan_currency,
                loan_date,
                final_payment_date,
                years_to_payoff,
                modern_value_gbp,
                modern_value_usd,
                paid_by,
                enslaved_received,
                owners_received,
                enslaved_count,
                arguments,
                primary_source,
                notes
            FROM uk_1833_compensation
            LIMIT 1
        `);
        return result.rows[0];
    }

    /**
     * Get Haiti inverse debt - COUNTER-PRECEDENT
     * France extorted $21 billion FROM Haiti for their own freedom.
     * Proves reparations logic was APPLIED - just backwards.
     */
    async getHaitiInverseDebt() {
        const result = await this.pool.query(`
            SELECT 
                original_demand,
                original_currency,
                demand_date,
                amount_paid,
                payment_currency,
                final_payment_year,
                years_paying,
                modern_value_usd,
                france_extorted_for,
                haiti_gained,
                arguments,
                primary_source,
                academic_sources,
                notes
            FROM haiti_independence_debt
            LIMIT 1
        `);
        return result.rows[0];
    }

    /**
     * Get Farmer-Paellmann analysis - STRATEGIC LESSONS
     * Understanding WHY it failed and what has changed since 2004.
     */
    async getFarmerPaellmannAnalysis() {
        const result = await this.pool.query(`
            SELECT 
                case_name,
                citation,
                court,
                judge,
                decision_date,
                outcome,
                failure_points,
                changed_circumstances,
                strategic_lessons,
                notes
            FROM farmer_paellmann_analysis
            LIMIT 1
        `);
        return result.rows[0];
    }

    // =========================================================================
    // JURISDICTION QUERIES
    // =========================================================================

    /**
     * Get all Triangle Trade jurisdictions with strategy recommendations
     */
    async getAllJurisdictions() {
        const result = await this.pool.query(`
            SELECT * FROM jurisdiction_strategies
        `);
        return result.rows;
    }

    /**
     * Get legal texts for a specific jurisdiction
     */
    async getLegalTextsByJurisdiction(countryName) {
        const result = await this.pool.query(`
            SELECT lt.*
            FROM legal_texts lt
            JOIN legal_jurisdictions lj ON lt.jurisdiction_id = lj.jurisdiction_id
            WHERE lj.country_name = $1
            ORDER BY lt.enacted_date
        `, [countryName]);
        return result.rows;
    }

    /**
     * Get jurisdiction details by country name
     */
    async getJurisdiction(countryName) {
        const result = await this.pool.query(`
            SELECT * FROM legal_jurisdictions
            WHERE country_name = $1
        `, [countryName]);
        return result.rows[0];
    }

    // =========================================================================
    // LEGAL DOCTRINE QUERIES
    // =========================================================================

    /**
     * Get applicable legal doctrines for a jurisdiction
     */
    async getDoctrinesForJurisdiction(countryName) {
        const result = await this.pool.query(`
            SELECT *
            FROM legal_doctrines
            WHERE $1 = ANY(applicable_jurisdictions)
        `, [countryName]);
        return result.rows;
    }

    /**
     * Get all legal doctrines
     */
    async getAllDoctrines() {
        const result = await this.pool.query(`
            SELECT * FROM legal_doctrines
            ORDER BY doctrine_type, doctrine_name
        `);
        return result.rows;
    }

    // =========================================================================
    // GARNISHMENT MECHANISM QUERIES
    // =========================================================================

    /**
     * Get garnishment mechanisms by our strategic position
     */
    async getGarnishmentMechanisms() {
        const result = await this.pool.query(`
            SELECT *
            FROM garnishment_mechanisms
            ORDER BY 
                CASE our_position 
                    WHEN 'primary' THEN 1
                    WHEN 'secondary' THEN 2
                    WHEN 'ultimate_goal' THEN 3
                    WHEN 'opportunistic' THEN 4
                    ELSE 5
                END
        `);
        return result.rows;
    }

    /**
     * Get mechanism by defendant type
     */
    async getMechanismByDefendantType(defendantType) {
        const result = await this.pool.query(`
            SELECT * FROM garnishment_mechanisms
            WHERE defendant_type = $1
        `, [defendantType]);
        return result.rows;
    }

    // =========================================================================
    // DAA LEGAL CITATION BUILDER
    // =========================================================================

    /**
     * Build jurisdiction-specific legal citations for a DAA
     * @param {string} jurisdiction - Country name
     * @param {string} defendantType - 'individual', 'corporation', 'government'
     * @returns {Object} Legal citations and arguments for DAA
     */
    async buildDAALegalCitations(jurisdiction, defendantType) {
        const [
            jurisdictionData,
            legalTexts,
            doctrines,
            mechanism,
            uk1833,
            haiti,
            farmerPaellmann
        ] = await Promise.all([
            this.getJurisdiction(jurisdiction),
            this.getLegalTextsByJurisdiction(jurisdiction),
            this.getDoctrinesForJurisdiction(jurisdiction),
            this.getMechanismByDefendantType(defendantType),
            this.getUK1833Precedent(),
            this.getHaitiInverseDebt(),
            this.getFarmerPaellmannAnalysis()
        ]);

        return {
            // Jurisdiction context
            jurisdiction: jurisdictionData,
            legalSystem: jurisdictionData?.legal_system,
            
            // Applicable legal texts
            statutoryBasis: legalTexts,
            
            // Legal theories to apply
            doctrines: doctrines,
            
            // Collection mechanism
            mechanism: mechanism?.[0],
            
            // Core precedents (always included)
            corePrecedents: {
                uk1833: {
                    fact: `UK government enforced ${uk1833?.years_to_payoff} years of payments for slavery debt, ending in ${uk1833?.final_payment_date?.getFullYear?.() || 2015}`,
                    legalSignificance: 'Proves governments CAN create and enforce multi-generational slavery debt obligations',
                    arguments: uk1833?.arguments
                },
                haiti: {
                    fact: `France extorted $${(uk1833?.modern_value_usd / 1e9).toFixed(1)} billion from Haiti for their own freedom`,
                    legalSignificance: 'Proves reparations logic was APPLIED against enslaved - debt reversal is restoration of justice',
                    arguments: haiti?.arguments
                },
                netherlands2023: {
                    fact: 'Netherlands paid €200M reparations and issued formal apology in 2023',
                    legalSignificance: 'Proves ongoing obligation recognized by modern governments'
                }
            },
            
            // Farmer-Paellmann lessons (avoid their mistakes)
            strategicConsiderations: {
                failurePoints: farmerPaellmann?.failure_points,
                howWeAddress: Object.fromEntries(
                    Object.entries(farmerPaellmann?.failure_points || {}).map(([key, val]) => [
                        key, 
                        { weakness: val.weakness_exploited, solution: val.how_we_address }
                    ])
                ),
                changedCircumstances: farmerPaellmann?.changed_circumstances
            }
        };
    }

    // =========================================================================
    // SUMMARY VIEWS
    // =========================================================================

    /**
     * Get all legal precedents ranked by strength
     */
    async getPrecedentsByStrength() {
        const result = await this.pool.query(`
            SELECT * FROM legal_precedents_by_strength
        `);
        return result.rows;
    }

    /**
     * Get comprehensive legal framework summary
     */
    async getFrameworkSummary() {
        const [jurisdictions, doctrines, mechanisms, precedents] = await Promise.all([
            this.pool.query('SELECT COUNT(*) FROM legal_jurisdictions'),
            this.pool.query('SELECT COUNT(*) FROM legal_doctrines'),
            this.pool.query('SELECT COUNT(*) FROM garnishment_mechanisms'),
            this.getPrecedentsByStrength()
        ]);

        return {
            totalJurisdictions: parseInt(jurisdictions.rows[0].count),
            totalDoctrines: parseInt(doctrines.rows[0].count),
            totalMechanisms: parseInt(mechanisms.rows[0].count),
            keyPrecedents: precedents,
            strategy: {
                primary: 'Individual DAAs with documented lineage (avoids Farmer-Paellmann standing issues)',
                secondary: 'Class action against corporations (improved evidence chains)',
                ultimateGoal: 'Government taxation scheme (per Mullen/Darity - ethically correct)',
                escrowStrategy: 'Credit distribution handled when payments arrive'
            }
        };
    }

    // =========================================================================
    // ESCROW OPERATIONS
    // =========================================================================

    /**
     * Create escrow record when payment received
     * Per user: "we will cross that bridge when somebody bites"
     */
    async createEscrowRecord(debtorName, debtorType, amount, daaId = null) {
        const result = await this.pool.query(`
            INSERT INTO reparations_escrow (
                debtor_name, debtor_type, amount, daa_id, escrow_status
            ) VALUES ($1, $2, $3, $4, 'pending')
            RETURNING *
        `, [debtorName, debtorType, amount, daaId]);
        return result.rows[0];
    }

    /**
     * Update escrow status
     */
    async updateEscrowStatus(escrowId, status) {
        const result = await this.pool.query(`
            UPDATE reparations_escrow
            SET escrow_status = $2,
                ${status === 'funded' ? 'funded_at = NOW()' : ''}
                ${status === 'distributed' ? 'distributed_at = NOW()' : ''}
            WHERE escrow_id = $1
            RETURNING *
        `, [escrowId, status]);
        return result.rows[0];
    }

    /**
     * Get escrow records by status
     */
    async getEscrowByStatus(status) {
        const result = await this.pool.query(`
            SELECT * FROM reparations_escrow
            WHERE escrow_status = $1
            ORDER BY created_at DESC
        `, [status]);
        return result.rows;
    }
}

module.exports = LegalPrecedentService;
