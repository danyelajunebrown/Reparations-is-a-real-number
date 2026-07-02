-- 111-person-role-group-fn.sql
-- #96 P3: person_role_group() — SQL mirror of src/services/person-roles.js roleGroup().
--
-- person_type is a lossy free-text summary; consumers historically re-hardcoded their own
-- `IN ('enslaver', ...)` lists and drifted (e.g. the DAA and the debit ledger both scoped to bare
-- 'enslaver', silently dropping free_poc_slaveholder / slaveholder / owner). This function is the ONE
-- SQL-side source of truth for "what role group is this person_type" so those consumers stop drifting.
-- IMMUTABLE so it can be used in indexes/WHERE without perf penalty. KEEP IN SYNC with person-roles.js.
CREATE OR REPLACE FUNCTION person_role_group(pt TEXT) RETURNS TEXT AS $$
  SELECT CASE
    WHEN pt IN ('enslaver','slaveholder','owner','slave_owner','free_poc_slaveholder',
                'suspected_owner','confirmed_owner') THEN 'owner'
    WHEN pt IN ('enslaved','freedperson','suspected_enslaved','confirmed_enslaved','enslaved_ancestor',
                'free_black','free_person_of_color','free_poc','depositor') THEN 'enslaved'
    WHEN pt IN ('descendant','modern_person','participant') THEN 'descendant'
    WHEN pt = 'merged' THEN 'merged'
    ELSE 'unknown'
  END
$$ LANGUAGE sql IMMUTABLE;
