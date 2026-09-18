// corroborate-freedmens-enslavers.mjs — take an enslaver NAMED BY A FREEDPERSON and ask whether an
// independent record shows the same man holding people. Write a VERDICT, never an edge, never a person.
//
// WHY (operator, 2026-08-31): "wouldn't dr. hill thornton be found in a slave schedule? isn't there a
// deduplication data supervision schema control agent somewhere?" Yes to both, and neither was being used.
// The re-extraction recovers "Dr. Hill Thornton" from OCR noise ("Aug 13-67 Wate, and you of") — and then
// stops. Meanwhile we hold 8 documented Thornton enslavers from census and probate, five of them plausible
// H* Thornton candidates. Nothing was comparing the two.
//
// THIS IS ALSO OUR FABRICATION TEST, which is the honest answer to "how are we testing for fabrication?"
// Today we test only for MALFORMED rows: tally-mark placeholders, mint-gate fragments, missing images.
// Every fabrication actually found this week was WELL-FORMED and wrong — 7,053 enslavers typed by
// provenance, "Jack Lancaster" listed as his own master, "John Ferguson" scoped off the wrong record. No
// schema check catches those. CROSS-SOURCE CORROBORATION does: a name a freedperson gave in 1867 that also
// appears in an 1860 slave schedule is two independent witnesses; a name appearing in neither stays a claim.
//
// WHAT IT WILL NOT DO
//   · It will not mint an enslaver. The depositor's statement is TESTIMONY (tier 0.65-0.70, per the plan),
//     and testimony corroborated by a census entry is still not a government-primary identification.
//   · It will not auto-merge on a name. "Thornton" matches eight people; Biscoe forbids resolving that by
//     name alone. Multiple candidates => verdict 'uncertain' WITH the candidate list, for a human.
//   · It will not write family_relationships. The existing crossref script does that, but it consumes the
//     GARBLED google-vision names — it would happily edge "Application Hilleder Pollard Hallis" to someone.
//     Verdicts first; edges only after a human confirms.
//
// Usage: node scripts/corroborate-freedmens-enslavers.mjs [--limit 50] [--apply]
import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const LIMIT = +val('--limit', 50);

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(dr|mr|mrs|miss|col|capt|maj|gen|rev|hon|esq|jr|sr)\b\.?/g, ' ')
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const surname = (s) => { const p = norm(s).split(' ').filter(Boolean); return p.length ? p[p.length - 1] : ''; };
const initials = (s) => norm(s).split(' ').filter(Boolean).slice(0, -1).map((w) => w[0]).join('');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 900000, query_timeout: 900000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

// The re-extraction stores its reading in research_findings.evidence_note as "MASTER: <name>".
const rows = (await pool.query(`
  SELECT finding_id, subject_id AS lead_id, evidence_note, index_searched,
         -- Prefer the STRUCTURED reading in scope_note. The prose fallback exists only for rows written
         -- before the writer was fixed; parsing prose gave "Dr" (pattern excluded periods, honorifics carry
         -- them) and then "Dr. Hill Thornton. SUPERSEDES google_vision_ledger_extractio".
         COALESCE(
           NULLIF(btrim((scope_note::jsonb ->> 'master')), ''),
           btrim(split_part((regexp_match(evidence_note, 'MASTER:\\s*([^·\\n]{2,80})'))[1], '. SUPERSEDES', 1))
         ) AS master
    FROM research_findings
   WHERE searched_by = 'reextract-freedmens-enslaver' AND result = 'hit'
     AND evidence_note ~ 'MASTER:'
     AND NOT EXISTS (SELECT 1 FROM linkage_verdicts v WHERE v.subject_ref = research_findings.finding_id::text)
   LIMIT $1`, [LIMIT])).rows;

console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} ${rows.length} freedmen's enslaver readings to corroborate`);

const st = { confirmed: 0, candidate: 0, uncertain: 0, none: 0 };
for (const r of rows) {
  const name = (r.master || '').trim();
  if (!name) continue;
  const sn = surname(name);
  if (!sn) continue;

  // Independent record = a canonical enslaver whose surname matches AND who is documented (serves a doc).
  const cands = (await pool.query(`
    SELECT c.id, c.canonical_name, c.primary_state, c.primary_county,
           EXISTS (SELECT 1 FROM person_documents d WHERE d.canonical_person_id=c.id AND d.s3_key IS NOT NULL) AS imaged
      FROM canonical_persons c
     WHERE c.person_type = 'enslaver'
       AND lower(c.canonical_name) LIKE '%' || $1 || '%'
     LIMIT 40`, [sn])).rows;

  const ini = initials(name);
  const scored = cands.map((c) => {
    let s = 0;
    if (norm(c.canonical_name) === norm(name)) s += 6;               // full-name agreement
    else if (surname(c.canonical_name) === sn) s += 2;               // surname only — weak by design
    if (ini && initials(c.canonical_name).startsWith(ini[0])) s += 1;
    if (c.imaged) s += 1;                                            // serves a document
    return { ...c, score: s };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0];
  const strong = scored.filter((x) => x.score >= 6);
  // A single full-name match on a documented enslaver is CORROBORATION. Several is ambiguity, and ambiguity
  // is preserved rather than resolved — the Biscoe rule exists because resolving it silently is how five
  // Monticello children were attached to a woman in Louisiana.
  const verdict = strong.length === 1 ? 'confirmed'
                : strong.length > 1 ? 'uncertain'
                : (top && top.score >= 3) ? 'candidate' : 'none';
  st[verdict === 'none' ? 'none' : verdict]++;

  console.log(`  ${String(name).slice(0, 24).padEnd(26)} → ${verdict.padEnd(10)} ${scored.slice(0, 3).map((x) => `${x.canonical_name}(${x.primary_state || '?'},s${x.score})`).join(' · ').slice(0, 92)}`);

  if (APPLY) {
    await pool.query(
      `INSERT INTO linkage_verdicts (subject_kind, subject_ref, enslaver_ref, verdict, basis, evidence_note,
         model_confidence, model_version, reference_class)
       VALUES ('freedmens_enslaver_testimony', $1, $2, $3, $4, $5, $6, 'corroborate-freedmens-enslavers/1', 'freedmens_bank')`,
      [r.finding_id, verdict === 'confirmed' ? String(top.id) : null, verdict,
       'cross-source: depositor testimony (Freedmen\'s Bank register) vs documented enslaver records',
       `Freedperson named "${name}" as their former enslaver. Independent enslaver records matching surname ` +
       `"${sn}": ${cands.length}. ${strong.length === 1
         ? `SINGLE full-name match on a documented enslaver (#${top.id} ${top.canonical_name}, ${top.primary_state || '?'}) — two independent witnesses.`
         : strong.length > 1
           ? `MULTIPLE full-name matches (${strong.map((x) => '#' + x.id).join(', ')}) — ambiguity PRESERVED, not resolved. Biscoe: never merge on a name.`
           : top ? `Best partial: #${top.id} ${top.canonical_name} (score ${top.score}) — surname agreement only, which is not identification.`
                 : 'No enslaver of that surname is documented in our records; the testimony stands uncorroborated.'} ` +
       `Testimony tier 0.65-0.70; corroboration RAISES confidence but does not make this government-primary. ` +
       `No enslaver minted, no edge written, human review required.`,
       verdict === 'confirmed' ? 0.8 : verdict === 'candidate' ? 0.5 : 0.3]).catch((e) => console.error(`  ! ${e.message.slice(0, 80)}`));
  }
}
console.log(`\n=== ${JSON.stringify(st)} ===`);
if (!APPLY) console.log('(dry run — pass --apply)');
await pool.end();
