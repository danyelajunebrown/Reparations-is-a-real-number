/**
 * Ancestor Climb API
 *
 * Lightweight endpoints to start and monitor FamilySearch ancestor climbs
 * using the local workaround script (scripts/scrapers/familysearch-ancestor-climber.js).
 *
 * Notes:
 * - This will launch a local Chrome window and require the operator to log in
 *   to FamilySearch the first time (cookies/profile persisted in /tmp profile).
 * - The script writes progress to the database tables created by
 *   migrations/027-ancestor-climb-sessions.sql.
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('../../database/connection');

const router = express.Router();

// Validate FamilySearch ID format (e.g., G21N-HD2)
function isValidFsId(id) {
  return /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/.test(id || '');
}

// POST /api/ancestor-climb/start
// Body: { fsId: "G21N-HD2", name?: "Nancy Miller Brown" }
router.post('/start', async (req, res) => {
  try {
    const { fsId, name } = req.body || {};

    if (!isValidFsId(fsId)) {
      return res.status(400).json({ success: false, error: 'Valid FamilySearch ID (e.g., G21N-HD2) is required' });
    }

    // Launch background process to run the climber script
    const scriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'scrapers', 'familysearch-ancestor-climber.js');

    const args = [scriptPath, fsId];
    if (name && typeof name === 'string' && name.trim().length > 0) {
      args.push('--name', name.trim());
    }

    // Important: FAMILYSEARCH_INTERACTIVE=true opens Chrome for login if needed
    // Set up logging for spawned process so operators can troubleshoot on Pi
    const logsDir = path.join(__dirname, '..', '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(logsDir, `ancestor-climb-${fsId || 'unknown'}-${ts}.log`);

    const env = {
      ...process.env,
      FAMILYSEARCH_INTERACTIVE: 'true',
      // On Raspberry Pi, ensure GUI context for visible Chrome
      DISPLAY: process.env.DISPLAY || (process.platform === 'linux' ? ':0' : process.env.DISPLAY)
    };

    // Use shell wrapper to fully orphan the process from PM2's process group
    const shellCmd = `nohup node ${args.map(a => `"${a}"`).join(' ')} >> "${logPath}" 2>&1 &`;
    const proc = spawn('sh', ['-c', shellCmd], {
      env,
      detached: true,
      stdio: 'ignore'
    });

    // Detach and let it run independently
    proc.unref();

    return res.status(202).json({
      success: true,
      message: 'Ancestor climb started. A Chrome window will open on the host machine for FamilySearch login if required. You can monitor progress via the sessions endpoint.',
      fsId,
      logPath,
      tips: [
        'If prompted, log into FamilySearch in the opened Chrome window, then the climb continues automatically.',
        'Poll GET /api/ancestor-climb/sessions?fsId=' + fsId + ' to fetch the newly created session and its status.',
        'Use GET /api/ancestor-climb/session/{sessionId} to see matches as they are found.'
      ]
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ancestor-climb/sessions?fsId=G21N-HD2
// Lists climb sessions, optionally filtered by modern_person_fs_id
router.get('/sessions', async (req, res) => {
  try {
    const { fsId, limit = 25 } = req.query;

    const { name } = req.query;
    let rows;
    if (fsId && isValidFsId(fsId)) {
      rows = (await db.query(
        `SELECT id, modern_person_name, modern_person_fs_id, status, started_at, last_activity,
                ancestors_visited, matches_found
           FROM ancestor_climb_sessions
          WHERE modern_person_fs_id = $1
          ORDER BY started_at DESC
          LIMIT $2`,
        [fsId, Math.min(parseInt(limit) || 25, 100)]
      )).rows;
    } else if (name && typeof name === 'string' && name.trim().length >= 3) {
      rows = (await db.query(
        `SELECT id, modern_person_name, modern_person_fs_id, status, started_at, last_activity,
                ancestors_visited, matches_found
           FROM ancestor_climb_sessions
          WHERE modern_person_name = $1
          ORDER BY started_at DESC
          LIMIT $2`,
        [name.trim(), Math.min(parseInt(limit) || 25, 100)]
      )).rows;
    } else {
      rows = (await db.query(
        `SELECT id, modern_person_name, modern_person_fs_id, status, started_at, last_activity,
                ancestors_visited, matches_found
           FROM ancestor_climb_sessions
          ORDER BY started_at DESC
          LIMIT $1`,
        [Math.min(parseInt(limit) || 25, 100)]
      )).rows;
    }

    return res.json({ success: true, count: rows.length, sessions: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message, sessions: [] });
  }
});

// GET /api/ancestor-climb/session/:id
// Returns a single session with its matches
router.get('/session/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sessionResult = await db.query(
      `SELECT id, modern_person_name, modern_person_fs_id, status, started_at, last_activity,
              ancestors_visited, matches_found
         FROM ancestor_climb_sessions WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

  const matches = (await db.query(
      `SELECT id, modern_person_name, modern_person_fs_id, slaveholder_name, slaveholder_fs_id,
              slaveholder_birth_year, generation_distance, match_type, match_confidence,
              classification, classification_reason, found_at AS created_at
         FROM ancestor_climb_matches
        WHERE session_id = $1
        ORDER BY generation_distance ASC, match_confidence DESC, id ASC`,
      [id]
    )).rows;

    return res.json({ success: true, session: sessionResult.rows[0], matches });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ancestor-climb/pending-verification
// Returns recent matches that are still unverified (for human review queue stub)
router.get('/pending-verification', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const rows = (await db.query(
      `SELECT id, session_id, modern_person_name, modern_person_fs_id, slaveholder_name,
              generation_distance, match_type, match_confidence, classification, classification_reason,
              found_at
         FROM ancestor_climb_matches
        WHERE classification = 'unverified'
        ORDER BY found_at DESC
        LIMIT $1`,
      [limit]
    )).rows;
    return res.json({ success: true, count: rows.length, matches: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message, matches: [] });
  }
});

module.exports = router;
