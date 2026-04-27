/**
 * DAA Generation API
 *
 * Wraps DAAOrchestrator.generateComprehensiveDAA so DAA creation can be
 * triggered over HTTP rather than only via scripts/generate-comprehensive-daa.js.
 *
 * When called with `participantId`, hydrates `acknowledgerInfo` from the
 * `participants` row — including the M037 wealth-fingerprint columns that
 * the calculators expect but the script CLI never passed in. (Partial fix
 * toward issue #40; full fix requires calculators to re-read the row.)
 */

const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const DAAGenerator = require('../../services/reparations/DAAGenerator');
const DAADocumentGenerator = require('../../services/reparations/DAADocumentGenerator');
const DAAOrchestrator = require('../../services/reparations/DAAOrchestrator');
const { DAAProbateGateError } = require('../../services/reparations/DAAOrchestrator');

let _orchestrator = null;
function getOrchestrator() {
    if (!_orchestrator) {
        const daaGenerator = new DAAGenerator(db);
        const documentGenerator = new DAADocumentGenerator();
        _orchestrator = new DAAOrchestrator(db, daaGenerator, documentGenerator);
    }
    return _orchestrator;
}

async function hydrateFromParticipant(participantId) {
    const r = await db.query(`SELECT * FROM participants WHERE id = $1 LIMIT 1`, [participantId]);
    if (r.rowCount === 0) return null;
    const p = r.rows[0];
    return {
        name: p.full_name,
        email: p.email,
        address: (p.address_line1 || p.address_city) ? {
            line1: p.address_line1, city: p.address_city, state: p.address_state, zip: p.address_zip,
        } : null,
        annualIncome:        Number(p.annual_income) || 0,
        netWorth:            Number(p.estimated_net_worth) || 0,
        realEstateEquity:    Number(p.real_estate_equity) || 0,
        inheritanceReceived: Number(p.inheritance_received) || 0,
        inheritanceExpected: Number(p.inheritance_expected) || 0,
        corporateConnectionType: p.corporate_connection_type || 'none',
        corporateConnections:    p.corporate_connections || [],
        trustCorpus:         Number(p.trust_corpus) || 0,
        trustBeneficiary:    p.trust_beneficiary || 'no',
        inheritedLandAcres:  p.inherited_land_acres || 'none',
        familySearchId:      p.self_fs_id || null,
        _participantRow:     p,
    };
}

// POST /api/daa/generate
// Body (one of):
//   { participantId: uuid, sessionId?: uuid, submitOnChain?: bool }
//   { familySearchId, name, email?, address?, annualIncome, sessionId?, submitOnChain?, ...wealthFields }
router.post('/generate', async (req, res) => {
    const body = req.body || {};
    const submitOnChain = body.submitOnChain === true;

    let acknowledgerInfo;
    let familySearchId = body.familySearchId || null;
    let participantRow = null;

    try {
        if (body.participantId) {
            const hydrated = await hydrateFromParticipant(body.participantId);
            if (!hydrated) return res.status(404).json({ success: false, error: 'participant not found' });
            acknowledgerInfo = hydrated;
            participantRow = hydrated._participantRow;
            familySearchId = familySearchId || hydrated.familySearchId;
        } else {
            if (!body.name) return res.status(400).json({ success: false, error: 'name required (or pass participantId)' });
            acknowledgerInfo = {
                name: body.name,
                email: body.email || null,
                address: body.address || null,
                annualIncome: Number(body.annualIncome) || 0,
                netWorth: Number(body.netWorth) || 0,
                realEstateEquity: Number(body.realEstateEquity) || 0,
                inheritanceReceived: Number(body.inheritanceReceived) || 0,
                inheritanceExpected: Number(body.inheritanceExpected) || 0,
                corporateConnectionType: body.corporateConnectionType || 'none',
                corporateConnections:    body.corporateConnections || [],
                trustCorpus: Number(body.trustCorpus) || 0,
                trustBeneficiary: body.trustBeneficiary || 'no',
                inheritedLandAcres: body.inheritedLandAcres || 'none',
            };
        }

        if (!familySearchId) {
            return res.status(400).json({ success: false, error: 'familySearchId required (either in body or on participant.self_fs_id)' });
        }

        const orchestrator = getOrchestrator();
        const result = await orchestrator.generateComprehensiveDAA(
            familySearchId,
            acknowledgerInfo,
            body.sessionId || null,
        );

        // Optional on-chain submission. Only fires when DEPLOYER_PRIVATE_KEY
        // is configured and submitOnChain=true. Failures here are reported
        // separately; the DAA record itself was already saved.
        let onchain = null;
        if (submitOnChain) {
            try {
                onchain = await submitDAAOnChain(result, acknowledgerInfo);
            } catch (e) {
                onchain = { success: false, error: e.message };
            }
        }

        // Link DAA to participant if we have one (idempotent; PK is
        // (participant_id, daa_id) per migration 036).
        if (participantRow && result?.daaRecord?.daaId) {
            await db.query(
                `INSERT INTO participant_daas (participant_id, daa_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [participantRow.id, result.daaRecord.daaId],
            ).catch(() => {});
        }

        return res.json({
            success: true,
            daaId: result.daaRecord.daaId,
            agreementNumber: result.daaRecord.agreementNumber,
            docxPath: result.docxPath,
            slaveholderCount: result.slaveholderData.length,
            enslavedCount: result.debtCalculation.totalEnslavedCount,
            totalDebt: result.debtCalculation.totalDebt,
            recommendedDebt: result.debtCalculation.recommendedDebt,
            annualPayment: result.debtCalculation.annualPayment,
            onchain,
        });
    } catch (error) {
        if (error instanceof DAAProbateGateError || error.code === 'DAA_PROBATE_GATE') {
            return res.status(422).json({ success: false, code: 'DAA_PROBATE_GATE', error: error.message });
        }
        if (/Ancestor climb required|Climb session in progress/.test(error.message)) {
            return res.status(409).json({ success: false, code: 'CLIMB_REQUIRED', error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Internal helper. Mirrors src/api/routes/blockchain.js POST /submit but
// callable in-process so we don't need an HTTP round-trip from this handler
// to itself. Returns { success, recordId, transactionHash, explorerUrl } or
// { success:false, error } when the deployer key isn't configured.
async function submitDAAOnChain(daaResult, acknowledgerInfo) {
    if (!process.env.DEPLOYER_PRIVATE_KEY) {
        return { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured — server-side submission disabled' };
    }
    const { ethers } = require('ethers');
    const fs = require('fs');
    const path = require('path');

    const deployment = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '../../../deployments/base-deployment.json'), 'utf-8'));
    const abi = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '../../../deployments/ReparationsEscrow-abi.json'), 'utf-8'));

    const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
    const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(deployment.contractAddress, abi, signer);

    const totalOwed = daaResult.debtCalculation.recommendedDebt || daaResult.debtCalculation.totalDebt || 0;
    const ancestorName = daaResult.daaRecord.slaveholderName || daaResult.slaveholderData?.[0]?.slaveholder?.slaveholder_name || acknowledgerInfo.name;
    const fsIdForRecord = daaResult.slaveholderData?.[0]?.slaveholder?.slaveholder_fs_id || '';
    const docHash = ethers.keccak256(ethers.toUtf8Bytes(daaResult.daaRecord.daaId || daaResult.docxPath || 'pending'));
    const amount = ethers.parseUnits(String(totalOwed.toFixed(2)), 6);
    const notes = `DAA ${daaResult.daaRecord.agreementNumber || daaResult.daaRecord.daaId}`;

    const tx = await contract.submitAncestryRecord(ancestorName, fsIdForRecord, docHash, amount, notes);
    const receipt = await tx.wait();

    const event = receipt.logs.find(l => {
        try { return contract.interface.parseLog(l)?.name === 'AncestryRecordSubmitted'; }
        catch { return false; }
    });
    const recordId = event ? Number(contract.interface.parseLog(event).args[0]) : null;

    return {
        success: true,
        recordId,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        explorerUrl: `https://basescan.org/tx/${receipt.hash}`,
    };
}

module.exports = router;
module.exports._submitDAAOnChain = submitDAAOnChain;
