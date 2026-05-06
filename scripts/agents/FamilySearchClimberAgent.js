/**
 * FamilySearchClimberAgent
 *
 * Manages ancestor-climb sessions for DAA generation. Extends BaseAgent to
 * provide queue-driven, resumable FamilySearch tree traversal.
 *
 * Responsibilities:
 *   1. Pick climb requests from the agent_processing_queue (agent_type = 'familysearch_climber')
 *   2. Check whether a completed session already exists for the given FS ID / name
 *   3. If not, spawn the Puppeteer-based ancestor climber as a child process
 *      (requires FAMILYSEARCH_INTERACTIVE=true and a live browser session)
 *   4. Poll for session completion / failure and update the queue accordingly
 *   5. Expose `ensureSessionComplete()` for direct calls from DAAOrchestrator
 *
 * IMPORTANT — interactive login requirement:
 *   FamilySearch does not support OAuth refresh tokens for third-party tree
 *   traversal. The Puppeteer scraper must log in interactively (headed
 *   browser) the first time per session. To run fully unattended, either:
 *     a) Use a pre-authenticated Puppeteer profile directory with cookies
 *        set via PUPPETEER_USER_DATA_DIR (recommended for server deployments),
 *     b) Set FS_SESSION_COOKIE=<value> in .env for the scraper's cookie-inject
 *        path (see familysearch-ancestor-climber.js --inject-cookie flag), or
 *     c) Accept that the first run of each DAA requires an operator to open the
 *        browser, log in, and let the scraper take over.
 *
 * See docs/FAMILYSEARCH-OAUTH-INTEGRATION.md for detailed setup instructions.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { spawn } = require('child_process');
const path = require('path');
const BaseAgent = require('./BaseAgent');

// ── Validate required env at module load ────────────────────────────────────
if (!process.env.DATABASE_URL) {
  throw new Error(
    'FATAL: DATABASE_URL environment variable is not set. ' +
    'FamilySearchClimberAgent requires a Neon/Postgres connection.'
  );
}

const SCRAPER_PATH = path.resolve(
  __dirname,
  '../../scripts/scrapers/familysearch-ancestor-climber.js'
);

// How long to wait (ms) between polls when monitoring a running child process
const POLL_INTERVAL_MS = 5_000;

// Maximum wall-clock time we'll wait for a single climb (30 min default).
// The scraper itself has no timeout; this prevents the queue from hanging.
const CLIMB_TIMEOUT_MS = parseInt(process.env.CLIMB_TIMEOUT_MS || '1800000', 10);

class FamilySearchClimberAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      agentType: 'familysearch_climber',
      rateLimit: config.rateLimit || 3000, // 3 s between queued batches
      batchSize: config.batchSize || 1,    // one climb at a time (browser constraint)
      maxRetries: config.maxRetries || 2,
      ...config,
    });

    this.activeChild = null; // currently running Puppeteer child process
  }

  // ── BaseAgent overrides ──────────────────────────────────────────────────

  /**
   * Override: fetch one pending climb request at a time.
   */
  async getQueueItems(limit) {
    return await this.sql`
      SELECT *
      FROM agent_processing_queue
      WHERE agent_type = 'familysearch_climber'
        AND status     = 'pending'
        AND next_attempt <= NOW()
      ORDER BY priority ASC, created_at ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Override: run a climb for this queue item.
   *
   * item.task_details shape:
   * {
   *   familySearchId: string,   // FamilySearch person ID, or 'NAME-ONLY'
   *   personName: string,       // Display name for logging / NAME-ONLY climbs
   *   sessionId?: string        // Resume an existing in_progress session
   * }
   */
  async processItem(item) {
    const details = item.task_details || {};
    const { familySearchId, personName, sessionId } = details;

    if (!personName) {
      return { success: false, error: 'task_details.personName is required' };
    }

    try {
      const session = await this.ensureSessionComplete({
        familySearchId: familySearchId || 'NAME-ONLY',
        personName,
        sessionId: sessionId || null,
      });

      return {
        success: true,
        sessionId: session.id,
        matchesFound: session.matches_found,
        ancestorsVisited: session.ancestors_visited,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Ensure a completed climb session exists for the given person.
   * Called directly by DAAOrchestrator.ensureClimbComplete().
   *
   * @param {Object} opts
   * @param {string} opts.familySearchId  - FS person ID (or 'NAME-ONLY')
   * @param {string} opts.personName      - Human-readable name
   * @param {string} [opts.sessionId]     - Resume a specific session UUID
   * @returns {Promise<Object>} completed ancestor_climb_sessions row
   * @throws {Error} if climb cannot be started or times out
   */
  async ensureSessionComplete({ familySearchId, personName, sessionId = null }) {
    // 1. Direct session lookup (by UUID)
    if (sessionId) {
      const row = await this._getSession({ id: sessionId, status: 'completed' });
      if (row) {
        console.log(`[FamilySearchClimberAgent] Reusing completed session ${sessionId}`);
        return row;
      }

      const inProgress = await this._getSession({ id: sessionId, status: 'in_progress' });
      if (inProgress) {
        console.log(`[FamilySearchClimberAgent] Waiting for in-progress session ${sessionId}...`);
        return this._waitForSession(sessionId);
      }
    }

    // 2. Look for any completed session for this person
    const existing = await this._findCompletedSession(familySearchId, personName);
    if (existing) {
      console.log(`[FamilySearchClimberAgent] Found completed session ${existing.id} for ${personName}`);
      return existing;
    }

    // 3. Check for an already-running session
    const running = await this._findInProgressSession(familySearchId, personName);
    if (running) {
      console.log(`[FamilySearchClimberAgent] Found in-progress session ${running.id}; waiting...`);
      return this._waitForSession(running.id);
    }

    // 4. Start a new climb
    console.log(`[FamilySearchClimberAgent] No session found for ${personName}. Starting new climb...`);
    const newSessionId = await this._startClimb(familySearchId, personName);
    return this._waitForSession(newSessionId);
  }

  /**
   * Queue a climb request for a person (async, non-blocking).
   * The agent's processing loop will pick it up on its next tick.
   *
   * @param {string} familySearchId
   * @param {string} personName
   * @param {number} [priority=5] - lower = higher priority
   */
  async queueClimb(familySearchId, personName, priority = 5) {
    await this.sql`
      INSERT INTO agent_processing_queue (
        agent_type,
        priority,
        task_details,
        status,
        next_attempt
      ) VALUES (
        'familysearch_climber',
        ${priority},
        ${JSON.stringify({ familySearchId, personName })},
        'pending',
        NOW()
      )
      ON CONFLICT DO NOTHING
    `;
    console.log(`[FamilySearchClimberAgent] Queued climb for ${personName} (${familySearchId})`);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  async _getSession({ id, status }) {
    const rows = await this.sql`
      SELECT * FROM ancestor_climb_sessions
      WHERE id = ${id}
        AND status = ${status}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async _findCompletedSession(familySearchId, personName) {
    let rows;
    if (familySearchId && familySearchId !== 'NAME-ONLY') {
      rows = await this.sql`
        SELECT * FROM ancestor_climb_sessions
        WHERE modern_person_fs_id = ${familySearchId}
          AND status = 'completed'
        ORDER BY started_at DESC
        LIMIT 1
      `;
    } else {
      rows = await this.sql`
        SELECT * FROM ancestor_climb_sessions
        WHERE modern_person_name = ${personName}
          AND modern_person_fs_id = 'NAME-ONLY'
          AND status = 'completed'
        ORDER BY started_at DESC
        LIMIT 1
      `;
    }
    return rows[0] || null;
  }

  async _findInProgressSession(familySearchId, personName) {
    let rows;
    if (familySearchId && familySearchId !== 'NAME-ONLY') {
      rows = await this.sql`
        SELECT * FROM ancestor_climb_sessions
        WHERE modern_person_fs_id = ${familySearchId}
          AND status = 'in_progress'
        ORDER BY started_at DESC
        LIMIT 1
      `;
    } else {
      rows = await this.sql`
        SELECT * FROM ancestor_climb_sessions
        WHERE modern_person_name = ${personName}
          AND modern_person_fs_id = 'NAME-ONLY'
          AND status = 'in_progress'
        ORDER BY started_at DESC
        LIMIT 1
      `;
    }
    return rows[0] || null;
  }

  /**
   * Spawn the Puppeteer scraper as a child process.
   * Returns the UUID of the newly-created ancestor_climb_sessions row.
   *
   * The scraper writes its session UUID to stdout on the first line as:
   *   SESSION_ID:<uuid>
   * This agent reads that line and uses it to poll DB for completion.
   *
   * Interactive login notes:
   *   - Set FAMILYSEARCH_INTERACTIVE=true to open a headed browser
   *   - Set FS_SESSION_COOKIE=<cookie-value> to skip interactive login
   *   - Set PUPPETEER_USER_DATA_DIR to persist authenticated profile
   */
  async _startClimb(familySearchId, personName) {
    return new Promise((resolve, reject) => {
      const args = [];

      if (familySearchId && familySearchId !== 'NAME-ONLY') {
        args.push(familySearchId);
      }

      args.push('--name', personName);

      if (process.env.PUPPETEER_USER_DATA_DIR) {
        args.push('--user-data-dir', process.env.PUPPETEER_USER_DATA_DIR);
      }

      const env = {
        ...process.env,
        FAMILYSEARCH_INTERACTIVE: process.env.FAMILYSEARCH_INTERACTIVE || 'true',
      };

      if (process.env.FS_SESSION_COOKIE) {
        env.FS_SESSION_COOKIE = process.env.FS_SESSION_COOKIE;
      }

      console.log(`[FamilySearchClimberAgent] Spawning: node ${SCRAPER_PATH} ${args.join(' ')}`);

      this.activeChild = spawn('node', [SCRAPER_PATH, ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let sessionIdResolved = false;
      let stdoutBuffer = '';

      this.activeChild.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!sessionIdResolved && trimmed.startsWith('SESSION_ID:')) {
            const sid = trimmed.replace('SESSION_ID:', '').trim();
            if (sid) {
              sessionIdResolved = true;
              console.log(`[FamilySearchClimberAgent] Climb session started: ${sid}`);
              resolve(sid);
            }
          }
          // Mirror scraper output to console
          if (trimmed) process.stdout.write(`  [scraper] ${trimmed}\n`);
        }

        // Keep only the last incomplete line in the buffer
        stdoutBuffer = lines[lines.length - 1];
      });

      this.activeChild.stderr.on('data', (chunk) => {
        process.stderr.write(`  [scraper:err] ${chunk.toString()}`);
      });

      this.activeChild.on('error', (err) => {
        if (!sessionIdResolved) reject(err);
      });

      this.activeChild.on('exit', (code) => {
        this.activeChild = null;
        if (!sessionIdResolved) {
          reject(new Error(
            `Ancestor climber exited with code ${code} before emitting SESSION_ID. ` +
            'Check that the scraper logs SESSION_ID:<uuid> to stdout immediately ' +
            'after creating the session row. See familysearch-ancestor-climber.js.'
          ));
        }
      });
    });
  }

  /**
   * Poll ancestor_climb_sessions until status is 'completed' or 'failed'.
   * Times out after CLIMB_TIMEOUT_MS.
   */
  async _waitForSession(sessionId) {
    const deadline = Date.now() + CLIMB_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const rows = await this.sql`
        SELECT * FROM ancestor_climb_sessions
        WHERE id = ${sessionId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        throw new Error(`Session ${sessionId} not found in ancestor_climb_sessions`);
      }

      const session = rows[0];

      if (session.status === 'completed') {
        console.log(
          `[FamilySearchClimberAgent] Session ${sessionId} completed. ` +
          `Visited ${session.ancestors_visited} ancestors, found ${session.matches_found} matches.`
        );
        return session;
      }

      if (session.status === 'failed') {
        throw new Error(
          `Ancestor climb session ${sessionId} failed. ` +
          `Last activity: ${session.last_activity}. ` +
          'Check scraper logs for details.'
        );
      }

      // Still in_progress — wait and retry
      await this.sleep(POLL_INTERVAL_MS);
    }

    // Kill the child process if still running
    if (this.activeChild) {
      console.warn(`[FamilySearchClimberAgent] Climb timed out after ${CLIMB_TIMEOUT_MS}ms — killing child.`);
      this.activeChild.kill('SIGTERM');
      this.activeChild = null;
    }

    // Mark session as failed in DB
    await this.sql`
      UPDATE ancestor_climb_sessions
      SET status = 'failed', completed_at = NOW()
      WHERE id = ${sessionId}
        AND status = 'in_progress'
    `;

    throw new Error(
      `Ancestor climb session ${sessionId} timed out after ${CLIMB_TIMEOUT_MS / 60000} minutes. ` +
      'Increase CLIMB_TIMEOUT_MS or check for FamilySearch CAPTCHA/login issues.'
    );
  }

  /**
   * Graceful shutdown — kill any active child process before exiting.
   */
  async shutdown() {
    if (this.activeChild) {
      console.log('[FamilySearchClimberAgent] Sending SIGTERM to active climb process...');
      this.activeChild.kill('SIGTERM');
      await this.sleep(3000);
    }
    await super.shutdown();
  }
}

module.exports = FamilySearchClimberAgent;

// Allow direct execution: `node scripts/agents/FamilySearchClimberAgent.js`
if (require.main === module) {
  const agent = new FamilySearchClimberAgent();
  agent.start().catch((err) => {
    console.error('[FamilySearchClimberAgent] Fatal:', err);
    process.exit(1);
  });
}
