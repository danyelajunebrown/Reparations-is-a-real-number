#!/usr/bin/env node
'use strict';

/**
 * reconcile-lineage-obligations.js
 *
 * Batch driver for the per-lineage obligation: computes the four predictors for
 * every EVIDENCED enslaver lineage (set-based, not per-row), reconciles them with
 * ObligationReconciler, and upserts enslaver_lineage_ledger.
 *
 * SCOPE = evidenced lineages only (preserves the probate gate "no obligation
 * without observed documentary evidence"): an enslaver is in scope iff it has
 * documented dated enslaved persons (→ Craemer) OR traced disgorgement. The
 * wealth-gap predictor alone (base-share × descendant fan-out) NEVER manufactures
 * an obligation for an evidence-free enslaver.
 *
 * BENCHMARKING is OFF by default. Forcing the documented subset's SUM up to a
 * national control total ($36T Brattle / $14T Darity) is the known coverage/
 * denominator inflation bug (documented subset ≠ full enslaved population). We
 * compute and REPORT the consistency diagnostic (per-capita vs Darity band) but
 * only APPLY a benchmark when --benchmark=<controlTotal> is explicitly given.
 *
 * USAGE:
 *   node scripts/reconcile-lineage-obligations.js                 # dry-run, full scope
 *   node scripts/reconcile-lineage-obligations.js --limit 500     # dry-run, sample
 *   node scripts/reconcile-lineage-obligations.js --apply         # write the ledger
 *   node scripts/reconcile-lineage-obligations.js --apply --benchmark 36e12
 */

require('dotenv').config();
const { Pool } = require('pg');
const MACRO = require('../src/services/reparations/macro-config');
const ObligationReconciler = require('../src/services/reparations/ObligationReconciler');

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : null;
const benchArg = process.argv.indexOf('--benchmark');
const BENCHMARK = benchArg > -1 ? Number(process.argv[benchArg + 1]) : null;

const CURRENT_YEAR = 2026; // pinned (no Date.now) — matches DAAGenerator horizon discussion
const DEFAULT_GENERATIONS = 6; // fan-out fallback when no heir data (documented proxy)

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const reconciler = new ObligationReconciler();

async function main() {
    console.log('═══ Lineage Obligation Reconcile ═══');
    console.log(`mode: ${APPLY ? 'APPLY (writes ledger)' : 'DRY-RUN (no writes)'}${LIMIT ? `  limit=${LIMIT}` : ''}${BENCHMARK ? `  benchmark=${BENCHMARK}` : ''}`);

    // ── Predictor 1: Craemer, set-based, grouped by enslaver name ──
    // PV per enslaved person = (BASE_DAILY_WAGE × WORKING_DAYS × years) × (1+r)^(present-freedom_year)
    // matching DAAGenerator.calculatePreview (unweighted modernValue).
    const craemerRate = MACRO.RATES.craemerCompound.value;
    console.log('\n[1/4] Craemer (set-based over documented dated enslaved)…');
    const craemerByName = await pool.query(`
        SELECT LOWER(fr.person1_name) AS nm,
               SUM( (0.80 * 300 * GREATEST(1, epi.inferred_freedom_year - epi.inferred_birth_year))
                    * power(1 + $1::numeric, ($2::int - epi.inferred_freedom_year)) ) AS craemer_usd,
               COUNT(*) AS enslaved_n
        FROM family_relationships fr
        JOIN enslaved_persons_inferred_dates epi ON epi.relationship_id = fr.id
        WHERE fr.relationship_type = 'enslaved_by'
          AND epi.inferred_birth_year IS NOT NULL
          AND epi.inferred_freedom_year IS NOT NULL
          AND epi.inferred_freedom_year > epi.inferred_birth_year
        GROUP BY LOWER(fr.person1_name)
    `, [craemerRate, CURRENT_YEAR]);
    const craemerMap = new Map(); // lower-name -> {usd, n}
    for (const r of craemerByName.rows) craemerMap.set(r.nm, { usd: Number(r.craemer_usd) || 0, n: Number(r.enslaved_n) });
    console.log(`      ${craemerMap.size} enslaver names with documented Craemer value`);

    // ── Predictor 3: disgorgement, set-based, clean by enslaver_person_id ──
    console.log('[2/4] Disgorgement (set-based, by enslaver_person_id)…');
    const disg = await pool.query(`
        SELECT id, SUM(usd) AS usd FROM (
            SELECT enslaver_person_id AS id, COALESCE(SUM(consideration_usd),0) AS usd
            FROM land_transfer_events WHERE implicates_enslaver = TRUE AND enslaver_person_id IS NOT NULL
            GROUP BY enslaver_person_id
            UNION ALL
            SELECT enslaver_person_id AS id, COALESCE(SUM(appraised_value_usd),0) AS usd
            FROM flagrant_heirloom_assets WHERE implicates_enslaver = TRUE AND enslaver_person_id IS NOT NULL
            GROUP BY enslaver_person_id
        ) s GROUP BY id
    `);
    const disgMap = new Map();
    for (const r of disg.rows) disgMap.set(Number(r.id), Number(r.usd) || 0);
    console.log(`      ${disgMap.size} enslavers with traced disgorgement`);

    // ── Descendants: heir_count where documented, else fan-out fallback ──
    console.log('[3/4] Descendant counts (inheritance heir_count where present)…');
    let heirMap = new Map();
    try {
        const heirs = await pool.query(`SELECT testator_id, heir_count FROM inheritance_summary_by_testator WHERE heir_count > 0`);
        for (const r of heirs.rows) heirMap.set(Number(r.testator_id), Number(r.heir_count));
    } catch (e) { console.log('      (inheritance_summary_by_testator unavailable — fan-out only)'); }
    console.log(`      ${heirMap.size} enslavers with documented heirs`);

    // ── Build evidenced units: enslavers with Craemer (name) or disgorgement (id) ──
    console.log('[4/4] Assembling evidenced lineages…');
    const enslavers = await pool.query(`
        SELECT id, canonical_name FROM canonical_persons WHERE person_type = 'enslaver'
    `);
    const baseShare = MACRO.WEALTH_GAP.estimated_slaveholder_descendants
        ? MACRO.deriveWealthGap().baseSharePerDescendant : 0;

    const units = [];
    let nameAmbiguity = 0;
    const nameSeen = new Map();
    for (const cp of enslavers.rows) {
        const nm = (cp.canonical_name || '').toLowerCase();
        const craemer = craemerMap.get(nm);
        const disgUsd = disgMap.get(cp.id) || 0;
        const hasCraemer = !!(craemer && craemer.usd > 0);
        const hasDisg = disgUsd > 0;
        if (!hasCraemer && !hasDisg) continue; // not evidenced → skip (probate gate)

        // name-ambiguity diagnostic: same name attributed to >1 canonical enslaver
        if (hasCraemer) { nameSeen.set(nm, (nameSeen.get(nm) || 0) + 1); }

        const heirCount = heirMap.get(cp.id);
        const estDescendants = heirCount && heirCount > 0
            ? Math.max(heirCount, Math.round(heirCount * Math.pow(2, DEFAULT_GENERATIONS - 1)))
            : Math.round(Math.pow(2, DEFAULT_GENERATIONS));
        const descMethod = heirCount && heirCount > 0 ? 'inheritance_heir_count' : 'generational_fanout_2_per_gen';
        const wealthGapUsd = baseShare * estDescendants;

        units.push({
            pid: cp.id,
            name: cp.canonical_name,
            craemer: hasCraemer ? { usd: craemer.usd, confidence: 0.7 } : null,
            wealthGap: { usd: wealthGapUsd, confidence: 0.5 },
            disgorgement: { usd: disgUsd, confidence: hasDisg ? 0.85 : 0.2, evidence: hasDisg ? 'traced' : 'none' },
            lineItem: null, // batch omits the heavy per-lineage line-item join
            estDescendants, descMethod,
            enslavedN: craemer ? craemer.n : 0,
        });
        if (LIMIT && units.length >= LIMIT) break;
    }
    for (const [, c] of nameSeen) if (c > 1) nameAmbiguity += c;
    console.log(`      ${units.length} evidenced lineages in scope`);

    // ── Reconcile each ──
    let sumOld = 0, sumNew = 0, floorBinds = 0;
    const percapitas = [];
    for (const u of units) {
        const r = reconciler.combine(u);
        u._result = r;
        const oldMax = Math.max(u.craemer?.usd || 0, u.wealthGap?.usd || 0);
        sumOld += oldMax;
        sumNew += r.reconciled_obligation_usd;
        if (r.flags.includes('disgorgement_floor_binds')) floorBinds++;
        percapitas.push(r.reconciled_obligation_usd / u.estDescendants);
    }

    // ── Optional benchmark to a control total (off by default) ──
    let benchFactor = 1;
    if (BENCHMARK && sumNew > 0) {
        benchFactor = BENCHMARK / sumNew;
        console.log(`\n⚖  Benchmark requested: scaling reconciled sum to ${BENCHMARK.toExponential(2)} → factor ${benchFactor.toFixed(4)}`);
    }

    // ── Report ──
    percapitas.sort((a, b) => a - b);
    const median = percapitas.length ? percapitas[Math.floor(percapitas.length / 2)] : 0;
    console.log('\n─── AGGREGATE ───');
    console.log(`  lineages:                 ${units.length.toLocaleString()}`);
    console.log(`  name-ambiguous lineages:  ${nameAmbiguity.toLocaleString()} (shared-name Craemer attribution — known fuzziness)`);
    console.log(`  disgorgement floor binds: ${floorBinds}`);
    console.log(`  Σ OLD rule max():         $${Math.round(sumOld).toLocaleString()}`);
    console.log(`  Σ NEW reconciled:         $${Math.round(sumNew).toLocaleString()}`);
    console.log(`  Δ (reconcile effect):     $${Math.round(sumNew - sumOld).toLocaleString()} (${sumOld ? ((sumNew/sumOld - 1)*100).toFixed(1) : '0'}%)`);
    console.log(`  median per-descendant:    $${Math.round(median).toLocaleString()}  (Darity band $${MACRO.DARITY.percapita_low.value.toLocaleString()}–$${MACRO.DARITY.percapita_high.value.toLocaleString()})`);
    if (BENCHMARK) console.log(`  Σ after benchmark:        $${Math.round(sumNew * benchFactor).toLocaleString()}`);

    if (!APPLY) {
        console.log('\nDRY-RUN: no rows written. Re-run with --apply to write the ledger.');
        await pool.end();
        return;
    }

    // ── Bulk upsert ──
    console.log('\nWriting ledger (chunked upsert)…');
    let written = 0;
    const CHUNK = 500;
    for (let i = 0; i < units.length; i += CHUNK) {
        const chunk = units.slice(i, i + CHUNK);
        const values = [];
        const params = [];
        let p = 0;
        for (const u of chunk) {
            const r = u._result;
            const reconciled = Math.round(r.reconciled_obligation_usd * benchFactor * 100) / 100;
            const meta = {
                ...r.metadata, predictors: r.predictors, disagreement: r.disagreement, flags: r.flags,
                estimated_living_descendants: u.estDescendants, descendants_estimate_method: u.descMethod,
                benchmark_factor: benchFactor, batch: true,
            };
            values.push(`($${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p}::jsonb,$${++p},NOW(),$${++p},$${++p},NOW(),NOW())`);
            params.push(
                u.pid, u.name, reconciled,
                u.craemer ? u.craemer.usd : null,
                u.wealthGap.usd, u.disgorgement.usd, reconciled, r.confidence,
                JSON.stringify(meta), r.metadata.combination_rule, u.estDescendants, u.descMethod
            );
        }
        await pool.query(`
            INSERT INTO enslaver_lineage_ledger (
                enslaver_person_id, enslaver_canonical_name, total_obligation_usd,
                craemer_component_usd, wealth_gap_component_usd, disgorgement_component_usd,
                reconciled_obligation_usd, obligation_confidence, reconciliation_metadata,
                calculation_methodology_note, calculated_at, estimated_living_descendants,
                descendants_estimate_method, created_at, updated_at
            ) VALUES ${values.join(',')}
            ON CONFLICT (enslaver_person_id) DO UPDATE SET
                total_obligation_usd = EXCLUDED.total_obligation_usd,
                craemer_component_usd = EXCLUDED.craemer_component_usd,
                wealth_gap_component_usd = EXCLUDED.wealth_gap_component_usd,
                disgorgement_component_usd = EXCLUDED.disgorgement_component_usd,
                reconciled_obligation_usd = EXCLUDED.reconciled_obligation_usd,
                obligation_confidence = EXCLUDED.obligation_confidence,
                reconciliation_metadata = EXCLUDED.reconciliation_metadata,
                calculation_methodology_note = EXCLUDED.calculation_methodology_note,
                calculated_at = NOW(),
                estimated_living_descendants = EXCLUDED.estimated_living_descendants,
                descendants_estimate_method = EXCLUDED.descendants_estimate_method,
                updated_at = NOW()
        `, params);
        written += chunk.length;
        if (written % 5000 === 0 || written === units.length) console.log(`  …${written}/${units.length}`);
    }
    console.log(`✓ wrote ${written} ledger rows`);
    await pool.end();
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
