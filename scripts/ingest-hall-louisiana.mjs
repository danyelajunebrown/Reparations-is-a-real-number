#!/usr/bin/env node
'use strict';

/**
 * ingest-hall-louisiana.mjs  (Front a, GitHub #63 / canonicalization plan)
 *
 * Parses the Gwendolyn Midlo Hall Louisiana Slave Database (SLAVE.DBF, 100,666
 * records, 114 fields; freely released at ibiblio.org/laslave), DECODES the
 * numeric codes via the codebook, and stages the rich records into
 * hall_slave_records (M097). This replaces our impoverished prior import
 * ({year,location} only) with the full per-person facts, kinship, owner-side
 * transfers, and maritime arrival — the substrate for person_facts +
 * canonical_family_edges + the enslaver/transfer side.
 *
 * Pure dBase-III parse (no deps). Idempotent (TRUNCATE-and-load). Dry-run default.
 * USAGE: node scripts/ingest-hall-louisiana.mjs [--apply] [--dbf /tmp/hall/SLAVE.DBF]
 */

import 'dotenv/config';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const dbfArg = process.argv.indexOf('--dbf');
const DBF = dbfArg > -1 ? process.argv[dbfArg + 1] : '/tmp/hall/SLAVE.DBF';

// ── Codebook decode maps (from Slave_DB_Codes.txt) ──
const SEX = { 1: 'female', 2: 'male', 9: 'unidentified' };
const RACE = { 1: 'grif', 2: 'indian', 3: 'black', 4: 'mulatto', 5: 'quadroon', 6: 'octoroon', 7: 'metis', 8: 'other_mixed', 9: 'missing' };
const NAMETYPE = { 4: 'African', 7: 'European', 8: 'African_or_European', 9: 'none_or_illegible' };
const AGECAT = { 1: 'unborn', 2: 'nursing', 3: 'infant', 4: 'child', 5: 'young', 6: 'adult', 7: 'old' };
const CURRENCY = { p: 'piastre', s: 'peso', g: 'piastre_gourde', f: 'peso_fuerte', l: 'livre', t: 'livre_tournois', i: 'pound_indigo', d: 'us_dollar', z: 'unidentified' };
const DOCTYPE = { 1: 'estate_inventory', 2: 'estate_sale', 7: 'sale_non_probate', 8: 'criminal_litigation', 9: 'other_litigation', 10: 'mortgage', 11: 'marriage_contract', 12: 'will', 13: 'seizure_for_debt', 14: 'confiscation', 15: 'runaway_report', 18: 'miscellaneous', 22: 'census_or_tax_list', 24: 'slave_testimony', 25: 'atlantic_slave_trade' };
const LOCATION = { 1: 'St. Bernard', 2: 'Plaquemines', 3: 'Orleans', 4: 'Lafourche', 5: 'Assumption', 6: 'St. Charles', 7: 'St. John the Baptist', 8: 'St. James', 9: 'Ascension', 11: 'Iberville', 12: 'St. Martin (Attakapas)', 13: 'St. Mary', 14: 'St. Landry (Opelousas)', 15: 'Pointe Coupee', 16: 'Avoyelles', 17: 'West Baton Rouge', 20: 'Natchitoches', 21: 'Rapides', 23: 'Catahoula', 24: 'Ouachita', 25: 'East Baton Rouge', 26: 'Feliciana', 27: 'Manchak', 28: 'St. Tammany', 29: 'St. Helena', 30: 'Mobile (AL)', 31: 'Pensacola (FL)', 32: 'Natchez (MS)', 33: 'Arkansas', 34: 'Illinois', 35: 'Concordia', 36: 'Red River', 47: 'Mississippi' };
// BIRTHPL / origin (creole + African ethnicity); abbreviated to high-frequency + all African nations.
const BIRTHPL = { 4: 'Arkansas', 5: 'Massachusetts', 6: 'Mississippi', 10: 'Creole Pensacola', 11: 'Louisiana Creole', 12: 'New Orleans Creole', 13: 'Creole Mobile', 14: 'Natchez Creole', 15: 'British Mainland Creole', 16: 'Alabama', 17: 'Florida', 18: 'Georgia', 19: 'Illinois', 20: 'Kentucky', 21: 'Maryland', 22: 'Missouri', 23: 'New York', 24: 'Pennsylvania', 25: 'Tennessee', 26: 'Virginia', 27: 'Carolinas', 28: 'Rhode Island', 29: 'New England', 30: 'Native American', 33: 'Cuba', 34: 'Santo Domingo', 35: 'St Domingue', 36: 'Guadeloupe', 37: 'Martinique', 38: 'Jamaica', 45: 'Mexico', 52: 'France', 55: 'Pointe Coupee', 56: 'From Ship', 70: 'Unclear',
  101: 'Bamana', 102: 'Diola', 103: 'Manding', 104: 'Moor/Nar', 105: 'Fulbe/Pular', 106: 'Wolof', 107: 'Serer', 111: 'Soninke', 115: 'Coast of Senegal', 116: 'Kisi', 118: 'Mende', 119: 'Soso', 120: 'Temne', 133: 'Vai', 146: 'Gola', 148: 'Marka', 199: 'Guinea/Guinea Coast', 303: 'Fanti', 398: 'Gold Coast', 399: 'Coromanti', 401: 'Aja/Fon/Arada', 408: 'Hausa', 409: 'Mina', 411: 'Nago/Yoruba', 413: 'Edo', 417: 'Nupe', 490: 'Benin', 498: 'Juda (port)', 501: 'Igbo', 502: 'Ibibio/Moko', 512: 'Calabar', 551: 'Congo', 553: 'Teke', 554: 'Mandongo', 590: 'Angola', 591: 'Gabon', 599: 'Coast of Angola', 695: 'Mozambique', 699: 'Nation Unidentified', 701: 'Africa', 703: 'Brut', 704: 'Imputed African (by age)' };

const dec = (map, v) => (v === '' || v == null) ? null : (map[Number(v)] || map[v] || null);
const num = (v) => { const s = String(v).trim(); if (s === '' || s === '.') return null; const n = parseFloat(s); return Number.isNaN(n) ? null : n; };
const yn = (v) => num(v) === 1;
const txt = (v) => { const s = String(v).trim(); return s === '' ? null : s; };

function parseDBF(path) {
    const buf = fs.readFileSync(path);
    const numRecords = buf.readUInt32LE(4), headerLen = buf.readUInt16LE(8), recordLen = buf.readUInt16LE(10);
    const fields = []; let off = 32;
    while (buf[off] !== 0x0D) {
        fields.push({ name: buf.slice(off, off + 11).toString('latin1').replace(/\0.*/, '').trim(), type: String.fromCharCode(buf[off + 11]), len: buf[off + 16], }); off += 32;
    }
    const records = [];
    for (let i = 0; i < numRecords; i++) {
        let p = headerLen + i * recordLen;
        if (buf[p] === 0x2A) continue; // deleted
        p += 1; const rec = {};
        for (const f of fields) { rec[f.name] = buf.slice(p, p + f.len).toString('latin1').trim(); p += f.len; }
        rec.__i = i; records.push(rec);
    }
    return records;
}

function decodeRecord(r) {
    const out = {};
    for (const [k, v] of Object.entries(r)) { if (k === '__i') continue; out[k] = v === '' ? null : v; }
    // overlay decoded values
    out.SEX_d = dec(SEX, r.SEX); out.RACE_d = dec(RACE, r.RACE); out.NAMETYPE_d = dec(NAMETYPE, r.NAMETYPE);
    out.AGECAT_d = dec(AGECAT, r.AGECATN); out.DOCTYPE_d = dec(DOCTYPE, r.DOCTYPE); out.LOCATION_d = dec(LOCATION, r.LOCATION);
    out.BIRTHPL_d = dec(BIRTHPL, r.BIRTHPL); out.INVCUR_d = dec(CURRENCY, (r.INVCUR || '').toLowerCase()); out.SALECUR_d = dec(CURRENCY, (r.SALECUR || '').toLowerCase());
    return out;
}

function toRow(r, decoded) {
    const ownerName = (a, b) => { const f = txt(r[b]), l = txt(r[a]); return [f, l].filter(Boolean).join(' ') || null; };
    return {
        record_index: r.__i, docno: txt(r.DOCNO), estate: txt(r.ESTATE),
        name: txt(r.NAME), sex: decoded.SEX_d, race: decoded.RACE_d, age: num(r.AGE),
        birthplace: decoded.BIRTHPL_d, african_nation_spelling: txt(r.SPELL), brut: yn(r.BRUT),
        skills: txt(r.SKILLS), has_family: yn(r.FAMILY_Y_N),
        year: num(r.YEAR), doc_date: txt(r.DOCDATE), doc_type: decoded.DOCTYPE_d, location: decoded.LOCATION_d,
        seller_name: ownerName('SELLER', 'FIRST1'), buyer_name: ownerName('BUYER', 'FIRST2'),
        inv_value: num(r.INVVALP) ?? num(r.INVVALUE), inv_currency: decoded.INVCUR_d,
        sale_value: num(r.SALEVALP) ?? num(r.SALEVALUE), sale_currency: decoded.SALECUR_d, sale_date: txt(r.DATESALE),
        ship: txt(r.SHIP), captain: txt(r.CAPTAIN), arrive_date: txt(r.ARRIVEDATE), embark_from: txt(r.FROM),
        emancipated: yn(r.EMANCIP), dead: yn(r.DEAD), runaway: num(r.RUNAWAY) === 1,
        raw: decoded,
    };
}

async function main() {
    console.log(`═══ Ingest Hall Louisiana Slave DB ═══  ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    if (!fs.existsSync(DBF)) throw new Error(`DBF not found at ${DBF} (download Slave.zip from ibiblio.org/laslave)`);
    console.log(`Parsing ${DBF}…`);
    const records = parseDBF(DBF);
    const rows = records.map(r => toRow(r, decodeRecord(r)));
    console.log(`  ${rows.length.toLocaleString()} records parsed`);

    const pct = (c) => Math.round(100 * c / rows.length) + '%';
    const filled = (k) => rows.filter(r => r[k] != null && r[k] !== false).length;
    console.log('\n  fill rates (the richness our thin import lacked):');
    for (const k of ['name', 'sex', 'race', 'age', 'birthplace', 'skills', 'has_family', 'seller_name', 'buyer_name', 'sale_value', 'ship', 'emancipated'])
        console.log(`    ${k.padEnd(14)} ${pct(filled(k))}`);
    const withAfrican = rows.filter(r => r.birthplace && /Bamana|Wolof|Congo|Angola|Igbo|Yoruba|Mina|Mende|Fulbe|Gold Coast|Guinea|Benin|Calabar|Africa/.test(r.birthplace)).length;
    console.log(`\n  records with an AFRICAN origin/ethnicity: ${withAfrican.toLocaleString()}`);
    console.log('  sample:'); for (const r of rows.slice(0, 2)) console.log('   ', JSON.stringify({ name: r.name, sex: r.sex, race: r.race, age: r.age, birthplace: r.birthplace, skills: r.skills, year: r.year, location: r.location, seller: r.seller_name, sale: r.sale_value }));

    if (!APPLY) { console.log('\nDRY-RUN — re-run with --apply to load hall_slave_records.'); return; }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const c = await pool.connect();
    try {
        await c.query('BEGIN');
        await c.query('TRUNCATE hall_slave_records');
        const cols = ['record_index', 'docno', 'estate', 'name', 'sex', 'race', 'age', 'birthplace', 'african_nation_spelling', 'brut', 'skills', 'has_family', 'year', 'doc_date', 'doc_type', 'location', 'seller_name', 'buyer_name', 'inv_value', 'inv_currency', 'sale_value', 'sale_currency', 'sale_date', 'ship', 'captain', 'arrive_date', 'embark_from', 'emancipated', 'dead', 'runaway', 'raw'];
        const CHUNK = 500; let done = 0;
        for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK); const vals = []; const params = []; let n = 0;
            for (const r of chunk) {
                vals.push('(' + cols.map(() => `$${++n}`).join(',') + ')');
                params.push(...cols.map(col => col === 'raw' ? JSON.stringify(r.raw) : r[col]));
            }
            await c.query(`INSERT INTO hall_slave_records (${cols.join(',')}) VALUES ${vals.join(',')}`, params);
            done += chunk.length; if (done % 10000 === 0 || done === rows.length) console.log(`  …${done}/${rows.length}`);
        }
        await c.query('COMMIT');
        console.log(`✓ staged ${rows.length.toLocaleString()} Hall records`);
    } catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
