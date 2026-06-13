#!/usr/bin/env node
/**
 * Phase-0 calibration harness run. Wires the EXISTING deterministic pipeline's
 * per-descendant figures (reparations_line_items) in as Model A, benchmarks them
 * to the cited macro targets (Brattle / Darity), reports cross-reference-class
 * consistency, and demonstrates Reconcile against a per-capita-standard model —
 * writing the disagreement-region audit trail to a JSON artifact.
 *
 * This is the spine: every future model (Splink ER, GNN) plugs in the same way.
 *
 *   node scripts/run-calibration-harness.mjs            # report + reconcile demo
 *   node scripts/run-calibration-harness.mjs --out /tmp/cal-audit.json
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url'; import fs from 'node:fs';
import dotenv from 'dotenv'; import pg from 'pg';
import { TARGETS, darityMidPerCapita } from '../src/services/calibration/targets.mjs';
import { benchmarkRatio, consistencyReport, reconcile } from '../src/services/calibration/calibration-harness.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const outI = process.argv.indexOf('--out');
const OUT = outI > -1 ? process.argv[outI + 1] : '/tmp/calibration-audit.json';
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

(async () => {
  // ── load Model A: per-person reparations figure + reference-class features ──
  const rows = (await pool.query(`
    SELECT canonical_person_id pid, sum(compounded_amount_usd) est,
           array_agg(DISTINCT beneficiary_type) bt,
           array_agg(DISTINCT brattle_head)     bh,
           array_agg(DISTINCT evidence_tier)    et,
           array_agg(DISTINCT perpetrating_nation) pn
    FROM reparations_line_items
    WHERE compounded_amount_usd IS NOT NULL
    GROUP BY 1`)).rows.map((r) => ({ ...r, est: parseFloat(r.est) }));
  const N = rows.length, total = rows.reduce((a, u) => a + u.est, 0);
  const mean = total / N;
  console.log(`\n=== MODEL A (existing deterministic pipeline) ===`);
  console.log(`  units (canonical persons with a figure): ${N.toLocaleString()}`);
  console.log(`  aggregate: ${usd(total)}   per-unit mean: ${usd(mean)}`);

  // ── reference classes from the feature columns (computationally identifiable) ──
  const distinct = (key) => [...new Set(rows.flatMap((r) => r[key] || []).filter((v) => v != null))];
  const classes = [];
  for (const v of distinct('bt')) classes.push({ name: `beneficiary_type=${v}`, pred: (u) => (u.bt || []).includes(v) });
  for (const v of distinct('bh')) classes.push({ name: `brattle_head=${v}`, pred: (u) => (u.bh || []).includes(v) });
  for (const v of distinct('et')) classes.push({ name: `evidence_tier=${v}`, pred: (u) => (u.et || []).includes(v) });
  console.log(`  reference classes: ${classes.length} (beneficiary_type, brattle_head, evidence_tier)`);

  // ── the reference-class problem, made visible: per-class means of Model A ──
  const rep = consistencyReport(rows, (u) => u.est, classes.map((c) => ({ ...c, target: null })));
  const spread = rep.rows.filter((r) => r.n > 0).map((r) => r.mean);
  console.log(`\n=== REFERENCE-CLASS SPREAD of Model A (the indeterminacy) ===`);
  console.log(`  per-class mean ranges ${usd(Math.min(...spread))} … ${usd(Math.max(...spread))} across ${spread.length} classes`);
  rep.rows.filter((r) => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 8)
    .forEach((r) => console.log(`    ${r.class.padEnd(36)} n=${String(r.n).padStart(7)}  mean=${usd(r.mean)}`));

  // ── BENCHMARKING to the cited macro targets ──
  console.log(`\n=== BENCHMARKING (force agreement with reliable aggregate controls) ===`);
  const darityMid = darityMidPerCapita();
  console.log(`  Darity per-eligible-descendant standard: ${usd(TARGETS.darity_percapita_low_usd.value)}–${usd(TARGETS.darity_percapita_high_usd.value)} (${TARGETS.darity_percapita_low_usd.cite})`);
  console.log(`  Model A per-unit mean ${usd(mean)} is ${(darityMid / mean).toFixed(1)}× BELOW the Darity midpoint ${usd(darityMid)}`);
  console.log(`  ⚠ denominator caveat: Model A units are HISTORICAL persons in the graph (${N.toLocaleString()}),`);
  console.log(`    NOT the ~${(TARGETS.darity_eligible_n.value / 1e6)}M living eligible descendants Darity counts — benchmark at matching frame.`);
  const benchDarity = benchmarkRatio(rows, (u) => u.est, darityMid * N); // bring per-unit MEAN to Darity midpoint
  console.log(`  ratio-benchmark factor to Darity-midpoint per-unit: ×${benchDarity.factor.toFixed(2)}`);
  const benchBrattle = benchmarkRatio(rows, (u) => u.est, TARGETS.brattle_us_tcs_usd.value);
  console.log(`  ratio-benchmark factor to Brattle US total (${usd(TARGETS.brattle_us_tcs_usd.value)}): ×${benchBrattle.factor.toFixed(1)} (inflated — graph covers a fraction of US enslaved; needs coverage/expansion factor)`);

  // ── RECONCILE: flat Model A  vs  a per-capita-standard model B ──
  // Model B = "every eligible person is owed the Darity midpoint" (the macro
  // standard asserted uniformly). Reconcile forces coherence on the witnessing
  // reference classes and logs the trajectory. (A real Model B — Splink/GNN —
  // replaces this synthetic one in Phase 1+.)
  console.log(`\n=== RECONCILE  (Model A: deterministic  ⟷  Model B: Darity per-capita standard) ===`);
  const f1 = new Map(rows.map((u) => [u.pid, u.est]));
  const f2 = new Map(rows.map((u) => [u.pid, darityMid]));
  const eps = 0.02 * darityMid; // agree within 2% of the per-capita standard
  const rec = reconcile(rows, f1, f2, classes, eps);
  console.log(`  eps=${usd(eps)}  iterations=${rec.trajectory.length}  converged=${rec.converged}`);
  rec.trajectory.filter((t) => !t.converged).slice(0, 6).forEach((t) =>
    console.log(`    iter ${t.iter}: witnessed by ${t.witnessing_class} (n=${t.n})  ΔA/B ${usd(t.e1)}/${usd(t.e2)} gap ${usd(t.gap)} → ${usd(t.patched_to)}`));

  // ── audit artifact (Phase-0 archival will dual-write this to Internet Archive) ──
  const audit = {
    generated_for: 'phase0-calibration-harness',
    model_a: { source: 'reparations_line_items', units: N, aggregate_usd: Math.round(total), per_unit_mean_usd: Math.round(mean) },
    targets: TARGETS,
    reference_classes: rep.rows,
    benchmarking: { darity_midpoint_factor: benchDarity.factor, brattle_us_factor: benchBrattle.factor },
    reconcile: { eps, converged: rec.converged, iterations: rec.trajectory.length, trajectory: rec.trajectory },
    epistemic_note: 'Benchmarking to control totals + Reconcile for cross-model COHERENCE; NOT calibration to observed outcomes (none exist). Predictive/attributive only (Tolbert positivity guardrail).',
  };
  fs.writeFileSync(OUT, JSON.stringify(audit, null, 2));
  console.log(`\n  audit trail written: ${OUT}  (→ Phase-0 archival dual-writes this to IA, append-only)`);
  await pool.end();
})();
