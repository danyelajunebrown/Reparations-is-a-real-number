# PLAN — Harm accounting (ground the damages head) + a methodology-learning agent

_2026-08-09. Correction after re-reading the memory bank + `src/services/reparations/Calculator.js` (RULE 0):
the formula ALREADY breaks harm into heads; the gap is that the harm head is an unsourced flat constant, and
the categories must be LEARNED from primary sources — especially the Freedmen's Bureau letters._

## What the formula already has (and its flaw)
`Calculator.js` heads: **wage_theft**, **damages** ("human rights violations" = `humanDignityValue $15,000 ×
dignityMultiplier 1.5`, per person·year), **profit_share**, **compound_interest**, delayed-justice **penalty**.
BUT `Calculator.js` is flagged RESEARCH-IN-PROGRESS / not canonical (Craemer 2015 in `DAAGenerator.js` is);
the `damages` constants are **unsourced** (Issues #9/#12/#17/#18). It multiplies a made-up dignity number by
everyone equally — blind to whether THIS person was assaulted, had children sold, was falsely imprisoned.

## The fix: harm_events GROUNDS the damages head (mig 136)
`harm_events` (migration 136) is the EVIDENCE layer for the damages head: documented, categorized, per-person,
cited heads of harm (assault, family_separation_by_sale, child_apprenticeship, wrongful_death, wage/property
theft, false_imprisonment, …), tied to victim + perpetrator + source citation, narrative kept VERBATIM.
Audit-safe: `penalty_usd`/`penalty_methodology` stay NULL until a CITED valuation framework is attached — the
harm is stored + categorized + reparations-relevant, but never fabricated into a number. This is the audit's
own direction: replace unsourced constants with sourced primary-source evidence. `harm_type` maps to a
formula damage-head so the itemized harms can eventually REPLACE the flat `dignityMultiplier`.

## The categories must be LEARNED from the sources (not handed down)
The harm taxonomy emerges from what the letters actually document + a CITED damages framework (e.g. Darity &
Mullen *From Here to Equality*; tort/wrongful-death schedules) — not an a-priori list. The Amelia letters
already surfaced categories I wouldn't have prioritized: child "apprenticeship" as re-enslavement,
denial-of-kin-reunion (Daniel Shepherd), estate-proceeds withheld by court-appointed whites, racially-selective
road-duty extraction, assault-causing-miscarriage. The taxonomy is data-driven and versioned.

## The learning agent (user directive — "an agent dedicated to learning")
A FREE (RULE 0.7: deterministic + free/local LLM), recurring agent that:
1. READS primary sources (Freedmen's letters, wills, petitions, WPA narratives) — like a historian, not a scraper.
2. DISCOVERS/refines the `harm_events` taxonomy from what the documents actually reveal (proposes new categories
   with example citations; never invents).
3. MAPS each documented harm → the formula's damage head, and to a CITED valuation framework where one exists.
4. FLAGS methodology GAPS: harm categories the canonical formula does NOT yet value (needing a cited source) →
   feeds the methodology audit (Issues #2-#25). It surfaces what's missing; it NEVER fabricates a constant.
5. Writes back to `memory-bank/` (the taxonomy + gaps), so the methodology learns over time.
NOT built yet — scoped here. It is the "quality-control-to-inception" principle applied to the METHODOLOGY,
not just the person spine.
