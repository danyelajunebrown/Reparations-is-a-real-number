/**
 * Kiosk API
 *
 * Thin wrapper around the existing ancestor-climb endpoints to provide
 * a simplified interface for the fullscreen kiosk.
 *
 * Endpoints:
 * - POST /api/kiosk/start-climb           → launches Puppeteer-based climb and returns sessionId (when available)
 * - GET  /api/kiosk/climb-status/:id      → returns compact live status for polling UI
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('../../database/connection');

const router = express.Router();

// Basic FS ID validator (e.g., G21N-HD2)
function isValidFsId(id) {
  return /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/i.test((id || '').trim());
}

// Start a climb and try to return the created session id quickly by polling the DB
router.post('/start-climb', async (req, res) => {
  try {
    const { fsId, name } = req.body || {};

    if (!isValidFsId(fsId)) {
      return res.status(400).json({ success: false, error: 'Valid FamilySearch ID (e.g., G21N-HD2) is required' });
    }

    // Launch the existing climber script in background (VISIBLE browser via FAMILYSEARCH_INTERACTIVE)
    const scriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'scrapers', 'familysearch-ancestor-climber.js');

    const args = [scriptPath, fsId];
    if (name && typeof name === 'string' && name.trim()) {
      args.push('--name', name.trim());
    }

    const logsDir = path.join(__dirname, '..', '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(logsDir, `kiosk-ancestor-climb-${(fsId || 'unknown')}-${ts}.log`);
    // Open file descriptors for the child — no pipes back to parent
    const outFd = fs.openSync(logPath, 'a');

    const env = {
      ...process.env,
      FAMILYSEARCH_INTERACTIVE: 'true',
      DISPLAY: process.env.DISPLAY || (process.platform === 'linux' ? ':0' : process.env.DISPLAY)
    };

    // stdio uses file descriptors directly so child is fully detached from parent
    const proc = spawn('node', args, { env, detached: true, stdio: ['ignore', outFd, outFd] });
    proc.unref();
    fs.closeSync(outFd);

    // Optimistic, fast response path: poll the DB for up to 20s to find a NEW session created for this fsId
    const requestTime = new Date().toISOString();
    const startedAt = Date.now();
    const timeoutMs = 20000;
    let foundSession = null;

    async function tryFindSession() {
      const rows = (await db.query(
        `SELECT id, status, started_at FROM ancestor_climb_sessions
         WHERE modern_person_fs_id = $1 AND started_at >= $2
         ORDER BY started_at DESC
         LIMIT 1`,
        [fsId, requestTime]
      )).rows;
      return rows && rows[0] ? rows[0] : null;
    }

    // Poll in small intervals without blocking the event loop for too long
    while ((Date.now() - startedAt) < timeoutMs) {
      // eslint-disable-next-line no-await-in-loop
      foundSession = await tryFindSession();
      if (foundSession) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 500));
    }

    if (foundSession) {
      return res.status(202).json({
        success: true,
        message: 'Ancestor climb started',
        sessionId: foundSession.id,
        status: foundSession.status,
        logPath
      });
    }

    // If the session hasn’t been created yet (e.g., user still logging in), return a pending response with fsId
    return res.status(202).json({
      success: true,
      message: 'Ancestor climb starting; waiting for session to initialize (login may be required).',
      pending: true,
      fsId,
      logPath
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Compact status for kiosk polling
router.get('/climb-status/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionQ = await db.query(
      `SELECT id, modern_person_name, modern_person_fs_id, status, started_at, last_activity,
              ancestors_visited, matches_found
         FROM ancestor_climb_sessions
        WHERE id = $1
        LIMIT 1`,
      [sessionId]
    );

    if (sessionQ.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const s = sessionQ.rows[0];

    // We’ll return the latest 10 matches for a lightweight UI render
    const matchesQ = await db.query(
      `SELECT id, slaveholder_name, match_type, match_confidence, classification,
              classification_reason, generation_distance, found_at
         FROM ancestor_climb_matches
        WHERE session_id = $1
        ORDER BY found_at DESC, id DESC
        LIMIT 10`,
      [sessionId]
    );

    return res.json({
      success: true,
      session: s,
      matches: matchesQ.rows
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
