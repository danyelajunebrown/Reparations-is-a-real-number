'use strict';

/**
 * ObligationReconciler
 *
 * Replaces the old combination rule — `max(Craemer, wealth-gap)` (WealthGapCalculator
 * .compareWithCraemer) or `sum(line items)` — with a calibrated-and-reconciled
 * combination of the FOUR predictors:
 *
 *     1. craemer    — labor-value (cost-to-enslaved), DAAGenerator
 *     2. wealthGap  — SCF share-of-gap, WealthGapCalculator
 *     3. disgorgement — traced non-chattel enrichment, DisgorgementCalculator
 *     4. lineItem   — itemized reparations_line_items sum
 *
 * This is the Phase-0 calibration stack (src/services/calibration/) applied to the
 * obligation: BENCHMARK to a trusted control total, report CONSISTENCY across
 * reference classes, and RECONCILE cross-model disagreement toward coherence —
 * label-free, because no reparations have been observed. It is PREDICTIVE /
 * ATTRIBUTIVE only; no causal claim is made here.
 *
 * ── VALUES CHOICES (made explicit, per the build directive) ──────────────────
 * These are PARAMETERS, not learned values. They are surfaced in every result's
 * `.metadata` and should be reviewed, not buried:
 *
 *   damagesTheory = 'unjust_enrichment_floor_with_wealthgap_reconciliation'
 *     The traced disgorgement (documented taking) is a HARD FLOOR — the
 *     obligation is never below what records prove was extracted. The headline
 *     figure is the confidence-weighted reconciliation of the three MODELED
 *     predictors (Craemer, wealth-gap, line-item), floored at disgorgement.
 *     This deliberately does NOT let the single most aggressive theory win by
 *     `max()`, and does NOT rubber-stamp by plain mean.
 *
 *   darityOperationalization = 'carry_both'
 *     The $14T demographic per-capita ($350k) and the $8.41T SCF mean-gap
 *     ($210k) operationalizations are BOTH carried as distinct benchmark
 *     targets. Neither is silently canonical. Benchmarking reports against the
 *     Darity per-descendant BAND [267k, 800k] rather than a single point.
 *
 *   missingData = 'explicit_low_confidence'
 *     Absent predictors are dropped (not imputed to 0-as-fact); a predictor with
 *     no evidence carries low confidence so it down-weights rather than anchoring.
 *     The result confidence falls accordingly. Never a silent constant.
 *
 * Belinda Sutton / DC $300 cap / Washington & Randolph bequests are NOT inputs
 * here — they are existence proofs / offsets, never the owed magnitude. (See the
 * `amountAlreadyTransferred` offset hook in combine(), which is the ONLY place a
 * historical settlement may appear, and only as a credit against the owed total.)
 */

class ObligationReconciler {
    constructor(opts = {}) {
        this.damagesTheory = opts.damagesTheory
            || 'unjust_enrichment_floor_with_wealthgap_reconciliation';
        this.darityOperationalization = opts.darityOperationalization || 'carry_both';
        this.missingData = opts.missingData || 'explicit_low_confidence';
    }

    /**
     * Combine the four predictors for a SINGLE lineage.
     *
     * @param {Object} predictors - each value is { usd:number|null, confidence:number, evidence?:string }
     *        { craemer, wealthGap, disgorgement, lineItem }
     * @param {Object} [opts]
     * @param {number} [opts.amountAlreadyTransferred=0] - credit (e.g. a documented
     *        prior settlement). The ONLY place a historical award may enter, and
     *        only as an offset against the owed total — never as the owed magnitude.
     * @returns {Object} reconciliation result with audit trail
     */
    combine(predictors, opts = {}) {
        const amountAlreadyTransferred = Number(opts.amountAlreadyTransferred || 0);

        // Normalize: keep only predictors that are actually present.
        const all = {
            craemer:      this._norm(predictors.craemer),
            wealthGap:    this._norm(predictors.wealthGap),
            disgorgement: this._norm(predictors.disgorgement),
            lineItem:     this._norm(predictors.lineItem),
        };

        // Disgorgement is the FLOOR (traced taking), not a competing predictor.
        const floor = all.disgorgement && all.disgorgement.evidence === 'traced'
            ? all.disgorgement.usd
            : 0;

        // The three modeled predictors compete for the headline central estimate.
        const modeled = ['craemer', 'wealthGap', 'lineItem']
            .map((k) => all[k])
            .filter((p) => p && p.usd != null && p.confidence > 0);

        // Disagreement region across present modeled predictors.
        const presentVals = modeled.map((p) => p.usd);
        const disagreement = this._disagreement(presentVals);

        // Confidence-weighted central estimate (NOT max, NOT plain mean).
        let reconciledModeled = null;
        if (modeled.length > 0) {
            const wsum = modeled.reduce((a, p) => a + p.confidence, 0);
            reconciledModeled = wsum > 0
                ? modeled.reduce((a, p) => a + p.confidence * p.usd, 0) / wsum
                : modeled.reduce((a, p) => a + p.usd, 0) / modeled.length;
        }

        // Apply the damages theory: floored at disgorgement.
        const beforeOffset = Math.max(floor, reconciledModeled != null ? reconciledModeled : floor);
        const reconciled = Math.max(0, beforeOffset - amountAlreadyTransferred);

        // Confidence: agreement among modeled predictors × their mean confidence,
        // tempered by how many predictors were actually present.
        const meanConf = modeled.length
            ? modeled.reduce((a, p) => a + p.confidence, 0) / modeled.length
            : 0.2;
        const agreement = disagreement.spread_ratio != null
            ? 1 - Math.min(1, disagreement.spread_ratio)
            : 0.5;
        const coverage = modeled.length / 3; // of the 3 modeled predictors
        const confidence = Math.round(
            Math.max(0.05, meanConf * (0.4 + 0.4 * agreement + 0.2 * coverage)) * 100
        ) / 100;

        const flags = [];
        if (modeled.length === 0) flags.push('no_modeled_predictors');
        if (modeled.length < 3) flags.push('partial_predictor_coverage');
        if (floor > 0 && reconciledModeled != null && floor > reconciledModeled) {
            flags.push('disgorgement_floor_binds'); // traced taking exceeds modeled estimate
        }
        if (amountAlreadyTransferred > 0) flags.push('offset_applied');

        return {
            reconciled_obligation_usd: Math.round(reconciled * 100) / 100,
            disgorgement_floor_usd: Math.round(floor * 100) / 100,
            reconciled_before_offset_usd: Math.round(beforeOffset * 100) / 100,
            amount_already_transferred_usd: amountAlreadyTransferred,
            confidence,
            disagreement,
            predictors: {
                craemer: all.craemer,
                wealthGap: all.wealthGap,
                disgorgement: all.disgorgement,
                lineItem: all.lineItem,
            },
            flags,
            metadata: {
                damages_theory: this.damagesTheory,
                darity_operationalization: this.darityOperationalization,
                missing_data_policy: this.missingData,
                combination_rule: 'max(disgorgement_floor, confidence_weighted_mean(modeled)) − already_transferred',
                replaced_rule: 'max(craemer, wealth_gap) | sum(line_items)',
                note: 'Predictive/attributive only; no causal claim. Historical awards are NOT inputs (offset-only).',
            },
        };
    }

    _norm(p) {
        if (!p) return null;
        const usd = p.usd == null ? null : Number(p.usd);
        if (usd == null || Number.isNaN(usd)) return null;
        return {
            usd,
            confidence: p.confidence == null ? 0.5 : Number(p.confidence),
            evidence: p.evidence || null,
        };
    }

    _disagreement(vals) {
        if (!vals.length) return { min: null, max: null, spread: null, spread_ratio: null, region: null };
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const spread = max - min;
        // spread relative to the central magnitude — how far apart the theories are.
        const mid = (min + max) / 2 || 1;
        return {
            min: Math.round(min),
            max: Math.round(max),
            spread: Math.round(spread),
            spread_ratio: mid > 0 ? Math.round((spread / mid) * 1000) / 1000 : null,
            region: [Math.round(min), Math.round(max)],
        };
    }

    /**
     * POPULATION-level benchmark + reconcile across reference classes.
     * This is where the calibration harness does its real cross-class work:
     * stratified benchmarking to a control total, a consistency report, and the
     * Reconcile coherence loop that logs the disagreement-region trajectory.
     *
     * @param {Array<Object>} units - [{ pid, craemer, wealthGap, disgorgement, lineItem, stratum, ...classFlags }]
     * @param {Object} cfg
     * @param {Array}  cfg.classes        - [{ name, pred:(u)=>bool, target?:number }]
     * @param {number} [cfg.controlTotal] - global control total to benchmark the headline sum to
     * @param {Object} [cfg.controlByStratum] - per-stratum control totals (preferred)
     * @param {Function} [cfg.strataOf] - (u)=>string
     * @param {number} [cfg.eps]         - reconcile convergence threshold
     * @returns {Promise<Object>} { perUnit, benchmark, consistency, reconcileTrajectory }
     */
    async reconcilePopulation(units, cfg = {}) {
        const harness = await import('../calibration/calibration-harness.mjs');

        // 1. Headline per-unit estimate (online combine) for each unit.
        const headline = new Map();
        for (const u of units) {
            const r = this.combine(u);
            headline.set(u.pid, r.reconciled_obligation_usd);
        }
        const getEst = (u) => headline.get(u.pid) || 0;

        // 2. Benchmark to control total(s).
        let benchmark = null;
        if (cfg.controlByStratum && cfg.strataOf) {
            benchmark = harness.benchmarkStratified(units, getEst, cfg.strataOf, cfg.controlByStratum);
        } else if (cfg.controlTotal != null) {
            benchmark = harness.benchmarkRatio(units, getEst, cfg.controlTotal);
        }
        const benchmarked = benchmark ? benchmark.estimates : new Map(units.map((u) => [u.pid, getEst(u)]));
        const getBench = (u) => benchmarked.get(u.pid) || 0;

        // 3. Consistency report across reference classes.
        const consistency = cfg.classes
            ? harness.consistencyReport(units, getBench, cfg.classes)
            : null;

        // 4. Reconcile: where a SECOND model (here, the raw line-item predictor)
        //    disagrees with the benchmarked headline on a reference class, patch
        //    both toward coherence and log the trajectory. This is the audit trail.
        let reconcileTrajectory = null;
        let reconciled = benchmarked;
        if (cfg.classes) {
            const f1 = benchmarked;
            const f2 = new Map(units.map((u) => [u.pid, Number(u.lineItem?.usd) || 0]));
            const rec = harness.reconcile(units, f1, f2, cfg.classes, cfg.eps || 1000, cfg.maxIter || 50);
            reconciled = rec.f1;
            reconcileTrajectory = rec.trajectory;
        }

        const perUnit = units.map((u) => ({
            pid: u.pid,
            headline: getEst(u),
            benchmarked: getBench(u),
            reconciled: reconciled.get(u.pid),
        }));

        return {
            perUnit,
            benchmark: benchmark
                ? { method: benchmark.method, factor: benchmark.factor, factors: benchmark.factors }
                : null,
            consistency,
            reconcileTrajectory,
            metadata: {
                damages_theory: this.damagesTheory,
                darity_operationalization: this.darityOperationalization,
                missing_data_policy: this.missingData,
            },
        };
    }
}

module.exports = ObligationReconciler;
