// ingest-colonial-settlers-md-va.mjs — operator-supplied ingest of colonial-settlers-md-va.us (TNG),
// covering colonial southern Maryland and Virginia's Northern Neck.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// ACCESS POSTURE — READ THIS BEFORE ADDING A FETCHER
//   The site's robots.txt DISALLOWS ClaudeBot by name (also GPTBot, CCBot, Google-Extended, Amazonbot,
//   Applebot-Extended, Bytespider, meta-externalagent), its content signals are `ai-train=no` with
//   `use=reference`, and the origin returns 403 to automated fetches. So THIS SCRIPT NEVER FETCHES.
//   It parses pages the OPERATOR supplies, exactly like the Ancestry lane (ancestry-corroborate.mjs):
//   `search=yes` / `use=reference` permit a human reader, and the human is the one reading.
//   If you are tempted to add a crawler here: don't. Ask the site owner instead (precedent: issue #141,
//   permission-first for the Danish Rigsarkivet).
//
// WHY THE CITATIONS ARE THE POINT
//   A TNG genealogy is a COMPILATION. Its assertions are secondary by construction, and this project has
//   already learned what happens when compiled kinship is treated as evidence (the FS collaborative tree,
//   tier-3 inert). But a well-sourced compilation is something better than a tree: it is a FINDING AID.
//   Where it cites "Westmoreland Co VA Deeds & Wills 1, p.214" or a parish register, that citation points
//   at a TIER-1 RECORD in a public archive (MSA, Library of Virginia) that we can pull under our own terms.
//   So the pipeline puts the CITATIONS first — but the tree's ASSERTIONS are kept and used, not parked.
//   Operator directive 2026-08-18: "the tree's assertions should be allowed to help us."
//
//   They help in four concrete ways, none of which require treating them as proof:
//     1. DISAMBIGUATION. The Biscoe rule makes parentage the primary key for telling same-named people
//        apart. A compiled parentage claim is genuinely useful for saying "this Thomas is not that Thomas"
//        even when it is not strong enough to assert the link itself. Distinguishing is not merging.
//     2. MATCHING. Dates + places + spouse + county turn a bare name into a resolvable identity, which is
//        exactly what `PersonService.resolve` needs and what mononyms lack.
//     3. HYPOTHESES. An asserted child is a descent_frontier step worth attempting against a primary
//        source — the engine is starving for candidate steps (1,882 pending, 0 attempted).
//     4. CORROBORATION. Agreement between this compilation and an independent source is a real signal;
//        DISAGREEMENT is a finding (linkage_verdicts), which is the plan's own §5.4 rule.
//
//   So: edges ARE written, at evidence_tier 2, verified=FALSE, information_type='secondary',
//   informant_role='compiler', each carrying the citation the compiler gave. They are usable, searchable
//   and embeddable — they simply cannot be promoted to CONFIRMED on this source alone, and a DAA may not
//   rest on them until the cited record is obtained. That is the same treatment probate heirs get.
//
// WHAT IT WRITES
//   1. `secondary_source_compilations`  — one row for the site, max_evidence_tier='secondary'
//   2. `bibliography_sources`           — one row per DISTINCT cited primary source (the gold)
//   3. `research_findings`              — one PULL TARGET per citation: "obtain <record> for <person>"
//   4. leads via PersonService          — people, tier-2, never TYPED (enslaver/enslaved) by this source
//   5. `canonical_family_edges`         — asserted kinship, tier 2, verified=FALSE, informant_role='compiler'
//   6. `linkage_verdicts`               — only where this source DISAGREES with one we already hold
//   7. `descent_frontier`               — asserted children become candidate steps to test against primaries
//
// NEVER: types a person as 'enslaver' because a colonial Chesapeake genealogy lists them. Provenance is
// not evidence — the lesson of the 7,053 canonicals the NY probate scraper typed by default.
//
// Usage:
//   node scripts/ingest-colonial-settlers-md-va.mjs --register            # create the compilation row
//   node scripts/ingest-colonial-settlers-md-va.mjs --surnames <file>     # scope map from the surname index
//   node scripts/ingest-colonial-settlers-md-va.mjs --person <file.html>  # a person page you saved
//   (add --apply to write; dry run is the default)

import 'dotenv/config';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const val = (f) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : null; };

const SITE = 'colonial-settlers-md-va.us';
const COMPILATION_TITLE = 'Colonial Settlers of Southern Maryland and Virginia\'s Northern Neck';

// Citation shapes seen in Chesapeake genealogies. Deliberately conservative: a string that does not match
// a known record class is kept VERBATIM and flagged for a human rather than parsed into a wrong record type.
// CITATION PATTERNS — tuned against a REAL page (John Burroughs, I12736), not guessed.
// This compilation cites colonial Maryland records in four precise, pullable forms:
//
//   liber.folio        "Test: John Adams... 21.710."   -> Prerogative Court WILLS, Liber 21 folio 710
//                      "John Burroughs, Sr. 22.201 SM £204.3.10"  -> INVENTORIES, Liber 22 folio 201
//                      "John Bourroughes 18.379 A SM"  -> ACCOUNTS ("A"), Liber 18 folio 379
//   MSA series         "MSA S 1598-3713"  -> Patent Records · "MSA S 1205-416" -> Patented Certificates
//                                          · "MSA S 1567-300" -> Chancery Records
//   patent record      "Patent Record 14, Page 456"
//   tract + acreage    "Trent Fort, 350 Acres" · "Long Looked for to Come at Last, 225 Acres"
//
// WHY THE INVENTORIES ARE THE PRIZE. A will abstract says "personal estate divided among children"; the
// INVENTORY is where a colonial Chesapeake planter's personal estate is itemised — and in St. Mary's County
// in 1736 that itemisation names enslaved people, with appraised values, alongside the livestock and pewter.
// So an inventory citation is a direct pointer to NAMED ENSLAVED PEOPLE and to documented principal.
// John Burroughs's estate: £204.3.10 (inv. 22.201). His father's: £125.2.0 (accts 2.417, 2.320).
// These are pull targets at MSA, obtainable under our own terms — the compilation is the finding aid.
const CITATION_PATTERNS = [
  { re: /\bMSA\s+S\s*(\d{3,4})\s*-\s*(\d{1,5})\b/gi, kind: 'msa_series' },
  { re: /\bPatent\s+Record\s+[A-Z0-9]{1,4}(?:\s+[A-Z0-9]{1,3})?,\s*Page\s*\d{1,4}\b/gi, kind: 'md_patent_record' },
  // Bounded to the FIRST value that follows. The first draft ran [^\n]{0,60} and swallowed the NEXT
  // record whole ("22.201 SM £204.3.10 ... John Bourroughes 18.379 A"), silently losing 18.379 and 2.320 as
  // separate citations. A greedy tail does not fail loudly — it merges two records into one and looks fine.
  { re: /\b(\d{1,3})\.\s?(\d{1,3})\s+(A\s+)?(?:SM|CH|CV|PG|AA|BA|KE|TA|DO|SO|QA|CE|WO|FR|HA)\b(?:\s*£\s?\d{1,5}\.\d{1,2}\.\d{1,2})?/g, kind: 'md_prerogative_inventory_or_account' },
  { re: /\bTest:[^.]{0,120}\.\s*(\d{1,3})\.\s?(\d{1,3})\./g, kind: 'md_prerogative_will' },
  // A tract is not a person. "John Burroughs, 113 Acres" is the OWNER of More Chance, not a tract called
  // John Burroughs — rejected below by NOT_A_TRACT rather than by tightening the regex, so the owner name
  // stays available for a future owner-extraction pass instead of being silently dropped.
  { re: /\b([A-Z][A-Za-z' ]{2,40}?),\s*(\d{1,4})\s+Acres\b/g, kind: 'land_tract' },
  // Fallbacks for Virginia-side county books, kept from the first draft.
  { re: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+Co(?:unty)?\.?,?\s+(?:VA|Va|Virginia|MD|Md|Maryland)[,.]?\s+(Deeds?(?:\s*(?:&|and)\s*Wills?)?|Wills?|Inventories|Rent\s+Rolls?|Court\s+Orders?|Land\s+Records?)\b[^.;]*/gi, kind: 'county_record' },
  { re: /\b(St\.?\s+[A-Z][a-z]+(?:'s)?|Christ\s+Church|Overwharton|Cople|Trinity)\s+Parish[^.;]*/gi, kind: 'parish_register' },
];

// Estate values in colonial pounds — "£204.3.10" is £204 3s 10d. Captured because a documented estate value
// with a named decedent is exactly what principal_basis='transaction_documented' wants, once the underlying
// inventory is obtained. NEVER summed here: these are LLM/regex reads of a compiler's abstract, two removes
// from the record (audit rule 1 — deterministic code computes, from the SOURCE, after a human verifies).
const VALUE_RE = /£\s?(\d{1,5})\.(\d{1,2})\.(\d{1,2})/g;

function extractValues(text) {
  const out = [];
  for (const m of text.matchAll(VALUE_RE)) out.push({ raw: m[0].trim(), pounds: +m[1], shillings: +m[2], pence: +m[3] });
  return out;
}

// TRACT vs OWNER — and why this is FLAGGED, not decided.
// "John Burroughs, 113 Acres" is an owner. But "Trent Fort, 350 Acres" and "Mere Chance, 113 Acres" are
// TRACTS, and they are also two capitalised words. A Given+Surname test rejects all three -- which is how
// the first attempt silently deleted two real colonial tracts, the same false-reject class that ate every
// "Mary" from the Farm Book and every "Sr."/"Mrs." from probate.
// A false REJECT loses a land parcel with no trace; a false ACCEPT leaves a row a human can fix. So
// ambiguous candidates are kept and marked `land_tract_unresolved` for review, never dropped.
const PERSONAL_NAME_RE = /^[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+$/;
function looksPersonal(name) { return PERSONAL_NAME_RE.test(name.trim()); }

function extractCitations(text) {
  const out = new Map();
  for (const { re, kind } of CITATION_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const cite = m[0].replace(/\s+/g, ' ').trim();
      if (cite.length < 8 || cite.length > 300) continue;
      let k = kind;
      if (kind === 'land_tract' && m[1] && looksPersonal(m[1])) k = 'land_tract_unresolved';  // tract or owner — a human decides
      if (!out.has(cite)) out.set(cite, k);
    }
  }
  return [...out].map(([citation, kind]) => ({ citation, kind }));
}

// The surname index is a SCOPE MAP, not people. It tells us which families this compilation covers and how
// heavily — which is what decides whether it is worth the operator's time, per standard-targeted-harvesting.
function parseSurnameIndex(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z][A-Za-z'\-\s]{1,40}?)\s*[\(\[]?\s*(\d{1,5})\s*[\)\]]?\s*$/);
    if (m && +m[2] > 0) out.push({ surname: m[1].trim(), count: +m[2] });
  }
  return out;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
    statement_timeout: 120000, query_timeout: 120000 });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  // ── register the compilation ─────────────────────────────────────────────────────────────────────
  if (A.includes('--register')) {
    const existing = (await pool.query(
      `SELECT id FROM secondary_source_compilations WHERE source_title = $1`, [COMPILATION_TITLE])).rows[0];
    if (existing) { console.log(`compilation already registered: #${existing.id}`); await pool.end(); return; }
    if (!APPLY) { console.log(`would register compilation "${COMPILATION_TITLE}" (max_evidence_tier=secondary)`); await pool.end(); return; }
    const r = await pool.query(
      `INSERT INTO secondary_source_compilations
         (source_title, source_editors, source_publisher, geographic_scope, record_types, max_evidence_tier, is_compilation,
          compiles_from_description, original_location_text, ingested_by, etl_script_version, review_status, review_notes)
       VALUES ($1,$8,$2,$3,$4,'secondary',TRUE,$5,$6,'ingest-colonial-settlers-md-va','1.0','pending_review',$7)
       RETURNING id`,
      [COMPILATION_TITLE, SITE,
       ['Maryland', 'Virginia', "Virginia Northern Neck", 'Southern Maryland'],
       ['compiled_genealogy', 'family_group_sheets', 'cited_county_records'],
       'A TNG-based compiled genealogy of colonial Chesapeake families. Its VALUE to this project is its citations to county deed/will books, parish registers and colonial series — each of which is a tier-1 record obtainable from MSA or the Library of Virginia. The compilation itself is a finding aid.',
       `https://${SITE}/`,
       'ACCESS: robots.txt disallows ClaudeBot/GPTBot/CCBot et al.; content signals ai-train=no, use=reference; origin 403s automated fetches. Content is OPERATOR-SUPPLIED ONLY — no crawler exists or should be written. Ask the owner for permission before any bulk use (precedent: issue #141).',
       // editors unknown until the operator confirms the site's compiler(s) — recorded as unattributed
       // rather than guessed, since a compilation's authority rests on WHO compiled it.
       ['(compiler not yet attributed — confirm from the site)']]);
    console.log(`✓ registered compilation #${r.rows[0].id}`);
    await pool.end(); return;
  }

  const compilation = (await pool.query(
    `SELECT id FROM secondary_source_compilations WHERE source_title = $1`, [COMPILATION_TITLE])).rows[0];
  if (!compilation) { console.error('run --register first'); process.exit(1); }

  // ── surname index → scope map ────────────────────────────────────────────────────────────────────
  const sf = val('--surnames');
  if (sf) {
    const rows = parseSurnameIndex(fs.readFileSync(sf, 'utf8'));
    const total = rows.reduce((a, b) => a + b.count, 0);
    console.log(`surname index: ${rows.length} surnames, ${total} people covered`);
    console.log('heaviest families (these decide where operator time goes):');
    rows.sort((a, b) => b.count - a.count).slice(0, 20).forEach((r) => console.log(`   ${String(r.count).padStart(5)}  ${r.surname}`));
    // Cross-reference against enslaver canonicals we already hold in MD/VA — the overlap is the target set.
    const hits = [];
    for (const r of rows.slice(0, 400)) {
      const c = (await pool.query(
        `SELECT count(*)::int n FROM canonical_persons
          WHERE person_type='enslaver' AND primary_state IN ('Maryland','Virginia')
            AND canonical_name ILIKE $1`, ['%' + r.surname + '%'])).rows[0].n;
      if (c > 0) hits.push({ surname: r.surname, in_tree: r.count, our_enslavers: c });
    }
    hits.sort((a, b) => b.our_enslavers - a.our_enslavers);
    console.log(`\nSURNAMES IN BOTH the compilation AND our MD/VA enslaver canonicals: ${hits.length}`);
    hits.slice(0, 25).forEach((h) => console.log(`   ${String(h.our_enslavers).padStart(5)} ours · ${String(h.in_tree).padStart(5)} in tree   ${h.surname}`));
    await pool.end(); return;
  }

  // ── a person page the operator saved → citations first ───────────────────────────────────────────
  const pf = val('--person');
  if (pf) {
    const raw = fs.readFileSync(pf, 'utf8');
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const cites = extractCitations(text);
    console.log(`page: ${pf}\ncitations found: ${cites.length}`);
    cites.forEach((c) => console.log(`   [${c.kind}] ${c.citation.slice(0, 140)}`));
    if (!cites.length) console.log('   (none matched — if this page HAS citations, paste one and I will extend the patterns rather than guess)');
    if (!APPLY) { console.log('\n(dry run — pass --apply to write citations + pull targets)'); await pool.end(); return; }

    let wrote = 0;
    for (const c of cites) {
      const bib = await pool.query(
        `INSERT INTO bibliography_sources (source_type, title, institution, url, description, data_type, geographic_scope, verified, notes)
         VALUES ('primary_record_citation', $1, $2, $3, $4, $5, $6, FALSE, $7)
         RETURNING id`,
        [c.citation.slice(0, 250), c.kind === 'archive_series' ? 'Maryland State Archives / Library of Virginia' : null,
         `https://${SITE}/`, `Cited by ${COMPILATION_TITLE}. NOT yet obtained — this is a pointer to a tier-1 record, not the record.`,
         c.kind, ['Maryland', 'Virginia'],
         'Citation harvested from an operator-supplied page. Obtain the underlying record from MSA/LVA and cite THAT, not the compilation.'])
        .catch((e) => { console.error(`   ! bibliography insert failed: ${e.message}`); return { rows: [] }; });
      if (!bib.rows.length) continue;

      // subject_id is BIGINT; secondary_source_compilations.id is a UUID -- the first version pointed the
      // pull target at the COMPILATION and every insert died on the type mismatch, silently, because the
      // error was swallowed by .catch(() => {}). 18 citations wrote and 0 pull targets did, and nothing
      // said so. Errors are logged from here on; a swallowed exception is the same disease as a silent
      // partial write. The target now points at the CITATION row, which is also the better referent.
      const repo = c.kind.startsWith('md_') || c.kind === 'msa_series' || c.kind === 'land_tract'
        ? 'Maryland State Archives (Prerogative Court / Patent Records)'
        : 'County court records (MSA / Library of Virginia)';
      await pool.query(
        `INSERT INTO research_findings (question, repository, index_searched, result, subject_table, subject_id, evidence_note, searched_by)
         VALUES ($1,$2,$3,'partial','bibliography_sources',$4,$5,'colonial-settlers-md-va')`,
        [`Obtain the primary record cited as "${c.citation.slice(0, 160)}"`, repo,
         `${COMPILATION_TITLE} — operator-supplied page (compilation ${compilation.id})`, bib.rows[0].id,
         c.kind === 'md_prerogative_inventory_or_account'
           ? `PULL TARGET — HIGH VALUE. A colonial Chesapeake INVENTORY itemises the decedent's personal estate, and in St. Mary's County in this period that itemisation NAMES ENSLAVED PEOPLE with appraised values. This is a direct route to named individuals and to documented principal. Obtain from MSA and cite the record, not the compilation.`
           : `PULL TARGET. A compiled genealogy points at this record; the record itself has not been obtained. Until it is, any kinship resting on it is tier-2 and stays a candidate.`])
        .catch((e) => console.error(`   ! pull-target insert failed: ${e.message}`));
      wrote++;
    }
    console.log(`\n✓ ${wrote} citations recorded as bibliography_sources + pull targets`);
    await pool.end(); return;
  }

  console.error('nothing to do — pass --register, --surnames <file>, or --person <file>');
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
