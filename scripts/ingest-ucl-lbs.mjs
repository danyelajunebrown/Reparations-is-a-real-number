// ingest-ucl-lbs.mjs — stage-2 promotion for the UCL LBS scrape.
//
// Turns the raw archived HTML (lbs_raw_records, filled by ucl-lbs-wayback.mjs) into the SPINE + typed
// LBS tables (M120), via the pure parser src/services/lbs/lbs-parser.js. Two resumable passes:
//   --parse    : read lbs_raw_records where parsed IS NULL, pull HTML from S3, parseLbs → parsed JSONB.
//   --promote  : read parsed rows → typed tables (lbs_claims/…) + persons via PersonService.
//   --fixtures : parse+promote the 4 local fixtures (offline dev/test; implies both passes on files).
//
// DISCIPLINE (memory-bank/standard-external-source-ingest + canonical/document-gate):
//   * Persons → PersonService.findOrCreateLead with FULL attrs (rule #3); id_system='ucl_lbs_person'
//     (product-specific, rule #4). Gated SECONDARY leads (LBS is a scholarly DB, tier ~0.85) — the
//     archived page is a compilation, NOT a proposition-specific primary doc, so gates stay closed.
//   * Idempotent: dedup persons on person_external_ids(ucl_lbs_person) BEFORE create (resolve() external
//     tier-1 only sees canonicals, so we check the polymorphic lead ids ourselves).
//   * NO placeholder/"Unnamed" enslaved persons (audit #5): LBS rarely names the enslaved — enslaved
//     COUNTS live as integers on lbs_claims / lbs_estate_registrations, never as minted person rows.
//   * Dual-ledger (audit #3): comp £ = debt evidence; as-transcribed, NOT summed.
//   * Per-colony control-total TRIPWIRE (rule #2): logs SUM(enslaved_count)+claim count per colony as a
//     sanity surface (full BPP colony-total comparison = a follow-up once those figures are loaded).
//   * personType='enslaver' ONLY when the person carries ≥1 associated compensation claim (owner-class);
//     otherwise 'unknown' (avoids over-typing spouses/firm associates — #96).
//
// Order matters: promote PERSONS first (rich leads), then estate/claim/firm (link to existing leads;
// referenced persons without an archived page get a minimal name+ext_id lead).
//
// Usage:
//   node scripts/ingest-ucl-lbs.mjs --fixtures                 # offline dry-run over tests/fixtures
//   node scripts/ingest-ucl-lbs.mjs --fixtures --apply         # offline, writes to DB
//   node scripts/ingest-ucl-lbs.mjs --parse --limit 500        # S3 HTML -> parsed JSONB (needs --apply)
//   node scripts/ingest-ucl-lbs.mjs --promote --apply          # parsed -> spine + typed tables
//   flags: --apply (default dry-run) · --limit N · --type claim|person|estate|firm

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');
const PersonService = require('../src/services/PersonService');
const { parseLbs } = require('../src/services/lbs/lbs-parser');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = has('--apply');
const LIMIT = parseInt(val('--limit', '0'), 10) || Infinity;
const ONLY_TYPE = val('--type', null);
const MODE = has('--fixtures') ? 'fixtures' : has('--parse') ? 'parse' : has('--promote') ? 'promote' : null;

const ID_SYSTEM = 'ucl_lbs_person';
const SOURCE = (t, id) => `https://www.ucl.ac.uk/lbs/${t}/view/${id}`;
const clip = (s, n = 500) => (s == null ? null : String(s).slice(0, n));

// ── person promotion — dedup is OWNED HERE via an in-memory ext-id cache + an EXPLICIT (non-swallowed)
// person_external_ids write. We do NOT rely on findOrCreateLead's internal ext-id write: it wraps the
// insert in `.catch(()=>{})`, which under bulk left leads without ext-ids, so resolveByExtId kept
// missing and re-created the same LBS person on every reference (2.9x duplication). The cache guarantees
// exactly one lead per LBS ext_id within a run; the explicit write guarantees persistence across runs.
async function loadExtIdCache(db) {
  const cache = new Map();
  const r = await db.query(`SELECT external_id, subject_table, subject_id FROM person_external_ids WHERE id_system=$1`, [ID_SYSTEM]);
  for (const row of r.rows) cache.set(String(row.external_id), { subject_table: row.subject_table, subject_id: Number(row.subject_id) });
  return cache;
}

// Get-or-create the LBS person for `extId`. `rich` (optional) = the full person-page attrs. Returns the ref.
async function getOrCreatePerson(svc, db, extId, name, rich, stats, cache, dry) {
  const key = String(extId);
  if (cache.has(key)) { stats.person_linked++; return cache.get(key); }
  if (!name && !(rich && rich.name)) return null;
  if (dry) { stats.person_would_create++; const ref = { subject_table: 'unconfirmed_persons', subject_id: null }; cache.set(key, ref); return ref; }
  const record = rich || { name, personType: 'unknown', confidence: 0.8 };
  const out = await svc.findOrCreateLead({
    name: record.name, birthYear: record.birthYear || null, deathYear: record.deathYear || null,
    locations: record.locations || null, externalId: key, idSystem: ID_SYSTEM, sourceUrl: SOURCE('person', extId),
    personType: record.personType || 'unknown', sourceType: 'scholarly', confidence: record.confidence || 0.8,
    context: record.context || null, relationships: record.relationships || [],
  });
  if (!out.ref || out.ref.subject_id == null) return null;
  // EXPLICIT ext-id write (surface errors — do NOT swallow); ON CONFLICT keeps it on the first lead.
  await db.query(
    `INSERT INTO person_external_ids (subject_table, subject_id, id_system, external_id, external_url, confidence)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id_system, external_id) DO NOTHING`,
    [out.ref.subject_table, out.ref.subject_id, ID_SYSTEM, key, SOURCE('person', extId), 0.85]);
  cache.set(key, out.ref);
  if (out.action === 'created') stats.person_created++; else stats.person_linked++;
  return out.ref;
}

// Build the rich record from a parsed PERSON page (bio/occupation/relationships/addresses).
function richPersonRecord(rec) {
  const isOwner = (rec.claims && rec.claims.length > 0);
  const relationships = [];
  if (rec.spouse) relationships.push({ type: 'spouse', name: clip(rec.spouse, 200) });
  if (rec.children) relationships.push({ type: 'children', names: clip(rec.children, 300) });
  const ctx = [rec.occupation && `occupation: ${rec.occupation}`, rec.absentee && `absentee: ${rec.absentee}`,
    rec.school && `school: ${rec.school}`, rec.university && `university: ${rec.university}`,
    rec.nameInCompensationRecords && `comp-name: ${rec.nameInCompensationRecords}`].filter(Boolean).join('; ');
  return {
    name: rec.name, birthYear: rec.birthYear, deathYear: rec.deathYear,
    locations: (rec.addresses && rec.addresses.length) ? rec.addresses.map((a) => clip(a, 200)) : null,
    personType: isOwner ? 'enslaver' : 'unknown', confidence: 0.85, context: clip(ctx, 900) || null, relationships,
  };
}

async function promotePerson(svc, db, rec, extId, stats, cache, dry) {
  return getOrCreatePerson(svc, db, extId, rec.name, richPersonRecord(rec), stats, cache, dry);
}

async function promoteClaim(svc, db, rec, extId, stats, colonyTotals, cache, dry) {
  const c = rec.compensation || {};
  if (!dry) {
    await db.query(
      `INSERT INTO lbs_claims (claim_ext_id, claim_no, colony, estate_ext_id, estate_name, contested,
         award_year, award_date_raw, comp_pounds, comp_shillings, comp_pence, comp_decimal, enslaved_count,
         notes, source_url, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       ON CONFLICT (claim_ext_id) DO UPDATE SET claim_no=EXCLUDED.claim_no, colony=EXCLUDED.colony,
         estate_ext_id=EXCLUDED.estate_ext_id, estate_name=EXCLUDED.estate_name, contested=EXCLUDED.contested,
         award_year=EXCLUDED.award_year, comp_decimal=EXCLUDED.comp_decimal, enslaved_count=EXCLUDED.enslaved_count,
         comp_pounds=EXCLUDED.comp_pounds, comp_shillings=EXCLUDED.comp_shillings, comp_pence=EXCLUDED.comp_pence,
         notes=EXCLUDED.notes, updated_at=now()`,
      [String(extId), rec.claimNo, rec.colony, rec.estates?.[0]?.estateId || null, rec.estateName,
       rec.contested, rec.year, rec.date, c.pounds ?? null, c.shillings ?? null, c.pence ?? null,
       c.decimal ?? null, rec.enslavedCount ?? null, clip(rec.notes, 4000), SOURCE('claim', extId)]);
  }
  for (const ind of (rec.individuals || [])) {
    const ref = await getOrCreatePerson(svc, db, ind.personId, ind.name, null, stats, cache, dry);
    const isAwardee = /awardee/i.test(ind.role || '');
    if (!dry) await db.query(
      `INSERT INTO lbs_claim_persons (claim_ext_id, person_ext_id, subject_table, subject_id, role_raw, is_awardee)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (claim_ext_id, person_ext_id, role_raw)
       DO UPDATE SET subject_table=EXCLUDED.subject_table, subject_id=EXCLUDED.subject_id, is_awardee=EXCLUDED.is_awardee`,
      [String(extId), String(ind.personId), ref?.subject_table || null,
       ref?.subject_id || null, clip(ind.role, 200) || '', isAwardee]);
  }
  // per-colony control-total surface (rule #2)
  if (rec.colony) {
    const t = colonyTotals.get(rec.colony) || { claims: 0, enslaved: 0 };
    t.claims++; t.enslaved += rec.enslavedCount || 0;
    colonyTotals.set(rec.colony, t);
  }
  stats.claim++;
}

async function promoteEstate(svc, db, rec, extId, stats, dry) {
  if (!dry) {
    await db.query(
      `INSERT INTO lbs_estates (estate_ext_id, name, colony, parish, updated_at)
       VALUES ($1,$2,$3,$4, now()) ON CONFLICT (estate_ext_id)
       DO UPDATE SET name=EXCLUDED.name, colony=EXCLUDED.colony, parish=EXCLUDED.parish, updated_at=now()`,
      [String(extId), rec.name, rec.colony, rec.parish]);
    for (const r of (rec.registrations || [])) {
      await db.query(
        `INSERT INTO lbs_estate_registrations (estate_ext_id, reg_year, enslaved_total, enslaved_female, enslaved_male, possessor)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (estate_ext_id, reg_year)
         DO UPDATE SET enslaved_total=EXCLUDED.enslaved_total, enslaved_female=EXCLUDED.enslaved_female,
           enslaved_male=EXCLUDED.enslaved_male, possessor=EXCLUDED.possessor`,
        [String(extId), r.year, r.total, r.female, r.male, clip(r.possessor, 300)]);
    }
  }
  stats.estate++; stats.estate_regs += (rec.registrations || []).length;
}

async function promoteFirm(svc, db, rec, extId, stats, cache, dry) {
  if (!dry) await db.query(
    `INSERT INTO lbs_firms (firm_ext_id, name, updated_at) VALUES ($1,$2, now())
     ON CONFLICT (firm_ext_id) DO UPDATE SET name=EXCLUDED.name, updated_at=now()`, [String(extId), rec.name]);
  for (const pp of (rec.people || [])) {
    const ref = await getOrCreatePerson(svc, db, pp.personId, pp.name, null, stats, cache, dry);
    if (!dry) await db.query(
      `INSERT INTO lbs_firm_people (firm_ext_id, person_ext_id, subject_table, subject_id, role_raw)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (firm_ext_id, person_ext_id, role_raw)
       DO UPDATE SET subject_table=EXCLUDED.subject_table, subject_id=EXCLUDED.subject_id`,
      [String(extId), String(pp.personId), ref?.subject_table || null, ref?.subject_id || null, clip(pp.role, 200) || '']);
  }
  stats.firm++;
}

async function promoteRecord(svc, db, urlType, extId, rec, stats, colonyTotals, cache, dry) {
  if (urlType === 'person') await promotePerson(svc, db, rec, extId, stats, cache, dry);
  else if (urlType === 'claim') await promoteClaim(svc, db, rec, extId, stats, colonyTotals, cache, dry);
  else if (urlType === 'estate') await promoteEstate(svc, db, rec, extId, stats, dry);
  else if (urlType === 'firm') await promoteFirm(svc, db, rec, extId, stats, cache, dry);
}

// ── S3 HTML read (presigned + fetch) ────────────────────────────────────────────────────────────────
async function readHtmlFromS3(s3Key) {
  const url = await S3.getViewUrl(s3Key, 300);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`S3 read ${r.status}`);
  return r.text();
}

// ── modes ─────────────────────────────────────────────────────────────────────────────────────────
async function runFixtures(svc, db, dry) {
  const dir = path.join(__dirname, '..', 'tests', 'fixtures', 'ucl-lbs');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
  // person first
  const order = { person: 0, estate: 1, claim: 2, firm: 3 };
  const items = files.map((f) => {
    const type = f.split('-')[0];
    const extId = f.replace(/^\w+-/, '').replace(/\.html$/, '').replace(/^neg/, '-');
    return { f, type, extId };
  }).sort((a, b) => order[a.type] - order[b.type]);
  const stats = mkStats(); const colonyTotals = new Map();
  const cache = dry ? new Map() : await loadExtIdCache(db);
  for (const { f, type, extId } of items) {
    if (ONLY_TYPE && type !== ONLY_TYPE) continue;
    const rec = parseLbs(type, fs.readFileSync(path.join(dir, f), 'utf8'));
    await promoteRecord(svc, db, type, extId, rec, stats, colonyTotals, cache, dry);
    console.log(`  ${type}/${extId}: ${JSON.stringify(summ(type, rec))}`);
  }
  report(stats, colonyTotals, dry);
}

async function runParse(db, dry) {
  const where = `parsed IS NULL AND html_s3_key IS NOT NULL${ONLY_TYPE ? ` AND url_type='${ONLY_TYPE}'` : ''}`;
  const { rows } = await db.query(`SELECT url_type, ext_id, html_s3_key FROM lbs_raw_records WHERE ${where} ORDER BY fetched_at LIMIT $1`,
    [Number.isFinite(LIMIT) ? LIMIT : 100000]);
  console.log(`parse: ${rows.length} unparsed rows${dry ? ' [DRY-RUN]' : ''}`);
  let ok = 0, err = 0;
  for (const r of rows) {
    try {
      const html = await readHtmlFromS3(r.html_s3_key);
      const rec = parseLbs(r.url_type, html);
      if (!dry) await db.query(`UPDATE lbs_raw_records SET parsed=$3, parse_version=1, parsed_at=now() WHERE url_type=$1 AND ext_id=$2`,
        [r.url_type, r.ext_id, JSON.stringify(rec)]);
      ok++;
    } catch (e) { err++; if (err <= 5) console.log(`  parse err ${r.url_type}/${r.ext_id}: ${e.message}`); }
    if (ok % 200 === 0) process.stdout.write(`\r  parsed ${ok}/${rows.length}   `);
  }
  console.log(`\nparse done: ${ok} parsed, ${err} errors.`);
}

async function runPromote(svc, db, dry) {
  const stats = mkStats(); const colonyTotals = new Map();
  const cache = dry ? new Map() : await loadExtIdCache(db);
  console.log(`ext-id cache: ${cache.size} known LBS persons`);
  // person first (rich leads), then estate, claim, firm (link via cache)
  for (const type of ['person', 'estate', 'claim', 'firm']) {
    if (ONLY_TYPE && type !== ONLY_TYPE) continue;
    const { rows } = await db.query(
      `SELECT ext_id, parsed FROM lbs_raw_records WHERE url_type=$1 AND parsed IS NOT NULL ORDER BY ext_id LIMIT $2`,
      [type, Number.isFinite(LIMIT) ? LIMIT : 200000]);
    console.log(`promote ${type}: ${rows.length} rows`);
    for (const r of rows) {
      try { await promoteRecord(svc, db, type, r.ext_id, r.parsed, stats, colonyTotals, cache, dry); }
      catch (e) { stats.errors++; if (stats.errors <= 8) console.log(`  err ${type}/${r.ext_id}: ${e.message}`); }
    }
  }
  report(stats, colonyTotals, dry);
}

const mkStats = () => ({ person_created: 0, person_linked: 0, person_created_min: 0, person_would_create: 0,
  person_would_create_min: 0, claim: 0, estate: 0, estate_regs: 0, firm: 0, errors: 0 });
function summ(type, rec) {
  if (type === 'claim') return { colony: rec.colony, pounds: rec.compensation?.decimal, enslaved: rec.enslavedCount, indiv: rec.individuals?.length };
  if (type === 'person') return { name: rec.name, occ: rec.occupation, claims: rec.claims?.length, rels: rec.relationships?.length };
  if (type === 'estate') return { name: rec.name, colony: rec.colony, regs: rec.registrations?.length };
  return { name: rec.name, people: rec.people?.length };
}
function report(stats, colonyTotals, dry) {
  console.log(`\n${dry ? '[DRY-RUN] ' : ''}stats:`, JSON.stringify(stats));
  if (colonyTotals.size) {
    console.log('per-colony control totals (SUM enslaved_count / claim count):');
    [...colonyTotals.entries()].sort((a, b) => b[1].enslaved - a[1].enslaved)
      .forEach(([c, t]) => console.log(`  ${c}: ${t.enslaved} enslaved across ${t.claims} claims`));
  }
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('FATAL: DATABASE_URL not set (fail-loud).'); process.exit(1); }
  if (!MODE) { console.error('Pick a mode: --fixtures | --parse | --promote'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const db = { query: (t, p) => pool.query(t, p) };
  const svc = new PersonService(db);
  const dry = !APPLY;
  console.log(`mode=${MODE} ${dry ? 'DRY-RUN (pass --apply to write)' : 'APPLY'}${ONLY_TYPE ? ` type=${ONLY_TYPE}` : ''}`);
  try {
    if (MODE === 'fixtures') await runFixtures(svc, db, dry);
    else if (MODE === 'parse') await runParse(db, dry);
    else if (MODE === 'promote') await runPromote(svc, db, dry);
  } finally { await pool.end(); }
}

main().catch((e) => { console.error('\nFATAL:', e); process.exit(1); });
