#!/usr/bin/env node
/**
 * Alexander Hamilton — GATED canonical from a SECONDARY source + named-enslaved LEADS + RAG enroll.
 *
 * Source: Jessie Serfilippi, "'As Odious and Immoral a Thing': Alexander Hamilton's Hidden History
 * as an Enslaver," Schuyler Mansion State Historic Site (NY State Parks), 2020. This is a SCHOLARLY
 * SECONDARY analysis that assembles Hamilton's enslaver status from ~20 cited PRIMARY documents
 * (his Library of Congress cash books, Founders Online letters, NY Manumission Society minutes, the
 * 1790/1800/1810 censuses, the post-mortem estate inventory). None of those primary files is in S3.
 *
 * THEREFORE (standard-compliant):
 *  - Hamilton = a GATED internal canonical (enslaver). Secondary is enough to CREATE; it does NOT
 *    lift the external-assertion gate (needs a stored PRIMARY doc). assertable_slaveowner stays FALSE.
 *  - Only NAMED enslaved people become leads (Dick, Sarah, Peggy, Ben). Rule 5: no "Unnamed" rows —
 *    the unnamed-but-evidenced people (1781 woman; 1796 woman+boy; Angelica's maid; 1797 woman+child)
 *    are held as DOCUMENT/transaction evidence, not minted as person rows.
 *  - Owner attribution is preserved: only Dick is (inferred) Hamilton's OWN household; Sarah/Ben were
 *    Church's, Peggy was Treat's — Hamilton acted as TRADER/AGENT. Dedup hypotheses recorded, never merged.
 *  - The paper is enrolled into RAG so the whole analysis is retrievable.
 */
import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');
import crypto from 'crypto';

const CITE = "Jessie Serfilippi, \"'As Odious and Immoral a Thing': Alexander Hamilton's Hidden History as an Enslaver,\" Schuyler Mansion State Historic Site (NY State Office of Parks, Recreation & Historic Preservation), 2020.";
const SRC = 'https://parks.ny.gov/historic-sites/33/details.aspx'; // Schuyler Mansion (publisher); paper distributed by the site
const BY = 'roster_partner_ingest';

// Factual header (front-loads RAG signal) + verbatim key passages from the paper.
const PAPER_OCR = `[SECONDARY ANALYSIS] Alexander Hamilton as an ENSLAVER — Jessie Serfilippi, Schuyler Mansion State Historic Site, 2020. Thesis: contra the "abolitionist founder" myth, Hamilton's own cash books and letters show he was a slave TRADER (middleman for family/clients) AND an ENSLAVER (owned people in his own household), and concealed enslaved "servants" from his estate record. Named enslaved/trafficked people in the record: DICK (a boy in Hamilton's household who died of Yellow Fever, 1798 — the first NAMED person enslaved by the Hamiltons; possibly the boy Hamilton bought via Philip Schuyler in 1796); SARAH (enslaved in Maryland, sold to John B. Church, Hamilton was agent; freed 1799 via the NY Manumission Society); PEGGY (a woman Hamilton bought and SOLD to Dr. Malachi Treat, 1784); BEN (Angelica Schuyler Church's enslaved servant, sold to Major Jackson, 1784). Unnamed-but-evidenced enslaved people: a woman bought 1781 from Mrs. Clinton for Eliza; a woman and a boy Hamilton bought for himself via Philip Schuyler, 1796 ($250); a "negro woman and child" bought for John B. Church, 1797 ($225); an enslaved maid bound to Angelica Hamilton, 1798-99; the "Servants" valued at £400 in Hamilton's post-mortem estate inventory, 1804.

Key verbatim passages:
(1781, Hamilton's own) "For some time past I have had a bill on France... to pay the value of the woman Mrs. H[amilton] had of Mrs. Clinton." (AH to George Clinton, 22 May 1781.)
(1784, trader) Hamilton sold a woman named Peggy to Dr. Malachi Treat (cash book, 1782-1791, p.20), recording ninety pounds owed.
(1796, Hamilton's own) "$250 to Philip Schuyler for 2 Negro servants purchased by him for me." (Cash Book 1795-1801, p.7.) — preceded by Schuyler's 31 Aug 1795 letter: "The Negro boy & woman are engaged for you."
(1798, Hamilton's own) Hamilton "received $100.00 for the 'term' of a 'negro boy'" — i.e. leased an enslaved child out for hire (Cash Book 1795-1801, p.75).
(1798, named) Philip Schuyler to Eliza: "...the death of one of your servants from Yellow fever... If I had known of Dick's death before the children had left me they should not have gone." — the first NAMED person enslaved by the Hamilton household.
(1799, Church/agent) NY Manumission Society minutes: "a black woman by the name of Sarah was brought here from the state of Maryland about six years since by a [John] Salmon who sold her to John B. Church, A. Hamilton was agent for Church in the business"; later "Sarah with Church is liberated through the intercession of the Standing Committee."
(1804, estate) Post-mortem inventory (likely by John Barker Church): House £2200; Furniture & library £300; Servants £400 — a monetary value ascribed to enslaved people as estate property; Hamilton "did not leave instructions for them to be freed upon his death."`;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const ps = new PersonService(client);
const parseName = (f) => { const p = String(f).trim().split(/\s+/); return { first: p[0]||'', last: p.length>1?p[p.length-1]:'' }; };

// NAMED enslaved leads only (Rule 5). owner = the person who held them (NOT always Hamilton).
const NAMED = [
  { name: 'Dick', owner: 'Alexander Hamilton (inferred)', role: 'enslaved',
    ctx: 'Boy in the Hamilton household; died of Yellow Fever, 1798 (Philip Schuyler to Eliza). First NAMED person enslaved by the Hamiltons.',
    flags: { name_type: 'recorded_given_name_only', owner_attribution: 'Alexander Hamilton household (INFERRED per Serfilippi)', dedup_hypothesis: 'possibly = the enslaved boy Hamilton purchased via Philip Schuyler in 1796; possibly = the "negro boy" leased in 1798 — NOT auto-merged', death_year: 1798 } },
  { name: 'Sarah', owner: 'John Barker Church', role: 'enslaved',
    ctx: 'Enslaved in Maryland; sold to John B. Church (Hamilton acted as agent); freed 1799 via NY Manumission Society.',
    flags: { name_type: 'recorded_given_name_only', owner_attribution: 'John Barker Church (Hamilton = purchasing agent, NOT owner)', dedup_hypothesis: 'possibly = the "Negro woman" bought for Church for 90£ in June 1797 — NOT auto-merged', outcome: 'manumitted 1799' } },
  { name: 'Peggy', owner: 'Malachi Treat', role: 'enslaved',
    ctx: 'Woman Hamilton bought and SOLD to Dr. Malachi Treat, 1784 (cash book). Hamilton = slave trader/middleman.',
    flags: { name_type: 'recorded_given_name_only', owner_attribution: 'Dr. Malachi Treat (Hamilton = seller/trader, NOT retaining owner)', dedup_warning: 'DISTINCT from "White Peggy" the PAID white servant (1802) and from Margaret "Peggy" Schuyler — do NOT merge' } },
  { name: 'Ben', owner: 'Angelica Schuyler Church', role: 'enslaved',
    ctx: 'Angelica Church\'s enslaved servant; sold to Major Jackson; Angelica sought him back (AH to John Chaloner, 1784).',
    flags: { name_type: 'recorded_given_name_only', owner_attribution: 'Angelica Schuyler Church / Major Jackson (Hamilton = agent)' } },
];

async function main() {
  const dup = await client.query(`SELECT id FROM canonical_persons WHERE created_by=$1 AND canonical_name='Alexander Hamilton' AND birth_year_estimate=1755`, [BY]);
  if (dup.rows.length) { console.error('ALREADY INGESTED (Alexander Hamilton #'+dup.rows[0].id+'). Abort.'); client.release(); await pool.end(); process.exit(0); }

  console.log('=== INGEST: Alexander Hamilton — GATED (secondary source) + named leads + RAG ===');
  await client.query('BEGIN');
  let hId, docId, leadIds = [];
  try {
    // 1) Hamilton — enslaver, GATED (secondary only). b.1755 (disputed vs 1757), d.1804, New York.
    const { first, last } = parseName('Alexander Hamilton');
    const ins = await client.query(
      `INSERT INTO canonical_persons
         (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
          sex, person_type, birth_year_estimate, death_year_estimate, primary_state, primary_county,
          confidence_score, verification_status, created_by, notes)
       VALUES ($1,$2::text,$3::text, soundex($2::text), soundex($3::text), metaphone($3::text,8),
               'm','enslaver',1755,1804,'New York','New York',0.88,'promoted',$4,$5) RETURNING id`,
      ['Alexander Hamilton', first, last, BY, JSON.stringify({ source: 'serfilippi_schuyler_mansion_2020', cite: CITE,
        gate_note: 'SECONDARY source → GATED (assertable_slaveowner stays FALSE until a PRIMARY doc — e.g. a Library of Congress cash-book page — is stored in S3).',
        identity_note: 'Founding Father; b.1755 (disputed, some say 1757), d.1804; enslaver + slave trader per Serfilippi cash-book/letter analysis.' })]);
    hId = ins.rows[0].id;
    await ps._writeBlockingKeys('canonical_persons', hId, { name: 'Alexander Hamilton', sex: 'm', birthYear: 1755 });
    console.log(`[1] canonical#${hId} Alexander Hamilton (enslaver) — created GATED`);

    // 2) the Serfilippi paper as a SECONDARY document (s3_key NULL → does NOT lift the gate)
    const d = await client.query(
      `INSERT INTO person_documents
         (canonical_person_id, name_as_appears, document_type, source_url, source_type, evidence_strength,
          document_year, title, ocr_text, human_verified, verified_by, created_by)
       VALUES ($1,'Alexander Hamilton','research_report',$2,'secondary','secondary',2020,$3,$4,false,$5,$5) RETURNING id`,
      [hId, SRC, CITE, PAPER_OCR, BY]);
    docId = d.rows[0].id;
    console.log(`[2] person_documents#${docId} — Serfilippi paper (secondary; s3_key NULL → GATED)`);

    // 3) named enslaved LEADS (Rule 5: named only). Owner attribution preserved; dedup hypotheses recorded.
    for (const n of NAMED) {
      const r = await ps.findOrCreateLead({
        name: n.name, personType: 'enslaved', location: 'New York', sourceUrl: SRC, sourceType: 'secondary',
        confidence: 0.55, context: `${n.ctx} [owner: ${n.owner}] Source: ${CITE}`, dataQualityFlags: n.flags,
      });
      if (r.ref && r.ref.subject_id) { leadIds.push({ id: r.ref.subject_id, n }); console.log(`[3] lead ${r.action}: unconfirmed_persons#${r.ref.subject_id} — ${n.name} (enslaved; owner=${n.owner})`); }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }

  // 4) recompute gate — MUST be FALSE (secondary only)
  const g = await ps.recomputeGate(hId);
  console.log(`\n[4] recomputeGate → assertable_slaveowner=${g.assertable_slaveowner} (expected FALSE — gated, secondary only)`);

  // 5) enroll the paper into RAG
  let embedded = false;
  try {
    const OLL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/embeddings';
    const resp = await fetch(OLL, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ model:'nomic-embed-text', prompt: PAPER_OCR.slice(0,6000) }) });
    const v = (await resp.json()).embedding;
    if (Array.isArray(v) && v.length === 768) {
      await client.query(
        `INSERT INTO embeddings (subject_table,subject_id,content_kind,model,embedding,content_hash)
         VALUES ('person_documents',$1,'doc_ocr','nomic-embed-text',$2::vector,$3)
         ON CONFLICT (subject_table,subject_id,content_kind,model) DO NOTHING`,
        [String(docId), '['+v.join(',')+']', crypto.createHash('sha256').update(PAPER_OCR).digest('hex')]);
      embedded = true;
    }
  } catch (e) { console.log('    embed skipped:', e.message); }
  console.log(`[5] RAG enroll: ${embedded ? 'DONE (Hamilton analysis retrievable)' : 'skipped'}`);

  console.log(`\nSTATE: Alexander Hamilton = canonical#${hId} — INTERNAL, GATED, NOT served.`);
  console.log(`Named leads: ${leadIds.map(x=>'#'+x.id+' '+x.n.name).join(', ')}`);
  console.log(`TO SERVE Hamilton: store a PRIMARY doc in S3 — a Library of Congress cash-book page image`);
  console.log(`(the 1796 "$250... 2 Negro servants... for me" entry = a purchase record) typed bill_of_sale/ledger.`);
  client.release(); await pool.end();
}
main().catch(async e => { console.error('ERROR:', e.message); try{await client.query('ROLLBACK')}catch{}; try{client.release()}catch{}; try{await pool.end()}catch{}; process.exit(1); });
