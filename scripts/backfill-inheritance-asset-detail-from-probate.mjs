#!/usr/bin/env node
/**
 * QW-3 / issue #75 — backfill inheritance_edges.asset_type / asset_value_usd_est from the per-heir
 * bequest detail in probate_estate_extractions (the forensic-drip corpus), which today only feeds
 * estate_valuations/land/heirloom, never inheritance_edges (8,829 of 8,832 edges are 'unspecified').
 *
 * Source arrays (per estate): monetary_bequests[]{beneficiary,amount_usd}, enslaved_persons[]
 * {bequeathed_to,appraised_value_usd}, heirs[]{name,bequest}. Reuses the proven decedent->enslaver
 * DISTINCT-ON resolver (project-probate-to-disgorgement.js) + fail-closed heir resolver + inferAssetType
 * (backfill-inheritance-edges-from-will-extractions.js). New file — never touches the parallel-owned
 * georgia-probate-scraper.js.
 *
 * AUDIT RULE #1 (enforced): estate_totals / non_chattel value are NEVER distributed across heirs —
 * asset_value is set ONLY where the OCR ties a value to a NAMED beneficiary (monetary amount, or an
 * enslaved person's appraised value with a bequeathed_to). heirs[]-only edges keep value NULL.
 * BISCOE: heir name resolves to a SINGLE canonical or heir_id=NULL (raw name in notes) — never a guess.
 *
 *   node scripts/backfill-inheritance-asset-detail-from-probate.mjs            # dry-run
 *   node scripts/backfill-inheritance-asset-detail-from-probate.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const VALID_ASSET_TYPES = new Set(['real_property','enslaved_persons','personal_estate','monetary_bequest','residual_estate','trust_interest','business_interest','mixed','unspecified']);
function inferAssetType(t) {
  if (!t) return 'unspecified'; t = String(t).toLowerCase();
  if (/enslaved|slave|servant|negro|colored person/.test(t)) return 'enslaved_persons';
  if (/land|lot|acre|plantation|farm|tract|real|property/.test(t)) return 'real_property';
  if (/money|dollar|\$|cash|sum|annuity|bond|note/.test(t)) return 'monetary_bequest';
  if (/residue|remainder|rest|remaining|all my/.test(t)) return 'residual_estate';
  if (/trust|use of|benefit of/.test(t)) return 'trust_interest';
  if (/business|firm|partnership|stock/.test(t)) return 'business_interest';
  if (/furniture|household|personal|goods|chattels|livestock|horse/.test(t)) return 'personal_estate';
  return 'unspecified';
}
// appraised_value_usd is inconsistent: 475 or {value:475} or "475"
function normVal(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') return normVal(v.value ?? v.amount ?? v.usd);
  const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null;
}
async function resolveHeir(client, name) {
  if (!name) return null;
  const one = await client.query(`SELECT id FROM canonical_persons WHERE canonical_name ILIKE $1 LIMIT 3`, [`%${name}%`]);
  if (one.rows.length === 1) return one.rows[0].id;
  const toks = String(name).toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length >= 2);
  if (toks.length >= 2) {
    const cond = toks.map((_, i) => `canonical_name ILIKE $${i + 1}`).join(' AND ');
    const r = await client.query(`SELECT id FROM canonical_persons WHERE ${cond} LIMIT 3`, toks.map(t => `%${t}%`));
    if (r.rows.length === 1) return r.rows[0].id;
  }
  return null; // 0 or >1 → fail-closed (Biscoe)
}

(async () => {
  const client = await pool.connect();
  try {
    console.log(`=== backfill inheritance asset detail from probate ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    // 2) resolve each extraction -> ONE canonical enslaver testator + 3) a citation doc via segment
    const est = (await client.query(`
      SELECT DISTINCT ON (pe.id) pe.id, pe.decedent_name, cp.id testator_id,
             (SELECT s.page_doc_ids[1] FROM probate_estate_segments s WHERE s.id = pe.segment_id) source_document_id,
             pe.monetary_bequests, pe.enslaved_persons, pe.heirs
      FROM probate_estate_extractions pe
      JOIN canonical_persons cp ON LOWER(cp.canonical_name) = LOWER(pe.decedent_name) AND cp.person_type = 'enslaver'
      ORDER BY pe.id, cp.id`)).rows;
    console.log(`resolved ${est.length} extractions -> canonical enslaver testators`);

    // 4) emit per-heir descriptors
    const desc = [];
    for (const e of est) {
      for (const b of (Array.isArray(e.monetary_bequests) ? e.monetary_bequests : []))
        if (b && b.beneficiary) desc.push({ e, heir: b.beneficiary, asset_type: 'monetary_bequest', value: normVal(b.amount_usd), count: null, note: b.form ? `monetary bequest (${b.form})` : 'monetary bequest' });
      for (const p of (Array.isArray(e.enslaved_persons) ? e.enslaved_persons : []))
        if (p && p.bequeathed_to) desc.push({ e, heir: p.bequeathed_to, asset_type: 'enslaved_persons', value: normVal(p.appraised_value_usd), count: 1, note: p.name ? `bequeathed enslaved person "${p.name}"` : 'bequeathed enslaved person' });
      for (const h of (Array.isArray(e.heirs) ? e.heirs : []))
        if (h && h.name && h.bequest) desc.push({ e, heir: h.name, asset_type: inferAssetType(h.bequest), value: null, count: null, note: `heir bequest: ${String(h.bequest).slice(0, 120)}` }); // value NULL — never distribute totals
    }
    const byType = {}; for (const d of desc) byType[d.asset_type] = (byType[d.asset_type] || 0) + 1;
    console.log(`\ncandidate asset-typed edges: ${desc.length}`, byType);
    console.log(`  (spec target ~178 monetary + ~342 enslaved-bequeathed + ~390 heir-bequest)`);

    if (!APPLY) {
      console.log('\nsample:');
      desc.slice(0, 8).forEach(d => console.log(`  ${d.e.decedent_name} -> "${d.heir}" [${d.asset_type}] ${d.value != null ? '$' + d.value : '(no value)'}`));
      console.log('\n(dry-run — no writes. Re-run with --apply.)');
      return;
    }

    // 5) resolve heirs (fail-closed) + GROUP by the edge's UNIQUE key (testator,heir,asset_type,source_doc)
    //    so multiple items to one heir become ONE edge (count them; NEVER sum their values — audit rule #1).
    await client.query('BEGIN');
    let heirResolved = 0, skipped = 0;
    const groups = new Map();
    for (const d of desc) {
      if (!VALID_ASSET_TYPES.has(d.asset_type)) d.asset_type = 'unspecified';
      const heirId = await resolveHeir(client, d.heir);
      if (!heirId) { skipped++; continue; }        // heir_id is NOT NULL — skip, never fabricate (Biscoe)
      heirResolved++;
      const key = `${d.e.testator_id}|${heirId}|${d.asset_type}|${d.e.source_document_id ?? 'null'}`;
      let g = groups.get(key);
      if (!g) { g = { testator_id: d.e.testator_id, heirId, asset_type: d.asset_type, sdoc: d.e.source_document_id, eid: d.e.id, n: 0, values: [], notes: [] }; groups.set(key, g); }
      g.n++; if (d.value != null) g.values.push(d.value); g.notes.push(d.note);
    }
    // 6+7) one UPSERT per group. asset_value = the single tied value, or NULL when >1 valued item collapses
    //      (never sum). enslaved_persons_count = number of persons (a count, not a sum — audit-safe).
    let updated = 0, inserted = 0, failed = 0;
    for (const g of groups.values()) {
      const value = g.values.length === 1 ? g.values[0] : null;
      const count = g.asset_type === 'enslaved_persons' ? g.n : null;
      const adesc = g.notes.slice(0, 3).join('; ') + (g.notes.length > 3 ? ` (+${g.notes.length - 3} more)` : '');
      const vnote = `probate_estate_extraction:${g.eid}` + (g.values.length > 1 ? ' | value withheld: multiple valued items to one heir (no sum, rule #1)' : '');
      await client.query('SAVEPOINT w');
      try {
        const upd = await client.query(`
          UPDATE inheritance_edges SET asset_type=$1, asset_value_usd_est=$2, enslaved_persons_count=COALESCE($3,enslaved_persons_count),
             asset_description=$4, value_methodology_note=$5, evidence_tier=2, updated_at=NOW()
          WHERE testator_id=$6 AND heir_id=$7 AND source_document_id IS NOT DISTINCT FROM $8 AND asset_type='unspecified' RETURNING id`,
          [g.asset_type, value, count, adesc, vnote, g.testator_id, g.heirId, g.sdoc]);
        if (upd.rowCount > 0) { updated++; await client.query('RELEASE SAVEPOINT w'); continue; }
        const ins = await client.query(`
          INSERT INTO inheritance_edges (testator_id, heir_id, asset_type, asset_value_usd_est, enslaved_persons_count,
              asset_description, value_methodology_note, source_document_id, evidence_tier, confidence, created_at, updated_at)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,2,0.70,NOW(),NOW()
          WHERE NOT EXISTS (SELECT 1 FROM inheritance_edges WHERE testator_id=$1 AND heir_id=$2 AND asset_type=$3
              AND source_document_id IS NOT DISTINCT FROM $8) RETURNING id`,
          [g.testator_id, g.heirId, g.asset_type, value, count, adesc, vnote, g.sdoc]);
        inserted += ins.rowCount;
        await client.query('RELEASE SAVEPOINT w');
      } catch (e) { await client.query('ROLLBACK TO SAVEPOINT w'); failed++; if (failed <= 3) console.log('  skip: ' + e.message); }
    }
    await client.query('COMMIT');
    console.log(`groups: ${groups.size} | failed writes: ${failed}`);
    console.log(`\napplied: ${updated} edges enriched, ${inserted} inserted; ${skipped}/${desc.length} skipped (heir not yet a single canonical — fail-closed). Re-run as heirs/drip grow.`);
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
