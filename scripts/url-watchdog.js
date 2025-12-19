#!/usr/bin/env node
/**
 * URL/Document Watchdog
 *
 * Monitors archived URLs for:
 * - Availability (is the source still online?)
 * - Tampering (has the content changed since we archived it?)
 * - SSL/security issues
 *
 * Usage:
 *   node scripts/url-watchdog.js [--check-all] [--limit N] [--alert-only]
 */

const { pool } = require('../src/database/connection');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

// Configuration
const CONFIG = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    timeout: 30000, // 30 seconds
    retries: 2,
    delayBetweenChecks: 2000, // 2 seconds between checks to avoid rate limiting
};

// Status codes
const STATUS = {
    OK: 'ok',
    CHANGED: 'content_changed',
    UNAVAILABLE: 'unavailable',
    TIMEOUT: 'timeout',
    SSL_ERROR: 'ssl_error',
    REDIRECT: 'redirect',
    BLOCKED: 'blocked',
    ERROR: 'error'
};

/**
 * Fetch URL and return status + content hash
 */
async function checkUrl(url, expectedHash = null) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            timeout: CONFIG.timeout,
            headers: {
                'User-Agent': CONFIG.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }
        };

        const req = protocol.request(options, (res) => {
            const responseTime = Date.now() - startTime;
            let data = [];

            // Check for redirects
            if (res.statusCode >= 300 && res.statusCode < 400) {
                resolve({
                    status: STATUS.REDIRECT,
                    statusCode: res.statusCode,
                    redirectUrl: res.headers.location,
                    responseTime
                });
                return;
            }

            // Check for blocks/forbidden
            if (res.statusCode === 403 || res.statusCode === 429) {
                resolve({
                    status: STATUS.BLOCKED,
                    statusCode: res.statusCode,
                    responseTime
                });
                return;
            }

            // Check for not found
            if (res.statusCode === 404) {
                resolve({
                    status: STATUS.UNAVAILABLE,
                    statusCode: res.statusCode,
                    responseTime
                });
                return;
            }

            // Check for server errors
            if (res.statusCode >= 500) {
                resolve({
                    status: STATUS.ERROR,
                    statusCode: res.statusCode,
                    responseTime
                });
                return;
            }

            res.on('data', chunk => data.push(chunk));

            res.on('end', () => {
                const content = Buffer.concat(data);
                const contentHash = crypto.createHash('sha256').update(content).digest('hex');

                let status = STATUS.OK;
                if (expectedHash && contentHash !== expectedHash) {
                    status = STATUS.CHANGED;
                }

                resolve({
                    status,
                    statusCode: res.statusCode,
                    contentHash,
                    contentLength: content.length,
                    responseTime,
                    hashMatch: expectedHash ? contentHash === expectedHash : null
                });
            });
        });

        req.on('error', (err) => {
            if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
                resolve({ status: STATUS.SSL_ERROR, error: err.message });
            } else {
                resolve({ status: STATUS.ERROR, error: err.message });
            }
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ status: STATUS.TIMEOUT });
        });

        req.end();
    });
}

/**
 * Check a batch of URLs from the database
 */
async function runWatchdog(options = {}) {
    const { checkAll = false, limit = 100, alertOnly = false } = options;

    console.log('='.repeat(70));
    console.log('URL/DOCUMENT WATCHDOG');
    console.log('='.repeat(70));
    console.log(`Mode: ${checkAll ? 'Check ALL URLs' : 'Check URLs not verified recently'}`);
    console.log(`Limit: ${limit} URLs`);
    console.log('');

    try {
        // Get URLs to check
        let query;
        if (checkAll) {
            query = `
                SELECT id, url, content_hash, last_verified, s3_key
                FROM archived_urls
                ORDER BY last_verified ASC NULLS FIRST
                LIMIT $1
            `;
        } else {
            // Check URLs not verified in last 24 hours
            query = `
                SELECT id, url, content_hash, last_verified, s3_key
                FROM archived_urls
                WHERE last_verified IS NULL
                   OR last_verified < NOW() - INTERVAL '24 hours'
                ORDER BY last_verified ASC NULLS FIRST
                LIMIT $1
            `;
        }

        const result = await pool.query(query, [limit]);
        const urls = result.rows;

        console.log(`Found ${urls.length} URLs to check\n`);

        if (urls.length === 0) {
            console.log('All URLs verified recently. Use --check-all to force recheck.');
            return { checked: 0, issues: [] };
        }

        const issues = [];
        const stats = {
            ok: 0,
            changed: 0,
            unavailable: 0,
            timeout: 0,
            blocked: 0,
            ssl_error: 0,
            redirect: 0,
            error: 0
        };

        for (let i = 0; i < urls.length; i++) {
            const { id, url, content_hash, s3_key } = urls[i];

            process.stdout.write(`[${i + 1}/${urls.length}] Checking: ${url.substring(0, 60)}...`);

            const result = await checkUrl(url, content_hash);
            stats[result.status]++;

            // Update database
            await pool.query(`
                UPDATE archived_urls
                SET last_verified = NOW(),
                    metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
                WHERE id = $1
            `, [id, JSON.stringify({
                last_check: new Date().toISOString(),
                status: result.status,
                status_code: result.statusCode,
                response_time_ms: result.responseTime
            })]);

            // Report status
            if (result.status === STATUS.OK) {
                console.log(` OK (${result.responseTime}ms)`);
            } else {
                console.log(` ${result.status.toUpperCase()}`);
                issues.push({
                    id,
                    url,
                    s3_key,
                    status: result.status,
                    details: result
                });
            }

            // Delay between checks
            if (i < urls.length - 1) {
                await new Promise(r => setTimeout(r, CONFIG.delayBetweenChecks));
            }
        }

        // Summary
        console.log('\n' + '='.repeat(70));
        console.log('WATCHDOG SUMMARY');
        console.log('='.repeat(70));
        console.log(`Total checked: ${urls.length}`);
        console.log(`  OK:          ${stats.ok}`);
        console.log(`  Changed:     ${stats.changed}`);
        console.log(`  Unavailable: ${stats.unavailable}`);
        console.log(`  Timeout:     ${stats.timeout}`);
        console.log(`  Blocked:     ${stats.blocked}`);
        console.log(`  SSL Error:   ${stats.ssl_error}`);
        console.log(`  Redirect:    ${stats.redirect}`);
        console.log(`  Other Error: ${stats.error}`);

        if (issues.length > 0) {
            console.log('\n' + '='.repeat(70));
            console.log('ISSUES DETECTED');
            console.log('='.repeat(70));

            for (const issue of issues) {
                console.log(`\n[${issue.status.toUpperCase()}] ${issue.url}`);
                if (issue.s3_key) {
                    console.log(`  Archived at: ${issue.s3_key}`);
                }
                if (issue.details.error) {
                    console.log(`  Error: ${issue.details.error}`);
                }
                if (issue.details.redirectUrl) {
                    console.log(`  Redirects to: ${issue.details.redirectUrl}`);
                }
            }

            // Log issues to database
            await logIssues(issues);
        }

        return { checked: urls.length, issues };

    } catch (err) {
        console.error('Watchdog error:', err.message);
        throw err;
    }
}

/**
 * Log issues to a separate tracking table
 */
async function logIssues(issues) {
    // Create issues table if not exists
    await pool.query(`
        CREATE TABLE IF NOT EXISTS watchdog_alerts (
            id SERIAL PRIMARY KEY,
            archived_url_id INTEGER REFERENCES archived_urls(id),
            url TEXT NOT NULL,
            alert_type VARCHAR(50) NOT NULL,
            details JSONB,
            resolved BOOLEAN DEFAULT FALSE,
            resolved_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    for (const issue of issues) {
        await pool.query(`
            INSERT INTO watchdog_alerts (archived_url_id, url, alert_type, details)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
        `, [issue.id, issue.url, issue.status, JSON.stringify(issue.details)]);
    }

    console.log(`\nLogged ${issues.length} alerts to watchdog_alerts table`);
}

/**
 * Check specific critical URLs (FamilySearch, Archives, etc.)
 */
async function checkCriticalSites() {
    console.log('='.repeat(70));
    console.log('CRITICAL SITE STATUS CHECK');
    console.log('='.repeat(70));

    const criticalSites = [
        { name: 'FamilySearch', url: 'https://www.familysearch.org' },
        { name: 'FamilySearch Images', url: 'https://www.familysearch.org/ark:/61903/3:1:33S7-9YBP-G64' },
        { name: 'Maryland State Archives', url: 'https://msa.maryland.gov' },
        { name: 'Ancestry', url: 'https://www.ancestry.com' },
        { name: 'SlaveVoyages', url: 'https://www.slavevoyages.org' },
        { name: 'Our S3 Archive', url: 'https://reparations-them.s3.amazonaws.com' },
    ];

    const results = [];

    for (const site of criticalSites) {
        process.stdout.write(`Checking ${site.name}... `);
        const result = await checkUrl(site.url);
        results.push({ ...site, ...result });

        if (result.status === STATUS.OK) {
            console.log(`UP (${result.responseTime}ms)`);
        } else {
            console.log(`${result.status.toUpperCase()} - ${result.error || result.statusCode || 'unknown'}`);
        }
    }

    return results;
}

/**
 * Main entry point
 */
async function main() {
    const args = process.argv.slice(2);
    const checkAll = args.includes('--check-all');
    const alertOnly = args.includes('--alert-only');
    const criticalOnly = args.includes('--critical');
    const limitArg = args.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 100;

    try {
        // Always check critical sites first
        await checkCriticalSites();
        console.log('');

        if (!criticalOnly) {
            // Run full watchdog
            await runWatchdog({ checkAll, limit, alertOnly });
        }

    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { checkUrl, runWatchdog, checkCriticalSites };
