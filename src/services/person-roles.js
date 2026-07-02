/**
 * person-roles.js — shared person_type ROLE GROUPS (#96 P0).
 *
 * `person_type` is a lossy, free-text summary label (no DB enum). Historically every consumer
 * re-hardcoded its own `IN ('enslaver', ...)` list, and they drifted — e.g. `DAAOrchestrator`'s
 * owner universe was `('enslaver','descendant')`, silently excluding the owner-side synonyms
 * (`slaveholder`/`owner`/`slave_owner`) and, critically, `free_poc_slaveholder` (a free person of
 * color who owned people — William Ellison). That dropped dual-status owners from obligations.
 *
 * Ask "is this an owner-side / enslaved-side person" via these groups, never a fresh literal list.
 * A dual-status person (enslaved AND enslaver) is OWNER-side HERE, because this governs the DEBIT
 * universe (what they OWE). Their reparations CREDIT (what they are OWED, as formerly enslaved) is
 * a SEPARATE directed obligation on the `reparations_line_items` beneficiary side and must never be
 * netted against the debit — see memory-bank/plan-96-person-status-model.md, decision 3.
 *
 * P3 (#96) will add a Postgres `person_role_group()` mirror of `roleGroup()` and route the
 * remaining hardcoded consumers + the two stored SQL matcher functions through this single source.
 */
const OWNER_ROLE_TYPES = [
  'enslaver', 'slaveholder', 'owner', 'slave_owner', 'free_poc_slaveholder',
  'suspected_owner', 'confirmed_owner',
];
const ENSLAVED_ROLE_TYPES = [
  'enslaved', 'freedperson', 'suspected_enslaved', 'confirmed_enslaved', 'enslaved_ancestor',
  'free_black', 'free_person_of_color', 'free_poc', 'depositor',
];
const DESCENDANT_ROLE_TYPES = ['descendant', 'modern_person', 'participant'];

/** Coarse role group of a person_type summary. 'merged' is a tombstone, not a role. */
function roleGroup(personType) {
  if (OWNER_ROLE_TYPES.includes(personType)) return 'owner';
  if (ENSLAVED_ROLE_TYPES.includes(personType)) return 'enslaved';
  if (DESCENDANT_ROLE_TYPES.includes(personType)) return 'descendant';
  if (personType === 'merged') return 'merged';
  return 'unknown';
}
const isOwnerType = (pt) => OWNER_ROLE_TYPES.includes(pt);
const isEnslavedType = (pt) => ENSLAVED_ROLE_TYPES.includes(pt);

module.exports = {
  OWNER_ROLE_TYPES, ENSLAVED_ROLE_TYPES, DESCENDANT_ROLE_TYPES,
  roleGroup, isOwnerType, isEnslavedType,
};
