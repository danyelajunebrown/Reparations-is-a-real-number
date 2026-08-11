// reconcile-farm-book-stage5.mjs — STAGE 5 of the Farm Book ingest, built as a RECONCILER.
//
// WHY A RECONCILER AND NOT A RESOLVER (operator's call, 2026-08-10)
//   Two independent extractions of the SAME pages now exist:
//     A. `farm_book_persons` (701 mentions) — LLM extraction via extract-farm-book-roster.mjs.
//        Strength: reads prose context, so it captures mother AND father, occupation, status.
//     B. `unconfirmed_persons` where extraction_method='descent/jefferson-farm-book-rolls' (445 leads)
//        — deterministic regex parse of the roll columns.
//        Strength: birth years off the year-anchors, and it cannot hallucinate a name that isn't there.
//   Neither is authoritative. Where two independent readings of one source AGREE, that is corroboration
//   a single extractor cannot produce. Where they DISAGREE, that is precisely where the errors live —
//   1780s handwriting, mononyms, and column drift — and the plan already says cross-source disagreement is
//   a SIGNAL, not an error (plan-descent-first-lineage §5.4). So: agreement resolves; disagreement becomes
//   a `linkage_verdicts` row for a human, and NOTHING is auto-merged on a name.
//
//   This also repairs my own error: I minted leads directly, bypassing the staging that
//   extract-farm-book-roster.mjs deliberately kept ("NO leads/edges created here — Stage 5 resolves
//   mentions → distinct people first (Biscoe-safe)"). This script puts the two lanes back in one place.
//
// MATCHING IS DELIBERATELY CONSERVATIVE
//   Key = lowercased name + birth year when both sides have one; else name + page. A mononym match on name
//   alone is NEVER treated as the same person — that is the Biscoe-forbidden operation, and this corpus is
//   full of repeated given names (three Dicks, three Joes, two Sallys across the rolls).
//
// Usage: node scripts/descent/reconcile-farm-book-stage5.mjs [--apply]

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const PRODUCER = 'descent/farm-book-stage5-reconcile';
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  const mentions = (await pool.query(
    `SELECT id, name, birth_year, mother_name, father_name, page, person_document_id, resolved_person_id
       FROM farm_book_persons`)).rows;

  const leads = (await pool.query(
    `SELECT lead_id, full_name, birth_year, context_text
       FROM unconfirmed_persons WHERE extraction_method = 'descent/jefferson-farm-book-rolls'`)).rows;

  // Index the deterministic side both ways: by name+year (strong) and by name alone (weak, used only to
  // detect that a NAME is shared — never to assert identity).
  const byNameYear = new Map(), byName = new Map();
  for (const l of leads) {
    if (l.birth_year) byNameYear.set(`${norm(l.full_name)}|${l.birth_year}`, l);
    const k = norm(l.full_name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(l);
  }

  // The deterministic side's parent claims, keyed by child lead id.
  const edgeRows = (await pool.query(
    `SELECT e.b_subject_id AS child_id, u.full_name AS parent_name
       FROM canonical_family_edges e
       JOIN unconfirmed_persons u ON u.lead_id = e.a_subject_id
      WHERE e.produced_by = 'descent/jefferson-farm-book-rolls' AND e.relationship_type = 'parent_of'`)).rows;
  const parentOf = new Map();
  for (const r of edgeRows) parentOf.set(Number(r.child_id), norm(r.parent_name));

  let agreed = 0, parentAgree = 0, parentConflict = 0, llmOnly = 0, detOnly = 0, nameAmbiguous = 0;
  const verdicts = [];
  const resolutions = [];
  const matchedLeadIds = new Set();

  for (const m of mentions) {
    const key = m.birth_year ? `${norm(m.name)}|${m.birth_year}` : null;
    let lead = key ? byNameYear.get(key) : null;

    if (!lead) {
      const cands = byName.get(norm(m.name)) || [];
      // Only accept a name-only match when it is UNIQUE on both sides and neither carries a birth year to
      // contradict. Anything else is left unresolved rather than guessed.
      if (cands.length === 1 && !m.birth_year && !cands[0].birth_year) lead = cands[0];
      else if (cands.length > 1) { nameAmbiguous++; continue; }
    }
    if (!lead) { llmOnly++; continue; }

    agreed++; matchedLeadIds.add(lead.lead_id);
    resolutions.push({ mentionId: m.id, leadId: lead.lead_id });

    // Compare the PARENT claim — the substantive disagreement worth adjudicating.
    const detParent = parentOf.get(lead.lead_id) || null;
    const llmParents = [m.mother_name, m.father_name].filter(Boolean).map(norm);
    if (detParent && llmParents.length) {
      if (llmParents.includes(detParent)) parentAgree++;
      else {
        parentConflict++;
        verdicts.push({
          mentionId: m.id, leadId: lead.lead_id, child: m.name, page: m.page,
          docId: m.person_document_id,
          note: `Farm Book p.${m.page}, "${m.name}": deterministic roll parse reads parent = "${detParent}"; `
              + `LLM extraction reads mother = "${m.mother_name || '—'}", father = "${m.father_name || '—'}". `
              + `Two independent readings of the same page disagree on parentage — human adjudication required. `
              + `Neither reading is promoted while this stands.`,
        });
      }
    }
  }
  detOnly = leads.length - matchedLeadIds.size;

  console.log(`\nmentions ${mentions.length} · deterministic leads ${leads.length}`);
  console.log(`  matched (same person, both extractions): ${agreed}`);
  console.log(`    parent claim AGREES:    ${parentAgree}`);
  console.log(`    parent claim CONFLICTS: ${parentConflict}   -> linkage_verdicts`);
  console.log(`  LLM-only mentions:        ${llmOnly}`);
  console.log(`  deterministic-only leads: ${detOnly}`);
  console.log(`  name ambiguous (>1 candidate, refused): ${nameAmbiguous}`);

  if (!APPLY) { console.log('\n(dry run — pass --apply)'); await pool.end(); return; }

  for (const r of resolutions) {
    await pool.query(
      `UPDATE farm_book_persons SET resolved_person_id = $1 WHERE id = $2 AND resolved_person_id IS NULL`,
      [r.leadId, r.mentionId]);
  }
  console.log(`\n✓ resolved ${resolutions.length} mentions -> lead ids`);

  let wrote = 0;
  for (const v of verdicts) {
    const dup = await pool.query(
      `SELECT 1 FROM linkage_verdicts WHERE subject_kind='parent_link' AND subject_ref=$1`, [`farm_book_person:${v.mentionId}`]);
    if (dup.rows.length) continue;
    await pool.query(
      `INSERT INTO linkage_verdicts
         (subject_kind, subject_ref, enslaved_ref, verdict, basis, evidence_doc_id, evidence_note, model_version)
       VALUES ('parent_link', $1, $2, 'uncertain', 'document', $3, $4, $5)`,
      [`farm_book_person:${v.mentionId}`, `unconfirmed_persons:${v.leadId}`, v.docId, v.note, PRODUCER]);
    wrote++;
  }
  console.log(`✓ wrote ${wrote} linkage_verdicts (parent_link / uncertain)`);
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
