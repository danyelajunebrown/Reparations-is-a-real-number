#!/usr/bin/env node
/**
 * Test harness for discoverParents() — exercises the full multi-source pipeline
 * with real participants to identify failures before the live event.
 *
 * Usage:
 *   FAMILYSEARCH_INTERACTIVE=true node scripts/test-discover-parents.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const sql = neon(process.env.DATABASE_URL);
const INTERACTIVE = process.env.FAMILYSEARCH_INTERACTIVE === 'true';

let browser = null;
let page = null;

// ═══════════════════════════════════════════════════════════════
// TEST PARTICIPANTS
// ═══════════════════════════════════════════════════════════════
const TEST_CASES = [
    {
        label: 'Amber Lucia Chabus',
        person: {
            name: 'Amber Lucia Chabus',
            birth_year: 1997, // ~29 years old
            birth_place: 'Scotch Plains, New Jersey',
            locations: ['New Jersey'],
            fs_id: null
        },
        participantInfo: {
            fatherName: 'Brent L Chabus',
            motherName: 'Doris G Alvarado',
            birthYear: 1997,
            birthLocation: 'Scotch Plains, New Jersey'
        }
    },
    {
        label: 'Bailey Abendschoen Smith',
        person: {
            name: 'Bailey Abendschoen Smith',
            birth_year: 1989, // age 37
            birth_place: 'Marietta, Ohio',
            locations: ['Ohio'],
            fs_id: null
        },
        participantInfo: {
            fatherName: 'Grady Smith',
            motherName: 'Susan Miller',
            birthYear: 1989,
            birthLocation: 'Marietta, Ohio'
        }
    }
];

// ═══════════════════════════════════════════════════════════════
// BROWSER SETUP (copied from climber, minimized)
// ═══════════════════════════════════════════════════════════════
async function initBrowser() {
    const userDataDir = path.join(process.cwd(), '.chrome-profile-test');
    console.log('Launching Chrome (separate test profile)...');
    browser = await puppeteer.launch({
        headless: !INTERACTIVE,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        userDataDir,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1200', '--disable-infobars',
               '--no-first-run', '--no-default-browser-check'],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1200 });

    const cookieFile = './fs-cookies.json';
    if (fs.existsSync(cookieFile)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
            await page.setCookie(...cookies);
        } catch (e) {}
    }
    return page;
}

async function detectCaptcha() {
    try {
        const url = page.url();
        if (url.includes('challenge') || url.includes('captcha')) {
            console.log('   *** CAPTCHA DETECTED — solve it manually ***');
            // Wait up to 2 min for manual solve
            for (let i = 0; i < 24; i++) {
                await new Promise(r => setTimeout(r, 5000));
                const newUrl = page.url();
                if (!newUrl.includes('challenge') && !newUrl.includes('captcha')) {
                    console.log('   *** CAPTCHA solved ***');
                    return false;
                }
            }
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// Source 1: searchTreeForPerson — search FS tree by name
// ═══════════════════════════════════════════════════════════════
async function searchTreeForPerson(name, birthYear, location) {
    if (!name) return null;
    const nameParts = name.trim().split(/\s+/);
    const givenName = nameParts[0];
    const surname = nameParts[nameParts.length - 1];

    console.log(`   [TreeSearch] Looking for ${name} in FamilySearch tree...`);

    try {
        const params = new URLSearchParams();
        params.set('q.givenName', givenName);
        params.set('q.surname', surname);
        if (birthYear) {
            params.set('q.birthLikeDate.from', String(birthYear - 5));
            params.set('q.birthLikeDate.to', String(birthYear + 5));
        }
        if (location) params.set('q.birthLikePlace', location);

        const searchUrl = `https://www.familysearch.org/search/record/results?${params.toString()}`;
        console.log(`   [TreeSearch] URL: ${searchUrl.substring(0, 120)}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));

        if (await detectCaptcha()) return null;

        const result = await page.evaluate(() => {
            const personLinks = document.querySelectorAll('a[href*="/tree/person/"]');
            for (const link of personLinks) {
                const href = link.href;
                const idMatch = href.match(/\/tree\/person\/(?:details\/|about\/)?([A-Z0-9]{4}-[A-Z0-9]{2,4})/);
                if (idMatch) {
                    return { fsId: idMatch[1], name: link.innerText?.trim() || null };
                }
            }
            return null;
        });

        if (result) {
            console.log(`   [TreeSearch] FOUND: ${result.name || 'unknown'} (${result.fsId})`);
        } else {
            console.log('   [TreeSearch] No tree person found');
            // Dump page info for debugging
            const debugInfo = await page.evaluate(() => {
                const h1 = document.querySelector('h1');
                const resultCount = h1 ? h1.innerText : 'no h1';
                const links = Array.from(document.querySelectorAll('a')).slice(0, 20).map(a => ({
                    text: (a.innerText || '').substring(0, 50),
                    href: (a.href || '').substring(0, 80)
                }));
                return { resultCount, bodySnippet: document.body.innerText.substring(0, 500), linkCount: document.querySelectorAll('a').length, sampleLinks: links };
            });
            console.log(`   [TreeSearch] Debug: h1="${debugInfo.resultCount}", ${debugInfo.linkCount} links`);
            console.log(`   [TreeSearch] Body snippet: ${debugInfo.bodySnippet.substring(0, 200).replace(/\n/g, ' | ')}`);
        }
        return result;
    } catch (err) {
        console.log(`   [TreeSearch] Error: ${err.message.substring(0, 80)}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// Source 2: searchFamilySearchRecords — search FS historical records
// ═══════════════════════════════════════════════════════════════
async function searchFamilySearchRecords(person) {
    if (!person.name) return [];
    const nameParts = person.name.trim().split(/\s+/);
    const givenName = nameParts[0];
    const surname = nameParts[nameParts.length - 1];

    const params = new URLSearchParams();
    params.set('q.givenName', givenName);
    params.set('q.surname', surname);
    if (person.birth_year) {
        params.set('q.birthLikeDate.from', String(person.birth_year - 3));
        params.set('q.birthLikeDate.to', String(person.birth_year + 3));
    }
    if (person.birth_place) {
        params.set('q.birthLikePlace', person.birth_place);
    } else if (person.locations && person.locations.length > 0) {
        params.set('q.birthLikePlace', person.locations[0]);
    }

    const searchUrl = `https://www.familysearch.org/search/record/results?${params.toString()}`;
    console.log(`   [RecordSearch] URL: ${searchUrl.substring(0, 120)}`);

    try {
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));

        if (await detectCaptcha()) return [];

        const results = await page.evaluate((personName, personSurname) => {
            const bodyText = document.body.innerText;
            const found = [];

            // Check result count
            const h1 = document.querySelector('h1');
            const resultText = h1 ? h1.innerText : '';

            // Strategy 1: Record cards with Parents field
            const recordCards = document.querySelectorAll('[data-testid*="result"], .result-item, [class*="result"]');
            if (recordCards.length > 0) {
                for (const card of recordCards) {
                    const cardText = card.innerText || '';
                    const parentMatch = cardText.match(/Parents?\s+([^\n]+)/i);
                    if (parentMatch) {
                        const cleanLine = parentMatch[1].trim().replace(/\s*(Siblings|Spouses|Children|More)\b.*$/i, '').trim();
                        const parentNames = cleanLine.split(/,\s*/);
                        if (parentNames.length >= 1) {
                            const p1 = parentNames[0].split('\n')[0].trim();
                            if (p1.length >= 3 && /^[A-Z]/i.test(p1)) {
                                found.push({ parentName: p1, relationship: 'father', discoveryMethod: 'record_search', confidence: 0.75 });
                            }
                        }
                        if (parentNames.length >= 2) {
                            const p2 = parentNames[1].split('\n')[0].trim();
                            if (p2.length >= 3 && /^[A-Z]/i.test(p2)) {
                                found.push({ parentName: p2, relationship: 'mother', discoveryMethod: 'record_search', confidence: 0.75 });
                            }
                        }
                        if (found.length >= 2) break;
                    }
                }
            }

            // Strategy 2: Body text regex
            if (found.length === 0) {
                const lines = bodyText.split('\n');
                for (const line of lines) {
                    const parentMatch = line.match(/Parents?\s+(.+)/i);
                    if (parentMatch) {
                        const cleanLine = parentMatch[1].trim().replace(/\s*(Siblings|Spouses|Children|More)\b.*$/i, '').trim();
                        const parentNames = cleanLine.split(/,\s*/);
                        if (parentNames.length >= 1) {
                            const p1 = parentNames[0].split('\n')[0].trim();
                            if (p1.length >= 3 && /^[A-Z]/i.test(p1)) {
                                found.push({ parentName: p1, relationship: 'father', discoveryMethod: 'record_search', confidence: 0.75 });
                            }
                        }
                        if (parentNames.length >= 2) {
                            const p2 = parentNames[1].split('\n')[0].trim();
                            if (p2.length >= 3 && /^[A-Z]/i.test(p2)) {
                                found.push({ parentName: p2, relationship: 'mother', discoveryMethod: 'record_search', confidence: 0.75 });
                            }
                        }
                        if (found.length >= 2) break;
                    }
                }
            }

            // ARK links for drill-down
            const arkLinks = [];
            for (const link of document.querySelectorAll('a[href*="/ark:/61903/1:1:"]')) {
                const text = (link.innerText || '').trim();
                if (text && text.length > 2 && !arkLinks.some(r => r.href === link.href)) {
                    arkLinks.push({ href: link.href, text: text.substring(0, 60) });
                }
            }

            return {
                resultCount: resultText,
                cardCount: recordCards.length,
                parents: found,
                arkLinks: arkLinks.slice(0, 5),
                bodySnippet: bodyText.substring(0, 800)
            };
        }, person.name, surname);

        console.log(`   [RecordSearch] Results: "${results.resultCount}", ${results.cardCount} cards, ${results.arkLinks.length} ARK links`);

        if (results.parents.length > 0) {
            console.log(`   [RecordSearch] FOUND parents: ${results.parents.map(p => `${p.relationship}=${p.parentName}`).join(', ')}`);
            return results.parents;
        }

        // Drill into top record pages
        if (results.arkLinks.length > 0) {
            console.log(`   [RecordSearch] No inline parents. Drilling into ${results.arkLinks.length} records...`);
            for (const record of results.arkLinks.slice(0, 3)) {
                console.log(`   [RecordSearch] Trying: ${record.text} → ${record.href.substring(0, 80)}`);
                const recordParents = await extractParentsFromRecord(record.href);
                if (recordParents.length > 0) return recordParents;
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // Dump body for debugging if nothing found
        console.log(`   [RecordSearch] Body snippet:\n${results.bodySnippet.substring(0, 400).replace(/\n/g, '\n      ')}`);
        return [];
    } catch (err) {
        console.log(`   [RecordSearch] Error: ${err.message.substring(0, 80)}`);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════
// Source 2b: extractParentsFromRecord — drill into individual ARK records
// ═══════════════════════════════════════════════════════════════
async function extractParentsFromRecord(arkUrl) {
    console.log(`   [RecordDetail] Navigating to: ${arkUrl.substring(0, 80)}`);
    try {
        await page.goto(arkUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 4000));
        if (await detectCaptcha()) return [];

        const parents = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const found = [];

            const extractName = (raw) => {
                if (!raw) return null;
                let name = raw.split('\n')[0].split('\t')[0].trim();
                name = name.replace(/\s*(Siblings|Spouses|Children|More|Principal|OPEN|ALL)\b.*$/i, '').trim();
                name = name.replace(/,\s*$/, '').trim();
                if (name.length < 2 || !/^[A-Z]/i.test(name)) return null;
                return name;
            };

            // Table rows
            const rows = document.querySelectorAll('tr, [data-testid*="detail"]');
            for (const row of rows) {
                const cells = row.querySelectorAll('td, th, span');
                if (cells.length >= 2) {
                    const label = (cells[0].innerText || '').trim().toLowerCase();
                    const value = (cells[1].innerText || '').trim();
                    if (/^father/.test(label)) {
                        const name = extractName(value);
                        if (name) found.push({ parentName: name, relationship: 'father', discoveryMethod: 'record_search', confidence: 0.80, sourceUrl: window.location.href });
                    }
                    if (/^mother/.test(label)) {
                        const name = extractName(value);
                        if (name) found.push({ parentName: name, relationship: 'mother', discoveryMethod: 'record_search', confidence: 0.80, sourceUrl: window.location.href });
                    }
                }
            }

            // Line-based
            if (found.length === 0) {
                const lines = bodyText.split('\n');
                for (const line of lines) {
                    const fm = line.match(/^(?:Father|Father'?s?\s*Name)\s*\t?\s*(.+)/i);
                    if (fm) { const n = extractName(fm[1]); if (n) found.push({ parentName: n, relationship: 'father', discoveryMethod: 'record_search', confidence: 0.80, sourceUrl: window.location.href }); }
                    const mm = line.match(/^(?:Mother|Mother'?s?\s*Name)\s*\t?\s*(.+)/i);
                    if (mm) { const n = extractName(mm[1]); if (n) found.push({ parentName: n, relationship: 'mother', discoveryMethod: 'record_search', confidence: 0.80, sourceUrl: window.location.href }); }
                }
            }

            // Census head inference
            if (found.length === 0) {
                const relMatch = bodyText.match(/Relationship\s*(?:to\s*Head)?\s*[\t:]\s*(Son|Daughter|Child)/i);
                if (relMatch) {
                    const lines = bodyText.split('\n');
                    for (const line of lines) {
                        const hm = line.match(/^Head\s*\t\s*(.+)/i);
                        if (hm) { const n = extractName(hm[1]); if (n) found.push({ parentName: n, relationship: 'father', discoveryMethod: 'census_household', confidence: 0.70, sourceUrl: window.location.href }); }
                        const wm = line.match(/^(?:Wife|Spouse)\s*\t\s*(.+)/i);
                        if (wm) { const n = extractName(wm[1]); if (n) found.push({ parentName: n, relationship: 'mother', discoveryMethod: 'census_household', confidence: 0.70, sourceUrl: window.location.href }); }
                    }
                }
            }

            return { parents: found, bodySnippet: bodyText.substring(0, 600) };
        });

        if (parents.parents.length > 0) {
            console.log(`   [RecordDetail] FOUND: ${parents.parents.map(p => `${p.relationship}=${p.parentName}`).join(', ')}`);
            return parents.parents;
        }

        console.log(`   [RecordDetail] No parents found. Body snippet:\n      ${parents.bodySnippet.substring(0, 300).replace(/\n/g, '\n      ')}`);
        return [];
    } catch (err) {
        console.log(`   [RecordDetail] Error: ${err.message.substring(0, 80)}`);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════
// Source 3: WikiTree API
// ═══════════════════════════════════════════════════════════════
async function searchWikiTree(person) {
    if (!person.name) return [];
    const nameParts = person.name.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];

    console.log(`   [WikiTree] Searching for ${firstName} ${lastName}...`);
    try {
        const url = `https://api.wikitree.com/api.php?action=searchPerson&FirstName=${encodeURIComponent(firstName)}&LastName=${encodeURIComponent(lastName)}&format=json`;
        const resp = await fetch(url);
        const data = await resp.json();

        const results = data?.[0]?.searchPerson || [];
        console.log(`   [WikiTree] ${results.length} result(s)`);

        if (results.length === 0) return [];

        // Find best match by birth year
        let bestMatch = results[0];
        if (person.birth_year) {
            for (const r of results) {
                const by = parseInt(r.BirthDate?.substring(0, 4));
                if (by && Math.abs(by - person.birth_year) < 5) {
                    bestMatch = r;
                    break;
                }
            }
        }

        // Get full profile with parents
        const profileUrl = `https://api.wikitree.com/api.php?action=getProfile&key=${bestMatch.Name}&fields=Father,Mother,Parents&format=json`;
        const profileResp = await fetch(profileUrl);
        const profileData = await profileResp.json();
        const profile = profileData?.[0]?.profile;

        if (!profile) return [];

        const parents = [];
        if (profile.Father) {
            const fName = [profile.Father.FirstName, profile.Father.LastNameAtBirth || profile.Father.LastNameCurrent].filter(Boolean).join(' ');
            if (fName.length > 2) {
                parents.push({ parentName: fName, relationship: 'father', discoveryMethod: 'wikitree', confidence: 0.75 });
                console.log(`   [WikiTree] Father: ${fName}`);
            }
        }
        if (profile.Mother) {
            const mName = [profile.Mother.FirstName, profile.Mother.LastNameAtBirth || profile.Mother.LastNameCurrent].filter(Boolean).join(' ');
            if (mName.length > 2) {
                parents.push({ parentName: mName, relationship: 'mother', discoveryMethod: 'wikitree', confidence: 0.75 });
                console.log(`   [WikiTree] Mother: ${mName}`);
            }
        }

        return parents;
    } catch (err) {
        console.log(`   [WikiTree] Error: ${err.message.substring(0, 60)}`);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════
// discoverParents — copied from climber, uses our local functions
// ═══════════════════════════════════════════════════════════════
async function discoverParents(person, participantInfo = {}) {
    console.log('   === PARENT DISCOVERY (multi-source) ===');
    const allDiscovered = [];

    // Source 1: participant-provided parent names
    if (participantInfo.fatherName || participantInfo.motherName) {
        console.log('   [1] Checking participant-provided parent names...');
        if (participantInfo.fatherName) {
            const fatherResult = await searchTreeForPerson(
                participantInfo.fatherName,
                person.birth_year ? person.birth_year - 25 : null,
                person.birth_place || (person.locations && person.locations[0])
            );
            allDiscovered.push({
                parentName: participantInfo.fatherName,
                parentFsId: fatherResult?.fsId || null,
                relationship: 'father',
                confidence: fatherResult ? 0.85 : 0.70,
                discoveryMethod: 'participant_provided',
                sourceUrl: fatherResult ? `https://www.familysearch.org/tree/person/details/${fatherResult.fsId}` : null
            });
            await new Promise(r => setTimeout(r, 2000));
        }
        if (participantInfo.motherName) {
            const motherResult = await searchTreeForPerson(
                participantInfo.motherName,
                person.birth_year ? person.birth_year - 25 : null,
                person.birth_place || (person.locations && person.locations[0])
            );
            allDiscovered.push({
                parentName: participantInfo.motherName,
                parentFsId: motherResult?.fsId || null,
                relationship: 'mother',
                confidence: motherResult ? 0.85 : 0.70,
                discoveryMethod: 'participant_provided',
                sourceUrl: motherResult ? `https://www.familysearch.org/tree/person/details/${motherResult.fsId}` : null
            });
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    const fatherFound = allDiscovered.find(p => p.relationship === 'father' && p.parentFsId);
    const motherFound = allDiscovered.find(p => p.relationship === 'mother' && p.parentFsId);
    if (fatherFound && motherFound) {
        console.log('   === Both parents found via participant info ===');
        return allDiscovered;
    }

    // Source 2: FamilySearch record search (search for the PARENT, not the child)
    if (!fatherFound || !motherFound) {
        console.log('   [2] Searching FamilySearch historical records for the participant...');
        const recordParents = await searchFamilySearchRecords(person);
        for (const rp of recordParents) {
            if (!allDiscovered.some(d => d.relationship === rp.relationship && d.parentFsId)) {
                const treeResult = await searchTreeForPerson(rp.parentName, person.birth_year ? person.birth_year - 25 : null, null);
                allDiscovered.push({
                    ...rp,
                    parentFsId: treeResult?.fsId || null,
                    sourceUrl: rp.sourceUrl || null
                });
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    // Source 3: WikiTree
    const fatherFoundNow = allDiscovered.find(p => p.relationship === 'father' && p.parentFsId);
    const motherFoundNow = allDiscovered.find(p => p.relationship === 'mother' && p.parentFsId);
    if (!fatherFoundNow && !motherFoundNow) {
        console.log('   [3] Searching WikiTree...');
        const wikiParents = await searchWikiTree(person);
        for (const wp of wikiParents) {
            if (!allDiscovered.some(d => d.relationship === wp.relationship && d.parentName)) {
                allDiscovered.push({ ...wp, parentFsId: null });
            }
        }
    }

    // Summary
    if (allDiscovered.length > 0) {
        console.log(`\n   === DISCOVERED ${allDiscovered.length} parent(s) ===`);
        for (const p of allDiscovered) {
            const status = p.parentFsId ? `FS ID: ${p.parentFsId}` : 'NO FS ID';
            console.log(`   ${p.relationship.padEnd(8)} ${p.parentName.padEnd(30)} ${status} (${p.discoveryMethod}, conf=${p.confidence})`);
        }
    } else {
        console.log('\n   === NO PARENTS DISCOVERED ===');
    }

    return allDiscovered;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   PARENT DISCOVERY TEST HARNESS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    await initBrowser();

    // Check login
    console.log('Checking FamilySearch login...');
    await page.goto('https://www.familysearch.org/search/catalog', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    const loggedIn = await page.evaluate(() => !document.body.innerText.includes('Sign In'));
    if (!loggedIn) {
        console.log('*** NOT LOGGED IN — please log in manually in the browser window ***');
        console.log('Waiting up to 2 minutes...');
        for (let i = 0; i < 24; i++) {
            await new Promise(r => setTimeout(r, 5000));
            const now = await page.evaluate(() => !document.body.innerText.includes('Sign In'));
            if (now) { console.log('Logged in!'); break; }
        }
    } else {
        console.log('Logged in to FamilySearch.\n');
    }

    const results = {};

    for (const tc of TEST_CASES) {
        console.log('\n' + '='.repeat(65));
        console.log(`TEST: ${tc.label}`);
        console.log(`Person: ${tc.person.name}, b.${tc.person.birth_year}, ${tc.person.birth_place}`);
        console.log(`Father: ${tc.participantInfo.fatherName}, Mother: ${tc.participantInfo.motherName}`);
        console.log('='.repeat(65) + '\n');

        const startTime = Date.now();
        const discovered = await discoverParents(tc.person, tc.participantInfo);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        results[tc.label] = {
            discovered,
            elapsed,
            fatherFsId: discovered.find(d => d.relationship === 'father')?.parentFsId || null,
            motherFsId: discovered.find(d => d.relationship === 'mother')?.parentFsId || null
        };

        console.log(`\n   Time: ${elapsed}s`);
        console.log(`   Father FS ID: ${results[tc.label].fatherFsId || 'NOT FOUND'}`);
        console.log(`   Mother FS ID: ${results[tc.label].motherFsId || 'NOT FOUND'}`);

        // Also try searching for the parents directly in FS tree (separate from discoverParents)
        console.log('\n   --- DIRECT PARENT TREE SEARCH (backup) ---');
        if (!results[tc.label].fatherFsId) {
            console.log(`   Trying direct tree search for father: ${tc.participantInfo.fatherName}`);
            const fatherDirect = await searchTreeForPerson(tc.participantInfo.fatherName, null, tc.person.birth_place);
            if (fatherDirect) {
                console.log(`   FOUND father in tree: ${fatherDirect.fsId}`);
                results[tc.label].fatherFsId = fatherDirect.fsId;
            }
        }
        if (!results[tc.label].motherFsId) {
            console.log(`   Trying direct tree search for mother: ${tc.participantInfo.motherName}`);
            const motherDirect = await searchTreeForPerson(tc.participantInfo.motherName, null, tc.person.birth_place);
            if (motherDirect) {
                console.log(`   FOUND mother in tree: ${motherDirect.fsId}`);
                results[tc.label].motherFsId = motherDirect.fsId;
            }
        }

        await new Promise(r => setTimeout(r, 3000)); // Breathe between tests
    }

    // Final report
    console.log('\n\n' + '='.repeat(65));
    console.log('   FINAL REPORT');
    console.log('='.repeat(65));
    for (const [name, r] of Object.entries(results)) {
        const fStatus = r.fatherFsId ? `YES (${r.fatherFsId})` : 'NO';
        const mStatus = r.motherFsId ? `YES (${r.motherFsId})` : 'NO';
        console.log(`\n${name}:`);
        console.log(`   Father FS ID: ${fStatus}`);
        console.log(`   Mother FS ID: ${mStatus}`);
        console.log(`   Time: ${r.elapsed}s`);
        console.log(`   Climb-ready: ${r.fatherFsId || r.motherFsId ? 'YES' : 'NO — needs manual research'}`);
    }
    console.log('='.repeat(65));

    await browser.close();
}

main().catch(err => {
    console.error('Fatal:', err);
    if (browser) browser.close().catch(() => {});
    process.exit(1);
});
