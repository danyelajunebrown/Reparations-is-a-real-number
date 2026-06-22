#!/usr/bin/env node
'use strict';

/**
 * build-hall-transfers.mjs  (Front b — GitHub #63 / continuity-of-holding)
 *
 * Builds the enslaver→enslaver chattel-transfer continuity edges from the staged
 * Hall data. (1) Resolves Hall seller/buyer names → canonical enslavers
 * (unique-name reuse of the 405K existing; create for the rest — Phase-B dedups).
 * (2) Populates chattel_transfer_events (M098) from the ~49K priced Hall transfers,
 * linking from_enslaver → to_enslaver, the enslaved person (already canonicalized in
 * step a via hall_slave_records.canonical_person_id), value, year, parish.
 *
 * This is the human-chattel continuity primitive — the seed of the chain from
 * extraction toward present holders. Set-based. Idempotent. Dry-run default.
 * USAGE: node scripts/build-hall-transfers.mjs [--apply]
 */

import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// a real party name: non-empty, not a bare code, has a letter
const REALPARTY = (col) => `${col} IS NOT NULL AND length(trim(${col})) > 1 AND ${col} ~ '[A-Za-z]'`;

async function main() {
    console.log(`═══ Build Hall enslaver→enslaver chattel transfers ═══  ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    const c = await pool.connect();
    try {
        const pre = await c.query(`
            SELECT COUNT(*) FILTER (WHERE ${REALPARTY('seller_name')} AND ${REALPARTY('buyer_name')} AND sale_value > 0) priced_transfers,
                   COUNT(DISTINCT lower(trim(seller_name))) FILTER (WHERE ${REALPARTY('seller_name')}) sellers,
                   COUNT(DISTINCT lower(trim(buyer_name))) FILTER (WHERE ${REALPARTY('buyer_name')}) buyers
            FROM hall_slave_records`);
        console.log(`\n  priced transfers (seller+buyer+value): ${Number(pre.rows[0].priced_transfers).toLocaleString()}`);
        console.log(`  distinct sellers: ${Number(pre.rows[0].sellers).toLocaleString()}, buyers: ${Number(pre.rows[0].buyers).toLocaleString()}`);

        if (!APPLY) { console.log('\nDRY-RUN — re-run with --apply.'); return; }

        await c.query('BEGIN');
        // Idempotency
        await c.query(`DELETE FROM chattel_transfer_events WHERE source_external_system='hall_louisiana'`);

        // 1) distinct party names → resolve to canonical enslaver
        await c.query(`CREATE TEMP TABLE party_names ON COMMIT DROP AS
            SELECT DISTINCT lower(trim(name)) nm_lower, (array_agg(name ORDER BY name))[1] name_orig
            FROM (
              SELECT seller_name name FROM hall_slave_records WHERE ${REALPARTY('seller_name')}
              UNION ALL SELECT buyer_name FROM hall_slave_records WHERE ${REALPARTY('buyer_name')}
            ) s GROUP BY lower(trim(name))`);
        await c.query(`ALTER TABLE party_names ADD COLUMN resolved_id INTEGER`);

        // 1a) reuse unique existing canonical enslaver
        await c.query(`
            WITH uniq AS (SELECT lower(canonical_name) nm, MIN(id) id FROM canonical_persons
                          WHERE person_type='enslaver' GROUP BY 1 HAVING COUNT(*)=1)
            UPDATE party_names pn SET resolved_id = u.id FROM uniq u WHERE u.nm = pn.nm_lower`);
        const reused = (await c.query(`SELECT COUNT(*) n FROM party_names WHERE resolved_id IS NOT NULL`)).rows[0].n;

        // 1b) create canonical enslaver for unresolved (temp key in enslaved_person_id)
        await c.query(`
            INSERT INTO canonical_persons (canonical_name, person_type, created_by, enslaved_person_id, uuid, created_at, updated_at)
            SELECT name_orig, 'enslaver', 'hall_ingest_enslaver', 'he:'||nm_lower, gen_random_uuid(), NOW(), NOW()
            FROM party_names WHERE resolved_id IS NULL`);
        await c.query(`
            UPDATE party_names pn SET resolved_id = cp.id
            FROM canonical_persons cp WHERE cp.enslaved_person_id = 'he:'||pn.nm_lower AND pn.resolved_id IS NULL`);
        const created = (await c.query(`SELECT COUNT(*) n FROM canonical_persons WHERE created_by='hall_ingest_enslaver'`)).rows[0].n;

        // 2) populate transfers
        const ins = await c.query(`
            INSERT INTO chattel_transfer_events
              (enslaved_person_id, enslaved_name_text, from_enslaver_id, from_enslaver_name,
               to_enslaver_id, to_enslaver_name, transfer_type, transfer_year, transfer_date,
               value_amount, value_currency, value_usd_equiv, place_state, place_locality,
               source_table, source_external_system, source_external_id, source_citation, confidence)
            SELECT h.canonical_person_id, h.name, sp.resolved_id, h.seller_name,
                   bp.resolved_id, h.buyer_name,
                   COALESCE(NULLIF(h.doc_type,''),'sale'), h.year, h.sale_date,
                   h.sale_value, h.sale_currency, h.sale_value, 'Louisiana', h.location,
                   'hall_slave_records', 'hall_louisiana', h.record_index::text, h.source_citation, 0.75
            FROM hall_slave_records h
            JOIN party_names sp ON sp.nm_lower = lower(trim(h.seller_name))
            JOIN party_names bp ON bp.nm_lower = lower(trim(h.buyer_name))
            WHERE ${REALPARTY('h.seller_name')} AND ${REALPARTY('h.buyer_name')} AND h.sale_value > 0
            ON CONFLICT (source_external_system, source_external_id, transfer_type) DO NOTHING`);

        await c.query('COMMIT');
        console.log(`\n✓ enslavers: ${Number(reused).toLocaleString()} reused + ${Number(created).toLocaleString()} created`);
        console.log(`✓ chattel_transfer_events written: ${ins.rowCount.toLocaleString()}`);

        const top = await pool.query(`
            SELECT to_enslaver_name, COUNT(*) acquired, ROUND(SUM(value_amount)) total_value
            FROM chattel_transfer_events WHERE source_external_system='hall_louisiana' AND to_enslaver_name IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC LIMIT 5`);
        console.log('\n  top acquirers (buyers) — continuity chain heads:');
        top.rows.forEach(r => console.log(`    ${r.to_enslaver_name}: ${r.acquired} enslaved acquired, value ${Number(r.total_value).toLocaleString()}`));
    } catch (e) { await c.query('ROLLBACK').catch(()=>{}); throw e; }
    finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
