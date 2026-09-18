// ingest-amelia-freedmens-letters.mjs — HAND-READ ingest of the first 23 pages of the Freedmen's Bureau
// Register of Letters Received, Amelia C.H. office (5th Div, 2nd Sub-Dist VA), Jul 1867–Dec 1868
// (FamilySearch collection 1596147). Read by Claude directly (not the Mini pipeline) per operator directive
// "read these yourself… do it yourself and learn." Each case: the named freedperson + former enslaver/
// perpetrator + kin → leads (Biscoe-safe), and each documented HARM → harm_events with the wrong stated
// VERBATIM (the "tea"), tied to victim + perpetrator + source citation. Leads, not canonicals (no image-gate).
//
// Usage: node scripts/ingest-amelia-freedmens-letters.mjs [--apply]

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const APPLY = process.argv.includes('--apply');
const CITE = (pg_) => `Freedmen's Bureau, Register of Letters Received, Amelia C.H. office (5th Div, 2nd Sub-Dist VA), 1867-68, FamilySearch 1596147, p.${pg_}`;

// Hand-transcribed from the images. person_type: enslaved = formerly-enslaved freedperson; enslaver = former holder.
const CASES = [
  { pg: 91, date: '1868-02-28', county: 'Powhatan', freed: 'Daniel Shepherd',
    kin: [{ name: 'John Shepherd', relation: 'son' }, { name: 'Andrew Shepherd', relation: 'son' }],
    perps: ['George Pannon', 'James Fisher'],
    harms: [{ type: 'family_separation_by_sale', cat: 'familial', victim: 'John Shepherd', perp: 'George Pannon',
      narr: 'Daniel Shepherd (cold) states that prior to the war his two children, John Shepherd and Andrew Shepherd, were sold to George Pannon of Orange Co Va; that recently he has heard that the children were, during the first part of the War, sold to James Fisher of Powhatan Co Va. Requests the aid of the Bureau in getting information of his children. Bureau endorsement: no such children as John and Andrew Shepherd can be heard of.' }] },
  { pg: 121, date: '1868-02-24', county: 'Amelia', freed: 'Lizzie Jackson', kin: [{ name: 'Andrew Jackson', relation: 'father' }],
    perps: ['Frank Jeter'],
    harms: [{ type: 'child_apprenticeship', cat: 'familial', victim: 'Lizzie Jackson', perp: 'Frank Jeter',
      narr: 'Lizzie Jackson (cold) aged about 13 yrs is now in custody of Dr. Frank Jeter of Amelia Co Va. The father, Andrew Jackson, gave $5.00 to a Mrs. John Jeter about a year ago to have his daughter Lizzie sent to him, but the said Dr. Frank Jeter refused to comply and has still the daughter in his possession. Jeter contends: "she is large enough to begin to render some service for the trouble and expense which we have had in raising her." He offers others: "There is several others in the neighborhood younger than Lizzie without Mothers or Fathers that is an expense to their former masters he can get upon application to me."' }] },
  { pg: 139, date: '1867-08-31', county: 'Powhatan', freed: 'Pleasant Parker', kin: [{ name: 'wife of Pleasant Parker', relation: 'wife' }],
    perps: ['Joseph Perdue'],
    harms: [{ type: 'physical_assault', cat: 'bodily', victim: 'wife of Pleasant Parker', perp: 'Joseph Perdue',
      narr: 'Pleasant Parker (colored) submits case of his wife, begs that he be remedied for injuries she received at the hand of one Joseph Perdue (White) who struck her on the side of her head with the butt of a gun causing a fearful wound affecting the whole side of her face, preventing her from masticating her food, likewise causing her to miscarry.' },
    { type: 'wrongful_death', cat: 'bodily', victim: 'unborn child of the wife of Pleasant Parker', perp: 'Joseph Perdue',
      narr: 'The blow "likewise caus[ed] her to miscarry."' }] },
  { pg: 49, date: '1868-04-02', county: 'Amelia', freed: 'Scott Egleston', kin: [],
    perps: ['Mongold', 'Henry Blanton'],
    harms: [{ type: 'false_imprisonment', cat: 'legal', victim: 'Scott Egleston', perp: 'Henry Blanton',
      narr: 'Scott Egleston (colored) states that he has been tried & imprisoned on statement of Mr. Mongold and Henry Blanton who falsely swore that he "bursted a cap" at the latter (Henry Blanton). Bureau agent J.B. Clinton upheld the verdict Guilty.' }] },
  { pg: 135, date: '1867-10-15', county: 'Powhatan', freed: 'George Parker', kin: [{ name: 'Lucy Howell', relation: 'wife' }],
    perps: ['Joseph Campbell', 'Shepard Bentley'],
    harms: [{ type: 'estate_withholding', cat: 'economic', victim: 'George Parker', perp: 'Joseph Campbell',
      narr: 'George Parker (colored) was a slave prior to the war; his wife and five children were free; he purchased property in his wife\'s name. His wife (Lucy Howell) died and the County Court appointed Jos. Campbell to manage the estate, who rented it to Shepard Bentley for five years at $25 per year; neither Parker nor his children have received any of the proceeds thereof. Property on Fine Creek, Powhatan Co.' }] },
  { pg: 77, date: '1868-04-25', county: 'Amelia', freed: 'Harriet Walthall',
    kin: [{ name: 'Sally Miller', relation: 'sister' }, { name: 'Mary Fields', relation: 'daughter/child' }, { name: 'Sally Fields', relation: 'child' }, { name: 'Wm Robison', relation: 'child' }, { name: 'Tom Robison', relation: 'child' }],
    perps: ['Robert G. Bacon'],
    harms: [{ type: 'family_separation', cat: 'familial', victim: 'Harriet Walthall', perp: 'Robert G. Bacon',
      narr: 'Harriet Walthall, an aged freedwoman living on Mr. Robert G. Bacon\'s plantation in Mitchell Co [GA], is likely to become a charge to the Government; she has a sister and daughter in Va who are able to support her. Harriet Walthall has four children in Petersburg named Mary Fields, Sally Fields, Wm Robison, & Tom Robison — separated from her by the domestic slave trade (she in GA, children in VA).' }] },
  { pg: 157, date: '1868-03-25', county: 'Powhatan', freed: 'Fanny Greene',
    kin: [{ name: 'Miles', relation: 'son' }, { name: 'Robert', relation: 'son' }, { name: 'Lucy', relation: 'daughter' }, { name: 'Junius Sidney', relation: 'son' }],
    perps: [],
    harms: [{ type: 'destitution_neglect', cat: 'familial', victim: 'Fanny Greene', perp: null,
      narr: 'Fanny Greene (freedwoman, deceased) — in the months of August & September she sent to Richd D. Carter every day saying she was sick and out of a house and "for God\'s Sake to let her come here." Her son Junius Sidney of Petersburg refused to help; her kin in Amelia never came. Three days before she died she gave her children away: Miles (14) and Robert (9) to Mr. Carter, the girl Lucy (6) to Lavinia Williams. Mary Burton: "none of her relations had ever been near her." A dying mother with no surviving kin network to catch her children.' }] },
  { pg: 93, date: '1868-11-11', county: 'Cumberland', freed: 'colored men of Cumberland County', kin: [],
    perps: ['Wade (road overseer)', 'D. Huddleston'],
    harms: [{ type: 'racial_discrimination', cat: 'civic', victim: 'colored men of Cumberland County', perp: 'Wade (road overseer)',
      narr: 'A Mr. Wade, overseer of road in Cumberland Co, considers himself authorized by the Court to call upon colored men only for work or commutation, and there are judgments now in the hands of D. Huddleston (Constable) against colored men for non-performance of road duty while the whites of his ward have neither been warranted or summoned.' }] },
  { pg: 111, date: '1868-05-18', county: 'Powhatan', freed: 'John Lewis', kin: [], perps: [],
    harms: [{ type: 'political_persecution', cat: 'civic', victim: 'John Lewis', perp: null,
      narr: 'John Lewis (Powhatan Co) relates treatment to which he has been subjected by the citizens of Powhatan Co on account of his political principles.' }] },
  { pg: 163, date: '1868-11-13', county: 'Amelia', freed: 'Benj Lewis', kin: [], perps: [], usct: 'Private Co D, 5th US Colored Troops',
    harms: [] },
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
  const ps = new PersonService(pool);
  console.log(APPLY ? '=== APPLY (hand-read Amelia Freedmen letters) ===' : '=== DRY RUN ===');

  const mkLead = async (name, type, ctx, extId) => {
    const r = await ps.findOrCreateLead({ name, personType: type, locations: [], sourceType: 'primary',
      confidence: 0.9, idSystem: 'freedmens_bureau_amelia', externalId: extId, sourceUrl: 'FamilySearch 1596147',
      context: ctx, dataQualityFlags: { source: 'freedmens_bureau_letter', requires_human_review: true } }, { dryRun: !APPLY });
    return r.ref || null;
  };

  let people = 0, harms = 0;
  for (const c of CASES) {
    const src = CITE(c.pg);
    const freedRef = c.freed ? await mkLead(c.freed, 'enslaved', `Freedperson in a Freedmen's Bureau case, ${c.county} Co VA, ${c.date}. ${c.usct ? 'USCT: ' + c.usct + '. ' : ''}${src}`, `fb:amelia:p${c.pg}:${c.freed}`) : null;
    if (freedRef) people++;
    const perpRefs = {};
    for (const perp of c.perps || []) { const r = await mkLead(perp, 'enslaver', `Named as former enslaver / perpetrator in a Freedmen's Bureau case, ${c.county} Co VA. ${src}`, `fb:amelia:p${c.pg}:perp:${perp}`); if (r) { perpRefs[perp] = r; people++; } }
    for (const k of c.kin || []) { const r = await mkLead(k.name, 'enslaved', `${k.relation} of ${c.freed}; named in a Freedmen's Bureau case, ${c.county} Co VA. ${src}`, `fb:amelia:p${c.pg}:kin:${k.name}`); if (r) people++; }

    for (const h of c.harms || []) {
      harms++;
      if (!APPLY) { console.log(`  harm[${h.type}] victim="${h.victim}" perp="${h.perp || '-'}" (p${c.pg})`); continue; }
      const v = h.victim === c.freed ? freedRef : null;
      const perpRef = h.perp ? perpRefs[h.perp] : null;
      await pool.query(
        `INSERT INTO harm_events (harm_type, harm_category, victim_subject_table, victim_subject_id, victim_name,
           perpetrator_subject_table, perpetrator_subject_id, perpetrator_name, narrative, event_date, location,
           source_citation, reparations_relevant, confidence_score, requires_human_review)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,0.9,TRUE)`,
        [h.type, h.cat, v?.subject_table || null, v?.subject_id || null, h.victim,
         perpRef?.subject_table || null, perpRef?.subject_id || null, h.perp || null, h.narr, c.date,
         `${c.county} Co VA`, src]);
    }
  }
  console.log(`\n=== ${APPLY ? 'wrote' : 'would write'}: ${people} people (leads), ${harms} harm_events ===`);
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
