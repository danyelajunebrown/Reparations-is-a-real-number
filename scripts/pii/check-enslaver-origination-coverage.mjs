// check-enslaver-origination-coverage.mjs — PII LANE. READ-ONLY (DB). No writes to the database.
//
// QUESTION IT ANSWERS
//   "Of the enslavers a participant's line runs through, how many can open an obligation account on
//    `principal_basis='transaction_documented'` — i.e. a real dated priced instrument — rather than on a
//    category-level formula?"
//   Standard: memory-bank/standard-obligation-ledger.md §2.4b, §1.5.2.
//
//   Live baseline (2026-08-09): all 48,985 `chattel_transfer_events` are priced AND linked to a
//   `to_enslaver_id`, across 18,180 distinct enslavers — against 1,970,245 `reparations_line_items`
//   holding only 86 distinct dollar values. An enslaver inside those 18,180 can open a DOCUMENTED
//   account today. One outside them opens MODELED, and the balance must say so.
//
// WHY THIS LIVES IN scripts/pii/
//   The enslavers are long-dead public research subjects; their names and canonical IDs are not PII.
//   The SENSITIVE fact is the LINKAGE — "these are <living participant>'s ancestors' enslavers."
//   So by default this script emits AGGREGATES to stdout and writes per-enslaver detail to a file in
//   the PII directory, which the operator reads themselves. The model reads the aggregate, never the link.
//   (CLAUDE.md audit rule 1 applied to PII, per .claude/hooks/block-pii-access.mjs.)
//   --emit-detail overrides this. That is the OPERATOR's call to make explicitly, never the default.
//
// BISCOE RULE (memory/project_biscoe_identity_resolution.md)
//   Name-only matches are NEVER auto-resolved. Stage 1 produces CANDIDATES with disambiguating detail
//   for a human to choose from; it does not pick. Stage 2 consumes only IDs a human confirmed.
//
// USAGE
//   Stage 1 — names -> candidates (human picks):
//     node scripts/pii/check-enslaver-origination-coverage.mjs --resolve \
//          --in  ~/Documents/reparations-pii/my-enslavers.txt \
//          --out ~/Documents/reparations-pii/my-enslavers-candidates.tsv
//     Input: one per line, `Name` or `Name | STATE` or `Name | STATE | COUNTY`. Blank/`#` lines ignored.
//
//   Stage 2 — confirmed IDs -> origination coverage:
//     node scripts/pii/check-enslaver-origination-coverage.mjs --coverage \
//          --ids ~/Documents/reparations-pii/my-enslavers-confirmed.txt \
//          --out ~/Documents/reparations-pii/my-enslavers-coverage.tsv
//     Input: one canonical_persons.id per line (from the stage-1 file, after you choose).
//     Add --emit-detail to print per-enslaver rows to stdout as well.

import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const expand = (p) => (p || '').replace(/^~/, process.env.HOME || '~');

const MODE = has('--resolve') ? 'resolve' : has('--coverage') ? 'coverage' : null;
const EMIT_DETAIL = has('--emit-detail');

if (!MODE) {
  console.error('Specify --resolve or --coverage. See header for usage.');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (fail loud, not silent).');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const readLines = (p) =>
  fs.readFileSync(expand(p), 'utf8')
    .split('\n').map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));

// ── Stage 1: names -> candidates (no auto-resolution; Biscoe) ────────────────
async function resolve() {
  const inPath = val('--in');
  const outPath = val('--out') || expand('~/Documents/reparations-pii/enslaver-candidates.tsv');
  if (!inPath) { console.error('--resolve requires --in <file>'); process.exit(2); }

  const entries = readLines(inPath).map((line) => {
    const [name, state, county] = line.split('|').map((s) => (s || '').trim());
    return { name, state: state || null, county: county || null };
  });

  const out = ['input_line\tcandidate_id\tcanonical_name\tborn\tdied\tstate\tcounty\tassertable\timage_backed\tpriced_transfers'];
  let withCandidates = 0, ambiguous = 0, noMatch = 0, totalCandidates = 0;

  for (const [i, e] of entries.entries()) {
    const { rows } = await pool.query(
      `SELECT cp.id, cp.canonical_name, cp.birth_year_estimate, cp.death_year_estimate,
              cp.primary_state, cp.primary_county, cp.assertable_slaveowner,
              EXISTS (SELECT 1 FROM person_documents pd
                       WHERE pd.canonical_person_id = cp.id AND pd.s3_key IS NOT NULL) AS image_backed,
              (SELECT count(*) FROM chattel_transfer_events c WHERE c.to_enslaver_id = cp.id) AS priced_transfers
         FROM canonical_persons cp
        WHERE cp.person_type = 'enslaver'
          AND cp.canonical_name ILIKE $1
          AND ($2::text IS NULL OR cp.primary_state ILIKE $2)
          AND ($3::text IS NULL OR cp.primary_county ILIKE $3)
        ORDER BY (SELECT count(*) FROM chattel_transfer_events c WHERE c.to_enslaver_id = cp.id) DESC,
                 cp.assertable_slaveowner DESC NULLS LAST
        LIMIT 25`,
      [`%${e.name}%`, e.state, e.county]);

    if (rows.length === 0) { noMatch++; out.push(`${i + 1}\t(no match)\t\t\t\t\t\t\t\t`); continue; }
    withCandidates++;
    if (rows.length > 1) ambiguous++;
    totalCandidates += rows.length;
    for (const r of rows) {
      out.push([i + 1, r.id, r.canonical_name, r.birth_year_estimate ?? '', r.death_year_estimate ?? '',
                r.primary_state ?? '', r.primary_county ?? '', r.assertable_slaveowner ? 'Y' : 'n',
                r.image_backed ? 'Y' : 'n', r.priced_transfers].join('\t'));
    }
  }

  fs.writeFileSync(expand(outPath), out.join('\n') + '\n', { mode: 0o600 });

  // AGGREGATE ONLY to stdout — the linkage stays in the file.
  console.log(JSON.stringify({
    stage: 'resolve',
    names_in: entries.length,
    with_candidates: withCandidates,
    ambiguous_needs_human_choice: ambiguous,
    no_match: noMatch,
    candidate_rows_written: totalCandidates,
    out_file: outPath,
    next: 'Open the file, choose ONE id per person (Biscoe: never auto-merge name-only), ' +
          'write the chosen ids one-per-line, then re-run with --coverage --ids <that file>.',
  }, null, 2));
}

// ── Stage 2: confirmed IDs -> documented-origination coverage ───────────────
async function coverage() {
  const idsPath = val('--ids');
  const outPath = val('--out') || expand('~/Documents/reparations-pii/enslaver-coverage.tsv');
  if (!idsPath) { console.error('--coverage requires --ids <file>'); process.exit(2); }

  const ids = readLines(idsPath).map(Number).filter(Number.isInteger);
  if (!ids.length) { console.error('No integer canonical ids found in --ids file.'); process.exit(2); }

  const { rows } = await pool.query(
    `SELECT cp.id, cp.canonical_name, cp.birth_year_estimate, cp.death_year_estimate,
            cp.primary_state, cp.primary_county, cp.assertable_slaveowner,
            EXISTS (SELECT 1 FROM person_documents pd
                     WHERE pd.canonical_person_id = cp.id AND pd.s3_key IS NOT NULL) AS image_backed,
            coalesce(t.n, 0)              AS priced_transfers,
            t.min_year, t.max_year,
            t.sum_usd_equiv, t.distinct_prices,
            coalesce(ie.n, 0)             AS inheritance_edges,
            coalesce(lte.n, 0)            AS land_transfers_priced
       FROM canonical_persons cp
       LEFT JOIN (
            SELECT to_enslaver_id AS eid, count(*) n,
                   min(transfer_year) min_year, max(transfer_year) max_year,
                   sum(value_usd_equiv) sum_usd_equiv,
                   count(DISTINCT value_usd_equiv) distinct_prices
              FROM chattel_transfer_events GROUP BY 1) t ON t.eid = cp.id
       LEFT JOIN (SELECT testator_id AS eid, count(*) n
                    FROM inheritance_edges GROUP BY 1) ie ON ie.eid = cp.id
       LEFT JOIN (SELECT enslaver_person_id AS eid, count(*) n
                    FROM land_transfer_events
                   WHERE consideration_usd IS NOT NULL GROUP BY 1) lte ON lte.eid = cp.id
      WHERE cp.id = ANY($1::int[])
      ORDER BY coalesce(t.n, 0) DESC, cp.canonical_name`,
    [ids]);

  const header = ['canonical_id', 'canonical_name', 'born', 'died', 'state', 'county', 'assertable',
                  'image_backed', 'priced_transfers', 'years', 'distinct_prices', 'sum_usd_equiv',
                  'inheritance_edges', 'land_transfers_priced', 'principal_basis_available'];
  const lines = [header.join('\t')];

  let documented = 0, modeled = 0;
  for (const r of rows) {
    const basis = Number(r.priced_transfers) > 0 ? 'transaction_documented' : 'modeled';
    if (basis === 'transaction_documented') documented++; else modeled++;
    lines.push([r.id, r.canonical_name, r.birth_year_estimate ?? '', r.death_year_estimate ?? '',
                r.primary_state ?? '', r.primary_county ?? '', r.assertable_slaveowner ? 'Y' : 'n',
                r.image_backed ? 'Y' : 'n', r.priced_transfers,
                r.min_year && r.max_year ? `${r.min_year}-${r.max_year}` : '',
                r.distinct_prices ?? '', r.sum_usd_equiv ?? '',
                r.inheritance_edges, r.land_transfers_priced, basis].join('\t'));
  }
  fs.writeFileSync(expand(outPath), lines.join('\n') + '\n', { mode: 0o600 });

  const missing = ids.filter((i) => !rows.some((r) => r.id === i));
  const totalTx = rows.reduce((a, r) => a + Number(r.priced_transfers), 0);

  console.log(JSON.stringify({
    stage: 'coverage',
    standard: 'standard-obligation-ledger.md §2.4b',
    enslavers_checked: ids.length,
    resolved_in_db: rows.length,
    not_found: missing.length,
    can_open_transaction_documented: documented,
    would_open_modeled: modeled,
    priced_transactions_available: totalTx,
    image_backed: rows.filter((r) => r.image_backed).length,
    assertable_slaveowner: rows.filter((r) => r.assertable_slaveowner).length,
    with_inheritance_edges: rows.filter((r) => Number(r.inheritance_edges) > 0).length,
    out_file: outPath,
    verdict: documented > 0
      ? `${documented} account(s) can open on DOCUMENTED principal — a real dated priced instrument, not a formula. This is the end-to-end candidate.`
      : 'No documented priced transaction for any of these enslavers. Accounts would open MODELED (principal_basis=modeled) and the balance must say so. Acquisition, not code, is the gap.',
  }, null, 2));

  if (EMIT_DETAIL) {
    console.log('\n--emit-detail (operator-requested):');
    for (const l of lines) console.log('  ' + l);
  }
}

try {
  await (MODE === 'resolve' ? resolve() : coverage());
} catch (err) {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
