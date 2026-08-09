// descend-from-probate.mjs — GENERATION 1 of descent-first lineage, from documents already on disk.
//
// WHY THIS SCRIPT EXISTS (user directive 2026-08-08, memory-bank/plan-descent-first-lineage.md):
// canonical_family_edges holds 4,924 rows of which FOUR carry a source_document_id. Meanwhile
// probate_estate_extractions holds 5,359 named heirs across 1,271 estates whose page images are already
// archived in S3 (20,571/20,571 with s3_key). A will that says "my son Richard" IS the kinship document —
// standard-genealogical-edge-evidence.md §3 rates "will/probate naming X as heir/son/daughter of Y" at
// TIER 1. We have been climbing UP into FamilySearch's tree to manufacture kinship we already own,
// downward, in documents we scraped and OCR'd ourselves.
//
// This needs no scraping, no acquisition, and no FamilySearch session. It is the fastest path from 4
// documented edges to thousands, and it validates the descent loop against real evidence before anything
// else is built.
//
// ---------------------------------------------------------------------------------------------------
// STANDARDS THIS ENFORCES (plan-descent-first-lineage.md §5 — the "insisting" half of the directive)
// ---------------------------------------------------------------------------------------------------
//  1. HEIRS LAND AS LEADS. Every heir goes through PersonService.findOrCreateLead — the same door as every
//     other ingest, which dedups on entry and writes blocking keys. NEVER a canonical_persons INSERT.
//     The climb's original sin was being a second, uncontrolled door; this is not a third.
//  2. NO EDGE WITHOUT ITS DOCUMENT. Every edge written here carries source_document_id pointing at the
//     specific archived page, plus M127 information_type / informant_role. produced_by='descent/probate-heirs'
//     so project-health-monitor.mjs can assert the invariant holds forever.
//  3. THE READING IS NOT SELF-CERTIFYING. The heir names come from an LLM reading OCR. Audit rule 1 — "the
//     model orchestrates; deterministic code computes; humans review" — so `verified` is ALWAYS false here.
//     evidence_tier reflects the DOCUMENT CLASS (a will is tier 1); `verified` is the human gate that lets
//     it onto a DAA. Those are two different questions and conflating them is how bad lineage ships.
//  4. DETERMINISTIC HALLUCINATION CHECK, FREE. Before trusting a name, we look for it in the page OCR text
//     we already store (111,331/111,331 probate docs have ocr_text) and cite THE PAGE IT APPEARS ON. A name
//     absent from OCR is NOT proof of hallucination — probate OCR name-recall is ~55% — so it lowers
//     confidence within the tier and raises a flag; it never silently drops the edge, and never invents one.
//  5. NO FABRICATED SURNAMES. "my son Richard" stays "Richard". Appending the decedent's surname would be
//     inference presented as transcription (audit rule 5), and it is wrong for daughters by construction.
//     Such heirs get a given_name_only flag: the RELATIONSHIP is documented, the IDENTITY is not discrete,
//     so they can carry an edge but can never clear Biscoe for promotion. Two propositions, two verdicts.
//  6. NO FLATTENED GENERATIONS. "grandson" names a descendant two steps down whose intermediate parent the
//     document does NOT name. Writing that as parent_of would fabricate a generation. Counted and skipped.
//  7. THE WEALTH IS NOT DROPPED. inheritance_edges requires canonical ids on both ends and heirs are leads,
//     so bequests park verbatim in descent_pending_inheritance (M133) and drain on promotion. Descending
//     through wills to keep only the genealogy would throw away the actual thesis.
//  8. NULLS ARE FINDINGS. An estate that names heirs but no descendants is logged to research_findings
//     (M128) so the next pass doesn't re-read it.
//  9. THE EMBED PHASE IS PART OF THIS INGEST, NOT AN AFTERTHOUGHT (RULE 0.5). Leads written here are
//     invisible to RAG/search/person modals until embedded — a retrieval silo. The first full run of this
//     script shipped 1,308 leads with no embed step and had to be caught by the operator, so the step is
//     now printed on every run AND enforced by project-health-monitor.mjs (`descent_leads_embedded`,
//     CRITICAL). Remedy is one command:  node scripts/embed-leads.mjs --id-system probate_heir
//
// PRECONDITION: the decedent must already be on the person spine. promote-probate-extractions.mjs is the
// producer for that (id_system='probate_estate'); this script deliberately does not duplicate its mint
// logic. Extractions whose decedent is unpromoted are counted and reported, not silently skipped.
//
// Usage:
//   node scripts/descent/descend-from-probate.mjs                  # DRY RUN, full corpus
//   node scripts/descent/descend-from-probate.mjs --limit 25       # DRY RUN, sample
//   node scripts/descent/descend-from-probate.mjs --apply          # write
//   node scripts/descent/descend-from-probate.mjs --roll 9SYT-PT5  # one roll group
//   node scripts/descent/descend-from-probate.mjs --no-ocr-check   # skip OCR corroboration

import 'dotenv/config';
import { createRequire } from 'node:module';
import path from 'node:path';
import pg from 'pg';

const require = createRequire(import.meta.url);
const PersonService = require(path.resolve(process.cwd(), 'src/services/PersonService'));

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const OCR_CHECK = !A.includes('--no-ocr-check');
const arg = (f) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : null; };
const LIMIT = arg('--limit') ? Number(arg('--limit')) : null;
const ROLL = arg('--roll');

const PRODUCER = 'descent/probate-heirs';
const ID_SYSTEM_DECEDENT = 'probate_estate';
const ID_SYSTEM_HEIR = 'probate_heir';

// ---------------------------------------------------------------------------------------------------
// Relationship vocabulary. canonical_family_edges.relationship_type is CHECK-constrained to
// spouse | parent_of | child_of | sibling_of, and edges are written decedent-first (person_a = decedent).
// `descends` marks the relations that advance the frontier — the ones that move the line FORWARD in time.
// Anything not listed here is NOT written as an edge. Silence is the correct output for an unmapped term.
// ---------------------------------------------------------------------------------------------------
const RELATION_MAP = {
  son: { type: 'parent_of', descends: true },
  daughter: { type: 'parent_of', descends: true },
  child: { type: 'parent_of', descends: true },
  children: { type: 'parent_of', descends: true },
  'eldest son': { type: 'parent_of', descends: true },
  'youngest son': { type: 'parent_of', descends: true },
  'eldest daughter': { type: 'parent_of', descends: true },
  'youngest daughter': { type: 'parent_of', descends: true },
  'son in law': { type: 'spouse_of_child', descends: false }, // real kin, but not expressible in the CHECK
  wife: { type: 'spouse', descends: false },
  husband: { type: 'spouse', descends: false },
  widow: { type: 'spouse', descends: false },
  spouse: { type: 'spouse', descends: false },
  brother: { type: 'sibling_of', descends: false },
  sister: { type: 'sibling_of', descends: false },
};

// Relations that name a DESCENDANT but skip an unnamed generation. Recording these as parent_of would
// invent the person in between. They are real descent signal — they mark an anchor worth working — but the
// edge itself is unwritable from this document alone.
const GENERATION_GAP = new Set([
  'grandson', 'granddaughter', 'grandchild', 'grandchildren',
  'great grandson', 'great granddaughter', 'great grandchild',
]);

/** Normalize a relation string as the document phrased it. Never guesses; unknown → null. */
function mapRelation(raw) {
  if (!raw) return { kind: 'unstated' };
  const r = String(raw).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (RELATION_MAP[r]) return { kind: 'mapped', rel: r, ...RELATION_MAP[r] };
  if (GENERATION_GAP.has(r)) return { kind: 'generation_gap', rel: r };
  return { kind: 'unmapped', rel: r };
}

/**
 * Era band + the source ladder that can name the NEXT generation down.
 * The ladder lists what the standard says applies, INCLUDING classes we have not ingested — the drip marks
 * those 'blocked', which keeps the acquisition gap visible in the data instead of hiding it behind an
 * empty queue. (plan-descent-first-lineage.md §4: the 1870→1950 corridor is the shared blocker.)
 */
function eraLadder(year) {
  if (!year) return { band: 'unknown', ladder: ['probate'] };
  if (year < 1850) return { band: `${year}-pre1850`, ladder: ['probate', 'newspaper'] };
  if (year < 1870) return { band: `${year}-1850s60s`, ladder: ['probate', 'census_household', 'newspaper'] };
  if (year < 1900) return { band: `${year}-postbellum`, ladder: ['probate', 'census_household', 'vital', 'newspaper', 'freedmens_bank'] };
  return { band: `${year}-modern`, ladder: ['census_household', 'vital', 'newspaper'] };
}

/** Comparable form for OCR containment: lowercase, letters+spaces only, collapsed. */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Find which archived page actually contains this name, so the citation points at the page an auditor
 * would open — not just "somewhere in this 31-page estate file".
 *
 * Corroboration STRENGTH matters and is not binary. A bare given name ("Richard") will appear somewhere in
 * a 31-page estate file close to by chance, so finding it proves almost nothing; finding "Jane Amaranthia"
 * as a contiguous string is strong. Grading this prevents the check from inflating confidence on exactly
 * the heirs whose identity is least resolved — which would be worse than not checking at all.
 *
 * Returns { docId, strength } where strength ∈ 'full_string' | 'all_tokens' | 'weak_single_token' | 'none'.
 */
function citePage(name, pages) {
  const fallback = pages.find((p) => p.s3_key) || pages[0] || null;
  const fbId = fallback ? fallback.id : null;
  if (!OCR_CHECK || !name) return { docId: fbId, strength: 'none' };
  const n = norm(name);
  const tokens = n.split(' ').filter((t) => t.length > 2);
  if (!tokens.length) return { docId: fbId, strength: 'none' };
  const multiToken = tokens.length >= 2;

  for (const p of pages) {
    if (p.ocr_norm && p.ocr_norm.includes(n)) {
      return { docId: p.id, strength: multiToken ? 'full_string' : 'weak_single_token' };
    }
  }
  if (multiToken) {
    for (const p of pages) {
      if (p.ocr_norm && tokens.every((t) => p.ocr_norm.includes(t))) return { docId: p.id, strength: 'all_tokens' };
    }
  }
  return { docId: fbId, strength: 'none' };
}

/** Only a multi-token OCR hit is strong enough to lift confidence within the tier. */
const isStrongOcr = (s) => s === 'full_string' || s === 'all_tokens';

const OCR_NOTE = {
  full_string: 'name located in page OCR as a contiguous string',
  all_tokens: 'all name tokens located on one OCR page',
  weak_single_token: 'single given name located in page OCR — WEAK (a common given name appears in most estate files by chance; not treated as corroboration)',
  none: 'name NOT located in page OCR (probate OCR name-recall ~55%; absence is not evidence of error)',
};

/**
 * Informant analysis (M127). A testator naming their own children is PRIMARY information from the person
 * best positioned to know. A clerk's inventory or estate account listing distributees is a court record —
 * the relationship may be stated but the informant is not the parent, so it is not automatically primary.
 */
function informantFor(documentType) {
  const t = String(documentType || '').toLowerCase();
  if (t === 'will') return { information_type: 'primary', informant_role: 'testator' };
  if (t === 'distribution' || t === 'letters_of_administration') return { information_type: 'secondary', informant_role: 'court_clerk' };
  if (t === 'guardian_account') return { information_type: 'secondary', informant_role: 'guardian' };
  return { information_type: 'undetermined', informant_role: 'probate_record' };
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 180000 });
  const ps = new PersonService(pool);
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (no writes; pass --apply) ===');
  console.log(`ocr corroboration: ${OCR_CHECK ? 'ON' : 'OFF'}`);

  const params = [];
  let where = `x.heirs IS NOT NULL AND jsonb_array_length(x.heirs) > 0 AND x.provider IS DISTINCT FROM 'sentinel'`;
  if (ROLL) { params.push(ROLL); where += ` AND x.roll_group_id = $${params.length}`; }

  const { rows: extractions } = await pool.query(
    `SELECT x.id, x.roll_group_id, x.decedent_name, x.document_type, x.year, x.heirs,
            s.decedent_key, s.page_doc_ids
       FROM probate_estate_extractions x
       JOIN probate_estate_segments_v2 s ON s.id = x.segment_id
      WHERE ${where}
      ORDER BY x.id ${LIMIT ? `LIMIT ${LIMIT}` : ''}`, params);

  console.log(`estates with named heirs: ${extractions.length}`);

  const st = {
    estates: 0, estatesSkippedNoDecedent: 0, estatesNoDescent: 0,
    heirs: 0, edgesParent: 0, edgesSpouse: 0, edgesSibling: 0,
    leadsCreated: 0, leadsLinked: 0, rejectedByMintGate: 0,
    givenNameOnly: 0, ocrCorroborated: 0, ocrWeak: 0, ocrUnconfirmed: 0,
    generationGapSkipped: 0, unmappedSkipped: 0, unstatedSkipped: 0, sonInLawSkipped: 0,
    anchors: 0, frontier: 0, pendingInheritance: 0, findings: 0,
  };

  for (const x of extractions) {
    // ---- resolve the decedent on the person spine (produced by promote-probate-extractions.mjs) ----
    const extId = `probate-ext:${x.roll_group_id}:${x.decedent_key}`;
    const { rows: dec } = await pool.query(
      `SELECT COALESCE(subject_table, CASE WHEN canonical_person_id IS NOT NULL THEN 'canonical_persons' END) AS st,
              COALESCE(subject_id, canonical_person_id) AS sid
         FROM person_external_ids WHERE id_system = $1 AND external_id = $2 LIMIT 1`,
      [ID_SYSTEM_DECEDENT, extId]);
    if (!dec.length || !dec[0].sid) { st.estatesSkippedNoDecedent++; continue; }
    const decedent = { table: dec[0].st, id: Number(dec[0].sid) };
    st.estates++;

    // ---- load the estate's archived pages (+ OCR, for the citation and the hallucination check) ----
    const { rows: pages } = await pool.query(
      `SELECT id, s3_key, ${OCR_CHECK ? 'ocr_text' : 'NULL::text AS ocr_text'}
         FROM person_documents WHERE id = ANY($1::int[]) ORDER BY id`,
      [x.page_doc_ids || []]);
    for (const p of pages) p.ocr_norm = p.ocr_text ? norm(p.ocr_text) : null;

    const heirs = Array.isArray(x.heirs) ? x.heirs : [];
    const info = informantFor(x.document_type);
    const { band, ladder } = eraLadder(x.year);
    let descentThisEstate = 0;
    let anchorId = null;

    for (const h of heirs) {
      st.heirs++;
      const rawName = (h && (h.name || h.heir_name)) ? String(h.name || h.heir_name).trim() : '';
      const m = mapRelation(h && h.relation);

      if (m.kind === 'generation_gap') { st.generationGapSkipped++; continue; }
      if (m.kind === 'unstated') { st.unstatedSkipped++; continue; }
      if (m.kind === 'unmapped') { st.unmappedSkipped++; continue; }
      if (m.type === 'spouse_of_child') { st.sonInLawSkipped++; continue; }
      if (!rawName) continue;

      // NEVER append the decedent's surname (standard 5). The name enters exactly as the document gives it.
      const tokenCount = rawName.split(/\s+/).filter(Boolean).length;
      const givenNameOnly = tokenCount === 1;
      if (givenNameOnly) st.givenNameOnly++;

      const { docId, strength } = citePage(rawName, pages);
      const corroborated = isStrongOcr(strength);
      if (corroborated) st.ocrCorroborated++;
      else if (strength === 'weak_single_token') st.ocrWeak++;
      else st.ocrUnconfirmed++;

      // Tier is a property of the DOCUMENT CLASS (§3: a will naming a son is tier 1). Confidence moves
      // within the tier on the OCR corroboration signal. `verified` stays false — see standard 3 above.
      const evidenceTier = info.information_type === 'primary' ? 1 : 2;
      const confidence = corroborated ? (evidenceTier === 1 ? 0.95 : 0.80) : (evidenceTier === 1 ? 0.85 : 0.70);

      if (!APPLY) {
        if (m.type === 'parent_of') { st.edgesParent++; descentThisEstate++; }
        else if (m.type === 'spouse') st.edgesSpouse++;
        else if (m.type === 'sibling_of') st.edgesSibling++;
        continue;
      }

      // ---- the heir enters through the standard door ----
      const heirExtId = `probate-heir:${x.roll_group_id}:${x.decedent_key}:${norm(rawName).replace(/\s/g, '-')}:${m.rel}`;
      const res = await ps.findOrCreateLead({
        name: rawName,
        personType: null,           // an heir is not thereby an enslaver; role is a separate proposition
        sourceUrl: `probate_estate_extractions:${x.id}`,
        sourceType: 'primary',      // the will is a primary source; the READING is gated by verified=false
        extractionMethod: 'llm',
        confidence,
        context: `Named in ${x.document_type || 'probate record'} of ${x.decedent_name}${x.year ? ` (${x.year})` : ''} as "${m.rel}". Roll ${x.roll_group_id}.`,
        dataQualityFlags: {
          given_name_only: givenNameOnly,
          surname_not_asserted: givenNameOnly ? `decedent surname was "${x.decedent_name}" — NOT applied` : undefined,
          ocr_corroboration: strength,
          producer: PRODUCER,
        },
        externalId: heirExtId,
        idSystem: ID_SYSTEM_HEIR,
      });
      if (!res.ref) { st.rejectedByMintGate++; continue; }
      if (res.action === 'created') st.leadsCreated++; else if (res.action === 'linked') st.leadsLinked++;
      const heirRef = { table: res.ref.subject_table, id: Number(res.ref.subject_id) };

      // ---- the edge, with its document ----
      // person_a_id/person_b_id are FKs to canonical_persons, so they are set ONLY for canonical subjects;
      // lead endpoints ride the M103 polymorphic columns. uq_cfe_subject_edge makes this idempotent.
      const aCanon = decedent.table === 'canonical_persons' ? decedent.id : null;
      const bCanon = heirRef.table === 'canonical_persons' ? heirRef.id : null;
      const notes = [
        `descent gen1 from ${x.document_type || 'probate'} (${x.year || 'year unknown'}); document states "${m.rel}"`,
        OCR_NOTE[strength],
        givenNameOnly ? 'GIVEN NAME ONLY — relationship documented, identity not discrete (Biscoe: not promotable)' : null,
      ].filter(Boolean).join(' | ');

      await pool.query(
        `INSERT INTO canonical_family_edges
           (person_a_id, person_b_id, a_subject_table, a_subject_id, b_subject_table, b_subject_id,
            relationship_type, source_document_id, evidence_tier, confidence, verified,
            information_type, informant_role, notes, produced_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12,$13,$14,now(),now())
         -- uq_cfe_subject_edge is a PARTIAL unique index; the predicate must be restated for Postgres to
         -- infer it as the arbiter (42P10 otherwise).
         ON CONFLICT (a_subject_table, a_subject_id, b_subject_table, b_subject_id, relationship_type)
           WHERE a_subject_id IS NOT NULL AND b_subject_id IS NOT NULL
           DO UPDATE SET source_document_id = COALESCE(canonical_family_edges.source_document_id, EXCLUDED.source_document_id),
                         produced_by = EXCLUDED.produced_by, updated_at = now()`,
        [aCanon, bCanon, decedent.table, decedent.id, heirRef.table, heirRef.id,
         m.type, docId, evidenceTier, confidence, info.information_type, info.informant_role, notes, PRODUCER]);

      if (m.type === 'parent_of') { st.edgesParent++; descentThisEstate++; }
      else if (m.type === 'spouse') st.edgesSpouse++;
      else if (m.type === 'sibling_of') st.edgesSibling++;

      // ---- the wealth half, parked until both ends are canonical (M133) ----
      const bequest = h && h.bequest ? String(h.bequest).trim() : '';
      if (bequest) {
        // asset_type stays 'unspecified': classifying free-text bequests here would be model inference
        // dressed as data. The clause is stored VERBATIM so deterministic code can classify it later.
        await pool.query(
          `INSERT INTO descent_pending_inheritance
             (testator_table, testator_id, heir_table, heir_id, relationship_to_testator, asset_type,
              asset_description, source_document_id, source_extraction_table, source_extraction_id,
              document_year, evidence_tier, confidence, notes)
           VALUES ($1,$2,$3,$4,$5,'unspecified',$6,$7,'probate_estate_extractions',$8,$9,$10,$11,$12)
           ON CONFLICT (testator_table, testator_id, heir_table, heir_id, asset_type, source_document_id)
             DO NOTHING`,
          [decedent.table, decedent.id, heirRef.table, heirRef.id, m.rel, bequest, docId,
           String(x.id), x.year || null, evidenceTier, confidence, `produced_by=${PRODUCER}`]);
        st.pendingInheritance++;
      }

      // ---- the frontier: only descending relations move the line forward ----
      if (m.descends) {
        if (anchorId === null) {
          const anchorDoc = (pages.find((p) => p.s3_key) || {}).id || null;
          const a = await pool.query(
            `INSERT INTO descent_anchors
               (subject_table, subject_id, person_class, anchor_basis, anchor_evidence_document_id,
                latest_event_year, status, priority, notes)
             VALUES ($1,$2,'enslaver','image_backed_document',$3,$4,'active',50,$5)
             ON CONFLICT (subject_table, subject_id)
               DO UPDATE SET status = 'active', updated_at = now()
             RETURNING anchor_id`,
            [decedent.table, decedent.id, anchorDoc, x.year || null,
             `seeded by ${PRODUCER} from ${x.roll_group_id}:${x.decedent_key}`]);
          anchorId = a.rows[0].anchor_id;
          st.anchors++;
        }
        await pool.query(
          `INSERT INTO descent_frontier
             (anchor_id, subject_table, subject_id, generation_depth, era_band, source_classes_remaining)
           VALUES ($1,$2,$3,1,$4,$5)
           ON CONFLICT (anchor_id, subject_table, subject_id, generation_depth) DO NOTHING`,
          [anchorId, heirRef.table, heirRef.id, band, ladder]);
        st.frontier++;
      }
    }

    // ---- a null result is a finding (M128): this estate names heirs, but no descendants ----
    if (descentThisEstate === 0) {
      st.estatesNoDescent++;
      if (APPLY) {
        await pool.query(
          `INSERT INTO research_findings
             (question, repository, index_searched, result, hit_count, subject_table, subject_id,
              evidence_note, searched_by, searched_at)
           VALUES ($1,$2,$3,'none',0,$4,$5,$6,$7,now())`,
          [`children of ${x.decedent_name}`, 'probate_estate_extractions (LLM extraction of imaged probate)',
           `roll ${x.roll_group_id}, estate ${x.decedent_key}`, decedent.table, decedent.id,
           `Estate names ${heirs.length} heir(s) but none in a parent-child relation to the decedent; the line does not descend from this document.`,
           PRODUCER]);
        st.findings++;
      }
    }
  }

  console.log('\n--- result ---');
  for (const [k, v] of Object.entries(st)) console.log(`${k.padEnd(26)} ${v}`);
  if (st.estatesSkippedNoDecedent) {
    console.log(`\nNOTE: ${st.estatesSkippedNoDecedent} estates skipped — decedent not on the person spine.`);
    console.log('      Remedy: node scripts/promote-probate-extractions.mjs --apply   (then re-run)');
  }
  if (!APPLY) console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  // RULE 0.5 — this ingest is NOT complete until its leads are embedded. Unembedded leads never reach
  // RAG, search, or the person modals; the row exists and is invisible, which is the worst failure mode
  // the project has (indistinguishable from never having ingested it at all).
  if (APPLY && (st.leadsCreated > 0 || st.leadsLinked > 0)) {
    console.log('\n>>> REQUIRED NEXT STEP (RULE 0.5 — this ingest is incomplete without it):');
    console.log('    node scripts/embed-leads.mjs --id-system probate_heir');
    console.log('    (project-health-monitor.mjs raises descent_leads_embedded=CRITICAL until it runs)');
  }
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
