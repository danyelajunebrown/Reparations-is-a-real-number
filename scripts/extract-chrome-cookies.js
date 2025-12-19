/**
 * Extract FamilySearch cookies from Chrome's cookie database
 * 
 * NOTE: Chrome must be CLOSED for this to work (it locks the database)
 */

const sqlite3 = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

// Chrome cookie database path
const CHROME_COOKIE_DB = path.join(
    os.homedir(),
    'Library/Application Support/Google/Chrome/Default/Cookies'
);

const OUTPUT_FILE = path.join(__dirname, '../fs-cookies.json');

// We need to decrypt Chrome cookies on macOS using keychain
async function extractFamilySearchCookies() {
    console.log('Extracting FamilySearch cookies from Chrome...\n');

    // Check if Chrome is running
    try {
        const ps = execSync('pgrep -f "Google Chrome"').toString();
        if (ps.trim()) {
            console.log('⚠️  Chrome is running. Please CLOSE Chrome completely first.');
            console.log('   (Check for Chrome in the Dock - right-click and Quit)');
            process.exit(1);
        }
    } catch (e) {
        // pgrep returns non-zero if no processes found - that's good
    }

    if (!fs.existsSync(CHROME_COOKIE_DB)) {
        console.log('Chrome cookie database not found at:', CHROME_COOKIE_DB);
        process.exit(1);
    }

    // Copy database to avoid lock issues
    const tempDb = '/tmp/chrome_cookies_copy.db';
    fs.copyFileSync(CHROME_COOKIE_DB, tempDb);
    
    const db = sqlite3(tempDb, { readonly: true });

    // Query FamilySearch cookies
    const cookies = db.prepare(`
        SELECT 
            name,
            CASE WHEN host_key LIKE '.%' THEN substr(host_key, 2) ELSE host_key END as domain,
            path,
            is_secure as secure,
            is_httponly as httpOnly,
            expires_utc,
            encrypted_value,
            value
        FROM cookies 
        WHERE host_key LIKE '%familysearch%'
    `).all();

    db.close();
    fs.unlinkSync(tempDb);

    console.log(`Found ${cookies.length} FamilySearch cookies\n`);

    if (cookies.length === 0) {
        console.log('No FamilySearch cookies found!');
        console.log('Please log into FamilySearch in Chrome first, then close Chrome and run this again.');
        process.exit(1);
    }

    // Note: On macOS, cookies are encrypted with the Keychain
    // For now, we'll just get the metadata and ask the user to export manually
    console.log('Cookie names found:');
    cookies.forEach(c => {
        console.log(`  - ${c.name} (${c.domain})`);
    });

    console.log('\n⚠️  Chrome encrypts cookies on macOS.');
    console.log('Alternative: Please export cookies manually using EditThisCookie extension.');
    
    return cookies;
}

extractFamilySearchCookies();
