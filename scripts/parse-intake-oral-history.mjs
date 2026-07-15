// parse-intake-oral-history.mjs — turn the intake's free-text "anything else" field into structured
// DIRECTED research leads (intake_research_leads). Slaveholder-family oral history becomes a testable
// hypothesis cross-referenced against enslavers we already hold; adoption + name-change become lineage
// flags. Oral history is a HYPOTHESIS (confidence 0.5), never an assertion — the climb verifies it or
// returns a negative finding (per consent). Idempotent per (participant, claim_type, named_entity).
//
// Usage: node scripts/parse-intake-oral-history.mjs --participant <uuid|fsId> [--text "..."] [--apply]

import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const pi = A.indexOf('--participant'); const PART = pi > -1 ? A[pi + 1] : null;
const ti = A.indexOf('--text'); const TEXT_OVERRIDE = ti > -1 ? A[ti + 1] : null;
const APPLY = A.includes('--apply');
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

const BRANCH = [
  [/paternal grandmother|father'?s? mother|dad'?s? mom/i, 'paternal_grandmother'],
  [/paternal grandfather|father'?s? father|dad'?s? dad/i, 'paternal_grandfather'],
  [/maternal grandmother|mother'?s? mother|mom'?s? mom/i, 'maternal_grandmother'],
  [/maternal grandfather|mother'?s? father|mom'?s? dad/i, 'maternal_grandfather'],
  [/paternal|father'?s? side|dad'?s? side/i, 'paternal_side'],
  [/maternal|mother'?s? side|mom'?s? side/i, 'maternal_side'],
];
function branchOf(sentence) { for (const [re, b] of BRANCH) if (re.test(sentence)) return b; return 'unspecified'; }

// Extract a named slaveholder FAMILY from an "owned by X" / "enslaved by X" clause.
function extractSlaveholderFamily(sentence) {
  const pats = [
    /owned by ([A-Z][a-zA-Z.'-]+(?: [A-Z][a-zA-Z.'-]+){0,3})(?:'s ancestors| family| ancestors)?/,
    /enslaved by ([A-Z][a-zA-Z.'-]+(?: [A-Z][a-zA-Z.'-]+){0,3})/,
    /slaveholders? (?:named|called) ([A-Z][a-zA-Z.'-]+)/,
    /([A-Z][a-zA-Z.'-]+)(?:'s)? (?:ancestors|family) (?:owned|enslaved)/,
  ];
  for (const p of pats) { const m = sentence.match(p); if (m) return clean(m[1]); }
  return null;
}
// The searchable surname (e.g. "John McCain's ancestors" → "McCain").
function surnameOf(fullNamed) {
  const stop = /\b(ancestors|family|the|his|her|their|of|sr|jr|senator|president|john|mr|mrs)\b/gi;
  const parts = clean(fullNamed.replace(stop, ' ')).split(/\s+/)
    .map((w) => w.replace(/['’]s?$/i, '').replace(/[^a-zA-Z-]/g, '')) // strip possessive 's + punctuation
    .filter((w) => w.length > 2);
  return parts.length ? parts[parts.length - 1] : clean(fullNamed).replace(/['’]s?$/i, '');
}

function parseClaims(text) {
  const out = [];
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const s = clean(raw); if (!s) continue;
    const fam = extractSlaveholderFamily(s);
    if (fam && /own|enslav|slave/i.test(s)) out.push({ claim_type: 'slaveholder_family', raw: s, lineage_branch: branchOf(s), named_entity: fam, surname: surnameOf(fam) });
    else if (/\b(enslaved|slave)\b/i.test(s) && /ancestor|grand|family/i.test(s) && !fam) out.push({ claim_type: 'enslaved_ancestor', raw: s, lineage_branch: branchOf(s) });
    if (/\badopt/i.test(s)) out.push({ claim_type: 'adoption', raw: s, lineage_branch: branchOf(s) });
    if (/chang(?:ed|e) (?:my |his |her )?name|name change/i.test(s)) out.push({ claim_type: 'name_change', raw: s, lineage_branch: 'self' });
  }
  return out;
}

async function crossReference(pool, surname) {
  // enslavers we ALREADY hold matching the named family
  const r = await pool.query(
    `SELECT id, primary_county, primary_state FROM canonical_persons
      WHERE canonical_name ILIKE '%' || $1 || '%' AND person_type IN ('enslaver','slaveholder','owner')
      LIMIT 500`, [surname]);
  const ids = r.rows.map((x) => x.id);
  // dominant geography among the matches
  const geo = {};
  for (const x of r.rows) { if (x.primary_county && x.primary_state) { const k = `${x.primary_county} County, ${x.primary_state}`; geo[k] = (geo[k] || 0) + 1; } }
  const target = Object.entries(geo).sort((a, b) => b[1] - a[1])[0];
  return { ids, count: ids.length, target: target ? target[0] : null };
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  // resolve participant + text
  let participant = null, text = TEXT_OVERRIDE;
  if (PART) {
    const q = /^[A-Z0-9]{4}-[A-Z0-9]{3,4}$/i.test(PART) ? `self_fs_id=$1` : `id=$1::uuid`;
    participant = (await pool.query(`SELECT id, full_name, notes FROM participants WHERE ${q} LIMIT 1`, [PART])).rows[0];
    if (!participant) { console.error('participant not found:', PART); await pool.end(); return; }
    if (!text) text = participant.notes || '';
  }
  if (!text) { console.error('no oral-history text (pass --text or a participant with notes)'); await pool.end(); return; }

  const claims = parseClaims(text);
  console.log(`participant: ${participant ? participant.full_name + ' (' + participant.id + ')' : '(ad-hoc)'}`);
  console.log(`parsed ${claims.length} claim(s) from oral history${APPLY ? '' : ' [DRY-RUN]'}:\n`);
  for (const c of claims) {
    let xref = { ids: [], count: 0, target: null };
    if (c.claim_type === 'slaveholder_family' && c.surname) xref = await crossReference(pool, c.surname);
    console.log(`• [${c.claim_type}] branch=${c.lineage_branch}${c.named_entity ? ' entity="' + c.named_entity + '"' : ''}`);
    console.log(`   "${c.raw.slice(0, 100)}"`);
    if (c.claim_type === 'slaveholder_family') console.log(`   → cross-ref "${c.surname}": ${xref.count} enslavers we ALREADY hold${xref.target ? ', dominant geography: ' + xref.target : ''}`);
    if (APPLY && participant) {
      await pool.query(
        `INSERT INTO intake_research_leads (participant_id, raw_text, claim_type, lineage_branch, named_entity, target_geography, matched_enslaver_ids, matched_count, confidence, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [participant.id, c.raw, c.claim_type, c.lineage_branch, c.named_entity || null, xref.target,
         xref.ids, xref.count, 0.5,
         c.claim_type === 'slaveholder_family' ? `DIRECTED HYPOTHESIS: climb the ${c.lineage_branch} line, cross-reference against the ${xref.count} held "${c.surname}" enslavers${xref.target ? ' (prioritize ' + xref.target + ')' : ''}. Verify → match or negative finding.` : null]);
    }
  }
  if (APPLY && participant) console.log(`\n✓ persisted ${claims.length} directed lead(s) to intake_research_leads for ${participant.full_name}`);
  await pool.end();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
