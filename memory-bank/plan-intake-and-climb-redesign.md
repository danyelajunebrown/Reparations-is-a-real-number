# plan-intake-and-climb-redesign.md — move the research burden off the participant

_Written 2026-08-03, user directive. Companion to [[plan-intake-form-revamp]] — that doc fixed the form
against the DB as it stands; this one changes what intake IS._
_Live-DB counts below verified 2026-08-03 per [[feedback_verify_db_not_logs]]._

---

## 1 · The diagnosis (user, sharpened)

The form is not merely mis-indexed — it is **asking the participant to do the research**. Four FamilySearch
Person IDs, four birth years, four birthplaces, a certified unbroken tree chain. That is a genealogist's
output presented as an intake question. Consequences, in order of severity:

- **It cannot be completed in one sitting.** It requires leaving the form, building a FamilySearch tree, and
  returning. Google Forms does not save partial responses for non-signed-in users.
- **It is impossible for whole classes of participant** — anyone whose family is abroad, out of contact, or
  whose records were never kept. This falls hardest on exactly the descendants of enslaved people the
  project exists to serve, whose documentary record was deliberately thinned.
- **It teaches the wrong thing.** A required "your FamilySearch ID" field tells the participant that is the
  important input. Per [[plan-intake-form-revamp]] F2, a living participant's own ID returns **1 ancestor,
  0 matches** — it is the *least* useful field on the form.

**The inversion:** the participant supplies **people and places**. The system supplies **identifiers and
evidence**. Intake collects only what someone can answer from memory at a kitchen table.

---

## 2 · The minimal intake

Graded by what people reliably know, which is also — not coincidentally — what public records index on.

| Generation | Detail asked | Why that depth |
|---|---|---|
| **Participant** | full | they are the informant |
| **Parents** | **granular** — full name + maiden name, birthplace state, birth year (approx OK), marriage place + year, places lived, living/deceased | a parent's **birth, marriage, or death record names their parents**. Granular parent detail *buys the grandparent generation as a documented link* |
| **Grandparents** | **medium** — name as known (partial is fine), rough birth decade, state or country, living/deceased, **spouse names, children's names** | spouse + children are the disambiguators the record search scores on (§4) |
| **Great-grandparents and older** | **whatever exists** — any name, place, era, story. Unstructured. | most people have fragments; fragments are still leads |

**Removed as required:** all FamilySearch Person IDs, exact birth years above the parent generation, the
tree-linkage certification (Q58/Q59), death dates. **Optional if offered, never blocking.**

**Added:** `unreachable_branches` — "is there a branch you have no contact with or no information about?"
An honest declared gap is a research finding (migration 128 `research_findings` logs nulls as first-class);
a blank field is ambiguous.

**Rule: "unsure" is a first-class answer and must be offered everywhere.** A guessed birth year is worse
than a blank, because record search will confidently return the wrong person and the error propagates
backwards through every generation above it.

Capture format for the current backlog: `worksheets/intake-inbox.json` (gitignored — PII).

---

## 3 · The Genealogical Support Agent — record-walk, not tree-walk

This is the piece that absorbs the burden removed from the form. It generalizes
`scripts/climb/public-record-bridge.mjs`, which already proved the mechanism on Piper (Kathleen Piper →
**Jack Piper Sr** CONFIRMED) but is hardcoded to one family and produces console output rather than rows.

**What it does:** walk *upward through records* until it reaches a deceased person with a public
FamilySearch tree profile — which is where the existing climber can take over. Every step is a record, and
**every record it walks through is simultaneously the kinship evidence for that link.**

```
intake (names + places, no IDs)
   │
   ├─ S0 NORMALIZE     names, maiden names, place strings → state/county, date bands
   │
   ├─ S1 IDENTIFY      resolve each PARENT in public indexed records
   │                   (vital records, 1950/1940 census, marriage, SSDI, obituary)
   │                   disambiguate on spouse + children + residence  ← the intake fields
   │
   ├─ S2 EXTRACT       pull the NAMED PARENTS off that record
   │                   → that is the grandparent generation, document-backed
   │
   ├─ S3 WRITE         canonical_family_edges row + person_documents (S3 + Wayback,
   │                   per standard-file-first-document-archival)
   │                   tier per standard-genealogical-edge-evidence §3
   │
   ├─ S4 RECURSE       repeat S1–S3 on the generation just recovered
   │
   └─ S5 HANDOFF       first deceased ancestor with a public FS profile = climb seed
                       → familysearch-ancestor-climber.js
```

**Confidence tiers it must preserve** (from the bridge, do not loosen):
- spouse **or** child corroboration → **CONFIRMED**, auto-usable
- parents named + birth year ±2, no corroboration → **CANDIDATE**, human review, never auto-asserted
- name-only → **rejected**

**Why this is the highest-value build in the project right now:** `canonical_family_edges` holds **4,924
rows, of which 4 carry a source document** (0.08%). Per
[[standard-genealogical-edge-evidence]], a bare FamilySearch tree edge is tier 3 — navigable and inert,
never assertable — so essentially every DAA lineage currently rides unproven links. This agent is the only
thing in the system that *manufactures* tier-1 kinship documents rather than hoping one exists.

**Constraints (non-negotiable, learned the hard way):**
- **20–34s between FamilySearch searches; STOP on CAPTCHA or logout.** A tight loop tripped FS's CAPTCHA and
  wiped the operator's in-progress login ([[feedback_incapsula_not_scraper]]).
- **One FS scraper at a time** per logged-in Chrome ([[feedback_one_fs_scraper_at_a_time]]); `puppeteer.connect()`
  to :9222 only, never `launch()`.
- **Living relatives are searched, never minted.** They are disambiguators. Requires the new
  `consent_public_records` (form §1 Q2).
- **Null results are logged** to `research_findings` — "the 1940 census for Panola County was searched and
  this person was not in it" is a finding.

**Delivery back to the participant:** the `worksheets/piper-lineage-verification.html` pattern — a
plain-language report the participant confirms or corrects. Participant sign-off, not operator assertion.
This is what replaces the tree-linkage self-certification we are deleting.

---

## 4 · Revised climb methodology

### What we do today

| Stage | Current behavior | Where |
|---|---|---|
| Depth | BFS to `HISTORICAL_CUTOFF_YEAR = 1450` | climber:19, :3305 |
| Verification | none — FS tree pointers taken as fact; a **heuristic constant** keyed to *how the edge was found* (0.90 tree / 0.70 name / 0.75–0.85 record) is stamped as "confidence" | climber:772/793 |
| Non-US branches | eastern-European / eastern-European-Jewish branches **skip** US-record search | climber:967–969 |
| Match | `canonical_persons WHERE person_type IN ('enslaver','slaveholder','owner')` by **name + state/county overlap** | climber:2465–2489 |

**Correction to the framing:** the climber does *not* stop at the European crossing as a rule, and there is
no nobility heuristic in the code — the depth cutoff is already 1450, the start of the transatlantic trade.
What is missing is not depth. It is **verification at every step**, and **evidence review at the top**.

### What it must become

**(a) Verify every step backwards.** Each edge gets its proposition-specific document *at the time it is
traversed*, tiered per [[standard-genealogical-edge-evidence]] §3, written to
`canonical_family_edges.source_document_id`. A discovery-method constant is not evidence. This makes the
climb slower and shorter — correctly. Migration 127 already added `information_type` /
`informant_role` / `event_to_record_gap_years` for exactly this (a tier-1 document can carry secondary
information; gap > ~5yr is a mechanical downgrade).

**(b) International chains of inheritance, not just trees.** A genealogical edge carries a person; an
**inheritance edge carries the wealth**, and wealth crosses borders where trees go cold. Already in place:
`inheritance_edges`, `chattel_transfer_events` (48,985 priced enslaver→enslaver transfers, 1719–1820),
`land_transfer_events` (116), and the Massena parcel spine (M129). The climb should follow *both* and treat
disagreement between them as a signal.

**(c) Evidence review at the enslaver end — six source classes.** Replaces bare name+county matching. Live
coverage:

| Source class | Status | Holdings |
|---|---|---|
| Probate / estate papers | ✅ have | `probate_documents` **3,331** · `probate_estate_extractions` · `will_extractions` **20** · `estate_valuations` |
| Slave schedules / rolls | ✅ have | 1860 schedules (~1.68M `unconfirmed_persons`) · Hall Louisiana (497,697 person_facts) · IPUMS |
| British/colonial compensation | ✅ have | `lbs_claims` **4,691** · `uk_1833_compensation` — **the international bridge already exists** |
| Voyages | ✅ have | `slavevoyages_voyages` / `slavevoyages_past_people` |
| **Freedmen's Bank records** | ❌ **no table** | 28 branches / 200K+ depositors scoped ([[project_freedmens_bank_scrape]]), never landed |
| **Newspapers** (runaway ads, estate notices, sale notices) | ❌ **no table** | Hynson DC runaway compilation is `max_evidence_tier='secondary'`; no newspaper corpus |
| **Slave narratives** (WPA, published) | ❌ **no table** | not ingested |

So three of the six classes the new methodology names **do not exist in the DB yet**. That is the honest
gap, and it is an acquisition question, not a code question.

**(d) Nobility / European gentry.** Not currently modelled at all. If it is to be a signal it needs a real
source (peerage + estate records), not a name heuristic — otherwise it reproduces exactly the
"old person ≈ slaveholder" proxy the gate standard already refused.

### Matching bar

Name + county overlap is a **lead**, never a match. Per the Biscoe rule
([[project_biscoe_identity_resolution]]) parentage is the primary key and name-only never auto-merges. A
climb match should be promoted only when an independent source class (probate, schedule, compensation,
newspaper) corroborates the *same person* — and `linkage_verdicts` (M126) is where the verdict is written.

---

## 5 · Build order

1. **Load the three backlog submissions** from `worksheets/intake-inbox.json`; run a climb per submission.
   Use them as the design probe — every field they *cannot* fill is a field the new form must not require.
2. **`participant_climb_anchors` + `participant_living_relatives`** (migration) — the shape both the
   simplified form and the support agent read/write.
3. **Generalize `public-record-bridge.mjs`** into the support agent: DB-driven instead of hardcoded, writes
   edges + documents instead of console output, resumable per participant. Highest value in the repo
   (0.08% of edges are documented).
4. **Rebuild the form** to §2 above — Google Form v2, new response sheet, new `FORM_COLUMNS`. Ship the
   `net_worth` → `estimated_net_worth` fix (`DAAOrchestrator:1885`) with it or the financial answers stay
   unread.
5. **Verification-at-every-step in the climber** — the (a) change. Slower, shorter, assertable.
6. **Acquisition** for the three missing source classes — Freedmen's Bank first (scoped, 200K depositors,
   directly indexes formerly-enslaved people and often names the former enslaver).

**Not now:** the international-ingest epic beyond LBS (#119–145, EPIC #135 — deferred), nobility modelling,
newspaper corpus. Each needs a source before it needs code.
