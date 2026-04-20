// TEI XML ingest for civilwardc.org petitions.
//
// Replaces the HTML-based parser with TEI-structured extraction:
//   - Claimants from TITLE string ("Petition of X, Y, and Z, ...")
//   - Filed date from <date when="YYYY-MM-DD"> inside body
//   - Image refs from <pb facs="cww.NNNNN.00X.jpg"/>
//   - Enslaved persons:
//       Primary — <table> with persName+age+sex+color+value+description rows
//       Fallback — narrative paragraphs ("of the name of X, Y, Z") where
//                   extracted persName is NOT a claimant and occurs in a
//                   paragraph containing "of the name of" / "person of African
//                   descent" / similar narrative cues
//   - Valuations: per-row $value from table cell, parsed to numeric USD
//
// For each petition this script:
//   1. Upserts into historical_reparations_petitions ON CONFLICT(docket_number)
//      — overwriting enslaved_persons_claimed + filed_date + claimant + citation
//   2. Archives image JPGs to S3 if not already there
//   3. Creates person_documents rows for each (claimant × image) pair
//   4. Creates family_relationships enslaved_by edges for each named
//      enslaved person → claimant — so probate gate Tier C picks them up
//
// Idempotent via:
//   - UPSERT on historical_reparations_petitions.docket_number
//   - S3 keys as civilwardc/petitions/{pid}/{filename} (overwrite = no-op)
//   - person_documents: unique on (canonical_person_id, s3_key, document_type)
//   - family_relationships: unique on (LOWER(person1_name), LOWER(person2_name), relationship_type, source_url)
//
// Usage:
//   node scripts/ingest-civilwardc-tei-bulk.mjs                          # dry-run
//   node scripts/ingest-civilwardc-tei-bulk.mjs --apply                  # live
//   node scripts/ingest-civilwardc-tei-bulk.mjs --apply --only-missing   # only the 20 gap petitions
//   node scripts/ingest-civilwardc-tei-bulk.mjs --apply --pids=cww.00429,cww.00431

import 'dotenv/config';
import pg from 'pg';
import * as cheerio from 'cheerio';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S3Service = require('../src/services/storage/S3Service');

const APPLY = process.argv.includes('--apply');
const ONLY_MISSING = process.argv.includes('--only-missing');
const pidsArg = process.argv.find(a => a.startsWith('--pids='));
const EXPLICIT = pidsArg ? pidsArg.split('=')[1].split(',') : null;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
if (APPLY && !S3Service.isEnabled()) { console.error('S3 not enabled'); process.exit(1); }

const CITATION = 'National Archives and Records Administration, Microcopy 520, Reel 4; '
    + 'Record Group 217.6.5; ARC Identifier 4644616. '
    + 'Transcribed (TEI/XML) and hosted by civilwardc.org.';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Keywords that, when present in a table header row's cells, confirm the row
// is a header, not data. If none match, assume the row is data (some petition
// schedules elide the header or encode it inline).
const HEADER_KEYWORDS = ['no', 'no.', 'name', 'sex', 'age', 'color', 'complexion', 'value', 'description', 'height', 'occupation', 'particular', 'remarks'];

// Parse "$500:–", "$1,000", "150", "0,800", "five hundred dollars" → number USD
function parseValue(raw) {
    if (!raw) return null;
    const s = raw.replace(/[^\d,.-]/g, '').replace(/^0,/, '').replace(/,/g, '');
    const n = parseFloat(s);
    if (!isNaN(n) && n > 0 && n < 100000) return n;
    // Spelled-out values (rare)
    const words = raw.toLowerCase();
    const spelled = {
        'one hundred': 100, 'two hundred': 200, 'three hundred': 300, 'four hundred': 400, 'five hundred': 500,
        'six hundred': 600, 'seven hundred': 700, 'eight hundred': 800, 'nine hundred': 900,
        'one thousand': 1000, 'two thousand': 2000, 'three thousand': 3000,
    };
    for (const [k, v] of Object.entries(spelled)) if (words.includes(k)) return v;
    return null;
}

function parseTei(xml, pid) {
    const $ = cheerio.load(xml, { xmlMode: true });

    const title = $('titleStmt title[type="main"]').first().text().replace(/\s+/g, ' ').trim();

    // Claimants from title
    const claimants = [];
    const stripPref = title.replace(/^Petition of\s+/i, '');
    const beforeDate = stripPref.replace(/,?\s*\d{1,2}\s+[A-Z][a-z]+\s+\d{4}\s*$/i, '').trim();
    const core = beforeDate.replace(/,\s*(for|on behalf of)\s+.+?(?=\s*$)/i, '').trim();
    for (const raw of core.split(/\s*,\s*and\s+|\s+and\s+|\s*,\s*/)) {
        const c = raw.replace(/\s*\([^)]*\)\s*/g, '').trim();
        if (c && c.length <= 80 && !/deceased/i.test(raw)) claimants.push(c);
    }

    // Filed date: body <date when="YYYY-MM-DD"> preferred, fall back to any date in 17/18xx
    const bodyDate = $('body date[when]').first().attr('when');
    let filedDate = bodyDate || $('date[when]').filter((_, el) => /^1[78]\d{2}/.test($(el).attr('when') || '')).first().attr('when') || null;
    // Normalize "1862-04-16" (sometimes it's the act date). Prefer any later 1862 date.
    const laterDates = $('body date[when]').toArray()
        .map(el => $(el).attr('when'))
        .filter(d => /^1862/.test(d) && d !== '1862-04-16')
        .sort();
    if (laterDates.length) filedDate = laterDates[0];  // earliest NON-act date in body
    // Normalize partial dates to full ISO so Postgres DATE column accepts them.
    // Some TEI encoders used year-only ("1862") or year-month ("1862-05");
    // default to Jan 1 / day 1 of the known period.
    if (filedDate) {
        if (/^\d{4}$/.test(filedDate)) filedDate = `${filedDate}-01-01`;
        else if (/^\d{4}-\d{2}$/.test(filedDate)) filedDate = `${filedDate}-01`;
    }
    const filedYear = filedDate ? parseInt(filedDate.slice(0, 4)) : null;

    // Image refs
    const images = [];
    $('pb[facs]').each((_, el) => {
        const f = $(el).attr('facs');
        if (f && f.includes(pid) && /\.jpg$/i.test(f)) images.push(f);
    });

    // Enslaved persons extraction
    const enslavedByName = new Map();  // name → {name, age, sex, color, value, description, source}
    const isClaimant = name => claimants.some(c =>
        c.toLowerCase() === name.toLowerCase()
        || c.toLowerCase().replace(/[.,]/g, '').includes(name.toLowerCase().replace(/[.,]/g, ''))
        || name.toLowerCase().replace(/[.,]/g, '').includes(c.toLowerCase().replace(/[.,]/g, ''))
    );

    // PRIMARY: structured tables
    $('body table').each((_, t) => {
        const rows = $(t).find('row');
        if (!rows.length) return;
        // Detect header row: first row whose cells match keyword whitelist
        const firstCells = rows.first().find('cell').toArray().map(c => $(c).text().trim().toLowerCase());
        const looksLikeHeader = firstCells.some(c => HEADER_KEYWORDS.includes(c) || c.match(/^(no\.|name|sex|age|color|value|description)/));
        const headers = looksLikeHeader ? firstCells : null;
        const dataRows = looksLikeHeader ? rows.slice(1) : rows;

        dataRows.each((_, r) => {
            const cells = $(r).find('cell').toArray().map(c => $(c).text().replace(/\s+/g, ' ').trim());
            const personNames = $(r).find('persName').toArray().map(p => $(p).text().replace(/\s+/g, ' ').trim()).filter(Boolean);
            if (!personNames.length) return;
            const primaryName = personNames[0];
            if (isClaimant(primaryName)) return;

            // Map cells by header label if we have one
            const rec = { name: primaryName, source: 'table_row' };
            if (headers) {
                for (let i = 0; i < cells.length; i++) {
                    const h = headers[i] || '';
                    const v = cells[i] || '';
                    if (/age/.test(h) && v) rec.age = v.replace(/[^0-9a-z ]/gi, '').trim();
                    else if (/sex/.test(h) && v && v !== '"') rec.sex = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
                    else if (/color|complexion/.test(h) && v && v !== '"') rec.color = v;
                    else if (/value/.test(h) && v) { const n = parseValue(v); if (n) rec.claimed_value_usd = n; }
                    else if (/description|remark/.test(h) && v) rec.description = v;
                }
            } else {
                // Unstructured: infer by cell content pattern. Value cells
                // look like "$500" or "1,000" or "0,800" (leading zero
                // indicates hundreds place). Age cells are pure integers
                // 1-120. Column 0 (no.) is the row index — SKIP it.
                const isValueCell = c => /\$|,\d{3}\b|\b\d{3,5}\b/.test(c || '');
                const isAgeCell = c => /^\d{1,3}\.?$/.test((c || '').trim());
                // Find the LAST value-pattern cell (rightmost, since schedules
                // put valuation near the end)
                for (let ci = cells.length - 1; ci >= 1; ci--) {
                    if (isValueCell(cells[ci])) {
                        const n = parseValue(cells[ci]);
                        if (n) { rec.claimed_value_usd = n; break; }
                    }
                }
                // Age: first age-pattern integer cell AFTER the name cell (col 0 is usually row-no)
                for (let ci = 1; ci < cells.length; ci++) {
                    if (isAgeCell(cells[ci]) && !rec.claimed_value_usd ? true : cells[ci] !== String(rec.claimed_value_usd)) {
                        const v = parseInt(cells[ci]);
                        if (v > 0 && v < 120 && (!rec.claimed_value_usd || v !== rec.claimed_value_usd)) {
                            rec.age = cells[ci].replace(/\.$/, '').trim();
                            break;
                        }
                    }
                }
                // Description = longest textual cell
                const descCandidate = cells.filter(c => c && c.length > 15 && !/^\d+$|^[\d,. $\-]+$/.test(c))
                    .sort((a,b) => b.length - a.length)[0];
                if (descCandidate) rec.description = descCandidate;
            }
            enslavedByName.set(primaryName.toLowerCase(), rec);
        });
    });

    // FALLBACK: narrative extraction from paragraphs with enslaved-person cues
    if (enslavedByName.size === 0) {
        $('body p').each((_, p) => {
            const $p = $(p);
            const txt = $p.text();
            const hasCue = /of the name of|person of African|negro (man|woman|boy|girl|child)|following persons?|namely\b/i.test(txt);
            if (!hasCue) return;
            $p.find('persName').each((_, el) => {
                const name = $(el).text().replace(/\s+/g, ' ').trim();
                if (!name || isClaimant(name)) return;
                // Skip names that look like "Mr Wilson" etc (courtesy titles indicate enslavers often)
                // Check neighborhood: if preceding 30 chars have "of the name of" or "named" — strong yes
                const idx = txt.indexOf(name);
                if (idx < 0) return;
                const before = txt.slice(Math.max(0, idx - 80), idx);
                const cue = /of\s+the\s+name\s+of[\s,]*$|named\s*$|,\s*$|namely\s*$|viz[.:]?\s*$/i.test(before)
                    || /following persons?:?\s*[^.]*$/i.test(before);
                if (!cue) return;
                if (!enslavedByName.has(name.toLowerCase())) {
                    enslavedByName.set(name.toLowerCase(), { name, source: 'narrative' });
                }
            });
        });
    }

    // Total claimed = sum of available values
    const enslavedArray = [...enslavedByName.values()];
    const totalClaimed = enslavedArray.reduce((s, e) => s + (e.claimed_value_usd || 0), 0) || null;

    return {
        pid, title, claimants, filedDate, filedYear, images,
        enslavedPersons: enslavedArray,
        totalClaimed,
    };
}

async function resolveEnslaver(name) {
    if (!name) return null;
    const r = await pool.query(
        `SELECT id FROM canonical_persons
         WHERE LOWER(canonical_name) = LOWER($1) AND person_type = 'enslaver'
         ORDER BY id LIMIT 1`, [name]);
    return r.rows[0]?.id ?? null;
}

async function archiveImages(pid, imageFacs) {
    const s3Keys = [];
    for (const filename of imageFacs) {
        const key = `civilwardc/petitions/${pid}/${filename}`;
        const url = `https://civilwardc.org/files/figures/petitions/1200px/${filename}`;
        if (!APPLY) { s3Keys.push(key); continue; }
        // If already in S3, skip (idempotent)
        const check = await S3Service.objectExists(key).catch(() => ({ exists: false }));
        if (!check.exists) {
            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const buf = Buffer.from(await resp.arrayBuffer());
                await S3Service.upload(key, buf, 'image/jpeg', { 'petition-id': pid, 'source-url': url });
                await sleep(200);
            } catch (e) {
                console.log(`    ⚠ image archive failed ${filename}: ${e.message}`);
                continue;
            }
        }
        s3Keys.push(key);
    }
    return s3Keys;
}

async function ingestOne(pid) {
    const url = `https://civilwardc.org/texts/petitions/${pid}.xml`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch xml: ${resp.status}`);
    const xml = await resp.text();
    const parsed = parseTei(xml, pid);
    if (!parsed.claimants.length || !parsed.filedDate || !parsed.images.length) {
        return { pid, skipped: `missing ${!parsed.claimants.length ? 'claimants' : !parsed.filedDate ? 'date' : 'images'}` };
    }

    const s3Keys = await archiveImages(pid, parsed.images);

    // Resolve primary claimant → canonical
    const primaryClaimant = parsed.claimants[0];
    const claimantCpId = await resolveEnslaver(primaryClaimant);

    // Record totals (from individual values OR a stored total on record)
    const notes = `TEI-XML ingest. Claimants: ${parsed.claimants.join('; ')}. `
        + `Enslaved persons named: ${parsed.enslavedPersons.length}. S3: ${s3Keys.length} image(s).`;

    if (!APPLY) {
        return {
            pid, dry: true,
            claimants: parsed.claimants.length,
            date: parsed.filedDate,
            enslaved: parsed.enslavedPersons.length,
            valuedCount: parsed.enslavedPersons.filter(e => e.claimed_value_usd).length,
            totalClaimed: parsed.totalClaimed,
            cpResolved: claimantCpId,
            s3: s3Keys.length,
        };
    }

    // Upsert petition
    const upsert = await pool.query(`
        INSERT INTO historical_reparations_petitions (
            petition_type, jurisdiction, filed_date, filed_year, docket_number,
            petition_status, claimant_name, claimant_canonical_id,
            enslaved_persons_claimed, total_claimed_usd,
            source_document_url, source_archive, source_citation, source_notes,
            confidence, verification_status
        ) VALUES (
            'dc_compensated_emancipation_1862', 'District of Columbia',
            $1, $2, $3, 'filed', $4, $5, $6::jsonb, $7,
            $8, 'National Archives RG 217.6.5 (via civilwardc.org TEI)', $9, $10,
            0.95, 'tei_ingested'
        )
        ON CONFLICT (docket_number) DO UPDATE SET
            filed_date = EXCLUDED.filed_date,
            filed_year = EXCLUDED.filed_year,
            claimant_name = EXCLUDED.claimant_name,
            claimant_canonical_id = COALESCE(historical_reparations_petitions.claimant_canonical_id, EXCLUDED.claimant_canonical_id),
            enslaved_persons_claimed = EXCLUDED.enslaved_persons_claimed,
            total_claimed_usd = COALESCE(EXCLUDED.total_claimed_usd, historical_reparations_petitions.total_claimed_usd),
            source_citation = EXCLUDED.source_citation,
            source_notes = EXCLUDED.source_notes,
            verification_status = EXCLUDED.verification_status,
            updated_at = NOW()
        RETURNING petition_id
    `, [
        parsed.filedDate, parsed.filedYear, pid, primaryClaimant, claimantCpId,
        JSON.stringify(parsed.enslavedPersons),
        parsed.totalClaimed,
        url.replace('.xml', '.html'), CITATION, notes,
    ]);
    const petitionRowId = upsert.rows[0].petition_id;

    // Create / refresh person_documents for each claimant × image (idempotent via ON CONFLICT)
    let docsInserted = 0;
    for (const claimant of parsed.claimants) {
        const cpId = await resolveEnslaver(claimant);
        if (!cpId) continue;
        for (let i = 0; i < s3Keys.length; i++) {
            const key = s3Keys[i];
            const r = await pool.query(`
                INSERT INTO person_documents (
                    canonical_person_id, person_type, document_type,
                    document_date, document_year, name_as_appears,
                    s3_key, s3_url, source_url, source_type,
                    collection_name, image_number, page_reference,
                    extraction_confidence, human_verified
                ) VALUES (
                    $1, 'enslaver', 'compensated_emancipation_petition',
                    $2, $3, $4, $5, $6, $7, 'civilwardc_org',
                    'DC 1862 Compensated Emancipation Act petitions', $8, $9,
                    0.95, false
                )
                ON CONFLICT DO NOTHING
                RETURNING id
            `, [cpId, parsed.filedDate, parsed.filedYear, claimant, key,
                S3Service.getPublicUrl(key), url.replace('.xml','.html'), i + 1,
                `${pid} page ${i + 1} of ${s3Keys.length}`]);
            if (r.rowCount) docsInserted++;
        }
    }

    // Create family_relationships enslaved_by edges for each named enslaved
    // person → claimant. This is what makes Tier C evidence appear for
    // every named claimant's other DAA-flow descendants.
    let edgesInserted = 0;
    for (const enslaved of parsed.enslavedPersons) {
        for (const claimant of parsed.claimants) {
            const existing = await pool.query(`
                SELECT id FROM family_relationships
                WHERE LOWER(person1_name) = LOWER($1)
                  AND LOWER(person2_name) = LOWER($2)
                  AND relationship_type = 'enslaved_by'
                  AND source_url = $3
                LIMIT 1
            `, [claimant, enslaved.name, url.replace('.xml','.html')]);
            if (existing.rowCount) continue;
            await pool.query(`
                INSERT INTO family_relationships (
                    person1_name, person1_role, person2_name, person2_role,
                    relationship_type, source_url, matched_text, confidence
                ) VALUES (
                    $1, 'slaveholder', $2, 'enslaved',
                    'enslaved_by', $3, $4, 0.95
                )
            `, [
                claimant, enslaved.name, url.replace('.xml','.html'),
                `DC 1862 petition ${pid}: ${claimant} named ${enslaved.name} among ${parsed.enslavedPersons.length} enslaved persons`
                + (enslaved.claimed_value_usd ? ` (claimed value $${enslaved.claimed_value_usd})` : '')
                + (enslaved.age ? `, age ${enslaved.age}` : '')
                + (enslaved.sex ? `, ${enslaved.sex}` : '')
                + (enslaved.description ? ` — "${enslaved.description}"` : ''),
            ]);
            edgesInserted++;
        }
    }

    return { pid, petitionRowId, enslaved: parsed.enslavedPersons.length, docs: docsInserted, edges: edgesInserted, cpResolved: !!claimantCpId };
}

async function main() {
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | only-missing: ${ONLY_MISSING} | explicit: ${EXPLICIT?.join(',') || 'none'}`);

    let pids;
    if (EXPLICIT) pids = EXPLICIT;
    else if (ONLY_MISSING) {
        const want = await pool.query(`SELECT DISTINCT substring(source_url FROM 'cww\\.[0-9]+') pid FROM unconfirmed_persons WHERE source_url LIKE '%civilwardc%'`);
        const have = await pool.query(`SELECT docket_number FROM historical_reparations_petitions`);
        const haveSet = new Set(have.rows.map(r => r.docket_number));
        pids = want.rows.map(r => r.pid).filter(p => !haveSet.has(p));
    } else {
        const r = await pool.query(`SELECT DISTINCT substring(source_url FROM 'cww\\.[0-9]+') pid FROM unconfirmed_persons WHERE source_url LIKE '%civilwardc%' ORDER BY pid`);
        pids = r.rows.map(r => r.pid);
    }
    console.log(`Petitions to process: ${pids.length}`);

    const stats = { attempted: 0, applied: 0, skipped: 0, errored: 0,
                    totalEnslaved: 0, totalEdges: 0, totalDocs: 0 };
    const errors = [];

    for (let i = 0; i < pids.length; i++) {
        const pid = pids[i];
        stats.attempted++;
        try {
            const r = await ingestOne(pid);
            if (r.skipped) {
                stats.skipped++;
                console.log(`  [${i + 1}/${pids.length}] ${pid}: SKIPPED (${r.skipped})`);
            } else if (r.dry) {
                stats.totalEnslaved += r.enslaved;
                if (i % 50 === 0 || r.enslaved > 5) console.log(`  [${i + 1}/${pids.length}] ${pid}: ${r.enslaved} enslaved (${r.valuedCount} valued, $${r.totalClaimed ?? '?'} total), ${r.claimants} claimants, cp=${r.cpResolved}, ${r.s3} images`);
            } else {
                stats.applied++;
                stats.totalEnslaved += r.enslaved;
                stats.totalDocs += r.docs;
                stats.totalEdges += r.edges;
                if (i % 50 === 0 || r.enslaved > 10 || r.edges > 10) {
                    console.log(`  [${i + 1}/${pids.length}] ${pid}: ${r.enslaved} enslaved, +${r.edges} edges, +${r.docs} docs${r.cpResolved ? '' : ' (claimant unresolved)'}`);
                }
            }
        } catch (e) {
            stats.errored++;
            errors.push({ pid, error: e.message });
            console.log(`  [${i + 1}/${pids.length}] ${pid}: ERROR — ${e.message}`);
        }
        await sleep(600);
    }

    console.log('\n━━━ Summary ━━━');
    console.log(`Attempted:           ${stats.attempted}`);
    console.log(`Applied (or dry):    ${stats.applied}`);
    console.log(`Skipped (malformed): ${stats.skipped}`);
    console.log(`Errored:             ${stats.errored}`);
    console.log(`Enslaved persons indexed: ${stats.totalEnslaved}`);
    console.log(`family_relationships edges created: ${stats.totalEdges}`);
    console.log(`person_documents rows created: ${stats.totalDocs}`);
    if (errors.length) {
        console.log('\nErrors:');
        for (const e of errors.slice(0, 10)) console.log(`  ${e.pid}: ${e.error}`);
    }
    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
