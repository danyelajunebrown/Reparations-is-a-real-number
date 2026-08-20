# Standard — the three-layer model: ledger tables, the assertion store, and vectors

_Adopted 2026-08-20. Operator: "is a table even the best most efficient data storage for us at scale given
this? … we must find a solution for this if we are to proceed."_

Related: [[standard-targeted-harvesting]] · [[finding-duplication-interoperability-retrievability-aug10]] ·
[[finding-fabrication-classes-aug19-20]] · [[interpretive-framework]]

## 1 · The problem that forced it

The Digital Library on American Slavery (UNCG) indexes 2,975 legislative + 14,512 county-court petitions
(~150,000 individuals: ~80,000 enslaved, ~8,000 free people of colour, ~62,000 white) with a **controlled
vocabulary of 127+ terms in 12 categories**, built over eighteen years by researchers reading the records.

A first-pass mapping said **68% of those terms had "no home"** in our schema — including
`Testimony (FPOC)`, `FPOC sues white`, `Occupation (FPOC)`, `Apprenticeship/Indenture (FPOC)`,
`White affection (enslaved)`, `Clandestine economy`, `Passing as white`, `Purchase of freedom`,
`Sues to recover freedom (FPOC)`, `Forced reproduction`, `Kidnapping (FPOC)`.

**A table per concept does not scale to 127 terms, and the next source will bring its own vocabulary.**

## 2 · The answer: we already built it and stopped using it

`person_facts` — **497,851 rows** — is a typed, provenanced, CONTESTABLE assertion store:

```
fact_type (open text vocabulary) · date_text / date_year / date_end_year / date_precision
place_text / place_state / place_county / place_locality · value_text
related_person_id / related_name_text
source_table / source_external_system / source_external_id / source_url / source_citation
confidence · verification_status · contested BOOLEAN · contested_reason · metadata JSONB
```

So the 127 DLAS terms are **`fact_type` values, not 86 new tables**. And the "no home" verdict was wrong:
`manumission` (221), `escape` (1,009), `free_status` (122), `occupation` (8,733) were **already in use**.
That was the FIFTH asserted-absence-without-checking of the session — the homes existed; nobody moved in.

**`contested` / `contested_reason` is the important column.** Operator, 2026-08-20: *"remember freedoms were
lost, people were thrown in jail and sold and just all manner of kkk abuse."* Freedom is not a one-way state
change. Free people were kidnapped, re-enslaved, bound out under apprenticeship and vagrancy law, jailed.
DLAS carries both directions — `Purchase of freedom` AND `Sues to RECOVER freedom (FPOC)`,
`Fear of enslavement`, `Kidnapping (FPOC)`. A `free_status` fact must be **revocable with a reason**, and
this column is how. **It has been used 0 times.**

## 3 · The three layers — what goes where

| layer | holds | why |
|---|---|---|
| **Ledger tables** — `chattel_transfer_events`, `inheritance_edges`, `slave_era_insurance_policies`, `wealth_transfer_events`, `corporate_financial_instruments` | priced, dated, joinable instruments | a DAA must do **arithmetic**; sums and joins need real columns and FKs |
| **`person_facts`** | the long tail of 127+ subject types, typed and provenanced | an **open vocabulary absorbs the next source** without a migration |
| **`embeddings`** | every layer, rendered as natural-language sentences | the **query layer** — no column is needed to ask "who sued for freedom" |

**The rule:** if it must be *summed*, it needs a table. If it must be *found*, it needs a vector. If it is a
claim about a person, it is a fact. Most things are the third.

## 4 · Inference is a DECISION, not a default

Every serious defect found 2026-08-19/20 was an **implicit inference no human ever approved**, running at a
scale of millions:

| implicit inference | cost |
|---|---|
| a probate decedent is an enslaver | 7,053 canonicals fabricated |
| a tally mark on a slave schedule is a person | 1,456,640 rows fabricated |
| found via a family tree ⇒ possibly alive | 12,562 ancestors hidden from search |
| no attached scan ⇒ not assertable | 243,209 enslaved unfindable |
| `y` is not a vowel | every "Mary" silently deleted |

None was chosen. Each was a **default that became policy**. So:

1. **No ingest may assign `person_type`, a harm type, or a status by provenance.** Evidence only.
2. **Every inference carries its rule in `metadata` / `data_quality_flags`**, so it can be found and reversed.
3. **Ambiguity is preserved, never resolved by code.** `land_tract_unresolved`, `needs_review`,
   `linkage_verdicts='uncertain'` — a false accept is fixable, a false reject vanishes without trace.
4. **Absence is recorded** (`research_findings`), because a searched-and-not-found is a fact about the archive.

Do NOT build a new "inference registry" table. Seven structures already carry inference
(`linkage_verdicts`, `research_findings`, `information_type`/`informant_role`, `evidence_tier`,
`max_evidence_tier`, `data_quality_flags`, `confidence`). What is missing is a **view across them** answering
"what are we currently inferring, on what evidence, approved by whom" — a reconciliation, in the sense of
Roth & Tolbert 2025 (`Reconcile`), not another store.

## 5 · Reading a new source (the O-of-O, operator-approved)

1. **Pull the source's own controlled vocabulary / glossary first**, verbatim, into `bibliography_sources`.
2. **Map, don't force.** Where we have no home, that is a **finding**, not a rounding error.
3. **Sample ~200 records** across states / courts / decades and measure which fields actually populate —
   *before writing a single person row*.
4. **Then** design the ingest, and only then run it.

Rationale: at ~150,000 individuals DLAS would become one of the largest person-sources in the system, and
today proved what happens when an ingest runs ahead of its evidence.

## 6 · Access posture (per source, always checked first)

* **DLAS (dlas.uncg.edu)** — `robots.txt` has every rule commented out; no AI restrictions, no disallowed
  paths. Crawlable politely. Per-petition CSV/JSON/XML export exists. UNCG also "works with researchers to
  make data sets available" — worth asking for bulk, but not a blocker.
* **colonial-settlers-md-va.us** — `robots.txt` DISALLOWS ClaudeBot by name; `ai-train=no`, `use=reference`;
  origin 403s. **Operator-supplied content only. No crawler. Ever.**
* **Ancestry / ALE** — licensed. Human actuates, machine organises; we keep citation + operator
  transcription, never a rehosted image.
* **NARA / MSA / LVA** — federal and state public records. Ancestry and compiled genealogies are FINDING
  AIDS; cite the record, not the index.
