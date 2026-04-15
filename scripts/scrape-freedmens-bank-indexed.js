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
const BRANCHES = {
    // Verified 2026-04-14: first page with structured data is image 8 (i=7).
    // Pages 1-7 are ledger cover/header blanks with an empty Image Index tab.
    'Charleston, South Carolina': { total: 421, url: 'https://www.familysearch.org/ark:/61903/3:1:S3HY-XCQD-6X?wc=3MDR-T3D%3A1551795003%2C1551795001%26cc%3D1417695&cc=1417695&lang=en&i=7' }
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
        // Source-text notes ("His brother Wm Morgan came with him", "Husband of
        // Sarah, both deceased") look name-like but are prose. Reject strings
        // that are too long, too wordy, or contain sentence-y words.
        const NOTE_WORD_RE = /\b(with|came|was|were|his|her|their|both|from|wife|husband|brother|sister|son|daughter|dead|deceased|formerly|belonged|owned|free|slave|old|years|lived)\b/i;
        const looksLikeNote = (s) =>
            s.length > 40 ||
            s.split(/\s+/).length > 5 ||
            NOTE_WORD_RE.test(s);
        const isNameLike = (s) => {
            if (!s || s.length < 2) return false;
            if (NAME_REJECT_PATTERNS.some(rx => rx.test(s))) return false;
            return true;
        };
        const isPersonName = (s) => isNameLike(s) && !looksLikeNote(s);
        const cellText = (el) => (el && el.innerText || '').replace(/\s+/g, ' ').trim();

        const table = document.querySelector('table[role="table"]') || document.querySelector('table');
        if (!table) return [];

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

            // Scan every OTHER cell (td + th) in the row and classify by content.
            // Skip the name cell and the More/ATTACH button tds.
            const BUTTON_TEXT = new Set(['More', 'ATTACH', 'Attach']);
            for (const cell of row.children) {
                if (cell === nameCell) continue;
                const v = cellText(cell);
                if (!v) continue;
                if (BUTTON_TEXT.has(v)) continue;

                if (/^\d{3,6}$/.test(v)) {
                    if (!record.account_number) record.account_number = v;
                } else if (/,.*,.*United States/i.test(v) || /,.*,.*[A-Z][a-z]+$/.test(v)) {
                    if (!record.event_place) record.event_place = v;
                } else if (v === 'Male' || v === 'Female') {
                    // These are Father's Sex / Mother's Sex — not this person's gender.
                    // Skip rather than misattribute.
                    continue;
                } else if (isPersonName(v) && v !== full_name) {
                    // Some other person referenced in this row — capture as family_member
                    // without attempting rel classification (column positions are unreliable).
                    // isPersonName excludes source-text prose notes.
                    record.family_members.push({ rel: 'family_member', name: v });
                }
                // Anything else (source-text notes, "Dead", etc.) is ignored.
            }

            results.push(record);
        }

        return results;
    });
}

// ─── Store to Neon ────────────────────────────────────────────────────────────
async function storeRecords(records) {
    let inserted = 0;
    for (const r of records) {
        if (!r.full_name || r.full_name.length < 2) continue;

        const locationArr = [BRANCH];
        if (r.event_place) locationArr.push(r.event_place);

        // family_members is now [{rel, name}] from the column-header extractor.
        const rels = r.family_members.map(fm => ({ type: fm.rel || 'family_member', name: fm.name }));

        const context = [
            `Freedman's Bank depositor, ${BRANCH}`,
            r.account_number ? `account #${r.account_number}` : null
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

    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });

    console.log(`\n── SCRAPING ${BRANCH} (Start: ${START_PAGE}, Total: ${config.total}) ──\n`);
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

    // Explicit initial goto to START_PAGE so --start aligns regardless of the
    // tab's prior state. Subsequent iterations advance via "Next Image" click.
    const firstUrl = buildImageUrl(config.url, START_PAGE + 1);
    console.log(`  → Initial goto: image ${START_PAGE + 1}`);
    await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try { await page.waitForSelector('tr[data-testid]', { timeout: 15000 }); } catch (_) {}
    await new Promise(r => setTimeout(r, 2000));

    let consecutiveEmpty = 0;
    let totalInserted = 0;

    for (let i = START_PAGE; i < config.total; i++) {
        const pageNum = i + 1;
        // First iteration: we already landed here via the initial goto above,
        // so just extract. Subsequent iterations click Next Image.
        const isFirst = (i === START_PAGE);

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
        const inserted = await storeRecords(records);
        totalInserted += inserted;

        if (records.length > 0) consecutiveEmpty = 0;
        else consecutiveEmpty++;

        console.log(`Page ${pageNum}/${config.total} — extracted ${records.length}, inserted ${inserted} (total: ${totalInserted})`);

        if (records.length === 0) {
            const debugDir = path.resolve(__dirname, '../debug/freedmens-bank');
            if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
            const bodyHtml = await page.evaluate(() => document.body.innerHTML).catch(() => '');
            fs.writeFileSync(path.join(debugDir, `page-${pageNum}-empty.html`), bodyHtml);
            console.warn(`  → Debug dump saved to debug/freedmens-bank/page-${pageNum}-empty.html`);
        }
    }

    console.log(`\n✅ Done. Total inserted: ${totalInserted}`);
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
