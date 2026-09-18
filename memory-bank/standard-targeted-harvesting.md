# Standard — targeted harvesting: the goal pulls, the source does not push

_Adopted 2026-08-11 (operator directive: "instead of trying to blindly ingest the entire world's probate
records for a 400 year period we could be doing so systematically ever mindful of our progress towards the
larger goal.")_

Related: [[finding-duplication-interoperability-retrievability-aug10]] · [[standard-external-source-ingest]] ·
[[plan-descent-first-lineage]] · [[standard-canonical-person-and-document-gate]]

## 1 · The measurement that forced this

The probate ingest, measured end-to-end on 2026-08-11:

| | |
|---|---|
| pages harvested | 111,331 |
| estates extracted | 7,444 |
| **estates naming enslaved people** | **249 (3.3%)** |
| enslaved people named | 1,624 |
| **reparations debits analysed** | **0** |
| **genealogies traced from those canonicals** | **0** (descent_frontier: 1,882 pending, 0 attempts ever) |
| chunked into RAG | ~17% |

Yield is **not** uniform, and the naive assumption about which counties would pay was wrong in both
directions:

| county | estates | with enslaved | people named |
|---|---|---|---|
| Liberty, GA | 1,517 | 149 | **1,373** |
| **Albany, NY** | 3,975 | **98** | **247** |
| Allegany, NY | 849 | 2 | 11 |
| **Cayuga, NY** | 1,054 | **0** | **0** |

**Albany NY is the second-richest county in the corpus.** New York held people until 1827 and Albany's Dutch
slaveholding is real and under-documented; an argument from the abolition date said "north = no yield" and
the data refuted it. The waste was **Cayuga and Allegany — 1,903 estates for 11 people.** Correct the target,
not the direction.

## 2 · The worse cost: harvesting *contaminated* the class

`new-york-probate-scraper` typed every decedent it minted as `person_type='enslaver'`
("Auto-created by new-york-probate-scraper. Type: enslaver."). That produced **7,332 canonicals classified
as slaveholders because they died owning something.** Of them, 0 had a verified relationship and 2 appeared
in any chattel transfer. Names in the set: `Peter Creighton Filed April`, `Hezehiah Gridley Deceased`.

**Provenance is not evidence.** Being found in a probate roll makes a person a DECEDENT — the person who
died and whose estate is being settled. It says nothing about whether they held anyone. This is audit rule 5
(no fabricated data) violated by a *default value*, inside the exact class the reparations ledger keys on,
the descent engine anchors from, and a DAA names.

Reclassified 2026-08-11: **7,053 → `person_type='unknown'`**, prior type preserved in `notes` (reversible).
279 kept because evidence of holding exists.

**And the inverse defect, which is worse:** of 243 distinct decedents whose estates DO name enslaved people
— Moses S. Jones (85 people, 1855), Anne Powell (51, 1831), J. C. Wilkin (49, 1861) — **only 108 match any
canonical person at all.** The class was full of unevidenced people and missing the evidenced ones.

## 3 · The rules

1. **Target from evidence already held.** The 1860 slave schedules give **2,165 counties with documented
   slaveholders**. That is a harvesting index. Rank by documented enslaved population; harvest where the
   schedules say holders were. Never harvest a jurisdiction because its records happen to be online.
2. **Sample before committing.** Pull ~200 pages, measure the enslaved-mention rate, then decide. The 3.3%
   yield was discovered after 111,331 pages; sampling turns that into a 200-page question. Record the
   sample result as a `research_findings` row either way — a county that yields nothing is a finding.
3. **Every harvest names the goal it serves**, one of exactly three, before it starts:
   * **debit** — an estate valuation that can open an obligation account
   * **chain** — a documented transfer between holders
   * **descent** — a kinship edge that moves a line forward
   A harvest that serves none of the three does not run.
4. **Never type a person by their source.** `person_type='enslaver'` requires evidence of holding: a named
   enslaved person, a transfer, a schedule count, or a document flagged `evidences_enslaved_holding`.
   Absent that, the type is `unknown`. A scraper may not assign a class as a default.
5. **Extraction is part of the harvest, not a later phase.** A page that is scraped but never chunked,
   never extracted, and never traced has cost storage and bought nothing. Acquisition running years ahead of
   extraction is the standing failure mode of this project — 111,331 pages, 0 debits, 0 traces.
6. **When declassifying, bias toward KEEPING the label.** A false keep leaves something a human can still
   check; a false strip silently removes an evidenced slaveholder from the class the ledger reads. Asymmetric
   costs demand an asymmetric test — the loose name match on 2026-08-11 preserved 231 holders that an exact
   match would have stripped.

## 4 · The next harvest this implies

**Virginia probate**, which has never been scraped (the corpus is NY + GA only). It serves all three goals at
once: the Amelia letters name perpetrators there, 13,182 Virginia enslaver canonicals already exist to
corroborate against, and the Shepherd chain (Pannon → Fisher) needs Orange and Powhatan County records.
Densest first, by schedule count: Albemarle (1,676), Bedford (1,465), Chesterfield (961), Culpeper (856) —
and Amelia (447), because that is where the letters are.
