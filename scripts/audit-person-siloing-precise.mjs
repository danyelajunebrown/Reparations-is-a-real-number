// audit-person-siloing-precise.mjs — READ-ONLY. TRUE per-person duplication: block by surname, then filter to
// the actual individual (first-name match + birth-year ±3), so we count copies of ONE person — not everyone
// sharing a surname (the flaw in audit-person-siloing.mjs). Anchors: the hand-resolved Biscoe cluster (known
// ground truth) + random IDENTIFIABLE canonicals (birth year present). No writes.
//
// Usage: node scripts/audit-person-siloing-precise.mjs [--n 12]

import 'dotenv/config';
import pg from 'pg';

const TITLES = /^(mr|mrs|ms|miss|dr|gen|genl|col|colonel|capt|captain|rev|revd|hon|sir|lady|judge|governor|gov|bishop|chancellor|maj|major|lt|sgt|prof|st|jr|sr|ii|iii|iv|v|the)$/i;
function norm(name) {
  let s = String(name || '').toLowerCase().replace(/["().]/g, ' ');
  if (s.includes(',')) { const [a, b] = s.split(','); s = `${b} ${a}`; }            // "biscoe, ann" → "ann biscoe"
  const toks = s.replace(/[^a-z .'-]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !TITLES.test(w));
  return toks;
}
const firstTok = (n) => norm(n)[0] || '';
const lastTok = (n) => { const t = norm(n); return t[t.length - 1] || ''; };
const yrOf = (s) => { const m = String(s || '').match(/\b(1[6789]\d\d|20\d\d)\b/); return m ? +m[1] : null; };

// does candidate (cf/cl/cy) refer to the SAME person as anchor (af/al/ay)? surname must match; then first-name
// exact, OR same initial + birth within 3. A candidate lacking a birth year can't be disqualified on year.
function samePerson(af, al, ay, cf, cl, cy) {
  if (!al || al !== cl) return false;
  if (af && cf && af === cf) return (ay == null || cy == null || Math.abs(ay - cy) <= 3);
  if (af && cf && af[0] === cf[0]) return (ay != null && cy != null && Math.abs(ay - cy) <= 3);
  return false;
}

async function footprint(pool, anchorName, anchorYear) {
  const af = firstTok(anchorName), al = lastTok(anchorName), ay = anchorYear || null;
  if (al.length < 3) return null;
  const like = `%${al}%`;
  const cRows = (await pool.query(`SELECT id, canonical_name, birth_year_estimate, person_type FROM canonical_persons WHERE canonical_name ILIKE $1 LIMIT 4000`, [like])).rows
    .filter(r => samePerson(af, al, ay, firstTok(r.canonical_name), lastTok(r.canonical_name), r.birth_year_estimate));
  const uRows = (await pool.query(`SELECT lead_id, full_name, confirmed_individual_id, extraction_method FROM unconfirmed_persons WHERE full_name ILIKE $1 LIMIT 8000`, [like])).rows
    .filter(r => samePerson(af, al, ay, firstTok(r.full_name), lastTok(r.full_name), null));
  const bRows = (await pool.query(`SELECT name, birth FROM genealogy_book_persons WHERE name ILIKE $1 LIMIT 2000`, [like])).rows
    .filter(r => samePerson(af, al, ay, firstTok(r.name), lastTok(r.name), yrOf(r.birth)));

  const uLinked = uRows.filter(r => r.confirmed_individual_id).length;
  const methods = [...new Set(uRows.map(r => r.extraction_method || '(null)'))];
  const linkedToAnchorCanon = new Set(uRows.map(r => r.confirmed_individual_id).filter(Boolean));
  return {
    anchorName, af, al, ay,
    canonical_dups: cRows.length, canonical_ids: cRows.map(r => `#${r.id}`),
    unconfirmed: uRows.length, unconfirmed_linked: uLinked, methods: methods.length, method_list: methods.join(','),
    book: bRows.length, distinct_canon_targets: linkedToAnchorCanon.size,
  };
}

function verdict(f) {
  // TRUE per-person siloing: >1 canonical for the SAME person = unresolved dup; unlinked leads = float.
  const floatLeads = f.unconfirmed - f.unconfirmed_linked;
  if (f.canonical_dups > 1 && (floatLeads > 0 || f.book > 0)) return `⛔ SILOED (${f.canonical_dups} canonical DUPES of one person, ${floatLeads} float leads, ${f.book} book)`;
  if (f.canonical_dups > 1) return `⚠ CANON-DUP (${f.canonical_dups} canonical rows for one person)`;
  if (floatLeads > 3 || f.book > 0) return `⚠ PARTIAL (1 canonical, ${floatLeads} unlinked leads, ${f.book} book copies)`;
  return `✅ RESOLVED (1 canonical, ${f.unconfirmed_linked}/${f.unconfirmed} leads linked)`;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 240000 });
  const N = (() => { const i = process.argv.indexOf('--n'); return i > -1 ? +process.argv[i + 1] : 12; })();

  const anchors = [];
  // Known ground truth (hand-resolved Biscoe cluster)
  for (const id of [141015, 140301, 608285, 196013, 196010]) {
    const r = (await pool.query(`SELECT canonical_name, birth_year_estimate FROM canonical_persons WHERE id=$1`, [id])).rows[0];
    if (r) anchors.push({ name: r.canonical_name, year: r.birth_year_estimate, tag: `GROUND-TRUTH #${id}` });
  }
  // Random IDENTIFIABLE canonicals (have a birth year + a two-token name)
  for (const r of (await pool.query(`SELECT canonical_name, birth_year_estimate FROM canonical_persons WHERE birth_year_estimate IS NOT NULL AND canonical_name ~ ' ' AND person_type IN ('enslaver','enslaved') ORDER BY random() LIMIT ${N}`)).rows)
    anchors.push({ name: r.canonical_name, year: r.birth_year_estimate, tag: 'random-identifiable' });

  let siloed = 0, canonDup = 0, partial = 0, resolved = 0;
  for (const a of anchors) {
    const f = await footprint(pool, a.name, a.year); if (!f) { console.log(`  (skip ${a.name})`); continue; }
    const v = verdict(f);
    if (v.startsWith('⛔')) siloed++; else if (v.startsWith('⚠ CANON')) canonDup++; else if (v.startsWith('⚠ PART')) partial++; else resolved++;
    console.log(`\n${a.tag} — ${f.anchorName} (b.${f.ay || '?'})  → ${v}`);
    console.log(`   canonical rows for THIS person: ${f.canonical_dups} ${f.canonical_ids.join(' ')}`);
    console.log(`   leads for THIS person: ${f.unconfirmed} (${f.unconfirmed_linked} linked, ${f.methods} methods: ${f.method_list})`);
    console.log(`   book copies: ${f.book}${f.distinct_canon_targets > 1 ? ` ; leads point at ${f.distinct_canon_targets} DIFFERENT canonicals (⚠ inconsistent)` : ''}`);
  }
  console.log(`\n═══ TRUE per-person: ${resolved} resolved · ${partial} partial · ${canonDup} canon-dup · ${siloed} siloed (of ${anchors.length}) ═══`);
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
