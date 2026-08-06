# plan-intake-form-revamp.md — rebuilding the intake form around what actually climbs

_Written 2026-08-03. Branch context: `feat/evidence-quality-parcel-spine`._
_Supersedes nothing; extends [[project_premiere_intake]] / [[project_wealth_fingerprint]]._
_Sources of truth consulted: the live form (PDF printform, 62 questions, 19pp),_
_`src/api/routes/intake.js`, `scripts/validate-intake-form.js`, `scripts/google-apps-script/intake-webhook.gs`,_
_`scripts/climb/public-record-bridge.mjs`, `src/services/reparations/DAAOrchestrator.js`, `src/api/routes/daa.js`,_
_migrations 036/037/122, and the **live Neon DB** (participants, participant_family, ancestor_climb_sessions,_
_intake_research_leads) per [[feedback_verify_db_not_logs]]._

> **The finding in one line.** The form asks for the participant's own FamilySearch ID and their four
> grandparents' — and the live DB shows that a climb from a living participant's own ID returns **1 ancestor
> and 0 matches**, while a climb from one *deceased* great-grandparent returns **829 ancestors and 131
> matches**. The form is optimized for the wrong anchor, and the webhook that ingests it is mis-indexed
> against the form's current column order, so the grandparent IDs it does collect never land correctly anyway.

---

## PART I — FINDINGS

### F1 · The webhook's positional map no longer matches the live form (CRITICAL)

Three artifacts each declare a different column order, and none matches the other two:

| Artifact | Order |
|---|---|
| **Live form** (PDF) | consents(4) → self(5) → financials(7) → wealth-fingerprint(9) → Parent1(5) → Parent2(5) → **GP1(6)** → **GP2(6)** → GP3(5) → GP4(5) → verification(3) → certify |
| `src/api/routes/intake.js` `FORM_COLUMNS` | consents → self **+ email@9 + address@10–13** → financials → fingerprint → father@32 → mother@37 → **GPs@42/47/52/57, 5 columns each** |
| `scripts/validate-intake-form.js` `COLUMN_MAP` | consents → self+email+address → **parents@15–24** → **financials@25–43** → GPs@44–63 |

The validator and the webhook disagree about whether parents come before or after the financial block — one
of them has been wrong since it was written. Against the *live* form both are wrong, in a specific and
diagnosable way:

**Questions 41 and 47 ("Whom is their child or inheritor? — Parent 1 / Parent 2") give grandparents 1 and 2
a SIXTH field that grandparents 3 and 4 do not have.** The webhook reads every family member as a fixed
5-column block `[name, birth_year, birthplace, fs_id, is_living]`. So from grandparent 2 onward the map
slips — one column, then two:

```
sheet col  live form question                       webhook thinks it is
────────── ─────────────────────────────────────── ──────────────────────────────
47         GP1 "whom is their child" → "Parent 1"   pat_grandmother.NAME
48         GP2 full legal name                      pat_grandmother.birth_year
51         GP2 FamilySearch Person ID               pat_grandmother.is_living
52         GP2 is living                            mat_grandfather.NAME
56         GP3 FamilySearch Person ID               mat_grandfather.is_living   ← silently dropped
61         GP4 FamilySearch Person ID               mat_grandmother.is_living   ← silently dropped
```

`fsIdClean()` returns `null` for "Parent 1" and for "Yes (living)", so the failure is **silent**: rows are
written to `participant_family` with a null `fs_id` and no error. Three of the four grandparent FS IDs — the
entire point of the form — cannot survive ingestion.

**The form also has no email and no address question at all**, while the webhook still expects them at
columns 9–13 and `daa.js` hydrates `acknowledgerInfo.address` from them. Those questions were deleted from
the form; deleting a Form question leaves a now-permanently-blank column in the linked response sheet, which
is also what the `// column 5 is a placeholder ("Column 5") — skip` comment is describing. The sheet is
carrying ghost columns.

**Live-DB confirmation that this path has never worked end-to-end:** `participants` holds **3 rows**, with
`intake_source` values `google_form` (hand-entered), `kiosk`, and `manual`. **Zero** rows with
`intake_source='google_form_webhook'`. All three have `email IS NULL`.

### F2 · The DAA is anchored to the one identifier that yields nothing

`DAAOrchestrator.generateComprehensiveDAA(familySearchId, …)` →
`ensureClimbComplete()` (`:849`) looks up `ancestor_climb_sessions WHERE modern_person_fs_id = $1` →
`getDocumentedSlaveholders(climbSession.id)`. The `familySearchId` comes from `participants.self_fs_id`
(`daa.js:51`). One seed, one session, one DAA.

Live `ancestor_climb_sessions`:

| seed | who | ancestors_visited | matches_found |
|---|---|---|---|
| `LTVZ-D9S` | Piper Hill — her own FS ID | **1** | **0** |
| `LTVZ-D9S` | same, second attempt | **1** | **0** |
| `LTVZ-D8M` | Jerry Ralph Smith — deceased, found by the public-record bridge | **906** | **138** |
| `LTVZ-D8M` | same, rerun | **829** | **131** |
| `LX39-1MY` | Gwendolyn Fagan — deceased grandparent | **5,260** | **548** |

FamilySearch hides living people's tree profiles. Every living seed dead-ends at 1. The form makes the
self FS ID **required** (Q8) and asks whether it is marked "Living" (Q9) — then does nothing with the
answer. And grandparents are frequently living too: Piper's were born 1940–42. The seed that worked was a
**great-grandparent**, and the form has no slot for one. Adrian's `participant_family` rows use the ad-hoc
relationships `pat_grandfather_parent` / `pat_grandmother_parent` — great-grandparents, hand-entered,
using a vocabulary the form does not contain.

**Consequence for the form: the required unit is not "your four grandparents." It is "the oldest DECEASED
ancestor you can find on each of your four lines."** For many participants that *is* a grandparent; for
Piper it is a great-grandparent. Asking for it directly costs the participant the same effort and returns a
climbable seed instead of a dead one.

### F3 · The disambiguators the living-person bridge runs on are hardcoded, not collected

`scripts/climb/public-record-bridge.mjs` is how a living grandparent gets converted into a deceased,
climbable great-grandparent. Its `scoreMatch()` is the whole mechanism:

```js
for (const sp of gp.knownSpouse)   if (hay.includes(norm(sp)))  { score += 3; ... }
for (const ch of gp.knownChildren) if (hay.includes(norm(ch)))  { score += 3; ... }
if (gp.birth && r.year && Math.abs(+r.year - gp.birth) <= 3)    { score += 1; ... }
```

`score >= 3` → **CONFIRMED** (auto-usable). Below that → **CANDIDATE**, human review only. Known spouse and
known children are the only two things that produce a confirmed seed — and both are hardcoded in a
`GRANDPARENTS` array at the top of the file. The form collects neither. Collecting them turns a hand-fed
script into an intake-driven pipeline step, and it is the difference between a confirmed and an unusable
result for exactly the participants (living grandparents) the current form serves worst.

### F4 · A money multiplier exists in the schema with no question behind it

M037 documents `corporate_connection_type` as feeding `TieredPaymentCalculator.CORPORATE_ADJUSTMENT`:

```
'none' = 1.0x · 'indirect' = 1.2x · 'direct' = 1.5x · 'owner' = 2.0x
```

The intake webhook never sets it. All three live participants read `'none'`. Q23 asks *which* companies
(a 30-item checkbox) but never the *nature* of the tie, so the checkbox can raise nothing. Same pattern for
four more M037 columns the form either never asks or never delivers:

| Column | Status |
|---|---|
| `corporate_connection_type` | drives the multiplier · **no question exists** |
| `corporate_connection_details` | **no question exists** |
| `pre_1865_business_details` | **no question exists** (only the yes/no is asked) |
| `inherited_land_states` (TEXT[]) | built to drive county-level slave-schedule lookup · **NULL for everyone** |
| `inherited_land_use` (TEXT[]) | asked, but not mapped by the webhook |

### F5 · Q22 is unparseable by construction

> "If yes, list what state(s) in the 'other' field and select primary use (check all that apply)."

One checkbox question doing two jobs. The states land inside the free-text "Other:" slot of a multi-select,
comma-joined with the use codes. `inherited_land_states TEXT[]` and `inherited_land_use TEXT[]` are separate
columns and cannot both be recovered from one string. This is why `inherited_land_states` is NULL —
and county, which is what the slave schedules are actually organized by, is never asked for at all.

### F6 · The consent block carries no information, and one item is anachronistic

- **Q1–Q4 each offer exactly one option: "Yes."** A consent that cannot be declined is not consent, and the
  four `consent_*` booleans are constant-true — zero signal, and no record that a choice was offered.
- **Q4 asks consent to record the DAA "on the Ethereum blockchain."** The contract is `ReparationsEscrow` on
  **Base**, and per [[project_direction_identity_over_payment]] the payment layer is **dormant** and read as
  anachronistic to the project's own thesis. This gates participation on consenting to something that is not
  happening.
- **Nothing consents to what IS happening.** The public-record bridge searches indexed FamilySearch records
  about the participant's *living relatives* (spouses, children) to identify them. That is a materially
  different act from "research my ancestors" and deserves its own explicit yes/no. Likewise, migration 128
  `research_findings` now logs NULL results as first-class findings — a participant should know their
  negative result becomes a durable record.

### F7 · The form never asks which class the participant descends from

Project scope is enslaved persons, enslavers, and opted-in descendants of **both** classes.
`participants.roles[]` already distinguishes `enslaver_descendant` from `enslaved_descendant` — Adrian
carries both. The form never asks; roles are assigned post-hoc.

The practical cost: **seven required money questions (Q10–Q16) sit before any genealogy.** A descendant of
enslaved people must disclose income, net worth, real-estate equity, inheritance, and dependents in order to
receive a document computing what they are *owed*. That is the wrong ask for half the intended population,
and it is the most likely abandonment point on the form.

### F8 · The highest-yield question on the form is question 61 of 62, optional and unstructured

Adrian's single free-text sentence — "my paternal grandmother's ancestors were owned by John McCain's
ancestors" — produced, via `parse-intake-oral-history.mjs`, a directed research hypothesis matching
**43 McCain enslavers we already hold**, with dominant geography **Union County, North Carolina** (which
corrected an assumed Carroll County MS). Live `intake_research_leads` holds 3 rows, **all three from that
one field** (`slaveholder_family`, `adoption`, `name_change`). Nothing else on the 62-question form has ever
produced a research lead.

It is currently last, optional, unlabeled as important, and prose — so the parser must infer branch, named
entity, and geography. Structuring it (surname / which line / place / what you were told) turns inference
into direct capture and raises the confidence floor above the 0.5 hypothesis default.

### F9 · No kinship documentation is requested — and that is the DAA's open gap

Per [[standard-genealogical-edge-evidence]], a bare FamilySearch tree edge is **tier 3: navigable and
inert**, never assertable. Per `activeContext` (2026-07-31), the kinship PATH gate is the DAA's remaining
open refinement: **0 of 4,922 edges carry a kinship document**, and subset generation now lets DAAs ride
unproven lineages.

The tier-1 documents that would lift a participant's own generations are precisely the ones a family keeps
in a drawer:

| Document | establishes "X is the child of Y" |
|---|---|
| Death certificate naming parents | ✅ tier 1 |
| Marriage record naming parents | ✅ tier 1 |
| Birth / baptism record | ✅ tier 1 |
| Will / probate naming heirs | ✅ tier 1 |
| Post-1850 census co-residence | ✅ tier 1 |
| Obituary / funeral program | secondary |
| Family Bible | secondary unless imaged |

The form asks for none of them. What it asks instead is Q58/Q59 — self-certify that your FamilySearch tree
links are "correct" — which is a tree assertion about a tree assertion, and cannot lift any gate.

### F10 · No modern-endpoint or institutional signal

Dutchess calibration is blocked on a **modern endpoint**, and [[plan-modern-endpoints-program]] builds
living institutions (Bard, Amherst, Georgetown, Harvard…) as land- and capital-path endpoints. The form asks
about 30 corporations but never asks the open question that surfaces an endpoint: which universities,
churches, hospitals, insurers, or employers the family has been tied to across generations. Nor **where the
family's land actually is** at county resolution — the join key for the slave schedules.

### F11 · The form promises delivery it cannot perform

Section 11: "You will receive your printed Damages Assessment Agreement privately." No email question. No
address question. `daa.js` sets `address: null` for every participant. All three live participants have
`email IS NULL`.

### F12 · Code-side: the wealth fingerprint is silently discarded (fix alongside)

`DAAOrchestrator.loadParticipantWealthFingerprint()` (`:1885`) selects `net_worth`. Verified against the
live DB:

```
net_worth QUERY FAILS: column "net_worth" does not exist
```

The column is `estimated_net_worth` (M036). The query throws → the `catch` warns → `dbRow = null` → the
function returns `defaults`, so the M037 merge path is dead and `wealth_flag_elevated` / `wealth_flag_reasons`
are never read back. **New financial questions will not reach the calculator until this one-word fix lands.**

**Related structural gap (code, not form):** the DAA consumes exactly one climb session from one seed. Four
grandparent FS IDs are stored in `participant_family` but no automated path seeds climbs from them —
Adrian's and Eli's were launched by hand (`run-schwehr-climb.sh`, `run-eli-neal-climbs.sh`). If the form
requires four anchors, something must fan out over them and union the matches.

---

## PART II — THE REVISED FORM

### Design rules

1. **Ask for what climbs.** The required genealogical unit is a *deceased, FS-resolvable* ancestor per line.
2. **One question → one column → one field.** No composite questions (Q22), no asymmetric blocks (Q41/Q47).
3. **Every question maps to a column a named consumer reads.** No orphan questions; no orphan columns.
4. **Branch on class before asking for money.**
5. **Consent must be declinable**, and must cover what the pipeline actually does.

### Operational note — build a NEW form, not an edit

The current response sheet carries ghost columns from deleted questions (the "Column 5" placeholder; the
email/address block at 9–13). Editing the live form preserves that debris and keeps the index fragile.
**Create a new form with a new response sheet**, point the Apps Script trigger at it, and replace
`FORM_COLUMNS` wholesale. Keep the old sheet read-only for the archive.

### Sequence and length

Full length is ~95 columns, but Google Forms section branching means a typical respondent sees far fewer:

- an **enslaved-descendant** respondent skips §11 entirely (−13) → ~60 seen
- a respondent whose grandparents are all deceased skips §6 (−12) → ~50 seen

**Strongly consider splitting**: Form 1 = §1–§10 + §12 (genealogy, everyone). Form 2 = §11 (financial), sent
by link only to `enslaver_descendant`/`both` participants *after* a documented match exists. That removes the
"disclose your income before we've found anything" barrier entirely and is the single biggest completion-rate
lever on the form.

---

### §1 — Consent (all required; **every item must offer Yes AND No**)

| # | Question | Type | → column |
|---|---|---|---|
| 1 | I consent to this project conducting genealogical research on my behalf using FamilySearch.org, and cross-referencing the results against historical slavery records. | Yes / No | `consent_research` |
| 2 | I consent to your searching **public indexed records** (census, marriage, death, obituaries) about my deceased relatives — and, where it is needed to identify them correctly, about **living relatives I name in this form**. | Yes / No | `consent_public_records` **NEW** |
| 3 | I understand results may be a **negative finding** — that no documented connection was found in the records currently available. A negative finding does not mean no connection exists, only that it could not be verified to our evidentiary standard. | Yes / No | `consent_negative` |
| 4 | I understand that searches which return **nothing** are also recorded, as a permanent research record that a given source was checked and was empty. | Yes / No | `consent_null_logging` **NEW** |
| 5 | May we contact you to **confirm or correct** what we find, before any document is issued in your name? | Yes / No | `consent_contact` **NEW** |
| 6 | How may the resulting Debt Acknowledgment Agreement be recorded? | ○ Private to me only ○ Anonymized public record ○ Named public record | `daa_publication_scope` **NEW — replaces Q4** |

> **Q6 replaces the Ethereum question.** It captures the same intent — building a public pecuniary reference
> class — without gating participation on a dormant payment layer, and without naming the wrong chain.
> `consent_blockchain` can be derived (`scope != 'private'`) so nothing downstream breaks.

---

### §2 — Who you are

| # | Question | Type | → column |
|---|---|---|---|
| 7 | To your knowledge, are you a descendant of… | ○ people who were enslaved ○ people who enslaved others ○ **both** ○ I don't know — that's why I'm here | `descendant_class` **NEW** → `roles[]` |
| 8 | Full legal name | text | `full_name` |
| 9 | Any other names you have used — maiden names, a name change, an adoptive name | text | `other_names_used` **NEW** → `intake_research_leads` (`name_change`) |
| 10 | Date of birth | date | `date_of_birth` |
| 11 | Birthplace — city | text | `birthplace_city` |
| 12 | Birthplace — state | text | `birthplace_state` |
| 13 | Email | text | `email` **RESTORED** |
| 14 | Mailing address — street | text | `address_line1` **RESTORED** |
| 15 | Mailing address — city | text | `address_city` |
| 16 | Mailing address — state | text | `address_state` |
| 17 | Mailing address — ZIP | text | `address_zip` |
| 18 | *Optional.* Your own FamilySearch Person ID, if you have one. **We will not research from it** — FamilySearch hides the profiles of living people, so a living person's ID returns nothing. It is only used to link your record to yours. | text | `self_fs_id` — **now OPTIONAL** |

> Q7 branches. `enslaved` → skip §11. `enslaver` / `both` / `unknown` → show §11.
> Q18's demotion is the direct consequence of F2: a seed that returns 1 ancestor should never be a required
> field, and requiring it has been teaching participants that it is the important one.

---

### §3 — Your parents (Parent A, Parent B — 6 fields each, symmetric)

Labelled **Parent A** and **Parent B**, not "Parent 1 / Parent 2", so §4 can name grandparents by parent
rather than asking each grandparent whose child they are (which is what created the Q41/Q47 column slip).

Per parent: `name` · `birth_year` · `birthplace_state` · **`death_year` (leave blank if living)** ·
`fs_id` *(optional — leave blank if living)* · `relationship_to_you` (○ father ○ mother ○ parent).

→ `participant_family` rows `parent_a`, `parent_b`.

---

### §4 — Your grandparents (4 × 5 fields, symmetric)

Explicitly labelled — **"Parent A's father"**, **"Parent A's mother"**, **"Parent B's father"**,
**"Parent B's mother"**. This removes Q41/Q47 entirely.

Per grandparent: `name` · `birth_year` · `birthplace_state` · **`death_year` (blank if living)** ·
`fs_id` *(optional)*.

→ `participant_family` rows `pat_grandfather` / `pat_grandmother` / `mat_grandfather` / `mat_grandmother`.

---

### §5 — Climb anchors (**THE REQUIRED SECTION** — 4 blocks × 6 fields)

> **Form copy:** "This is the part that does the work. FamilySearch hides the profiles of people who are
> still living, so a climb can only start from someone who has died. For each of your four family lines,
> give us the **oldest ancestor you can find on FamilySearch who has a death date**. If your grandparent on
> that line has died, that is them. If they are still living, go one more generation up — to a
> great-grandparent."

Per line (Line A1 = Parent A's father's line, A2 = Parent A's mother's, B1, B2):

| Field | Type | Note |
|---|---|---|
| `anchor_relationship` | text | e.g. "my father's father's mother" |
| `anchor_name` | text | |
| `anchor_birth_year` | number | |
| **`anchor_death_year`** | number | **required — this is what proves they are climbable** |
| `anchor_death_place_state` | text | |
| **`anchor_fs_id`** | text | **required** |
| `anchor_found_how` | ○ in my FamilySearch tree ○ in a record search ○ I could not find one on this line | routes the failures to §6 |

→ new table `participant_climb_anchors` (see Part III). Each row is a climb seed.

---

### §6 — Living-relative details (**conditional** — shown when any §4 grandparent has no death year, or any §5 line answers "I could not find one")

> **Form copy:** "Because this relative is still living, FamilySearch will not show us their profile. But
> public records — census, marriage, obituaries — are open regardless. To find the right person in those
> records and not a stranger with the same name, we need the people around them."

Per living grandparent (up to 4 × 3 fields):

| Field | Type | Consumed by |
|---|---|---|
| `spouse_names` | text — "all spouses, including maiden names" | `public-record-bridge.scoreMatch` **+3 CONFIRMED** |
| `children_names` | text — "all their children, including your parent" | `public-record-bridge.scoreMatch` **+3 CONFIRMED** |
| `residence_places` | text — "towns/counties they have lived in, with rough years" | search narrowing |

> These three fields are the entire difference between a **CONFIRMED** and an unusable bridge result (F3).
> They are the highest-value new questions on the form after §5.

---

### §7 — What your family says (structured — replaces the single Q61 free-text)

| # | Question | Type | → |
|---|---|---|---|
| a | Do you know of any ancestor who was **enslaved**? Name(s), if known. | text | `intake_research_leads.enslaved_ancestor` |
| b | Which family line were they on? | ○ Parent A's father's ○ Parent A's mother's ○ Parent B's father's ○ Parent B's mother's ○ not sure | `lineage_branch` |
| c | Where — state, and county or town if you know it? | text | `target_geography` |
| d | Has your family ever named a **family that enslaved** your ancestors — or a family your ancestors enslaved? Surname(s). | text | `named_entity` — **the McCain field** |
| e | Which line, and where? | text + branch select | `lineage_branch` / `target_geography` |
| f | Any **plantation, farm, church, or place name** carried in your family's stories? | text | place-name lead |
| g | Any **adoption**, informal adoption, or known non-biological link in the chain above — and at which generation? | text | `claim_type='adoption'` — a lineage-validity flag |
| h | Any **surname changes or spelling variants** in the family? | text | identity resolution |
| i | Where did the family live **before** where they live now — state, and roughly when? | text | migration trace |
| j | Anything else we should know. | paragraph | free-text fallback |

> Structuring d/e is the direct upgrade from F8: the parser currently infers surname, branch, and geography
> from prose at confidence 0.5. Captured directly, the lead starts higher and the geography no longer has to
> be corrected after the fact (as it was for McCain — assumed Carroll County MS, actually Union County NC).

---

### §8 — Documents you hold (**NEW** — feeds the kinship gate, F9)

> **Form copy:** "A family tree is a claim. A record is evidence. If you hold any of these — or know which
> courthouse or funeral home has them — they can turn a link in your tree into a documented one. Nothing here
> is required."

| # | Question | Type |
|---|---|---|
| a | Which of these do you have, or know where to get? | ☐ death certificate naming the person's parents ☐ marriage record naming parents ☐ birth or baptism record ☐ will or probate naming heirs ☐ family Bible ☐ obituary or funeral program ☐ land deed ☐ military or pension record ☐ family photographs with names on them ☐ none |
| b | For which ancestor(s)? | text |
| c | Upload anything you're willing to share (optional) | **file upload**, multiple |

→ new table `participant_documents_offered`; uploads route to the S3 + Wayback dual-archive per
[[standard-file-first-document-archival]] and become `person_documents` candidates for the tier-1 kinship
edges the gate currently has zero of.

---

### §9 — Land and place

| # | Question | Type | → column |
|---|---|---|---|
| a | Does your family hold land that was **inherited** rather than bought? | ○ no ○ yes ○ unsure | (gate) |
| b | Roughly how much? | ○ none ○ under 500 acres ○ 500–5,000 ○ over 5,000 ○ unsure | `inherited_land_acres` |
| c | **Which state(s)?** | checkbox: 50 states + DC | `inherited_land_states` **TEXT[] — fixes F5** |
| d | **Which county / counties?** "County, State — one per line." | paragraph | `inherited_land_counties` **NEW — the slave-schedule join key** |
| e | What is it used for? | ☐ timber ☐ mineral rights ☐ agricultural ☐ ranching ☐ residential ☐ commercial development ☐ heir property (undivided) ☐ other | `inherited_land_use` **TEXT[]** |
| f | **How long has the family held it?** | ○ before 1865 ○ 1865–1900 ○ 1900–1950 ○ after 1950 ○ unsure | `land_held_since` **NEW — continuity-of-holding, the project's core concept** |

> c/d/e were one unparseable question (Q22). Split, they populate the three columns M037 built and never
> received. (f) is new and is the single strongest land-side signal, mirroring the Massena parcel spine.
> **Guardrail:** per migration 125 + the land non-claim directive, land VALUES wealth and never creates a
> descendant land claim — no copy on this form should imply otherwise.

---

### §10 — Institutions

| # | Question | Type | → column |
|---|---|---|---|
| a | Documented ownership, inheritance, board seat, or long employment with any of these companies or their predecessors? | *(keep the existing checklist)* | `corporate_connections` **TEXT[]** |
| b | **If yes — what is the nature of the connection?** ○ no connection ○ I am or was an **employee or shareholder** ○ my family's **wealth traces** to one of these ○ my family **owns or controls** one | single choice | `corporate_connection_type` — **the missing multiplier (F4)** |
| c | Describe it briefly. | text | `corporate_connection_details` **NEW** |
| d | Has any branch of your family held executive or board positions across more than one generation — banking, insurance, railroads, tobacco, textiles, shipping, sugar or cotton trading? | ○ no ○ yes ○ unsure | `executive_board_history` |
| e | Does any business, plantation, land holding, or enterprise that **predates 1865** still exist in your family line today? | ○ no ○ yes ○ unsure | `pre_1865_business_continuity` |
| f | **If yes — describe it.** | text | `pre_1865_business_details` **NEW — column exists, never asked** |
| g | **Which universities, churches, hospitals, insurers, or employers has your family been tied to across two or more generations?** | paragraph | `institutional_affiliations` **NEW → [[plan-modern-endpoints-program]]** |

> (b) is the highest-leverage single addition on the financial side: it is a documented 1.0×→2.0× multiplier
> that currently has no way to be anything but 1.0×.
> (g) is how a Bard- or Amherst-shaped modern endpoint arrives from intake rather than from a manual DB hunt.

---

### §11 — Financial (**conditional** — shown only when §2 Q7 ≠ "descendant of enslaved people")

Keep the existing "Why we ask this" preamble; keep the questions and their columns as-is:

`annual_income` · `estimated_net_worth` · `real_estate_equity` · `inheritance_received` ·
`inheritance_expected` · `tax_filing_status` · `num_dependents` · `trust_beneficiary` · `trust_corpus` ·
`family_business_ownership` · `family_business_details`.

Two changes only:
- **Gate the section on Q7** (F7) — an enslaved descendant should never be asked to disclose income to
  receive a document computing what they are owed.
- Make `estimated_net_worth` and `real_estate_equity` **optional** with "enter 0 or leave blank if unknown."
  They are inputs to a reconciled estimate, not to an audited figure, and requiring them costs completions.

---

### §12 — Certification

| # | Question | Type | → column |
|---|---|---|---|
| a | I have checked that the parent-child links between me and the ancestors I named above are the ones I believe to be correct, and I understand you will verify them against records rather than take them as given. | Yes / No | `tree_verified` *(reframed — see F9)* |
| b | Are all four lines connected to you without gaps, as far as you know? | ○ yes ○ no — there are gaps | `chain_complete` |
| c | Describe any gaps. | paragraph | `chain_gaps` |
| d | I certify that the information here is accurate to the best of my knowledge, and that the FamilySearch IDs correspond to my actual biological or legally-recognized ancestors. | Yes / No | `certify_accurate` |

---

## PART III — WHAT MUST CHANGE IN CODE

Ordered. Nothing below is optional if the new form is to land.

1. **`src/api/routes/intake.js` — replace `FORM_COLUMNS` wholesale** against the new sheet, and replace the
   fixed 5-column family block with an explicit per-field index map. The block assumption is what broke
   (F1); do not reintroduce it.
2. **`DAAOrchestrator.js:1885` — `net_worth` → `estimated_net_worth`.** One word. Until it lands, no
   financial answer reaches the calculator merge path (F12).
3. **Map the five orphan M037 columns** in the webhook: `corporate_connection_type`,
   `corporate_connection_details`, `pre_1865_business_details`, `inherited_land_states`,
   `inherited_land_use`.
4. **New migration** (next free number — note the 113/121/122/126 collisions):
   - `participant_climb_anchors` — `participant_id`, `line` (a1/a2/b1/b2), `relationship_label`, `name`,
     `birth_year`, `death_year NOT NULL`, `death_place_state`, `fs_id NOT NULL`, `found_how`,
     `climb_session_id`, `status`.
   - `participant_living_relatives` — `participant_id`, `relative_relationship`, `spouse_names TEXT[]`,
     `children_names TEXT[]`, `residence_places TEXT[]`. Read directly by `public-record-bridge.mjs`.
   - `participant_documents_offered` — `participant_id`, `doc_type`, `for_ancestor`, `upload_url`, `s3_key`,
     `person_document_id`, `status`.
   - `participants` adds: `descendant_class`, `other_names_used`, `birthplace_city`, `birthplace_state`,
     `daa_publication_scope`, `consent_public_records`, `consent_null_logging`, `consent_contact`,
     `inherited_land_counties TEXT[]`, `land_held_since`, `institutional_affiliations`.
5. **`public-record-bridge.mjs` — read `participant_living_relatives` instead of the hardcoded
   `GRANDPARENTS` array.** Keep the 20–34s politeness gap and the STOP-on-CAPTCHA rule
   ([[feedback_one_fs_scraper_at_a_time]] still applies: one FS scraper at a time).
6. **`parse-intake-oral-history.mjs` — read the structured §7 fields first**, falling back to prose parsing
   for (j). Raise the confidence floor above 0.5 when branch + entity + geography are captured directly
   rather than inferred.
7. **`scripts/validate-intake-form.js` — delete `COLUMN_MAP` and import the webhook's map**, or delete the
   CSV path outright. Two divergent orders is how this drifted (F1). Keep the hardened validators
   (placeholder-FS rejection, garbage-name phrase detection, impossible-generation gap blocking) and extend
   them to require `death_year < current_year` on every §5 anchor.
8. **Fan the DAA out over anchors.** `ensureClimbComplete` takes one seed and one session. With four
   required anchors, either seed four climbs and union the matches into the DAA, or record explicitly which
   line the DAA covers. Until this exists, three of four anchors are collected and unused — the same failure
   the current form has with grandparents, moved up a generation.

---

## PART IV — IF ONLY FIVE THINGS CHANGE

In descending order of demonstrated effect:

1. **Fix the column map** (F1). Everything else is downstream of ingestion working at all.
2. **Add §5 climb anchors — deceased ancestor per line, death year required** (F2). 1 ancestor → 829.
3. **Add §6 spouse + children for living grandparents** (F3). The CONFIRMED/CANDIDATE threshold.
4. **Add the `corporate_connection_type` question** (F4) and fix `net_worth` (F12). A live multiplier that
   cannot currently be anything but 1.0×.
5. **Gate the financial section on descendant class** (F7). Stops asking enslaved descendants to disclose
   income to be told what they are owed.
