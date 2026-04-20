#!/usr/bin/env node
/**
 * Loads every cached Google Vision response JSON from the sweep's debug dirs
 * and re-runs the parser on each. Zero Chrome, zero Vision cost — pure parser
 * iteration. Used to verify parser-only changes without re-scraping pages.
 *
 * Usage:
 *   node scripts/test-parser-on-cache.js
 */

const fs = require('fs');
const path = require('path');

// Re-import the parser functions by requiring the extract script's module
// scope. Since the script is CommonJS and runs main() on load, we can't just
// require it. Instead we copy the relevant pure functions here by re-reading
// the script and eval'ing its module body... too hacky. Simpler: extract
// the parser functions into a shared module. For a one-off verification
// script, copy-paste the handful of functions we need.

// ── BEGIN copied from extract-freedmens-fields.js (parser functions only) ──

const NUM = String.raw`(\d+\.\s*)?`;
const LABEL_PATTERNS = [
    { key: 'record_header_name',     rx: new RegExp(`^record\\s+for[,.:]?$`, 'i') },
    { key: 'last_master',            rx: new RegExp(`^${NUM}(name\\s+of\\s+(the\\s+)?(last\\s+)?)?master(\\s+or\\s+mistress)?(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'last_mistress',          rx: new RegExp(`^${NUM}(name\\s+of\\s+(the\\s+)?(last\\s+)?)?mistress(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'plantation',             rx: new RegExp(`^${NUM}plantation[,.:;]?$`, 'i') },
    { key: 'old_title',              rx: new RegExp(`^${NUM}old\\s+title(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'slave_residence',        rx: new RegExp(`^${NUM}last\\s+residence(\\s+of\\s+depositor)?(\\s+while\\s+a\\s+slave)?[,.:;]?$`, 'i') },
    { key: 'union_lines',            rx: new RegExp(`^${NUM}time\\s+when(\\s+depositor)?(\\s+came\\s+within\\s+the\\s+union\\s+lines)?[,.:;]?$`, 'i') },
    { key: 'post_emancipation',      rx: new RegExp(`^${NUM}what\\s+depositor\\s+has\\s+since\\s+been\\s+doing[,.:;]?`, 'i') },
    { key: 'further_facts',          rx: new RegExp(`^${NUM}further\\s+facts(\\s+for\\s+identification)?[,.:;]?$`, 'i') },
    { key: 'remarks',                rx: new RegExp(`^${NUM}remarks[,.:;]?$`, 'i') },
    { key: 'depositor_name',         rx: new RegExp(`^${NUM}name\\s+of\\s+depositor[,.:;]?$`, 'i') },
    { key: 'date',                   rx: new RegExp(`^${NUM}date(\\s+and\\s+no\\.?\\s+of\\s+application| of application)?[,.:;]?$`, 'i') },
    { key: 'application_no',         rx: new RegExp(`^${NUM}no\\.?\\s+of\\s+application[,.:;]?$`, 'i') },
    { key: 'birthplace',             rx: new RegExp(`^${NUM}(where\\s+born|birthplace|place\\s+of\\s+birth)[,.:;]?$`, 'i') },
    { key: 'raised_in',              rx: new RegExp(`^${NUM}where\\s+brought\\s+up[,.:;]?$`, 'i') },
    { key: 'residence',              rx: new RegExp(`^${NUM}residence(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'age',                    rx: new RegExp(`^${NUM}age[,.:;]?$`, 'i') },
    { key: 'height_and_complexion',  rx: new RegExp(`^${NUM}height\\s+and\\s+complexion[,.:;]?$`, 'i') },
    { key: 'complexion',             rx: new RegExp(`^${NUM}complexion[,.:;]?$`, 'i') },
    { key: 'occupation',             rx: new RegExp(`^${NUM}occupation[,.:;]?$`, 'i') },
    { key: 'works_for',              rx: new RegExp(`^${NUM}works\\s+for[,.:;]?$`, 'i') },
    { key: 'regiment_and_company',   rx: new RegExp(`^${NUM}regiment\\s+and\\s+company[,.:;]?$`, 'i') },
    { key: 'regiment',               rx: new RegExp(`^${NUM}regiment[,.:;]?$`, 'i') },
    { key: 'company',                rx: new RegExp(`^${NUM}company[,.:;]?$`, 'i') },
    { key: 'marital_status',         rx: new RegExp(`^${NUM}married\\s+or\\s+single[,.:;]?$`, 'i') },
    { key: 'spouse_name',            rx: new RegExp(`^${NUM}(name\\s+of\\s+)?(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'spouse_residence',       rx: new RegExp(`^${NUM}residence\\s+of\\s+(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'children',               rx: new RegExp(`^${NUM}(names?\\s+(and\\s+ages\\s+)?of\\s+(their\\s+)?)?children[,.:;]?$`, 'i') },
    { key: 'children_res',           rx: new RegExp(`^${NUM}residences?\\s+of\\s+(their\\s+)?children[,.:;]?$`, 'i') },
    { key: 'spouse_father',              rx: new RegExp(`^${NUM}name\\s+of\\s+father\\s+of\\s+(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'spouse_mother',              rx: new RegExp(`^${NUM}name\\s+of\\s+mother\\s+of\\s+(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'spouse_siblings',            rx: new RegExp(`^${NUM}(names\\s+of\\s+)?brothers\\s+and\\s+sisters\\s+of\\s+(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'spouse_family_residences',   rx: new RegExp(`^${NUM}residences?\\s+of\\s+father\\s*,?\\s*mother\\s*,?\\s*(and\\s+)?brothers\\s*,?\\s*and\\s+sisters\\s+of\\s+(husband|wife)(\\s+or\\s+(wife|husband))?[,.:;]?$`, 'i') },
    { key: 'family_residences',          rx: new RegExp(`^${NUM}residences?\\s+of\\s+father\\s*,?\\s*mother\\s*,?\\s*(and\\s+)?brothers\\s*,?\\s*and\\s+sisters(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'siblings',                   rx: new RegExp(`^${NUM}(names\\s+of\\s+)?brothers\\s+and\\s+sisters(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'father',                     rx: new RegExp(`^${NUM}(name\\s+of\\s+)?father(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'mother',                     rx: new RegExp(`^${NUM}(name\\s+of\\s+)?mother(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
    { key: 'signature',                  rx: new RegExp(`^${NUM}signature(\\s+of\\s+depositor)?[,.:;]?$`, 'i') },
];

const LEDGER_BOUNDS = { minX: 40, maxX: 2200, minY: 120, maxY: 1600 };

function extractWords(fta) {
    const out = [];
    for (const page of fta?.pages || []) {
        for (const block of page.blocks || []) {
            for (const para of block.paragraphs || []) {
                for (const w of para.words || []) {
                    const text = (w.symbols || []).map(s => s.text).join('');
                    const box = w.boundingBox;
                    if (!text || !box?.vertices?.length) continue;
                    const xs = box.vertices.map(v => v.x || 0);
                    const ys = box.vertices.map(v => v.y || 0);
                    out.push({
                        text,
                        x: Math.min(...xs), y: Math.min(...ys),
                        xR: Math.max(...xs), yB: Math.max(...ys),
                        h: Math.max(...ys) - Math.min(...ys),
                    });
                }
            }
        }
    }
    return out;
}

function filterToLedger(words, b = LEDGER_BOUNDS) {
    return words.filter(w => w.x >= b.minX && w.xR <= b.maxX && w.y >= b.minY && w.yB <= b.maxY);
}

function findRecordAnchors(words) {
    const anchors = [];
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const asOne = /^No\.?\s*(\d{2,5})\.?$/i.exec(w.text);
        if (asOne) { anchors.push({ acct: parseInt(asOne[1]), x: w.x, y: w.y, source: 'no-single' }); continue; }
        const next = words[i + 1];
        if (/^No\.?$/i.test(w.text) && next && /^\d{2,5}\.?$/.test(next.text) && Math.abs(next.y - w.y) < 20) {
            anchors.push({ acct: parseInt(next.text), x: w.x, y: w.y, source: 'no-pair' });
        }
    }
    const RECORD_RX = /^[BRbrPplL][e3]?[cokng][o0aq]?rd[.,]?$/i;
    const FOR_RX = /^for[.,:;]?$/i;
    for (let i = 0; i < words.length - 1; i++) {
        if (RECORD_RX.test(words[i].text) && FOR_RX.test(words[i + 1].text)
            && Math.abs(words[i + 1].y - words[i].y) < 25) {
            anchors.push({ acct: null, x: words[i].x, y: words[i].y, source: 'record-for' });
        }
    }
    const dedup = [];
    for (const a of [...anchors].sort((p, q) => (p.acct == null ? 1 : 0) - (q.acct == null ? 1 : 0))) {
        if (dedup.some(d => Math.abs(d.x - a.x) < 60 && Math.abs(d.y - a.y) < 60)) continue;
        dedup.push(a);
    }
    dedup.sort((p, q) => (p.y - q.y) || (p.x - q.x));
    return dedup;
}

// ── END copied parser logic ──

// ── main ──
const TEST_DIR = path.resolve(__dirname, '../debug/freedmens-bank/enslaver-test');
if (!fs.existsSync(TEST_DIR)) { console.error('No test dir'); process.exit(1); }

const branches = fs.readdirSync(TEST_DIR).filter(f => fs.statSync(path.join(TEST_DIR, f)).isDirectory());

console.log(`${'branch'.padEnd(45)} anchors  acct/record-for  name-matched`);
console.log('─'.repeat(85));

for (const branchDir of branches.sort()) {
    const dir = path.join(TEST_DIR, branchDir);
    const visionFiles = fs.readdirSync(dir).filter(f => f.endsWith('-vision.json'));
    if (!visionFiles.length) continue;
    // Use the first (or only) vision file per branch for this quick test
    const vf = visionFiles[0];
    const fta = JSON.parse(fs.readFileSync(path.join(dir, vf), 'utf8'));
    const words = filterToLedger(extractWords(fta));
    const anchors = findRecordAnchors(words);
    const acctAnchors = anchors.filter(a => a.acct != null).length;
    const recordForAnchors = anchors.filter(a => a.acct == null).length;
    console.log(
        `${branchDir.padEnd(45)} ${String(anchors.length).padStart(3)}      ${String(acctAnchors).padStart(3)}/${String(recordForAnchors).padStart(3)}           ${vf.replace('-vision.json', '')}`
    );
}
