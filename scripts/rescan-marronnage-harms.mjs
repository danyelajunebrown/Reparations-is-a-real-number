// rescan-marronnage-harms.mjs — re-read the ad text we ALREADY hold and create the harm_events that a
// broken regex missed. No network: every advertisement is stored in person_documents.ocr_text.
//
// WHY (2026-08-23). The corpus contains 9,915 ads saying "étampé" — branded, almost always with the
// enslaver's own initials. We had recorded THIRTY-SEVEN branding events. The ads were fine: 1,697 of our
// 4,126 stored ads contain the word, 41%, matching the source's own 44%. The PATTERN was broken:
//     /\b[ée]tamp[ée]e?\b/i
// JavaScript's \b is defined against [A-Za-z0-9_], so "é" is not a word character and \bé can never match
// after a space. One character silently deleted the largest harm class in the source — and I explained the
// shortfall away TWICE as "the sweep hasn't reached Saint-Domingue yet" instead of testing the pattern
// against text already sitting in our own database.
// Same family as `y is not a vowel` deleting every Mary: a validator written from an idea of the data
// rather than from the data.
//
// Usage: node scripts/rescan-marronnage-harms.mjs [--apply]
import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');

// Anchored on ASCII-safe stems; no \b immediately before an accented letter; plurals and feminines allowed.
const HARMS = [
  ['branding',        /[ée]tamp[ée]?[es]?\b|\bmarqu[ée]e?s?\s+(au\s+fer|d[e'’]un)|\bbranded\b|\bbrand(ed)?\s+(on|with)\b/i],
  ['scarring',        /cicatrice|balafr|\bscars?\b|\bmarks? of the whip\b|marqu[ée]e?s?\s+de\s+coups/i],
  ['whipping',        /fouett|coups?\s+de\s+fouet|\bwhipp?(ed|ing)\b|\blash(ed|es)\b/i],
  ['restraint_irons', /\bfers?\b|cha[îi]ne|carcan|collier\s+de\s+fer|\birons?\b|\bshackle|\bmanacle/i],
  ['imprisonment',    /g[eé][ôo]le|cachot|\bprison\b|\bjail\b|\bgaol\b|workhouse|d[ée]p[ôo]t\s+des?\s+n[èe]gres/i],
  ['injury',          /boiteu|estropi|manchot|borgne|mutil|ulc[èe]r|\blame\b|\bcripple|walks?\s+(heavily|lame)|one\s+eye/i],
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 900000, query_timeout: 900000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const docs = (await pool.query(`
  SELECT d.id, d.unconfirmed_person_id, d.canonical_person_id, d.name_as_appears, d.ocr_text,
         d.document_date, d.page_reference, d.source_url, d.collection_name
    FROM person_documents d
   WHERE d.document_type = 'runaway_advertisement' AND d.ocr_text IS NOT NULL`)).rows;
console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} rescanning ${docs.length} stored advertisements`);

const found = {}, created = {};
let rows = 0, err = 0;
for (const d of docs) {
  const subjTable = d.unconfirmed_person_id ? 'unconfirmed_persons' : 'canonical_persons';
  const subjId = d.unconfirmed_person_id || d.canonical_person_id;
  if (!subjId) continue;
  const citation = `${d.collection_name || 'Le marronnage dans le monde atlantique'} · ${d.page_reference || ''}`.trim();
  for (const [kind, re] of HARMS) {
    if (!re.test(d.ocr_text)) continue;
    found[kind] = (found[kind] || 0) + 1;
    if (!APPLY) continue;
    try {
      const r = await pool.query(
        `INSERT INTO harm_events (harm_type, harm_category, victim_subject_table, victim_subject_id,
           victim_name, narrative, event_date, source_citation, confidence_score, reparations_relevant,
           requires_human_review)
         SELECT $1,'bodily_harm',$2,$3,$4,$5,$6,$7,0.85,TRUE,TRUE
          WHERE NOT EXISTS (SELECT 1 FROM harm_events h
             -- KEY ON THE ADVERTISEMENT, NOT THE CITATION STRING. Two writers formatted the citation
             -- differently, so this guard missed and 1,988 exact duplicates were created (and had to be
             -- deleted). The stable identity of a harm here is victim + harm type + THE AD TEXT ITSELF:
             -- the same ad re-read is the same event, a different ad is a genuine second event, because
             -- repeat flight is ~5% of this corpus and collapsing it would erase people fleeing twice.
             WHERE h.victim_subject_table=$2 AND h.victim_subject_id=$3 AND h.harm_type=$1
               AND left(h.narrative,300)=left($5::text,300))
         RETURNING id`,
        [kind, subjTable, subjId, d.name_as_appears, String(d.ocr_text).slice(0, 1200),
         d.document_date || null, citation]);
      if (r.rows.length) { created[kind] = (created[kind] || 0) + 1; rows++; }
    } catch (e) { err++; if (err <= 5) console.error(`  ! ${kind} doc ${d.id}: ${e.message.slice(0, 80)}`); }
  }
}
console.log('\n  ads MATCHING each harm (what the text actually says):');
for (const [k, v] of Object.entries(found).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(18)} ${String(v).padStart(6)}`);
if (APPLY) {
  console.log('\n  NEW harm_events created:');
  for (const [k, v] of Object.entries(created).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(18)} ${String(v).padStart(6)}`);
  console.log(`\n=== ${rows} new harm_events · ${err} errors ===`);
  console.log('RULE 0.5 — embed: node scripts/embed-verbs.mjs --kind harms --apply  (cron */21 also picks these up)');
} else console.log('\n(dry run — pass --apply)');
await pool.end();
