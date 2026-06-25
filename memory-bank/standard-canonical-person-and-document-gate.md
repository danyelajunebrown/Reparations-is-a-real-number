# STANDARD — Canonical Person + External-Assertion Document Gate

_Authoritative project standard. Established by user verdict June 24, 2026,
reconciling `plan-identity-resolution-completion.md` (what canonical means) with
`plan-source-classification.md` (May-23 secondary-source direction). This file is the
source of truth; `CLAUDE.md` RULE 1/2 is the always-loaded short form._

## A `canonical_persons` row requires BOTH

1. **Identity: a verified, discrete, unique human.** Deduped / identity-resolved via
   the tiered fingerprint (`plan-identity-resolution-completion.md`). Tier-3 name-only
   matches are NEVER auto-merged (Biscoe rule). "One row = one verified discrete human."
   **Never bulk-mint un-deduped canonicals from a dataset** (the SlaveVoyages-PAST and
   Hall ingests both did this — debt, see below).

2. **Evidence: at least a verified SECONDARY source.** SlaveVoyages / Hall =
   `secondary_database`, recorded as a per-person `person_documents` row. **Secondary
   is ENOUGH to create the canonical.** (May-23 user direction.)

Identity resolution and documentation are **separate axes** — dedup can be well
underway on leads without anything becoming canonical, and a canonical can be
secondary-only without yet being publicly assertable (the gate, below).

## The External-Assertion Gate

A secondary-only canonical **EXISTS and is fully usable INTERNALLY** — it can support a
DAA, an ancestor climb, obligation math, and identity resolution with no interruption.
Internally it may be understood as slaveowning / enslaved.

It is **GATED** until a proposition-specific document is in S3 storage:
- **NOT visible in the front-end search engine**, and
- **We NEVER externally assert that anyone WAS or WAS NOT a slaveowner / was enslaved /
  was prior-enslaved.**

The gate lifts **only** when a **proposition-specific corroborating document is stored
in S3** (`person_documents.s3_key` present — a real archived file, not a secondary URL
pointer), and **only for the proposition that document substantiates** (a bare
FamilySearch profile does not license "was a slaveowner").

This **tightens May-23**: May-23 allowed a *visible* canonical with a "Primary
documentation still needed" banner; this verdict makes a secondary-only canonical
*hidden from search and non-assertable* until a stored document exists.

## Verifying document types (proposition-specific; "so far", extensible)

| Document | "was a slaveowner" | "was enslaved / prior-enslaved" |
|---|---|---|
| Slave schedule | ✅ owner named | — (enslaved counted, usually unnamed) |
| Census with slaves listed | ✅ | — |
| Will / probate | ✅ bequeaths enslaved | ✅ named in inventory/bequest |
| Freedman's Bank deposit | — | ✅ depositor; often names enslaver |
| DC compensated-emancipation petition | ✅ owner's claim | ✅ names the enslaved |
| Plantation records | ✅ | ✅ named |
| Correspondence *from the person under consideration* | ✅/— by author | ✅/— by author |
| Slave / freedman narrative | — | ✅ first-person testimony |

## Mechanism (proposed, NOT yet built)

A gate flag on `canonical_persons` (e.g. `externally_assertable` / `public_search_visible`),
default FALSE, set TRUE per-proposition when a qualifying `person_documents.s3_key` is
attached. The public search API and any "was a slaveowner / was enslaved" UI string
filter on it; internal consumers (DAA, climber, obligation, dedup) ignore it.

## Standing debt (flag; reconcile under this standard, do not act unprompted)

- **Bucket C1** — 51,017 SlaveVoyages canonicals whose `person_documents` are
  `external_url` only (no `s3_key`) → **gated** under this standard until S3 documents
  attached.
- **Hall** — ~100K canonicals minted from the bulk DB without per-person documents and
  without dedup → violates BOTH requirements; needs reclassification to leads or a
  documents + dedup backfill.
- **SlaveVoyages PAST** — 169K records currently staged as LEADS
  (`slavevoyages_past_people`) with facts attached; resolver shelved. Correct path:
  dedup → mint canonical (gated) → attach the proposition-specific document
  (the source's cited Register of Liberated Africans / NARA manifest) to lift the gate.

## See also
`plan-identity-resolution-completion.md` · `plan-source-classification.md` ·
`interpretive-framework.md` (uncertainty: confidence, `name_type:'unknown'`,
explicit-vs-inferred, human-review) · `projectbrief.md`.
