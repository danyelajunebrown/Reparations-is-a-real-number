/**
 * Legal Precedent API Routes
 * 
 * Exposes Triangle Trade legal framework for DAA generation and frontend queries.
 * 
 * Endpoints:
 * - GET /precedents - All legal precedents ranked by strength
 * - GET /uk-1833 - UK loan precedent (primary)
 * - GET /haiti - Haiti inverse debt (counter-precedent)
 * - GET /farmer-paellmann - Strategic lessons from failure
 * - GET /jurisdictions - All Triangle Trade jurisdictions
 * - GET /jurisdictions/:country - Specific jurisdiction details
 * - GET /doctrines - All legal doctrines
 * - GET /mechanisms - Garnishment mechanisms by strategy
 * - GET /daa-citations/:jurisdiction/:defendantType - Build DAA citations
 * - GET /framework-summary - Comprehensive overview
 */

const express = require('express');
const router = express.Router();
const LegalPrecedentService = require('../../services/reparations/LegalPrecedentService');

const service = new LegalPrecedentService();

// =========================================================================
// CORE PRECEDENT ENDPOINTS
// =========================================================================

/**
 * GET /api/legal/precedents
 * Get all legal precedents ranked by strength
 */
router.get('/precedents', async (req, res) => {
    try {
        const precedents = await service.getPrecedentsByStrength();
        res.json({
            success: true,
            count: precedents.length,
            precedents,
            note: 'UK 1833 is PRIMARY - proves 182-year debt collection possible'
        });
    } catch (error) {
        console.error('Error fetching precedents:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/legal/uk-1833
 * UK 1833 Compensation Loan - PRIMARY PRECEDENT
 * Key fact: Paid off in 2015, proving multi-generational debt enforcement
 */
router.get('/uk-1833', async (req, res) => {
    try {
        const uk1833 = await service.getUK1833Precedent();
        res.json({
            success: true,
            data: uk1833,
            keyArguments: [
                'Government enforced 182 years of payments for slavery debt',
                'Descendants of enslaved in UK paid taxes toward this until 2015',
                'Proves "too much time" argument is legally invalid',
                'Same mechanism can apply in reverse direction'
            ],
            citation: 'Slavery Abolition Act 1833 (3 & 4 Will. IV c. 73)'
        });
    } catch (error) {
        console.error('Error fetching UK 1833 precedent:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/legal/haiti
 * Haiti Independence Debt - COUNTER-PRECEDENT
 * Key fact: $21 billion extorted FROM victims for their own freedom
 */
router.get('/haiti', async (req, res) => {
    try {
        const haiti = await service.getHaitiInverseDebt();
        res.json({
            success: true,
            data: haiti,
            keyArguments: [
                'France forced Haiti to pay $21 billion (modern value) for freedom they WON',
                'Proves reparations logic was APPLIED - just against the wrong party',
                'If France could calculate value of "lost property", we can calculate stolen labor',
                'Haiti finished paying in 1947 - compound interest was applied for 122 years'
            ],
            citation: 'Royal Ordinance of Charles X (April 17, 1825)'
        });
    } catch (error) {
        console.error('Error fetching Haiti precedent:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/legal/farmer-paellmann
 * Farmer-Paellmann Analysis - STRATEGIC LESSONS
 * Understanding why 2004 case failed and what has changed
 */
router.get('/farmer-paellmann', async (req, res) => {
    try {
        const analysis = await service.getFarmerPaellmannAnalysis();
        res.json({
            success: true,
            data: analysis,
            summary: {
                outcome: 'Dismissed (2004)',
                mainFailures: ['Standing', 'Statute of Limitations', 'Political Question'],
                changedCircumstances: [
                    'UK finished paying 1833 loan in 2015',
                    'Netherlands paid €200M in 2023',
                    'Corporate acknowledgments (JPMorgan 2005)',
                    'Genealogy technology enables precise lineage documentation'
                ],
                ourStrategy: 'Individual DAAs avoid class action standing issues'
            }
        });
    } catch (error) {
        console.error('Error fetching Farmer-Paellmann analysis:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// JURISDICTION ENDPOINTS
// =========================================================================

/**
 * GET /api/legal/jurisdictions
 * All Triangle Trade jurisdictions with strategy recommendations
 */
router.get('/jurisdictions', async (req, res) => {
    try {
        const jurisdictions = await service.getAllJurisdictions();
        res.json({
            success: true,
            count: jurisdictions.length,
            jurisdictions,
            note: 'All Triangle Trade participants: UK, France, Haiti, US, Spain, Netherlands, Portugal'
        });
    } catch (error) {
        console.error('Error fetching jurisdictions:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/legal/jurisdictions/:country
 * Specific jurisdiction details with applicable legal texts
 */
router.get('/jurisdictions/:country', async (req, res) => {
    try {
        const { country } = req.params;
        const [jurisdiction, legalTexts, doctrines] = await Promise.all([
            service.getJurisdiction(country),
            service.getLegalTextsByJurisdiction(country),
            service.getDoctrinesForJurisdiction(country)
        ]);

        if (!jurisdiction) {
            return res.status(404).json({ 
                success: false, 
                error: `Jurisdiction not found: ${country}`,
                available: ['United Kingdom', 'France', 'Haiti', 'United States', 'Spain', 'Netherlands', 'Portugal']
            });
        }

        res.json({
            success: true,
            jurisdiction,
            legalTexts,
            applicableDoctrines: doctrines
        });
    } catch (error) {
        console.error('Error fetching jurisdiction:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// LEGAL DOCTRINE ENDPOINTS
// =========================================================================

/**
 * GET /api/legal/doctrines
 * All legal doctrines applicable to reparations claims
 */
router.get('/doctrines', async (req, res) => {
    try {
        const doctrines = await service.getAllDoctrines();
        res.json({
            success: true,
            count: doctrines.length,
            doctrines,
            primary: [
                'Unjust Enrichment - Restatement (Third) of Restitution (2011)',
                'Constructive Trust - Equity doctrine for wrongfully held property',
                'Successor Liability - Corporate acquisition responsibility',
                'Badges and Incidents of Slavery - 13th Amendment (US)'
            ]
        });
    } catch (error) {
        console.error('Error fetching doctrines:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// GARNISHMENT MECHANISM ENDPOINTS
// =========================================================================

/**
 * GET /api/legal/mechanisms
 * Garnishment mechanisms ordered by our strategic position
 */
router.get('/mechanisms', async (req, res) => {
    try {
        const mechanisms = await service.getGarnishmentMechanisms();
        res.json({
            success: true,
            count: mechanisms.length,
            mechanisms,
            strategy: {
                primary: 'Individual DAAs (A) - our way in, avoids Farmer-Paellmann standing issues',
                secondary: 'Class action (B) - always thinking class action, but need individual wins first',
                ultimateGoal: 'Government taxation (C) - per Mullen/Darity, ONLY ethical mechanism',
                note: 'A is entry point; C is the correct answer'
            }
        });
    } catch (error) {
        console.error('Error fetching mechanisms:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/legal/mechanisms/:defendantType
 * Mechanisms for specific defendant type (individual, corporation, government)
 */
router.get('/mechanisms/:defendantType', async (req, res) => {
    try {
        const { defendantType } = req.params;
        const mechanisms = await service.getMechanismByDefendantType(defendantType);
        
        if (!mechanisms.length) {
            return res.status(404).json({
                success: false,
                error: `No mechanisms found for defendant type: ${defendantType}`,
                available: ['individual', 'corporation', 'government']
            });
        }

        res.json({
            success: true,
            defendantType,
            mechanisms
        });
    } catch (error) {
        console.error('Error fetching mechanism by defendant type:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// DAA CITATION BUILDER
// =========================================================================

/**
 * GET /api/legal/daa-citations/:jurisdiction/:defendantType
 * Build complete legal citation package for a DAA
 * 
 * @param jurisdiction - Country name (United States, United Kingdom, France, etc.)
 * @param defendantType - individual, corporation, or government
 */
router.get('/daa-citations/:jurisdiction/:defendantType', async (req, res) => {
    try {
        const { jurisdiction, defendantType } = req.params;
        const citations = await service.buildDAALegalCitations(jurisdiction, defendantType);

        res.json({
            success: true,
            jurisdiction,
            defendantType,
            citations,
            usage: 'Include these citations in DAA generation for legal grounding'
        });
    } catch (error) {
        console.error('Error building DAA citations:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// FRAMEWORK SUMMARY
// =========================================================================

/**
 * GET /api/legal/framework-summary
 * Comprehensive overview of legal framework
 */
router.get('/framework-summary', async (req, res) => {
    try {
        const summary = await service.getFrameworkSummary();
        res.json({
            success: true,
            summary,
            keyInsights: [
                'UK 1833 loan (paid 2015) proves multi-generational debt enforcement is possible',
                'Haiti inverse debt proves reparations logic was APPLIED against victims',
                'Netherlands 2023 proves ongoing obligation recognized by modern governments',
                'Farmer-Paellmann teaches us to avoid class action standing issues',
                'Individual DAAs are entry point; government taxation is ultimate goal'
            ]
        });
    } catch (error) {
        console.error('Error fetching framework summary:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// ESCROW ENDPOINTS
// =========================================================================

/**
 * POST /api/legal/escrow
 * Create escrow record when payment received
 * "We will cross that bridge when somebody bites"
 */
router.post('/escrow', async (req, res) => {
    try {
        const { debtorName, debtorType, amount, daaId } = req.body;

        if (!debtorName || !debtorType || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Required fields: debtorName, debtorType, amount'
            });
        }

        const escrow = await service.createEscrowRecord(debtorName, debtorType, amount, daaId);
        res.json({
            success: true,
            message: 'Escrow record created - someone bit!',
            escrow
        });
    } catch (error) {
        console.error('Error creating escrow:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/legal/escrow/:status
 * Get escrow records by status
 */
router.get('/escrow/:status', async (req, res) => {
    try {
        const { status } = req.params;
        const escrows = await service.getEscrowByStatus(status);
        res.json({
            success: true,
            status,
            count: escrows.length,
            escrows
        });
    } catch (error) {
        console.error('Error fetching escrow records:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
