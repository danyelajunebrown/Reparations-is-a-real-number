#!/usr/bin/env node
/**
 * Freedmen's Bank Index Scraper - Full column extraction version
 *
 * Table columns (confirmed via DOM dump 2026-04-11):
 * [0] More  [1] ATTACH  [2] Name  [3+] variable: Mother's Name, Mother's Sex,
 *     Spouse's Name, Event Place, Account Number — cells omitted when empty,
 *     so we classify by content rather than by fixed index.
 *
 * Navigation: uses spawnSync + osascript to avoid shell single-quote escaping issues.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const puppeteer = require('puppeteer-core');
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const args = process.argv;
const branchIdx = args.indexOf('--branch');
const startIdx = args.indexOf('--start');

const BRANCH = branchIdx !== -1 ? args[branchIdx + 1] : 'Richmond, Virginia';
const START_PAGE = startIdx !== -1 ? parseInt(args[startIdx + 1]) || 0 : 0;
const DRY_RUN = args.includes('--dry-run');

// Only branches with verified-working ark+wc URLs (confirmed Image Index tab with data).
// To add a new branch: open FS collection 1417695 in Chrome, drill down to an image in the
// target branch's Image Index, confirm the Image Index tab shows populated rows, then copy
// the browser URL here. Keep total = the ledger's total image count (shown bottom of viewer).
// Each branch entry:
//   total      — number of images in the roll (for the main loop stop condition)
//   url        — full FS viewer URL for the first page with data (&i=N for start)
//   location   — human-readable city/state that goes into unconfirmed_persons.locations.
//                MUST match across all rolls of the same branch so Richmond Roll 26
//                and Roll 27 are queryable together as "Richmond, Virginia".
//   rollLabel  — optional identifier like "Roll 26" that goes into context_text only,
//                so roll provenance is preserved without polluting locations.
const BRANCHES = {
    // Verified 2026-04-14: first page with structured data is image 8 (i=7).
    // Pages 1-7 are ledger cover/header blanks with an empty Image Index tab.
    'Charleston, South Carolina': {
        total: 421,
        url: 'https://www.familysearch.org/ark:/61903/3:1:S3HY-XCQD-6X?wc=3MDR-T3D%3A1551795003%2C1551795001%26cc%3D1417695&cc=1417695&lang=en&i=7',
        location: 'Charleston, South Carolina',
        rollLabel: 'Roll 22'
    },

    // Verified 2026-04-15: Roll 26 (1867-1870, accounts 232-1582). Data on i=0.
    'Richmond, Virginia — Roll 26': {
        total: 221,
        url: 'https://www.familysearch.org/ark:/61903/3:1:S3HT-67Q3-39L?wc=3MDR-K6F%3A1551793903%2C1551805363%26cc%3D1417695&lang=en&i=0',
        location: 'Richmond, Virginia',
        rollLabel: 'Roll 26'
    },

    // Verified 2026-04-15: Roll 27 (1870-1874, accounts 1591-7691). Data on i=8.
    'Richmond, Virginia — Roll 27': {
        total: 841,
        url: 'https://www.familysearch.org/ark:/61903/3:1:S3HT-67Q3-SK9?wc=3MDR-K6X%3A1551793903%2C1551793901%26cc%3D1417695&cc=1417695&lang=en&i=8',
        location: 'Richmond, Virginia',
        rollLabel: 'Roll 27'
    },

    // Verified 2026-04-15: Raleigh is a 2-image roll — only 4 depositors total.
    'Raleigh, North Carolina': {
        total: 2,
        url: 'https://www.familysearch.org/ark:/61903/3:1:S3SW-NW8X-V?wc=3MDR-BZQ%3A1551805229%2C1551805227%26cc%3D1417695&cc=1417695&lang=en&i=0',
        location: 'Raleigh, North Carolina',
        rollLabel: 'Roll 18'
    },

    // Verified 2026-04-15: Wilmington (data on page 1).
    'Wilmington, North Carolina': {
        total: 254,
        url: 'https://www.familysearch.org/ark:/61903/3:1:S3HY-XCR9-CGX?wc=3MDR-BZW%3A1551805235%2C1551805233%26cc%3D1417695&lang=en&i=0&cc=1417695',
        location: 'Wilmington, North Carolina',
        rollLabel: 'Roll 18'
    },

    // Verified 2026-04-15: DC Roll 4 — data on images 12–839.
    'Washington, D.C. — Roll 4': {
        url: 'https://www.familysearch.org/ark:/61903/3:1:S3HY-X4XW-P9?wc=3MDR-RM9%3A1551794703%2C1551800972%26cc%3D1417695&cc=1417695&lang=en&i=11',
        location: 'Washington, D.C.',
        rollLabel: 'Roll 4',
        startPage: 12,
        endPage: 839
    },

    // Verified 2026-04-15: DC Roll 5 — data on images 9–488.
    'Washington, D.C. — Roll 5': {
        url: 'https://www.familysearch.org/ark:/61903/3:1:S3HY-DYF3-BGP?wc=3MDR-2NG%3A1551794703%2C1551794701%26cc%3D1417695&cc=1417695&lang=en&i=8',
        location: 'Washington, D.C.',
        rollLabel: 'Roll 5',
        startPage: 9,
        endPage: 488
    },

    // Verified 2026-04-15: NYC — data on images 9–764.
    'New York, New York': {
        url: 'https://www.familysearch.org/ark:/61903/3:1:S3HT-6QC3-XDG?wc=3MDR-N3X%3A1551794903%2C1551794901%26cc%3D1417695&lang=en&i=8&cc=1417695',
        location: 'New York, New York',
        startPage: 9,
        endPage: 764
    },

    // Verified 2026-04-16: Baltimore — data starts at image 10. Starting from 1
    // and letting the scraper skip 9 empty cover pages naturally.
    'Baltimore, Maryland': {
        url: 'https://www.familysearch.org/ark:/61903/3:1:S3HT-6737-LHB?wc=3MDR-VZS%3A1551795403%2C1551795401%26cc%3D1417695&cc=1417695&lang=en&i=0',
        location: 'Baltimore, Maryland',
        startPage: 1,
        endPage: 825
    }
};

const sql = neon(process.env.DATABASE_URL);
const DB_URL = BRANCHES[BRANCH] && BRANCHES[BRANCH].url;

// ─── Health check ────────────────────────────────────────────────────────────
async function checkPageHealth(page) {
    const url = page.url();
    if (url.includes('getinvolved') || url.includes('identity')) return false;
    const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
    if (!bodyText || bodyText.length < 100) return false;
    return true;
}

// ─── Build an image-viewer URL for a specific page (1-indexed) ──────────────
// FS uses zero-indexed `i=` query param for image number (image 8 = i=7).
function buildImageUrl(baseUrl, pageNum) {
    // Strip any existing &i= or ?i= then append &i=<pageNum-1>
    const stripped = baseUrl.replace(/([?&])i=\d+/g, '$1').replace(/[?&]$/, '').replace(/&&+/g, '&');
    const sep = stripped.includes('?') ? '&' : '?';
    return `${stripped}${sep}i=${pageNum - 1}`;
}

// ─── Navigate the puppeteer-controlled page to a specific image ─────────────
// FamilySearch's image viewer is an SPA — page.goto() with only the `i=` query
// param changing does NOT re-render the table, and React's synthetic event
// system ignores `dispatchEvent` on the image-number input. The reliable path:
//   • First call (not yet on the branch viewer) → full page.goto() with `&i=`
//   • Subsequent calls → click the "Next Image" button FS provides in-viewer
// The main loop advances sequentially, so one click per iteration is enough.
async function navigateToPage(page, baseUrl, pageNum) {
    // Each image in a roll has its OWN ark ID, so we can't detect "still on the
    // right viewer" by ark. The `wc=` waypoint parameter is constant across all
    // images in the same roll, so use that instead.
    const wcMatch = baseUrl.match(/wc=([^&]+)/);
    const wc = wcMatch && wcMatch[1];
    const curUrl = page.url();
    const onBranchViewer = wc && curUrl.includes(`wc=${wc}`) && /\/ark:\/61903\/3:1:/.test(curUrl);

    if (!onBranchViewer) {
        const url = buildImageUrl(baseUrl, pageNum);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        try { await page.waitForSelector('tr[data-testid]', { timeout: 15000 }); } catch (_) {}
        return;
    }

    // Click FS's "Next Image" button.
    const clicked = await page.evaluate(() => {
        const btn = document.querySelector('button[aria-label="Next Image"]');
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
    }).catch(() => false);

    if (!clicked) {
        // Button missing or disabled (end of roll, or viewer not loaded) —
        // fall back to a full goto of the target image.
        const url = buildImageUrl(baseUrl, pageNum);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        try { await page.waitForSelector('tr[data-testid]', { timeout: 15000 }); } catch (_) {}
        return;
    }

    // Fixed wait for FS's React viewer to load the new image's Image Index.
    // Empirically 4s is enough for indexed data to populate. Stability polling
    // exited too early (React's row-unmount phase looks like a "change").
    await new Promise(r => setTimeout(r, 4000));
}

// ─── Ensure the Image Index tab is active (in case Information is default) ──
async function ensureImageIndexTab(page) {
    try {
        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
            const idx = tabs.find(t => /image\s*index/i.test(t.innerText || ''));
            if (idx && idx.getAttribute('aria-selected') !== 'true') idx.click();
        });
        await new Promise(r => setTimeout(r, 400));
    } catch (_) {}
}

// ─── Extraction: <th scope="row"> anchor + content classification ───────────
// Per-row column positions vary — the React table skips empty columns for some
// rows. But every row has one stable anchor: a <th scope="row"> containing the
// person's name. We use that for full_name, then scan the other cells by
// content to classify account_number / event_place / gender / other names.
async function extractRecords(page) {
    return await page.evaluate(() => {
        const NAME_REJECT_PATTERNS = [
            /^transferred\s+from/i,
            /^A\/C\s*No\./i,
            /^account\s*#?\d+/i,
            /^\d+$/,
            /^(more|attach|name|dead|closed|male|female)$/i
        ];
        // Source-text notes ("His brother Wm Morgan came with him") look name-like
        // but are prose. Reject strings that are too long, too wordy, or contain
        // sentence-y words.
        const NOTE_WORD_RE = /\b(with|came|was|were|his|her|their|both|from|wife|husband|brother|sister|son|daughter|dead|deceased|formerly|belonged|owned|free|slave|old|years|lived)\b/i;
        const looksLikeNote = (s) =>
            s.length > 40 ||
            s.split(/\s+/).length > 5 ||
            NOTE_WORD_RE.test(s);

        // Non-name column values that appear in Richmond Roll 27 / Raleigh /
        // Wilmington ledgers: state abbreviations, counties, physical
        // descriptions, occupations, money amounts, marital status. These
        // show up in family_members if we don't filter them out — none of
        // them are person names.
        const NON_NAME_RE = new RegExp([
            // US state abbreviations with optional periods
            '\\b(?:N\\.?\\s*C|S\\.?\\s*C|N\\.?\\s*Y|Va|Penna|Pa|Ga|Tenn|Ky|Ala|Md|Miss|La|Ark|Fla|Mo|Ohio|Del|Conn)\\.?\\b',
            // County markers
            '\\bCo\\.|County\\b',
            // Physical measurements / demographics
            '\\d\\s*ft\\b|\\bin\\.|\\byrs?\\b|\\byears?\\b',
            // Money amounts
            '^\\$|\\$\\d',
            // Ledger status / descriptor words
            '\\b(mulato|mulatto|dark\\s*brown|light\\s*brown|copper|yellow|ginger|bright|single|married|widowed)\\b',
            // Common occupations (Freedman's Bank ledgers)
            '\\b(driver|mason|plasterer|plusterer|minister|minor|cook|barber|laborer|porter|waiter|farmer|carpenter|blacksmith|seamstress|laundress|nurse|soldier|painter|steward|servant|washerwoman|washer|teamster|drayman|sailor|whitewasher|hostler|bricklayer|butcher|shoemaker|tailor|fisherman|hotel|exchange)\\b'
        ].join('|'), 'i');

        const isNameLike = (s) => {
            if (!s || s.length < 2) return false;
            if (NAME_REJECT_PATTERNS.some(rx => rx.test(s))) return false;
            return true;
        };
        // Stricter filter used for family_member classification only. The primary
        // name cell (children[2]) bypasses this because we trust its position.
        const isPersonName = (s) => {
            if (!isNameLike(s)) return false;
            if (looksLikeNote(s)) return false;
            if (NON_NAME_RE.test(s)) return false;
            // A person name shouldn't have more than one comma.
            if ((s.match(/,/g) || []).length > 1) return false;
            // Must contain at least one letter.
            if (!/[A-Za-z]/.test(s)) return false;
            return true;
        };
        const cellText = (el) => (el && el.innerText || '').replace(/\s+/g, ' ').trim();

        const table = document.querySelector('table[role="table"]') || document.querySelector('table');
        if (!table) return [];

        // Build a column-label → index map from the header row. Data rows share
        // the same column count and ordering as the header row's children, so
        // this gives us reliable positions for Name/Father's Name/Mother's Name/
        // Spouse's Name/Event Place/Account Number across any ledger format
        // (basic Charleston-style OR expanded Roll 27/Wilmington with age,
        // birthplace, residence, occupation, complexion columns).
        const headerRow = table.querySelector('tr[role="row"]');
        const colIndex = {};
        if (headerRow) {
            [...headerRow.children].forEach((cell, i) => {
                const label = (cell.innerText || '').trim().toLowerCase().replace(/\s+/g, ' ');
                if (label && colIndex[label] === undefined) colIndex[label] = i;
            });
        }
        const col = (...names) => {
            for (const n of names) if (colIndex[n] !== undefined) return colIndex[n];
            return -1;
        };
        const spouseIdx = col("spouse's name", 'spouse name', 'spouse');
        const fatherIdx = col("father's name", 'father name', 'father');
        const motherIdx = col("mother's name", 'mother name', 'mother');
        const placeIdx  = col('event place', 'place');
        const acctIdx   = col('account number', 'account #', 'account');

        const results = [];
        const rows = Array.from(table.querySelectorAll('tr[data-testid]'));

        for (const row of rows) {
            // Name is always at children[2] — positions 0 and 1 are the More/ATTACH
            // action buttons, and position 2 is the Name column (sometimes rendered
            // as <th scope="row">, sometimes as <td> after React hydration).
            const children = row.children;
            if (children.length < 3) continue;
            const nameCell = children[2];
            const full_name = cellText(nameCell);
            if (!isNameLike(full_name)) continue;

            const rawArk = row.getAttribute('data-testid') || '';
            const arkMatch = rawArk.match(/\/ark:\/61903\/1:1:([A-Z0-9-]+)/);
            const record_ark = arkMatch
                ? `https://www.familysearch.org/ark:/61903/1:1:${arkMatch[1]}`
                : null;

            const record = {
                full_name,
                account_number: null,
                event_place: null,
                gender: null,
                family_members: [],
                record_ark
            };

            // Header-indexed extraction: only pull data from columns we
            // specifically identified via the header row. This means age /
            // birthplace / residence / occupation / complexion / marital /
            // source-text columns are ignored entirely — their content never
            // leaks into family_members.
            const tds = row.children;
            const pullCell = (idx) => {
                if (idx < 0 || idx >= tds.length) return '';
                return cellText(tds[idx]);
            };

            // Account number: prefer header-indexed, fallback to scanning any
            // cell that matches the pattern (some ledgers mislabel columns).
            if (acctIdx !== -1) {
                const v = pullCell(acctIdx);
                if (/^\d{3,6}$/.test(v)) record.account_number = v;
            }
            if (!record.account_number) {
                for (const c of tds) {
                    const v = cellText(c);
                    if (/^\d{3,6}$/.test(v)) { record.account_number = v; break; }
                }
            }

            // Event place from its column.
            if (placeIdx !== -1) {
                const v = pullCell(placeIdx);
                if (v && /,/.test(v)) record.event_place = v;
            }

            // Family members: ONLY from spouse / father / mother columns.
            // Apply the name filter to guard against column misalignment leaking
            // non-name data (e.g. a source-text column with prose).
            const addFamily = (rel, idx) => {
                if (idx === -1) return;
                const v = pullCell(idx);
                if (v && v !== full_name && isPersonName(v)) {
                    record.family_members.push({ rel, name: v });
                }
            };
            addFamily('spouse', spouseIdx);
            addFamily('father', fatherIdx);
            addFamily('mother', motherIdx);

            results.push(record);
        }

        return results;
    });
}

// ─── Store to Neon ────────────────────────────────────────────────────────────
async function storeRecords(records, branchConfig) {
    let inserted = 0;
    const locationName = branchConfig.location;
    const rollLabel = branchConfig.rollLabel || null;

    for (const r of records) {
        if (!r.full_name || r.full_name.length < 2) continue;

        // locations: ONLY the canonical branch location. Per-row event_place
        // from the FS ledger is unreliable — varies from "Raleigh..." to
        // "Dead" to empty to narrative prose depending on ledger transcription.
        // It goes in context_text for provenance instead, so the branch
        // remains the authoritative location for queries.
        const locationArr = [locationName];

        // family_members is [{rel, name}] from the extractor.
        const rels = r.family_members.map(fm => ({ type: fm.rel || 'family_member', name: fm.name }));

        const context = [
            `Freedman's Bank depositor, ${locationName}`,
            rollLabel ? rollLabel : null,
            r.account_number ? `account #${r.account_number}` : null,
            r.event_place ? `event place: ${r.event_place}` : null
        ].filter(Boolean).join(', ');

        if (DRY_RUN) {
            console.log('DRY RUN:', JSON.stringify({
                full_name: r.full_name,
                account_number: r.account_number,
                event_place: r.event_place,
                gender: r.gender,
                family_members: r.family_members
            }));
            continue;
        }

        let attempts = 0;
        while (attempts < 5) {
            try {
                // locations is text[] — pass JS array directly (neon serializes it)
                // relationships is jsonb — cast the JSON string explicitly
                // source_url uses record_ark if available, else the collection URL
                const sourceUrl = r.record_ark || DB_URL;
                await sql`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, gender, locations,
                        source_url, extraction_method, context_text,
                        relationships, source_type
                    ) VALUES (
                        ${r.full_name},
                        'freedperson',
                        ${r.gender},
                        ${locationArr},
                        ${sourceUrl},
                        'freedmens_bank_index',
                        ${context},
                        ${JSON.stringify(rels)}::jsonb,
                        'secondary'
                    ) ON CONFLICT DO NOTHING
                `;
                inserted++;
                break;
            } catch (err) {
                attempts++;
                if (attempts >= 5) {
                    console.error(`DB insert failed for "${r.full_name}": ${err.message}`);
                } else {
                    console.error(`DB error attempt ${attempts}: ${err.message} — retrying in 10s`);
                    await new Promise(res => setTimeout(res, 10000));
                }
            }
        }
    }
    return inserted;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const config = BRANCHES[BRANCH];
    if (!config) {
        console.error(`Branch "${BRANCH}" not found!\nAvailable: ${Object.keys(BRANCHES).join(', ')}`);
        process.exit(1);
    }

    // Resolve scrape bounds. CLI --start overrides config.startPage if given.
    // config.endPage (1-indexed, inclusive) bounds the upper limit; falls back
    // to config.total - 1 to preserve backward compat with older entries.
    const cliStartProvided = process.argv.indexOf('--start') !== -1;
    const startIdx0 = cliStartProvided
        ? START_PAGE
        : (config.startPage !== undefined ? config.startPage - 1 : 0);
    const endIdx0Inclusive = config.endPage !== undefined
        ? config.endPage - 1
        : (config.total - 1);
    const loopEnd = endIdx0Inclusive + 1; // loop uses < upper bound

    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });

    console.log(`\n── SCRAPING ${BRANCH} (images ${startIdx0 + 1}–${endIdx0Inclusive + 1}) ──\n`);
    if (DRY_RUN) console.log('>>> DRY RUN MODE — no DB writes <<<\n');

    // Use an existing FS tab if available (preserves login session), otherwise
    // open a new one. We own navigation via page.goto() from here on.
    const allPages = await browser.pages();
    let page = allPages.find(p => /familysearch\.org/.test(p.url()));
    if (!page) {
        console.log('  → No FS tab found; opening a new one.');
        page = await browser.newPage();
    } else {
        console.log(`  → Reusing existing tab: ${page.url().substring(0, 90)}`);
    }

    // Navigate to the branch's base URL. Go to about:blank first to force a
    // clean SPA load (FS ignores i= param changes on same-origin navigation).
    console.log(`  → Initial goto: ${config.location} image ${startIdx0 + 1}`);
    await page.goto('about:blank', { waitUntil: 'load', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    const firstUrl = buildImageUrl(config.url, startIdx0 + 1);
    await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try { await page.waitForSelector('tr[data-testid]', { timeout: 15000 }); } catch (_) {}
    await new Promise(r => setTimeout(r, 2000));

    let consecutiveEmpty = 0;
    let totalInserted = 0;
    let prevRowSignature = null; // fingerprint of the previous page's records, used to detect end-of-roll
    let duplicateStreak = 0;

    for (let i = startIdx0; i < loopEnd; i++) {
        const pageNum = i + 1;
        // First iteration: we already landed here via the initial goto above,
        // so just extract. Subsequent iterations click Next Image.
        const isFirst = (i === startIdx0);

        try {
            if (!isFirst) await navigateToPage(page, config.url, pageNum);
        } catch (err) {
            console.error(`Navigation failed on page ${pageNum}: ${err.message}`);
            consecutiveEmpty++;
            if (consecutiveEmpty >= 10) {
                console.error('10 consecutive navigation failures. Aborting.');
                process.exit(1);
            }
            continue;
        }

        if (!(await checkPageHealth(page))) {
            consecutiveEmpty++;
            console.error(`Page ${pageNum} health check failed (url=${page.url().substring(0,60)}). Consecutive: ${consecutiveEmpty}`);
            if (consecutiveEmpty >= 10) {
                console.error('10 consecutive failures. Aborting.');
                process.exit(1);
            }
            continue;
        }

        await ensureImageIndexTab(page);
        const records = await extractRecords(page);

        // End-of-roll detection: FS's "Next Image" button silently stops
        // advancing at the end of a roll instead of becoming disabled, so
        // extractRecords keeps returning the previous image's data. Build a
        // simple fingerprint of this page's records and bail if we see the
        // same one twice in a row (skipped for the first iteration).
        const signature = records.map(r => `${r.full_name}|${r.account_number}|${r.record_ark}`).join('||');
        if (!isFirst && signature && signature === prevRowSignature) {
            duplicateStreak++;
            console.log(`Page ${pageNum}/${endIdx0Inclusive + 1} — duplicate of previous page, skipping insert (streak: ${duplicateStreak})`);
            if (duplicateStreak >= 2) {
                console.log(`  → End of roll reached (2 consecutive duplicate pages). Stopping.`);
                break;
            }
            continue;
        }
        duplicateStreak = 0;
        prevRowSignature = signature;

        const inserted = await storeRecords(records, config);
        totalInserted += inserted;

        if (records.length > 0) consecutiveEmpty = 0;
        else consecutiveEmpty++;

        console.log(`Page ${pageNum}/${endIdx0Inclusive + 1} — extracted ${records.length}, inserted ${inserted} (total: ${totalInserted})`);

        if (records.length === 0) {
            const debugDir = path.resolve(__dirname, '../debug/freedmens-bank');
            if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
            const bodyHtml = await page.evaluate(() => document.body.innerHTML).catch(() => '');
            fs.writeFileSync(path.join(debugDir, `page-${pageNum}-empty.html`), bodyHtml);
            console.warn(`  → Debug dump saved to debug/freedmens-bank/page-${pageNum}-empty.html`);
        }
    }

    console.log(`\n✅ Done. Total inserted: ${totalInserted}`);
    // puppeteer.connect() keeps an open websocket to Chrome which prevents the
    // node event loop from draining. Disconnect explicitly so the process exits.
    try { await browser.disconnect(); } catch (_) {}
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal:', err.message);
        process.exit(1);
    });
