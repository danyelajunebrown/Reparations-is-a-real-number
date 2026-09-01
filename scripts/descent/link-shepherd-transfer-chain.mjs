// link-shepherd-transfer-chain.mjs — the two-owner chain on John and Andrew Shepherd, graded per link.
//
// THE FACT PATTERN (Freedmen's Bureau, Amelia C.H., Letters Received, p.91, 28 Feb 1868)
//   Daniel Shepherd, a freedman, reports that BEFORE the war his two children John and Andrew were sold to
//   GEORGE PANNON of Orange Co, Va; and that he has RECENTLY HEARD they were sold on, during the first part
//   of the war, to JAMES FISHER of Powhatan Co, Va. He asks the Bureau to help find his children.
//   The Bureau's own endorsement replies: "no man by the name of James Fisher has lived in Powhatan Co. Va.
//   at any time during or since the War, and no such children as John and Andrew Shepherd can be heard of."
//
// WHY THIS IS WORTH BUILDING CAREFULLY
//   A chain of title on NAMED CHILDREN is the continuity-of-holding thesis applied to people rather than to
//   property, and it is rare: most sources give a holder or nothing. This one gives two — and then the
//   investigating agency's failure to corroborate the second.
//
// THE TWO LINKS ARE NOT EQUALLY EVIDENCED, AND ARE THEREFORE NOT STORED IN THE SAME PLACE
//   LINK 1  (? -> Pannon)  A father's direct testimony about his own children. -> chattel_transfer_events.
//   LINK 2  (Pannon -> Fisher)  Explicitly hearsay in the source ("he has heard that"), AND actively
//           disconfirmed by the Bureau's search. -> research_findings, NOT a transfer row.
//
//   `chattel_transfer_events` has no information_type / informant_role and no disputed flag; its 48,985
//   existing rows are PRICED, documented transfers, and the obligation ledger reads that table as
//   `principal_basis='transaction_documented'`. Writing a disconfirmed hearsay sale into it at confidence
//   0.40 would put a claim the Bureau could not verify one join away from a dollar figure on a DAA, where
//   nothing downstream reads source_citation before summing. Audit rule 5 (no fabricated data) and audit
//   rule 1 (deterministic code computes; the model does not decide) both point the same way: the claim is
//   preserved in full, with its verbatim quote, in the table meant for unresolved questions.
//
//   This is a judgement, not a rule handed down — it is recorded here so it can be overruled deliberately.
//
// Usage: node scripts/descent/link-shepherd-transfer-chain.mjs [--apply]

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const CITATION = "Freedmen's Bureau, Amelia C.H. field office (5th Div, 2nd Sub-Dist VA), Register of Letters Received 1867-68, p.91 (rec'd 28 Feb 1868, James Johnson S.A. Comr., Fredericksburg)";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  const lead = async (n) => (await pool.query(
    `SELECT lead_id FROM unconfirmed_persons WHERE full_name = $1 AND lead_id BETWEEN 3652713 AND 3652740`, [n])).rows[0]?.lead_id ?? null;
  const [john, andrew, pannon, fisher, daniel] =
    await Promise.all(['John Shepherd', 'Andrew Shepherd', 'George Pannon', 'James Fisher', 'Daniel Shepherd'].map(lead));
  const doc = (await pool.query(
    `SELECT id FROM person_documents WHERE collection_key='amelia_freedmens_letters' AND collection_page_number=91`)).rows[0]?.id ?? null;
  console.log(`leads: John=${john} Andrew=${andrew} Pannon=${pannon} Fisher=${fisher} Daniel=${daniel} · doc=${doc}`);
  if (!john || !andrew || !pannon || !doc) { console.error('missing prerequisite rows'); process.exit(1); }

  // ── LINK 1: sale to George Pannon, testified to by the father ────────────────────────────────────────
  for (const [name, id] of [['John Shepherd', john], ['Andrew Shepherd', andrew]]) {
    if (!APPLY) { console.log(`  would write transfer: ${name} -> George Pannon (Orange Co VA, pre-1861) conf 0.85`); continue; }
    const dup = await pool.query(
      `SELECT 1 FROM chattel_transfer_events WHERE enslaved_name_text=$1 AND to_enslaver_name='George Pannon'`, [name]);
    if (dup.rows.length) { console.log(`  (exists) ${name} -> Pannon`); continue; }
    await pool.query(
      // SCHEMA LIMIT, recorded rather than worked around silently: all three person FKs on this table
      // reference canonical_persons, but RULE 0.6 keeps new people as LEADS until they are image-backed.
      // So a documented transfer between un-promoted people cannot carry its person ids at all — the names
      // go in as text and the join is lost. The lead ids are preserved in source_citation so the link can
      // be restored when these four are promoted. This is a real gap in the instrument, not a data problem.
      `INSERT INTO chattel_transfer_events
         (id, enslaved_person_id, enslaved_name_text, to_enslaver_id, to_enslaver_name, transfer_type,
          transfer_year, place_state, place_locality, source_table, source_external_id, source_citation, confidence)
       VALUES (gen_random_uuid(), NULL, $1, NULL, 'George Pannon', 'sale', NULL, 'Virginia', 'Orange County',
               'person_documents', $3, $2, 0.85)`,
      [name,
       `${CITATION}. Verbatim: "prior to the war his two children, John Shepherd and Andrew Shepherd, were sold to George Pannon of Orange Co Va". Informant: Daniel Shepherd, the father (direct knowledge). Price NOT stated in the source — the transfer is documented, the consideration is not. UNLINKED IDS (FKs are canonical-only; these are leads): enslaved=unconfirmed_persons#${id}, to_enslaver=unconfirmed_persons#${pannon}, father=unconfirmed_persons#${daniel}, source doc=person_documents#${doc}.`,
       `amelia-p91:${name.replace(/\s+/g, '-').toLowerCase()}`]);
    console.log(`  ✓ transfer written: ${name} -> George Pannon`);
  }

  // ── LINK 2: the reported onward sale to James Fisher — hearsay, and disconfirmed ─────────────────────
  const q = 'Were John and Andrew Shepherd sold on from George Pannon to James Fisher of Powhatan Co, Va during the war?';
  if (!APPLY) {
    console.log('  would write research_finding (result=none): reported Pannon -> James Fisher sale, Bureau found no such person');
  } else {
    const dup = await pool.query(`SELECT 1 FROM research_findings WHERE question = $1`, [q]);
    if (!dup.rows.length) {
      await pool.query(
        `INSERT INTO research_findings
           (question, repository, index_searched, result, hit_count, subject_table, subject_id, evidence_note, searched_by)
         VALUES ($1, $2, $3, 'none', 0, 'person_documents', $4, $5, 'descent/shepherd-transfer-chain')`,
        [q,
         "Freedmen's Bureau, 5th Div 2nd Sub-Dist VA (Amelia C.H.) — agency search on behalf of the claimant",
         'Register of Letters Received 1867-68, p.91-92 endorsement',
         doc,
         `CLAIM (hearsay, in the source's own words): "recently he has heard that the children were, during the first part of the War, sold to James Fisher of Powhatan Co Va." DISCONFIRMATION by the investigating agency: "no man by the name of James Fisher has lived in Powhatan Co. Va. at any time during or since the War, and no such children as John and Andrew Shepherd can be heard of." — J.B. Clinton, A.S.A. Comr., 6 Mar 1868. NOT written as a chattel_transfer_events row: the second link is hearsay that the Bureau actively failed to corroborate, and that table feeds principal_basis='transaction_documented'. Also note: 13 distinct "James Fisher" leads exist in the corpus; resolving this name to any of them would be the Biscoe-forbidden name-only merge, and the correct answer may be that none of them is the man. ${CITATION}`]);
      console.log('  ✓ research_finding written: Fisher link recorded as searched-and-not-found');
    } else console.log('  (exists) Fisher research_finding');
  }

  if (APPLY) {
    const t = await pool.query(`SELECT count(*)::int n FROM chattel_transfer_events WHERE source_table='person_documents'`);
    console.log(`\nchattel_transfer_events sourced from documents: ${t.rows[0].n}`);
  }
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
