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
    const { fsId, name, fatherName, motherName, birthYear, birthLocation, familyTree } = req.body || {};

    // If familyTree is provided, extract top-level fields from it for backward compat
    let effectiveName = name;
    let effectiveFatherName = fatherName;
    let effectiveMotherName = motherName;
    let effectiveBirthYear = birthYear;
    let effectiveBirthLocation = birthLocation;
    if (familyTree && typeof familyTree === 'object' && familyTree.name) {
      if (!effectiveName) effectiveName = familyTree.name;
      if (!effectiveBirthYear && familyTree.birthYear) effectiveBirthYear = familyTree.birthYear;
      if (!effectiveBirthLocation && familyTree.birthLocation) effectiveBirthLocation = familyTree.birthLocation;
      if (familyTree.parents && Array.isArray(familyTree.parents)) {
        for (const p of familyTree.parents) {
          if (p.relationship === 'father' && !effectiveFatherName) effectiveFatherName = p.name;
          if (p.relationship === 'mother' && !effectiveMotherName) effectiveMotherName = p.name;
        }
      }
    }

    const hasFsId = isValidFsId(fsId);
    const hasName = effectiveName && typeof effectiveName === 'string' && effectiveName.trim().length >= 3;
    const hasParents = (effectiveFatherName && effectiveFatherName.trim().length >= 3) || (effectiveMotherName && effectiveMotherName.trim().length >= 3);
    const hasFamilyTree = familyTree && typeof familyTree === 'object' && familyTree.name && familyTree.parents;

    // Must have either a valid FS ID, or a name + at least one parent, or a family tree
    if (!hasFsId && !hasName && !hasFamilyTree) {
      return res.status(400).json({ success: false, error: 'Provide a FamilySearch ID, your full name, or a family tree' });
    }
    if (!hasFsId && hasName && !hasParents && !hasFamilyTree) {
      return res.status(400).json({ success: false, error: 'Without a FamilySearch ID, provide at least one parent name or a family tree' });
    }

    // Launch the existing climber script in background (VISIBLE browser via FAMILYSEARCH_INTERACTIVE)
    const scriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'scrapers', 'familysearch-ancestor-climber.js');

    // Build command-line arguments
    const args = [scriptPath];

    if (hasFsId) {
      args.push(fsId.trim().toUpperCase());
    }
    if (hasName) {
      args.push('--name', effectiveName.trim());
    }
    if (effectiveFatherName && effectiveFatherName.trim()) {
      args.push('--father-name', effectiveFatherName.trim());
    }
    if (effectiveMotherName && effectiveMotherName.trim()) {
      args.push('--mother-name', effectiveMotherName.trim());
    }
    if (effectiveBirthYear) {
      const yr = parseInt(effectiveBirthYear);
      if (yr > 1800 && yr < 2030) args.push('--birth-year', String(yr));
    }
    if (effectiveBirthLocation && effectiveBirthLocation.trim()) {
      args.push('--birth-location', effectiveBirthLocation.trim());
    }

    // Write family tree JSON to temp file for the climber
    if (hasFamilyTree) {
      const treePath = path.join('/tmp', `family-tree-${Date.now()}.json`);
      fs.writeFileSync(treePath, JSON.stringify(familyTree));
      args.push('--family-tree', treePath);
    }

    const logsDir = path.join(__dirname, '..', '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const label = hasFsId ? fsId.trim() : (effectiveName || 'unknown').trim().replace(/\s+/g, '-').substring(0, 30);
    const logPath = path.join(logsDir, `kiosk-ancestor-climb-${label}-${ts}.log`);

    const env = {
      ...process.env,
      FAMILYSEARCH_INTERACTIVE: 'true',
      DISPLAY: process.env.DISPLAY || (process.platform === 'linux' ? ':0' : process.env.DISPLAY)
    };

    // Use shell wrapper to fully orphan the process from PM2's process group
    const shellCmd = `nohup node ${args.map(a => `"${a}"`).join(' ')} >> "${logPath}" 2>&1 &`;
    const proc = spawn('sh', ['-c', shellCmd], {
      env,
      detached: true,
      stdio: 'ignore'
    });
    proc.unref();

    // Optimistic, fast response path: poll the DB for up to 20s to find a NEW session
    const requestTime = new Date().toISOString();
    const startedAt = Date.now();
    const timeoutMs = 20000;
    let foundSession = null;

    // Session lookup: by FS ID if available, otherwise by name
    const lookupField = hasFsId ? 'modern_person_fs_id' : 'modern_person_name';
    const lookupValue = hasFsId ? fsId.trim().toUpperCase() : (effectiveName || '').trim();

    async function tryFindSession() {
      const rows = (await db.query(
        `SELECT id, status, started_at FROM ancestor_climb_sessions
         WHERE ${lookupField} = $1 AND started_at >= $2
         ORDER BY started_at DESC
         LIMIT 1`,
        [lookupValue, requestTime]
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

    // Session not created yet — return pending response
    return res.status(202).json({
      success: true,
      message: hasFsId
        ? 'Ancestor climb starting; waiting for session to initialize (login may be required).'
        : 'Searching historical records for your ancestors…',
      pending: true,
      fsId: hasFsId ? fsId : null,
      lookupName: hasName ? effectiveName.trim() : null,
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

    // Return all matches with lineage paths for tree view
    const matchesQ = await db.query(
      `SELECT id, slaveholder_name, match_type, match_confidence, classification,
              classification_reason, generation_distance, lineage_path, found_at,
              verification_status, confidence_adjusted, requires_human_review, review_reason
         FROM ancestor_climb_matches
        WHERE session_id = $1
        ORDER BY generation_distance ASC, match_confidence DESC`,
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

// Review (approve/reject) a match from the kiosk
router.post('/match/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, notes } = req.body || {};

    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({ success: false, error: 'Decision must be "approve" or "reject"' });
    }

    const classification = decision === 'approve' ? 'pending_review' : 'rejected';

    const result = await db.query(
      `UPDATE ancestor_climb_matches
          SET classification = $1, classification_reason = $2
        WHERE id = $3
        RETURNING id, slaveholder_name, match_type, match_confidence, classification,
                  classification_reason, generation_distance, lineage_path, found_at`,
      [classification, notes || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }

    return res.json({ success: true, match: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
