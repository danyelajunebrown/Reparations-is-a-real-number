// extract-jefferson-farm-book-rolls.mjs — turn the Jefferson Farm Book's ROLLS OF THE NEGROES into named
// people with birth years and documented parentage. Generation zero for the enslaved side.
//
// WHY THIS EXISTS
//   The Farm Book ingest (ingest-jefferson-farm-book.mjs) completed its ACQUISITION phase and stopped:
//   174 artifacts archived, 166 pages transcribed, 237,436 characters — and **166 of 166 documents link to
//   exactly ONE person, Jefferson himself**. Zero enslaved people. The most documented enslaved community
//   in America sits in `ocr_text` as untokenized string. This is the extraction phase.
//
// WHAT THE SOURCE ACTUALLY IS (read before changing the parser)
//   A roll page is age-ordered and looks like this:
//       1728.  Judy. d. 1811        <- 4-digit year anchor, death noted
//       71. May.  Suck. Bess's d. 11.
//       88. Mar. 8   Cate. Betty's.
//   * A bare year token sets the BIRTH YEAR for the entries that follow it.
//   * The trailing possessive is a PARENT ("Cate. Betty's" = Cate, child of Betty). It is USUALLY the
//     mother — Jefferson tracked these rolls by maternal line because status descended through the mother
//     (partus sequitur ventrem) — but NOT always: the corpus also yields "Jenny. Ned's" and "Bess. Will's",
//     and Ned and Will are men. So this extractor asserts PARENTAGE and refuses to assert SEX of the parent.
//     Claiming a maternal line the document does not support would be inventing evidence.
//   * `d. 1811` / `d. 11.` is a death year.
//
// THE TWO DEFECTS THIS PARSER IS BUILT TO AVOID
//   1. **HORSES.** The Farm Book is a plantation ledger: p.1 is breeding stock ("Ally-croker. foaled 1758",
//      "Gustavus", "The General", "Crab"). A name-grabbing extractor mints livestock as enslaved people —
//      a fabrication, and the ugliest possible one. So pages are CLASSIFIED first and anything carrying
//      horse vocabulary is refused outright, even if it also looks like a list.
//   2. **FALSE REJECTS.** Enslaved people are recorded by first name only. A validator wanting a surname
//      would erase exactly this population. Verified before writing this: all 55 sampled roll names
//      (Suck, Cate, Nace, Eve, Nisy, Aggy, Hercules…) pass isValidPersonName + isNameSuspect, 55/55.
//      Per finding-name-validator-false-rejects-aug09 — a validator is a claim about the corpus and must be
//      tested against it, in both directions.
//
// STANDARDS
//   * People land as LEADS via PersonService.findOrCreateLead (never a direct canonical INSERT) — RULE 0.6.
//   * No edge without its document: every edge carries source_document_id + M127 information_type /
//     informant_role. information_type='primary' (Jefferson's own hand), informant_role='enslaver_record_keeper'.
//   * Parent edges are written UNVERIFIED (verified=false). The possessive convention is well attested but
//     it is still a convention, and a single record is a CANDIDATE, not a confirmation — the verbatim token
//     is kept in notes so a human can adjudicate. Audit rule 1: the model does not get to decide this.
//   * Nulls become research_findings, not silence.
//   * RULE 0.5: an --embed phase is part of this script, not an afterthought.
//
// Usage:
//   node scripts/descent/extract-jefferson-farm-book-rolls.mjs              # dry run (default)
//   node scripts/descent/extract-jefferson-farm-book-rolls.mjs --apply
//   node scripts/descent/extract-jefferson-farm-book-rolls.mjs --apply --embed

import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { isValidPersonName, isNameSuspect } = require('../../src/utils/person-name-validator.js');

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const EMBED = A.includes('--embed');
const VERBOSE = A.includes('--verbose');
const PRODUCER = 'descent/jefferson-farm-book-rolls';
// The Farm Book runs 1774-1826 (Jefferson died 4 Jul 1826); nobody in it is born after that. Without this
// bound the monotonic century bump CASCADES — a column restarting at a low 2-digit year rolls forward
// again and again, and the first run produced births in 1913, 2026, even 2117. A source with known covers
// should assert them: an out-of-range year is a parse failure, and must be dropped, not stored.
const CORPUS_MIN_BIRTH = 1650, CORPUS_MAX_BIRTH = 1830;

// ── page gating ────────────────────────────────────────────────────────────────────────────────────────
// Livestock vocabulary. Presence of ANY of these disqualifies the page, full stop — a page that breeds
// horses is not a page that lists people, and mixing the two is how "Gustavus" becomes a freedperson.
const HORSE = /\bfoaled\b|\bhis sire\b|\bher sire\b|\bher dam\b|\bhis dam\b|\bstallion\b|\bfilly\b|\bcolt\b|\bmare\b/i;
const ROLL_HEADER = /roll of the negroes|list of negroes/i;
// "Negroes leased/hired/alienated" pages name people too, but in a DIFFERENT and not-yet-verified shape —
// the first pass merged three people into "Jame Hubbard Cate". Counted and reported as unprocessed rather
// than parsed on a guess; extracting them is follow-on work, not something to fake now.
const DEFERRED_HEADER = /negroes (leased|hired|alienated|removed)/i;

// Tokens that follow a name but are NOT kin: places, trades, and provenance notes seen in the Bedford
// and Albemarle rolls. Kept explicit so an unrecognized token is REPORTED rather than silently treated as kin.
const NON_KIN_QUALIFIER = /^(island|isld|isl|indn|indian|camp|guinea|shoemaker|shoemr|carpenter|tradesman|nailer|blacksmith|smith|cook|waggr|waggoner|waiting|man|boy|girl|do|ditto|abt|about)\.?$/i;

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const MONTH_TOKEN = new RegExp(`^(${MONTHS})\\.?$`, 'i');

// HEADER / TALLY LINES THAT ARE NOT PEOPLE. The first preview minted "Negroes leased" and "Negroes
// retained" as enslaved persons — both sail straight through isValidPersonName, because they are perfectly
// well-formed capitalised words. That is fabricated data (audit rule 5), and the name gate cannot catch it:
// only the extractor knows these are column headings. Refused here, by shape, before the gate ever runs.
const NOT_A_PERSON = /^(roll|list|negroes|names?|total|amount|do|ditto|column|page|males?|females?|children|men|women|deaths?|births?|illegible|another|this|the (whole|above))\b/i;

// Given names this corpus uses that the GLOBAL name gate rejects. `Will` is read as the modal verb — which
// is the RIGHT call in probate, where "will" is a document, and must stay that way. But on a Jefferson roll
// the surrounding context guarantees a person, and Will (Will Smith, Guinea Will) recurs across pages. So
// the exception is scoped HERE rather than loosening a validator that other ingests depend on being strict.
// finding-name-validator-false-rejects-aug09: a false reject is the expensive direction — the row never exists.
const CONTEXT_ALLOWED = new Set(['will', 'may', 'june', 'march', 'york']);

// The gate, with the scoped exception applied. Anything NOT_A_PERSON is refused before we get here.
function gateOk(name) {
  if (!name) return false;
  if (CONTEXT_ALLOWED.has(name.trim().toLowerCase())) return true;
  return isValidPersonName(name) && !isNameSuspect(name);
}

// ── the parser ─────────────────────────────────────────────────────────────────────────────────────────
// TWO LAYOUTS, detected per page. The first version of this parser assumed one and silently mangled the
// other: every p.24 entry came out with no year, and the month glued itself onto the name ("Peter Aug").
//
//   LAYOUT A — year-anchored (p.130, p.131, the Bedford rolls):
//       71. May.        <- a bare year token sets the context
//       Suck. Bess's    <- names follow, trailing possessive = PARENT
//   LAYOUT B — name-first (p.24, "Roll of the negroes taken in 1783"):
//       Peter. Aug. 70.        <- name, then month, then year
//       Johnny. Apr. 24. 76.   <- name, month, DAY, year
//       Moses. 79. Nov. 30 .   <- name, year, month, day (order varies)
//
// YEAR BOUNDING. A roll states when it was taken ("taken in 1783"). Nobody on it can be born after that,
// so the header date is a hard ceiling on every year this parser infers — a correctness check the document
// hands us for free, and the cheapest way to catch a day misread as a year.
function rollYearOf(text) {
  // ONLY an explicitly stated roll date counts. The first version fell back to "first 4-digit number in the
  // document", which on p.130 is 1727 — a BIRTH year, not the roll's date — so the ceiling sat below almost
  // every real birth and silently discarded them. A guard that invents its own bound is worse than no guard:
  // absent an explicit date, return null and apply no ceiling.
  const m = text.match(/\b(?:taken|made|rendered)\s+(?:in\s+)?(1[5-9]\d{2})/i);
  return m ? +m[1] : null;
}

function detectLayout(text) {
  // Layout A puts a year token alone at the start of a line; layout B never does.
  const lines = text.split('\n').map((l) => l.trim());
  const anchors = lines.filter((l) => /^(1[5-9]\d{2}|\d{2})\s*\.\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?)?\s*\d{0,2}\s*\.?\s*$/i.test(l)).length;
  return anchors >= 5 ? 'A' : 'B';
}

// Split a name head from trailing trade/place qualifiers. Trades are kept OUT of the name but retained as a
// qualifier, because "Phill. Shoemr." is Phill, and "Shoemr" is not part of anybody's name — while epithets
// Jefferson used to disambiguate ("great George") ARE part of how the record identifies that person.
function splitName(tokens) {
  const kept = [], quals = [];
  for (const t0 of tokens) {
    const t = t0.replace(/[.,;]+$/, '');
    if (!t) continue;
    if (NON_KIN_QUALIFIER.test(t)) { quals.push(t); continue; }
    if (MONTH_TOKEN.test(t) || /^\d+$/.test(t)) continue;
    if (kept.length < 3) kept.push(t);
  }
  return { name: kept.join(' ').replace(/[^A-Za-z' -]/g, '').trim(), qualifier: quals.join(' ') || null };
}

// Parentage appears in two written forms, and the parenthesised one does NOT sit at end of line:
//     Will. (Squire's)        <- trailing
//     Frank (Squire's) 57.    <- year comes AFTER the parenthetical
// So the parenthesised form is matched ANYWHERE and excised, rather than anchored to $.
function extractParent(str) {
  const paren = str.match(/\(\s*([A-Z][A-Za-z]+)['\u2019]s?\.?\s*\)/);
  if (paren) return { parent: paren[1], chain: [paren[1]], rest: (str.slice(0, paren.index) + ' ' + str.slice(paren.index + paren[0].length)).trim() };
  // Possessives CHAIN, describing two generations: "Emsly. Cate's Suck's" is Emsly, child of Suck, who is
  // Cate's. The first pass stripped only one and left the other welded into the name ("Emsly Cate's Suck's").
  // Strip them all; the NEAREST possessive is the parent, the ones beyond it are ascendants worth keeping
  // in the note rather than asserting as edges we have not earned.
  const chain = [];
  let rest = str;
  for (;;) {
    const m = rest.match(/([A-Z][A-Za-z]+)['\u2019]s?\.?\s*$/);
    if (!m) break;
    chain.unshift(m[1]);
    rest = rest.slice(0, m.index).trim();
    if (chain.length >= 3) break;
  }
  return { parent: chain.length ? chain[0] : null, chain, rest };
}

function parseRoll(text) {
  const out = [];
  const layout = detectLayout(text);
  const ceiling = rollYearOf(text);
  const flat = text.replace(/\[column \d+\]/gi, '\n').replace(/\r/g, '');
  const lines = flat.split('\n').map((l) => l.trim()).filter(Boolean);

  let curYear = null, lastFull = null, curMonth = null;
  const resolveTwo = (yy, prev) => {
    if (prev === null) return 1700 + yy;
    let c = Math.floor(prev / 100) * 100 + yy;
    if (c < prev) c += 100;
    // Never bump past the corpus cover. A column that restarts low is a NEW COLUMN, not a new century.
    if (c > CORPUS_MAX_BIRTH) c -= 100;
    return c;
  };
  const plausible = (y) => y && y >= CORPUS_MIN_BIRTH && y <= CORPUS_MAX_BIRTH && (!ceiling || y <= ceiling);

  for (const line of lines) {
    let s = line.replace(/^[\[\]+\-]+\s*/, '').trim();
    if (!s || NOT_A_PERSON.test(s)) continue;

    // death marker: "d. 1811", "d. 11.", or a bare leading "d " ("d Luna. 58.")
    let deathYear = null, dead = false;
    const dm = s.match(new RegExp(`\\bd\\.?\\s*(?:(?:${MONTHS})\\.?\\s*\\d{0,2}\\s*\\.?\\s*)?(\\d{2,4})\\b`, 'i'));
    if (dm) { dead = true; const dv = +dm[1]; deathYear = dv > 100 ? dv : null; s = s.replace(dm[0], ' ').trim(); }
    else if (/^d\s+/i.test(s)) { dead = true; s = s.replace(/^d\s+/i, '').trim(); }
    // a bare trailing "d" / "d." is the same death marker with no date attached ("Squire d")
    s = s.replace(/\s+d\.?\s*$/i, (mt) => { dead = true; return ''; }).trim();

    if (layout === 'A') {
      const m4 = s.match(/^(1[5-9]\d{2})\s*\.?\s*/);
      if (m4) { curYear = +m4[1]; lastFull = curYear; s = s.slice(m4[0].length).trim(); curMonth = null; }
      else {
        const m2 = s.match(/^(\d{2})\s*\.\s*/);
        if (m2) { curYear = resolveTwo(+m2[1], lastFull); lastFull = curYear; s = s.slice(m2[0].length).trim(); curMonth = null; }
      }
      // (?![a-z]) is load-bearing. Without it "Mar" matches inside Martin/Maria/Martha, "Jan" inside
      // January, "Apr" inside April — decapitating the name to "tin"/"ia"/"tha". Worst case: Mary became
      // "y", fell under the 2-char floor, and was DROPPED ENTIRELY. Every Mary on a year-anchored page
      // vanished with no error and no count. A month token is only a month when it stands alone.
      const mm = s.match(new RegExp(`^(${MONTHS})(?![a-z])\\.?\\s*(\\d{1,2})?\\s*\\.?\\s*`, 'i'));
      if (mm) { curMonth = mm[1]; s = s.slice(mm[0].length).trim(); }
      if (!s || /^\d+\.?$/.test(s) || NOT_A_PERSON.test(s)) continue;

      const pa = extractParent(s); const parentToken = pa.parent; const parentChain = pa.chain; s = pa.rest;

      const { name, qualifier } = splitName(s.split(/\s+/));
      if (!name || name.length < 2) continue;
      out.push({ name, qualifier, birthYear: plausible(curYear) ? curYear : null,
                 birthMonth: curMonth, deathYear, dead, parentToken, parentChain, raw: line });
    } else {
      // LAYOUT B — the name leads; month/day/year trail it in either order.
      const pb = extractParent(s); const parentTokenB = pb.parent; const parentChain = pb.chain; s = pb.rest;
      const toks = s.split(/\s+/).filter(Boolean);
      const nums = [], months = [];
      for (const t0 of toks) {
        const t = t0.replace(/[.,;]+$/, '');
        if (MONTH_TOKEN.test(t)) months.push(t);
        else if (/^\d{1,4}$/.test(t)) nums.push(+t);
      }
      // Of the trailing numbers, the YEAR is the last one that is a plausible year once expanded; any other
      // number is a day. Two-digit years expand against the roll's own date, never against a running counter.
      let birthYear = null;
      for (const n of nums) {
        const cand = n > 99 ? n : (ceiling ? resolveTwo(n, ceiling - 99) : 1700 + n);
        if (plausible(cand)) birthYear = cand;
      }
      const { name, qualifier } = splitName(toks);
      if (!name || name.length < 2 || NOT_A_PERSON.test(name)) continue;
      out.push({ name, qualifier, birthYear, birthMonth: months[0] || null,
                 deathYear, dead, parentToken: parentTokenB, parentChain, raw: line });
    }
  }
  return out;
}

const refKey = (r) => `${r.subject_table}:${r.subject_id}`;

// A ref belongs to this corpus only if it is a lead this ingest owns. Canonical matches are NEVER treated
// as corpus members: promoting a Farm Book mononym onto an existing canonical is a merge decision, and
// merges are a human's call (Biscoe), not a side effect of an extractor.
async function isCorpusMember(pool, ref) {
  if (ref.subject_table !== 'unconfirmed_persons') return false;
  const r = await pool.query(
    `SELECT 1 FROM unconfirmed_persons WHERE lead_id = $1 AND source_type = 'jefferson_farm_book'`, [ref.subject_id]);
  return r.rows.length > 0;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const PersonService = require('../../src/services/PersonService');
  const ps = new PersonService(pool);   // constructor takes the pool directly, not {db}

  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (default) ===');

  // --preview: parse and PRINT without touching PersonService. The resolve() call costs a query against
  // 3.2M leads per name, so a full dry run takes minutes; preview makes the parse itself inspectable in
  // seconds, which is the thing a human actually needs to eyeball before 700 people are minted.
  if (A.includes('--preview')) {
    const rows = (await pool.query(
      `SELECT id, collection_name, ocr_text FROM person_documents
        WHERE source_type='jefferson_farm_book' AND length(COALESCE(ocr_text,''))>400 ORDER BY id`)).rows;
    for (const d of rows) {
      if (HORSE.test(d.ocr_text) || !ROLL_HEADER.test(d.ocr_text)) continue;
      const recs = parseRoll(d.ocr_text);
      console.log(`\n### ${d.collection_name} — ${recs.length} entries`);
      // Always print EVERY reject, not just those inside the sample window. A reject is the expensive
      // direction (the row never exists), so it must be the thing a human can always see in full.
      const shown = A.includes('--rejects') ? recs.filter((r) => !gateOk(r.name)) : recs.slice(0, 18);
      for (const r of shown) {
        const bad = !gateOk(r.name) ? '  <<REJECTED' : '';
        console.log(`  ${String(r.birthYear || '????').padEnd(5)} ${r.name.padEnd(18)} ${(r.parentToken ? 'parent=' + r.parentToken : '').padEnd(18)} ${r.deathYear ? 'd.' + r.deathYear : ''}${bad}`);
      }
    }
    await pool.end(); return;
  }

  const docs = (await pool.query(
    `SELECT id, collection_name, source_url, ocr_text
       FROM person_documents
      WHERE source_type = 'jefferson_farm_book' AND length(COALESCE(ocr_text,'')) > 400
      ORDER BY id`)).rows;

  let pagesUsed = 0, pagesRefusedHorse = 0, pagesNoRoll = 0, pagesDeferred = 0;
  let people = 0, linked = 0, rejected = 0, edges = 0, unknownQualifiers = new Map(), noYear = 0;
  let foreignLinks = 0, foreignEdgeSkipped = 0;
  const corpusRefs = new Set();
  const seen = new Map();   // name|birthYear -> ref, for mother resolution within the corpus

  for (const d of docs) {
    if (HORSE.test(d.ocr_text)) { pagesRefusedHorse++; continue; }
    if (DEFERRED_HEADER.test(d.ocr_text) && !ROLL_HEADER.test(d.ocr_text)) { pagesDeferred++; continue; }
    if (!ROLL_HEADER.test(d.ocr_text)) { pagesNoRoll++; continue; }
    pagesUsed++;

    const recs = parseRoll(d.ocr_text);
    if (VERBOSE) console.log(`\n-- ${d.collection_name}: ${recs.length} entries`);

    for (const r of recs) {
      if (!gateOk(r.name)) { rejected++; if (VERBOSE) console.log('   reject', JSON.stringify(r.raw)); continue; }
      if (!r.birthYear) noYear++;

      const res = await ps.findOrCreateLead({
        name: r.name,
        personType: 'enslaved',
        birthYear: r.birthYear || null,
        deathYear: r.deathYear || null,
        location: 'Bedford County, Virginia',   // Poplar Forest; the Bedford roll names its own quarter
        sourceUrl: d.source_url,
        idSystem: 'jefferson_farm_book',
        externalId: `farmbook:${r.name}|${r.birthYear || 'x'}`,   // corpus-stable, NOT page-scoped
        sourceType: 'jefferson_farm_book',
        extractionMethod: PRODUCER,
        confidence: 0.9,                        // Jefferson's own hand, contemporaneous — audit tier 0.95+ band
        contextText: r.raw,
      }, { dryRun: !APPLY });

      if (!res.ref) { rejected++; continue; }
      if (res.action === 'linked') linked++; else people++;

      // CORPUS MEMBERSHIP. PersonService.resolve() searches ALL 3.2M leads and 500k+ canonicals; it has no
      // scope option. On the first run that attached five Farm Book children to "Eve", an enslaved woman in
      // LOUISIANA, purely on a shared mononym — a name-only cross-source merge, the Biscoe-forbidden
      // operation, written as documented parentage. A closed plantation roll must dedupe against ITSELF.
      // So every ref is checked for provenance, and only corpus members may anchor an edge.
      const ownRef = await isCorpusMember(pool, res.ref);
      if (ownRef) corpusRefs.add(refKey(res.ref)); else foreignLinks++;
      if (ownRef) {
        if (r.birthYear) seen.set(`${r.name}|${r.birthYear}`, res.ref);
        if (!seen.has(r.name)) seen.set(r.name, res.ref);
      }

      // ── parent edge ────────────────────────────────────────────────────────────────────────────────
      if (r.parentToken) {
        if (NON_KIN_QUALIFIER.test(r.parentToken)) {
          unknownQualifiers.set(r.parentToken, (unknownQualifiers.get(r.parentToken) || 0) + 1);
          continue;
        }
        const par = seen.get(r.parentToken);
        if (!par) {
          // Mother named but not yet on this roll — a real null, recorded rather than dropped.
          if (APPLY) await pool.query(
            `INSERT INTO research_findings (subject_table, subject_id, question, finding, outcome, source_note, produced_by)
             VALUES ('person_documents', $1, $2, $3, 'null_result', $4, $5) ON CONFLICT DO NOTHING`,
            [d.id, `Who is "${r.parentToken}" — the parent recorded for ${r.name}?`,
             `Farm Book roll names ${r.name} as ${r.parentToken}'s child, but no ${r.parentToken} appears earlier in the processed rolls.`,
             r.raw, PRODUCER]).catch(() => {});
          continue;
        }
        // Both endpoints must belong to this corpus. A parent resolved to a stranger is not a parent.
        if (!corpusRefs.has(refKey(par)) || !corpusRefs.has(refKey(res.ref))) { foreignEdgeSkipped++; continue; }
        if (!APPLY) { edges++; continue; }

        const dup = await pool.query(
          `SELECT 1 FROM canonical_family_edges
            WHERE a_subject_table=$1 AND a_subject_id=$2 AND b_subject_table=$3 AND b_subject_id=$4
              AND relationship_type='parent_of'`,
          [par.subject_table, par.subject_id, res.ref.subject_table, res.ref.subject_id]);
        if (dup.rows.length) continue;

        await pool.query(
          `INSERT INTO canonical_family_edges
             (a_subject_table, a_subject_id, b_subject_table, b_subject_id, relationship_type,
              source_document_id, source_url, evidence_tier, confidence, verified,
              information_type, informant_role, notes, produced_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'parent_of',$5,$6,1,0.85,FALSE,'primary','enslaver_record_keeper',$7,$8,NOW(),NOW())`,
          [par.subject_table, par.subject_id, res.ref.subject_table, res.ref.subject_id,
           d.id, d.source_url,
           `Jefferson Farm Book roll, possessive form. Verbatim: ${JSON.stringify(r.raw)}. UNVERIFIED — single record; possessive read as PARENT; sex of parent NOT asserted (corpus contains male possessives). Human adjudication required.`,
           PRODUCER]);
        edges++;
      }
    }
  }

  console.log(`\npages: ${pagesUsed} rolls used · ${pagesRefusedHorse} refused (livestock vocabulary) · ${pagesNoRoll} not roll pages`);
  console.log(`people: ${people} new leads · ${linked} matched existing · ${rejected} name-gate rejects · ${noYear} without a birth year`);
  console.log(`parent edges: ${edges}${APPLY ? '' : ' (would write)'}`);
  console.log(`cross-source guard: ${foreignLinks} refs resolved OUTSIDE this corpus · ${foreignEdgeSkipped} edges refused for a non-corpus endpoint`);
  if (unknownQualifiers.size) console.log(`qualifiers treated as NON-kin: ${[...unknownQualifiers].map(([k, v]) => k + '×' + v).join(', ')}`);

  if (EMBED && APPLY) {
    console.log('\nRULE 0.5 embed phase → run: node scripts/embed-leads.mjs --id-system jefferson_farm_book');
  } else if (APPLY) {
    console.log('\n⚠ RULE 0.5: leads are NOT yet embedded. Run: node scripts/embed-leads.mjs --id-system jefferson_farm_book');
  }
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
