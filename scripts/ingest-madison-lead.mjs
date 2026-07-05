#!/usr/bin/env node
/**
 * James Madison will (15 Apr 1835) + codicil (19 Apr 1835) — HELD AS A LEAD, NOT SERVED.
 *
 * Why a lead and not a served canonical (user's own rule, correctly applied):
 *  - We have only a TRANSCRIPTION (text), NOT a scanned document file. The external-assertion gate
 *    requires a real archived file in S3 (s3_key) — a transcription is not that. So: no served canonical.
 *  - Madison FREED NO ONE and NAMED NO ONE: "I give and bequeath my ownership in the negroes and
 *    people of colour held by me to my dear Wife". A `will` is OWNER_CONTENT, so even WITH a scan the
 *    gate needs a named-enslaved ownership edge or a probate enslaved_count>0 — neither exists here.
 *    The named people + count live in a Montpelier slave list, not this will.
 *
 * So we preserve the will as a secondary text document on a LEAD and embed it for RAG (findable
 * internally), ready to promote to a served canonical when BOTH (a) a scanned file and (b) a
 * named-enslaved source arrive. No fabrication; provenance recorded.
 */
import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');
import crypto from 'crypto';

const SRC = 'https://founders.archives.gov/documents/Madison'; // Papers of James Madison / Founders Online (transcription)
const CITE = "James Madison, Original Will (15 Apr 1835) & Codicil (19 Apr 1835), The Papers of James Madison / Founders Online (transcription; original: Orange County, Va. Will Book — scanned file NOT yet held).";
const BY = 'roster_partner_ingest';

// Header (strong retrieval signal) + the enslaved bequest verbatim + the full transcription.
const WILL_TEXT = `[James Madison Will, 15 April 1835 (codicil 19 April 1835), Orange County, Virginia — Madison bequeaths the enslaved people he held to his wife Dolley Madison; he FREES NO ONE and NAMES NO enslaved individual.] Key clause verbatim: "I give and bequeath my ownership in the negroes and people of colour held by me to my dear Wife, but it is my desire that none of them should be sold without his or her consent or in the case of their misbehaviour; except that infant children may be sold with their Parent who consents for them to be sold with him or her, and who consents to be sold."

FULL TRANSCRIPTION:
I James Madison of Orange county do make this my last Will and testament, hereby revoking all Wills by me heretofore made. I devise to my dear Wife during her life, the tract of land whereon I live... I give and bequeath my ownership in the negroes and people of colour held by me to my dear Wife, but it is my desire that none of them should be sold without his or her consent or in the case of their misbehaviour; except that infant children may be sold with their Parent who consents for them to be sold with him or her, and who consents to be sold. I give all my personal estate of every description... to my dear Wife; And I also give to her all my manuscript papers... It is my desire that the Report as made by me [of the 1787 Convention] should be published under her authority and direction... I hereby appoint my dear Wife to be sole executrix of this my Will... this fifteenth day of April one thousand eight hundred and thirty five. James Madison. [Codicil, 19 April 1835: directs the nine thousand dollars and the Grist Mill proceeds, the latter to Ralph Randolph Gurley for the American Colonization Society. James Madison.]`;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const ps = new PersonService(client);

async function main() {
  // idempotency: is there already a roster lead doc for Madison's 1835 will?
  const dup = await client.query(
    `SELECT up.lead_id FROM unconfirmed_persons up
      WHERE up.full_name='James Madison' AND up.source_type='transcription' AND up.birth_year=1751 AND up.created_at > now() - interval '30 days'`);
  if (dup.rows.length) { console.error('ALREADY HELD (James Madison lead #' + dup.rows[0].lead_id + '). Abort.'); client.release(); await pool.end(); process.exit(0); }

  console.log('=== HOLD AS LEAD: James Madison will (1835) — NOT served (no scan, no named enslaved) ===');

  // 1) create / link the lead (President Madison, discrete identity for future promotion)
  const r = await ps.findOrCreateLead({
    name: 'James Madison', birthYear: 1751, deathYear: 1836, location: 'Virginia',
    personType: 'enslaver', sourceUrl: SRC, sourceType: 'transcription',
    confidence: 0.85,
    context: 'James Madison of Orange County (Montpelier), 4th U.S. President. 1835 will bequeaths enslaved people to wife Dolley; frees none, names none. Transcription held; scanned file + Montpelier slave list needed to serve.',
  });
  if (!r.ref || !r.ref.subject_id) { console.error('lead not created:', JSON.stringify(r)); client.release(); await pool.end(); process.exit(1); }
  const leadId = r.ref.subject_id;
  console.log(`[1] lead ${r.action}: unconfirmed_persons#${leadId} (James Madison, enslaver)`);
  if (r.candidates && r.candidates.length) console.log(`    (namesakes seen, NOT merged: ${r.candidates.slice(0,4).map(c=>c.subject_table+'#'+c.subject_id).join(', ')})`);

  // 2) preserve the will as a SECONDARY text document on the lead (s3_key NULL => gated, not served)
  const doc = await client.query(
    `INSERT INTO person_documents
       (unconfirmed_person_id, name_as_appears, document_type, source_url, source_type,
        evidence_strength, document_year, title, ocr_text, human_verified, verified_by, created_by)
     VALUES ($1,'James Madison','will',$2,'transcription','secondary',1835,$3,$4,false,$5,$5)
     ON CONFLICT (COALESCE(canonical_person_id,'-1'::integer), COALESCE(unconfirmed_person_id,'-1'::integer), COALESCE(s3_url,''::text), name_as_appears) DO NOTHING
     RETURNING id`,
    [leadId, SRC, CITE, WILL_TEXT, BY]);
  const docId = doc.rows[0]?.id;
  console.log(`[2] person_documents#${docId} — will transcription preserved (s3_key NULL => GATED, not served)`);

  // 3) embed for RAG (findable internally even though not publicly served)
  let embedded = false;
  if (docId) {
    try {
      const OLL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/embeddings';
      const resp = await fetch(OLL, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ model:'nomic-embed-text', prompt: WILL_TEXT.slice(0,6000) }) });
      const v = (await resp.json()).embedding;
      if (Array.isArray(v) && v.length === 768) {
        await client.query(
          `INSERT INTO embeddings (subject_table,subject_id,content_kind,model,embedding,content_hash)
           VALUES ('person_documents',$1,'doc_ocr','nomic-embed-text',$2::vector,$3)
           ON CONFLICT (subject_table,subject_id,content_kind,model) DO NOTHING`,
          [String(docId), '['+v.join(',')+']', crypto.createHash('sha256').update(WILL_TEXT).digest('hex')]);
        embedded = true;
      }
    } catch (e) { console.log('    embed skipped:', e.message); }
  }
  console.log(`[3] RAG embed: ${embedded ? 'DONE (retrievable internally)' : 'skipped'}`);

  console.log(`\nSTATE: James Madison = LEAD #${leadId} (NOT a canonical, NOT served).`);
  console.log(`TO SERVE, need BOTH: (a) a scanned will/codicil file in S3, AND (b) a named-enslaved source`);
  console.log(`(a Montpelier slave list / estate inventory) to anchor the ownership edge or an enslaved_count.`);
  client.release(); await pool.end();
}
main().catch(async e => { console.error('ERROR:', e.message); try{client.release()}catch{}; try{await pool.end()}catch{}; process.exit(1); });
