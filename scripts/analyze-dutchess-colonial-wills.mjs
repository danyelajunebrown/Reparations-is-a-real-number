#!/usr/bin/env node
/**
 * analyze-dutchess-colonial-wills.mjs — DRY-RUN yield analysis for the Dutchess County
 * colonial prerogative-will corpus (the 1,225 docs mis-filed under `albany` because the
 * "Albany County NY Probate Records — Wills 1629-1802" series is actually the province-wide
 * colonial will books; see memory-bank/finding-land-nonclaim-and-dutchess-audit-jul17.md).
 *
 * Purpose: prove what a colonial-book parser can recover BEFORE any DB write. Reports, per doc:
 *   - testator name (colonial "I <NAME> of <place>" opening OR the "will of the said <NAME>"
 *     probate proof clause — the two patterns the shared extractor's anchors miss),
 *   - Dutchess residence (precinct/town) + county confirmation,
 *   - enslaved evidence, distinguishing NAMED enslaved ("Negro Man Jack") from residuary
 *     BOILERPLATE ("Silver Plate Slaves Horses Cattle" — names no one).
 *
 * NO WRITES. Read-only. Emits a summary + a JSONL of per-doc results to worksheets/ for review.
 * Audit posture: this is the "prove extraction yield before promoting" step. Nothing here mints
 * a canonical or asserts a proposition; a human reads the JSONL first (Biscoe rule).
 *
 *   node scripts/analyze-dutchess-colonial-wills.mjs            # summary only
 *   node scripts/analyze-dutchess-colonial-wills.mjs --jsonl    # + worksheets/dutchess-colonial-yield.jsonl
 *   node scripts/analyze-dutchess-colonial-wills.mjs --limit 20 # sample
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Reuse the shared validator so the person-name rule cannot drift.
const require = (await import('node:module')).createRequire(import.meta.url);
const { isValidPersonName } = require('../src/utils/person-name-validator');

const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const WRITE_JSONL = process.argv.includes('--jsonl');
const LIMIT = parseInt(arg('--limit') || '0', 10);

const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();

// A capitalised name run: 2-4 tokens, each Capitalised, allowing internal apostrophes.
// Van/Ten/De particles are lowercased in some records but Capitalised in most; accept both.
const NAME_TOK = "[A-Z][a-zA-Z'.]*";
const PARTICLE = "(?:van|ten|de|der|den|von|la|le)";
const NAME_RUN = `${NAME_TOK}(?:\\s+(?:${PARTICLE}\\s+)?${NAME_TOK}){1,3}`;

// Tokens that, if they lead the captured run, mean we grabbed boilerplate not a name.
const BAD_LEAD = new Set(['the', 'said', 'my', 'his', 'her', 'their', 'our', 'this', 'that',
  'all', 'god', 'amen', 'item', 'imprimis', 'lastly', 'sundry', 'whereas', 'being', 'unto']);

// Clause words that bleed onto the end of a captured name run when the OCR runs the
// name into the next phrase ("...said James Uriah Ross bearing date..." → drop "bearing").
const NAME_TAIL_STOP = new Set(['bearing', 'date', 'dated', 'deceased', 'decd', 'dec', "dec'd",
  'being', 'yeoman', 'farmer', 'sign', 'signed', 'late', 'widow', 'senior', 'junior', 'esquire',
  'gentleman', 'of', 'in', 'and', 'his', 'her', 'the', 'said', 'who', 'did', 'made', 'departed']);

function cleanName(raw) {
  let n = norm(raw).replace(/[.,;&]+$/, '').trim();
  let toks = n.split(/\s+/).filter(Boolean);
  // drop a leading honorific
  if (toks.length && /^(mr|mrs|miss|dr|capt|col|revd?|sir|the)$/i.test(toks[0].replace(/\./g, ''))) toks.shift();
  // trim trailing clause words that bled onto the name run
  while (toks.length > 2 && NAME_TAIL_STOP.has(toks[toks.length - 1].toLowerCase())) toks.pop();
  return toks.join(' ');
}

function acceptName(candidate) {
  if (!candidate) return null;
  const c = cleanName(candidate);
  const toks = c.split(/\s+/).filter(Boolean);
  if (toks.length < 2) return null;                       // testator always has a full name
  if (BAD_LEAD.has(toks[0].toLowerCase())) return null;
  if (!isValidPersonName(c)) return null;
  return c;
}

/**
 * Testator name from the two colonial patterns the shared extractor misses.
 * @returns {{name:string, method:string}|null}
 */
function extractColonialTestator(text) {
  // Pattern A — will opening: "... I <NAME> of <place> in ... County of Dutchess ..."
  //   "I William Butcher of Hynebeck in the County of Dutchess"
  //   "I Peter Outwater of Rumbouts Precinct in Dutchess County"
  //   "I Jennis Van Bunschoten of Rynbeck Preins, Dutchess County"
  // Anchor on " I <run> of " where the token after "of" is a PLACE (not county/state/town),
  // which is exactly the case the shared extractor's `of (county|state|town)` anchor excludes.
  const openRe = new RegExp(`\\bI\\s+(${NAME_RUN})\\s+of\\s+[A-Z]`, 'g');
  let m;
  while ((m = openRe.exec(text)) !== null) {
    const name = acceptName(m[1]);
    // Require the will-opening context nearby so we don't grab "...gave I John of..." mid-clause.
    const ctx = text.slice(Math.max(0, m.index - 60), m.index + 140);
    if (name && /(name of god|last will|testament|being.*(?:weak|sound)|yeoman|farmer)/i.test(ctx)) {
      return { name, method: 'will_opening' };
    }
  }

  // Pattern B — probate proof clause: "... will of the said <NAME> bearing date ..."
  //   "purporting to be the will of the said Zacharias Van Voorhis"
  const proofRe = new RegExp(`will\\s+of\\s+the\\s+said\\s+(${NAME_RUN})`, 'i');
  const pm = text.match(proofRe);
  if (pm) { const name = acceptName(pm[1]); if (name) return { name, method: 'probate_proof' }; }

  // Pattern C — "did see <NAME> sign and seal"
  const seeRe = new RegExp(`did\\s+see\\s+(${NAME_RUN})\\s+sign`, 'i');
  const sm = text.match(seeRe);
  if (sm) { const name = acceptName(sm[1]); if (name) return { name, method: 'proof_sign' }; }

  // Pattern D — inventory / estate account: "... Estate and Debts of <NAME> Dec'd late of ..."
  //   "A Just and true Acc. of the Personal Estate and Debts of Israel Kniffen Decd late of Fishkill"
  // Anchored on an inventory noun so we don't grab "of my Estate" or a legatee.
  const invRe = new RegExp(
    `(?:Estate|Debts|Inventory|Inventary|Appraisement|Account|Acc[t.]?)\\s+(?:and\\s+\\w+\\s+)?of\\s+(?:the\\s+)?(?:Personal\\s+Estate\\s+(?:and\\s+Debts\\s+)?of\\s+)?(${NAME_RUN})\\s+(?:Dec|late\\b)`, 'i');
  const im = text.match(invRe);
  if (im) { const name = acceptName(im[1]); if (name) return { name, method: 'inventory_of' }; }

  return null;
}

/**
 * Dutchess residence: county confirmation + precinct/town if present.
 * @returns {{county:string, place:string|null}|null}
 */
function extractResidence(text) {
  if (!/dutchess/i.test(text)) return null;
  // precinct/town before the county phrase. Tolerate OCR "Precinct/Preinct/Preins/Precent".
  let place = null;
  const precinct = text.match(/of\s+([A-Z][a-zA-Z'.]+(?:\s+[A-Z][a-zA-Z'.]+)?)\s+(?:Precinct|Preinct|Preins|Precent|Precen|Township)/);
  const inCounty = text.match(/of\s+([A-Z][a-zA-Z'.]+)\s+in\s+(?:the\s+)?(?:County of\s+)?Dutchess/);
  if (precinct) place = cleanName(precinct[1]) + ' Precinct';
  else if (inCounty && !/^(the|said|county)$/i.test(inCounty[1])) place = cleanName(inCounty[1]);
  return { county: 'Dutchess', place };
}

/**
 * Enslaved evidence. Distinguishes NAMED enslaved from residuary boilerplate.
 * @returns {{named:string[], boilerplate:boolean, tokenHit:boolean}}
 */
function extractEnslaved(text) {
  const tokenHit = /\b(negro|negroe|slaves?|wench|mulatto|manumit)/i.test(text);
  // NOTE the /i flag throughout: without it the descriptor ("Man") is captured and rejected, and
  // the real name after it is never reached (the bug the first dry-run surfaced — Kniffen's Jack).
  const named = [];
  // Words that are NOT enslaved-person names when captured after a descriptor/"Named"/ditto.
  const STOP = /^(man|woman|boy|girl|wench|fellow|lad|slave|slaves|named|nam|call|called|and|the|his|her|him|men|women|late|old|young|do|do|ditto|dito|viz|item|negro|negroe|mulatto|one|two|three|four|five|six|dupl|blk|red)$/i;
  const isName = (c) => c && /^[A-Z][a-z]{2,}$/.test(c) && !STOP.test(c);

  // (a) PROSE / will form — each enslaved person carries their own "Negro <desc> [Named] <Name>".
  //   "Negro Man Jack", "Negro Woman Named Nanny", "my Negro girl Bett", "Negro named Harry".
  //   Catches multi-bequest wills (Sebring → York/Nanny/Jean/Rose — each has its own descriptor).
  const descRe = /\bnegro(?:e)?\s+(?:man|woman|boy|girl|wench|fellow|lad|men|women)\s+(?:named\s+|called\s+)?([A-Z][a-z]{2,})/gi;
  const namedFormRe = /\b(?:negro(?:e)?|mulatto|slave)\s+(?:named|called)\s+([A-Z][a-z]{2,})/gi;
  // Paired form: "two Negro Girls the one Named Rachel and the other Eunice" — the second person
  // has no descriptor of their own, just "and the other <Name>". Only fire it near a slavery token.
  const pairRe = /\band\s+the\s+other\s+(?:named\s+|call(?:ed)?\s+)?([A-Z][a-z]{2,})/gi;
  let m;
  for (const re of [descRe, namedFormRe]) {
    while ((m = re.exec(text)) !== null) if (isName(m[1])) named.push(m[1]);
  }
  // pairRe only where a slavery descriptor sits within ~60 chars before the "and the other".
  while ((m = pairRe.exec(text)) !== null) {
    if (isName(m[1]) && /negro|slaves?|wench|mulatto/i.test(text.slice(Math.max(0, m.index - 60), m.index))) {
      named.push(m[1]);
    }
  }

  // (b) INVENTORY-RUN form — enslaved people are listed together, before the livestock, as a run
  //   of "Named <Name>" + ditto ("do <Name>"): "Negro Man Jack do --- Marry - 301.0.0 - one Old
  //   Horse" / "Negro Man named Prince Named Cato do Woman Named Mill ... Named Flora ... Boy
  //   Named Bas : blk Horse". The prose regex only gets the FIRST (Jack/Prince). Here: when a
  //   livestock/goods word closely FOLLOWS a "Negro" mention, the span between them is an enslaved
  //   inventory run — collect every capitalised token in it that isn't a descriptor/ditto/number.
  //   Bounded to that span so prose wills (no goods word after) never enter this mode, which would
  //   otherwise sweep up heirs' names (e.g. Sebring's daughter Katherine).
  const GOODS = /\b(horses?|mares?|cows?|oxen|ox|bulls?|heff?ers?|calf|calves|colts?|coll|sheep|hogs?|swine|steers?|stallions?|feather|beds?|pewter|silver\s+plate|plate|acres?|barn|hay|cart|wag+on|chains?|guns?|kettles?|tables?|chairs?|cupboard|cubbard|bushels?|pounds?\b)/i;
  const negRe = /\bnegro(?:e)?s?\b/gi;
  // Within an inventory run, only ANCHORED names count — a name that immediately follows "Named",
  // a body descriptor, or a ditto ("do"). Collecting every capitalised token instead swept up
  // heirs, verbs (Give/Bequeath), and OCR noise (Sorrel horses); the anchor is what makes it an
  // enslaved person and not just a capitalised word inside the span. The three anchors run as
  // INDEPENDENT /g passes: a single combined alternation lets one anchor consume the "Named" that
  // should anchor the next name ("do - Named - Flora" ate Flora's anchor), dropping people.
  const RUN_ANCHORS = [
    /(?:named|call(?:ed)?)[\s\-.]+([A-Z][a-z]{2,})/gi,               // "Named Flora"
    /(?:\bman|\bwoman|\bboy|\bgirl|\bwench|\bfellow|\blad)[\s\-.]+([A-Z][a-z]{2,})/gi, // "Man Jack"
    /\bdo[\s\-.]+([A-Z][a-z]{2,})/gi,                                // ditto "do --- Marry"
  ];
  let nm;
  while ((nm = negRe.exec(text)) !== null) {
    const window = text.slice(nm.index, nm.index + 170);
    const g = window.search(GOODS);
    if (g < 0) continue;                       // no goods word close after → prose, handled in (a)
    const run = window.slice(0, g);            // the enslaved run, up to the first livestock/goods
    for (const re of RUN_ANCHORS) { let rm; while ((rm = re.exec(run)) !== null) if (isName(rm[1])) named.push(rm[1]); }
  }
  // Boilerplate residuary: "Slaves Horses Cattle" / "Silver Plate Slaves" — chattel LIST, no name.
  const boilerplate = /(silver\s+plate|horses?)\s+(?:and\s+)?slaves|slaves\s+(?:and\s+)?(?:horses?|cattle|chattels)/i.test(text)
                      && named.length === 0;
  return { named: [...new Set(named)], boilerplate, tokenHit };
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const rows = (await pool.query(`
    SELECT id, document_type, document_year, name_as_appears, enslaved_count, ocr_text
    FROM person_documents
    WHERE ocr_text ILIKE '%dutchess%'
    ORDER BY id
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}`)).rows;

  const out = [];
  let gotName = 0, gotNameNew = 0, gotResidence = 0, gotPlace = 0,
      slaveryToken = 0, namedEnslaved = 0, boilerplateOnly = 0, namesRecovered = 0;
  const byMethod = {};

  for (const r of rows) {
    const text = norm(r.ocr_text);
    const testator = extractColonialTestator(text);
    const residence = extractResidence(text);
    const enslaved = extractEnslaved(text);

    if (testator) {
      gotName++;
      byMethod[testator.method] = (byMethod[testator.method] || 0) + 1;
      // "new" = we recovered a name where the carry-forward parser had none or a bogus placeholder
      const existing = r.name_as_appears || '';
      if (!existing || /^image\s+\d+$/i.test(existing) || existing.toLowerCase() !== testator.name.toLowerCase()) gotNameNew++;
    }
    if (residence) { gotResidence++; if (residence.place) gotPlace++; }
    if (enslaved.tokenHit) slaveryToken++;
    if (enslaved.named.length) { namedEnslaved++; namesRecovered += enslaved.named.length; }
    else if (enslaved.boilerplate) boilerplateOnly++;

    out.push({
      doc_id: r.id, type: r.document_type, year: r.document_year,
      old_name: r.name_as_appears || null,
      testator: testator?.name || null, name_method: testator?.method || null,
      county: residence?.county || null, place: residence?.place || null,
      enslaved_named: enslaved.named, enslaved_boilerplate: enslaved.boilerplate,
    });
  }

  console.log(`\n=== DUTCHESS COLONIAL-WILL YIELD (dry-run, ${rows.length} docs, NO writes) ===`);
  console.log(`Testator name recovered:        ${gotName} (${(100*gotName/rows.length).toFixed(1)}%)`);
  console.log(`  ...of which new/corrected:    ${gotNameNew}`);
  console.log(`  by method:                    ${JSON.stringify(byMethod)}`);
  console.log(`Dutchess residence confirmed:   ${gotResidence} (${(100*gotResidence/rows.length).toFixed(1)}%)`);
  console.log(`  ...with a precinct/town:      ${gotPlace}`);
  console.log(`Slavery token present:          ${slaveryToken}`);
  console.log(`  NAMED enslaved persons:       ${namedEnslaved} docs → ${namesRecovered} names`);
  console.log(`  residuary boilerplate only:   ${boilerplateOnly} (chattel-list, no person — do NOT mint)`);

  // Show the docs that recovered a named enslaved person — the DAA-critical ones.
  console.log(`\n--- docs with NAMED enslaved persons (the enslaved-side seeds) ---`);
  for (const o of out.filter(o => o.enslaved_named.length)) {
    console.log(`  doc ${o.doc_id} | ${o.testator || '(no testator)'} of ${o.place || o.county || '?'} | enslaved: ${o.enslaved_named.join(', ')}`);
  }

  if (WRITE_JSONL) {
    const dir = path.resolve(__dirname, '../worksheets');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'dutchess-colonial-yield.jsonl');
    fs.writeFileSync(f, out.map(o => JSON.stringify(o)).join('\n') + '\n');
    console.log(`\nWrote ${out.length} rows → ${f} (for human review before any promotion)`);
  }

  await pool.end();
})().catch(e => { console.error('ANALYZE_ERROR', e.message); process.exit(1); });
