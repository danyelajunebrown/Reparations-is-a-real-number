// audit-person-siloing.mjs — READ-ONLY. Is a single historical person stored/imported in many disconnected
// places, or resolved to one canonical? Samples N persons from the Bowie harvest + N from the existing DB and
// prints each one's CROSS-STORE FOOTPRINT + a siloing verdict. No writes.
//
// Stores checked: canonical_persons · unconfirmed_persons (by extraction_method) · genealogy_book_persons ·
// probate_estate_extractions (decedent/enslaved JSONB) · structured_extractions (fields JSONB) ·
// enslaved_owner_relationships (name strings) · person_external_ids (the LINK that resolves silos).
//
// Usage: node scripts/audit-person-siloing.mjs [--n 15]

import 'dotenv/config';
import pg from 'pg';
const N = (() => { const i = process.argv.indexOf('--n'); return i > -1 ? +process.argv[i + 1] : 15; })();
const surname = (nm) => { const t = String(nm || '').replace(/[^A-Za-z .'-]/g, ' ').trim().split(/\s+/).filter(w => w.length > 1 && !/^(jr|sr|ii|iii|iv|gen|col|dr|capt|mrs|mr|rev)$/i.test(w)); return t[t.length - 1] || ''; };

async function footprint(pool, name) {
  const sn = surname(name); if (sn.length < 3) return null;
  const like = `%${sn}%`;
  const n = async (sql, p = [like]) => { try { return +(await pool.query(sql, p)).rows[0].n; } catch { return -1; } };
  const canon = (await pool.query(`SELECT id, canonical_name, person_type FROM canonical_persons WHERE canonical_name ILIKE $1 LIMIT 25`, [like])).rows;
  const byMethod = (await pool.query(`SELECT COALESCE(extraction_method,'(null)') m, count(*)::int c, count(confirmed_individual_id)::int linked FROM unconfirmed_persons WHERE full_name ILIKE $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, [like])).rows;
  const uTotal = byMethod.reduce((a, r) => a + r.c, 0), uLinked = byMethod.reduce((a, r) => a + r.linked, 0);
  return {
    name, surname: sn,
    canonical: canon.map(c => `#${c.id}${c.person_type ? ':' + c.person_type[0] : ''}`),
    canonical_n: canon.length,
    unconfirmed_total: uTotal, unconfirmed_linked: uLinked,
    unconfirmed_methods: byMethod.length,
    method_breakdown: byMethod.map(r => `${r.m}:${r.c}${r.linked ? '(→' + r.linked + ')' : ''}`).join(' '),
    book: await n(`SELECT count(*)::int n FROM genealogy_book_persons WHERE name ILIKE $1`),
    probate_json: await n(`SELECT count(*)::int n FROM probate_estate_extractions WHERE decedent_name ILIKE $1 OR enslaved_persons::text ILIKE $1`),
    structured_json: await n(`SELECT count(*)::int n FROM structured_extractions WHERE fields::text ILIKE $1`),
    owner_rels: await n(`SELECT count(*)::int n FROM enslaved_owner_relationships WHERE owner_name ILIKE $1 OR enslaved_name ILIKE $1`),
  };
}

function verdict(f) {
  const stores = [f.canonical_n > 0, f.unconfirmed_total > 0, f.book > 0, f.probate_json > 0, f.structured_json > 0, f.owner_rels > 0].filter(Boolean).length;
  const unlinkedLeads = f.unconfirmed_total - f.unconfirmed_linked;
  if (stores >= 3 && (f.canonical_n === 0 || unlinkedLeads > f.unconfirmed_linked)) return `⛔ SILOED (${stores} stores, ${unlinkedLeads} unlinked leads, ${f.canonical_n} canonical)`;
  if (stores >= 2 && unlinkedLeads > 0) return `⚠ PARTIAL (${stores} stores, ${unlinkedLeads} unlinked)`;
  return `✅ resolved-ish (${stores} store${stores === 1 ? '' : 's'})`;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 240000 });
  const bowie = (await pool.query(`SELECT name FROM genealogy_book_persons WHERE book_id='bowiestheirkindr00bowi' ORDER BY random() LIMIT ${N}`)).rows.map(r => r.name);
  const dbSample = (await pool.query(`SELECT canonical_name name FROM canonical_persons WHERE person_type IN ('enslaver','enslaved') AND canonical_name IS NOT NULL ORDER BY random() LIMIT ${N}`)).rows.map(r => r.name);

  let siloed = 0, partial = 0;
  for (const [label, names] of [['BOWIE-BOOK', bowie], ['EXISTING-DB', dbSample]]) {
    console.log(`\n═══════════ ${label} (${names.length}) ═══════════`);
    for (const nm of names) {
      const f = await footprint(pool, nm); if (!f) { console.log(`  (skip "${nm}" — no usable surname)`); continue; }
      const v = verdict(f); if (v.startsWith('⛔')) siloed++; else if (v.startsWith('⚠')) partial++;
      console.log(`\n  ${f.name}  [${f.surname}]  → ${v}`);
      console.log(`    canonical(${f.canonical_n}): ${f.canonical.join(' ') || '—'}`);
      console.log(`    unconfirmed: ${f.unconfirmed_total} across ${f.unconfirmed_methods} method(s), ${f.unconfirmed_linked} linked → ${f.method_breakdown || '—'}`);
      console.log(`    book:${f.book} probate_json:${f.probate_json} structured_json:${f.structured_json} owner_rels:${f.owner_rels}`);
    }
  }
  console.log(`\n═══════════ VERDICT: ${siloed} SILOED, ${partial} PARTIAL of ${2 * N} sampled ═══════════`);
  console.log(`(surname-ILIKE is coarse — over-counts common surnames, under-counts OCR variants; read as directional.)`);
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
