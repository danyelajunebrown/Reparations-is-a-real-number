// ingest-bailey-plantation-book.mjs — the Bailey family plantation account book (LoC, 1759-1819),
// HAND-READ, not OCR'd.
//
// WHY HAND-READ: 18th-century secretary hand; a third of the pages inverted (the book was written from both
// ends); and every settled entry is struck through — a strike here means PAID, not deleted. An OCR pass that
// ignores strikes loses payment status; one that treats them as deletions loses the record. This is exactly
// where automated extraction invents things, and these entries are too important to guess at.
//
// WHY IT MINTS PEOPLE (operator, 2026-09-01): "a second hand source like this should mint canonicals bc this
// could be the only record of a slave's existence. i understand why it would be gated from a DAA."
// That distinction is the right one and the schema already supports it. Beck, Jack, Bob and Jem may have no
// other surviving record anywhere. Refusing to mint them because the source is secondary would erase them BY
// PROCESS — the database would hold the PRICE of Jem's year and not Jem. RULE 0.6 gates what we may ASSERT
// against an obligor; it was never meant to gate whether a person is recorded as having existed.
// So: they are minted, image-backed (the LoC scan is public domain and archivable), embedded — and left
// assertable=FALSE, because a hire entry in a third party's account book is not a DAA-grade identification.
//
// WHAT THIS BOOK UNIQUELY DOCUMENTS
//   · ANNUAL HIRE PRICES per named person — the market's own contemporaneous valuation of one year of a
//     person's labour, at arm's length, paid to someone else. Beck £1-15-0/yr; Bob £0-12-6 rising to
//     £1-10-0 as he grows; Jem £6-0-0. A 9.6x spread that any flat per-person constant averages away.
//   · REPRODUCTION PRICED: Beck's 1771 hire is "£1-15-0 if she dos not prove with Child, and if she should
//     then £1-10" — pregnancy anticipated and discounted in advance.
//   · A CONTRACTED STANDARD OF CARE: Jem's 1777 hire requires that he "not be abused uniustly" and be
//     returned "as well clothed as he takes him: his shos indeferent good, stockens and briches good, and
//     Jacket and hat". Where a standard is documented, a breach becomes documented harm rather than inference.
//   · A SECOND CLASS OF BENEFICIARY: the HIRERS. Carrel, Blow, Brock, Smith, Rae and others paid for and
//     profited from enslaved labour WITHOUT holding title — invisible to any search that looks only for
//     slaveholders in census schedules.
//
// THE OWNERSHIP TRAP, avoided deliberately: Zachariah/Joseph Bailey KEEP this book, but the enslaved people
// belong to John, Hannah and Mary WHITE. An ingest keyed on "whose book is this" would attribute every one
// of them to Bailey — wrong, and plausibly wrong, which is worse. Bailey is recorded as the RECORDER.
//
// Usage: node scripts/ingest-bailey-plantation-book.mjs [--apply]
import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const APPLY = process.argv.includes('--apply');
const SRC = 'https://www.loc.gov/item/mm96006328/';
const PDF = 'https://tile.loc.gov/storage-services/service/mss/mssmmc/00/11/67/04/86/9/00116704869/00116704869.pdf';
const CITE = 'Bailey Family Plantation Account Book, 1759-1819, Manuscript Division, Library of Congress, ' +
             'Washington, D.C. (LCCN mm96006328). Sussex County, Virginia.';

// HAND-READ ENTRIES. `verbatim` is what the page says; nothing here is normalised or inferred.
const HIRES = [
  { person: 'Beck', sex: 'female', owner: 'John White', hirer: 'William Carrel', year: 1768, gbp: 1.779,
    verbatim: 'received of william Carrel £1-15-7 for the hire of John Whites negro Beck for the year 1768', page: 8 },
  { person: 'Beck', sex: 'female', owner: 'John White', hirer: 'Esther Smith', year: 1769, gbp: null,
    verbatim: 'received of Esther Smith for the hire of John Whites beck for the year 1769', page: 10 },
  { person: 'Beck', sex: 'female', owner: 'John White', hirer: 'Henry Fosen', year: 1769, gbp: null,
    verbatim: 'received of henry fosen for the hire of John Whites beck for 2 weaks work', page: 10 },
  { person: 'Beck', sex: 'female', owner: 'John White', hirer: "John Blow's wife", year: 1771, gbp: 1.75,
    verbatim: 'hired to John Blows wife John Whites Beck for the year 1771 at £1-15-0 if she dos not prove with Child and if she should then £1-10',
    page: 11, note: 'REPRODUCTION PRICED: the hire falls 5s if she becomes pregnant.' },
  { person: 'Jack', sex: 'male', owner: 'Mary White', hirer: 'William Carrel', year: 1769, gbp: 1.75,
    verbatim: 'Received of william Carrel the hire of mary Whites Jack for the year 1769 £1-15-0', page: 8 },
  { person: 'Jack', sex: 'male', owner: 'John White', hirer: 'John Blow', year: 1770, gbp: null,
    verbatim: 'hired to John blow John Whites Jack for the year 1770', page: 10 },
  { person: 'Bob', sex: 'male', owner: 'John White', hirer: 'William Carrel junr', year: 1770, gbp: 0.625,
    verbatim: 'received of wiliam carrel guner for the hire of bob for the year 1770 £0-12-6', page: 12 },
  { person: 'Bob', sex: 'male', owner: 'John White', hirer: 'Nathan Carrel', year: 1771, gbp: 0.75,
    verbatim: 'hired to nathan carrel John Whites bob for the year 1771 at £0-15-0', page: 11 },
  { person: 'Bob', sex: 'male', owner: 'John White', hirer: 'Nathan Carrel', year: 1772, gbp: 1.5,
    verbatim: 'hired to nathan carrel John whites bob for the year 1772 at £1-10-0', page: 12 },
  { person: 'Jem', sex: 'male', owner: 'Hannah White', hirer: 'John Rae', year: 1777, gbp: 6.0,
    verbatim: 'Hired to John Rae Hanah Whites nego Jem for £6-0-0 for the year 1777 he is not to abuse him uniustly and return him as well clothed as he takes him his shos indeferent good stockens and briches good and Jacket and hat — Thomas Rogers',
    page: 15, note: 'CONTRACTED STANDARD OF CARE: non-abuse and specified clothing on return.' },
];

// THE BAILEY FAMILY'S OWN GENEALOGY, recorded in this book with a precision never afforded the enslaved.
// Operator: "i imagine this would be evidence enough for the bailey family members." It is — these are
// exact birth dates in a contemporaneous family register, which is tier-1 genealogical evidence and better
// than most of what we hold for enslaver families. Note the asymmetry the book itself documents: the white
// children get day, month and year; Beck, Jack, Bob and Jem get a first name and a price.
const BAILEYS = [
  { name: 'Zachariah Bailey', born: 1712, note: 'born in the 9 month 1712, the 23rd day. Kept this book; billed owners for "doctering" enslaved people (see DOCTORING).' },
  { name: 'Rachel Bailey',    born: 1719, note: 'born the 14 day of October 1719' },
  { name: 'Jeremiah Bailey',  born: 1756, note: 'born the 17 April 1756' },
  { name: 'Sarah Bailey',     born: 1759, note: 'born the 25 January 1759' },
  { name: 'Mary Bailey',      born: 1761, note: 'born the 11 of October 1761' },
  { name: 'John Bailey',      born: 1764, note: 'born the 19 September 1764' },
  { name: 'Joseph Bailey',    born: null, note: '"Joseph Bailey His Accompt Book 1782"' },
  { name: 'Joshua Bailey',    born: null, note: 'debt entry, January 12 1777' },
];

// A THIRD BENEFICIARY CLASS, and one our pipeline cannot currently see: the PHYSICIAN.
// Zachariah Bailey billed slaveholders for treating the people they held — "Dr to Doctership Accounts 1793:
// John Sain by Negro man ... Peter Newel by Negro woman"; "Sussex March 11 1797 ... To doctering negro
// woman 0-6-0". Medical care here is ASSET MAINTENANCE, invoiced to the owner, and the physician takes a
// fee from it. He owned no one and appears in no slave schedule. Recorded so the class exists in the data.
const DOCTORING = [
  { client: 'John Sain',    subject: 'a negro man',   year: 1793, page: 18, verbatim: 'John Sain by Negro man' },
  { client: 'Peter Newel',  subject: 'a negro woman', year: 1793, page: 18, verbatim: 'Peter Newel by Negro woman' },
  { client: 'Sussex acct',  subject: 'a negro woman', year: 1797, page: 20, verbatim: 'To doctering negro woman — 0-6-0' },
  { client: 'Sussex acct',  subject: 'a negro woman', year: 1797, page: 20, verbatim: 'doctering negro woman — 4-0' },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 300000, query_timeout: 300000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));
const svc = new PersonService(pool);

const people = [...new Set(HIRES.map((h) => h.person))];
const owners = [...new Set(HIRES.map((h) => h.owner))];
const hirers = [...new Set(HIRES.map((h) => h.hirer))];
console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} Bailey plantation account book`);
console.log(`  enslaved people named : ${people.join(', ')}`);
console.log(`  owners (title)        : ${owners.join(', ')}`);
console.log(`  hirers (beneficiaries): ${hirers.join(', ')}`);
console.log(`  hire entries          : ${HIRES.length}`);
if (!APPLY) { console.log('\n(dry run — pass --apply)'); await pool.end(); process.exit(0); }

const st = { minted: 0, linked: 0, rejected: 0, hires: 0, facts: 0, err: 0 };
const idOf = {};
for (const name of people) {
  try {
    const h = HIRES.find((x) => x.person === name);
    const out = await svc.findOrCreateLead({
      name, personType: 'enslaved', sex: h.sex,
      location: 'Sussex County, Virginia',
      externalId: `bailey-book:${name.toLowerCase()}:${h.owner.toLowerCase().replace(/\s+/g, '-')}`,
      idSystem: 'bailey_plantation_book',
      sourceUrl: SRC, sourceType: 'secondary', createdBy: 'ingest-bailey-plantation-book',
    }, { dryRun: false });
    if (!out.ref) { st.rejected++; continue; }
    idOf[name] = out.ref;
    out.action === 'created' ? st.minted++ : st.linked++;
  } catch (e) { st.err++; console.error(`  ! ${name}: ${e.message.slice(0, 80)}`); }
}

for (const h of HIRES) {
  const ref = idOf[h.person]; if (!ref) continue;
  const isLead = ref.subject_table === 'unconfirmed_persons';
  await pool.query(
    `INSERT INTO person_documents (${isLead ? 'unconfirmed_person_id' : 'canonical_person_id'},
       name_as_appears, document_type, source_url, source_type, collection_name, page_reference,
       person_type, evidence_strength, document_year, ocr_text, created_by)
     SELECT $1,$2,'plantation_account_book',$3,'secondary',$4,$5,'enslaved','secondary',$6,$7,'ingest-bailey-plantation-book'
      WHERE NOT EXISTS (SELECT 1 FROM person_documents d
         WHERE d.${isLead ? 'unconfirmed_person_id' : 'canonical_person_id'}=$1 AND d.page_reference=$5)`,
    [ref.subject_id, `${h.owner}'s ${h.person}`, SRC,
     'Bailey Family Plantation Account Book (Library of Congress, mm96006328)',
     `p.${h.page} · hire ${h.year}`.slice(0, 100), h.year, h.verbatim]).catch(() => {});

  // The hire itself: a priced, dated, arm's-length valuation of one year of this person's labour.
  // transfer_type='hire' — NOT a transfer of title. The hirer never owned them.
  await pool.query(
    `INSERT INTO chattel_transfer_events (enslaved_name_text, from_enslaver_name, to_enslaver_name,
       transfer_type, transfer_year, value_amount, value_currency, place_state, place_locality,
       source_table, source_external_system, source_external_id, source_citation, confidence)
     SELECT $1,$2,$3,'hire',$4,$5,'GBP_VA','Virginia','Sussex County','person_documents','loc_mm96006328',$6,$7,0.8
      WHERE NOT EXISTS (SELECT 1 FROM chattel_transfer_events e
         WHERE e.enslaved_name_text=$1 AND e.transfer_year=$4 AND e.transfer_type='hire' AND e.to_enslaver_name=$3)`,
    // The external id must identify the ENTRY, not the PAGE. The unique key is
    // (source_external_system, source_external_id, transfer_type), and using "p.8" collapsed every hire
    // recorded on one page into a single row — silently dropping five REAL transactions, including the
    // fact that Beck was hired to BOTH Esther Smith and Henry Fosen in 1769. Two hirings of the same person
    // in the same year is not a duplicate; it is a person being moved twice.
    [h.person, h.owner, h.hirer, h.year, h.gbp,
     `p${h.page}:${h.person.toLowerCase()}:${h.year}:${h.hirer.toLowerCase().replace(/[^a-z]+/g, '-')}`, CITE])
    .then(() => { st.hires++; }).catch((e) => console.error(`  ! hire ${h.person} ${h.year}: ${e.message.slice(0, 70)}`));
}
// Bailey family — minted as documented persons with their recorded birth dates.
for (const b of BAILEYS) {
  try {
    const out = await svc.findOrCreateLead({
      name: b.name, personType: 'unknown', birthYear: b.born,
      location: 'Sussex County, Virginia',
      externalId: `bailey-book:family:${b.name.toLowerCase().replace(/\s+/g, '-')}`,
      idSystem: 'bailey_plantation_book',
      sourceUrl: SRC, sourceType: 'secondary', createdBy: 'ingest-bailey-plantation-book',
    }, { dryRun: false });
    if (!out.ref) { st.rejected++; continue; }
    out.action === 'created' ? st.minted++ : st.linked++;
    const isLead = out.ref.subject_table === 'unconfirmed_persons';
    await pool.query(
      `INSERT INTO person_documents (${isLead ? 'unconfirmed_person_id' : 'canonical_person_id'},
         name_as_appears, document_type, source_url, source_type, collection_name, page_reference,
         evidence_strength, document_year, ocr_text, created_by)
       SELECT $1,$2,'family_register',$3,'secondary',$4,$5,'primary',$6,$7,'ingest-bailey-plantation-book'
        WHERE NOT EXISTS (SELECT 1 FROM person_documents d
           WHERE d.${isLead ? 'unconfirmed_person_id' : 'canonical_person_id'}=$1 AND d.document_type='family_register')`,
      [out.ref.subject_id, b.name, SRC,
       'Bailey Family Plantation Account Book (Library of Congress, mm96006328)',
       'family register pp.32-33'.slice(0, 100), b.born, b.note]).catch(() => {});
  } catch (e) { st.err++; }
}

// Doctoring — the physician-beneficiary record. No enslaved person is named on these pages, so NO person
// is minted for the patients (audit rule 5: real or absent). The EVENT is recorded against the client.
for (const d of DOCTORING) {
  await pool.query(
    `INSERT INTO research_findings (question, repository, index_searched, result, hit_count,
       evidence_note, searched_by)
     SELECT $1,$2,$3,'hit',1,$4,'ingest-bailey-plantation-book'
      WHERE NOT EXISTS (SELECT 1 FROM research_findings f
         WHERE f.searched_by='ingest-bailey-plantation-book' AND f.index_searched=$3)`,
    [`Who profited from medical treatment of enslaved people in Sussex County, Virginia?`,
     'Bailey Family Plantation Account Book (Library of Congress, mm96006328)',
     `doctoring p.${d.page} ${d.year} ${d.client}`,
     `Zachariah Bailey billed ${d.client} for treating ${d.subject} — "${d.verbatim}" (${d.year}, p.${d.page}). ` +
     `The patient is UNNAMED, so no person row is created (audit rule 5: real or absent). What is recorded is ` +
     `the BENEFICIARY: a physician taking a fee for maintaining enslaved bodies as working assets, billed to ` +
     `the holder. He owned no one and would appear in no slave schedule. ${CITE}`])
    .then(() => { st.facts++; }).catch(() => {});
}

console.log(`\n=== ${JSON.stringify(st)} ===`);
console.log('People are minted as LEADS and left NON-assertable: existence is recorded, DAA-grade claim is not.');
console.log('RULE 0.5 — embed: node scripts/embed-leads.mjs --id-system bailey_plantation_book');
await pool.end();
