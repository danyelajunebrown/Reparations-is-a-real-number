// Bulk ingest of ~1,041 civilwardc.org DC 1862 petitions end-to-end.
//
// For each distinct petition ID (cww.NNNNN) already appearing in
// unconfirmed_persons.source_url:
//
//   1. Fetch the HTML, parse title/date/claimants/image URLs with cheerio.
//   2. Download each 1200px JPG to S3 under civilwardc/petitions/{pid}/.
//   3. Upsert a row into historical_reparations_petitions with:
//        petition_type = dc_compensated_emancipation_1862
//        filed_date / docket_number / claimant_name / source_document_url
//        enslaved_persons_claimed JSONB = names gathered from the
//           unconfirmed_persons rows scraped against this source_url
//           with person_type='enslaved' (rejected rows excluded).
//   4. Resolve each 'enslaver' role on that same source_url to a
//      canonical_persons row (exact name match, then fuzzy). Create a
//      person_documents row per claimant × per page image pointing at
//      the S3-archived primary source.
//
// Scalable seed — does NOT re-extract enslaved-person valuations from
// the free-text prose. Downstream: a dedicated prose parser can upgrade
// enslaved_persons_claimed JSONB with age/sex/$value fields.
//
// Rate limits: 800ms between petition fetches, 400ms between S3 uploads.
// At that pace, 1,041 petitions run in ~30 min. Idempotent via docket_number
// UNIQUE check — re-runs skip already-ingested petitions.
//
// Usage:
//   node scripts/ingest-civilwardc-petitions-bulk.mjs                  # dry-run
//   node scripts/ingest-civilwardc-petitions-bulk.mjs --apply          # live
//   node scripts/ingest-civilwardc-petitions-bulk.mjs --apply --limit 20
//   node scripts/ingest-civilwardc-petitions-bulk.mjs --apply --skip cww.00431,cww.00429

import 'dotenv/config';
import pg from 'pg';
import * as cheerio from 'cheerio';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S3Service = require('../src/services/storage/S3Service');

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;
const skipArg = process.argv.find(a => a.startsWith('--skip='));
const SKIP = new Set((skipArg ? skipArg.split('=')[1].split(',') : []));

const CITATION = 'National Archives and Records Administration, Microcopy 520, Reel 4; '
    + 'Record Group 217.6.5; ARC Identifier 4644616. '
    + 'Transcribed and hosted by civilwardc.org.';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
if (APPLY && !S3Service.isEnabled()) {
    console.error('S3 not enabled');
    process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parsePetitionHtml(html, pid) {
    const $ = cheerio.load(html);

    // Title (claimant extraction)
    const titleEl = $('p[data-pagefind-meta="title"]').first();
    const titleText = titleEl.text().replace(/^Title:\s*/, '').trim();
    const dateText = $('strong:contains("Date:")').first().parent().text()
        .replace(/^Date:\s*/, '').trim();

    // Claimant: parse "Petition of {Name}, {Date}" or "Petition of {Name} for..."
    // Many petitions use different headline shapes; fall back to persName near
    // "Your Petitioner,".
    let claimantName = null;
    const titleMatch = titleText.match(/^Petition of ([^,]+?)(?:,|\s+for\s+|\s+on\s+|$)/i);
    if (titleMatch) claimantName = titleMatch[1].trim();

    if (!claimantName) {
        // Fallback: first persName inside a handwritten segment inside the
        // petition body.
        const bodyPersName = $('.petition .handwritten .persName').first().text().trim();
        if (bodyPersName) claimantName = bodyPersName;
    }

    // Co-claimants via "Petitioners" plural or " and " in title
    const coClaimants = [];
    if (claimantName && /\s+and\s+/i.test(titleText)) {
        const andMatch = titleText.match(/^Petition of (.+?),?\s+\d{1,2}\s+[A-Z][a-z]+\s+\d{4}$/i);
        if (andMatch) {
            const allNames = andMatch[1].split(/\s+and\s+|,\s+/).map(s => s.trim()).filter(Boolean);
            if (allNames.length > 1) {
                claimantName = allNames[0];
                coClaimants.push(...allNames.slice(1));
            }
        }
    }

    // Filing date: tolerate multiple formats that appear in civilwardc HTML:
    //   "May 26, 1862"   — canonical
    //   "May 6,1862"     — no space after comma (cww.00049)
    //   "1862-05-8"      — ISO-like with 1-digit day (cww.00100, 00264)
    //   missing entirely — fall back to title "Petition of X, DD Month YYYY"
    let filedDate = null, filedYear = null;
    const MONTHS = { January:1, February:2, March:3, April:4, May:5, June:6, July:7, August:8, September:9, October:10, November:11, December:12 };
    // Allow optional space after comma:  \s*  (was \s+)
    const dm = dateText.match(/([A-Z][a-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
    if (dm && MONTHS[dm[1]]) {
        filedYear = +dm[3];
        filedDate = `${dm[3]}-${String(MONTHS[dm[1]]).padStart(2, '0')}-${String(+dm[2]).padStart(2, '0')}`;
    } else {
        // ISO-like "1862-05-8" / "1862-5-8"
        const iso = dateText.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (iso) {
            filedYear = +iso[1];
            filedDate = `${iso[1]}-${String(+iso[2]).padStart(2, '0')}-${String(+iso[3]).padStart(2, '0')}`;
        } else if (titleText) {
            // Title fallback: "Petition of NAME, DD Month YYYY"
            const tm = titleText.match(/(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})/);
            if (tm && MONTHS[tm[2]]) {
                filedYear = +tm[3];
                filedDate = `${tm[3]}-${String(MONTHS[tm[2]]).padStart(2, '0')}-${String(+tm[1]).padStart(2, '0')}`;
            }
        }
    }

    // Image URLs: all 1200px JPGs referenced on the page
    const imageUrls = new Set();
    $('a[href*="/files/figures/petitions/1200px/"]').each((_, el) => {
        const href = $(el).attr('href');
        // Resolve relative URL
        const absolute = href.startsWith('http')
            ? href
            : `https://civilwardc.org/${href.replace(/^(\.\.\/)+/, '')}`;
        // Keep only images that (a) match this pid and (b) actually end in
        // .jpg — the site has a few broken hrefs where the extension is
        // missing (e.g. cww.00278.004), which 404 on fetch.
        if (absolute.includes(`/${pid}.`) && /\.jpg$/i.test(absolute)) imageUrls.add(absolute);
    });

    // All persName entries (candidate set for downstream enslaved-person NLP)
    const persNames = new Set();
    $('.persName').each((_, el) => {
        const t = $(el).text().trim().replace(/\s+/g, ' ');
        if (t) persNames.add(t);
    });

    return {
        pid,
        title: titleText,
        claimantName,
        coClaimants,
        filedDate,
        filedYear,
        dateText,
        imageUrls: [...imageUrls].sort(),
        allPersNames: [...persNames],
    };
}

async function downloadAndArchive(imageUrl, pid) {
    const fileName = imageUrl.split('/').pop();
    const key = `civilwardc/petitions/${pid}/${fileName}`;
    if (!APPLY) return { key, skipped: true };
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error(`fetch ${imageUrl}: ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const res = await S3Service.upload(
        key, buf, 'image/jpeg',
        { 'source-url': imageUrl, 'petition-id': pid }
    );
    await sleep(200);
    return res;
}

async function resolveEnslaver(name) {
    const exact = await pool.query(
        `SELECT id FROM canonical_persons
         WHERE LOWER(canonical_name) = LOWER($1) AND person_type = 'enslaver'
         ORDER BY id LIMIT 1`, [name]);
    return exact.rows[0]?.id ?? null;
}

async function gatherEnslavedClaimed(pid) {
    // Pull enslaved-person entries from the old scrape pass, skipping
    // rejected (our cleanup + any already-rejected rows).
    const r = await pool.query(
        `SELECT DISTINCT full_name
         FROM unconfirmed_persons
         WHERE source_url ILIKE $1
           AND person_type = 'enslaved'
           AND status != 'rejected'
           AND full_name !~ '^[0-9]+[ .]+'
         ORDER BY full_name`,
        [`%${pid}%`]
    );
    return r.rows.map(row => ({ name: row.full_name }));
}

async function ingestPetition(pid) {
    const exists = await pool.query(
        `SELECT petition_id FROM historical_reparations_petitions WHERE docket_number = $1`,
        [pid]);
    if (exists.rowCount) return { pid, skipped_exists: true };

    const url = `https://civilwardc.org/texts/petitions/${pid}.html`;
    const htmlResp = await fetch(url);
    if (!htmlResp.ok) throw new Error(`fetch ${url}: ${htmlResp.status}`);
    const html = await htmlResp.text();
    const parsed = parsePetitionHtml(html, pid);

    if (!parsed.claimantName || !parsed.filedDate || !parsed.imageUrls.length) {
        return { pid, skipped_malformed: true, reason: !parsed.claimantName ? 'no-claimant' : !parsed.filedDate ? 'no-date' : 'no-images' };
    }

    const enslavedClaimed = await gatherEnslavedClaimed(pid);

    // Archive images
    const s3Keys = [];
    for (const imgUrl of parsed.imageUrls) {
        const { key } = await downloadAndArchive(imgUrl, pid);
        s3Keys.push(key);
    }

    const claimantCanonicalId = await resolveEnslaver(parsed.claimantName);
    const allClaimants = [parsed.claimantName, ...parsed.coClaimants];

    if (!APPLY) {
        return {
            pid, dryRun: true,
            claimantName: parsed.claimantName,
            coClaimants: parsed.coClaimants,
            filedDate: parsed.filedDate,
            imageCount: parsed.imageUrls.length,
            enslavedCount: enslavedClaimed.length,
            s3KeysWouldBe: s3Keys,
            claimantResolved: claimantCanonicalId,
        };
    }

    // Insert petition row
    const petRow = await pool.query(
        `INSERT INTO historical_reparations_petitions (
            petition_type, jurisdiction, filed_date, filed_year, docket_number,
            petition_status, claimant_name, claimant_canonical_id,
            enslaved_persons_claimed, source_document_url, source_archive,
            source_citation, source_notes, confidence, verification_status
        ) VALUES (
            'dc_compensated_emancipation_1862', 'District of Columbia',
            $1, $2, $3, 'filed', $4, $5, $6::jsonb, $7,
            'National Archives RG 217.6.5 (via civilwardc.org)', $8, $9,
            0.90, 'ingested'
        ) RETURNING petition_id`,
        [
            parsed.filedDate, parsed.filedYear, pid, parsed.claimantName,
            claimantCanonicalId, JSON.stringify(enslavedClaimed), url, CITATION,
            `Claimants (${allClaimants.length}): ${allClaimants.join('; ')}. ` +
            `S3 archive: ${s3Keys.join(', ')}. ` +
            `Enslaved persons (from prior scrape): ${enslavedClaimed.length}.`,
        ]
    );

    // person_documents rows for each claimant we can resolve × each page
    let docsInserted = 0;
    for (const claimant of allClaimants) {
        const cpId = await resolveEnslaver(claimant);
        if (!cpId) continue;
        for (let i = 0; i < s3Keys.length; i++) {
            await pool.query(
                `INSERT INTO person_documents (
                    canonical_person_id, person_type, document_type,
                    document_date, document_year, name_as_appears,
                    s3_key, s3_url, source_url, source_type,
                    collection_name, image_number, page_reference,
                    extraction_confidence, human_verified
                ) VALUES (
                    $1, 'enslaver', 'compensated_emancipation_petition',
                    $2, $3, $4, $5, $6, $7, 'civilwardc_org',
                    'DC 1862 Compensated Emancipation Act petitions', $8, $9,
                    0.90, false
                )`,
                [
                    cpId, parsed.filedDate, parsed.filedYear, claimant,
                    s3Keys[i], S3Service.getPublicUrl(s3Keys[i]), url,
                    i + 1, `${pid} page ${i + 1} of ${s3Keys.length}`,
                ]
            );
            docsInserted++;
        }
    }

    return {
        pid, petitionRowId: petRow.rows[0].petition_id,
        s3Keys: s3Keys.length, docsInserted,
        claimantResolved: !!claimantCanonicalId, coClaimants: parsed.coClaimants.length,
    };
}

async function main() {
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | Limit: ${LIMIT === Infinity ? 'none' : LIMIT} | Skip: ${[...SKIP].join(',') || '(none)'}`);

    const ids = await pool.query(`
        SELECT DISTINCT substring(source_url FROM 'cww\\.[0-9]+') AS pid
        FROM unconfirmed_persons
        WHERE source_url LIKE '%civilwardc.org/texts/petitions/%'
        ORDER BY pid
    `);
    console.log(`Distinct petition IDs: ${ids.rowCount}`);

    const counters = { attempted: 0, ingested: 0, existed: 0, malformed: 0, errored: 0 };
    const errors = [];

    let i = 0;
    for (const { pid } of ids.rows) {
        if (SKIP.has(pid)) continue;
        if (counters.attempted >= LIMIT) break;
        i++;
        counters.attempted++;
        try {
            const r = await ingestPetition(pid);
            if (r.skipped_exists) {
                counters.existed++;
                if (i % 20 === 0) console.log(`  [${i}] ${pid}: already ingested`);
            } else if (r.skipped_malformed) {
                counters.malformed++;
                console.log(`  [${i}] ${pid}: malformed — ${r.reason}`);
            } else if (r.dryRun) {
                console.log(`  [${i}] ${pid}: "${r.claimantName}"${r.coClaimants.length ? ' + ' + r.coClaimants.length + ' co-claimant(s)' : ''} @ ${r.filedDate} (${r.imageCount} imgs, ${r.enslavedCount} enslaved, cp=${r.claimantResolved || '(new)'})`);
                counters.ingested++;
            } else {
                counters.ingested++;
                console.log(`  [${i}] ${pid}: ingested — petition_id=${r.petitionRowId} docs=${r.docsInserted} claimant_resolved=${r.claimantResolved}`);
            }
        } catch (e) {
            counters.errored++;
            errors.push({ pid, error: e.message });
            console.log(`  [${i}] ${pid}: ERROR — ${e.message}`);
        }
        await sleep(800);  // politeness gate
    }

    console.log('\n━━━ Summary ━━━');
    console.log(`  attempted: ${counters.attempted}`);
    console.log(`  ingested:  ${counters.ingested}`);
    console.log(`  existed:   ${counters.existed}`);
    console.log(`  malformed: ${counters.malformed}`);
    console.log(`  errored:   ${counters.errored}`);
    if (errors.length) {
        console.log('\nError list:');
        for (const e of errors.slice(0, 20)) console.log(`  ${e.pid}: ${e.error}`);
    }

    if (APPLY) {
        const total = await pool.query(`SELECT COUNT(*)::int c FROM historical_reparations_petitions`);
        console.log(`\nhistorical_reparations_petitions total rows: ${total.rows[0].c}`);
    }

    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
