// generate-ale-worklist.mjs — build the HUMAN-INITIATED research queue for Ancestry Library Edition.
//
// THE POSTURE THIS IMPLEMENTS (plan-descent-first-lineage §4c, settled with the operator 2026-08-10)
//   Access is a DCPL public library card. ALE is IP/patron-authenticated for *research use*; systematic
//   harvesting into a database is a different act and is outside those terms. So there is NO SCRAPER here
//   and there never will be. The division of labour is:
//       machine  -> decides WHO to look for, WHERE, in WHICH year, and WHY; ranks by tractability
//       human    -> performs the lookup in their own patron session
//       machine  -> ingests the operator-verified TRANSCRIPTION + citation (never a rehosted image)
//   That is §4c's "citation + operator-verified transcription" tier: a pointer and a fact. It also means
//   the project never holds a credential and never redistributes licensed content.
//
// WHY A WORKLIST AND NOT A QUEUE OF EVERYTHING
//   descent_frontier holds 1,882 pending steps, and a large share of them are NOT SEARCHABLE: probate
//   heirs recorded as bare mononyms ("Richard", "Thomas") with no surname, in a county with 221 other
//   estates. Handing a human "find Thomas in Albany County" spends a library session to produce nothing,
//   and worse, invites a name-only match — the Biscoe-forbidden operation, arrived at through fatigue.
//   So every row is graded for tractability, and the untractable ones are emitted as a SEPARATE list with
//   the reason stated, rather than silently dropped or padded into the work.
//
// PLACE derives from the anchor's evidence document s3_key (probate/<state>/<county>/...), because
// descent_anchors.primary_state / primary_county are NULL on all 595 rows — a backfill debt noted here
// rather than worked around silently.
//
// Usage:
//   node scripts/descent/generate-ale-worklist.mjs                 # summary only
//   node scripts/descent/generate-ale-worklist.mjs --write         # writes worksheets/
//   node scripts/descent/generate-ale-worklist.mjs --limit 40 --county albany --write

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const A = process.argv.slice(2);
const WRITE = A.includes('--write');
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const LIMIT = +val('--limit', 60);
const COUNTY = val('--county', null);

// US federal censuses usable for forward tracing. 1850 is the first that names every free household
// member (before it, only the head is named) — which is exactly why the corridor starts there for the
// enslaver line. 1890 is omitted: substantially destroyed by fire in 1921, so it is not a research target.
const CENSUS_YEARS = [1850, 1860, 1870, 1880, 1900, 1910, 1920, 1930, 1940, 1950];

const titleCase = (s) => (s || '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// Prefilled search links, so the operator never retypes a name or a place.
// VERIFIED against ancestry.com: the name parameter is `?name=Given_Surname` (underscore-joined).
// NOT verified, therefore NOT fabricated here: the residence/birth parameter spellings. Rather than invent
// query-string keys that would silently produce a wrong-but-plausible search, the county and target year
// are passed as `keyword`, which is documented behaviour, and the operator adjusts the place facet once on
// the page. A link that lands slightly broad is recoverable; a link that silently searches the wrong county
// is the kind of error that ends up in a citation.
function searchUrl(name, county, state, year) {
  const n = encodeURIComponent(String(name).trim().replace(/\s+/g, '_'));
  const kw = encodeURIComponent([titleCase(county), titleCase(state), year].filter(Boolean).join(' '));
  return `https://www.ancestry.com/search/?name=${n}&keyword=${kw}`;
}

// Tractability. A library session is a scarce, human-held resource; only emit what can actually be worked.
function grade(row) {
  const name = (row.full_name || '').trim();
  const words = name.split(/\s+/).filter(Boolean);
  if (!name) return { ok: false, why: 'no name' };
  if (words.length < 2) return { ok: false, why: `mononym ("${name}") — not searchable against a whole county` };
  if (!row.county) return { ok: false, why: 'no county derivable from the anchor document' };
  if (!row.estate_year) return { ok: false, why: 'no estate year — cannot bound a census window' };
  return { ok: true };
}

// The census a person is most likely to be findable in: the first one AFTER the estate that settled on
// them, since that is the moment they are documented as an adult with property of their own.
function targetCensuses(estateYear) {
  return CENSUS_YEARS.filter((y) => y >= estateYear && y <= estateYear + 40).slice(0, 3);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const rows = (await pool.query(
    `SELECT f.frontier_id, f.subject_id, f.era_band,
            u.full_name, u.birth_year, u.death_year,
            a.anchor_id, a.latest_event_year AS estate_year,
            au.full_name AS decedent,
            split_part(d.s3_key, '/', 2) AS state,
            split_part(d.s3_key, '/', 3) AS county,
            d.id AS doc_id, d.source_url
       FROM descent_frontier f
       JOIN descent_anchors a ON a.anchor_id = f.anchor_id
       LEFT JOIN unconfirmed_persons u  ON u.lead_id = f.subject_id
       LEFT JOIN unconfirmed_persons au ON au.lead_id = a.subject_id
       LEFT JOIN person_documents d ON d.id = a.anchor_evidence_document_id
      WHERE f.outcome IS NULL OR f.outcome = 'pending'
      ORDER BY a.latest_event_year NULLS LAST, f.frontier_id`)).rows;

  const workable = [], blocked = [];
  for (const r of rows) {
    const g = grade(r);
    if (g.ok) workable.push(r); else blocked.push({ ...r, why: g.why });
  }

  const byReason = blocked.reduce((m, b) => (m[b.why.split(' (')[0]] = (m[b.why.split(' (')[0]] || 0) + 1, m), {});
  console.log(`frontier pending: ${rows.length}`);
  console.log(`  workable now:   ${workable.length}`);
  console.log(`  not searchable: ${blocked.length}`);
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(5)}  ${k}`);

  let picked = workable;
  if (COUNTY) picked = picked.filter((r) => (r.county || '').toLowerCase() === COUNTY.toLowerCase());
  picked = picked.slice(0, LIMIT);
  console.log(`\nemitting ${picked.length} task(s)${COUNTY ? ` for county=${COUNTY}` : ''}`);

  if (!WRITE) { console.log('(dry run — pass --write to emit worksheets/)'); await pool.end(); return; }

  const dir = path.join(process.cwd(), 'worksheets');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = (await pool.query('SELECT to_char(now(),\'YYYY-MM-DD\') d')).rows[0].d;
  const base = `ale-worklist-${COUNTY || 'all'}-${stamp}`;

  const md = [
    `# Ancestry Library Edition — research worklist (${stamp})`,
    '',
    `**Access posture:** DCPL patron card, human-initiated lookups. Do NOT bulk-download or re-host images.`,
    `Record a **citation + your own transcription** of the facts. A pointer and a fact — that is what we keep.`,
    '',
    `**Tasks:** ${picked.length}  ·  generated from \`descent_frontier\` (${rows.length} pending, ${workable.length} searchable)`,
    '',
    'For each row: search the census year given, in the county given, for the person named. If you find them,',
    'capture household members + ages + birthplaces, and paste the Ancestry citation. If you do NOT find them,',
    '**say so** — a searched-and-absent result is a finding we store, not a blank.',
    '',
    '| # | Person | Look in | County, State | Heir of (estate) | Search | Found? | Household / notes | Citation |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  const csv = ['frontier_id,person,birth_year,census_years,county,state,decedent,estate_year,source_doc,search_url'];

  picked.forEach((r, i) => {
    const yrs = targetCensuses(r.estate_year);
    const url = searchUrl(r.full_name, r.county, r.state, yrs[0]);
    md.push(`| ${i + 1} | **${r.full_name}** | ${yrs.join(', ') || '—'} | ${titleCase(r.county)}, ${titleCase(r.state)} | ${r.decedent || '?'} (${r.estate_year || '?'}) | [search](${url}) |  |  |  |`);
    csv.push([r.frontier_id, `"${r.full_name}"`, r.birth_year || '', `"${yrs.join(' ')}"`, r.county, r.state, `"${r.decedent || ''}"`, r.estate_year || '', r.doc_id, `"${url}"`].join(','));
  });

  md.push('', '---', '', '## Not searchable yet (do not spend session time on these)', '');
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) md.push(`- **${v}** — ${k}`);
  md.push('', 'Mononym heirs need a surname from another source class (probate distribution, deed, marriage)',
    'before a census search can distinguish them. That is a *different* task from this list.');

  fs.writeFileSync(path.join(dir, base + '.md'), md.join('\n'));
  fs.writeFileSync(path.join(dir, base + '.csv'), csv.join('\n'));
  console.log(`\nwrote worksheets/${base}.md`);
  console.log(`wrote worksheets/${base}.csv`);
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
