# Finding — I rebuilt two pipelines that already existed; and what that exposed about interoperability and retrievability (2026-08-10)

Related: [[finding-chunk-sweep-timeout-and-amelia-image-backing-aug09]] · [[plan-descent-first-lineage]] ·
[[standard-canonical-person-and-document-gate]] · [[standard-project-monitoring-and-free-agents]]

## 1 · The mistake, stated plainly

I spent an evening building `extract-jefferson-farm-book-rolls.mjs` and `generate-ale-worklist.mjs`.
**Both already existed on the Mini, running on cron, and both existing versions are better.**

| I built | Already existed | Which is better |
|---|---|---|
| deterministic roll parser → 445 leads + 169 edges | `extract-farm-book-roster.mjs` → `farm_book_persons`, **701 mentions** | theirs: captures mother **and** father, occupation, status; and it **stages** rather than minting |
| `generate-ale-worklist.mjs` → 25 tasks in a markdown file | `ancestry-corroborate.mjs` → `ancestry_corroboration_queue`, **453 tasks** | theirs: ntfy one-at-a-time, an `--ingest` path, and a **crosswalk to the free primary source** |

**The check I skipped cost five seconds:** `ssh mac-mini-ts 'crontab -l'`. Worse, `extract-farm-book-roster.mjs`
appeared *in my own pool-audit output* hours earlier and I read straight past it. CLAUDE.md's first rule is
**read first**; I read `activeContext.md` and treated that as having read the system. The memory bank
describes *intent*; the crontab and the script directory describe *what is actually running*. They are not
the same artifact and one does not substitute for the other.

**The deeper error:** the existing Farm Book design says, in its own header, *"NO leads/edges created here —
Stage 5 resolves mentions → distinct people first (Biscoe-safe)."* I minted leads and edges directly — and
then hit exactly the failure that staging exists to prevent, attaching five Monticello children to an
enslaved woman in Louisiana on a shared mononym. **The architecture had already anticipated my bug and I
routed around the guardrail because I hadn't read it.**

## 2 · What this architecture is actually doing (worth saying out loud)

Having now read it properly: this is **an evidentiary architecture, not a data-collection one**. Most
genealogical systems optimise for coverage. This one optimises for *what survives an auditor*, and the
design choices are unusually disciplined:

* **Staged extraction** — mention → resolution → promotion. A mention is never a person. This is the single
  structural reason a name-only merge is hard to commit here, and it is why `farm_book_persons` carries
  `resolved_person_id` and `promoted` as separate columns.
* **Evidence graded per EDGE, not per source** (M127 `information_type` / `informant_role`). The Amelia
  letters proved why: one document yielded a father's direct testimony (primary) and a Bureau agent's
  relayed hearsay (secondary) *on the same page*. A per-source confidence would have laundered the second.
* **Null results are first-class** (`research_findings`, 1,173 rows). "Searched and not found" is the only
  thing that distinguishes a stalled line from an unworked one.
* **The licensed-source pattern in `ancestry-corroborate.mjs` is genuinely elegant** and I want it recorded
  as a pattern, not an implementation detail: *use the paid index as a FINDING AID, then cite the free
  primary source it points to*. The bot never touches Ancestry; the human actuates one step; what we keep
  is a fact and a pointer. That dissolves a licensing problem **structurally** rather than by promising to
  be careful. It generalises to every licensed corpus this project will ever want.
* **Dual ledger** — compensation *to* enslavers is evidence of debt, not credit against it. Which is why
  Dr. Frank Jeter's claim that Lizzie owed him "the trouble and expense which we have had in raising her"
  is not a defence but a signed entry on his own side of the account.

## 3 · Interoperability — where the seams actually are

Concrete, all observed today, all costing real work:

1. **The lead/canonical split is modelled inconsistently across tables.** `canonical_family_edges` carries a
   polymorphic pair (`a_subject_table`/`a_subject_id`) so leads can be endpoints. `chattel_transfer_events`
   has person FKs that reference `canonical_persons` **only** — so a documented transfer between
   un-promoted people cannot carry its ids at all. The Shepherd sale is stored with names as text and the
   lead ids stranded in `source_citation`. Under RULE 0.6 most people are leads for a long time, so the
   table that records *who was sold to whom* is structurally unable to reference most of the population.
2. **`canonical_family_edges` has two addressing schemes at once** — `person_a_id`/`person_b_id` **and** the
   polymorphic pair — and the UNIQUE constraint sits on the former. For lead-to-lead edges those columns are
   NULL, so **the uniqueness guarantee silently does not apply** to exactly the edges this project is now
   producing most of. Dedup has to be hand-rolled per writer, which is how divergence starts.
3. **`harm_events` holds ONE perpetrator.** The Shepherd children have two owners in sequence. A chain of
   holding — the continuity-of-holding thesis applied to people — has no representation.
4. **Place is derived by parsing an S3 path** (`probate/<state>/<county>/…`), because
   `descent_anchors.primary_state` / `primary_county` are NULL on all 595 rows. And the paths are already
   wrong: **`georgia/albany` (4,489 docs) and `georgia/allegany` (3,520)** — both are New York counties.
   A structured fact should not live in a string that nothing validates.
5. **Two pipelines for one source, neither aware of the other.** The duplication in §1 is itself an
   interoperability failure: nothing in the schema or the memory bank made the existing Farm Book lane
   discoverable from inside the repo I was working in.

## 4 · Retrievability — the sharp one

RULE 0.5 says anything unembedded is invisible to RAG. Measured today:

| Table | Rows | Embedded |
|---|---|---|
| `chattel_transfer_events` | 48,987 | **0** |
| `canonical_family_edges` | 7,905 | **0** |
| `probate_estate_extractions` | 6,936 | **0** |
| `research_findings` | 1,173 | **0** |
| `descent_frontier` | 1,882 | **0** |
| `farm_book_persons` | 701 | **0** |
| `ancestry_corroboration_queue` | 453 | **0** |

**RULE 0.5 has been applied to the NOUNS and not to the VERBS.** Persons and documents are embedded;
relationships, transactions, findings and work queues are not. So RAG can answer "who is this person" and
"what does this page say", but it cannot answer **"who was sold to whom"** (49k transfers), **"who is
related to whom"** (7.9k edges), or — worst — **"what have we already searched for and failed to find"**
(1,173 null findings). That last one defeats the entire purpose of `research_findings`: it exists so a
stalled line is distinguishable from an unworked one, and being unretrievable makes the distinction
invisible to anything that reaches for it through RAG. **The system will re-do work it already knows failed.**

**The canonical embedding picture, stated precisely** (the alarming version is wrong): 762,374 canonical
persons, **5** embedded directly — but **414,829** are reachable through the promoted lead they came from,
and those leads *are* embedded. So it is not "5 of 762k are retrievable". It is:
* ~**347,545 canonicals (46%) have no embedding path at all**, and
* the other 415k are indexed by their **pre-promotion lead text** — a stale snapshot that does not reflect
  merges, enrichment, or anything the canonical learned after promotion.
RULE 0.6 clause 3 ("every canonical is in RAG") is satisfied only by that indirection, and only for half.

## 5 · What follows

* Stage 5 becomes a **reconciler** (operator's call, 2026-08-10): the LLM extraction (701 mentions) and the
  deterministic parse (445 leads) read the same pages independently. Agreement promotes; disagreement
  becomes a `linkage_verdict`. Duplication converted into a quality signal — the same principle the plan
  already states for cross-source disagreement.
* Embed the verbs. A relationship and a null finding are as retrievable-worthy as a person.
* Before building anything: **read the crontab, not just the memory bank.**
