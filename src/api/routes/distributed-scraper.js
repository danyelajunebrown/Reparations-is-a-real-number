/**
 * Distributed Scraper API Routes
 *
 * Enables browser-based scrapers running on multiple devices to:
 * - Register and receive state assignments
 * - Send heartbeats to indicate they're alive
 * - Submit extracted data
 * - Report errors and completion
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Get database connection from app context
let db;

function initializeRouter(database) {
    db = database;
    return router;
}

/**
 * POST /api/scraper/register
 * Register a new device and get state assignment
 */
router.post('/register', async (req, res) => {
    try {
        const { deviceName, userAgent } = req.body;
        const ip = req.ip || req.connection.remoteAddress;

        // Generate unique device ID
        const deviceId = crypto.randomBytes(16).toString('hex');

        // Find next available state to assign
        const availableState = await db.query(`
            SELECT state_name FROM scraper_state_assignments
            WHERE status = 'pending' AND assigned_device_id IS NULL
            ORDER BY priority ASC
            LIMIT 1
        `);

        if (availableState.rows.length === 0) {
            return res.json({
                success: false,
                error: 'No states available for assignment. All states are either completed or assigned.',
                deviceId: null
            });
        }

        const assignedState = availableState.rows[0].state_name;

        // Register device
        await db.query(`
            INSERT INTO scraper_devices (device_id, device_name, ip_address, user_agent, assigned_state, status)
            VALUES ($1, $2, $3, $4, $5, 'active')
        `, [deviceId, deviceName || `Device-${deviceId.substring(0, 8)}`, ip, userAgent, assignedState]);

        // Update state assignment
        await db.query(`
            UPDATE scraper_state_assignments
            SET assigned_device_id = $1, status = 'in_progress', started_at = NOW(), last_activity = NOW()
            WHERE state_name = $2 AND year = 1860
        `, [deviceId, assignedState]);

        // Log event
        await db.query(`
            INSERT INTO scraper_events (device_id, event_type, state_name, details)
            VALUES ($1, 'device_registered', $2, $3)
        `, [deviceId, assignedState, JSON.stringify({ ip, userAgent, deviceName })]);

        // Get state info
        const stateInfo = await db.query(`
            SELECT * FROM scraper_state_assignments WHERE state_name = $1 AND year = 1860
        `, [assignedState]);

        console.log(`[SCRAPER] Device ${deviceId.substring(0, 8)} registered, assigned to ${assignedState}`);

        res.json({
            success: true,
            deviceId,
            assignedState,
            stateInfo: stateInfo.rows[0],
            message: `You have been assigned to scrape ${assignedState}. Start scraping!`,
            config: {
                heartbeatInterval: 30000, // 30 seconds
                batchSize: 50,
                delayBetweenPages: 2000,
                year: 1860,
                collectionId: '3161105'
            }
        });

    } catch (error) {
        console.error('[SCRAPER] Registration error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/scraper/heartbeat
 * Device sends heartbeat to indicate it's still running
 */
router.post('/heartbeat', async (req, res) => {
    try {
        const { deviceId, currentLocation, currentImageIndex, stats } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'deviceId required' });
        }

        // Update device heartbeat
        const result = await db.query(`
            UPDATE scraper_devices
            SET last_heartbeat = NOW(),
                current_location = $2,
                current_image_index = $3,
                total_records_extracted = COALESCE(total_records_extracted, 0) + COALESCE($4, 0),
                total_images_processed = COALESCE(total_images_processed, 0) + COALESCE($5, 0),
                status = 'active'
            WHERE device_id = $1
            RETURNING assigned_state, total_records_extracted
        `, [deviceId, currentLocation, currentImageIndex, stats?.newRecords || 0, stats?.newImages || 0]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        // Update state assignment last_activity
        await db.query(`
            UPDATE scraper_state_assignments
            SET last_activity = NOW(),
                completed_locations = COALESCE(completed_locations, 0) + COALESCE($2, 0),
                total_records = COALESCE(total_records, 0) + COALESCE($3, 0)
            WHERE assigned_device_id = $1 AND status = 'in_progress'
        `, [deviceId, stats?.completedLocations || 0, stats?.newRecords || 0]);

        res.json({
            success: true,
            message: 'Heartbeat received',
            totalRecords: result.rows[0].total_records_extracted,
            assignedState: result.rows[0].assigned_state
        });

    } catch (error) {
        console.error('[SCRAPER] Heartbeat error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/scraper/submit-data
 * Submit extracted records
 */
router.post('/submit-data', async (req, res) => {
    try {
        const { deviceId, records, location, imageUrl } = req.body;

        if (!deviceId || !records || !Array.isArray(records)) {
            return res.status(400).json({ success: false, error: 'deviceId and records array required' });
        }

        let insertedCount = 0;
        let errors = [];

        // Get device's assigned state
        const deviceResult = await db.query(
            `SELECT assigned_state FROM scraper_devices WHERE device_id = $1`,
            [deviceId]
        );

        if (deviceResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const state = deviceResult.rows[0].assigned_state;

        // Insert each record
        for (const record of records) {
            try {
                await db.query(`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, birth_year, gender, locations,
                        source_url, extraction_method, confidence_score,
                        context_text, status, source_type, data_quality_flags
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'primary', $10)
                `, [
                    record.name || 'Unknown',
                    record.type || 'enslaved', // 'enslaved' or 'slaveholder'
                    record.birthYear || null,
                    record.gender || null,
                    JSON.stringify([`${location}, ${state}`]),
                    imageUrl || record.sourceUrl,
                    'browser_scraper',
                    record.confidence || 0.95,
                    `Extracted by browser scraper from ${state} 1860 Slave Schedule. Device: ${deviceId.substring(0, 8)}`,
                    JSON.stringify({ deviceId: deviceId.substring(0, 8), extractedAt: new Date().toISOString() })
                ]);
                insertedCount++;
            } catch (e) {
                errors.push({ record: record.name, error: e.message });
            }
        }

        // Log extraction event
        await db.query(`
            INSERT INTO scraper_events (device_id, event_type, state_name, location, details)
            VALUES ($1, 'extraction', $2, $3, $4)
        `, [deviceId, state, location, JSON.stringify({
            recordsSubmitted: records.length,
            insertedCount,
            errors: errors.length
        })]);

        res.json({
            success: true,
            insertedCount,
            errorsCount: errors.length,
            errors: errors.slice(0, 5) // Return first 5 errors only
        });

    } catch (error) {
        console.error('[SCRAPER] Submit data error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/scraper/report-error
 * Report an error from the device
 */
router.post('/report-error', async (req, res) => {
    try {
        const { deviceId, errorMessage, errorType, location } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'deviceId required' });
        }

        // Update device error info
        await db.query(`
            UPDATE scraper_devices
            SET error_count = COALESCE(error_count, 0) + 1,
                last_error = $2,
                last_heartbeat = NOW()
            WHERE device_id = $1
        `, [deviceId, errorMessage]);

        // Log error event
        await db.query(`
            INSERT INTO scraper_events (device_id, event_type, location, details)
            VALUES ($1, 'error', $2, $3)
        `, [deviceId, location, JSON.stringify({ errorType, errorMessage })]);

        res.json({ success: true, message: 'Error logged' });

    } catch (error) {
        console.error('[SCRAPER] Report error failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/scraper/complete-state
 * Mark a state as completed
 */
router.post('/complete-state', async (req, res) => {
    try {
        const { deviceId, stats } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'deviceId required' });
        }

        // Get current assignment
        const device = await db.query(
            `SELECT assigned_state FROM scraper_devices WHERE device_id = $1`,
            [deviceId]
        );

        if (device.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const state = device.rows[0].assigned_state;

        // Mark state as completed
        await db.query(`
            UPDATE scraper_state_assignments
            SET status = 'completed', completed_at = NOW(), last_activity = NOW(),
                total_records = COALESCE($2, total_records)
            WHERE state_name = $1 AND year = 1860
        `, [state, stats?.totalRecords]);

        // Update device status
        await db.query(`
            UPDATE scraper_devices SET status = 'idle', assigned_state = NULL WHERE device_id = $1
        `, [deviceId]);

        // Log completion
        await db.query(`
            INSERT INTO scraper_events (device_id, event_type, state_name, details)
            VALUES ($1, 'state_complete', $2, $3)
        `, [deviceId, state, JSON.stringify(stats || {})]);

        // Check for next available state
        const nextState = await db.query(`
            SELECT state_name FROM scraper_state_assignments
            WHERE status = 'pending' AND assigned_device_id IS NULL
            ORDER BY priority ASC
            LIMIT 1
        `);

        if (nextState.rows.length > 0) {
            // Assign next state
            const newState = nextState.rows[0].state_name;
            await db.query(`
                UPDATE scraper_devices SET assigned_state = $2, status = 'active' WHERE device_id = $1
            `, [deviceId, newState]);
            await db.query(`
                UPDATE scraper_state_assignments
                SET assigned_device_id = $1, status = 'in_progress', started_at = NOW()
                WHERE state_name = $2 AND year = 1860
            `, [deviceId, newState]);

            res.json({
                success: true,
                message: `${state} completed! Now assigned to ${newState}`,
                completedState: state,
                nextState: newState
            });
        } else {
            res.json({
                success: true,
                message: `${state} completed! No more states available.`,
                completedState: state,
                nextState: null,
                allComplete: true
            });
        }

    } catch (error) {
        console.error('[SCRAPER] Complete state error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/scraper/status
 * Get status of all devices and states (for monitoring dashboard)
 */
router.get('/status', async (req, res) => {
    try {
        // Get all devices
        const devices = await db.query(`SELECT * FROM scraper_dashboard ORDER BY last_heartbeat DESC`);

        // Get state progress
        const states = await db.query(`SELECT * FROM scraper_state_progress ORDER BY priority`);

        // Get recent events
        const events = await db.query(`
            SELECT * FROM scraper_events ORDER BY created_at DESC LIMIT 20
        `);

        // Calculate totals
        const totals = await db.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'completed') as states_completed,
                COUNT(*) FILTER (WHERE status = 'in_progress') as states_in_progress,
                COUNT(*) FILTER (WHERE status = 'pending') as states_pending,
                SUM(total_records) as total_records
            FROM scraper_state_assignments
            WHERE year = 1860
        `);

        // Check for crashed devices (no heartbeat in 5 minutes)
        const crashed = await db.query(`
            SELECT device_id, device_name, assigned_state, last_heartbeat
            FROM scraper_devices
            WHERE status = 'active' AND last_heartbeat < NOW() - INTERVAL '5 minutes'
        `);

        // Mark crashed devices
        if (crashed.rows.length > 0) {
            for (const device of crashed.rows) {
                await db.query(`UPDATE scraper_devices SET status = 'crashed' WHERE device_id = $1`, [device.device_id]);
                await db.query(`
                    INSERT INTO scraper_events (device_id, event_type, state_name, details)
                    VALUES ($1, 'device_crash', $2, '{"reason": "No heartbeat for 5 minutes"}')
                `, [device.device_id, device.assigned_state]);
            }
        }

        res.json({
            success: true,
            summary: {
                ...totals.rows[0],
                activeDevices: devices.rows.filter(d => d.health_status === 'OK').length,
                crashedDevices: crashed.rows.length
            },
            devices: devices.rows,
            states: states.rows,
            recentEvents: events.rows,
            crashedDevices: crashed.rows,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[SCRAPER] Status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/scraper/reassign
 * Manually reassign a state to a different device or unassign
 */
router.post('/reassign', async (req, res) => {
    try {
        const { stateName, newDeviceId } = req.body;

        if (!stateName) {
            return res.status(400).json({ success: false, error: 'stateName required' });
        }

        if (newDeviceId) {
            // Reassign to specific device
            await db.query(`
                UPDATE scraper_state_assignments
                SET assigned_device_id = $2, status = 'in_progress', last_activity = NOW()
                WHERE state_name = $1 AND year = 1860
            `, [stateName, newDeviceId]);
            await db.query(`
                UPDATE scraper_devices SET assigned_state = $1, status = 'active' WHERE device_id = $2
            `, [stateName, newDeviceId]);
        } else {
            // Unassign (make available)
            const current = await db.query(`
                SELECT assigned_device_id FROM scraper_state_assignments WHERE state_name = $1 AND year = 1860
            `, [stateName]);

            if (current.rows[0]?.assigned_device_id) {
                await db.query(`
                    UPDATE scraper_devices SET assigned_state = NULL, status = 'idle'
                    WHERE device_id = $1
                `, [current.rows[0].assigned_device_id]);
            }

            await db.query(`
                UPDATE scraper_state_assignments
                SET assigned_device_id = NULL, status = 'pending'
                WHERE state_name = $1 AND year = 1860
            `, [stateName]);
        }

        res.json({ success: true, message: `${stateName} reassigned` });

    } catch (error) {
        console.error('[SCRAPER] Reassign error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = { router, initializeRouter };
