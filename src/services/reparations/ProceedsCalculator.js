/**
 * Proceeds Calculator - Business Proceeds Calculation System
 *
 * CRITICAL CONCEPTUAL FRAMEWORK (CORRECTED):
 * 
 * Compensation TO owners is NOT added to debt directly.
 * It is EVIDENCE of business VALUE at time of emancipation.
 * 
 * The CORRECT reparations formula is:
 *   Total Reparations = Wage Theft + Portion of Business Proceeds + Damages
 * 
 * To calculate "Portion of Business Proceeds":
 * 1. Research owner's assets and business reports from the time period
 * 2. Determine what portion of business value came from enslaved person's labor/human capital
 * 3. That portion of ongoing business proceeds belongs to the enslaved person
 * 
 * PLACEHOLDER SERVICE:
 * This service holds the structure and methodology for future improvement.
 * Each owner's business will require specific historical research to determine
 * the enslaved person's portion of business value and proceeds.
 *
 * @author Reparations Platform Team
 * @version 1.0.0
 */

class ProceedsCalculator {
    constructor(db = null) {
        this.db = db;

        // Calculation methodologies available
        this.calculationMethods = {
            'labor_hours_ratio': {
                name: 'Labor Hours Ratio Method',
                description: 'Calculate based on ratio of enslaved labor hours to total labor hours',
                requires: ['enslaved_hours', 'total_labor_hours'],
                formula: '(enslaved_hours / total_labor_hours) * business_value'
            },
            'human_capital_value': {
                name: 'Human Capital Value Method',
                description: 'Calculate based on the human capital value the enslaved person represented',
                requires: ['skilled_labor_value', 'business_value', 'total_labor_value'],
                formula: '(enslaved_person_value / total_labor_value) * business_value'
            },
            'productivity_analysis': {
                name: 'Productivity Analysis Method',
                description: 'Calculate based on output/productivity metrics',
                requires: ['output_per_enslaved', 'market_value_per_unit', 'total_output'],
                formula: '(enslaved_output * market_value) / total_business_revenue'
            },
            'business_proportion': {
                name: 'Business Proportion Method',
                description: 'Calculate direct proportion based on enslaved count vs total workers',
                requires: ['enslaved_count', 'total_workers', 'business_value'],
                formula: '(enslaved_count / total_workers) * business_value'
            },
            'custom': {
                name: 'Custom Research-Based Method',
                description: 'Custom calculation based on specific historical research for this business',
                requires: ['custom_research_data'],
                formula: 'Determined by historical research'
            }
        };

        // Research guidance by business type
        this.researchGuidance = {
            'plantation': {
                archives: ['State Historical Societies', 'University Special Collections', 'Plantation Records Archives'],
                lookFor: ['Crop yields', 'Labor schedules', 'Overseer reports', 'Financial ledgers', 'Tax records'],
                keyMetrics: ['acres cultivated', 'output per acre', 'market prices', 'enslaved count', 'labor organization']
            },
            'factory': {
                archives: ['Business Archives', 'Corporate Records', 'Industrial History Collections'],
                lookFor: ['Production records', 'Employment records', 'Financial statements', 'Shareholder reports'],
                keyMetrics: ['production volume', 'labor costs', 'enslaved vs hired workers', 'profitability']
            },
            'shipping': {
                archives: ['Maritime Museums', 'Port Authority Records', 'Customs Records'],
                lookFor: ['Ship manifests', 'Cargo records', 'Crew lists', 'Voyage profits'],
                keyMetrics: ['enslaved crew members', 'cargo transported', 'voyage revenues', 'labor costs saved']
            },
            'banking': {
                archives: ['Financial Institution Archives', 'Bank Records', 'Corporate Histories'],
                lookFor: ['Loans secured by enslaved people', 'Asset valuations', 'Business relationships'],
                keyMetrics: ['collateral values', 'interest income', 'business growth', 'enslaved as assets']
            },
            'textile_mill': {
                archives: ['Industrial Archives', 'Labor History Collections', 'Company Records'],
                lookFor: ['Production records', 'Labor records', 'Cost accounting', 'Profit margins'],
                keyMetrics: ['output per worker', 'labor cost savings', 'market competitiveness']
            }
        };
    }

    /**
     * Calculate business proceeds portion for an enslaved person
     * This is PLACEHOLDER logic - requires specific research for each case
     * 
     * @param {Object} businessData - Business asset and context data
     * @param {Object} enslavedData - Enslaved person's labor/contribution data
     * @param {string} method - Calculation method to use
     * @returns {Object} Calculation result with methodology notes
     */
    calculateProceedsPortion(businessData, enslavedData, method = 'business_proportion') {
        const {
            businessValue,           // Total business value at emancipation
            businessType,            // Type of business
            compensationReceived,    // What owner was compensated (if any)
            enslavedCount,          // Number of enslaved people
            historicalRevenue,      // Annual revenue if known
            historicalProfit,       // Annual profit if known
            valuationYear           // Year of valuation
        } = businessData;

        const {
            yearsEnslaved,          // Years this person was enslaved
            laborType,              // Type of labor performed
            skillLevel,             // 'unskilled', 'semi-skilled', 'skilled', 'highly_skilled'
            productivity            // Productivity metrics if known
        } = enslavedData;

        // PLACEHOLDER: Use simple proportion method until specific research available
        let contributionPercentage = 0;
        let portionOfValue = 0;
        let methodology = '';
        let researchNeeded = [];

        switch (method) {
            case 'business_proportion':
                // Simple proportion: If 10 enslaved out of 50 workers = 20%
                contributionPercentage = this.calculateSimpleProportion(enslavedCount, businessValue);
                portionOfValue = businessValue * (contributionPercentage / 100);
                methodology = `Simple proportion method: ${enslavedCount} enslaved person(s) contribution to business value of ${businessValue}`;
                researchNeeded = [
                    'Total worker count (enslaved + free)',
                    'Actual productivity metrics',
                    'Labor organization structure',
                    'Skill levels and wages of free workers'
                ];
                break;

            case 'labor_hours_ratio':
                // Would need: actual labor hours data
                contributionPercentage = 0;
                portionOfValue = 0;
                methodology = 'Labor hours ratio method - REQUIRES RESEARCH';
                researchNeeded = [
                    'Enslaved labor hours per week/year',
                    'Total labor hours (all workers)',
                    'Labor schedules and work organization',
                    'Seasonal variations in labor demands'
                ];
                break;

            case 'human_capital_value':
                // Would need: valuation records, skill assessments
                contributionPercentage = 0;
                portionOfValue = 0;
                methodology = 'Human capital value method - REQUIRES RESEARCH';
                researchNeeded = [
                    'Valuation of enslaved person as "property"',
                    'Comparable free worker wages',
                    'Skill level and training',
                    'Replacement cost analysis'
                ];
                break;

            case 'productivity_analysis':
                // Would need: output metrics, market prices
                contributionPercentage = 0;
                portionOfValue = 0;
                methodology = 'Productivity analysis method - REQUIRES RESEARCH';
                researchNeeded = [
                    'Output per enslaved person (units produced)',
                    'Market value per unit',
                    'Total business output',
                    'Cost structure and profit margins'
                ];
                break;

            case 'custom':
                // Requires complete historical research
                contributionPercentage = 0;
                portionOfValue = 0;
                methodology = 'Custom research-based method - PENDING HISTORICAL RESEARCH';
                researchNeeded = this.getResearchNeededForBusinessType(businessType);
                break;

            default:
                throw new Error(`Unknown calculation method: ${method}`);
        }

        return {
            method,
            contributionPercentage,
            portionOfValue,
            methodology,
            
            // What's needed to improve this calculation
            researchNeeded,
            researchGuidance: this.researchGuidance[businessType] || null,
            
            // Compensation context
            compensationContext: {
                ownerReceived: compensationReceived,
                compensationRole: 'Evidence of business value at emancipation',
                notAddedToDebt: true,
                usedForCalculation: 'Informs business value assessment'
            },
            
            // Status
            calculationStatus: researchNeeded.length > 0 ? 'placeholder_pending_research' : 'calculated',
            confidence: researchNeeded.length === 0 ? 'high' : 'low',
            
            // Notes
            notes: `PLACEHOLDER: This calculation uses ${method} method. ` +
                  `Compensation to owner (${compensationReceived}) is used as evidence of business value, ` +
                  `NOT added to debt directly. Specific historical research needed to determine ` +
                  `accurate portion of business proceeds attributable to enslaved labor.`
        };
    }

    /**
     * Simple proportion calculation (placeholder)
     */
    calculateSimpleProportion(enslavedCount, businessValue) {
        // VERY rough estimate - assumes equal contribution
        // Real calculation needs specific research on:
        // - Total worker count
        // - Productivity differences
        // - Skill levels
        // - Labor organization
        
        if (!enslavedCount || !businessValue) return 0;
        
        // Placeholder: If only enslaved count known, assume they were primary workforce
        // This is CONSERVATIVE and will be refined with research
        return Math.min(80, (enslavedCount / (enslavedCount + 5)) * 100); // Assumes ~5 free workers as minimum
    }

    /**
     * Get research requirements for a business type
     */
    getResearchNeededForBusinessType(businessType) {
        const guidance = this.researchGuidance[businessType];
        if (!guidance) {
            return ['Business type not recognized - general historical research needed'];
        }

        return [
            `Archives to check: ${guidance.archives.join(', ')}`,
            `Documents needed: ${guidance.lookFor.join(', ')}`,
            `Key metrics to find: ${guidance.keyMetrics.join(', ')}`
        ];
    }

    /**
     * Create research task for a business record
     */
    async createResearchTask(businessRecordId, researchType, description, priority = 'medium') {
        if (!this.db) {
            console.log('[ProceedsCalculator] No database connection');
            return null;
        }

        try {
            // Get business details to suggest archives
            const businessResult = await this.db.query(`
                SELECT business_type, owner_name FROM business_asset_records WHERE id = $1
            `, [businessRecordId]);

            if (businessResult.rows.length === 0) {
                throw new Error('Business record not found');
            }

            const businessType = businessResult.rows[0].business_type;
            const guidance = this.researchGuidance[businessType] || { archives: [], lookFor: [], keyMetrics: [] };

            const result = await this.db.query(`
                INSERT INTO proceeds_research_needed (
                    business_record_id,
                    research_type,
                    research_description,
                    research_priority,
                    suggested_archives,
                    suggested_sources
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
            `, [
                businessRecordId,
                researchType,
                description,
                priority,
                guidance.archives,
                guidance.lookFor
            ]);

            console.log(`[ProceedsCalculator] Created research task ID ${result.rows[0].id}`);
            return result.rows[0].id;
        } catch (error) {
            console.error('[ProceedsCalculator] Error creating research task:', error.message);
            return null;
        }
    }

    /**
     * Store a proceeds calculation methodology
     */
    async storeCalculationMethodology(businessRecordId, methodData) {
        if (!this.db) {
            console.log('[ProceedsCalculator] No database connection');
            return null;
        }

        const {
            calculationMethod,
            parameters,
            contributionPercentage,
            portionOfAssets,
            rationale,
            supportingResearch,
            status = 'draft'
        } = methodData;

        try {
            const result = await this.db.query(`
                INSERT INTO proceeds_calculation_methods (
                    business_record_id,
                    calculation_method,
                    calculation_parameters,
                    enslaved_contribution_percentage,
                    enslaved_portion_of_assets,
                    methodology_rationale,
                    supporting_research,
                    status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            `, [
                businessRecordId,
                calculationMethod,
                JSON.stringify(parameters),
                contributionPercentage,
                portionOfAssets,
                rationale,
                supportingResearch,
                status
            ]);

            console.log(`[ProceedsCalculator] Stored methodology ID ${result.rows[0].id}`);
            return result.rows[0].id;
        } catch (error) {
            console.error('[ProceedsCalculator] Error storing methodology:', error.message);
            return null;
        }
    }

    /**
     * Generate complete reparations calculation using corrected formula
     * Total = Wage Theft + Business Proceeds Portion + Damages
     */
    calculateTotalReparations(components) {
        const {
            wageTheft = 0,              // Component 1: Wage theft
            businessProceedsPortion = 0, // Component 2: Portion of business proceeds
            damages = 0,                 // Component 3: Damages
            yearsDelayed = 0,            // Years since emancipation
            interestRate = 0.02          // 2% annual compound
        } = components;

        // Base calculation
        const totalBase = wageTheft + businessProceedsPortion + damages;

        // Compound interest for delayed justice
        const compoundInterest = totalBase * (Math.pow(1 + interestRate, yearsDelayed) - 1);
        const totalWithInterest = totalBase + compoundInterest;

        return {
            components: {
                wageTheft,
                businessProceedsPortion,
                damages
            },
            percentages: {
                wageTheftPercent: totalBase > 0 ? (wageTheft / totalBase) * 100 : 0,
                proceedsPercent: totalBase > 0 ? (businessProceedsPortion / totalBase) * 100 : 0,
                damagesPercent: totalBase > 0 ? (damages / totalBase) * 100 : 0
            },
            totals: {
                baseTotal: totalBase,
                compoundInterest,
                totalWithInterest
            },
            formula: 'Total = Wage Theft + Business Proceeds Portion + Damages (+ compound interest)',
            yearsDelayed,
            interestRate,
            notes: 'Compensation TO owners is NOT included in this total. It was used to assess business value for calculating proceeds portion.'
        };
    }

    /**
     * Generate report showing what research is needed
     */
    generateResearchNeededReport(businessType) {
        const guidance = this.researchGuidance[businessType];
        
        if (!guidance) {
            return `No specific guidance available for business type: ${businessType}`;
        }

        return `
================================================================================
           RESEARCH NEEDED: ${businessType.toUpperCase()}
================================================================================

ARCHIVES TO CHECK:
${guidance.archives.map(a => `  • ${a}`).join('\n')}

DOCUMENTS TO FIND:
${guidance.lookFor.map(d => `  • ${d}`).join('\n')}

KEY METRICS NEEDED:
${guidance.keyMetrics.map(m => `  • ${m}`).join('\n')}

PURPOSE:
To calculate the enslaved person's portion of business proceeds, we need
to determine what percentage of the business value was attributable to
their labor and human capital. This requires historical research into
the specific business operations and financial records.

REMINDER:
Compensation paid TO the owner tells us the business value at emancipation.
It is NOT added to the debt directly. We use it to understand the scale of
the business and then calculate what portion of that business value (and
ongoing proceeds) belonged to the enslaved person.
================================================================================
        `.trim();
    }
}

// Export for Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProceedsCalculator;
} else if (typeof window !== 'undefined') {
    window.ProceedsCalculator = ProceedsCalculator;
}
