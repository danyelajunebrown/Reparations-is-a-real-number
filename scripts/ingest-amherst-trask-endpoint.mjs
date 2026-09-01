// ingest-amherst-trask-endpoint.mjs — the FIRST capital-path modern endpoint (complements Bard's land path).
//
// Amherst College HOLDS enslaver wealth by INHERITANCE/ENDOWMENT, not land. Israel Elliot Trask (Brimfield
// MA 1777 – Springfield MA 1835), founder + trustee of Amherst 1821-35, secured its Massachusetts charter and
// funded it from a cotton-slavery fortune (250+ enslaved, MS & LA). Documented gifts to Amherst: a $500
// receipt + a $300 will bequest (collected by treasurer Edward Dickinson, Emily Dickinson's father); the 1862
// Hitchcock history lists him on the $50,000 donor list (only he + Williston named). The college then ERASED
// him: 1872 → $500 + $300 only; 1891 → "founding trustee" only; 1951 → not mentioned. Direct quote from the
// 2025 Amherst event: "the wealth, the stolen labor that helped to create this institution is here."
//
// The operation: Israel + brothers James/Augustus/William Trask ran plantations in Concordia Parish LA and
// Woodville MS (La Grange Plantation). Israel stepped back ~1822; brother James was sole owner until 1855;
// then it passed to niece Charlotte Pinchon (m. James Alexander Ventress) + nephew Augustus — so the estate
// is now the "Ventress Plantation." Descendant reconstruction = Nicka Sewell-Smith's "Trask 250" project:
// 9,208 descendants traced (goal 10,000), 4,000 docs, 11 slave lists — CITED here as the authoritative
// descendant source (her research, not ours to extract); notable descendants incl. Richard Wright, Buddy Guy.
//
// AUDIT: enslaved COUNT (250+) never becomes fabricated rows; only individually-named people are minted, as
// SECONDARY leads. Living people (Nicka Sewell-Smith and living descendants) are NOT minted. All persons
// route through PersonService (mint gate); the institution + disclosure carry full provenance + review flags.
//
// Usage: node scripts/ingest-amherst-trask-endpoint.mjs [--apply]   (dry-run default)

import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');
const PersonService = require('../src/services/PersonService');

const APPLY = process.argv.includes('--apply');
const ART_URL = 'https://www.amherst.edu/mm/697181';
const S3_KEY = 'sources/amherst/trask-amherst-anna-smith-2023.html';
const SRC = 'Amherst College reckoning — Anna Smith \'22 thesis (2023); Nicka Sewell-Smith "Trask 250" lecture (2025); Israel E. Trask Papers, Amherst Archives';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15';

// Enslavers in the Trask/Ventress operation (person, idSuffix, birth, death, ctx).
const ENSLAVERS = [
  ['Israel Elliot Trask', 'israel-1777', 1777, 1835, 'Founder + trustee of Amherst College 1821-35; secured its MA charter. 250+ enslaved on cotton plantations (Concordia Parish LA, Woodville MS). $80,000 mortgage against the enslaved in 1811 (German Coast LA — his enslaved joined the 1811 Louisiana Slave Revolt). Funded Amherst: $500 receipt + $300 will bequest (collected by treasurer Edward Dickinson) + $50,000 donor list (1862 Hitchcock history). House still stands in Springfield MA.'],
  ['James Trask', 'james', null, 1855, 'Brother of Israel; became SOLE owner of the Trask plantations ~1822 until his death in 1855, when the enslaved + land passed to his niece Charlotte Pinchon (Ventress) and nephew Augustus.'],
  ['James Alexander Ventress', 'ventress-ja', null, null, 'Married Charlotte Pinchon (Israel Trask\'s niece); the Trask operation passed into the Ventress family. "Father of Ole Miss" (wrote the legislation creating the University of Mississippi). The Woodville estate is now known as the Ventress / La Grange Plantation.'],
];
// Named enslaved (secondary; owner = the Trask/Ventress operation).
const ENSLAVED = [
  ['Isaac', 'isaac', 'Israel Elliot Trask', 'Named in Israel Trask\'s Dec 5 1827 letter (Amherst Archives, Trask Papers, Box 1 f.12): "Isaac had picked as high as 245 lbs in a day" on the Mississippi cotton plantation.'],
  ['Betsy Hawkins', 'betsy-hawkins', 'Trask/Ventress families', 'Born ~1821 on La Grange Plantation (now Ventress), Woodville MS; died ~1916 aged 106 (Woodville Republican obituary). Parents of 22 children.'],
  ['Gus Hawkins', 'gus-hawkins', 'Trask/Ventress families', 'Born 1818, died 1913; enslaved on La Grange Plantation, Woodville MS. Husband of Betsy Hawkins.'],
  ['Thomas Bolden', 'thomas-bolden', 'Trask/Ventress families', 'Enslaved by the Trask/Ventress families; great-grandfather of the author Richard Wright ("Native Son").'],
  ['Phyllis Bolden', 'phyllis-bolden', 'Trask/Ventress families', 'Enslaved by the Trask/Ventress families; great-grandmother of Richard Wright.'],
];

// Idempotent lead resolve: findOrCreateLead resolves external ids on CANONICAL persons but not yet on LEADS
// (so a re-run would duplicate a lead). Resolve by (id_system, external_id) on person_external_ids first.
async function leadByExtId(pool, ps, record, opts) {
  const ex = await pool.query(
    `SELECT subject_table, subject_id FROM person_external_ids WHERE id_system=$1 AND external_id=$2 LIMIT 1`,
    [record.idSystem, record.externalId]);
  if (ex.rows[0]) return { ref: { subject_table: ex.rows[0].subject_table, subject_id: ex.rows[0].subject_id }, action: 'linked_extid' };
  return ps.findOrCreateLead(record, opts);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const ps = new PersonService(pool);
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  // 1. archive the secondary source (file-first)
  let s3key = null;
  if (APPLY) {
    try {
      const r = await fetch(ART_URL, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.ok && buf.length >= 1024) {
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        await S3.upload(S3_KEY, buf, 'text/html', { sha256: sha, source: ART_URL });
        const wb = await ensureSnapshot(ART_URL);
        await pool.query(
          `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_key, wayback_url, sha256, bytes, content_type, rehostable, notes)
           VALUES ('amherst-trask-2023','Amherst College & slavery — Israel Trask / Trask 250','Amherst College (reckoning)',$1,$2,$3,$4,$5,'text/html',TRUE,'Secondary; cites primary Israel E. Trask Papers + Nicka Smith Trask 250 project.')
           ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key, wayback_url=EXCLUDED.wayback_url`,
          [ART_URL, S3_KEY, wb, sha, buf.length]);
        s3key = S3_KEY;
        console.log(`  ✓ archived source → S3 (${(buf.length / 1024).toFixed(0)}KB)`);
      } else console.log(`  ⚠ source fetch ${r.status} — archival skipped, continuing`);
    } catch (e) { console.log(`  ⚠ archival error: ${e.message.slice(0, 50)} — continuing`); }
  }

  // 2. enslavers + named enslaved (mint gate) + owner edges
  const eref = {};
  for (const [name, sfx, by, dy, ctx] of ENSLAVERS) {
    const r = await leadByExtId(pool, ps, { name, personType: 'enslaver', birthYear: by, deathYear: dy,
      locations: ['Woodville, Mississippi', 'Concordia Parish, Louisiana', 'Massachusetts'],
      sourceType: 'secondary', confidence: 0.65, idSystem: 'amherst_trask', externalId: 'trask-' + sfx, sourceUrl: ART_URL,
      context: ctx, dataQualityFlags: { source_tier: 'secondary', max_evidence_tier: 'secondary', trask_ventress_operation: true, requires_human_review: true } }, { dryRun: !APPLY });
    eref[name] = r.ref;
    console.log(`  enslaver ${name}: ${r.ref?.subject_id || '(dry)'} [${r.action}]`);
  }
  for (const [name, sfx, owner, ctx] of ENSLAVED) {
    const r = await leadByExtId(pool, ps, { name, personType: 'enslaved', locations: ['Woodville, Mississippi'],
      sourceType: 'secondary', confidence: 0.6, idSystem: 'amherst_trask', externalId: 'trask-enslaved-' + sfx, sourceUrl: ART_URL,
      context: ctx, dataQualityFlags: { source_tier: 'secondary', enslaver_name: owner, requires_human_review: true } }, { dryRun: !APPLY });
    console.log(`  enslaved ${name}: ${r.ref?.subject_id || '(dry)'} [${r.action}]`);
    if (APPLY && r.ref) {
      const oref = eref[owner] || null;
      await pool.query(
        `INSERT INTO enslaved_owner_relationships (enslaved_name, owner_name, relationship_type, relationship_source, source_url, source_context, confidence_score, verification_status, created_by, enslaved_subject_table, enslaved_subject_id, owner_subject_table, owner_subject_id)
         VALUES ($1,$2,'enslaved_by','amherst_trask_reckoning',$3,'Trask 250 (Nicka Smith) / Amherst reckoning',0.6,'unverified','amherst-trask-ingest',$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [name, owner, ART_URL, r.ref.subject_table, r.ref.subject_id, oref?.subject_table || null, oref?.subject_id || null]).catch(() => {});
    }
  }

  // 3. Amherst College endpoint + disclosure
  if (APPLY) {
    let ent = (await pool.query(`SELECT entity_id FROM corporate_entities WHERE modern_name='Amherst College'`)).rows[0];
    if (!ent) {
      ent = (await pool.query(
        `INSERT INTO corporate_entities (modern_name, historical_name, entity_type, is_active, headquarters_location, documented_activity, involvement_category, source_url, source_document, research_notes)
         VALUES ('Amherst College','Amherst College','educational_institution',TRUE,'Amherst, Massachusetts',
                 'Founded (1821) + chartered through trustee Israel E. Trask and endowed in part with his Mississippi/Louisiana cotton-slavery fortune (250+ enslaved). Documented gifts: $500 receipt + $300 will bequest (collected by treasurer Edward Dickinson); $50,000 donor list (1862 Hitchcock history). College histories progressively ERASED his slavery connection (1862→1951). Multiple cotton-economy founding donors (Norcross bought Trask''s Brimfield cotton factory 1816; Samuel Fowler Dickinson partnered in the Amherst Cotton Factory).',
                 '{endowment,founding_bequest,capital_path}',$1,'Anna Smith thesis; Nicka Smith Trask 250; Amherst Archives Trask Papers',
                 'FIRST capital-path modern endpoint (complements Bard land-path). Evidence-backed reckoning, not a seed. Descendant side = Nicka Sewell-Smith Trask 250 (9,208 traced). Needs human review.')
         RETURNING entity_id`, [ART_URL])).rows[0];
      console.log(`  ✓ corporate_entity: Amherst College (${ent.entity_id})`);
    } else console.log(`  corporate_entity exists: Amherst College`);

    if (!(await pool.query(`SELECT 1 FROM corporate_slavery_disclosures WHERE modern_entity_name='Amherst College'`)).rows.length) {
      await pool.query(
        `INSERT INTO corporate_slavery_disclosures (modern_entity_name, historical_entity_name, involvement_type, involvement_period_start, involvement_period_end, enslaved_persons_count, enslaved_persons_direct_owned, documented_value_usd, disclosure_year, triggered_by, disclosure_document_url, disclosure_document_s3_key, has_names_list, formal_apology, remediation_funded, source_notes, review_status)
         VALUES ('Amherst College','Amherst College','founding_endowment_bequest',1821,1835,250,0,800,2023,
                 'Amherst reckoning — Black Student Union; Herbin-Triant course; Anna Smith thesis; Nicka Smith Trask 250 lecture',$1,$2,TRUE,FALSE,FALSE,
                 'Documented direct gifts to Amherst = $500 receipt + $300 will bequest ($800) of Israel E. Trask; also on the 1862 $50,000 donor list. Founding wealth from 250+ enslaved (MS/LA cotton). College histories erased the connection 1862→1951. Named enslaved: Isaac, Betsy & Gus Hawkins, Thomas & Phyllis Bolden. Descendant reconstruction: Nicka Sewell-Smith Trask 250 (9,208 traced).','pending')`,
        [ART_URL, s3key]);
      console.log('  ✓ disclosure: Amherst College ($800 documented + $50k list; 250 enslaved)');
    } else console.log('  disclosure exists');
  }

  // 4. research_findings
  if (APPLY) {
    const rf = (q, repo, idx, result, hits, note) => pool.query(
      `INSERT INTO research_findings (question, repository, index_searched, result, hit_count, subject_table, subject_id, evidence_note, searched_by)
       VALUES ($1,$2,$3,$4,$5,'unconfirmed_persons',$6,$7,'claude-amherst-endpoint')`, [q, repo, idx, result, hits, eref['Israel Elliot Trask']?.subject_id || null, note]);
    await rf('Enslaver wealth → Amherst College? (capital-path endpoint)', 'Amherst Archives / college histories', 'Trask gift receipts + will',
      'hit', 800, 'HOLDING confirmed: $500 receipt + $300 will bequest ($800 documented) + 1862 $50,000 donor list, from Israel Trask\'s 250+-enslaved MS/LA cotton fortune. Event quote: "the wealth, the stolen labor that helped to create this institution is here."');
    await rf('Did Amherst erase its slavery-funded founding?', 'Amherst college histories 1862/1872/1891/1951', 'Trask mentions over time',
      'hit', 4, 'EROSION documented: 1862 Hitchcock = Trask on the $50,000 list; 1872 Tyler = $500 receipt + $300 gift only; 1891 = "founding trustee" only; 1951 King = not mentioned. Progressive erasure of the slavery-funded founding.');
    await rf('Descendants of the Trask/Ventress enslaved? (the 10,000-strong legacy)', 'Nicka Sewell-Smith "Trask 250" project (CITED, not extracted)', 'DNA + 4,000 docs + 11 slave lists',
      'hit', 9208, 'AUTHORITATIVE descendant reconstruction by genealogist Nicka Sewell-Smith (herself a descendant): 9,208 people traced (goal 10,000), 35 states, 5 continents. Notable descendants: Richard Wright, Buddy Guy. Her dataset is HERS — cite + collaborate (she works with Amherst\'s reckoning committee, UVA descendants board), do not scrape. Living descendants not minted.');
    await rf('Living/self-identified Trask-250 descendants for opt-in outreach (the party OWED)', 'User-provided (public figures / self-identified)', 'descendant contacts',
      'partial', 3, 'Self-identified/public living descendants for potential OPT-IN outreach (NOT minted, NOT asserted; participation requires their consent via intake): Nicka Sewell-Smith (@neeksmith, genealogist); Lillie Palmer; StaHHr (artist, @StaHHr). These are the RECIPIENT side of the Amherst endpoint — the people owed, distinct from Amherst the wealth-holder.');
    console.log('  ✓ 4 research_findings logged (gift + erasure + descendants + opt-in contacts)');
  }

  await pool.end();
  console.log('\n=== done — Amherst = first capital-path modern endpoint (Trask 250) ===');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
