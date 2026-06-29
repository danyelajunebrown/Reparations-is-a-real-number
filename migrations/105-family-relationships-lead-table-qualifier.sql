-- Migration 105: lead_table qualifier on family_relationships (de-siloing #1 remainder)
-- Plan: memory-bank/plan-de-siloing-fixes.md (#1). family_relationships (2.0M rows) carries
-- person1_lead_id / person2_lead_id (bare integers, NO FK) that point at unconfirmed_persons BY
-- CONVENTION. To let this table reference ANY lead source (slavevoyages_past_people /
-- hall_slave_records / future) the way the M103 edge tables now can, add a lead_table qualifier
-- per side. Lighter than the full M103 polymorphic retrofit (this is a 2M-row name+lead table the
-- DAA reads by NAME, so we add a qualifier rather than rewrite).
--
-- Both lead_id columns reference unconfirmed_persons today, so DEFAULT 'unconfirmed_persons' is
-- correct for existing rows; the qualifier is only meaningful where the matching lead_id is non-null
-- (readers gate on lead_id first). Adding a TEXT column with a constant default is metadata-only in
-- PG11+ (instant, no table rewrite). NOT NULL is intentionally NOT set (a row may have no lead).

ALTER TABLE family_relationships
  ADD COLUMN IF NOT EXISTS person1_lead_table TEXT DEFAULT 'unconfirmed_persons',
  ADD COLUMN IF NOT EXISTS person2_lead_table TEXT DEFAULT 'unconfirmed_persons';

COMMENT ON COLUMN family_relationships.person1_lead_table IS
  'Which lead table person1_lead_id points at (M105). Default unconfirmed_persons; set to slavevoyages_past_people / hall_slave_records / etc. when a future producer writes a non-unconfirmed lead. Meaningful only when person1_lead_id IS NOT NULL.';
COMMENT ON COLUMN family_relationships.person2_lead_table IS
  'Which lead table person2_lead_id points at (M105). Default unconfirmed_persons. Meaningful only when person2_lead_id IS NOT NULL.';
