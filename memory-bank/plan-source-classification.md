# Plan — Primary vs Secondary Source Classification

_Scoping doc, May 23 2026. Written after the Isaac Franklin "primary source"
discovery: the live API is about to surface 314,045 FamilySearch `/ark:/`
index URLs as "primary sources" when every one is in fact a **secondary
transcription** of the 1860 slave schedule._

## The problem

"Source" today means three different things in three places:

1. **`person_documents.source_type`** — the *provider* (`familysearch`,
   `slavevoyages`, `georgia-probate-scraper`).
2. **`person_documents.document_type`** — the *form* (`will`, `case_register`,
   `estate_inventory`, `familysearch_record`, …).
3. **`person_documents.source_type_label`** — a free-text label rendered in the UI.

None of these answers the question the user actually wants the page to answer:
**is this a primary historical record, or a secondary citation pointing at
one?** The implicit answer today is "infer from `document_type`":
`will`/`deed`/`estate_inventory` → primary, `case_register` → secondary (the
upload form warns about this in plain text), `familysearch_record` →
unclassified. The Bucket B backfill set 314,045 rows to `familysearch_record`
with the friendly label *"FamilySearch source record"* — read by a user as
*primary*. It is not.

The `enslaver_evidence_compendium` table already has the right column
(`evidence_strength`, values like `direct_primary`, `indirect_primary`) — but
that table is not what the person page renders. The page renders
`person_documents`.

## Goal

A canonical_persons profile should:

- Render **Primary** and **Secondary** sources as visibly separate sections.
- Show a clear banner on persons whose only documentation is secondary —
  *"Primary documentation still needed"* — so the project's research priority
  is legible to anyone reading.
- Let an uploader explicitly mark a contribution's tier when the
  document_type heuristic can't tell (e.g. a deed transcribed in a published
  compendium is *secondary*; a deed scanned from the courthouse is *primary*).

User direction (May 23): _"secondary sources are enough for canonical person
and forensic accounting of the slave owner but it should be clear that
primary sources are needed. … be intentional with what pages because the
Isaac Franklin book is big."_

## Proposed schema

Add one column to `person_documents`, mirroring the compendium's vocabulary:

```sql
ALTER TABLE person_documents
  ADD COLUMN evidence_strength VARCHAR(32);   -- nullable; semantics below
CREATE INDEX idx_person_docs_evidence_strength
  ON person_documents(evidence_strength);
```

Vocabulary (closed set, matching `enslaver_evidence_compendium` so a JOIN
later is trivial):

| Value | Meaning |
|---|---|
| `direct_primary` | An original historical record — courthouse scan, ledger image, deed from the archive, slave schedule scan. |
| `indirect_primary` | An indexed/transcribed-but-curated record citing the original (e.g. a FamilySearch `/ark:/` link to an indexed census entry). |
| `secondary_published` | Republished compilations: Heritage Books, "They Had Names", scholarly editions, the Isaac Franklin estate book. |
| `secondary_database` | Online datasets — SlaveVoyages, the Hall Louisiana database. |
| `tertiary_aggregate` | Re-aggregations, derivative summaries, our own derived records. |
| `unverified` | Awaiting human review. |

`NULL` is allowed but **counts as "unverified"** in the UI — a deploy guard
flags any unverified docs to the admin queue.

## Backfill rules (one-time, scripted)

| Existing rows | New `evidence_strength` |
|---|---|
| `document_type IN ('will','deed','estate_inventory','guardian_account','estate_account','plantation_record','certificate_of_freedom')` AND `s3_key IS NOT NULL` | `direct_primary` |
| same document_type, `s3_key IS NULL` (URL-only) | `indirect_primary` |
| `document_type='familysearch_record'` AND `source_url LIKE '%/ark:/%'` (Bucket B, the 314,045 rows) | `indirect_primary` |
| `document_type='slavevoyages_record'` (Bucket C1, 51,017 rows) | `secondary_database` |
| `document_type='case_register'` | `secondary_published` |
| `document_type='tree_profile'` | excluded already by API; leave as is |
| anything else | `unverified` |

Done with a dry-run-first script (same pattern as `cleanup-system-unknown-junk.mjs`).

## Frontend changes (PersonProfile)

Two visible sections instead of one mashup:

```
┌─────────────────────────────────────────────────────────┐
│ Primary sources                                         │
│  • [scan image]  Will of John Smith, 1847 — courthouse │
│                                                         │
│ Secondary sources                                       │
│  • Heritage Books — Isaac Franklin Estate Book, p. 142  │
│  • FamilySearch index: 1860 slave schedule (ark:/…)     │
│                                                         │
│ ⚠ Primary documentation still needed                    │
└─────────────────────────────────────────────────────────┘
```

The banner shows when **no row** for the person has `evidence_strength =
'direct_primary'`. That is the project's research-priority signal — legible to
both researchers and the public.

`/api/contribute/person/:id` returns each doc with its `evidence_strength`;
the React component bins them. Tiny API change, no schema-breaking move.

## Upload-form additions

`SubmitWillPage` already issues a hardcoded warning for `case_register`. Make
the rule explicit:

- Add a radio: *"Is this an original record or a republished/derivative
  citation?"* — default inferred from document_type, user can override.
- Persist as `evidence_strength` on the resulting `person_documents` row.
- The `archive_source` free-text field stays.

## What this does NOT solve

This plan does *not* address the multi-page-book → many-people fanout problem
(Isaac Franklin's 500 pages going to 50+ enslaved individuals). That is a
separate gap — covered in a forthcoming `plan-collection-page-fanout.md`.
The Isaac Franklin walkthrough will surface those bugs first-hand and inform
that second plan.

## Sequencing

1. **Migration + backfill script** (one new column, dry-run).
2. **API**: `/contribute/person/:id` returns `evidence_strength` per doc.
3. **Frontend**: two sections + banner in PersonProfile.
4. **Upload form**: explicit primary/secondary radio.
5. **Then** deploy — Isaac Franklin's page honestly says "secondary source;
   primary needed" and 314,044 others say the same.
