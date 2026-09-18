# PLAN — Phase B: enslaved-side entity resolution (gold-gated)

_2026-08-09. Scoped AFTER the precise siloing audit proved that name+birth-year is insufficient for the
enslaved corpus (it false-merged 143 distinct "Jean Louis" and the 3 distinct Ann Biscoes), and AFTER the
operator supplied gold resources. Per the standing instruction: **do not build without verifiably enough
resources.** This plan records what we have, what it's enough FOR, and what still needs a gold set._

## Why Phase B (the unbuilt half of the Biscoe rule)
1.6M enslaved `unconfirmed_persons` are first-name-only ("Boy, 12"; "Jean Louis"; "Marie Joseph"), and the
same person is scattered across sources (1860 slave schedule ↔ probate inventory ↔ Freedmen's Bank ↔ DC
emancipation ↔ census) with no cross-link. Name is not an identity here — only **owner + location + age**
(chattel side) and **parentage + documented life-events across records** (emancipation side) resolve people.

## Gold resources supplied (2026-08-09) + VERIFIED overlap
- **Toulmin (2021), "Eleven-Generation … Descent from Sally Hemings' Grandparents"** — a source-cited,
  parentage-explicit lineage: Betty Hemings → Melinda Colbert/Freeman → Martha Freeman → **Lt. John Freeman
  Shorter & Sgt. Charles Henry Shorter (USCT)** → present-day DC descendants. Each person is traced across the
  EXACT sources we ingest (Freedman's Bank, DC census, civilwardc emancipation, USCT/pension).
- **Getting Word (Monticello)** — approved; the descendant database the report builds on.
- **"The Hairstons: An American Family in Black and White"** (Wiencek) — a large slaveholding family + enslaved
  community traced black+white across VA/NC/MS into the emancipation era.
- **Google Books id 9-eLdIhYChMC** — supplied; not yet identified (API returned nothing) — TO IDENTIFY.
- **✅ OVERLAP CONFIRMED:** Charles H. Shorter from the gold lineage is in OUR data **twice** — `freedmens`
  lead 2395963 ("Charles H Shorter", FS ARK) AND `civilwardc` lead 104736 — the same man per the report. So we
  have a known person whose cross-source instances in our own DB the resolver can be validated against (and must
  keep distinct from Jacob / Chloe Ann / Charles Edwin Shorter).

## Scope decision (honest sufficiency)
- **B1 — emancipation-era cross-source resolution (freedmens ↔ civilwardc ↔ census ↔ USCT): VERIFIABLY ENOUGH.**
  The Toulmin/Shorter gold + confirmed overlap validate it. This is the highest-value slice — it de-silos the
  416K freedmens by linking them to census/civilwardc identities + parentage. **Build this first.**
- **B2 — pure-chattel resolution (1860 slave schedule ↔ probate inventory, first-name-only + owner-anchored):
  NOT yet enough.** The gold lineage's enslaved generations (Betty Hemings) sit in the Monticello Farm Book,
  which we don't ingest. B2 needs a **schedule+probate overlap gold** — either from the Hairstons community or
  hand-resolved from one owner in OUR data (an owner with enslaved in BOTH our schedule and probate). Gather
  before building B2.

## Method (reuse + extend — don't re-derive)
- Reuse the owner-side machinery: `person_blocking_keys` (mig 091), the Fellegi-Sunter scorer in
  `resolve-canonical-dedup.mjs`, `research/entity-resolution-methodology.md` (Splink/Jaro-Winkler).
- **Extend with:** owner-anchored blocking (`unconfirmed_persons.relationships` JSONB {age,year,owner,state,
  county}); **census mutual-exclusion** (Biscoe rule 2 — same schedule ⇒ different people, hard non-merge);
  parentage + life-event-chain scoring (Toulmin/GPS: same occupation/residence across records ↑ match odds);
  the owner string resolves to a canonical enslaver (link to Phase A).
- Ground methodology in Toulmin + Getting Word + Beyond Kin + Enslaved.org (dump already downloaded).

## Validation gold (encode before building)
Extract the Toulmin lineage into a `gold_person_links` set: each person → their known source appearances +
parentage. Acceptance: the resolver must (a) link Charles H. Shorter's freedmens + civilwardc (+ census)
instances into ONE person, (b) attach him to father John Shorter, (c) keep him distinct from the other
Shorters, (d) not merge the census-co-resident household members. `--validate` must pass this before any
`--all` run — exactly how the Biscoe gold gated the owner-side resolver.

## Immediate next steps
1. (no new resources needed) Run the self-serve audits: cross-source OVERLAP (owners with enslaved in ≥2 of our
   sources), `relationships` JSONB signal completeness, Phase-A owner-linkage coverage.
2. Encode the Toulmin/Shorter gold → `gold_person_links`.
3. Build **B1** (emancipation-era resolver) validated against that gold.
4. For **B2**: adopt a Hairstons or hand-built schedule+probate gold, THEN build.
