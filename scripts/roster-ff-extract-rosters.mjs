// roster-ff-extract-rosters.mjs — FOLLOW-ON: pull the COMPLETE named rosters out of the roster_filefirst
// document FILES already archived in S3 (text/CSV/HTML), adding any names not yet loaded as leads +
// owner→enslaved edges. Text-parseable sources only (Franklin Dataverse TSV, Butler Gutenberg catalog,
// Carroll WikiTree HTML). Image/PDF sources (Heyward IIIF, Madison/Jackson PDFs) need OCR → Mini queue.
//
// Idempotent: dedups a name against leads already attached to that figure. Usage: node <this> [--apply]

import 'dotenv/config';
import pg from 'pg';
const APPLY = process.argv.includes('--apply');
const UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/605 Safari/605';
const clean = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
async function get(u) { const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(40000) }); if (!r.ok) throw new Error('http ' + r.status); return r.text(); }

// --- per-source parsers → array of {name, note} ---
function parseFranklinTSV(t) {
  const out = []; const lines = t.split(/\r?\n/); const hdr = lines[0].split('\t');
  const li = hdr.findIndex(h => /name last/i.test(h)), fi = hdr.findIndex(h => /name first/i.test(h)), ai = hdr.findIndex(h => /^age/i.test(h)), vi = hdr.findIndex(h => /valued/i.test(h));
  for (const ln of lines.slice(1)) { const c = ln.split('\t'); if (c.length < 3) continue; const nm = clean([c[fi], c[li]].filter(Boolean).join(' ')); if (!nm || /^\W*$/.test(nm)) continue; out.push({ name: nm, note: `Isaac Franklin 1847 estate inventory; age ${clean(c[ai]) || '?'}, valued $${clean(c[vi]) || '?'}` }); }
  return out;
}
function parseButlerGutenberg(t) {
  const out = []; const re = /^\s*(\d+)--([A-Z][A-Za-z'’ .]+?),\s*aged?\s*([\w. ]+?);/gm; let m;
  while ((m = re.exec(t))) { const nm = clean(m[2]); if (nm.length < 2) continue; out.push({ name: nm, note: `Weeping Time 1859 catalog #${m[1]}, aged ${clean(m[3])}` }); }
  return out;
}
function parseCarrollWikiHTML(h) {
  const out = []; const text = h.replace(/<[^>]+>/g, '\n');
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:age[ds]?\.?\s*)?(\d{1,3})\s*(?:years|yrs|y\.?o\.?)?/g; let m; const seen = new Set();
  while ((m = re.exec(text))) { const nm = clean(m[1]); if (nm.length < 3 || /^(Age|Name|Value|Family|List|Charles Carroll|Maryland|Baltimore)$/i.test(nm)) continue; const k = nm.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push({ name: nm, note: `Charles Carroll 1832/34 Doughoregan probate inventory, age ${m[2]} (WikiTree transcription — value model-relayed, verify vs FS image before DAA)` }); }
  return out;
}

const SOURCES = [
  { name: 'Isaac Franklin', url: 'https://dataverse.harvard.edu/api/access/datafile/7679728', parse: parseFranklinTSV },
  { name: 'Pierce Mease Butler', url: 'https://www.gutenberg.org/cache/epub/64804/pg64804.txt', parse: parseButlerGutenberg },
  { name: 'Charles Carroll', url: 'https://www.wikitree.com/wiki/Space:Slaves_of_Charles_Carroll_1737-1832,_Maryland', parse: parseCarrollWikiHTML },
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  for (const s of SOURCES) {
    const cp = (await pool.query(`SELECT id, primary_state, primary_county FROM canonical_persons WHERE created_by='roster_filefirst' AND canonical_name ILIKE $1 LIMIT 1`, [s.name])).rows[0];
    if (!cp) { console.log(`  ${s.name}: canonical not found, skip`); continue; }
    let names; try { names = s.parse(await get(s.url)); } catch (e) { console.log(`  ${s.name}: fetch/parse err ${e.message.slice(0, 30)}`); continue; }
    // dedup vs already-loaded leads for this figure
    const have = new Set((await pool.query(`SELECT lower(u.full_name) n FROM unconfirmed_persons u JOIN person_external_ids e ON e.subject_id=u.lead_id AND e.subject_table='unconfirmed_persons' WHERE e.id_system=$1`, ['roster_ff_' + slug(s.name) + '_enslaved'])).rows.map(r => r.n));
    const fresh = names.filter(x => x.name && !have.has(x.name.toLowerCase()));
    console.log(`  ${s.name}: parsed ${names.length}, already have ${have.size}, NEW ${fresh.length}${APPLY ? '' : ' [dry]'}`);
    if (!APPLY) continue;
    for (const e of fresh) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const lid = (await c.query(`INSERT INTO unconfirmed_persons (full_name, person_type, locations, context_text, source_url, source_type, extraction_method, confidence_score, created_at) VALUES ($1::text,'enslaved',ARRAY[$2::text,$3::text],$4::text,$5::text,'secondary','roster_ff_fullroster',0.75,now()) RETURNING lead_id`,
          [e.name, clean(cp.primary_county) || clean(cp.primary_state), clean(cp.primary_state) || 'United States', `Named as enslaved by ${s.name}. ${e.note}`.slice(0, 900), s.url])).rows[0].lead_id;
        await c.query(`INSERT INTO person_external_ids (subject_table, subject_id, id_system, external_id, confidence) VALUES ('unconfirmed_persons',$1::int,$2::text,$3::text,0.75) ON CONFLICT (id_system, external_id) DO NOTHING`, [lid, 'roster_ff_' + slug(s.name) + '_enslaved', slug(e.name) + '_' + lid]);
        await c.query(`INSERT INTO enslaved_owner_relationships (enslaved_subject_table, enslaved_subject_id, enslaved_name, owner_canonical_id, owner_subject_table, owner_subject_id, owner_name, relationship_type, source_url, source_context, confidence_score, verification_status, created_by) VALUES ('unconfirmed_persons',$1::int,$2::text,$3::int,'canonical_persons',$3::int,$4::text,'enslaved_by',$5::text,$6::text,0.75,'unverified','roster_ff_fullroster')`, [lid, e.name, cp.id, s.name, s.url, e.note.slice(0, 400)]);
        await c.query('COMMIT');
      } catch (err) { await c.query('ROLLBACK'); } finally { c.release(); }
    }
    console.log(`    ✓ added ${fresh.length} leads + owner-edges for ${s.name}`);
  }
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
