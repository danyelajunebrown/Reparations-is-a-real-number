// link-amelia-freedmens-kin.mjs — write the kinship the Amelia C.H. Freedmen's Bureau letters STATE.
//
// WHY
//   ingest-amelia-freedmens-letters.mjs created 28 leads and 10 harm_events out of these letters, and ZERO
//   family edges — although the letters name parents, children, spouses and siblings outright. The people
//   went in; the relationships, which are the whole reason a Freedmen's Bureau letter matters to a lineage,
//   did not.
//
// WHY THESE LETTERS ARE THE CORRIDOR
//   Dated 1867-68 — after the 1865 wall — they state enslaved-era kinship retrospectively AND give the
//   freedperson's post-emancipation surname and county. Harriet Walthall's four children are recorded as
//   Mary Fields, Sally Fields, Wm Robison and Tom Robison: one mother, three surnames, because surnames
//   tracked former holders. NO name-matching procedure can assemble that family. The document simply says
//   it. That is the argument for descent-from-documents in a single row.
//
// EVIDENCE GRADING IS PER EDGE, NOT PER SOURCE (M127)
//   These letters are not uniformly reliable, and flattening them to one confidence would launder the weak
//   ones — the same defect the DAA identity gate caught when name_only_match was re-stamped 0.90.
//     * A father stating his own children were sold      -> primary,   informant_role='parent'
//     * A Bureau agent relaying names from another office-> secondary, informant_role='bureau_agent'
//     * A neighbour's deathbed account of a family       -> secondary, informant_role='witness'
//   Every edge carries source_document_id pointing at the archived scan, and NONE is written verified=true:
//   single-record kinship is a CANDIDATE for human confirmation (Biscoe), never an auto-confirmation.
//
// Usage:  node scripts/descent/link-amelia-freedmens-kin.mjs [--apply]
//
// NOT INCLUDED, deliberately: John/Andrew Shepherd's second holder (James Fisher). The Bureau's own
// endorsement reports that no such man lived in Powhatan Co and the children could not be found. That is a
// documented DEAD END and belongs in research_findings, not in an edge. See step 3 (the transfer chain).

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const PRODUCER = 'descent/amelia-freedmens-kin';

// Every row below is transcribed from the archived scan named in `page`. `a` is the senior party
// (parent / the person whose relationship is asserted); `b` the junior. Verbatim support in `quote`.
const EDGES = [
  { a: 'Daniel Shepherd', b: 'John Shepherd', rel: 'parent_of', page: 91,
    info: 'primary', role: 'parent', conf: 0.90,
    quote: 'Daniel Shepherd (cold) states that prior to the war his two children, John Shepherd and Andrew Shepherd, were sold to George Pannon of Orange Co Va' },
  { a: 'Daniel Shepherd', b: 'Andrew Shepherd', rel: 'parent_of', page: 91,
    info: 'primary', role: 'parent', conf: 0.90,
    quote: 'his two children, John Shepherd and Andrew Shepherd' },
  { a: 'John Shepherd', b: 'Andrew Shepherd', rel: 'sibling_of', page: 91,
    info: 'primary', role: 'parent', conf: 0.90,
    quote: 'his two children, John Shepherd and Andrew Shepherd — named together as siblings by their father' },

  // Harriet Walthall: the children are named in the Bureau's ENDORSEMENT (an agent relaying a report from
  // the Petersburg sub-district), not by Harriet herself — hence secondary, informant_role='bureau_agent'.
  { a: 'Harriet Walthall', b: 'Mary Fields', rel: 'parent_of', page: 77,
    info: 'secondary', role: 'bureau_agent', conf: 0.75,
    quote: 'Harriet Walthall has four children in Petersburg named Mary Fields, Sally Fields, Wm Robison, & Tom Robison' },
  { a: 'Harriet Walthall', b: 'Sally Fields', rel: 'parent_of', page: 77,
    info: 'secondary', role: 'bureau_agent', conf: 0.75, quote: 'four children ... Sally Fields' },
  { a: 'Harriet Walthall', b: 'Wm Robison', rel: 'parent_of', page: 77,
    info: 'secondary', role: 'bureau_agent', conf: 0.75, quote: 'four children ... Wm Robison' },
  { a: 'Harriet Walthall', b: 'Tom Robison', rel: 'parent_of', page: 77,
    info: 'secondary', role: 'bureau_agent', conf: 0.75, quote: 'four children ... Tom Robison' },
  { a: 'Harriet Walthall', b: 'Sally Miller', rel: 'sibling_of', page: 77,
    info: 'secondary', role: 'bureau_agent', conf: 0.75,
    quote: 'Sally Miller is willing to contribute to the support of her sister' },

  // Lizzie Jackson. Paternity is NOT in dispute between the parties — Jeter contests the MARRIAGE
  // ("he never married her Mother so she is an illegitimate child"), which concedes that Andrew Jackson is
  // the father. A fact both sides assert is stronger than a fact only one side asserts.
  { a: 'Andrew Jackson', b: 'Lizzie Jackson', rel: 'parent_of', page: 121,
    info: 'primary', role: 'parent', conf: 0.90,
    quote: 'The father, Andrew Jackson, gave $5.00 to a Mrs. John Jeter about a year ago to have his daughter Lizzie sent to him' },

  // George Parker & Lucy Howell — stated in Parker's own forwarded statement.
  { a: 'George Parker', b: 'Lucy Howell', rel: 'spouse', page: 135,
    info: 'primary', role: 'self', conf: 0.90,
    quote: 'he was a slave prior to the war, and his wife and five children were free; he purchased some property in his wife\'s name' },

  // Fanny Greene's children — named by Mary Burton (a neighbour present at the death) and by R. D. Carter,
  // who took the children. Witness testimony, and Carter is an interested party: secondary, 0.70.
  { a: 'Fanny Greene', b: 'Miles', rel: 'parent_of', page: 141,
    info: 'secondary', role: 'witness', conf: 0.70,
    quote: 'She gave Miles & Robert to Mr. Carter, saying she did not want them separated' },
  { a: 'Fanny Greene', b: 'Robert', rel: 'parent_of', page: 141,
    info: 'secondary', role: 'witness', conf: 0.70, quote: 'She gave Miles & Robert to Mr. Carter' },
  { a: 'Fanny Greene', b: 'Lucy', rel: 'parent_of', page: 141,
    info: 'secondary', role: 'witness', conf: 0.70,
    quote: 'She gave Lavinia Williams Lucy, as they would all be together' },
  { a: 'Miles', b: 'Robert', rel: 'sibling_of', page: 141,
    info: 'secondary', role: 'witness', conf: 0.70, quote: 'Miles & Robert ... she did not want them separated' },
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  // Resolve names ONLY among the leads this ingest created. Same corpus-membership discipline the Farm Book
  // run needed after it attached five Monticello children to an enslaved woman in Louisiana on a shared
  // mononym. "Lucy" and "Robert" are exactly the kind of name that collides across 3.2M leads.
  const leads = (await pool.query(
    `SELECT lead_id, full_name FROM unconfirmed_persons
      WHERE lead_id BETWEEN 3652710 AND 3652745 AND source_url ILIKE '%familysearch%' OR lead_id BETWEEN 3652713 AND 3652740`)).rows;
  const byName = new Map();
  for (const l of leads) if (!byName.has(l.full_name)) byName.set(l.full_name, l.lead_id);

  const docs = (await pool.query(
    `SELECT id, collection_page_number pg FROM person_documents
      WHERE collection_key = 'amelia_freedmens_letters' AND collection_page_number IS NOT NULL`)).rows;
  const docByPage = new Map();
  for (const d of docs) if (!docByPage.has(d.pg)) docByPage.set(d.pg, d.id);

  let written = 0, skipped = 0;
  for (const e of EDGES) {
    const aId = byName.get(e.a), bId = byName.get(e.b);
    const docId = docByPage.get(e.page) || docByPage.get(e.page - 1);
    if (!aId || !bId) { console.log(`  SKIP ${e.a} -${e.rel}-> ${e.b}: ${!aId ? 'no lead for ' + e.a : 'no lead for ' + e.b}`); skipped++; continue; }
    if (!docId) { console.log(`  SKIP ${e.a} -${e.rel}-> ${e.b}: no archived scan for p.${e.page}`); skipped++; continue; }

    if (!APPLY) { console.log(`  would write ${e.a} -${e.rel}-> ${e.b}  [${e.info}/${e.role} ${e.conf}] doc#${docId}`); written++; continue; }

    const dup = await pool.query(
      `SELECT 1 FROM canonical_family_edges WHERE a_subject_table='unconfirmed_persons' AND a_subject_id=$1
         AND b_subject_table='unconfirmed_persons' AND b_subject_id=$2 AND relationship_type=$3`,
      [aId, bId, e.rel]);
    if (dup.rows.length) { skipped++; continue; }

    await pool.query(
      `INSERT INTO canonical_family_edges
         (a_subject_table, a_subject_id, b_subject_table, b_subject_id, relationship_type,
          source_document_id, evidence_tier, confidence, verified, information_type, informant_role,
          notes, produced_by, created_at, updated_at)
       VALUES ('unconfirmed_persons',$1,'unconfirmed_persons',$2,$3,$4,$5,$6,FALSE,$7,$8,$9,$10,NOW(),NOW())`,
      [aId, bId, e.rel, docId, e.info === 'primary' ? 1 : 2, e.conf, e.info, e.role,
       `Freedmen's Bureau, Amelia C.H. field office, Letters Received 1867-68, p.${e.page}. Verbatim: "${e.quote}" — UNVERIFIED: single record, candidate for human confirmation.`,
       PRODUCER]);
    written++;
    console.log(`  ✓ ${e.a} -${e.rel}-> ${e.b}  [${e.info}/${e.role}] doc#${docId}`);
  }

  console.log(`\n=== ${written} edges ${APPLY ? 'written' : 'would be written'} · ${skipped} skipped ===`);
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
