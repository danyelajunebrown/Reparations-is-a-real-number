// ingest-duncan-will.mjs — verified add of Dr. Stephen Duncan (Natchez, MS, 1787–1867) from TWO
// user-provided sources, each ingested at its HONEST evidence tier (no fabrication):
//
//  A) 1866 Last Will & Testament (Adams County MS Chancery Court certified copy — TRANSCRIPTION).
//     Post-13th-Amendment → does NOT evidence enslaved holding (evidences_enslaved_holding=FALSE).
//     Establishes: verified identity; formerly-enslaved servants (Frank Smith, Susan Collins, Kerby
//     Collins) left annuities → leads; and wealth-tracing (12 Washington Square NYC + 250 sh NY Central
//     RR $30k + 250 pref Erie RR $25k via the Leverich trust).
//
//  B) LSU LLMVC finding aid — Stephen Duncan Correspondence, Mss. 1431/1551/1595/1793 (SCHOLARLY).
//     Explicitly indexes "Slaveholders—Mississippi", names 14 plantations, and describes a daybook with
//     "lists of slaves present at Homochitto Plantation, lists of slaves purchased in 1819." THIS is the
//     document that supports the slaveowner assertion (evidences_enslaved_holding=TRUE, tier=secondary/
//     scholarly). GOLD follow-on = the actual slave-list SCAN (LSU daybook Mss.1431 microfilm, or the
//     1860 U.S. Slave Schedule for Adams/Issaquena on FamilySearch).
//
// Usage: node scripts/ingest-duncan-will.mjs --apply

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const WILL_URL = 'USER-PROVIDED transcription — Adams County MS Chancery Court will of Stephen Duncan, 1866 (certified by clerk John F. Jenkins); source URL pending';
const LSU_URL = 'https://www.lib.lsu.edu/special/findaid — Stephen Duncan Correspondence, Mss. 1431, 1551, 1595, 1793, Louisiana and Lower Mississippi Valley Collections, LSU Libraries, Baton Rouge, La.';

const PLANTATIONS = "L'Argent, Auburn, Camperdown, Carlisle, Duncan, Duncannon, Duncansby, Ellisle, Homochitto, Middlesex, Oakley, Rescue, Reserve, Attakapas";
const NOTES = `Dr. Stephen Duncan (1787–1867), planter & banker of Natchez, Mississippi — among the largest US cotton planters. Plantations: ${PLANTATIONS} (Adams & Issaquena Cos. MS; Tensas & St. Mary Parishes LA). Wives: Margaret Ellis (d.1815; children John Ellis & Sarah Jane Duncan); Catharine A. Bingaman (m.1819; children Stephen Jr., Charlotte N., M.L./Maria L., Henry P. Duncan). WEALTH-TRACING (1866 will): 12 Washington Square NYC; 250 sh New York Central RR ($30k); 250 pref sh Erie RR ($25k); Leverich-brothers trust ($15k/yr annuity) — slavery fortune → NYC real estate + railroads. Possible dup of #79380 (LA Hall import) — dedup review.`;

const WILL_TEXT = `Last Will & Testament of Stephen Duncan, "late of Natchez in the State of Mississippi now an inhabitant of ... the city, county and state of New York", executed 28 Sep 1866; certified true copy by John F. Jenkins, clerk of the Chancery Court, Adams County, Mississippi. Wife Catharine A. Duncan (12 Washington Square NYC). Leverich trust (Charles P. & Henry S. Leverich): $15,000/yr annuity; 250 sh NY Central RR ($30k) + 250 pref Erie RR ($25k). Residuary estate to five children. $150/yr annuities to "old and faithful servant Frank Smith" and "devoted and faithful servant Susan Collins" (who pays $50/yr to grandmother Kerby Collins). Executors: sons Henry P., Samuel P., Stephen Jr.; sons-in-law Samuel L. Davis, Julius J. Pringle.`;

const LSU_TEXT = `LSU LLMVC finding aid — Stephen Duncan Correspondence, Mss. 1431/1551/1595/1793 (1817–1877). Biographical note: "Stephen Duncan was a planter and banker of Natchez, Mississippi." Plantations: ${PLANTATIONS}. Scope: Chapitoulas Plantation daybook (1817–1822, 1826) includes "lists of slaves present at the Homochitto Plantation, lists of slaves purchased in 1819." Index terms include "Slaveholders—Mississippi", "Plantation owners—Mississippi", "Freedmen—Mississippi", "Duncan, Stephen, 1787-1867." Citation: Louisiana and Lower Mississippi Valley Collections, LSU Libraries, Baton Rouge, La.`;

const SERVANTS = [
  ['Frank Smith', 'Named in Stephen Duncan\'s 1866 will as "old and faithful servant", left a $150/yr annuity — formerly enslaved by Duncan (Natchez, MS).'],
  ['Susan Collins', 'Named in Stephen Duncan\'s 1866 will as "devoted and faithful servant", left a $150/yr annuity; directed to pay $50/yr to her grandmother Kerby Collins — formerly enslaved by Duncan.'],
  ['Kerby Collins', 'Grandmother of Susan Collins; to receive $50/yr per Stephen Duncan\'s 1866 will — formerly enslaved (Natchez, MS).'],
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  if (!APPLY) { console.log('[DRY-RUN]'); await pool.end(); return; }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let duncan = (await c.query(`SELECT id FROM canonical_persons WHERE canonical_name ILIKE 'Stephen Duncan' AND primary_county ILIKE 'Adams' AND created_by='roster_partner_ingest' LIMIT 1`)).rows[0]?.id;
    if (!duncan) {
      duncan = (await c.query(
        `INSERT INTO canonical_persons (canonical_name, first_name, last_name, first_name_soundex, last_name_soundex, last_name_metaphone,
            sex, person_type, birth_year_estimate, death_year_estimate, primary_state, primary_county, confidence_score, verification_status, created_by, notes)
         VALUES ('Stephen Duncan','Stephen','Duncan', soundex('Stephen'), soundex('Duncan'), metaphone('Duncan',8),
            'm','enslaver',1787,1867,'Mississippi','Adams',0.95,'verified','roster_partner_ingest',$1) RETURNING id`, [NOTES])).rows[0].id;
      await c.query(`INSERT INTO person_blocking_keys (subject_table, subject_id, canonical_person_id, key_type, key_value)
        SELECT 'canonical_persons',$1,$1,k.key_type,k.key_value FROM derive_blocking_keys('Stephen Duncan','m',1787) k ON CONFLICT DO NOTHING`, [duncan]);
    } else {
      await c.query(`UPDATE canonical_persons SET notes=$2, verification_status='verified', confidence_score=0.95 WHERE id=$1`, [duncan, NOTES]);
    }
    // A) will — transcription, post-emancipation → NOT holding evidence
    await c.query(`INSERT INTO person_documents (canonical_person_id, name_as_appears, document_type, source_url, source_type, evidence_strength, document_year, ocr_text, evidences_enslaved_holding, created_by)
       VALUES ($1,'Stephen Duncan','will',$2,'secondary','secondary',1866,$3,FALSE,'roster_partner_ingest') ON CONFLICT DO NOTHING`, [duncan, WILL_URL, WILL_TEXT]);
    // B) LSU finding aid — scholarly attestation of slaveholding → DOES evidence holding
    await c.query(`INSERT INTO person_documents (canonical_person_id, name_as_appears, document_type, source_url, source_type, evidence_strength, document_year, ocr_text, evidences_enslaved_holding, created_by)
       VALUES ($1,'Stephen Duncan, 1787-1867','finding_aid',$2,'secondary','secondary',2011,$3,TRUE,'roster_partner_ingest') ON CONFLICT DO NOTHING`, [duncan, LSU_URL, LSU_TEXT]);
    // gate: documented slaveholding (finding aid) → assertable_slaveowner
    await c.query(`UPDATE canonical_persons SET assertable_slaveowner = TRUE
        WHERE id=$1 AND EXISTS(SELECT 1 FROM person_documents d WHERE d.canonical_person_id=$1 AND d.evidences_enslaved_holding)`, [duncan]);
    // formerly-enslaved persons named in the will → leads
    let servs = 0;
    for (const [name, ctx] of SERVANTS) {
      const lid = (await c.query(`INSERT INTO unconfirmed_persons (full_name, person_type, locations, context_text, source_url, source_type, extraction_method, confidence_score, created_at)
         VALUES ($1,'freedperson', ARRAY['Natchez','Mississippi'], $2, $3, 'secondary','will_named_servant',0.6, now()) RETURNING lead_id`, [name, ctx, WILL_URL])).rows[0].lead_id;
      await c.query(`INSERT INTO person_external_ids (subject_table, subject_id, unconfirmed_person_id, id_system, external_id, confidence)
        VALUES ('unconfirmed_persons',$1,$1,'duncan_will_1866',$2,0.6) ON CONFLICT (id_system, external_id) DO NOTHING`, [lid, 'duncanwill:' + name.toLowerCase().replace(/[^a-z]/g, '')]);
      servs++;
    }
    await c.query('COMMIT');
    const g = (await pool.query('SELECT assertable_slaveowner FROM canonical_persons WHERE id=$1', [duncan])).rows[0];
    console.log(`✓ Duncan canonical #${duncan} — assertable_slaveowner=${g.assertable_slaveowner}`);
    console.log(`  docs: 1866 will (transcription, evidences_holding=FALSE) + LSU finding aid (scholarly, evidences_holding=TRUE)`);
    console.log(`  ${servs} formerly-enslaved leads (Frank Smith, Susan Collins, Kerby Collins)`);
    console.log(`  GOLD follow-on for RULE 0.6 image: LSU daybook slave-lists (Mss.1431 microfilm) OR 1860 Slave Schedule scan.`);
  } catch (e) { await c.query('ROLLBACK'); console.error('ROLLBACK:', e.message); }
  finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
