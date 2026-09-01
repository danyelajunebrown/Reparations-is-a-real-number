#!/usr/bin/env node
/**
 * build-dutchess-linkage-verdicts.mjs — Stage-1 documentary ground truth for the Dutchess calibration.
 *
 * The enslaver-anchored calibration (plan-dutchess-calibration-stage1.md) needs NON-CIRCULAR ground
 * truth: an attribution is `confirmed` only when it appears in ≥2 INDEPENDENT sources (a single source
 * asserting X-held-by-E is not a verdict on itself). This cross-references the Dutchess documentary
 * corpus we hold — 1714 census, 1755 census (enslaved_owner_relationships), and the colonial wills
 * (worksheets/dutchess-colonial-yield.jsonl) — at the ENSLAVER-identity level (the dense edge) and
 * reports the enslaved-person-level overlap (expected sparse; colonial first-names, Biscoe).
 *
 * Writes confirmed cross-source verdicts to linkage_verdicts (migration 126). Honest by construction:
 * it reports how much of the corpus is multiply-corroborated vs single-source — the first empirical
 * read on documentary ground-truth DENSITY for Stage 1.
 *
 *   node scripts/build-dutchess-linkage-verdicts.mjs            # dry run (report only)
 *   node scripts/build-dutchess-linkage-verdicts.mjs --apply    # write verdicts
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Normalize an enslaver name to a family key: lower, drop honorifics/given names, keep the surname
// unit (Dutch "Van/Ten/De X" kept together). Colonial spelling is noisy — collapse to a soundex-ish core.
const PARTICLES = new Set(['van', 'ten', 'de', 'der', 'den', 'von', 'la', 'le']);
function familyKey(name) {
  const toks = String(name || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  // find a particle → take particle + following token(s) as the surname unit
  const pi = toks.findIndex(t => PARTICLES.has(t));
  let surname;
  if (pi >= 0) surname = toks.slice(pi).join('');           // vanbenthuysen
  else surname = toks[toks.length - 1];                     // last token
  // spelling-collapse: drop doubled letters + trailing vowels, map common colonial variants
  return surname.replace(/(.)\1+/g, '$1').replace(/[aeiou]+$/, '').replace(/ck/g, 'k').replace(/c/g, 'k').replace(/dt$/, 't');
}

(async () => {
  // 1755 + 1714 census enslavers (from the owner-edges + census leads)
  const censusEdges = (await pool.query(`
    SELECT DISTINCT owner_name, enslaved_name FROM enslaved_owner_relationships
    WHERE (source_context ILIKE '%dutchess%' OR source_url ILIKE '%dutchess%') AND owner_name IS NOT NULL`)).rows;
  const census1714 = (await pool.query(`
    SELECT u.full_name FROM unconfirmed_persons u JOIN person_external_ids e
      ON e.subject_id=u.lead_id AND e.subject_table='unconfirmed_persons'
    WHERE e.id_system='ny_census_dutchess_1714' AND u.person_type='enslaver'`)).rows.map(r => r.full_name);

  // wills enslaver→enslaved
  const willsPath = path.resolve(__dirname, '../worksheets/dutchess-colonial-yield.jsonl');
  const wills = fs.existsSync(willsPath)
    ? fs.readFileSync(willsPath, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(o => o.testator && o.enslaved_named?.length)
    : [];

  // Build source→familyKey sets
  const src = { census1755: new Map(), census1714: new Map(), wills: new Map() };
  for (const e of censusEdges) { const k = familyKey(e.owner_name); if (k) { if (!src.census1755.has(k)) src.census1755.set(k, e.owner_name); } }
  for (const n of census1714) { const k = familyKey(n); if (k && !src.census1714.has(k)) src.census1714.set(k, n); }
  for (const w of wills) { const k = familyKey(w.testator); if (k && !src.wills.has(k)) src.wills.set(k, w.testator); }

  // Cross-source: which enslaver family keys appear in ≥2 sources?
  const allKeys = new Set([...src.census1755.keys(), ...src.census1714.keys(), ...src.wills.keys()]);
  const corroborated = [];
  for (const k of allKeys) {
    const inSrc = ['census1755', 'census1714', 'wills'].filter(s => src[s].has(k));
    if (inSrc.length >= 2) corroborated.push({ key: k, sources: inSrc, names: inSrc.map(s => src[s].get(k)) });
  }

  // enslaved-person-level cross-source (census names vs wills names) — expected sparse
  const censusEnslaved = new Set(censusEdges.map(e => (e.enslaved_name || '').toLowerCase().trim()).filter(Boolean));
  const willsEnslaved = new Set(wills.flatMap(w => w.enslaved_named.map(n => n.toLowerCase().trim())));
  const enslavedOverlap = [...willsEnslaved].filter(n => censusEnslaved.has(n));

  console.log(`\n=== DUTCHESS DOCUMENTARY GROUND-TRUTH DENSITY (Stage 1) ===`);
  console.log(`enslaver families — 1755 census: ${src.census1755.size} · 1714 census: ${src.census1714.size} · wills: ${src.wills.size}`);
  console.log(`CROSS-SOURCE CONFIRMED enslaver identities (≥2 sources): ${corroborated.length}`);
  for (const c of corroborated) console.log(`   ✓ [${c.sources.join('+')}] ${c.names.join('  ~  ')}`);
  console.log(`\nenslaved-person names — census: ${censusEnslaved.size} · wills: ${willsEnslaved.size} · cross-source name overlap: ${enslavedOverlap.length} ${enslavedOverlap.length ? '(' + enslavedOverlap.join(', ') + ' — DISTINCT people, Biscoe; NOT verdicts)' : ''}`);
  console.log(`\nHONEST READ: of ${allKeys.size} distinct Dutchess enslaver families, ${corroborated.length} are multiply-corroborated; the rest are SINGLE-SOURCE (broad-but-shallow). Enslaved-person-level cross-source truth ≈ 0 (colonial first-names collide; same name ≠ same person).`);

  if (APPLY && corroborated.length) {
    let n = 0;
    for (const c of corroborated) {
      const r = await pool.query(
        `INSERT INTO linkage_verdicts
           (subject_kind, subject_ref, enslaver_ref, verdict, basis, evidence_note, model_confidence,
            model_version, reference_class, verified_by)
         VALUES ('attribution', $1, $2, 'confirmed', 'document', $3, 0.9, 'dutchess-crosssource-v1',
                 'Dutchess|colonial|multi_source', 'build-dutchess-linkage-verdicts')
         ON CONFLICT (subject_kind, subject_ref, basis) DO UPDATE SET evidence_note=EXCLUDED.evidence_note
         RETURNING id`,
        [`enslaver_family:${c.key}`, c.names[0], `Cross-source enslaver identity in ${c.sources.join('+')}: ${c.names.join(' ~ ')}`]);
      if (r.rows.length) n++;
    }
    console.log(`\nwrote ${n} confirmed cross-source enslaver-identity verdicts → linkage_verdicts`);
  } else if (!APPLY) {
    console.log(`\n(dry run — re-run with --apply to write the ${corroborated.length} confirmed verdicts)`);
  }
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
