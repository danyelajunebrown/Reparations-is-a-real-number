/**
 * Pipeline API
 *
 * Thin HTTP wrapper around src/services/pipeline-orchestrator.js. Each
 * call advances a participant by at most one stage. Drive progress with
 * cron, a UI button, or a manual curl during testing.
 */

const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const orchestrator = require('../../services/pipeline-orchestrator');

// POST /api/pipeline/advance/:participantId
router.post('/advance/:participantId', async (req, res) => {
    try {
        const result = await orchestrator.advance(req.params.participantId);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/pipeline/status/:participantId
router.get('/status/:participantId', async (req, res) => {
    try {
        const r = await db.query(
            `SELECT id, full_name, email, self_fs_id, roles, intake_date, updated_at
             FROM participants WHERE id = $1 LIMIT 1`,
            [req.params.participantId],
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'not found' });
        const p = r.rows[0];
        res.json({
            success: true,
            participantId: p.id,
            fullName: p.full_name,
            currentState: orchestrator.currentState(p.roles),
            allStates: orchestrator.PIPELINE_STATES,
            roles: p.roles,
            intakeDate: p.intake_date,
            updatedAt: p.updated_at,
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/pipeline/advance-all
// Walks every participant whose current state isn't terminal and advances
// each by one step. Cap=50 by default to keep one call short; loop with
// cron for long-running queues.
router.post('/advance-all', async (req, res) => {
    const limit = Math.min(parseInt(req.body?.limit) || 50, 200);
    try {
        const r = await db.query(
            `SELECT id FROM participants
             WHERE NOT ('daa_submitted_onchain' = ANY(COALESCE(roles, ARRAY[]::text[])))
             ORDER BY intake_date ASC LIMIT $1`,
            [limit],
        );
        const results = [];
        for (const row of r.rows) {
            try {
                results.push(await orchestrator.advance(row.id));
            } catch (e) {
                results.push({ participantId: row.id, error: e.message });
            }
        }
        res.json({ success: true, processed: results.length, results });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
