-- Migration 093: Disgorgement component + reconciliation fields on the
--                enslaver_lineage_ledger (extends the LIVE M040 schema).
--
-- CONTEXT (verified against the live DB, Jun 2026):
--   The live `enslaver_lineage_ledger` is EXACTLY the migration-040 schema:
--     enslaver_person_id, total_obligation_usd, craemer_component_usd,
--     wealth_gap_component_usd, UNIQUE (enslaver_person_id).
--   There is NO later migration. DAAOrchestrator.upsertLineageLedger had been
--   writing a DIFFERENT, non-existent column set (enslaver_canonical_id,
--   craemer_2015_total_usd, wealth_gap_share_usd, combined_obligation_usd,
--   generation_from_enslaver) with ON CONFLICT on columns that don't exist —
--   so every ledger write silently failed inside its try/catch and the table
--   has 0 rows. That writer is being corrected to the real M040 columns in the
--   same change as this migration.
--
-- WHAT THIS ADDS:
--   The obligation is moving from a max(Craemer, wealth-gap) / sum-of-line-items
--   rule to a calibrated-and-reconciled combination of FOUR predictors. M040
--   already stores two of them (craemer_component_usd, wealth_gap_component_usd).
--   This migration adds the other two predictors plus the reconciled output:
--
--     disgorgement_component_usd  — traced non-chattel enrichment summed per
--                                   lineage from land_transfer_events (038),
--                                   flagrant_heirloom_assets (038), and
--                                   wealth_transfer_events (088). This is the
--                                   third predictor the brief calls for; it
--                                   currently gates DAA generation but was never
--                                   summed into the obligation.
--     line_item_component_usd     — the reparations_line_items sum attributable
--                                   to this lineage's documented enslaved (the
--                                   itemized methodology), carried as a predictor
--                                   rather than as the whole answer.
--     reconciled_obligation_usd   — the post-benchmark, post-reconcile combined
--                                   figure (ObligationReconciler output). This
--                                   becomes the headline obligation; the legacy
--                                   total_obligation_usd is retained for back-compat
--                                   and set equal to it by the writer.
--     obligation_confidence       — 0..1, low when the figure leans on imputed /
--                                   unattributed components (e.g. disgorgement
--                                   sources are near-empty today).
--     reconciliation_metadata     — JSONB: per-predictor values, benchmark factor,
--                                   reconcile() trajectory, imputation flags. This
--                                   is the disagreement-region audit trail.
--
-- Additive and idempotent. No row inserts.

ALTER TABLE enslaver_lineage_ledger
    ADD COLUMN IF NOT EXISTS disgorgement_component_usd  DECIMAL(14,2),
    ADD COLUMN IF NOT EXISTS line_item_component_usd     DECIMAL(14,2),
    ADD COLUMN IF NOT EXISTS reconciled_obligation_usd   DECIMAL(14,2),
    ADD COLUMN IF NOT EXISTS obligation_confidence       DECIMAL(3,2),
    ADD COLUMN IF NOT EXISTS reconciliation_metadata     JSONB;

COMMENT ON COLUMN enslaver_lineage_ledger.disgorgement_component_usd IS
  'Traced non-chattel enrichment for this enslaver lineage: SUM of '
  'land_transfer_events.consideration_usd (implicates_enslaver) + '
  'flagrant_heirloom_assets.appraised_value_usd (implicates_enslaver) + '
  'wealth_transfer_events.non_chattel_assets_value_usd (when linked). One of the '
  'four predictors combined by ObligationReconciler. Near-zero for most lineages '
  'today because these tables are sparse and wealth_transfer_events has no '
  'resolved canonical linkage yet — that sparsity is carried as low '
  'obligation_confidence, NOT silently imputed up.';

COMMENT ON COLUMN enslaver_lineage_ledger.line_item_component_usd IS
  'Sum of reparations_line_items.compounded_amount_usd attributable to this '
  'lineage (itemized methodology), carried as ONE predictor — not the whole '
  'answer. Distinct from craemer_component_usd (labor-value) and '
  'wealth_gap_component_usd (SCF share-of-gap).';

COMMENT ON COLUMN enslaver_lineage_ledger.reconciled_obligation_usd IS
  'Post-benchmark, post-reconcile combined obligation across the four predictors '
  '(ObligationReconciler). The headline figure. total_obligation_usd is kept in '
  'sync for back-compat.';

COMMENT ON COLUMN enslaver_lineage_ledger.reconciliation_metadata IS
  'JSONB audit trail: {predictors:{craemer,wealth_gap,disgorgement,line_item}, '
  'benchmark:{target,factor}, reconcile_trajectory:[...], imputation_flags:[...], '
  'damages_theory, darity_operationalization}. Makes the values choices and the '
  'disagreement region explicit and inspectable, per the build directive.';
