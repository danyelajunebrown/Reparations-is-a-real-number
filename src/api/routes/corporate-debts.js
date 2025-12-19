/**
 * Corporate Debts API Routes
 *
 * Endpoints for tracking and calculating corporate entity reparations debt,
 * specifically for the 17 Farmer-Paellmann defendants.
 *
 * Legal Reference: In re African-American Slave Descendants Litigation,
 * 304 F. Supp. 2d 1027 (N.D. Ill. 2004)
 */

const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const {
    ReparationsSystem,
    InsuranceCalculator,
    BankingCalculator,
    RailroadCalculator
} = require('../../services/reparations');

// Initialize database connection
const sql = neon(process.env.DATABASE_URL);

// Initialize reparations system (singleton)
let reparationsSystem = null;

function getReparationsSystem() {
    if (!reparationsSystem) {
        reparationsSystem = new ReparationsSystem(sql);
    }
    return reparationsSystem;
}

// ========================================================================
// FARMER-PAELLMANN DEFENDANTS
// ========================================================================

/**
 * GET /api/corporate-debts/farmer-paellmann
 * Get all 17 Farmer-Paellmann defendants from database
 */
router.get('/farmer-paellmann', async (req, res) => {
    try {
        const result = await sql`
            SELECT
                entity_id,
                modern_name,
                historical_name,
                entity_type,
                scac_paragraph_reference,
                documented_activity,
                involvement_category,
                self_concealment_alleged,
                misleading_statements_alleged,
                is_active,
                stock_ticker
            FROM corporate_entities
            WHERE is_farmer_paellmann_defendant = TRUE
            ORDER BY entity_type, modern_name
        `;

        res.json({
            success: true,
            count: result.length,
            defendants: result,
            legalReference: 'In re African-American Slave Descendants Litigation, 304 F. Supp. 2d 1027 (N.D. Ill. 2004)'
        });
    } catch (error) {
        console.error('Error fetching Farmer-Paellmann defendants:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/corporate-debts/farmer-paellmann/by-sector
 * Get defendants grouped by sector
 */
router.get('/farmer-paellmann/by-sector', async (req, res) => {
    try {
        const result = await sql`
            SELECT * FROM defendants_by_sector
        `;

        res.json({
            success: true,
            sectors: result
        });
    } catch (error) {
        console.error('Error fetching defendants by sector:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/corporate-debts/farmer-paellmann/calculate
 * Calculate debt for all Farmer-Paellmann defendants
 */
router.get('/farmer-paellmann/calculate', async (req, res) => {
    try {
        const system = getReparationsSystem();
        const result = system.calculateAllFarmerPaellmannDebt();

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Error calculating Farmer-Paellmann debt:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================================================
// INDIVIDUAL ENTITY ENDPOINTS
// ========================================================================

/**
 * GET /api/corporate-debts/entity/:entityId
 * Get details for a specific corporate entity
 */
router.get('/entity/:entityId', async (req, res) => {
    try {
        const { entityId } = req.params;

        const entity = await sql`
            SELECT * FROM corporate_entities
            WHERE entity_id = ${entityId}
        `;

        if (entity.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Entity not found'
            });
        }

        // Get succession chain
        const succession = await sql`
            SELECT * FROM corporate_succession
            WHERE successor_entity_id = ${entityId}
            ORDER BY succession_year
        `;

        // Get direct slaveholding
        const slaveholding = await sql`
            SELECT * FROM corporate_slaveholding
            WHERE entity_id = ${entityId}
        `;

        // Get financial instruments
        const instruments = await sql`
            SELECT * FROM corporate_financial_instruments
            WHERE issuer_entity_id = ${entityId}
            ORDER BY instrument_year
        `;

        res.json({
            success: true,
            entity: entity[0],
            succession,
            slaveholding,
            financialInstruments: instruments
        });
    } catch (error) {
        console.error('Error fetching entity:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/corporate-debts/entity/:entityId/debt
 * Calculate debt for a specific entity
 */
router.get('/entity/:entityId/debt', async (req, res) => {
    try {
        const { entityId } = req.params;

        const entity = await sql`
            SELECT * FROM corporate_entities
            WHERE entity_id = ${entityId}
        `;

        if (entity.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Entity not found'
            });
        }

        const e = entity[0];
        let calculation;

        // Use appropriate calculator based on entity type
        switch (e.entity_type) {
            case 'insurer':
                const insuranceCalc = new InsuranceCalculator();
                calculation = insuranceCalc.calculateCompanyDebt({
                    companyName: e.modern_name,
                    historicalName: e.historical_name,
                    policyType: 'life',
                    estimatedEnslaved: 5000, // Placeholder
                    activeYears: { start: 1850, end: 1865 }
                });
                break;

            case 'bank':
            case 'factor':
                const bankingCalc = new BankingCalculator();
                // Check for direct slaveholding first
                const holdings = await sql`
                    SELECT * FROM corporate_slaveholding
                    WHERE entity_id = ${entityId}
                `;
                if (holdings.length > 0) {
                    calculation = bankingCalc.calculatePlantationOwnership(holdings);
                } else {
                    calculation = bankingCalc.calculateCottonFactoring([{
                        advance_amount: 1000000, // Placeholder
                        instrument_year: 1850
                    }]);
                }
                break;

            case 'railroad':
                const railroadCalc = new RailroadCalculator();
                calculation = railroadCalc.calculateCompanyDebt({
                    companyName: e.modern_name,
                    historicalName: e.historical_name,
                    estimatedMiles: 2000, // Placeholder
                    estimatedEnslaved: 5000, // Placeholder
                    predecessorCount: 5,
                    activeYears: { start: 1840, end: 1865 }
                });
                break;

            default:
                calculation = {
                    modernValue: 0,
                    note: `No calculator available for entity type: ${e.entity_type}`
                };
        }

        res.json({
            success: true,
            entity: {
                id: e.entity_id,
                modernName: e.modern_name,
                historicalName: e.historical_name,
                type: e.entity_type,
                scacReference: e.scac_paragraph_reference
            },
            calculation
        });
    } catch (error) {
        console.error('Error calculating entity debt:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/corporate-debts/entity/:entityId/slaveholding
 * Get direct slaveholding records for an entity
 */
router.get('/entity/:entityId/slaveholding', async (req, res) => {
    try {
        const { entityId } = req.params;

        const result = await sql`
            SELECT * FROM corporate_slaveholding
            WHERE entity_id = ${entityId}
        `;

        res.json({
            success: true,
            holdings: result
        });
    } catch (error) {
        console.error('Error fetching slaveholding:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================================================
// LEADERBOARD AND SUMMARY
// ========================================================================

/**
 * GET /api/corporate-debts/leaderboard
 * Get ranked list of all corporate debtors
 */
router.get('/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const system = getReparationsSystem();

        // Calculate all debts first
        system.calculateAllFarmerPaellmannDebt();

        // Get leaderboard (corporate only)
        const leaderboard = system.debtTracker.getAllCorporateDebtors().slice(0, limit);

        res.json({
            success: true,
            count: leaderboard.length,
            leaderboard
        });
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/corporate-debts/leaderboard/combined
 * Get ranked list combining individuals and corporations
 */
router.get('/leaderboard/combined', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const system = getReparationsSystem();

        // Calculate corporate debts
        system.calculateAllFarmerPaellmannDebt();

        // Get combined leaderboard
        const leaderboard = system.debtTracker.getCombinedLeaderboard(limit);

        res.json({
            success: true,
            count: leaderboard.length,
            leaderboard
        });
    } catch (error) {
        console.error('Error fetching combined leaderboard:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/corporate-debts/summary
 * Get summary statistics for all corporate debt
 */
router.get('/summary', async (req, res) => {
    try {
        const system = getReparationsSystem();

        // Calculate all debts
        const farmerPaellmann = system.calculateAllFarmerPaellmannDebt();
        const combinedState = system.getCombinedSystemState();

        res.json({
            success: true,
            farmerPaellmann: farmerPaellmann.summary,
            bySector: farmerPaellmann.bySector,
            systemState: combinedState
        });
    } catch (error) {
        console.error('Error fetching summary:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================================================
// SECTOR-SPECIFIC ENDPOINTS
// ========================================================================

/**
 * GET /api/corporate-debts/sector/insurance
 * Calculate debt for all insurance defendants
 */
router.get('/sector/insurance', async (req, res) => {
    try {
        const calc = new InsuranceCalculator();
        const result = calc.getTotalInsuranceDebt();

        res.json({
            success: true,
            sector: 'insurance',
            ...result
        });
    } catch (error) {
        console.error('Error calculating insurance debt:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/corporate-debts/sector/banking
 * Calculate debt for all banking defendants
 */
router.get('/sector/banking', async (req, res) => {
    try {
        const calc = new BankingCalculator();
        const result = calc.getTotalBankingDebt();

        res.json({
            success: true,
            sector: 'banking',
            ...result
        });
    } catch (error) {
        console.error('Error calculating banking debt:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/corporate-debts/sector/railroads
 * Calculate debt for all railroad defendants
 */
router.get('/sector/railroads', async (req, res) => {
    try {
        const calc = new RailroadCalculator();
        const result = calc.getTotalRailroadDebt();

        res.json({
            success: true,
            sector: 'railroads',
            ...result
        });
    } catch (error) {
        console.error('Error calculating railroad debt:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================================================
// BROWN BROTHERS HARRIMAN SPECIFIC
// Most documented case from SCAC: 4,614 acres, 346 enslaved
// ========================================================================

/**
 * GET /api/corporate-debts/brown-brothers-harriman
 * Get detailed calculation for BBH (most documented defendant)
 */
router.get('/brown-brothers-harriman', async (req, res) => {
    try {
        const calc = new BankingCalculator();
        const result = calc.calculateBrownBrothersHarrimanDebt();

        // Also get from database
        const entity = await sql`
            SELECT * FROM corporate_entities
            WHERE modern_name = 'Brown Brothers Harriman & Company'
        `;

        const slaveholding = await sql`
            SELECT * FROM corporate_slaveholding
            WHERE entity_name = 'Brown Brothers & Co.'
        `;

        res.json({
            success: true,
            entity: entity[0],
            slaveholding: slaveholding[0],
            calculation: result,
            documentation: result.documentation,
            scacReference: '¶¶ 145-152'
        });
    } catch (error) {
        console.error('Error fetching BBH data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
