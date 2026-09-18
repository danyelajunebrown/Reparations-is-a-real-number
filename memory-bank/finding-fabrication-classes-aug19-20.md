# Finding — the fabrication classes, and the shape they all share

_2026-08-19→20. Referenced by [[activeContext]] and [[standard-assertion-store-and-inference-decisions]]._
Related: [[standard-targeted-harvesting]] · [[interpretive-framework]] · [[finding-marronnage-corpus-aug20]]

## The two big ones

**1,456,640 fabricated person rows — one per TALLY MARK.**
An 1860 slave schedule enumerates most enslaved people as unnamed marks: a row of age/sex/colour with no
name. `extract-census-ocr.js` minted one `unconfirmed_persons` row per mark, producing
`"Unknown (Female, age 4)"` at a scale of 1.46 million. That is a direct violation of audit rule 5 (*no
fabricated data — no "Unnamed enslaved person(s)" placeholder rows. Real or absent*).

Quarantined as `status='placeholder_aggregate'` (1,455,019 + 1,621 in a second pass), and
`extract-census-ocr.js` now quarantines **at creation** — the fix has to be at the source or the next run
re-fabricates them.

**Why it is not simply "delete":** the tally marks are *evidence of a count*, and the count is real and
belongs to the enslaver. The person is not fabricated by the enumerator; the person is **unnamed**. What was
fabricated is our assertion that a database row corresponds to an identified individual. So the marks stay,
flagged, aggregate-only — countable for the ledger, never assertable as a person.

**7,053 probate decedents typed `enslaver` on provenance alone.**
Appearing in a probate record is not evidence of enslaving. Reclassified to `unknown`; 279 with actual
evidence kept. The widening of the evidence test at estate level, then loosening the name match, took the
keeps from 48 → 279 — i.e. most of the "evidence" was there but unreachable by an exact-string join.

## The shape they share

Every serious defect of these days was **an implicit inference no human ever approved, running at scale**:

| implicit inference | cost |
|---|---|
| a probate decedent is an enslaver | 7,053 canonicals fabricated |
| a tally mark is a person | 1,456,640 rows fabricated |
| found via a family tree ⇒ possibly alive | 12,562 historical ancestors hidden from search |
| no attached scan ⇒ not assertable | 243,209 enslaved unfindable |
| `y` is not a vowel | every "Mary" silently deleted |

None was chosen. Each was **a default that became policy**.

## The guardrail that looked like a bug

The enslaved were "failing to promote". Measured: for `person_type='enslaved'`, **248,958 leads have an
external id and no image; 105,230 have an image and no external id; 0 have both** — and the promoter
requires both. The two sets are DISJOINT, so that promoter can never promote an enslaved person however
often it runs.

The instinct is to relax the join. **Do not.** Of the 105,230 image-backed leads, **103,363 were the
fabricated tally-mark placeholders** — relaxing the gate would have pushed a hundred thousand invented
people into `canonical_persons` *looking like progress*. What remained after quarantine was the real
minority: 4,540 people an enumerator actually named (July, Henry, Jack, Sam, Daniel, Charles), promoted
with deterministic `sched:<doc_id>:<name>` identifiers.

**A gate that blocks everything is sometimes correct. Ask what it is holding back before you widen it.**

## Corollary rules

1. **No ingest may assign `person_type`, a harm type, or a status by provenance.** Evidence only.
2. **A false reject is the expensive direction** — junk is visible and deletable; a rejected row never
   exists, so nothing surfaces it. (Cf. the mint-gate validator that deleted every `Mary`.)
3. **A status written without its link is not a status** — `promoteToCanonical` marks a lead `promoted`
   without writing `confirmed_individual_id`, leaving 68,320 leads pointing at nothing and 9,601 canonicals
   unreachable from both directions.
4. **Quarantine, never delete.** `placeholder_aggregate` keeps the count while withdrawing the claim.
