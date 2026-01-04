/**
 * BROWSER-BASED 1860 SLAVE SCHEDULE SCRAPER
 *
 * INSTRUCTIONS:
 * 1. Go to FamilySearch.org and log in
 * 2. Open browser console (F12 or Cmd+Option+J on Mac)
 * 3. Paste this entire script and press Enter
 * 4. The scraper will register with the server and start extracting
 *
 * The script will:
 * - Register with the central server and get a state assignment
 * - Navigate through the 1860 Slave Schedule images
 * - Extract slaveholder and enslaved person data
 * - Send data to the central database
 * - Send heartbeats to indicate it's alive
 * - Report any errors
 */

(async function() {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    const CONFIG = {
        API_BASE: 'https://reparations-is-a-real-number.onrender.com/api/scraper',
        COLLECTION_ID: '3161105', // 1860 Slave Schedule
        HEARTBEAT_INTERVAL: 30000, // 30 seconds
        DELAY_BETWEEN_PAGES: 3000, // 3 seconds between image loads
        DELAY_BETWEEN_LOCATIONS: 5000, // 5 seconds between locations
        MAX_ERRORS_BEFORE_PAUSE: 5,
        DEBUG: true
    };

    // ========================================================================
    // STATE
    // ========================================================================
    let state = {
        deviceId: null,
        assignedState: null,
        currentLocation: null,
        currentImageIndex: 0,
        totalImages: 0,
        extractedRecords: 0,
        errors: 0,
        running: false,
        heartbeatTimer: null
    };

    // ========================================================================
    // LOGGING
    // ========================================================================
    const log = {
        info: (msg, data) => {
            console.log(`%c[SCRAPER] ${msg}`, 'color: #2196F3; font-weight: bold', data || '');
        },
        success: (msg, data) => {
            console.log(`%c[SCRAPER] ✓ ${msg}`, 'color: #4CAF50; font-weight: bold', data || '');
        },
        error: (msg, data) => {
            console.error(`%c[SCRAPER] ✗ ${msg}`, 'color: #f44336; font-weight: bold', data || '');
        },
        warn: (msg, data) => {
            console.warn(`%c[SCRAPER] ⚠ ${msg}`, 'color: #FF9800; font-weight: bold', data || '');
        },
        status: () => {
            console.log('%c========== SCRAPER STATUS ==========', 'color: #9C27B0; font-weight: bold');
            console.log('Device ID:', state.deviceId?.substring(0, 8) || 'Not registered');
            console.log('Assigned State:', state.assignedState || 'None');
            console.log('Current Location:', state.currentLocation || 'None');
            console.log('Images:', `${state.currentImageIndex}/${state.totalImages}`);
            console.log('Records Extracted:', state.extractedRecords);
            console.log('Errors:', state.errors);
            console.log('Running:', state.running);
            console.log('%c=====================================', 'color: #9C27B0; font-weight: bold');
        }
    };

    // ========================================================================
    // API CALLS
    // ========================================================================
    async function apiCall(endpoint, method = 'GET', data = null) {
        const url = `${CONFIG.API_BASE}${endpoint}`;
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
            mode: 'cors'
        };
        if (data) options.body = JSON.stringify(data);

        try {
            const response = await fetch(url, options);
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'API call failed');
            }
            return result;
        } catch (error) {
            log.error(`API call to ${endpoint} failed:`, error.message);
            throw error;
        }
    }

    async function register() {
        log.info('Registering with server...');
        const result = await apiCall('/register', 'POST', {
            deviceName: `Browser-${navigator.platform}-${Date.now().toString(36)}`,
            userAgent: navigator.userAgent
        });
        state.deviceId = result.deviceId;
        state.assignedState = result.assignedState;
        log.success(`Registered! Device ID: ${state.deviceId.substring(0, 8)}`);
        log.success(`Assigned to: ${state.assignedState}`);
        return result;
    }

    async function sendHeartbeat() {
        if (!state.deviceId) return;
        try {
            await apiCall('/heartbeat', 'POST', {
                deviceId: state.deviceId,
                currentLocation: state.currentLocation,
                currentImageIndex: state.currentImageIndex,
                stats: {
                    newRecords: 0,
                    newImages: 0
                }
            });
            if (CONFIG.DEBUG) log.info('Heartbeat sent');
        } catch (e) {
            log.warn('Heartbeat failed:', e.message);
        }
    }

    async function submitData(records, location, imageUrl) {
        if (!state.deviceId || records.length === 0) return;
        try {
            const result = await apiCall('/submit-data', 'POST', {
                deviceId: state.deviceId,
                records,
                location,
                imageUrl
            });
            state.extractedRecords += result.insertedCount;
            log.success(`Submitted ${result.insertedCount} records (${state.extractedRecords} total)`);
            return result;
        } catch (e) {
            log.error('Submit data failed:', e.message);
            throw e;
        }
    }

    async function reportError(errorMessage, errorType, location) {
        if (!state.deviceId) return;
        state.errors++;
        try {
            await apiCall('/report-error', 'POST', {
                deviceId: state.deviceId,
                errorMessage,
                errorType,
                location
            });
        } catch (e) {
            log.warn('Failed to report error:', e.message);
        }
    }

    async function completeState(stats) {
        if (!state.deviceId) return;
        try {
            const result = await apiCall('/complete-state', 'POST', {
                deviceId: state.deviceId,
                stats
            });
            log.success(`State ${state.assignedState} completed!`);
            if (result.nextState) {
                state.assignedState = result.nextState;
                log.info(`Now assigned to: ${result.nextState}`);
                return true; // Continue with next state
            } else {
                log.success('All states completed!');
                return false; // All done
            }
        } catch (e) {
            log.error('Complete state failed:', e.message);
            throw e;
        }
    }

    // ========================================================================
    // FAMILYSEARCH NAVIGATION
    // ========================================================================
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function navigateToCollection() {
        const collectionUrl = `https://www.familysearch.org/search/image/index?owc=` +
            `https://www.familysearch.org/ark:/61903/3:1:3Q9M-C9Q8-39TZ?cc=${CONFIG.COLLECTION_ID}`;

        log.info('Navigating to 1860 Slave Schedule collection...');
        window.location.href = collectionUrl;
    }

    async function getLocationsForState(stateName) {
        // Use FamilySearch's internal API to get waypoints
        const apiUrl = `https://www.familysearch.org/search/imageapi/locations?collection=${CONFIG.COLLECTION_ID}`;

        try {
            const response = await fetch(apiUrl);
            const data = await response.json();

            // Filter to only our assigned state
            const stateLocations = data.locations?.filter(loc =>
                loc.name?.includes(stateName) || loc.path?.includes(stateName)
            ) || [];

            log.info(`Found ${stateLocations.length} locations for ${stateName}`);
            return stateLocations;
        } catch (e) {
            log.error('Failed to get locations:', e.message);
            return [];
        }
    }

    async function getImagesForLocation(waypointId) {
        const apiUrl = `https://www.familysearch.org/search/imageapi/images?waypoint=${waypointId}`;

        try {
            const response = await fetch(apiUrl);
            const data = await response.json();
            return data.images || [];
        } catch (e) {
            log.error('Failed to get images:', e.message);
            return [];
        }
    }

    // ========================================================================
    // DATA EXTRACTION
    // ========================================================================
    async function extractFromCurrentPage() {
        // Try to get pre-indexed data first (much more reliable)
        const records = [];

        try {
            // Look for the indexed data panel
            const indexedDataPanel = document.querySelector('[data-testid="indexed-data-panel"]') ||
                                     document.querySelector('.indexed-records') ||
                                     document.querySelector('.records-panel');

            if (indexedDataPanel) {
                // Extract from pre-indexed data
                const rows = indexedDataPanel.querySelectorAll('tr, .record-row, [data-record]');

                for (const row of rows) {
                    const nameCell = row.querySelector('[data-field="name"], .name-cell, td:first-child');
                    const name = nameCell?.textContent?.trim();

                    if (name && name.length > 1) {
                        // Determine if slaveholder or enslaved based on context
                        const rowText = row.textContent.toLowerCase();
                        const isOwner = rowText.includes('owner') ||
                                       rowText.includes('slaveholder') ||
                                       !rowText.includes('slave');

                        records.push({
                            name: name,
                            type: isOwner ? 'slaveholder' : 'enslaved',
                            confidence: 0.95,
                            sourceUrl: window.location.href
                        });
                    }
                }

                log.info(`Extracted ${records.length} records from indexed data`);
            } else {
                // Fallback: Try to read from visible text on page
                log.warn('No indexed data panel found, attempting text extraction...');

                // Look for common patterns in census images
                const pageText = document.body.innerText;
                // This is a simplified extraction - the actual data would come from OCR
                // For now, just log that we'd need OCR
                log.warn('OCR extraction not implemented in browser version');
            }
        } catch (e) {
            log.error('Extraction failed:', e.message);
            await reportError(e.message, 'extraction_error', state.currentLocation);
        }

        return records;
    }

    // ========================================================================
    // MAIN SCRAPING LOOP
    // ========================================================================
    async function runScraper() {
        if (!state.assignedState) {
            log.error('No state assigned. Please register first.');
            return;
        }

        state.running = true;
        log.info(`Starting scrape for ${state.assignedState}...`);

        // Start heartbeat
        state.heartbeatTimer = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL);

        try {
            // Get all locations for our state
            const locations = await getLocationsForState(state.assignedState);

            if (locations.length === 0) {
                log.warn('No locations found for state. Checking database...');
                // The state might already be done or there's an API issue
                await sleep(5000);
                return;
            }

            for (const location of locations) {
                if (!state.running) {
                    log.warn('Scraper stopped by user');
                    break;
                }

                state.currentLocation = location.name || location.path;
                log.info(`Processing location: ${state.currentLocation}`);

                // Get images for this location
                const images = await getImagesForLocation(location.id || location.waypointId);
                state.totalImages = images.length;
                state.currentImageIndex = 0;

                log.info(`Found ${images.length} images at this location`);

                for (const image of images) {
                    if (!state.running) break;

                    state.currentImageIndex++;
                    log.info(`Processing image ${state.currentImageIndex}/${state.totalImages}`);

                    // Navigate to image
                    const imageUrl = `https://www.familysearch.org/ark:/61903/3:1:${image.id}`;

                    // In a real browser context, we'd use an iframe or navigate
                    // For now, we'll use fetch to get the indexed data
                    try {
                        const response = await fetch(`https://www.familysearch.org/search/indexapi/record?imageArk=${image.id}`);
                        const indexedData = await response.json();

                        if (indexedData.records && indexedData.records.length > 0) {
                            const records = indexedData.records.map(rec => ({
                                name: rec.name || rec.fullName || 'Unknown',
                                type: rec.recordType?.includes('Slave Owner') ? 'slaveholder' : 'enslaved',
                                gender: rec.gender,
                                age: rec.age,
                                confidence: 0.95,
                                sourceUrl: imageUrl
                            }));

                            if (records.length > 0) {
                                await submitData(records, state.currentLocation, imageUrl);
                            }
                        }
                    } catch (e) {
                        log.warn(`Failed to get indexed data for image: ${e.message}`);
                        state.errors++;

                        if (state.errors >= CONFIG.MAX_ERRORS_BEFORE_PAUSE) {
                            log.error('Too many errors, pausing...');
                            await sleep(60000); // Wait 1 minute
                            state.errors = 0;
                        }
                    }

                    await sleep(CONFIG.DELAY_BETWEEN_PAGES);
                }

                await sleep(CONFIG.DELAY_BETWEEN_LOCATIONS);
            }

            // State complete!
            const hasMore = await completeState({
                totalRecords: state.extractedRecords,
                locations: locations.length
            });

            if (hasMore) {
                // Reset for next state
                state.extractedRecords = 0;
                state.errors = 0;
                await runScraper(); // Start next state
            }

        } catch (error) {
            log.error('Scraper error:', error.message);
            await reportError(error.message, 'scraper_crash', state.currentLocation);
        } finally {
            state.running = false;
            if (state.heartbeatTimer) {
                clearInterval(state.heartbeatTimer);
            }
        }
    }

    // ========================================================================
    // CONTROL FUNCTIONS (available in console)
    // ========================================================================
    window.scraperControl = {
        start: async () => {
            if (!state.deviceId) {
                await register();
            }
            if (!state.running) {
                runScraper();
            } else {
                log.warn('Scraper already running');
            }
        },
        stop: () => {
            state.running = false;
            if (state.heartbeatTimer) {
                clearInterval(state.heartbeatTimer);
            }
            log.warn('Scraper stopping...');
        },
        status: () => log.status(),
        restart: async () => {
            window.scraperControl.stop();
            await sleep(1000);
            window.scraperControl.start();
        }
    };

    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    console.log('%c===========================================', 'color: #9C27B0; font-weight: bold; font-size: 16px');
    console.log('%c   1860 SLAVE SCHEDULE BROWSER SCRAPER', 'color: #9C27B0; font-weight: bold; font-size: 16px');
    console.log('%c===========================================', 'color: #9C27B0; font-weight: bold; font-size: 16px');
    console.log('');
    console.log('Commands:');
    console.log('  scraperControl.start()   - Register and start scraping');
    console.log('  scraperControl.stop()    - Stop scraping');
    console.log('  scraperControl.status()  - Show current status');
    console.log('  scraperControl.restart() - Restart scraping');
    console.log('');

    // Auto-start registration
    log.info('Attempting to register with server...');
    try {
        await register();
        log.success('Ready to scrape! Run scraperControl.start() to begin.');
        log.info(`You are assigned to: ${state.assignedState}`);
    } catch (e) {
        log.error('Registration failed. Server may be down or unreachable.');
        log.info('You can try again with: scraperControl.start()');
    }

})();
