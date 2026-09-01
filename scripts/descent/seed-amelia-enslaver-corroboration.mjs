// seed-amelia-enslaver-corroboration.mjs — pair the enslavers NAMED IN THE FREEDMEN'S BUREAU LETTERS with
// the 1860 slave-schedule canonicals already in the corpus, as CANDIDATES for human adjudication.
//
// WHY THIS IS THE HIGHEST-VALUE CORROBORATION AVAILABLE
//   The Amelia letters name perpetrators in 1867-68: Dr. Frank Jeter, Henry Blanton, Albert J. Maxey,
//   Martha M. Robertson, John A. Graves, John Bowles. The 1860 slave schedules independently record
//   slaveholders BY COUNTY: A T Maxey (Amelia), E A Blanton (Amelia), Thos/John W/James R Jeter (Amelia),
//   John/William H/Lemuel Robertson (Amelia), Susan Graves (Amelia), George S Bowles (Amelia).
//   One source says what a man DID to a freedperson; the other says what he HELD. Joined, that is the dual
//   ledger closing on a named individual — the thing a DAA has to assert.
//
// WHY CANDIDATES AND NOT MATCHES (the whole point)
//   "A T Maxey, Amelia County" and "Albert J. Maxey, Amelia County" is a surname + county + decade match.
//   It is *strong*. It is still not an identification. Auto-linking it is precisely the operation that put
//   five Monticello children under an enslaved woman in Louisiana earlier tonight, and the Biscoe rule
//   exists because this project has been burned by it before. So every pair is written to
//   `ancestry_corroboration_queue` as a QUESTION for the operator's patron session, never as an edge.
//
// Uses the EXISTING queue and the EXISTING notify/ingest path (ancestry-corroborate.mjs) rather than a new
// mechanism -- after rebuilding two pipelines tonight that already existed.
//
// Usage: node scripts/descent/seed-amelia-enslaver-corroboration.mjs [--apply]

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');

// Each entry: the person as the LETTER names them, the surname to match in the schedules, the county the
// letter places them in, and what the letter actually alleges — which becomes `what_to_confirm`.
const LETTER_ENSLAVERS = [
  { name: 'Albert J. Maxey', surname: 'Maxey', county: 'Amelia', page: 75,
    allege: 'named with John A. Graves in Edwin Harrison\'s case of injustice over property; the case was refused a hearing in both the County and Superior Court for Amelia Co' },
  { name: 'John A. Graves', surname: 'Graves', county: 'Amelia', page: 75,
    allege: 'named with Albert J. Maxey in Edwin Harrison\'s property case' },
  { name: 'Dr. Frank Jeter', surname: 'Jeter', county: 'Amelia', page: 121,
    allege: 'held Lizzie Jackson (col\'d), aged ~13, refusing to deliver her to her father Andrew Jackson; claimed her labour against "the trouble and expense which we have had in raising her"' },
  { name: 'Mrs. John Jeter', surname: 'Jeter', county: 'Amelia', page: 121,
    allege: 'received $5.00 from Andrew Jackson to send his daughter Lizzie to him; she was not sent' },
  { name: 'Henry Blanton', surname: 'Blanton', county: 'Amelia', page: 49,
    allege: 'with Mr. Mongold, swore against Scott Egleston (col\'d), who states the swearing was false and that he was tried and imprisoned on it' },
  { name: 'Martha M. Robertson', surname: 'Robertson', county: 'Amelia', page: 147,
    allege: 'requested that two colored children in her care be "bound or secured to her"; also held the children of Armstead Lee' },
  { name: 'John Bowles', surname: 'Bowles', county: 'Amelia', page: 25,
    allege: 'agent for Louisa Martin; Frank Patterson (col\'d) of High Hill Tavern, Powhatan Co, submitted a statement of injustice done him by Bowles' },
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  let seeded = 0, noCandidate = 0, already = 0;

  for (const L of LETTER_ENSLAVERS) {
    const cands = (await pool.query(
      `SELECT id, canonical_name, primary_county, primary_state
         FROM canonical_persons
        WHERE person_type = 'enslaver' AND primary_state = 'Virginia'
          AND primary_county = $1 AND canonical_name ILIKE $2
        ORDER BY canonical_name LIMIT 6`, [L.county, '%' + L.surname + '%'])).rows;

    if (!cands.length) { console.log(`  — ${L.name}: no ${L.surname} enslaver recorded in ${L.county} Co`); noCandidate++; continue; }

    for (const c of cands) {
      const what =
        `Does the 1860 slave schedule entry for "${c.canonical_name}" (${c.primary_county} Co, VA) refer to the ` +
        `"${L.name}" named in the Freedmen's Bureau letter, Amelia C.H. field office, Letters Received 1867-68, p.${L.page}? ` +
        `The letter alleges: ${L.allege}. ` +
        `CONFIRM OR REFUTE using census/vital/probate records — do NOT match on surname and county alone. ` +
        `Needed to distinguish: given name in full, years of residence in ${L.county} Co, household composition, and ` +
        `whether this person was still living and holding in 1860. If several ${L.surname}s in ${L.county} Co fit ` +
        `equally, the correct answer is "ambiguous" and the pair stays unlinked.`;

      if (!APPLY) { console.log(`  would seed: ${L.name}  ↔  ${c.canonical_name} (#${c.id}, ${c.primary_county})`); seeded++; continue; }

      // The queue is UNIQUE per canonical person (uq_ancestry_queue_person) -- one open question per human,
      // which is right. Several of these people were already queued off "thin evidence"; the letter gives a
      // far sharper question than the generic seed, so ENRICH rather than duplicate. Never touch a task the
      // operator has already worked: only 'pending' rows are rewritten.
      const res = await pool.query(
        `INSERT INTO ancestry_corroboration_queue
           (canonical_person_id, person_name, search_url, what_to_confirm, priority, status)
         VALUES ($1, $2, $3, $4, 10, 'pending')
         ON CONFLICT (canonical_person_id) DO UPDATE
           SET what_to_confirm = EXCLUDED.what_to_confirm, priority = 10, search_url = EXCLUDED.search_url
           WHERE ancestry_corroboration_queue.status = 'pending'
         RETURNING (xmax = 0) AS inserted`,
        [c.id, c.canonical_name,
         `https://www.ancestry.com/search/?name=${encodeURIComponent(c.canonical_name.trim().replace(/\s+/g, '_'))}&keyword=${encodeURIComponent(c.primary_county + ' County Virginia 1860')}`,
         what]);
      if (!res.rows.length) { already++; console.log(`  · ${c.canonical_name} (#${c.id}) already worked — left alone`); continue; }
      seeded++;
      console.log(`  ${res.rows[0].inserted ? '✓ new ' : '↑ enriched'} ${L.name}  ↔  ${c.canonical_name} (#${c.id})`);
    }
  }

  console.log(`\n=== ${seeded} pair(s) ${APPLY ? 'seeded' : 'would be seeded'} · ${already} already queued · ${noCandidate} letter-names with no county match ===`);
  console.log('priority 10 — these jump the queue, because a named perpetrator with an independent holding record is');
  console.log('the strongest dual-ledger evidence this corpus can currently produce.');
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
