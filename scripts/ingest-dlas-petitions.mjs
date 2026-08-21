// ingest-dlas-petitions.mjs — ingest DLAS petitions from source_ingest_queue: structured metadata from the
// site's per-petition JSON export, NAMED PEOPLE from its people table, both written as LEADS.
//
// WHY THIS IS THE CLASS-AGNOSTIC ENGINE (operator, 2026-08-21: "build the engine agnostic! ... why would we
// want to only build the drip for enslavers it seems to me that would promote fabrication")
//   DLAS publishes, per person, a table with these columns:
//       Name | Age | Color or Race | Sex | Role in document | Enslavement Status | Enslaver?
//   The SOURCE declares the class. So this ingest never assigns person_type by provenance — which is the
//   defect that fabricated 7,053 "enslavers" out of probate decedents, and exactly the pressure an
//   enslaver-only pipeline creates: if only one side has machinery, the other side gets bridged by
//   name-matching and assumption. Here, enslaver / enslaved / free person of colour / white petitioner all
//   enter through ONE door, each carrying the status its own record states, and anything unstated stays
//   'unknown' rather than being guessed.
//
// ENDPOINTS (learned by inspection, recorded so nobody re-derives them)
//   · /petitions/petition/<id>/json   → petition metadata + controlled-vocabulary `subjects[]`
//     NB the export links are /petition/<id>/json — NOT /petitions/tojson/?i=<id>, which returns HTML.
//   · /petitions/people/<id>/all      → the named-people table (HTML; no JSON equivalent found)
//   · a bare /petitions/petition/<id> 301s — the TRAILING SLASH (or /json) matters.
//
// WHAT IT WRITES
//   · person leads via PersonService.findOrCreateLead — never a direct canonical INSERT (the climb's
//     original sin was a second uncontrolled door), so the mint gate + Biscoe dedup apply.
//   · one person_documents row per petition per person, carrying the DLAS permalink + full archival
//     citation (repository / series / folder / microfilm reel).
//   · the abstract and subjects as person_facts — the open vocabulary absorbs DLAS's 127 terms without a
//     migration (standard-assertion-store §3).
//   · NO s3_key. DLAS serves a transcription/abstract, not a scan we may rehost; the permalink IS the
//     citation. Writing s3_key without bytes would manufacture evidence.
//
// RULE 0.5: an EMBED phase is mandatory. This prints and (with --embed) runs it; unembedded data is a silo.
//
// Usage:
//   node scripts/ingest-dlas-petitions.mjs --limit 5
//   node scripts/ingest-dlas-petitions.mjs --limit 200 --apply
import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const LIMIT = +val('--limit', 25);
const GAP_MS = +val('--gap-ms', 1100);
const UA = 'reparations-research/1.0 (db7613@bard.edu; academic reparations research; contact welcome)';
const BASE = 'https://dlas.uncg.edu';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.text();
}
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// Parse the people table. Columns are read from the HEADER ROW, not by position — DLAS could reorder them,
// and a positional parser would silently mis-assign race to sex rather than fail.
function parsePeople(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  if (!rows.length) return [];
  const cells = (r) => [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => clean(m[1]));
  const hdr = cells(rows[0]).map((h) => h.toLowerCase());
  const ix = (frag) => hdr.findIndex((h) => h.includes(frag));
  const iName = ix('name'), iAge = ix('age'), iRace = ix('color'), iSex = ix('sex'),
        iRole = ix('role'), iStatus = ix('enslavement'), iEnslaver = ix('enslaver');
  if (iName < 0) return [];
  const out = [];
  for (const r of rows.slice(1)) {
    const c = cells(r);
    if (!c[iName]) continue;
    out.push({
      name: c[iName],
      age: iAge >= 0 ? c[iAge] : '', race: iRace >= 0 ? c[iRace] : '', sex: iSex >= 0 ? c[iSex] : '',
      role: iRole >= 0 ? c[iRole] : '', status: iStatus >= 0 ? c[iStatus] : '',
      enslaver: iEnslaver >= 0 ? c[iEnslaver] : '',
    });
  }
  return out;
}

// person_type comes from what the SOURCE SAYS, never from the fact that we found them in a slavery archive.
// Unstated => 'unknown'. That is the whole discipline: absence of a declared status is not evidence of one.
function personTypeFrom(p) {
  const st = (p.status || '').toLowerCase();
  const en = (p.enslaver || '').toLowerCase();
  if (/enslav(ed)?\b/.test(st) && !/free/.test(st)) return 'enslaved';
  if (/free/.test(st)) return 'freedperson';
  if (/^(y|yes|true|x)$/.test(en.trim()) || /enslaver/.test(en)) return 'enslaver';
  return 'unknown';
}
const sexOf = (s) => (/^f/i.test(s) ? 'female' : /^m/i.test(s) ? 'male' : null);
const birthYearFrom = (age, year) => {
  const a = (String(age).match(/(\d{1,3})/) || [])[1];
  const y = (String(age).match(/in\s+(1[78]\d{2})/) || [])[1] || year;
  return a && y ? +y - +a : null;
};

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, query_timeout: 300000 });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  const svc = new PersonService(pool);

  const queue = (await pool.query(
    `SELECT queue_id, ark_url, result FROM source_ingest_queue
      WHERE source_kind='dlas_petition' AND status='queued'
      ORDER BY (result->>'enslaved_count')::int DESC NULLS LAST, queue_id
      LIMIT $1`, [LIMIT])).rows;
  console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} ${queue.length} petition(s)`);
  if (!queue.length) { await pool.end(); return; }

  const st = { petitions: 0, people: 0, created: 0, linked: 0, rejected: 0, facts: 0, docs: 0, err: 0 };
  const byType = {};

  for (const q of queue) {
    const pid = (q.result && q.result.petition_id) || (String(q.ark_url).match(/petition\/(\d+)/) || [])[1];
    if (!pid) { st.err++; continue; }
    try {
      const meta = JSON.parse(await get(`${BASE}/petitions/petition/${pid}/json`)).petition[0];
      await sleep(GAP_MS);
      const people = parsePeople(await get(`${BASE}/petitions/people/${pid}/all`));
      st.petitions++; st.people += people.length;

      const citation = [meta.repository, meta.state && `${meta.county || ''} ${meta.location_type || ''}, ${meta.state}`.trim(),
        meta.filing_court && `${meta.filing_court} Court`, meta.file_year && `filed ${meta.file_year}`,
        `DLAS PAR ${pid}`].filter(Boolean).join(' · ');
      const subjects = (meta.subjects || []).map((s) => s.subject).filter(Boolean);

      for (const p of people) {
        const ptype = personTypeFrom(p);
        byType[ptype] = (byType[ptype] || 0) + 1;
        if (!APPLY) continue;
        try {
          const out = await svc.findOrCreateLead({
            name: p.name,
            personType: ptype,
            sex: sexOf(p.sex),
            birthYear: birthYearFrom(p.age, meta.file_year),
            location: [meta.county, meta.state].filter(Boolean).join(', '),
            externalId: `dlas:${pid}:${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            idSystem: 'dlas_petition_person',
            sourceUrl: meta.petition_url,
            sourceType: 'secondary',
            createdBy: 'ingest-dlas-petitions',
          }, { dryRun: false });

          if (out.action === 'created') st.created++;
          else if (out.action === 'linked') st.linked++;
          else { st.rejected++; continue; }
          const ref = out.ref; if (!ref) { st.rejected++; continue; }
          const isLead = ref.subject_table === 'unconfirmed_persons';

          // document — permalink + full archival citation. NO s3_key: DLAS serves an abstract, not a scan.
          await pool.query(
            `INSERT INTO person_documents (${isLead ? 'unconfirmed_person_id' : 'canonical_person_id'},
               document_type, source_url, source_citation, name_as_appears, evidence_strength, document_date)
             SELECT $1,'court_petition',$2,$3,$4,'secondary',$5
              WHERE NOT EXISTS (SELECT 1 FROM person_documents d
                 WHERE d.${isLead ? 'unconfirmed_person_id' : 'canonical_person_id'}=$1 AND d.source_url=$2)`,
            [ref.subject_id, meta.petition_url, citation, p.name,
             meta.file_year ? `${meta.file_year}-01-01` : null])
            .then(() => { st.docs++; }).catch(() => {});

          // facts — the source's OWN vocabulary, verbatim. race/role/status/subjects.
          const facts = [];
          if (p.race) facts.push(['race_as_recorded', p.race]);
          if (p.role) facts.push(['role_in_document', p.role]);
          if (p.status) facts.push(['enslavement_status', p.status]);
          for (const s of subjects) facts.push(['petition_subject', s]);
          for (const [ft, vt] of facts) {
            await pool.query(
              `INSERT INTO person_facts (subject_table, subject_id, fact_type, value_text, date_year,
                 place_state, place_county, source_table, source_external_system, source_external_id,
                 source_url, source_citation, confidence, verification_status)
               SELECT $1,$2,$3,$4,$5,$6,$7,'source_ingest_queue','dlas',$8,$9,$10,0.8,'unverified'
                WHERE NOT EXISTS (SELECT 1 FROM person_facts f WHERE f.subject_table=$1 AND f.subject_id=$2
                                    AND f.fact_type=$3 AND f.value_text=$4)`,
              [ref.subject_table, ref.subject_id, ft, vt, meta.file_year || null,
               meta.state || null, meta.county || null, String(pid), meta.petition_url, citation])
              .then(() => { st.facts++; }).catch(() => {});
          }
        } catch (e) { st.err++; if (st.err <= 5) console.error(`   ! ${p.name}: ${e.message.slice(0, 80)}`); }
      }

      if (APPLY) await pool.query(
        `UPDATE source_ingest_queue SET status='ingested', processed_at=now() WHERE queue_id=$1`, [q.queue_id]);
      console.log(`  PAR ${pid} · ${String(meta.state).slice(0, 14).padEnd(15)} ${people.length} people · ${subjects.length} subjects`);
    } catch (e) {
      st.err++;
      console.log(`  ! PAR ${pid}: ${e.message.slice(0, 90)}`);
      if (/429|403/.test(e.message)) { console.log('  ⛔ rate-limited — stopping this tick.'); break; }
    }
    await sleep(GAP_MS);
  }

  console.log(`\n=== ${JSON.stringify(st)} ===`);
  console.log(`person_type as DECLARED BY THE SOURCE: ${JSON.stringify(byType)}`);
  if (APPLY) console.log(`\nRULE 0.5 — now embed: node scripts/embed-leads.mjs --id-system dlas_petition_person`);
  else console.log('\n(dry run — pass --apply)');
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
