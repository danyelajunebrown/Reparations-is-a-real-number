/**
 * Blockchain API Routes
 *
 * Provides API endpoints for interacting with the ReparationsEscrow
 * smart contract deployed on Base Mainnet.
 *
 * Contract: 0x914846ceA07e57d848d9d60C8238865D83d9ab1E
 * Network:  Base Mainnet (chain 8453)
 *
 * Endpoints:
 *   GET  /api/blockchain/status          — Contract status + stats
 *   GET  /api/blockchain/record/:id      — Get on-chain record
 *   POST /api/blockchain/submit          — Submit DAA record on-chain
 *   GET  /api/blockchain/debt/:id        — Get remaining debt
 *   GET  /api/blockchain/config          — Frontend config (contract address, ABI, chain)
 */

const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load deployment config
const DEPLOYMENT_PATH = path.resolve(__dirname, '../../../deployments/base-deployment.json');
const ABI_PATH = path.resolve(__dirname, '../../../deployments/ReparationsEscrow-abi.json');

let deployment = null;
let abi = null;
let provider = null;
let contract = null;

function getContract() {
    if (contract) return contract;

    try {
        deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf-8'));
        abi = JSON.parse(fs.readFileSync(ABI_PATH, 'utf-8'));
        provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
        contract = new ethers.Contract(deployment.contractAddress, abi, provider);
        return contract;
    } catch (err) {
        console.error('[blockchain] Failed to initialize contract:', err.message);
        return null;
    }
}

/**
 * Get a signer for write operations (server-side)
 * This uses the deployer key for automated operations like recording DAAs.
 * Participant deposits happen client-side via MetaMask.
 */
function getSigner() {
    if (!process.env.DEPLOYER_PRIVATE_KEY) return null;
    if (!provider) getContract();
    return new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
}

// ── Read Endpoints ──────────────────────────────────────────────────

/**
 * GET /api/blockchain/status
 * Contract status and statistics
 */
router.get('/status', async (req, res) => {
    try {
        const c = getContract();
        if (!c) {
            return res.json({
                success: true,
                deployed: false,
                message: 'Blockchain contract not configured'
            });
        }

        const nextRecordId = await c.nextRecordId();
        const owner = await c.owner();
        const paused = await c.paused();

        res.json({
            success: true,
            deployed: true,
            contract: {
                address: deployment.contractAddress,
                network: 'Base Mainnet',
                chainId: 8453,
                explorer: deployment.explorerUrl,
                owner,
                paused,
                totalRecords: Number(nextRecordId) - 1,
                usdcAddress: deployment.usdcAddress
            }
        });
    } catch (error) {
        console.error('[blockchain] Status error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/blockchain/config
 * Frontend configuration — contract address, ABI, chain info
 * This is what the frontend needs to interact with the contract via MetaMask
 */
router.get('/config', async (req, res) => {
    try {
        if (!deployment || !abi) getContract();

        res.json({
            success: true,
            contractAddress: deployment?.contractAddress || null,
            chainId: 8453,
            chainName: 'Base',
            rpcUrl: 'https://mainnet.base.org',
            explorerUrl: 'https://basescan.org',
            usdcAddress: deployment?.usdcAddress || null,
            abi: abi || [],
            networkParams: {
                chainId: '0x2105', // 8453 in hex
                chainName: 'Base',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://mainnet.base.org'],
                blockExplorerUrls: ['https://basescan.org']
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/blockchain/record/:id
 * Get an on-chain ancestry record
 */
router.get('/record/:id', async (req, res) => {
    try {
        const c = getContract();
        if (!c) return res.status(503).json({ success: false, error: 'Contract not configured' });

        const recordId = parseInt(req.params.id);
        const record = await c.getRecord(recordId);

        res.json({
            success: true,
            record: {
                ancestorName: record.ancestorName,
                familySearchId: record.familySearchId,
                totalReparationsOwed: ethers.formatUnits(record.totalReparationsOwed, 6), // USDC decimals
                totalDeposited: ethers.formatUnits(record.totalDeposited, 6),
                totalPaid: ethers.formatUnits(record.totalPaid, 6),
                historicalPaymentsReceived: ethers.formatUnits(record.historicalPaymentsReceived, 6),
                submitter: record.submitter,
                verified: record.verified
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/blockchain/debt/:id
 * Get remaining debt for a record
 */
router.get('/debt/:id', async (req, res) => {
    try {
        const c = getContract();
        if (!c) return res.status(503).json({ success: false, error: 'Contract not configured' });

        const recordId = parseInt(req.params.id);
        const remaining = await c.getRemainingDebt(recordId);
        const settled = await c.isDebtSettled(recordId);

        res.json({
            success: true,
            recordId,
            remainingDebt: ethers.formatUnits(remaining, 6),
            isSettled: settled
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Write Endpoints (server-side, using deployer key) ───────────────

/**
 * POST /api/blockchain/submit
 * Submit a DAA record on-chain (called by DAAOrchestrator after generating a DAA)
 *
 * Body: {
 *   ancestorName: string,
 *   familySearchId: string,
 *   genealogyHash: string (IPFS hash or document hash),
 *   totalReparationsOwed: number (in USDC, 6 decimals),
 *   notes: string
 * }
 */
router.post('/submit', async (req, res) => {
    try {
        const signer = getSigner();
        if (!signer) {
            return res.status(503).json({
                success: false,
                error: 'Server-side signing not configured. Participant must submit via MetaMask.'
            });
        }

        const c = getContract();
        if (!c) return res.status(503).json({ success: false, error: 'Contract not configured' });

        const { ancestorName, familySearchId, genealogyHash, totalReparationsOwed, notes } = req.body;

        if (!ancestorName) return res.status(400).json({ success: false, error: 'ancestorName required' });

        // Convert to contract-compatible values
        const amount = ethers.parseUnits(String(totalReparationsOwed || '0'), 6); // USDC 6 decimals
        const docHash = ethers.keccak256(ethers.toUtf8Bytes(genealogyHash || 'pending'));

        const contractWithSigner = c.connect(signer);
        const tx = await contractWithSigner.submitAncestryRecord(
            ancestorName,
            familySearchId || '',
            docHash,
            amount,
            notes || ''
        );

        const receipt = await tx.wait();

        // Extract record ID from event
        const event = receipt.logs.find(log => {
            try {
                return c.interface.parseLog(log)?.name === 'AncestryRecordSubmitted';
            } catch { return false; }
        });

        const recordId = event ? c.interface.parseLog(event).args[0] : null;

        res.json({
            success: true,
            recordId: recordId ? Number(recordId) : null,
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            explorerUrl: `https://basescan.org/tx/${receipt.hash}`
        });
    } catch (error) {
        console.error('[blockchain] Submit error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/blockchain/verify/:id
 * Verify an on-chain record (verifier only)
 */
router.post('/verify/:id', async (req, res) => {
    try {
        const signer = getSigner();
        if (!signer) return res.status(503).json({ success: false, error: 'Signer not configured' });

        const c = getContract();
        const contractWithSigner = c.connect(signer);

        const tx = await contractWithSigner.verifyAncestryRecord(parseInt(req.params.id));
        const receipt = await tx.wait();

        res.json({
            success: true,
            transactionHash: receipt.hash,
            explorerUrl: `https://basescan.org/tx/${receipt.hash}`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/blockchain/update-amount/:id
 * Update reparations owed (revisable DAA)
 *
 * Body: { newAmount: number, reason: string }
 */
router.post('/update-amount/:id', async (req, res) => {
    try {
        const signer = getSigner();
        if (!signer) return res.status(503).json({ success: false, error: 'Signer not configured' });

        const c = getContract();
        const contractWithSigner = c.connect(signer);

        const { newAmount, reason } = req.body;
        const amount = ethers.parseUnits(String(newAmount), 6);

        const tx = await contractWithSigner.updateReparationsOwed(
            parseInt(req.params.id),
            amount,
            reason || 'Methodology revision'
        );
        const receipt = await tx.wait();

        res.json({
            success: true,
            transactionHash: receipt.hash,
            explorerUrl: `https://basescan.org/tx/${receipt.hash}`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
