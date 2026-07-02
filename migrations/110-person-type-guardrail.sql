-- 110-person-type-guardrail.sql
-- #96 P1 (decision 5): soft guardrail on person_type.
--
-- person_type is a free-text VARCHAR with NO constraint, so ANY string can be written — typos,
-- non-role values ('year'/'age'), or place-words. This constrains BOTH person tables to the known
-- role vocabulary: the union of both tables' in-use values + the code's de-facto enum (promotion
-- paths, matcher) + the forward #96 dual-status values. It BLOCKS new junk VALUES; it does NOT touch
-- names (the #99 junk was person_type='enslaver' with a junk NAME — a different guard, flag-junk-*).
--
-- Keep in sync with src/services/person-roles.js. Adding a legitimate new role = ALTER this
-- constraint AND update person-roles.js. NULL is allowed (CHECK passes on NULL); no rows are NULL today.
--
-- Applied with ADD ... NOT VALID (no full-table scan; only a brief lock — safe while the NY scraper
-- writes unconfirmed_persons) then VALIDATE CONSTRAINT (weaker lock; existing rows all pass because
-- the allowlist is a superset of every value currently stored). See scripts/apply-migration-110.mjs.

ALTER TABLE canonical_persons ADD CONSTRAINT chk_canonical_person_type CHECK (
  person_type IN (
    'enslaver','enslaved','freedperson','descendant','unknown','merged','modern_person','participant',
    'slaveholder','owner','slave_owner','suspected_owner','confirmed_owner','free_poc_slaveholder',
    'formerly_enslaved_slaveholder','suspected_enslaved','confirmed_enslaved','enslaved_ancestor',
    'free_black','free_person_of_color','free_poc','depositor','slaveholder_descendant','civilian',
    'census_person','enslaved_person','enslaved_individual'
  ) OR person_type IS NULL
) NOT VALID;

ALTER TABLE unconfirmed_persons ADD CONSTRAINT chk_unconfirmed_person_type CHECK (
  person_type IN (
    'enslaver','enslaved','freedperson','descendant','unknown','merged','modern_person','participant',
    'slaveholder','owner','slave_owner','suspected_owner','confirmed_owner','free_poc_slaveholder',
    'formerly_enslaved_slaveholder','suspected_enslaved','confirmed_enslaved','enslaved_ancestor',
    'free_black','free_person_of_color','free_poc','depositor','slaveholder_descendant','civilian',
    'census_person','enslaved_person','enslaved_individual'
  ) OR person_type IS NULL
) NOT VALID;

ALTER TABLE canonical_persons VALIDATE CONSTRAINT chk_canonical_person_type;
ALTER TABLE unconfirmed_persons VALIDATE CONSTRAINT chk_unconfirmed_person_type;
