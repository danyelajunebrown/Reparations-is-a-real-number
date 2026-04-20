// Dry-run TEI XML parser for civilwardc.org petitions.
//
// Goal: validate that TEI XML is richer than the current HTML-based ingest
// AND reliable enough to use as the primary extraction source for all 1,041
// petitions. Specifically we want to capture:
//
//   - Claimant(s) with confidence (which persName was the claimant vs
//     petitioner-adjacent people like notaries, witnesses, attorneys?)
//   - Every enslaved person named (from persName tags inside the enslaved-
//     description paragraphs — distinguishing them from other named people)
//   - Relationships mentioned: wife/husband/daughter/son, bequeathed-to,
//     inherited-from — because civilwardc narratives often reveal these
//   - Filing date in ISO format (from @when attributes)
//   - Document image references
//
// Importantly: civilwardc petitions are NOT standard templates. Some are
// single-enslaved claims, some are joint claims by multiple slaveholders,
// some are slaveholders claiming on behalf of loyal heirs, some reference
// prior wills. The TEI encoding reflects this variation.
//
// This script SAMPLES petitions across the corpus and reports what each
// one's TEI XML yielded. Reviewing the output before committing to a bulk
// rewrite is how we catch the edge cases.
//
// Usage:
//   node scripts/tei-civilwardc-dry-run.mjs
//   node scripts/tei-civilwardc-dry-run.mjs --sample=20
//   node scripts/tei-civilwardc-dry-run.mjs --pids=cww.00001,cww.00429,cww.00431

import 'dotenv/config';
import * as cheerio from 'cheerio';
import pg from 'pg';

const sampleArg = process.argv.find(a => a.startsWith('--sample='));
const SAMPLE = sampleArg ? parseInt(sampleArg.split('=')[1]) : 15;
const pidsArg = process.argv.find(a => a.startsWith('--pids='));
const EXPLICIT_PIDS = pidsArg ? pidsArg.split('=')[1].split(',') : null;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Pull a representative spread — first few, last few, some from middle,
// some known edge cases.
async function selectPids() {
    if (EXPLICIT_PIDS) return EXPLICIT_PIDS;
    const all = await pool.query(`
        SELECT DISTINCT substring(source_url FROM 'cww\\.[0-9]+') AS pid
        FROM unconfirmed_persons
        WHERE source_url LIKE '%civilwardc.org/texts/petitions/%'
        ORDER BY pid
    `);
    const pids = all.rows.map(r => r.pid);
    const seed = [
        // First three to sanity-check the common case
        pids[0], pids[1], pids[2],
        // Known edge cases we already hit
        'cww.00049', 'cww.00100', 'cww.00129', 'cww.00264', 'cww.00278', 'cww.00431', 'cww.00429',
        // Some from the middle + end of the range
        pids[Math.floor(pids.length * 0.5)], pids[Math.floor(pids.length * 0.75)], pids[pids.length - 3], pids[pids.length - 1],
    ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i); // de-dup
    return seed.slice(0, SAMPLE);
}

function parseTei(xml, pid) {
    const $ = cheerio.load(xml, { xmlMode: true });

    // Title from <title level="m" type="main">
    const title = $('titleStmt title[type="main"]').first().text().replace(/\s+/g, ' ').trim();

    // Filing date: prefer petition-body <date when>; fall back to any
    // pre-1870 date to avoid matching the TEI encoding dates (2010s)
    const bodyDate = $('body date[when]').first().attr('when');
    const filedDate = bodyDate || $('date[when]').filter((_, el) => {
        const w = $(el).attr('when') || '';
        return /^1[78]\d{2}/.test(w);
    }).first().attr('when');

    // ═══ CLAIMANTS: parse from TITLE (authoritative) ═══
    // Title format is "Petition of NAME[, NAME, and NAME][, on behalf of …], DD Month YYYY"
    // or "Petition of X for Y, DD Month YYYY" (Y is also a claimant-for)
    const claimants = [];
    const titleForParse = title.replace(/^Petition of\s+/i, '');
    const beforeDate = titleForParse.replace(/,?\s*\d{1,2}\s+[A-Z][a-z]+\s+\d{4}\s*$/i, '').trim();
    // Peel "for X (deceased)" or "on behalf of X" patterns — these usually
    // indicate that the person being claimed FOR is deceased, not a claimant.
    const coreClaimants = beforeDate.replace(/,\s*(for|on behalf of)\s+.+?(?=\s*$)/i, '').trim();
    const splitAnd = coreClaimants.split(/\s*,\s*and\s+|\s+and\s+|\s*,\s*/).map(s => s.trim()).filter(Boolean);
    for (const name of splitAnd) {
        // Skip deceased markers / parenthetical notes
        const clean = name.replace(/\s*\([^)]+\)\s*/g, '').trim();
        if (clean && clean.length <= 80 && !/deceased/i.test(name)) claimants.push(clean);
    }

    // ═══ ENSLAVED PERSONS: narrative-slot extraction ═══
    // TEI markup for enslaved persons in the 1862 DC corpus is consistently:
    //   "of the name of <persName>X</persName>"
    //   "negro woman named <persName>X</persName>"
    //   "following persons: <persName>X</persName>, <persName>Y</persName>"
    //   "emancipated … <persName>X</persName>"
    //   inside <list> or <item> tags after "petitioner held a claim to"
    const enslavedCandidates = new Set();
    const bodyText = $('body').text();

    // Pattern A: "of the name of <persName>"
    const reA = /of\s+the\s+name\s+of[\s\S]{0,30}?<persName[^>]*>([^<]+)<\/persName>/gi;
    // Can't regex the source — use cheerio to find persName then check preceding text
    $('body persName').each((_, el) => {
        const $el = $(el);
        const name = $el.text().replace(/\s+/g, ' ').trim();
        if (!name) return;
        // Exclude claimants themselves
        const isClaimant = claimants.some(c => c.toLowerCase() === name.toLowerCase()
            || c.toLowerCase().includes(name.toLowerCase())
            || name.toLowerCase().includes(c.toLowerCase()));
        if (isClaimant) return;

        // Check what phrase precedes this persName inside its paragraph
        const $p = $el.closest('p');
        const paraText = $p.text();
        // Find offset of this persName in paragraph text (approximate — use first occurrence)
        const idx = paraText.indexOf(name);
        const preceding = idx > 0 ? paraText.slice(Math.max(0, idx - 60), idx) : '';

        const enslavedContext = /of\s+the\s+name\s+of\s*$|named\s*$|negro\s+(man|woman|boy|girl|child)\s*(named)?\s*$|following\s+persons?:?\s*$|viz[.]?\s*$|to\s+wit:?\s*$/i.test(preceding)
            || /,\s*$/.test(preceding) && /following|namely|viz/i.test(paraText.slice(Math.max(0, idx - 200), idx));

        // Also check for list-item context — <list><item> with persName
        const $listItem = $el.closest('item');
        if ($listItem.length) {
            const listHeader = $listItem.closest('list').prev().text();
            if (/enslaved|slave|bondspeople|following|persons|claim/i.test(listHeader)) {
                enslavedCandidates.add(name);
                return;
            }
        }

        if (enslavedContext) enslavedCandidates.add(name);
    });

    // All persNames — for debugging only
    const allPersons = [];
    $('persName').each((_, el) => {
        const name = $(el).text().replace(/\s+/g, ' ').trim();
        if (name) allPersons.push(name);
    });
    const persons = allPersons.slice(0, 15);

    // Image references: <pb facs="cww.NNNNN.00X.jpg"/>
    const imageRefs = [];
    $('pb[facs]').each((_, el) => {
        const f = $(el).attr('facs');
        if (f && f.includes(pid)) imageRefs.push(f);
    });

    return {
        pid,
        title,
        filedDate,
        claimants,
        enslavedCandidates: [...enslavedCandidates],
        allPersonsCount: allPersons.length,
        persons,
        imageRefs,
    };
}

async function main() {
    const pids = await selectPids();
    console.log(`TEI XML dry-run on ${pids.length} petitions: ${pids.join(', ')}\n`);

    const summary = { parsed: 0, clean: 0, missing: [], errors: [] };

    for (const pid of pids) {
        try {
            const resp = await fetch(`https://civilwardc.org/texts/petitions/${pid}.xml`);
            if (!resp.ok) { summary.errors.push(`${pid}: HTTP ${resp.status}`); continue; }
            const xml = await resp.text();
            const r = parseTei(xml, pid);
            summary.parsed++;

            const pass = !!r.filedDate && r.claimants.length > 0 && r.imageRefs.length > 0;
            if (pass) summary.clean++;
            else {
                const missing = [
                    !r.filedDate && 'date',
                    !r.claimants.length && 'claimant',
                    !r.imageRefs.length && 'images'
                ].filter(Boolean);
                summary.missing.push(`${pid}: missing ${missing.join(',')}`);
            }

            console.log(`━━━ ${pid} ━━━ ${pass ? '✓' : '⚠'}`);
            console.log(`  Title: ${r.title}`);
            console.log(`  Filed: ${r.filedDate || '(missing)'}`);
            console.log(`  Images (${r.imageRefs.length}): ${r.imageRefs.join(', ')}`);
            console.log(`  Claimants (${r.claimants.length}): ${r.claimants.join(' | ')}`);
            console.log(`  Inferred enslaved (${r.enslavedCandidates.length}): ${r.enslavedCandidates.slice(0, 8).join(' | ')}${r.enslavedCandidates.length > 8 ? '…' : ''}`);
            console.log(`  Total persNames in doc: ${r.allPersonsCount}`);
            console.log();
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            summary.errors.push(`${pid}: ${e.message}`);
        }
    }

    console.log('═══ SUMMARY ═══');
    console.log(`Parsed: ${summary.parsed}/${pids.length}`);
    console.log(`Clean (date+claimant+images): ${summary.clean}/${summary.parsed}`);
    console.log(`Missing fields: ${summary.missing.length}`);
    for (const m of summary.missing) console.log(`  ${m}`);
    console.log(`Errors: ${summary.errors.length}`);
    for (const e of summary.errors) console.log(`  ${e}`);

    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
