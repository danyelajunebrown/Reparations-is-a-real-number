// Thorough TEI XML re-ingest of civilwardc petitions.
//
// The first TEI pass (scripts/ingest-civilwardc-tei-bulk.mjs) only extracted
// persNames that (a) lived in <table> rows or (b) were preceded by
// "of the name of" in narrative prose. That missed 459 of 1,041 petitions
// entirely and ~50% of enslaved persons in the remaining 582.
//
// Per recon on Apr 21: petitions contain 8-23 distinct persNames each in
// the TEI — we were leaving the majority on the table. This pass:
//
//   1. Extracts every <persName> from the petition body
//   2. Classifies each by contextual pattern:
//        - claimant: matches title-derived name(s) (+ honorific fuzz)
//        - enslaved: in a <table><row>; OR in a <list><item>; OR in a
//          paragraph containing enslaved cues (of the name of, namely,
//          viz., following persons, to wit, negro named, servant named);
//          OR bequeathed/inherited context
//        - prior_enslaver: follows "late father" / "inherited from" /
//          "bequeathed by" / "gift of" / "purchased from"
//        - witness: in <closer>/<signed> near "witness" cue
//        - notary: near "Notary Public" / "J.P." / "Justice of the Peace"
//        - spouse / relative: near "wife of" / "husband of" / "son of" /
//          "daughter of"
//        - other: couldn't classify — leave as-is
//   3. For each enslaved person:
//        - If a canonical_persons row already exists (case-insensitive
//          exact name match), link to it
//        - Otherwise create a new canonical_persons row with
//          person_type='enslaved', notes citing the petition + claimant
//        - Create family_relationships enslaved_by edge
//   4. Updates historical_reparations_petitions.enslaved_persons_claimed
//      JSONB with the full list + structured age/sex/value when known
//   5. Records prior_enslaver candidates in enslaver_candidates_review_queue
//      (not auto-promoted; reviewer decides)
//
// Idempotent: uses UPSERT on docket_number + ON CONFLICT for edges +
// canonical_persons.name-state dedup before insert.
//
// Usage:
//   node scripts/ingest-civilwardc-tei-thorough.mjs                      # dry-run
//   node scripts/ingest-civilwardc-tei-thorough.mjs --apply              # live
//   node scripts/ingest-civilwardc-tei-thorough.mjs --apply --pids=cww.00002,cww.00018

import 'dotenv/config';
import pg from 'pg';
import * as cheerio from 'cheerio';

const APPLY = process.argv.includes('--apply');
const pidsArg = process.argv.find(a => a.startsWith('--pids='));
const EXPLICIT = pidsArg ? pidsArg.split('=')[1].split(',') : null;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Header keywords for <table> row-classification
const TABLE_HEADER_KEYWORDS = new Set([
    'no', 'no.', 'name', 'sex', 'age', 'color', 'complexion', 'value', 'description',
    'height', 'occupation', 'particular description', 'remarks', 'mark', 'worth',
]);

// Parse "$500:–", "1,000", "one thousand" → number
function parseValue(raw) {
    if (!raw) return null;
    const s = String(raw).replace(/[^\d,.-]/g, '').replace(/^0,/, '').replace(/,/g, '');
    const n = parseFloat(s);
    if (!isNaN(n) && n > 0 && n < 100000) return n;
    const w = String(raw).toLowerCase();
    const spelled = {
        'one hundred': 100, 'two hundred': 200, 'three hundred': 300, 'four hundred': 400, 'five hundred': 500,
        'six hundred': 600, 'seven hundred': 700, 'eight hundred': 800, 'nine hundred': 900,
        'one thousand': 1000, 'two thousand': 2000, 'three thousand': 3000,
    };
    for (const [k, v] of Object.entries(spelled)) if (w.includes(k)) return v;
    return null;
}

function normalizeName(n) {
    return String(n || '').replace(/\s+/g, ' ').trim();
}

// Title → claimants (unchanged from prior parser)
function claimantsFromTitle(title) {
    const stripped = title.replace(/^Petition of\s+/i, '');
    const beforeDate = stripped.replace(/,?\s*\d{1,2}\s+[A-Z][a-z]+\s+\d{4}\s*$/i, '').trim();
    const core = beforeDate.replace(/,\s*(for|on behalf of)\s+.+?(?=\s*$)/i, '').trim();
    const names = [];
    for (const raw of core.split(/\s*,\s*and\s+|\s+and\s+|\s*,\s*/)) {
        const n = raw.replace(/\s*\([^)]*\)\s*/g, '').trim();
        if (n && n.length <= 80 && !/deceased/i.test(raw)) names.push(n);
    }
    return names;
}

// persName classification in a single pass over the TEI
function classifyPersons(xml, pid) {
    const $ = cheerio.load(xml, { xmlMode: true });

    // Title + claimants (authoritative)
    const title = $('titleStmt title[type="main"]').first().text().replace(/\s+/g, ' ').trim();
    const claimants = claimantsFromTitle(title);
    const claimantNorms = new Set(claimants.map(c => c.toLowerCase().replace(/[.,]/g, '').trim()));

    // Filed date — use earliest non-1862-04-16 body date (that one is the Act date)
    const bodyDates = $('body date[when]').toArray()
        .map(el => $(el).attr('when'))
        .filter(d => /^1[78]\d{2}/.test(d))
        .sort();
    const nonActDates = bodyDates.filter(d => d !== '1862-04-16');
    let filedDate = nonActDates[0] || bodyDates[0] || null;
    if (filedDate) {
        if (/^\d{4}$/.test(filedDate)) filedDate = `${filedDate}-01-01`;
        else if (/^\d{4}-\d{2}$/.test(filedDate)) filedDate = `${filedDate}-01`;
    }

    // Image refs
    const images = [];
    $('pb[facs]').each((_, el) => {
        const f = $(el).attr('facs');
        if (f && f.includes(pid) && /\.jpg$/i.test(f)) images.push(f);
    });

    // Classify every body persName
    const perNameRecord = new Map();  // normalized-name → { name, classes[], contexts[], fields }
    const addRecord = (rawName, category, context, fields = {}) => {
        const name = normalizeName(rawName);
        if (!name) return;
        const key = name.toLowerCase();
        if (!perNameRecord.has(key)) perNameRecord.set(key, { name, classes: new Set(), contexts: [], fields: {} });
        const rec = perNameRecord.get(key);
        rec.classes.add(category);
        if (rec.contexts.length < 3) rec.contexts.push(context);
        for (const [k, v] of Object.entries(fields)) if (v && !rec.fields[k]) rec.fields[k] = v;
    };

    // Strongest signal: table rows
    $('body table').each((_, t) => {
        const rows = $(t).find('row');
        if (!rows.length) return;
        const firstCells = rows.first().find('cell').toArray().map(c => $(c).text().toLowerCase().trim());
        const hasHeader = firstCells.some(c => TABLE_HEADER_KEYWORDS.has(c) || /^(no\.|name|sex|age|color|value|description)/.test(c));
        const headers = hasHeader ? firstCells : null;
        const dataRows = hasHeader ? rows.slice(1) : rows;

        dataRows.each((_, r) => {
            const cells = $(r).find('cell').toArray().map(c => $(c).text().replace(/\s+/g, ' ').trim());
            const pNames = $(r).find('persName').toArray().map(p => $(p).text().replace(/\s+/g, ' ').trim()).filter(Boolean);
            if (!pNames.length) return;
            const mainName = pNames[0];
            if (claimantNorms.has(mainName.toLowerCase().replace(/[.,]/g, '').trim())) return;  // skip claimant
            const fields = {};
            if (headers) {
                for (let i = 0; i < cells.length; i++) {
                    const h = headers[i] || '';
                    const v = cells[i];
                    if (/age/.test(h) && v) fields.age = v.replace(/[^\d ]/g, '').trim();
                    else if (/sex/.test(h) && v && v !== '"') fields.sex = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
                    else if (/color|complexion/.test(h) && v && v !== '"') fields.color = v;
                    else if (/value|worth/.test(h) && v) { const n = parseValue(v); if (n) fields.claimed_value_usd = n; }
                    else if (/description|remark|particular/.test(h) && v && v.length > 2) fields.description = v;
                }
            } else {
                // No header — look for a "$..." cell as value
                for (let i = cells.length - 1; i >= 1; i--) {
                    if (/\$|,\d{3}|\b\d{3,5}\b/.test(cells[i])) {
                        const n = parseValue(cells[i]);
                        if (n) { fields.claimed_value_usd = n; break; }
                    }
                }
            }
            addRecord(mainName, 'enslaved', `table_row pid=${pid}`, fields);
        });
    });

    // Paragraph-level inspection. Key insight: the TEI sometimes lists a
    // dozen enslaved persons in ONE paragraph after a single cue phrase
    // ("of the names of <A>, <B>, <C>, and <D>"). A per-persName check
    // only catches the first name in those lists. So we classify the
    // PARAGRAPH first, then apply that classification to all persNames
    // in it (except claimants / known witnesses / notaries).
    $('body p, body div1 > p, body div > p').each((_, p) => {
        const $p = $(p);
        const ptxt = $p.text();
        const plow = ptxt.toLowerCase();

        // Paragraph-level scoring for enslavement-claim context
        const isEnslavementParagraph =
            /person[s]?\s+of\s+african\s+descent|held\s+to\s+(the\s+)?service|claim\s+(to\s+)?(the\s+)?service\s+or\s+labor|slave[s]?\s+to\s+wit|of\s+the\s+names?\s+of|following\s+persons?|following\s+slaves|following\s+servants|namely\s+[A-Z]/i.test(ptxt)
            && !/petitioner\s+(hereby\s+)?declares|bears\s+true\s+and\s+faithful\s+allegiance|has\s+not\s+borne\s+arms/i.test(plow);

        const isOathParagraph = /duly\s+sworn|subscribed|notary\s+public|oath/i.test(plow);
        const isWitnessSection = $p.closest('closer, witness, signed').length > 0
            || /signed\s+by|witnesses?:/i.test(plow.slice(0, 100));

        $p.find('persName').each((_, el) => {
            const name = normalizeName($(el).text());
            if (!name) return;
            const normName = name.toLowerCase().replace(/[.,]/g, '').trim();
            if (claimantNorms.has(normName)) return;

            const idx = ptxt.indexOf(name);
            const before = idx > 0 ? ptxt.slice(Math.max(0, idx - 120), idx) : '';
            const after = idx >= 0 ? ptxt.slice(idx + name.length, idx + name.length + 80) : '';
            const ctx = (before + ' [[' + name + ']] ' + after).replace(/\s+/g, ' ').trim();

            // 1. Prior enslaver — strong signal preceding the name
            if (/late\s+(father|husband|uncle|mother|brother|grandfather|wife)|inherited\s+from|bequeathed\s+(by|to\s+me\s+by|under\s+the\s+will\s+of)|purchased\s+(from|of)|gift\s+of|descended\s+from|came\s+to\s+me\s+(from|by)|her\s+late\s+father|his\s+late\s+father/i.test(before)) {
                addRecord(name, 'prior_enslaver', ctx);
                return;
            }
            // 2. Notary — if paragraph is an oath + persName is adjacent to "notary"
            if (isOathParagraph && /notary|j\.p\.|justice\s+of\s+the\s+peace/i.test(ptxt.slice(Math.max(0, idx - 40), idx + name.length + 40))) {
                addRecord(name, 'notary', ctx);
                return;
            }
            // 3. Witness paragraph
            if (isWitnessSection || /witness|subscribed\s+before|sworn\s+before/i.test(before)) {
                addRecord(name, 'witness', ctx);
                return;
            }
            // 4. Spouse / relative of already-named person
            if (/(wife|husband|son|daughter|mother|father|child(ren)?)\s+of\s*$|married\s+to\s*$/i.test(before)) {
                addRecord(name, 'relative', ctx);
                return;
            }
            // 5. ENSLAVEMENT paragraph: any persName in it that isn't a
            //    claimant, witness, notary, or prior_enslaver is treated
            //    as enslaved. This catches multi-name enumerations where
            //    only the first name is preceded by the cue phrase.
            if (isEnslavementParagraph) {
                addRecord(name, 'enslaved', ctx);
                return;
            }
            // 6. Default
            addRecord(name, 'other', ctx);
        });
    });

    // <closer> persons are witnesses / signers
    $('body closer persName').each((_, el) => {
        const name = normalizeName($(el).text());
        if (!name || claimantNorms.has(name.toLowerCase().replace(/[.,]/g, '').trim())) return;
        addRecord(name, 'witness', `closer pid=${pid}`);
    });

    return { title, claimants, filedDate, filedYear: filedDate ? parseInt(filedDate.slice(0, 4)) : null, images, persons: perNameRecord };
}

async function resolveCanonical(name, personType = null) {
    const r = await pool.query(
        `SELECT id FROM canonical_persons
         WHERE LOWER(canonical_name) = LOWER($1)
           ${personType ? `AND person_type = '${personType}'` : ''}
         ORDER BY (person_type = 'merged')::int, id LIMIT 1`,
        [name]);
    return r.rows[0]?.id ?? null;
}

async function ensureEnslavedCanonical(name, petition) {
    if (!name || name.length < 2) return null;
    let cpId = await resolveCanonical(name);
    if (cpId) return cpId;
    if (!APPLY) return -1;  // pretend in dry-run
    // Create — person_type='enslaved', notes pointer to this petition
    const r = await pool.query(`
        INSERT INTO canonical_persons (canonical_name, person_type, primary_state, notes)
        VALUES ($1, 'enslaved', 'District of Columbia', $2)
        RETURNING id
    `, [name, `Named as enslaved in DC 1862 compensated-emancipation petition ${petition.pid}; claimed by ${petition.claimants.join(', ')}. Source: ${petition.url}`]);
    return r.rows[0].id;
}

async function ingestOne(pid) {
    const url = `https://civilwardc.org/texts/petitions/${pid}.xml`;
    const htmlUrl = url.replace('.xml', '.html');
    const xml = await (await fetch(url)).text();
    const parsed = classifyPersons(xml, pid);
    parsed.pid = pid;
    parsed.url = htmlUrl;

    // Bucket persons
    const enslaved = [];
    const witnesses = [];
    const notaries = [];
    const priorEnslavers = [];
    const unclassified = [];
    for (const rec of parsed.persons.values()) {
        if (rec.classes.has('enslaved')) enslaved.push(rec);
        else if (rec.classes.has('prior_enslaver')) priorEnslavers.push(rec);
        else if (rec.classes.has('notary')) notaries.push(rec);
        else if (rec.classes.has('witness')) witnesses.push(rec);
        else unclassified.push(rec);
    }

    if (!APPLY) {
        return {
            pid,
            title: parsed.title,
            claimants: parsed.claimants.length,
            enslaved: enslaved.length,
            witnesses: witnesses.length,
            notaries: notaries.length,
            priorEnslavers: priorEnslavers.length,
            unclassified: unclassified.length,
        };
    }

    if (!parsed.claimants.length || !parsed.filedDate || !parsed.images.length) {
        return { pid, skipped: 'missing claimant/date/images' };
    }

    // Build enslaved_persons_claimed JSONB with ALL enslaved persons
    const enslavedJson = enslaved.map(e => ({
        name: e.name,
        ...e.fields,
    }));
    const totalClaimed = enslavedJson.reduce((s, e) => s + (e.claimed_value_usd || 0), 0) || null;

    // Upsert petition
    const primaryClaimant = parsed.claimants[0];
    const claimantCpId = await resolveCanonical(primaryClaimant, 'enslaver');
    await pool.query(`
        INSERT INTO historical_reparations_petitions (
            petition_type, jurisdiction, filed_date, filed_year, docket_number,
            petition_status, claimant_name, claimant_canonical_id,
            enslaved_persons_claimed, total_claimed_usd,
            source_document_url, source_archive, source_citation, source_notes,
            confidence, verification_status
        ) VALUES (
            'dc_compensated_emancipation_1862', 'District of Columbia',
            $1, $2, $3, 'filed', $4, $5, $6::jsonb, $7,
            $8, 'National Archives RG 217.6.5 (TEI XML)', $9,
            $10, 0.97, 'tei_thorough'
        )
        ON CONFLICT (docket_number) DO UPDATE SET
            filed_date = EXCLUDED.filed_date,
            enslaved_persons_claimed = EXCLUDED.enslaved_persons_claimed,
            total_claimed_usd = EXCLUDED.total_claimed_usd,
            verification_status = EXCLUDED.verification_status,
            source_notes = EXCLUDED.source_notes,
            updated_at = NOW()
    `, [
        parsed.filedDate, parsed.filedYear, pid, primaryClaimant, claimantCpId,
        JSON.stringify(enslavedJson), totalClaimed,
        htmlUrl,
        'NARA RG 217.6.5 Microcopy 520 Reel 4; ARC 4644616; transcribed by civilwardc.org',
        `Thorough TEI re-ingest. Classified persons: ${enslaved.length} enslaved, ${witnesses.length} witnesses, ${notaries.length} notaries, ${priorEnslavers.length} prior_enslavers, ${unclassified.length} unclassified.`,
    ]);

    // For each enslaved person: ensure canonical + enslaved_by edge
    let cpNew = 0, edgesAdded = 0;
    for (const enslavedRec of enslaved) {
        let enslavedCpId = await resolveCanonical(enslavedRec.name);
        if (!enslavedCpId) {
            const r = await pool.query(`
                INSERT INTO canonical_persons (canonical_name, person_type, primary_state, notes)
                VALUES ($1, 'enslaved', 'District of Columbia', $2)
                RETURNING id
            `, [enslavedRec.name, `Named as enslaved in DC 1862 petition ${pid}; claimed by ${parsed.claimants.join(', ')}. ${enslavedRec.fields.age ? 'Age ' + enslavedRec.fields.age + '. ' : ''}${enslavedRec.fields.sex ? enslavedRec.fields.sex + '. ' : ''}${enslavedRec.fields.description ? 'Description: ' + enslavedRec.fields.description + '. ' : ''}Source: ${htmlUrl}`]);
            enslavedCpId = r.rows[0].id;
            cpNew++;
        }

        // Edge for each claimant → this enslaved person
        for (const claimant of parsed.claimants) {
            const existing = await pool.query(`
                SELECT id FROM family_relationships
                WHERE LOWER(person1_name) = LOWER($1)
                  AND LOWER(person2_name) = LOWER($2)
                  AND relationship_type = 'enslaved_by'
                  AND source_url = $3
                LIMIT 1
            `, [claimant, enslavedRec.name, htmlUrl]);
            if (existing.rowCount) continue;
            await pool.query(`
                INSERT INTO family_relationships (
                    person1_name, person1_role, person2_name, person2_role,
                    relationship_type, source_url, matched_text, confidence
                ) VALUES (
                    $1, 'slaveholder', $2, 'enslaved',
                    'enslaved_by', $3, $4, 0.97
                )
            `, [claimant, enslavedRec.name, htmlUrl,
                `DC 1862 TEI-thorough: ${claimant} named ${enslavedRec.name}`
                + (enslavedRec.fields.claimed_value_usd ? ` ($${enslavedRec.fields.claimed_value_usd})` : '')
                + (enslavedRec.fields.age ? `, age ${enslavedRec.fields.age}` : '')
                + (enslavedRec.fields.sex ? `, ${enslavedRec.fields.sex}` : '')
            ]);
            edgesAdded++;
        }
    }

    // Prior enslavers → candidates queue (NOT auto-promoted, reviewer decides)
    let queued = 0;
    for (const p of priorEnslavers) {
        const existingCp = await resolveCanonical(p.name, 'enslaver');
        if (existingCp) continue;  // already known
        // Queue for review
        const existing = await pool.query(
            `SELECT candidate_id FROM enslaver_candidates_review_queue WHERE LOWER(proposed_name)=LOWER($1) AND review_status='pending' LIMIT 1`, [p.name]);
        if (existing.rowCount) continue;
        await pool.query(`
            INSERT INTO enslaver_candidates_review_queue (
                proposed_name, proposed_role, proposed_primary_state,
                corroborating_depositor_count, source_ledger_arks,
                depositor_names, reviewer_notes
            ) VALUES ($1, 'prior_enslaver', 'District of Columbia', 1, $2, $3, $4)
        `, [
            p.name,
            [htmlUrl],
            parsed.claimants,
            `TEI-thorough extraction: ${p.name} mentioned as prior enslaver (late father / inherited from / etc.) in petition ${pid}. Context: "${(p.contexts[0] || '').slice(0, 150)}"`,
        ]);
        queued++;
    }

    return {
        pid, enslaved: enslaved.length, cpNew, edgesAdded,
        priorEnslaversQueued: queued,
        witnesses: witnesses.length, notaries: notaries.length,
        unclassified: unclassified.length,
    };
}

async function main() {
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

    let pids;
    if (EXPLICIT) pids = EXPLICIT;
    else {
        const r = await pool.query(`SELECT docket_number FROM historical_reparations_petitions ORDER BY docket_number`);
        pids = r.rows.map(r => r.docket_number);
    }
    console.log(`Petitions to process: ${pids.length}\n`);

    const stats = { processed: 0, enslaved: 0, cpNew: 0, edgesAdded: 0, queued: 0, errors: 0, skipped: 0 };
    for (let i = 0; i < pids.length; i++) {
        const pid = pids[i];
        try {
            const r = await ingestOne(pid);
            stats.processed++;
            if (r.skipped) { stats.skipped++; continue; }
            stats.enslaved += r.enslaved || 0;
            stats.cpNew += r.cpNew || 0;
            stats.edgesAdded += r.edgesAdded || 0;
            stats.queued += r.priorEnslaversQueued || 0;
            const show = !APPLY || i % 50 === 0 || (r.cpNew && r.cpNew > 5) || (r.enslaved && r.enslaved >= 10) || (r.priorEnslaversQueued > 0);
            if (show) {
                if (APPLY) console.log(`  [${i + 1}/${pids.length}] ${pid}: ensl=${r.enslaved} cp_new=${r.cpNew || 0} edges=+${r.edgesAdded || 0} priors_queued=${r.priorEnslaversQueued || 0}`);
                else console.log(`  [${i + 1}/${pids.length}] ${pid}: ensl=${r.enslaved} witnesses=${r.witnesses || 0} notaries=${r.notaries || 0} priors=${r.priorEnslavers || 0} unclass=${r.unclassified || 0}`);
            }
        } catch (e) {
            stats.errors++;
            console.log(`  [${i + 1}/${pids.length}] ${pid}: ERROR — ${e.message.split('\n')[0]}`);
        }
        await sleep(500);
    }

    console.log('\n━━━ Summary ━━━');
    console.log(`Processed:                 ${stats.processed}`);
    console.log(`Skipped (malformed):       ${stats.skipped}`);
    console.log(`Errored:                   ${stats.errors}`);
    console.log(`Enslaved persons indexed:  ${stats.enslaved}`);
    console.log(`NEW canonical_persons:     ${stats.cpNew}`);
    console.log(`family_relationships +:    ${stats.edgesAdded}`);
    console.log(`Prior-enslaver candidates queued: ${stats.queued}`);

    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
