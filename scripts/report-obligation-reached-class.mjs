// report-obligation-reached-class.mjs — READ-ONLY. The obligation / pledged / REACHED comparison.
//
// Standard: memory-bank/standard-obligation-ledger.md §4 (the reached-class test).
//
// The point of this report: a payer's assertion that they have repaired something is a fact worth
// recording, and it is NOT the same fact as repair. `corporate_slavery_disclosures.remediation_funded`
// currently collapses both into one free-text column. This report pulls them apart and shows, per payer:
//
//     what is DOCUMENTED as taken   |   what was PLEDGED / moved   |   whether it REACHED the class
//
// AUDIT RULE 1 (CLAUDE.md): the model orchestrates, deterministic code computes. This script therefore
// NEVER reads the remediation prose and decides whether repair reached anyone. It computes only what is
// structurally derivable:
//   * nothing recorded as moved            -> reached_class = 'no'          (nothing moved, nothing reached)
//   * something recorded as moved          -> reached_class = 'undetermined' + adjudication_required
// A human posts the `offset_adjudicated` entry. That is the whole design, not a limitation of this script.
//
// No writes. Safe to run against production.
//
// Usage:
//   node scripts/report-obligation-reached-class.mjs            # table
//   node scripts/report-obligation-reached-class.mjs --json     # machine-readable
//   node scripts/report-obligation-reached-class.mjs --gaps     # only the unadjudicated / undocumented

import 'dotenv/config';
import pg from 'pg';

const AS_JSON = process.argv.includes('--json');
const GAPS_ONLY = process.argv.includes('--gaps');

// Values of the free-text `remediation_funded` column that deterministically mean "nothing moved".
// Anything else is prose describing a transfer and is routed to human adjudication -- never parsed here.
const NOTHING_MOVED = new Set(['false', 'no', 'none', 'null', '0', '']);

const usd = (v) => (v === null || v === undefined ? null : Number(v));
const money = (v) => (v === null ? '—' : '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }));

function classify(row) {
  const raw = (row.remediation_funded ?? '').toString().trim();
  const movedRecorded = raw !== '' && !NOTHING_MOVED.has(raw.toLowerCase());

  // §1.5.2 — an account requires a priced, dated, documented origination entry.
  const originationPriced = usd(row.documented_value_usd) !== null;
  const originationCounted = row.enslaved_persons_count !== null;
  const originationEntryAvailable = originationPriced || originationCounted;

  return {
    origination_priced: originationPriced,
    origination_counted: originationCounted,
    origination_entry_available: originationEntryAvailable,
    remediation_recorded: movedRecorded,
    // Deterministic only. See header.
    reached_class: movedRecorded ? 'undetermined' : 'no',
    adjudication_required: movedRecorded,
    // §4 counters: this project has not yet identified claimant sets for these payers.
    documented_claimants_identified: null,
    documented_claimants_receiving: null,
  };
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (fail loud, not silent).');

  // corporate_slavery_disclosures has NO foreign key to corporate_entities -- it carries denormalized
  // modern_entity_name / historical_entity_name. Join on the name and report non-matches rather than
  // silently dropping them (a LEFT JOIN so a disclosure without an entity row still appears).
  const { rows } = await pool.query(`
    SELECT d.disclosure_id,
           d.modern_entity_name,
           d.historical_entity_name,
           d.involvement_type,
           d.involvement_period_start,
           d.involvement_period_end,
           d.enslaved_persons_count,
           d.enslaved_persons_direct_owned,
           d.documented_value_usd,
           d.disclosure_year,
           d.triggered_by,
           d.has_names_list,
           d.formal_apology,
           d.remediation_funded,
           d.review_status,
           ce.entity_id,
           ce.entity_type
      FROM corporate_slavery_disclosures d
      LEFT JOIN corporate_entities ce
             ON lower(ce.modern_name) = lower(d.modern_entity_name)
     ORDER BY (d.documented_value_usd IS NULL),
              d.documented_value_usd DESC NULLS LAST,
              d.modern_entity_name
  `);

  const report = rows.map((r) => ({ ...r, ...classify(r) }));
  const shown = GAPS_ONLY
    ? report.filter((r) => r.adjudication_required || !r.origination_entry_available)
    : report;

  if (AS_JSON) {
    console.log(JSON.stringify({ generated_for: 'standard-obligation-ledger.md §4', rows: shown }, null, 2));
  } else {
    console.log('\nOBLIGATION / PLEDGED / REACHED — corporate_slavery_disclosures');
    console.log('standard-obligation-ledger.md §4. Read-only. reached_class is computed structurally only.\n');

    for (const r of shown) {
      const period = [r.involvement_period_start, r.involvement_period_end].filter(Boolean).join('–') || '—';
      console.log(`── ${r.modern_entity_name}`);
      console.log(`   historical      : ${r.historical_entity_name || '—'}`);
      console.log(`   involvement     : ${r.involvement_type} (${period})`);
      console.log(`   OBLIGATION      : documented value ${money(usd(r.documented_value_usd))} · ` +
                  `enslaved count ${r.enslaved_persons_count ?? '—'}` +
                  (r.enslaved_persons_direct_owned ? ` (${r.enslaved_persons_direct_owned} directly owned)` : '') +
                  ` · names list ${r.has_names_list ? 'YES' : 'no'}`);
      console.log(`   PLEDGED / MOVED : ${r.remediation_recorded ? r.remediation_funded : '(nothing recorded)'}`);
      console.log(`   REACHED CLASS   : ${r.reached_class.toUpperCase()}` +
                  (r.adjudication_required ? '   ← ADJUDICATION REQUIRED (human posts offset_adjudicated)' : ''));
      console.log(`   origination entry available: ${r.origination_entry_available ? 'yes' : 'NO — cannot open an account (§1.5.2)'}`);
      if (!r.entity_id) console.log('   ⚠ no corporate_entities row matched on modern_name (no FK exists; name join failed)');
      console.log('');
    }
  }

  // ---- summary (always to stderr so --json stays clean) ----
  const n = report.length;
  const priced = report.filter((r) => r.origination_priced).length;
  const counted = report.filter((r) => r.origination_counted).length;
  const openable = report.filter((r) => r.origination_entry_available).length;
  const moved = report.filter((r) => r.remediation_recorded).length;
  const reachedNo = report.filter((r) => r.reached_class === 'no').length;
  const unmatched = report.filter((r) => !r.entity_id).length;

  const s = [
    '',
    `disclosures                              : ${n}`,
    `  with a PRICED origination value        : ${priced}`,
    `  with an enslaved COUNT                 : ${counted}`,
    `  able to open an account (§1.5.2)       : ${openable}   ${openable < n ? `← ${n - openable} cannot` : ''}`,
    `  with ANY remediation recorded          : ${moved}`,
    `  reached_class = 'no' (nothing moved)   : ${reachedNo}`,
    `  awaiting human adjudication            : ${moved}`,
    `  unmatched to corporate_entities        : ${unmatched}   (no FK; name join)`,
    '',
    'NOTE: reached_class is NEVER inferred from prose here (audit rule 1). Every payer that moved',
    'something is routed to human adjudication; only "nothing moved" is decided by code.',
    '',
  ].join('\n');
  console.error(s);
} catch (err) {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
