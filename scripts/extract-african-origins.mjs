// extract-african-origins.mjs — pull the AFRICAN ORIGIN a record states about a person out of the document
// text and into person_facts, with the colonial ethnonym preserved and its modern reading marked as an
// interpretation rather than a fact.
//
// WHY THIS IS NOT A NICE-TO-HAVE. When an advertisement says "Un Negre nouveau, nation Congo" or "a new
// negro fello named FOUACABE, Mandingo born", that is the record stating WHICH AFRICAN PEOPLE A PERSON WAS
// TAKEN FROM. It is the single thing a descendant is most often trying to recover and the one thing almost
// nothing else in this corpus supplies — census schedules give a tally, probate gives a price, and neither
// says where anyone came from. Twenty-nine distinct ethnonyms already sit unparsed inside ocr_text.
//
// TWO DISCIPLINES, BOTH LEARNED THE HARD WAY THIS WEEK
//
// 1. ANCHOR THE MATCH. A naive substring sweep returned Mina=22,473 — inflated by "determina", "examina",
//    and the given name Mina — and Mende=2,089 from ordinary French words. Same family as \b failing before
//    "é" and silently deleting 1,697 branding events. Every pattern here is word-anchored and accent-aware,
//    and the count that matters is the one AFTER anchoring.
//
// 2. THE ETHNONYM IS THE EVIDENCE; THE MODERN PEOPLE IS AN INFERENCE. "Nago" and "Yoruba" are the same
//    people under a colonial label and a modern one, but the equation is OURS, not the document's. So the
//    recorded term goes in value_text as written, the scholarly reading goes in metadata, and where the
//    identification is genuinely disputed the row is written CONTESTED with a reason — the column that has
//    existed since the assertion store was designed and has never been used once.
//    Mina is the clearest case: variously read as Gbe-speakers, as Ga, or simply as "shipped from Elmina",
//    i.e. a PORT rather than a people. Recording it as a fact would be inventing certainty.
//
// Facts are written only for CANONICAL persons — person_facts.person_id is NOT NULL and canonical-only in
// this schema (checked, not assumed). Marronnage leads promoted on 2026-08-30 are eligible; the rest wait.
//
// Usage: node scripts/extract-african-origins.mjs [--limit 5000] [--apply]
import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const LIMIT = +val('--limit', 5000);

// Colonial ethnonym -> { people, language, region, contested? }
// Regions follow the standard slave-trade coast divisions used by SlaveVoyages so origins can be joined to
// the voyage data we already hold (64,853 voyages).
const ETHNONYMS = [
  [/\bcongos?\b/i,                        { people: 'BaKongo', language: 'Kikongo', region: 'West Central Africa' }],
  [/\b(i[bg]os?|e[bg]os?)\b/i,            { people: 'Igbo', language: 'Igbo', region: 'Bight of Biafra' }],
  [/\b(a?radas?)\b/i,                     { people: 'Allada / Fon-Ewe', language: 'Fon (Gbe)', region: 'Bight of Benin' }],
  [/\bnagos?\b/i,                         { people: 'Yoruba', language: 'Yoruba', region: 'Bight of Benin' }],
  [/\bbambaras?\b/i,                      { people: 'Bamana', language: 'Bamanankan', region: 'Senegambia / Upper Niger' }],
  [/\bmandingu?[eo]s?\b/i,                { people: 'Mandinka', language: 'Mandinka', region: 'Senegambia' }],
  [/\b(coromantees?|kromanti|cormantin)\b/i, { people: 'Akan', language: 'Twi', region: 'Gold Coast' }],
  [/\bfant[ei]s?\b/i,                     { people: 'Fante (Akan)', language: 'Twi', region: 'Gold Coast' }],
  [/\b(foulahs?|poulards?|peulh?s?)\b/i,  { people: 'Fulbe', language: 'Pulaar / Fula', region: 'Senegambia' }],
  [/\bangolas?\b/i,                       { people: 'Mbundu / Ovimbundu', language: 'Kimbundu / Umbundu', region: 'West Central Africa' }],
  [/\b(mozambiques?|mozambiquas?)\b/i,    { people: 'Southeast African (Makhuwa and others)', language: 'Makhuwa', region: 'Southeast Africa' }],
  [/\b(hauss?as?|haouss?as?)\b/i,         { people: 'Hausa', language: 'Hausa', region: 'Bight of Benin hinterland' }],
  [/\bchambas?\b/i,                       { people: 'Chamba', language: 'Chamba', region: 'Bight of Biafra hinterland' }],
  [/\b(s[ée]n[ée]gals?|wolofs?|jolofs?)\b/i, { people: 'Wolof', language: 'Wolof', region: 'Senegambia' }],
  [/\bmendes?\b/i,                        { people: 'Mende', language: 'Mende', region: 'Sierra Leone' }],
  [/\b(krus?|kroos?)\b/i,                 { people: 'Kru', language: 'Klao', region: 'Windward Coast' }],
  [/\btemn[ei]s?\b/i,                     { people: 'Temne', language: 'Temne', region: 'Sierra Leone' }],
  [/\bkissi?s?\b/i,                       { people: 'Kissi', language: 'Kissi', region: 'Sierra Leone / Guinea' }],
  [/\bsous?sous?\b/i,                     { people: 'Susu', language: 'Susu', region: 'Guinea' }],
  [/\b(cabindas?)\b/i,                    { people: 'BaKongo (Loango)', language: 'Kikongo', region: 'West Central Africa' }],
  [/\b(bengue?las?|banguelas?)\b/i,       { people: 'Ovimbundu', language: 'Umbundu', region: 'West Central Africa' }],
  // CONTESTED — the colonial label does not resolve to one people.
  [/\bminas?\b/i,                         { people: 'Gbe-speakers or Ga', language: 'Gbe / Ga', region: 'Gold Coast / Bight of Benin',
                                            contested: 'In French and Portuguese sources "Mina" may denote Gbe-speakers, Ga-speakers, or simply people shipped from the fort of Elmina — a PORT, not a people. Recorded as stated; not resolved.' }],
  [/\bmocos?\b/i,                          { people: 'Moko (Ibibio/Efik and neighbours)', language: 'Ibibio / Efik', region: 'Bight of Biafra',
                                            contested: '"Moko" is a broad colonial cover-term for several Bight of Biafra peoples, not a single ethnicity.' }],
  [/\bbibis?\b/i,                          { people: 'Ibibio (probable)', language: 'Ibibio', region: 'Bight of Biafra',
                                            contested: '"Bibi" is read by most scholars as Ibibio, but the identification is not secure.' }],
  [/\bcaplaous?\b/i,                       { people: 'Kru coast (Cape Lahou)', language: 'Kru / Avikam', region: 'Windward Coast',
                                            contested: '"Caplaou" derives from Cape Lahou, a place of embarkation, and may name a port rather than a people.' }],
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 900000, query_timeout: 900000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

// REACH THE TEXT THROUGH THE BACK-POINTER. The advertisements that state origin are attached to the LEAD
// (person_documents.unconfirmed_person_id), while person_facts.person_id is canonical-only. Scanning only
// canonical-attached documents found 29 origins in 18,848 rows, because promoteToCanonical writes a NEW
// document for the canonical and leaves the ad text on the lead.
// unconfirmed_persons.confirmed_individual_id is exactly the bridge — the column that was silently never
// written until 2026-08-30 and left 72,862 leads pointing at nothing. This is the first thing that has
// actually needed it, and it would have been unreachable a week ago.
const rows = (await pool.query(`
  SELECT COALESCE(d.canonical_person_id, u.confirmed_individual_id::integer) AS pid,
         d.ocr_text, d.source_url, d.document_type, d.document_year,
         c.canonical_name, c.primary_state
    FROM person_documents d
    LEFT JOIN unconfirmed_persons u ON u.lead_id = d.unconfirmed_person_id
    JOIN canonical_persons c
      ON c.id = COALESCE(d.canonical_person_id, u.confirmed_individual_id::integer)
   WHERE d.ocr_text IS NOT NULL AND length(d.ocr_text) > 30
     AND d.document_type IN ('runaway_advertisement','court_petition','slave_narrative','narrative',
                             'freedmens_bank','will','estate_inventory','bill_of_sale','slave_register')
   ORDER BY (d.document_type = 'runaway_advertisement') DESC
   LIMIT $1`, [LIMIT])).rows;

console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} scanning ${rows.length} documents attached to canonical persons`);

const tally = {}; let written = 0, contested = 0;
for (const r of rows) {
  for (const [re, meta] of ETHNONYMS) {
    const m = r.ocr_text.match(re);
    if (!m) continue;
    const asRecorded = m[0];
    tally[meta.people] = (tally[meta.people] || 0) + 1;
    if (meta.contested) contested++;
    if (!APPLY) continue;
    await pool.query(
      `INSERT INTO person_facts (person_id, fact_type, value_text, date_year, place_text, source_table,
         source_external_system, source_url, source_citation, confidence, verification_status,
         contested, contested_reason, metadata)
       SELECT $1,'african_origin_as_recorded',$2,$3,$4,'person_documents','document_text',$5,$6,$7,'unverified',$8,$9,$10::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM person_facts f
           WHERE f.person_id=$1 AND f.fact_type='african_origin_as_recorded' AND f.value_text=$2)`,
      [r.pid, asRecorded, r.document_year || null, r.primary_state || null, r.source_url,
       `${r.document_type} naming origin as "${asRecorded}"`,
       meta.contested ? 0.6 : 0.75,
       !!meta.contested, meta.contested || null,
       JSON.stringify({ recorded_term: asRecorded, people: meta.people, language: meta.language,
         region: meta.region,
         note: 'The ETHNONYM is the evidence; people/language/region are OUR reading of it and may be revised.' })])
      .then(() => { written++; }).catch((e) => console.error(`  ! ${r.pid}: ${e.message.slice(0, 70)}`));
  }
}
console.log('\n  ORIGINS FOUND (anchored, not substring):');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(6)}  ${k}`);
console.log(`\n=== ${written} facts written · ${contested} of the matches are CONTESTED identifications ===`);
if (!APPLY) console.log('(dry run — pass --apply)');
await pool.end();
