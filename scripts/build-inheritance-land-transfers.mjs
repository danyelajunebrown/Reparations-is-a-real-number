#!/usr/bin/env node
/**
 * BB-1 / issue #3 — turn will land-bequests into the FIRST chain-of-title links: grantor(testator)→
 * grantee(heir) rows in land_transfer_events, and wire inheritance_edges.land_transfer_id (the FK
 * designed in M067 but never populated). This is the primary continuity primitive (land-first tracing).
 *
 * SOURCE (buildable now): the real_property inheritance_edges QW-3 produced from will heir-bequests
 * (testator + RESOLVED heir). We filter to GENUINE SPECIFIC LAND (acres/plantation/tract/lot/parcel/
 * "land in") and EXCLUDE residual language ("whole estate", "remaining property", "residue", "division")
 * — a residual share is not a chain-of-title-able parcel (inferAssetType over-catches "property"/"real").
 *
 * DOUBLE-COUNT SAFETY (audit rule #1): DisgorgementCalculator sums consideration_usd WHERE
 * implicates_enslaver=TRUE. These are PROVENANCE links, not new valuations — the land VALUE is already
 * counted by the 115 project-probate-to-disgorgement rows. So consideration_usd=NULL AND
 * implicates_enslaver=FALSE (excluded from the sum); enslaver_person_id still records the connection.
 * BISCOE: only edges with an already-resolved heir_id (real person) — never a placeholder grantee.
 *
 * KNOWN SCALE BLOCKER (documented, not fixed here): probate_estate_extractions land items name NO
 * heir/devisee (0/280) — only {category,value_usd,description}. Scaling chain-of-title beyond wills
 * needs the forensic extractor to capture the devisee PER land item (Mini/extraction change). Filed sep.
 *
 *   node scripts/build-inheritance-land-transfers.mjs            # dry-run
 *   node scripts/build-inheritance-land-transfers.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SPECIFIC_LAND = /\b(acre|acres|plantation|tract|lot\b|parcel|land in|farm|messuage|dwelling house|house and lot)\b/i;
const RESIDUAL = /\b(whole estate|remaining|residue|residual|rest and residue|equal division|all my property|remainder)\b/i;

(async () => {
  const client = await pool.connect();
  try {
    console.log(`=== build-inheritance-land-transfers ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    const cand = (await client.query(`
      SELECT ie.id, ie.testator_id, tp.canonical_name tname, ie.heir_id, hp.canonical_name hname,
             ie.asset_description, ie.document_year, ie.source_document_id, ie.confidence
      FROM inheritance_edges ie
      JOIN canonical_persons tp ON tp.id = ie.testator_id
      JOIN canonical_persons hp ON hp.id = ie.heir_id
      WHERE ie.asset_type='real_property' AND ie.heir_id IS NOT NULL AND ie.land_transfer_id IS NULL`)).rows;
    const genuine = cand.filter(r => SPECIFIC_LAND.test(r.asset_description || '') && !RESIDUAL.test(r.asset_description || ''));
    console.log(`real_property edges w/ resolved heir + no transfer yet: ${cand.length}`);
    console.log(`  → GENUINE specific-land (chain-of-title-able): ${genuine.length}  (excluded ${cand.length - genuine.length} residual/vague)`);
    genuine.slice(0, 10).forEach(r => console.log(`  ✓ ${r.tname} → ${r.hname}: "${(r.asset_description || '').replace(/^heir bequest:\s*/, '').slice(0, 60)}"`));

    // dedup: multiple inheritance_edges can describe the SAME bequest (QW-3 wrote per source-doc) →
    // ONE land_transfer_event per (testator,heir,description); ALL matching edges point to it.
    const uniq = new Map();
    for (const r of genuine) {
      const key = `${r.testator_id}|${r.heir_id}|${(r.asset_description || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
      if (!uniq.has(key)) uniq.set(key, { rep: r, edgeIds: [] });
      uniq.get(key).edgeIds.push(r.id);
    }
    console.log(`  → ${uniq.size} unique parcel-bequests (deduped from ${genuine.length})`);
    if (!APPLY) { console.log('\n(dry-run — no writes. Re-run with --apply.)'); return; }
    await client.query('BEGIN');
    let made = 0;
    for (const { rep: r, edgeIds } of uniq.values()) {
      const desc = (r.asset_description || '').replace(/^heir bequest:\s*/, '').slice(0, 500);
      const doc = r.source_document_id
        ? (await client.query(`SELECT s3_url, source_url FROM person_documents WHERE id=$1`, [r.source_document_id])).rows[0]
        : null;
      const t = await client.query(`
        INSERT INTO land_transfer_events
          (property_description, transfer_year, transfer_type, instrument_type,
           grantor_name, grantor_person_id, grantee_name, grantee_person_id,
           consideration_usd, source_document_url, source_archive, source_notes,
           confidence, verification_status, requires_human_review, review_reason,
           implicates_enslaver, enslaver_person_id, created_at, updated_at)
        VALUES ($1,$2,'inheritance','will', $3,$4,$5,$6,
           NULL, $7, 'will_inheritance_chain', 'chain-of-title link from will bequest; land VALUE counted separately (implicates_enslaver=FALSE to avoid double-count)',
           $8, 'unverified', TRUE, 'heir/parcel from will bequest text — confirm against source image',
           FALSE, $9, NOW(), NOW())
        RETURNING transfer_id`,
        [desc, r.document_year || null, r.tname, r.testator_id, r.hname, r.heir_id,
         doc?.s3_url || doc?.source_url || null, r.confidence || 0.70, r.testator_id]);
      await client.query(`UPDATE inheritance_edges SET land_transfer_id=$1, updated_at=NOW() WHERE id = ANY($2)`, [t.rows[0].transfer_id, edgeIds]);
      made++;
    }
    await client.query('COMMIT');
    console.log(`\nbuilt ${made} inheritance land-transfer chain links (grantor→grantee) + wired land_transfer_id. implicates_enslaver=FALSE (no double-count). Re-runnable as heirs/drip grow.`);
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
