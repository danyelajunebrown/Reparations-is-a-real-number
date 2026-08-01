// ingest-bard-lineage-edges.mjs — the Bard-College modern-endpoint LINEAGE, as gated lead-aware kinship
// edges. Connects the census-documented Dutchess enslavers to the college founder:
//
//   Samuel Bard (1800 census, 7 enslaved)  --child_of-->  is father of William Bard (1810 census, 4)
//   William Bard  --child_of-->  is father of  John Bard (founds St. Stephen's / Bard College, 1860)
//
// SOURCE = the 560-page Bard genealogy (IA bardfamilyhistor02lcseil) — a COMPILED genealogy, i.e. SECONDARY
// information (migration 127: information_type='secondary', informant_role='compiler'). It states the
// lineage but NOT the slaveholding (that is the census, via NESRI). event_to_record_gap_years is large
// (~1900s compilation vs 18th-c. births) → secondary by the mechanical proxy too.
//
// NAMESAKE CAUTION (Biscoe): the NESRI "William Bard, 1810 Dutchess enslaver" lead is only PROBABLY the
// genealogy's William Bard (b.1778, whom the genealogy places in Philadelphia/Staten Island). So the
// William→Samuel edge is written verified=FALSE at evidence_tier=3 with the identity hypothesis in notes —
// asserted only once the 1810 census page confirms it (Mini pull; logged in research_findings).
//
// Usage: node scripts/ingest-bard-lineage-edges.mjs [--apply]   (dry-run default)

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const APPLY = process.argv.includes('--apply');
const SAMUEL_LEAD = 3579208;   // NESRI Samuel Bard, Dutchess, 1800 census, 7 enslaved
const WILLIAM_LEAD = 3579211;  // NESRI William Bard, Dutchess, 1810 census, 4 enslaved (probable son of Samuel)
const GEN_SRC = 'The Bard Family: a history and genealogy (IA bardfamilyhistor02lcseil), ~1900s — SECONDARY/compiled';

async function ensureEdge(pool, { childLead, parentLead, gap, notes }) {
  const ex = await pool.query(
    `SELECT id FROM canonical_family_edges
      WHERE relationship_type='child_of' AND a_subject_table='unconfirmed_persons' AND a_subject_id=$1
        AND b_subject_table='unconfirmed_persons' AND b_subject_id=$2`, [childLead, parentLead]);
  if (ex.rows[0]) { console.log(`   edge exists (#${ex.rows[0].id}) child ${childLead} → parent ${parentLead}`); return ex.rows[0].id; }
  if (!APPLY) { console.log(`   would write child_of: lead ${childLead} → lead ${parentLead} [secondary]`); return null; }
  const ins = await pool.query(
    `INSERT INTO canonical_family_edges
       (relationship_type, a_subject_table, a_subject_id, b_subject_table, b_subject_id,
        source_url, evidence_tier, confidence, verified,
        information_type, informant_role, event_to_record_gap_years, notes, created_at, updated_at)
     VALUES ('child_of','unconfirmed_persons',$1,'unconfirmed_persons',$2,$3,3,0.70,FALSE,
             'secondary','compiler',$4,$5, now(), now())
     RETURNING id`, [childLead, parentLead, GEN_SRC, gap, notes]);
  console.log(`   ✓ wrote edge #${ins.rows[0].id} child ${childLead} → parent ${parentLead} [secondary, verified=false]`);
  return ins.rows[0].id;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const ps = new PersonService(pool);
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  // John Bard (founder) — the terminal person that ties the enslaver lineage to the modern institution.
  // person_type='unknown' (he is the heir/founder, NOT asserted an enslaver himself).
  const john = await ps.findOrCreateLead({
    name: 'John Bard', personType: 'unknown', birthYear: 1819, deathYear: 1899,
    locations: ['Annandale-on-Hudson, Dutchess County, New York', 'Hyde Park, Dutchess County, New York'],
    sourceType: 'secondary', confidence: 0.6, idSystem: 'bard_genealogy', externalId: 'bard-gen-john-1819',
    sourceUrl: GEN_SRC,
    context: 'John Bard (1819-1899), son of William Bard, grandson of Dr. Samuel Bard. Founded St. Stephen\'s College (later BARD COLLEGE) 1860 at Annandale-on-Hudson, Dutchess. The heir who carried the family (census-documented enslaving) wealth into the modern institution — the college is the modern successor holding the Massena parcel (2024 deed).',
    dataQualityFlags: { source_tier: 'secondary', max_evidence_tier: 'secondary', bard_college_founder: true, requires_human_review: true },
  }, { dryRun: !APPLY });
  const johnLead = john.ref?.subject_id;
  console.log(`John Bard lead: ${johnLead || '(dry-run)'} [${john.action}]`);

  console.log('\nEdge 1 — William Bard child_of Samuel Bard (probable; verify via 1810 census):');
  await ensureEdge(pool, { childLead: WILLIAM_LEAD, parentLead: SAMUEL_LEAD, gap: 130,
    notes: 'Bard genealogy: William Bard (b.1778) is son of Dr. Samuel Bard (1742-1821). NAMESAKE CAUTION: NESRI William Bard (1810 Dutchess enslaver) = this son is PROBABLE, not verified — confirm via the 1810 census page. Secondary/compiled source.' });

  if (johnLead) {
    console.log('\nEdge 2 — John Bard (founder) child_of William Bard:');
    await ensureEdge(pool, { childLead: johnLead, parentLead: WILLIAM_LEAD, gap: 89,
      notes: 'Bard genealogy: John Bard (1819-1899, founder of Bard College) is son of William Bard (1778-1858). Secondary/compiled source. This edge closes the enslaver-lineage → college-founder trace.' });
  } else if (!APPLY) {
    console.log('\nEdge 2 — (dry-run) John Bard child_of William Bard');
  }

  await pool.end();
  console.log('\n=== done ===');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
