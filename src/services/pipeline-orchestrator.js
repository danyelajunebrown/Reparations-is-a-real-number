/**
 * Pipeline Orchestrator
 *
 * Advances a participant one stage at a time through:
 *   intake_pending_review
 *     → climb_in_progress     (climb spawned, session row exists)
 *     → climb_complete        (ancestor_climb_sessions.status='completed')
 *     → verification_complete (MatchVerifier ran on session matches)
 *     → daa_generated         (DAAOrchestrator produced a daaRecord)
 *     → daa_submitted_onchain (blockchain submit returned a recordId)
 *
 * State is stored as tags appended to participants.roles[]. Append-only
 * and idempotent: calling advance() twice from the same state is safe.
 *
 * What this orchestrator does NOT do:
 *   - Trigger the FamilySearch climber. The climber needs interactive
 *     Chrome + FS login on the host machine; it's started by hand or via
 *     POST /api/ancestor-climb/start. Once a session exists and reaches
 *     status='completed', advance() picks it up.
 *   - Run on a timer. Each call advances at most one stage. A cron or
 *     manual call drives progress.
 */

const db = require('../database/connection');
const daaRoute = require('../api/routes/daa');
const MatchVerifier = require('./match-verification');

const PIPELINE_STATES = [
    'intake_pending_review',
    'climb_in_progress',
    'climb_complete',
    'verification_complete',
    'daa_generated',
    'daa_submitted_onchain',
];

function currentState(roles) {
    if (!Array.isArray(roles) || roles.length === 0) return null;
    for (let i = PIPELINE_STATES.length - 1; i >= 0; i--) {
        if (roles.includes(PIPELINE_STATES[i])) return PIPELINE_STATES[i];
    }
    return null;
}

async function appendRole(participantId, role, dryRun = false) {
    if (dryRun) return;
    await db.query(
        `UPDATE participants
         SET roles = (
             SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(roles, ARRAY[]::text[]) || $2::text))
         ),
             updated_at = NOW()
         WHERE id = $1`,
        [participantId, role],
    );
}

async function findClimbSession(participant) {
    if (participant.self_fs_id) {
        const r = await db.query(
            `SELECT id, status, modern_person_fs_id, modern_person_name, ancestors_visited, matches_found
             FROM ancestor_climb_sessions
             WHERE modern_person_fs_id = $1
             ORDER BY started_at DESC LIMIT 1`,
            [participant.self_fs_id],
        );
        if (r.rowCount > 0) return r.rows[0];
    }
    const byLink = await db.query(
        `SELECT s.id, s.status, s.modern_person_fs_id, s.modern_person_name, s.ancestors_visited, s.matches_found
         FROM participant_climb_sessions pcs
         JOIN ancestor_climb_sessions s ON s.id = pcs.session_id
         WHERE pcs.participant_id = $1
         ORDER BY s.started_at DESC LIMIT 1`,
        [participant.id],
    );
    if (byLink.rowCount > 0) return byLink.rows[0];

    // Case-insensitive name match — climb sessions sometimes record names in
    // different casing than the participants row (e.g. kiosk-source sessions
    // store ALL CAPS like 'ADRIAN BROWN' while the form intake stores
    // 'Adrian Brown'). LOWER() comparison catches that.
    if (participant.full_name) {
        const byName = await db.query(
            `SELECT id, status, modern_person_fs_id, modern_person_name, ancestors_visited, matches_found
             FROM ancestor_climb_sessions
             WHERE LOWER(modern_person_name) = LOWER($1)
             ORDER BY started_at DESC LIMIT 1`,
            [participant.full_name],
        );
        if (byName.rowCount > 0) return byName.rows[0];
    }
    return null;
}

async function runVerification(sessionId) {
    const { sql } = require('../database/connection');
    const verifier = new MatchVerifier(sql);
    const matches = await sql`
        SELECT * FROM ancestor_climb_matches
        WHERE session_id = ${sessionId}::uuid
          AND (classification IS NULL OR classification IN ('unverified', 'debt'))
        ORDER BY generation_distance ASC
    `;
    const stats = { total: matches.length, reclassified: 0, errors: 0 };
    for (const m of matches) {
        try {
            const verdict = await verifier.verify(
                {
                    name: m.slaveholder_name,
                    birth_year: m.slaveholder_birth_year,
                    fs_id: m.slaveholder_fs_id,
                    locations: m.slaveholder_location ? [m.slaveholder_location] : [],
                    race_indicators: [],
                },
                {
                    canonical_name: m.slaveholder_name,
                    slaveholder_name: m.slaveholder_name,
                    slaveholder_fs_id: m.slaveholder_fs_id,
                    birth_year_estimate: m.slaveholder_birth_year,
                    confidence: parseFloat(m.match_confidence) || 0.50,
                    type: m.match_type,
                },
                m.generation_distance || 0,
            );
            const changed = (m.classification || 'debt') !== verdict.classification;
            if (changed) {
                await sql`
                    UPDATE ancestor_climb_matches
                    SET classification = ${verdict.classification},
                        classification_reason = ${verdict.evidence.map(e => e.detail).join('; ') || 'pipeline-orchestrator'},
                        verification_status = ${verdict.requires_human_review ? 'needs_review' : 'auto_verified'},
                        verification_evidence = ${JSON.stringify(verdict.evidence)},
                        confidence_adjusted = ${verdict.confidence_adjusted},
                        requires_human_review = ${verdict.requires_human_review},
                        review_reason = ${verdict.review_reason}
                    WHERE id = ${m.id}
                `;
                stats.reclassified++;
            }
        } catch (e) {
            stats.errors++;
        }
    }
    return stats;
}

async function advance(participantId, opts = {}) {
    const dryRun = opts.dryRun === true;
    const r = await db.query(`SELECT * FROM participants WHERE id = $1 LIMIT 1`, [participantId]);
    if (r.rowCount === 0) throw new Error(`participant ${participantId} not found`);
    const participant = r.rows[0];
    const from = currentState(participant.roles);

    // Sync climb state from ancestor_climb_sessions before deciding.
    // The climber is owned by an external process; pipeline tags can lag
    // behind reality. We promote → climb_complete (or climb_in_progress)
    // here when the session row reflects new state, without requiring a
    // separate API call to do so.
    //
    // We accept `from === null` because participants imported via kiosk
    // or manual flows often have non-pipeline roles like 'enslaver_descendant'
    // and no pipeline tag at all. Without this, a participant with a
    // completed climb but no pipeline tag would be stuck forever.
    const session = await findClimbSession(participant);
    const PRE_CLIMB_STATES = new Set([null, 'intake_pending_review', 'climb_in_progress']);
    if (session?.status === 'completed' && PRE_CLIMB_STATES.has(from)) {
        await appendRole(participantId, 'climb_complete', dryRun);
        return { participantId, from, to: 'climb_complete', sessionId: session.id, output: { matches_found: session.matches_found } };
    }
    if (session && session.status !== 'completed' && (from === null || from === 'intake_pending_review')) {
        await appendRole(participantId, 'climb_in_progress', dryRun);
        return { participantId, from, to: 'climb_in_progress', sessionId: session.id, output: { status: session.status } };
    }

    const state = currentState(participant.roles);

    if (state === null || state === 'intake_pending_review') {
        return {
            participantId, from: state, to: state, blocked: true,
            reason: 'No climb session yet. Start one via POST /api/ancestor-climb/start, then call advance again.',
        };
    }

    if (state === 'climb_in_progress') {
        return {
            participantId, from: state, to: state, blocked: true,
            reason: `Climb session ${session?.id || '(unknown)'} status=${session?.status || 'unknown'} — waiting for completion.`,
        };
    }

    if (state === 'climb_complete') {
        if (!session?.id) {
            return { participantId, from: state, to: state, blocked: true, reason: 'climb_complete tag set but no session row found' };
        }
        const verifyStats = dryRun ? { dryRun: true, would_run: true } : await runVerification(session.id);
        await appendRole(participantId, 'verification_complete', dryRun);
        return { participantId, from: state, to: 'verification_complete', sessionId: session.id, output: verifyStats, dryRun };
    }

    if (state === 'verification_complete') {
        if (!session?.modern_person_fs_id) {
            return { participantId, from: state, to: state, blocked: true, reason: 'session has no modern_person_fs_id; DAA needs an FS ID' };
        }
        if (dryRun) {
            return { participantId, from: state, to: 'daa_generated', dryRun: true, output: { would_call: 'POST /api/daa/generate', sessionId: session.id, fs: session.modern_person_fs_id } };
        }
        const fakeReq = {
            body: { participantId, sessionId: session.id, familySearchId: session.modern_person_fs_id, submitOnChain: false },
        };
        const result = await invokeRouteHandler(daaRoute, 'post', '/generate', fakeReq);
        if (!result.success) {
            return { participantId, from: state, to: state, blocked: true, reason: result.error, code: result.code };
        }
        await appendRole(participantId, 'daa_generated', dryRun);
        return { participantId, from: state, to: 'daa_generated', output: result };
    }

    if (state === 'daa_generated') {
        if (!process.env.DEPLOYER_PRIVATE_KEY) {
            return {
                participantId, from: state, to: state, blocked: true,
                reason: 'DEPLOYER_PRIVATE_KEY not set — on-chain submission requires server-side signer or participant MetaMask flow.',
            };
        }
        // Load the most recent DAA for this participant. We submit *that*
        // record on-chain rather than re-invoking /api/daa/generate, which
        // would create a duplicate DAA row (DAAGenerator.generateDAA always
        // INSERTs).
        const daaRow = await db.query(
            `SELECT daa.daa_id, daa.agreement_number, daa.acknowledger_name,
                    daa.slaveholder_name, daa.slaveholder_familysearch_id,
                    daa.total_debt
             FROM participant_daas pd
             JOIN debt_acknowledgment_agreements daa ON daa.daa_id = pd.daa_id
             WHERE pd.participant_id = $1
             ORDER BY daa.created_at DESC LIMIT 1`,
            [participantId],
        );
        if (daaRow.rowCount === 0) {
            return { participantId, from: state, to: state, blocked: true, reason: 'no DAA linked to participant' };
        }
        const daa = daaRow.rows[0];
        if (dryRun) {
            return { participantId, from: state, to: 'daa_submitted_onchain', dryRun: true, output: { would_submit_daa: daa.daa_id, agreement: daa.agreement_number, total_debt: daa.total_debt } };
        }
        const onchain = await submitExistingDAAOnChain(daa);
        if (!onchain.success) {
            return { participantId, from: state, to: state, blocked: true, reason: onchain.error, output: onchain };
        }
        await appendRole(participantId, 'daa_submitted_onchain', dryRun);
        return { participantId, from: state, to: 'daa_submitted_onchain', output: onchain };
    }

    if (state === 'daa_submitted_onchain') {
        return { participantId, from: state, to: state, terminal: true, reason: 'pipeline complete; payments occur via participant deposits' };
    }

    return { participantId, from: state, to: state, blocked: true, reason: `unknown state ${state}` };
}

// Express routers don't expose handlers directly. We resolve the handler
// stack for a given METHOD+PATH and invoke the last middleware (the one
// that sends a response) with a fake req/res, capturing whatever it would
// have JSON-replied. Cheaper than spinning up a sub-app or doing a real
// HTTP fetch to ourselves.
async function invokeRouteHandler(router, method, path, req) {
    return await new Promise((resolve, reject) => {
        const layer = router.stack.find(l =>
            l.route && l.route.path === path && l.route.methods[method.toLowerCase()]);
        if (!layer) return reject(new Error(`route ${method} ${path} not found`));
        const handler = layer.route.stack[layer.route.stack.length - 1].handle;
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) {
                // Stamp _status onto the body and force success=false for any
                // non-2xx response so callers don't have to remember to check
                // both fields.
                const body = { ...payload, _status: this.statusCode };
                if (this.statusCode >= 400 && body.success !== false) body.success = false;
                resolve(body);
            },
        };
        Promise.resolve(handler({ ...req, params: req.params || {} }, res, reject)).catch(reject);
    });
}

// Submit an EXISTING DAA on-chain, by daa_id, without regenerating it.
// Used by the orchestrator's daa_generated → daa_submitted_onchain
// transition so we don't INSERT a duplicate DAA row just to call
// submitAncestryRecord.
async function submitExistingDAAOnChain(daa) {
    if (!process.env.DEPLOYER_PRIVATE_KEY) {
        return { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured' };
    }
    const { ethers } = require('ethers');
    const fs = require('fs');
    const path = require('path');
    try {
        const deployment = JSON.parse(fs.readFileSync(
            path.resolve(__dirname, '../../deployments/base-deployment.json'), 'utf-8'));
        const abi = JSON.parse(fs.readFileSync(
            path.resolve(__dirname, '../../deployments/ReparationsEscrow-abi.json'), 'utf-8'));
        const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
        const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(deployment.contractAddress, abi, signer);

        const totalOwed = Number(daa.total_debt) || 0;
        const docHash = ethers.keccak256(ethers.toUtf8Bytes(daa.daa_id));
        const amount = ethers.parseUnits(totalOwed.toFixed(2), 6);
        const ancestorName = daa.slaveholder_name || daa.acknowledger_name || 'unknown';
        const fsIdForRecord = daa.slaveholder_familysearch_id || '';
        const notes = `DAA ${daa.agreement_number || daa.daa_id}`;

        const tx = await contract.submitAncestryRecord(ancestorName, fsIdForRecord, docHash, amount, notes);
        const receipt = await tx.wait();
        const event = receipt.logs.find(l => {
            try { return contract.interface.parseLog(l)?.name === 'AncestryRecordSubmitted'; }
            catch { return false; }
        });
        const recordId = event ? Number(contract.interface.parseLog(event).args[0]) : null;

        return {
            success: true,
            daaId: daa.daa_id,
            recordId,
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            explorerUrl: `https://basescan.org/tx/${receipt.hash}`,
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = { advance, currentState, PIPELINE_STATES, submitExistingDAAOnChain };
