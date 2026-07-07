// ingest-duncan-will.mjs — verified add of Dr. Stephen Duncan (Natchez, MS) from his 1866 will.
// AUDIT-GRADE HONESTY:
//   • The will is a TRANSCRIPTION (Adams County MS Chancery Court copy), not a scan → evidence_strength
//     'secondary', NO s3_key. It does NOT satisfy RULE 0.6's image bar; the 1860 Slave Schedule scan does.
//   • It is an 1866 (POST-13th-Amendment) will → it does NOT evidence enslaved holding
//     (evidences_enslaved_holding=FALSE). The assertable-slaveowner gate stays SHUT until the antebellum
//     slaveholding document (1860 schedule) is attached. No flag without real evidence.
// What it legitimately establishes: the verified identity; two named formerly-enslaved servants (leads);
// and the post-war wealth (NYC real estate + NY Central/Erie RR stock via the Leverich trust) — the
// slavery→real-estate→railroads continuity.
//
// Usage: node scripts/ingest-duncan-will.mjs --apply [--source-url <url>]

import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const su = A.indexOf('--source-url'); const SOURCE_URL = su > -1 ? A[su + 1] : 'USER-PROVIDED transcription — Adams County MS Chancery Court will of Stephen Duncan, 1866 (source URL pending)';

const WILL_TEXT = `Last Will and Testament of Stephen Duncan of the city, county and state of New York. "I Stephen Duncan, late of Natchez in the State of Mississippi now an inhabitant of and resident in the city, county and state of New York…" Executed 28 September 1866; certified true copy by John F. Jenkins, clerk of the Chancery Court, Adams County, Mississippi. Wife Catharine A. Duncan (12 Washington Square, NYC + paintings/furniture; Bingaman chancery decree ~$20,000). Trust to Charles P. & Henry S. Leverich (deed 7 Jun 1864, amended 5 Oct 1865 and 20 Sep 1866): annuity raised to $15,000/yr for wife; consideration incl. 250 shares New York Central Railroad ($30,000) and 250 preferred shares Erie Railroad Company ($25,000) transferred to wife. Residuary estate to five children — Henry P. Duncan, Samuel Duncan, Stephen Duncan Jr., Charlotte B. Davis, Maria L. Pringle (per stirpes); grandchildren Margaret & Sarah (children of deceased daughter Sarah Irvine) provided via separate Leverich trust. Annuities of $150/yr each to "old and faithful servant Frank Smith" and "devoted and faithful servant Susan Collins" (Susan to pay $50/yr to her aged grandmother Kerby Collins). Executors: sons Henry P., Samuel P., Stephen Duncan Jr. and sons-in-law Samuel L. Davis and Julius J. Pringle.`;

// Formerly-enslaved persons NAMED in the will (annuitants — served Duncan; by 1866 free wage-servants).
const SERVANTS = [
  { name: 'Frank Smith', ctx: 'Named in Stephen Duncan\'s 1866 will as "old and faithful servant" left a $150/yr annuity; almost certainly formerly enslaved by Duncan (Natchez, MS).' },
  { name: 'Susan Collins', ctx: 'Named in Stephen Duncan\'s 1866 will as "devoted and faithful servant" left a $150/yr annuity; directed to pay $50/yr to her grandmother Kerby Collins. Almost certainly formerly enslaved by Duncan.' },
  { name: 'Kerby Collins', ctx: 'Grandmother of Susan Collins; named in Stephen Duncan\'s 1866 will to receive $50/yr. Formerly enslaved (Natchez, MS).' },
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  if (!APPLY) { console.log('[DRY-RUN] pass --apply to write'); await pool.end(); return; }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // 1) verified Duncan canonical (dedup-safe: SELECT-first on a tight identity, else create)
    let duncan = (await c.query(
      `SELECT id FROM canonical_persons WHERE canonical_name ILIKE 'Stephen Duncan'
         AND (primary_county ILIKE 'Adams' OR primary_state ILIKE 'Mississippi') AND created_by='roster_partner_ingest' LIMIT 1`)).rows[0]?.id;
    if (!duncan) {
      duncan = (await c.query(
        `INSERT INTO canonical_persons (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
            sex, person_type, birth_year_estimate, death_year_estimate, primary_state, primary_county, confidence_score, verification_status, created_by, notes)
         VALUES ('Stephen Duncan','Stephen','Duncan', soundex('Stephen'), soundex('Duncan'), metaphone('Duncan',8),
            'm','enslaver',1787,1867,'Mississippi','Adams',0.95,'verified','roster_partner_ingest',
            'Dr. Stephen Duncan of Natchez — one of the largest US cotton planters; plantations in Adams & Issaquena Cos. MS and Tensas & St. Mary Parishes LA. WEALTH-TRACING (from 1866 will): 12 Washington Square NYC real estate; 250 sh New York Central RR ($30k); 250 preferred sh Erie RR ($25k); Leverich-brothers trust ($15k/yr annuity). Assertable-slaveowner gate PENDING his 1860 Slave Schedule scan. Possible dup of #79380 (LA Hall import) — dedup review.')
         RETURNING id`)).rows[0].id;
      await c.query(`INSERT INTO person_blocking_keys (subject_table, subject_id, canonical_person_id, key_type, key_value)
        SELECT 'canonical_persons',$1,$1,k.key_type,k.key_value FROM derive_blocking_keys('Stephen Duncan','m',1787) k
        ON CONFLICT DO NOTHING`, [duncan]);
    }
    // 2) the will as a TRANSCRIPTION document (honest tier; NO s3_key; evidences_enslaved_holding=FALSE)
    await c.query(
      `INSERT INTO person_documents (canonical_person_id, name_as_appears, document_type, source_url, source_type,
          evidence_strength, document_year, ocr_text, evidences_enslaved_holding, created_by)
       VALUES ($1,'Stephen Duncan','will',$2,'secondary','secondary',1866,$3,FALSE,'roster_partner_ingest')
       ON CONFLICT DO NOTHING`, [duncan, SOURCE_URL, WILL_TEXT]);
    // 3) formerly-enslaved persons named in the will → leads, linked to Duncan
    let servs = 0;
    for (const s of SERVANTS) {
      const lid = (await c.query(
        `INSERT INTO unconfirmed_persons (full_name, person_type, locations, context_text, source_url, source_type, extraction_method, confidence_score, created_at)
         VALUES ($1,'formerly_enslaved', ARRAY['Natchez','Mississippi'], $2, $3, 'secondary','will_named_servant',0.6, now()) RETURNING lead_id`,
        [s.name, s.ctx, SOURCE_URL])).rows[0].lead_id;
      await c.query(`INSERT INTO person_external_ids (subject_table, subject_id, unconfirmed_person_id, id_system, external_id, confidence)
        VALUES ('unconfirmed_persons',$1,$1,'duncan_will_1866',$2,0.6) ON CONFLICT (id_system, external_id) DO NOTHING`, [lid, 'duncanwill:' + s.name.toLowerCase().replace(/[^a-z]/g, '')]);
      servs++;
    }
    await c.query('COMMIT');
    console.log(`✓ Duncan canonical #${duncan} | will transcription attached (evidences_holding=FALSE, no scan) | ${servs} formerly-enslaved servant leads`);
    console.log('  GATE: NOT assertable — needs the 1860 Slave Schedule scan (FamilySearch, Mini). Provenance: set --source-url + Wayback.');
  } catch (e) { await c.query('ROLLBACK'); console.error('ROLLBACK:', e.message); }
  finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
