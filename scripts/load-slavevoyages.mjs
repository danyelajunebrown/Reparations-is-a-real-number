#!/usr/bin/env node
/**
 * Load the SlaveVoyages .tab exports into the slavevoyages_voyages table.
 *
 * Inputs (already on disk):
 *   storage/population-data/slavevoyages-transatlantic-2023.tab  (~36,080 voyages)
 *   storage/population-data/slavevoyages-intra-american-2023.tab (~28,775 voyages)
 *
 * Output: one row per voyage in slavevoyages_voyages, with key columns named
 * and the entire .tab row preserved in `raw` (JSONB). Upserts on voyageid so
 * the script is safely re-runnable. Idempotent.
 *
 *   node scripts/load-slavevoyages.mjs                # dry run
 *   node scripts/load-slavevoyages.mjs --apply        # write
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const DATA_DIR = path.resolve(__dirname, '../storage/population-data');

const FILES = [
  { type: 'transatlantic',  file: 'slavevoyages-transatlantic-2023.tab' },
  { type: 'intraamerican',  file: 'slavevoyages-intra-american-2023.tab' },
];

const OWNER_COLS = 'ABCDEFGHIJKLMNOP'.split('').map((c) => `OWNER${c}`);

// Convert a header-positioned row into { COL: value } object, treating empty
// strings as NULL so JSONB doesn't carry 314 noise fields per voyage.
function rowToObj(header, fields) {
  const out = {};
  for (let i = 0; i < header.length; i++) {
    const v = fields[i];
    if (v !== undefined && v !== '') out[header[i]] = v;
  }
  return out;
}

const toInt = (v) => {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10); return Number.isFinite(n) ? n : null;
};
const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(v); return Number.isFinite(n) ? n : null;
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function loadFile(type, filePath, client) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let header = null;
  let n = 0;
  let inserted = 0;
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    if (!APPLY) { buf = []; return; }
    // Multi-row UPSERT. 22 params per row.
    const values = []; const params = [];
    let i = 1;
    for (const r of buf) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(r.voyageid, r.voyage_type, r.shipname, r.nationality,
        r.captain_a, r.captain_b, r.captain_c, r.owners,
        r.port_departure, r.port_arrival, r.port_return,
        r.year_departure, r.year_arrival,
        r.enslaved_embarked, r.enslaved_disembarked, r.enslaved_intended,
        r.enslaved_died_crossing, r.voyage_mortality_rate, r.crew_died,
        r.tonnage, r.raw, r.shipname /* placeholder for ON CONFLICT excluded */);
    }
    // Strip the trailing placeholder — we don't need it for ON CONFLICT.
    // Simpler: just rebuild without the 22nd slot.
    const sql = `
      INSERT INTO slavevoyages_voyages
        (voyageid, voyage_type, shipname, nationality,
         captain_a, captain_b, captain_c, owners,
         port_departure, port_arrival, port_return,
         year_departure, year_arrival,
         enslaved_embarked, enslaved_disembarked, enslaved_intended,
         enslaved_died_crossing, voyage_mortality_rate, crew_died,
         tonnage, raw)
      VALUES ${buf.map((_, idx) => {
        const base = idx * 21;
        const ph = Array.from({ length: 21 }, (_, k) => `$${base + k + 1}`).join(', ');
        return `(${ph})`;
      }).join(',\n')}
      ON CONFLICT (voyageid) DO UPDATE SET
        voyage_type = EXCLUDED.voyage_type,
        shipname    = EXCLUDED.shipname,
        nationality = EXCLUDED.nationality,
        captain_a   = EXCLUDED.captain_a,
        captain_b   = EXCLUDED.captain_b,
        captain_c   = EXCLUDED.captain_c,
        owners      = EXCLUDED.owners,
        port_departure = EXCLUDED.port_departure,
        port_arrival   = EXCLUDED.port_arrival,
        port_return    = EXCLUDED.port_return,
        year_departure = EXCLUDED.year_departure,
        year_arrival   = EXCLUDED.year_arrival,
        enslaved_embarked      = EXCLUDED.enslaved_embarked,
        enslaved_disembarked   = EXCLUDED.enslaved_disembarked,
        enslaved_intended      = EXCLUDED.enslaved_intended,
        enslaved_died_crossing = EXCLUDED.enslaved_died_crossing,
        voyage_mortality_rate  = EXCLUDED.voyage_mortality_rate,
        crew_died              = EXCLUDED.crew_died,
        tonnage                = EXCLUDED.tonnage,
        raw                    = EXCLUDED.raw`;
    // Rebuild params without the trailing junk.
    const flatParams = [];
    for (const r of buf) {
      flatParams.push(r.voyageid, r.voyage_type, r.shipname, r.nationality,
        r.captain_a, r.captain_b, r.captain_c, r.owners,
        r.port_departure, r.port_arrival, r.port_return,
        r.year_departure, r.year_arrival,
        r.enslaved_embarked, r.enslaved_disembarked, r.enslaved_intended,
        r.enslaved_died_crossing, r.voyage_mortality_rate, r.crew_died,
        r.tonnage, r.raw);
    }
    const r = await client.query(sql, flatParams);
    inserted += r.rowCount;
    buf = [];
  };

  for await (const line of rl) {
    if (!line) continue;
    const fields = line.split('\t');
    if (!header) { header = fields; continue; }
    const obj = rowToObj(header, fields);
    const voyageid = toInt(obj.VOYAGEID);
    if (voyageid == null) continue;

    const ownersArr = OWNER_COLS
      .map((c) => obj[c]).filter((v) => v != null && v !== '');

    const embarked    = toInt(obj.SLAS32);
    const disembarked = toInt(obj.SLAMIMP);
    const died        = (embarked != null && disembarked != null)
      ? embarked - disembarked : null;

    buf.push({
      voyageid,
      voyage_type: type,
      shipname:    obj.SHIPNAME || null,
      nationality: obj.NATIONAL || null,
      captain_a:   obj.CAPTAINA || null,
      captain_b:   obj.CAPTAINB || null,
      captain_c:   obj.CAPTAINC || null,
      owners:      ownersArr.length ? ownersArr : null,
      port_departure: obj.PORTDEP || null,
      port_arrival:   obj.ARRPORT || null,
      port_return:    obj.PORTRET || null,
      year_departure: toInt(obj.YEARDEP),
      year_arrival:   toInt(obj.YEARAM),
      enslaved_embarked:      embarked,
      enslaved_disembarked:   disembarked,
      enslaved_intended:      toInt(obj.SLINTEND),
      enslaved_died_crossing: died,
      voyage_mortality_rate:  toNum(obj.VYMRTRAT),
      crew_died:              toInt(obj.CREWDIED),
      tonnage:                toInt(obj.TONNAGE),
      raw: obj,
    });
    n++;
    if (buf.length >= 500) await flush();
  }
  await flush();
  return { read: n, inserted };
}

async function main() {
  console.log(APPLY ? '=== Load SlaveVoyages (APPLY) ===' : '=== Load SlaveVoyages (DRY RUN) ===');
  const client = await pool.connect();
  try {
    if (APPLY) await client.query('BEGIN');
    for (const { type, file } of FILES) {
      const p = path.join(DATA_DIR, file);
      console.log(`\n→ ${file} (${type})`);
      const { read, inserted } = await loadFile(type, p, client);
      console.log(`  read ${read} voyages; ${APPLY ? `upserted ${inserted}` : 'dry-run, nothing written'}`);
    }
    if (APPLY) await client.query('COMMIT');
    const tot = (await pool.query('SELECT COUNT(*) FROM slavevoyages_voyages')).rows[0].count;
    console.log(`\nTotal rows in slavevoyages_voyages: ${tot}`);
  } catch (e) {
    if (APPLY) { try { await client.query('ROLLBACK'); } catch (_) {} }
    throw e;
  } finally { client.release(); await pool.end(); }
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
