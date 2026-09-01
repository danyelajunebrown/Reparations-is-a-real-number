// ingest-georgetown-gu272-endpoint.mjs — the CLEANEST capital-path modern endpoint (after Amherst/Trask).
//
// Georgetown University was rescued from insolvency by the MARYLAND JESUITS' 1838 sale of 272 enslaved
// men, women, and children ("the GU272") to Louisiana sugar planters for $115,000 (~$3.3M today). The
// sale was orchestrated by two Jesuits who each served as Georgetown president — Rev. Thomas F. Mulledy
// (provincial superior) and Rev. William McSherry — and the enslaved were bought by former LA governor
// Henry Johnson and Jesse Batey (West Oak Plantation, Iberville Parish / Maringouin / Ascension Parish).
// The Jesuits sold 314 people in all over 1838-1843; the 272 are those on the initial 1838 articles.
// The proceeds paid Georgetown's debts — CAPITAL path: institutional enslaver = the Maryland Jesuits;
// the college is the wealth-beneficiary ENDPOINT.
//
// Descendant reconstruction ALREADY EXISTS (cite, do not scrape): the GU272 Descendants Association and
// the Descendants Truth & Reconciliation Foundation (DTRF, 2021 — Georgetown + Jesuits + the Association).
// Genealogists (Georgetown Memory Project / Richard Cellini; NYT's Rachel Swarns) traced 10,000+
// descendants (est. 12,000-15,000 total). The Jesuits pledged $100M (2021) toward a $1B goal, +$27M (2023).
//
// AUDIT (same invariants as the Amherst script):
//  - 272 is a documented COUNT — it NEVER becomes fabricated rows. Only individually-NAMED people are
//    minted, as SECONDARY-tier, review-flagged leads (Isaac Hawkins, Cornelius Hawkins, Frank Campbell).
//  - LIVING descendants (and the Descendants Association / DTRF) are NOT minted — they are the RECIPIENT
//    side, cited in research_findings.
//  - All persons route through PersonService (the mint gate). Institution + disclosure carry provenance +
//    max_evidence_tier='secondary' + review flags.
//
// Sources (each fact below is grounded in one of these — see plan-modern-endpoints-program.md for the map):
//   https://www.georgetown.edu/slavery/
//   https://www.georgetown.edu/news/georgetown-apologizes-for-1838-sale-of-272-slaves-dedicates-buildings/
//   https://slaveryarchive.georgetown.edu/collections/show/1   (the 1838 sale collection)
//   https://en.wikipedia.org/wiki/1838_Jesuit_slave_sale
//   https://www.descendants.org/who-we-are/history             (Descendants Truth & Reconciliation Foundation)
//   https://www.cnn.com/2021/03/16/us/georgetown-slavery-descendants-jesuits-100-million-trnd
//   https://www.americamagazine.org/politics-society/2023/09/13/jesuits-descendants-enslaved-georgetown-racism-healing-246062/
//
// Usage: node scripts/ingest-georgetown-gu272-endpoint.mjs [--apply]   (dry-run default; DO NOT --apply
// without user vetting — minting is a deliberate step, as Amherst / Bard were.)

import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';
const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');
const PersonService = require('../src/services/PersonService');

const APPLY = process.argv.includes('--apply');
// File-first archival: the Georgetown reckoning hub (stable, institution-authored).
const ART_URL = 'https://www.georgetown.edu/slavery/';
const S3_KEY = 'sources/georgetown/gu272-georgetown-slavery-reckoning.html';
const SRC = 'Georgetown University reckoning (georgetown.edu/slavery + 2016 apology); Georgetown Slavery Archive; Descendants Truth & Reconciliation Foundation';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15';

// Enslavers in the GU272 transaction (person, idSuffix, birth, death, personType, ctx).
// The institutional enslaver (the Maryland Jesuits) is the corporate seller; these are the human agents
// (the two Georgetown-president Jesuits who signed) + the two Louisiana buyers (the receiving enslavers).
const ENSLAVERS = [
  ['Thomas F. Mulledy', 'mulledy-thomas', 1794, 1860, 'Jesuit provincial superior of the Maryland Province and twice president of Georgetown College; principal signer/orchestrator of the 1838 sale of 272 enslaved people to Louisiana for $115,000 to rescue Georgetown from debt. Georgetown\'s Mulledy Hall was renamed Isaac Hawkins Hall (2017).'],
  ['William McSherry', 'mcsherry-william', 1799, 1839, 'Jesuit and president of Georgetown College; co-orchestrator with Thomas Mulledy of the 1838 sale of the GU272. Georgetown\'s McSherry Hall was renamed Anne Marie Becraft Hall (2017).'],
  ['Henry Johnson', 'buyer-henry-johnson', 1783, 1864, 'Former governor of Louisiana, U.S. congressman and senator; a BUYER of the GU272 — took enslaved people to plantations near Maringouin / Ascension Parish, Louisiana (later Chatham Plantation).'],
  ['Jesse Batey', 'buyer-jesse-batey', null, null, 'Louisiana sugar planter; a BUYER of the GU272 — took enslaved people to West Oak Plantation, Iberville Parish, on Bayou Maringouin, Louisiana.'],
];

// Named enslaved from the 1838 sale (SECONDARY, review-flagged). VERIFIED via the sources above; the 272
// remain a documented COUNT. owner = the Maryland Jesuits / GU272 sale (institutional).
const OWNER_LABEL = 'Maryland Jesuits (Society of Jesus, Maryland Province) — GU272 1838 sale';
const ENSLAVED = [
  ['Isaac Hawkins', 'isaac-hawkins', 'First person listed on the articles of agreement for the 1838 sale; Georgetown renamed Mulledy Hall to Isaac Hawkins Hall (2017) in his honor. Ancestor of the Isaac Hawkins Legacy Group of descendants.'],
  ['Cornelius Hawkins', 'cornelius-hawkins', 'Among the 272 enslaved people sold by the Maryland Jesuits in 1838 to Louisiana; documented in the Georgetown Slavery Archive / GU272 genealogical reconstruction.'],
  ['Frank Campbell', 'frank-campbell', 'Enslaved man sold by the Jesuits in the 1838 GU272 sale; survives in a documented historical photograph ("Frank Campbell ... was sold by the Jesuits").'],
  // TODO/UNVERIFIED: the full 1838 roster (272 names) lives in the Georgetown Slavery Archive articles of
  // agreement (slaveryarchive.georgetown.edu/collections/show/1). Mint additional names ONLY after
  // verifying each against that primary transcription — never expand the count into rows.
];

// Idempotent lead resolve (identical to the Amherst template): findOrCreateLead resolves external ids on
// CANONICAL persons but not yet on LEADS, so resolve by (id_system, external_id) first to avoid dup leads.
async function leadByExtId(pool, ps, record, opts) {
  const ex = await pool.query(
    `SELECT subject_table, subject_id FROM person_external_ids WHERE id_system=$1 AND external_id=$2 LIMIT 1`,
    [record.idSystem, record.externalId]);
  if (ex.rows[0]) return { ref: { subject_table: ex.rows[0].subject_table, subject_id: ex.rows[0].subject_id }, action: 'linked_extid' };
  return ps.findOrCreateLead(record, opts);
}

async function main() {
  const url = process.env.DATABASE_URL;
  const ssl = /neon|sslmode=require/.test(url || '') ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl });
  const ps = new PersonService(pool);
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');
  console.log(`source: ${SRC}`);

  // 1. archive the reckoning source (file-first)
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
           VALUES ('georgetown-gu272-2016','Georgetown University & slavery — the GU272 1838 sale','Georgetown University (reckoning)',$1,$2,$3,$4,$5,'text/html',TRUE,'Secondary; cites primary Georgetown Slavery Archive articles of agreement + Descendants Truth & Reconciliation Foundation.')
           ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key, wayback_url=EXCLUDED.wayback_url`,
          [ART_URL, S3_KEY, wb, sha, buf.length]);
        s3key = S3_KEY;
        console.log(`  ✓ archived source → S3 (${(buf.length / 1024).toFixed(0)}KB)`);
      } else console.log(`  ⚠ source fetch ${r.status} — archival skipped, continuing`);
    } catch (e) { console.log(`  ⚠ archival error: ${e.message.slice(0, 50)} — continuing`); }
  }

  // 2. enslavers (Jesuit sellers + Louisiana buyers) + named enslaved (mint gate) + owner edges
  const eref = {};
  for (const [name, sfx, by, dy, ctx] of ENSLAVERS) {
    const r = await leadByExtId(pool, ps, { name, personType: 'enslaver', birthYear: by, deathYear: dy,
      locations: ['District of Columbia', 'Maryland', 'Louisiana'],
      sourceType: 'secondary', confidence: 0.65, idSystem: 'georgetown_gu272', externalId: 'gu272-' + sfx, sourceUrl: ART_URL,
      context: ctx, dataQualityFlags: { source_tier: 'secondary', max_evidence_tier: 'secondary', gu272_1838_sale: true, requires_human_review: true } }, { dryRun: !APPLY });
    eref[name] = r.ref;
    console.log(`  enslaver ${name}: ${r.ref?.subject_id || '(dry)'} [${r.action}]`);
  }
  for (const [name, sfx, ctx] of ENSLAVED) {
    const r = await leadByExtId(pool, ps, { name, personType: 'enslaved', locations: ['District of Columbia', 'Maringouin, Louisiana'],
      sourceType: 'secondary', confidence: 0.6, idSystem: 'georgetown_gu272', externalId: 'gu272-enslaved-' + sfx, sourceUrl: ART_URL,
      context: ctx, dataQualityFlags: { source_tier: 'secondary', max_evidence_tier: 'secondary', enslaver_name: OWNER_LABEL, gu272_named_individual: true, requires_human_review: true } }, { dryRun: !APPLY });
    console.log(`  enslaved ${name}: ${r.ref?.subject_id || '(dry)'} [${r.action}]`);
    if (APPLY && r.ref) {
      await pool.query(
        `INSERT INTO enslaved_owner_relationships (enslaved_name, owner_name, relationship_type, relationship_source, source_url, source_context, confidence_score, verification_status, created_by, enslaved_subject_table, enslaved_subject_id, owner_subject_table, owner_subject_id)
         VALUES ($1,$2,'enslaved_by','georgetown_gu272_reckoning',$3,'GU272 1838 Jesuit slave sale (Georgetown Slavery Archive)',0.6,'unverified','georgetown-gu272-ingest',$4,$5,NULL,NULL) ON CONFLICT DO NOTHING`,
        [name, OWNER_LABEL, ART_URL, r.ref.subject_table, r.ref.subject_id]).catch(() => {});
    }
  }

  // 3. Georgetown University endpoint + disclosure
  if (APPLY) {
    let ent = (await pool.query(`SELECT entity_id FROM corporate_entities WHERE modern_name='Georgetown University'`)).rows[0];
    if (!ent) {
      ent = (await pool.query(
        `INSERT INTO corporate_entities (modern_name, historical_name, entity_type, is_active, headquarters_location, documented_activity, involvement_category, source_url, source_document, research_notes)
         VALUES ('Georgetown University','Georgetown College','educational_institution',TRUE,'Washington, District of Columbia',
                 'Rescued from insolvency by the Maryland Jesuits'' 1838 sale of 272 enslaved people (the GU272) to Louisiana sugar planters for $115,000 (~$3.3M today). Sale orchestrated by two Jesuit Georgetown presidents (Thomas Mulledy, provincial superior; William McSherry) and bought by Henry Johnson (former LA governor) and Jesse Batey. 314 sold in all 1838-1843. Georgetown apologized in 2016, renamed Mulledy Hall to Isaac Hawkins Hall and McSherry Hall to Anne Marie Becraft Hall (2017), and (with the Jesuits) co-founded the Descendants Truth & Reconciliation Foundation (2021).',
                 '{sale_proceeds,founding_rescue,capital_path}',$1,'Georgetown Slavery Archive; georgetown.edu/slavery; Descendants Truth & Reconciliation Foundation',
                 'Modern capital-path endpoint (cf. Amherst/Trask). Documented reckoning, not a seed. Descendant side = GU272 Descendants Association + DTRF (10,000+ descendants traced by the Georgetown Memory Project). Needs human review; 272 is a documented COUNT, never fabricated rows.')
         RETURNING entity_id`, [ART_URL])).rows[0];
      console.log(`  ✓ corporate_entity: Georgetown University (${ent.entity_id})`);
    } else console.log(`  corporate_entity exists: Georgetown University`);

    if (!(await pool.query(`SELECT 1 FROM corporate_slavery_disclosures WHERE modern_entity_name='Georgetown University'`)).rows.length) {
      await pool.query(
        `INSERT INTO corporate_slavery_disclosures (modern_entity_name, historical_entity_name, involvement_type, involvement_period_start, involvement_period_end, enslaved_persons_count, enslaved_persons_direct_owned, documented_value_usd, disclosure_year, triggered_by, disclosure_document_url, disclosure_document_s3_key, has_names_list, formal_apology, remediation_funded, source_notes, review_status)
         VALUES ('Georgetown University','Georgetown College (Maryland Jesuits)','slave_sale_proceeds_funded_operations',1838,1843,272,272,115000,2016,
                 'Georgetown Working Group on Slavery, Memory, and Reconciliation; Georgetown Slavery Archive; GU272 Descendants Association; NYT reporting (Rachel Swarns)',$1,$2,TRUE,TRUE,
                 'Jesuit Conference pledged $100M (2021) toward a $1B goal + $27M (2023) to the Descendants Truth & Reconciliation Foundation; Georgetown reconciliation programs + preferential admission for descendants.',
                 'Documented transaction: 272 enslaved people (of 314 sold 1838-1843) for $115,000 (~$3.3M today), Maryland Jesuits → Henry Johnson & Jesse Batey, Louisiana; proceeds rescued Georgetown from debt. Each of the 272 is NAMED on the articles of agreement (has_names_list=TRUE) — 272 is a documented COUNT, not minted rows. Named individuals minted (secondary): Isaac Hawkins, Cornelius Hawkins, Frank Campbell. Descendant reconstruction: GU272 Descendants Association + DTRF; Georgetown Memory Project traced 10,000+ (est. 12,000-15,000 total).','pending')`,
        [ART_URL, s3key]);
      console.log('  ✓ disclosure: Georgetown University ($115,000; 272 enslaved; 2016 apology; DTRF)');
    } else console.log('  disclosure exists');
  }

  // 4. research_findings
  if (APPLY) {
    const rf = (q, repo, idx, result, hits, note) => pool.query(
      `INSERT INTO research_findings (question, repository, index_searched, result, hit_count, subject_table, subject_id, evidence_note, searched_by)
       VALUES ($1,$2,$3,$4,$5,'unconfirmed_persons',$6,$7,'claude-georgetown-endpoint')`, [q, repo, idx, result, hits, eref['Thomas F. Mulledy']?.subject_id || null, note]);
    await rf('Enslaver wealth → Georgetown University? (capital-path endpoint)', 'Georgetown Slavery Archive / georgetown.edu/slavery', '1838 articles of agreement',
      'hit', 115000, 'HOLDING confirmed: the Maryland Jesuits sold 272 enslaved people (GU272) in 1838 to Louisiana for $115,000 (~$3.3M today), rescuing the debt-ridden college. Signed by two Jesuit Georgetown presidents (Thomas Mulledy, William McSherry); bought by Henry Johnson (ex-LA governor) and Jesse Batey. 314 sold in all 1838-1843.');
    await rf('Did Georgetown formally reckon with the GU272 sale?', 'Georgetown reckoning record (2016-2021)', 'apology + renamings + foundation',
      'hit', 3, 'RECKONING documented: 2016 formal apology; 2017 building renamings (Mulledy Hall → Isaac Hawkins Hall; McSherry Hall → Anne Marie Becraft Hall); 2021 co-founding (with the Jesuits + the GU272 Descendants Association) of the Descendants Truth & Reconciliation Foundation.');
    await rf('Descendants of the GU272? (the organized recipient community)', 'GU272 Descendants Association / Georgetown Memory Project (CITED, not extracted)', 'genealogy + DNA + articles of agreement',
      'hit', 10000, 'AUTHORITATIVE descendant reconstruction by the Georgetown Memory Project (Richard Cellini) + NYT (Rachel Swarns): 10,000+ descendants traced (est. 12,000-15,000 total, living + deceased). Recipient orgs: GU272 Descendants Association; Descendants Truth & Reconciliation Foundation; Isaac Hawkins Legacy Group. American Ancestors hosts the GU272 Memory Project database. Their datasets are THEIRS — cite/collaborate, do not scrape. Living descendants not minted.');
    await rf('Institutional remediation committed by Georgetown / the Jesuits', 'Jesuit Conference + DTRF (public statements)', 'reparations pledges 2021-2023',
      'hit', 127000000, 'Jesuit Conference of Canada & the US pledged $100M (2021) toward a $1B goal; +$27M (2023) to the Descendants Truth & Reconciliation Foundation. Compensation TO the reckoning fund is EVIDENCE OF DEBT (dual-ledger), tracked here, never credited against the descendant obligation.');
    console.log('  ✓ 4 research_findings logged (wealth-flow + reckoning + descendants + remediation)');
  }

  await pool.end();
  console.log('\n=== done — Georgetown = GU272 capital-path modern endpoint (272 sold 1838, DTRF descendant side) ===');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
