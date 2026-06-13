#!/usr/bin/env node
/**
 * Wire the stranded probate forensic extractions into the M088 valuation layer.
 *
 * probate_estate_extractions (the drip output — ACTIVELY ROLLING IN on the Mini)
 * holds per-estate forensic accounting (enslaved appraised value, non-chattel,
 * liabilities) but never landed in wealth_transfer_events, which sat empty. This
 * is the documented enslaver-side wealth-transfer evidence (chattel vs non-
 * chattel) the calibration layer needs as real per-estate valuations.
 *
 * IDEMPOTENT: keys each event by the extraction id (event_key='probate-ext-<id>')
 * and upserts ON CONFLICT, so it is safe to re-run as the drip adds estates —
 * new estates inserted, re-extracted ones updated, human-reviewed rows preserved.
 * Intended to be re-run periodically (or appended to the drip).
 *
 * NOTE: does NOT create reparations_line_items (that is the harm-category /
 * beneficiary-mapping step, which needs decedent->canonical resolution + a
 * methodology decision). estate_valuations is also deferred — it requires a
 * canonical_person_id for the decedent, which probate extractions don't yet
 * carry (resolve via the ER/dedup work first).
 *
 *   node scripts/sync-probate-to-wealth-transfer.mjs            # dry-run
 *   node scripts/sync-probate-to-wealth-transfer.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

(async () => {
  // estates with any financial signal worth recording as a transfer event
  const rows = (await pool.query(`
    SELECT id, segment_id, roll_group_id, year, decedent_name, document_type, extractor_version,
           estate_totals, enslaved_count, enslaved_valued_count, total_appraised_usd
    FROM probate_estate_extractions
    WHERE (total_appraised_usd > 0 OR enslaved_count > 0 OR estate_totals->>'total_appraised_value_usd' IS NOT NULL)
    ORDER BY id`)).rows;
  console.log(`probate extractions with financial data: ${rows.length} (apply=${APPLY})`);

  let written = 0, skipped = 0;
  for (const r of rows) {
    const et = r.estate_totals || {};
    const enslavedVal = num(et.enslaved_value_usd) ?? num(r.total_appraised_usd);
    const nonChattel = num(et.non_chattel_value_usd);
    let total = num(et.total_appraised_value_usd) ?? num(r.total_appraised_usd)
      ?? (((enslavedVal || 0) + (nonChattel || 0)) || null);
    // honor the proportions_sane check: total must be >= enslaved + non-chattel
    const components = (enslavedVal || 0) + (nonChattel || 0);
    if (total == null || total < components) total = components || null;
    if (total == null && enslavedVal == null) { skipped++; continue; }

    const eventKey = `probate-ext-${r.id}`;
    const name = (r.decedent_name && r.decedent_name.trim()) ? r.decedent_name.trim() : 'Unknown decedent';
    const citation = `Probate forensic extraction (roll ${r.roll_group_id || '?'}, segment ${r.segment_id ?? '?'}); extractor ${r.extractor_version || '?'}`;

    if (!APPLY) {
      if (written < 12) console.log(`  [${eventKey}] ${name} ${r.year || '?'}  total=${total ?? '?'}  enslaved=${r.enslaved_count}(@$${enslavedVal ?? '?'})  nonChattel=${nonChattel ?? '?'}`);
      written++; continue;
    }
    await pool.query(`
      INSERT INTO wealth_transfer_events
        (event_key, event_type, display_name, event_year,
         total_estate_value_usd, total_estate_value_year,
         enslaved_persons_count, enslaved_persons_appraised_value_usd, non_chattel_assets_value_usd,
         debtor_name_denormalized, debtor_entity_type, primary_archive, primary_citation,
         contribution_status, notes)
      VALUES ($1,'estate_liquidation',$2,$3,$4,$3,$5,$6,$7,$8,NULL,'FamilySearch probate',$9,'pending_review',$10)
      ON CONFLICT (event_key) DO UPDATE SET
        display_name=EXCLUDED.display_name, event_year=EXCLUDED.event_year,
        total_estate_value_usd=EXCLUDED.total_estate_value_usd,
        enslaved_persons_count=EXCLUDED.enslaved_persons_count,
        enslaved_persons_appraised_value_usd=EXCLUDED.enslaved_persons_appraised_value_usd,
        non_chattel_assets_value_usd=EXCLUDED.non_chattel_assets_value_usd,
        primary_citation=EXCLUDED.primary_citation, updated_at=NOW()
      WHERE wealth_transfer_events.contribution_status <> 'approved'`,
      [eventKey, `${name} estate`, r.year, total, r.enslaved_count, enslavedVal, nonChattel, name, citation, `document_type=${r.document_type}`]);
    written++;
  }
  console.log(`\n${APPLY ? 'upserted' : 'would write'} ${written} wealth_transfer_events; skipped ${skipped} (no value).`);
  if (APPLY) {
    const s = (await pool.query(`SELECT count(*) n, round(sum(total_estate_value_usd)) total, round(sum(enslaved_persons_appraised_value_usd)) enslaved FROM wealth_transfer_events WHERE event_key LIKE 'probate-ext-%'`)).rows[0];
    console.log(`wealth_transfer_events (probate): ${s.n} events, $${Number(s.total).toLocaleString()} estate value, $${Number(s.enslaved).toLocaleString()} enslaved-appraised.`);
  }
  await pool.end();
})();
