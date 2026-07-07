// build-rag-eval-fixture.mjs — resolve the RAG-eval gold canonical IDs ONCE against
// the live DB and freeze them into tests/fixtures/rag-eval/gold.json.
//
// The eval runner (eval-records-rag.mjs) reads the frozen fixture; it never resolves
// IDs itself. Per the brief: resolve at fixture-build time, freeze, and NEVER hardcode
// a guessed ID — every id here is either a project-of-record ID (verified against the
// DB) or resolved live by name + served-document, with ambiguity flagged, not guessed.
//
// Run:  node scripts/build-rag-eval-fixture.mjs           (writes the fixture)
//       node scripts/build-rag-eval-fixture.mjs --dry     (prints, no write)
//
// Free / read-only. Requires DATABASE_URL.

import 'dotenv/config';
import pkg from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const { Pool } = pkg;
const DRY = process.argv.includes('--dry');
const OUT = 'tests/fixtures/rag-eval/gold.json';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required'); process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false,
});

// "Served" = the canonical serves a real S3 scan (person_documents.s3_key). NOTE:
// this is INTENTIONALLY separate from assertable_slaveowner — the roster enslavers
// serve scans but many are NOT flagged assertable (a real gate gap this fixture
// records), so requiring the flag would wrongly drop them.
async function candidatesByPattern(pattern) {
  const { rows } = await pool.query(
    `SELECT cp.id, cp.canonical_name, cp.primary_state, cp.person_type, cp.assertable_slaveowner,
            (SELECT count(*)::int FROM person_documents pd
             WHERE pd.canonical_person_id = cp.id AND pd.s3_key IS NOT NULL) AS served_docs
       FROM canonical_persons cp
      WHERE cp.canonical_name ILIKE $1
      ORDER BY served_docs DESC, cp.assertable_slaveowner DESC, cp.id ASC
      LIMIT 8`,
    [pattern]
  );
  return rows.filter(r => r.served_docs > 0);
}

// Resolve a served-gold enslaver via a PRECISE name pattern (avoids the "Edward"
// substring trap and namesakes). Records the assertable flag rather than gating on it.
async function resolveServed({ name, pattern, query }) {
  const rows = await candidatesByPattern(pattern);
  const entry = { name, query: query || `Was ${name} a slaveholder, and what document shows it?` };
  if (rows.length === 0) {
    entry.canonical_id = null; entry.status = 'NOT_SERVED';
  } else if (rows.length === 1) {
    entry.canonical_id = rows[0].id; entry.status = 'resolved';
    entry.resolved_name = rows[0].canonical_name; entry.state = rows[0].primary_state;
    entry.served_docs = rows[0].served_docs; entry.assertable = rows[0].assertable_slaveowner;
  } else {
    entry.canonical_id = rows[0].id; entry.status = 'AMBIGUOUS_review';
    entry.candidates = rows.map(r => ({ id: r.id, name: r.canonical_name, state: r.primary_state, served_docs: r.served_docs, assertable: r.assertable_slaveowner }));
  }
  return entry;
}

// Verify a project-of-record ID actually exists (freeze only if it resolves).
async function verifyId(id, label) {
  const { rows } = await pool.query(
    `SELECT id, canonical_name, person_type, primary_state FROM canonical_persons WHERE id = $1`, [id]);
  if (!rows.length) return { label, canonical_id: id, status: 'MISSING' };
  return { label, canonical_id: id, resolved_name: rows[0].canonical_name,
           person_type: rows[0].person_type, state: rows[0].primary_state, status: 'verified' };
}

// Seeded stratified sample across person_type × primary_state (deterministic: order by
// a stable hash of id, no random()). Coverage headline — expected ~0 recall until the
// person corpus is embedded.
async function stratifiedSample(perStratum = 2) {
  const { rows } = await pool.query(
    `WITH ranked AS (
       SELECT cp.id, cp.canonical_name, cp.person_type, cp.primary_state,
              row_number() OVER (PARTITION BY cp.person_type, cp.primary_state
                                 ORDER BY md5(cp.id::text)) AS rn
         FROM canonical_persons cp
        WHERE cp.canonical_name IS NOT NULL AND length(cp.canonical_name) > 2
          AND cp.person_type IN ('enslaver','enslaved','descendant','free_poc','freedperson')
     )
     SELECT id, canonical_name, person_type, primary_state
       FROM ranked WHERE rn <= $1
      ORDER BY person_type, primary_state
      LIMIT 60`,
    [perStratum]
  );
  return rows.map(r => ({
    canonical_id: r.id, person_type: r.person_type, primary_state: r.primary_state,
    query: [r.canonical_name, r.primary_state, r.person_type].filter(Boolean).join(', '),
  }));
}

async function main() {
  // ── Cohort 1: served-gold famous enslavers (identity recall — expect ~100%). ──
  // Precise patterns to avoid substring/namesake traps (e.g. "%Ward%" matched "Edward").
  const servedGoldSpecs = [
    { name: 'Thomas Jefferson', pattern: 'Thomas Jefferson', query: "Which enslaved people did Thomas Jefferson's will and codicil free?" },
    { name: 'Alexander Hamilton', pattern: 'Alexander Hamilton', query: "What do Alexander Hamilton's cash books record about enslaved people?" },
    { name: 'Joshua John Ward', pattern: 'Joshua John Ward', query: "How many enslaved people are on Joshua Ward's 1860 slave schedule?" },
    { name: 'Robert E. Lee', pattern: 'Robert E. Lee', query: "What documents record Robert E. Lee as a slaveholder?" },
    { name: 'Wade Hampton', pattern: 'Wade Hampton', query: 'Wade Hampton 1860 slave schedule South Carolina' },
    { name: 'Howell Cobb', pattern: 'Howell Cobb', query: 'Howell Cobb 1860 slave schedule Georgia' },
    { name: 'Ladson', pattern: '%Ladson', query: 'Ladson 1860 slave schedule Georgia' },
    { name: 'Cameron', pattern: '%Cameron', query: 'Cameron 1860 slave schedule (Stagville/Orange Co)' },
  ];
  const served_gold = [];
  for (const spec of servedGoldSpecs) served_gold.push(await resolveServed(spec));

  // DC-cluster IDs already in the project's records (brief) — verified, not guessed.
  const dcCluster = [];
  for (const [id, label] of [[1070, 'James Hopewell'], [196747, 'Henry Weaver'],
                             [193163, 'Frisby Freeland Chew I'], [141014, 'Angelica Chew']]) {
    const v = await verifyId(id, label);
    v.query = `Tell me about ${label} and the document that records them.`;
    dcCluster.push(v);
  }

  // ── Cohort 3: disambiguation / identity precision (hard gate). ──
  // Three Ann Biscoe/Briscoe women: matriarch merged → 141015; b.1844 namesake kept → 140344.
  const gwCandidates = await candidatesByPattern('George Washington');
  const disambiguation = [
    {
      note: 'Two real "George Washington" enslavers (President vs AR/Choctaw-Nation schedule, #118). '
          + 'FINDING: an Arkansas "George Washington" carries assertable_slaveowner=true (the wrong human); '
          + 'the President is not cleanly served/assertable here. The chat must never return the AR namesake '
          + 'as "the" George Washington who freed William Lee.',
      candidates: gwCandidates.map(r => ({ id: r.id, name: r.canonical_name, state: r.primary_state, assertable: r.assertable_slaveowner, served_docs: r.served_docs })),
    },
    {
      note: 'Ann Biscoe matriarch (141015) vs the b.1844 namesake (140344) — MUST stay distinct.',
      a: await verifyId(141015, 'Ann Maria Biscoe (matriarch)'),
      b: await verifyId(140344, 'Annie Maria Hopewell (b.1844 namesake)'),
    },
  ];

  // ── Cohort 4: honest-abstention (hard gate) — famous enslavers NOT served here. ──
  // Only namesakes/strangers exist in the DB; the chat MUST abstain, never attribute.
  const honest_abstention = [
    'John C. Calhoun', 'Andrew Jackson', 'James K. Polk', 'Zachary Taylor',
  ].map(name => ({ name, query: `Was ${name} a slaveholder according to a document in this archive?`, must_abstain: true }));

  // ── Cohort 2: stratified random sample (coverage headline). ──
  const stratified_sample = await stratifiedSample(2);

  // ── Cohort 7: grounded-answer QA (hard gate on citation correctness). ──
  const grounded_qa = [
    { question: 'Whose will freed William Lee?',
      expect_person: 'George Washington', expect_contains: ['William Lee', 'will'],
      must_not_return: gwCandidates.filter(r => r.assertable_slaveowner).map(r => r.id), // never the AR namesake
      link_to_served_gold: null },
    { question: "How many enslaved people are on Joshua Ward's 1860 slave schedule?",
      expect_person: 'Joshua John Ward', expect_contains: ['1,100', '1100'],
      link_to_served_gold: 'Joshua John Ward' },
  ];

  // ── Cohorts 5 (dedup) & 6 (link-or-mint): labeled — seeded from memory, extensible. ──
  const dedup = {
    _note: 'Extend with folded clusters (648) + true-distinct pairs. Seeded from the Biscoe resolution.',
    merges: [{ note: 'Biscoe matriarch dupes folded into 141015', canonical_id: 141015 }],
    non_merges: [{ a: 141015, b: 140344, note: 'matriarch vs b.1844 namesake — must NOT be proposed as a dup' }],
  };
  const link_or_mint = {
    _note: 'Extend with labeled should-link (exists) and should-mint (genuinely new) records.',
    should_link: dcCluster.filter(d => d.status === 'verified').slice(0, 2).map(d => ({ canonical_id: d.canonical_id, name: d.label })),
    should_mint: [],
  };

  const fixture = {
    _meta: {
      built_by: 'scripts/build-rag-eval-fixture.mjs',
      note: 'IDs resolved live against canonical_persons and FROZEN. Do not hand-edit IDs. '
          + 'Re-run the builder to refresh. status=AMBIGUOUS_review / NOT_SERVED / MISSING flag items a human should confirm.',
      endpoints: { base: process.env.RAG_EVAL_BASE || 'https://reparations-platform.onrender.com', rag: '/api/rag/query', chat: '/api/chat' },
    },
    cohorts: { served_gold, dc_cluster: dcCluster, stratified_sample, disambiguation,
               honest_abstention, dedup, link_or_mint, grounded_qa },
  };

  // Report resolution status so the human sees what needs confirming.
  const flags = [
    ...served_gold.filter(s => s.status !== 'resolved').map(s => `served_gold[${s.name}]=${s.status}`),
    ...dcCluster.filter(d => d.status !== 'verified').map(d => `dc_cluster[${d.label}]=${d.status}`),
  ];
  console.log(`served_gold resolved: ${served_gold.filter(s => s.status === 'resolved').length}/${served_gold.length}`);
  console.log(`dc_cluster verified: ${dcCluster.filter(d => d.status === 'verified').length}/${dcCluster.length}`);
  console.log(`stratified_sample: ${stratified_sample.length} records`);
  if (flags.length) console.log('FLAGS (confirm before trusting):\n  ' + flags.join('\n  '));

  if (DRY) {
    console.log(JSON.stringify(fixture, null, 2).slice(0, 1500) + '\n...(dry run, not written)');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(fixture, null, 2));
    console.log(`\nWrote ${OUT}`);
  }
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
