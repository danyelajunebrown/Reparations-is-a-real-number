/**
 * Calibration / reconciliation harness — Phase 0 spine.
 *
 * EPISTEMOLOGY (corrected from the implementation brief, verified Jun 2026):
 * a per-descendant reparations figure is an "individual quantity" that classical
 * reference-class theory deems indeterminate. The brief proposed disciplining it
 * with ML *multicalibration* (Hébert-Johnson et al. 2018; Roth & Tolbert 2025).
 * But multicalibration calibrates predictions against OBSERVED OUTCOMES — and no
 * reparations have been paid, so there is no observed per-descendant outcome.
 * Brattle/Darity are themselves model outputs (their authors call them
 * underestimates). So the honest structure is a THREE-PART stack, each tool used
 * for what it actually does:
 *
 *   1. BENCHMARKING  (survey calibration, Deville–Särndal 1992; small-area-
 *      estimation benchmarking, e.g. Pfeffermann; Bayesian benchmarking via
 *      entropic tilting, arXiv:2407.17848): force model-based per-unit estimates
 *      to AGREE WITH a known, more-reliable aggregate control total (Brattle
 *      macro, Darity per-capita). This is the right tool for "must sum to a
 *      trusted total" — NOT calibration-to-observed-labels.
 *   2. MULTICALIBRATION / CONSISTENCY: enforce E[f|S] ≈ target(S) across
 *      computationally-identifiable reference classes S. With no observed labels
 *      the target is itself benchmarked/model-derived, so this is consistency
 *      w.r.t. a target measure, NOT calibration-to-reality. We report the max
 *      per-class gap as the diagnostic.
 *   3. RECONCILE (Roth, Tolbert & Weinstein, FAccT 2023, arXiv:2209.01687):
 *      cross-MODEL coherence. Two models that disagree witness a reference class
 *      on which one is wrong; patch the witnessing region and iterate. Label-free
 *      here, so it forces COHERENCE ("cannot agree to disagree on shared data"),
 *      not accuracy. The strongest epistemic status actually available.
 *
 * CAUSAL GUARDRAIL (Tolbert 2025): racial stratification creates positivity
 * violations that break causal identification. This engine is PREDICTIVE/
 * ATTRIBUTIVE only; causal language stays quarantined elsewhere.
 *
 * Every model (the existing deterministic pipeline, a future Splink ER matcher,
 * a future GNN) plugs in as a per-unit estimate vector; the harness benchmarks,
 * reports consistency, and reconciles. Light numeric + Postgres — Node, no new
 * toolchain (neural phases are Python, gated on this proving value).
 */

// ── benchmarking ──────────────────────────────────────────────────────────
// Global ratio benchmark: scale all units by one factor so they sum to control.
export function benchmarkRatio(units, getEst, controlTotal) {
  const sum = units.reduce((a, u) => a + getEst(u), 0);
  const factor = sum > 0 ? controlTotal / sum : 0;
  return { method: 'ratio', factor, sumBefore: sum, sumAfter: controlTotal,
    estimates: new Map(units.map((u) => [u.pid, getEst(u) * factor])) };
}

// Stratified ratio benchmark: a separate factor per stratum when stratum-level
// controls are known (closer to GREG/raking; avoids one global prorate).
export function benchmarkStratified(units, getEst, strataOf, controlByStratum) {
  const out = new Map(); const factors = {};
  const groups = {};
  for (const u of units) { const s = strataOf(u); (groups[s] ||= []).push(u); }
  for (const [s, members] of Object.entries(groups)) {
    const ctrl = controlByStratum[s];
    const sum = members.reduce((a, u) => a + getEst(u), 0);
    const f = (ctrl != null && sum > 0) ? ctrl / sum : 1;
    factors[s] = f;
    for (const u of members) out.set(u.pid, getEst(u) * f);
  }
  return { method: 'stratified-ratio', factors, estimates: out };
}

// ── multicalibration / consistency report ────────────────────────────────
// classes: [{ name, pred:(u)=>bool, target:number|null }]
// getEst: (u)=>number (raw or benchmarked). Reports per-class mean vs target
// and the max absolute gap (the multicalibration error).
export function consistencyReport(units, getEst, classes) {
  const rows = classes.map((c) => {
    const m = units.filter(c.pred);
    const mean = m.length ? m.reduce((a, u) => a + getEst(u), 0) / m.length : 0;
    const gap = c.target != null ? mean - c.target : null;
    return { class: c.name, n: m.length, mean, target: c.target ?? null, gap };
  });
  const gaps = rows.filter((r) => r.gap != null).map((r) => Math.abs(r.gap));
  return { rows, maxAbsGap: gaps.length ? Math.max(...gaps) : 0,
    meanAbsGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0 };
}

// ── Reconcile (label-free coherence variant) ──────────────────────────────
// f1/f2: Map(pid->value). classes: [{name, pred}]. Iteratively finds the group
// that most witnesses the disagreement and patches BOTH model means to their
// midpoint there (no labels => no "loser"; we force coherence). Logs the full
// trajectory = the disagreement-region audit trail the brief's defensibility
// claim requires.
export function reconcile(units, f1, f2, classes, eps, maxIter = 100) {
  f1 = new Map(f1); f2 = new Map(f2);
  const trajectory = [];
  const byClass = classes.map((c) => ({ c, members: units.filter(c.pred) })).filter((g) => g.members.length);
  for (let it = 0; it < maxIter; it++) {
    let worst = null;
    for (const g of byClass) {
      const e1 = g.members.reduce((a, u) => a + f1.get(u.pid), 0) / g.members.length;
      const e2 = g.members.reduce((a, u) => a + f2.get(u.pid), 0) / g.members.length;
      const gap = Math.abs(e1 - e2);
      if (!worst || gap > worst.gap) worst = { g, e1, e2, gap };
    }
    if (!worst || worst.gap <= eps) { trajectory.push({ iter: it, converged: true, maxGap: worst ? worst.gap : 0 }); break; }
    const mid = (worst.e1 + worst.e2) / 2;
    for (const u of worst.g.members) {
      f1.set(u.pid, f1.get(u.pid) + (mid - worst.e1));   // shift f1 group-mean -> mid
      f2.set(u.pid, f2.get(u.pid) + (mid - worst.e2));   // shift f2 group-mean -> mid
    }
    trajectory.push({ iter: it, witnessing_class: worst.g.c.name, n: worst.g.members.length,
      e1: Math.round(worst.e1), e2: Math.round(worst.e2), gap: Math.round(worst.gap), patched_to: Math.round(mid) });
  }
  return { f1, f2, trajectory, converged: trajectory[trajectory.length - 1]?.converged === true };
}
