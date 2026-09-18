# STANDARD — The Obligation Ledger (the obligation is an ACCOUNT, not an estimate)

_Authoritative project standard. Drafted 2026-08-09 from the user's directive: "what's important I feel is
the ledger and that is probably the most under theorized, under researched, and under developed aspect of
this elaborate codebase that yearns to connect with the present."_

_This file gives a home to the doctrine that has been correct and homeless since 2026-07-02, when it was
recorded inside a plan document about a `person_type` enum: **reparations is a directed VECTOR BETWEEN
PARTIES, it begins with the act of enslavement, and credit never nets against debit**
([[plan-96-person-status-model]] §"Decision 3"). That is the ledger theory. It belongs here._

_Companions: [[wealth-tracing-framework]] (how wealth is traced forward) · [[plan-descent-first-lineage]]
(who the parties are) · [[plan-modern-endpoints-program]] (where the chain terminates) ·
[[standard-canonical-person-and-document-gate]] (who may be named) ·
[[finding-land-nonclaim-and-dutchess-audit-jul17]] (what land may do) ·
[[plan-apr29-will-source-registry-dual-ledger-daa]] (the dual-ledger DAA this ledger backs)._

---

## 1 · The distinction this standard exists to enforce

The project currently computes an **estimate**. `enslaver_lineage_ledger` holds a per-lineage figure
recomputed from three predictors (Craemer labor-value, SCF wealth-gap, traced disgorgement) and reconciled
by `ObligationReconciler`. Recompute it tomorrow with better data and yesterday's figure is gone.

An estimate is an opinion. **A ledger is an account**: entries, in order, each dated and cited, producing a
running balance that can be audited backward entry by entry. The user's framing — *"harm values were
created and have been collecting interest"* — is not satisfiable by an estimate. Interest accrues on a
balance. There is no balance today.

**The rule:** every obligation this project asserts is an ACCOUNT with a monotonic, append-only entry
history. The reconciled predictors do not disappear — they become the **origination methodology** for the
opening entry, cited as such. Everything after is posted, never recomputed.

---

## 1.5 · The regime generalization — this instrument is not slavery-specific

_Added 2026-08-09, user directive: "lineage accounting reparations is not just about slavery… Dole in
Hawai'i… my own family owned a silver mine in Mexico… rampant abuse of Black sharecroppers in the south…
contemporary slavery in prisons."_ Correct, and consistent with [[feedback_think_globally]] — this is
global accountability infrastructure, not one use case.

**The account structure is regime-agnostic. The valuation is regime-specific. Do not confuse the two.**

### 1.5.1 The four predicates (the whole guardrail)

A directed obligation is admissible to this ledger only where **all four** hold and each is documented:

1. **Identified extractor.** A nameable party — person, firm, chartered company, sovereign, multilateral —
   not a class, an era, or a system.
2. **Coerced counterparty.** Value taken from identified people, or from their land, under a legal regime
   that made the taking lawful *and* the extracted party unable to refuse. The legality is the point: it is
   what distinguishes this from ordinary theft and what makes the record exist at all.
3. **Persistence.** The value continued forward into identifiable present hands — a person, an institution,
   a parcel, a fund, a treasury.
4. **No return.** No share ever went back to the extracted class. (Where some did, it is a
   `satisfaction` or `offset_adjudicated` entry, not a reason to exclude the account.)

### 1.5.2 The fifth discipline — an account requires an origination entry

**A regime enters the ledger only when it can produce a priced, dated, documented `origination` entry.**

Not because unpriced harm is smaller. Because an account that cannot post an opening entry is not an
account, and a ledger that admits them becomes the thing that produced **Lloyd's $1.8 quadrillion** (Phase
17, gated behind Issue #7). "Extraction" without predicates expands to everything; the predicates plus this
rule are the only things holding the instrument to a size a reader will believe.

A regime that fails this test is not rejected — it is **registered as a candidate** (§8.3) with the
acquisition named. That is the honest state, and it is the same state
[[plan-descent-first-lineage]] uses for a stalled line.

### 1.5.3 Per-regime valuation is MANDATORY and never transferred

Craemer is a US-chattel-slavery labor-value formula. It does not travel to Hawaiian plantation contract
labor, Mexican *enganche* peonage, or convict leasing, and applying it there would violate CLAUDE.md audit
rule 4 as surely as re-introducing the phantom 2.5× multiplier.

**Every regime registers its own methodology in `estimation_methodology_registry` (M060) with its own
citations, assumptions, and known failure modes, before its first entry posts.** Cross-regime constant
reuse is a defect. The ledger holds the account; M060 holds the arithmetic.

### 1.5.4 Counterparty structures differ by regime — the schema must carry all of them

| Regime shape | Debtor | Payee class | Already modeled? |
|---|---|---|---|
| Chattel slavery (US) | person → heir → institution | documented descendants | ✅ the built path |
| Chartered-company trade | company → sovereign fold-in | polity and/or descendants | ✅ `chartered_companies` (M082), `sovereign_debt_fold_in_pathway` |
| Settler dispossession (Hawai'i, Dutchess) | state / successor firm | **a nation**, not a descendant set | ⚠️ `indigenous_land_provenance` (M125) covers origin, not claim |
| Debt peonage / sharecropping | firm or landowner | worker line, often continuous into living memory | ❌ |
| Carceral labor | **a state**, ongoing | living people | ❌ — and §5 (living people are parties, never rows) binds hard |
| Structural-financial | multilateral | sovereign borrower | ⚠️ `perpetrating_multilateral` (M087) exists, see defect below |

**The consequence for the vector rule (§2.1): multi-regime makes dual position the NORMAL case, not the
Ellison edge case.** A family may sit on the credit side of one regime and the debit side of another —
the user's own case: a Mexican silver-mine holding on one side, other positions elsewhere. Separate
accounts, separate counterparties, **never netted**. §2.1 was written for a rare person; it now governs
routinely.

### 1.5.5 The archive of the harm is often itself an account

The *tienda de raya* ledger, the annual sharecropping settlement, the convict-lease receipt in a state
auditor's report, the plantation hire-out book — these are double-entry accounts, kept contemporaneously,
running the wrong direction. They are the same instrument this standard specifies, operated as a weapon.

Two consequences: they are the **highest-quality training data that exists** for Head B of
[[prompt-economics-llm-system]] (forward labor extraction), which is currently unbuilt; and an origination
entry sourced from one of them is unusually strong evidence, because the perpetrator did the accounting.

### 1.5.6 What is ALREADY built for this — and the two defects blocking it

Session 60 (2026-05-23/24, 7 migrations, applied to Neon) scaffolded almost exactly this generalization and
it has been **starved, not missing**:

- `reparations_harm_categories` (M070) + neocolonial extension (M087, `perpetrating_multilateral`,
  `extraction_mechanism`) · `harm_perpetrator_entities` (M071) · `reparations_line_items` (M072) ·
  `chartered_companies` (M082) · `african_polities` (M083 — a **both-ways** ledger; harm party AND/OR
  receiving party, defaults FALSE/FALSE, contributor must affirmatively assert) · `provenance_evidence`
  (M084, polymorphic) · `entity_successions` (M085) · `actor_roles` (M086) · `wealth_transfer_events` (M088).

**DEFECT 1 — ✅ FIXED, migration 136, applied to Neon 2026-08-09.** M087's COMMENT documented
`'neocolonial'` as an accepted `era` value, but **M087 never altered the M070 CHECK constraint.** Verified
live before the fix, verbatim:

```
reparations_harm_categories_era_check ::
  CHECK ((era = ANY (ARRAY['antebellum','reconstruction','jim_crow','modern'])))
```

Every neocolonial harm category the migration was written for — Haiti double debt, CFA franc seigniorage,
IMF SAPs, tariff escalation, vulture litigation — **was rejected on insert.** That is why the extension
never populated: not a research gap, a missing `ALTER`. Migration 136 adds the value; constraint now
carries `'neocolonial'`.

**DEFECT 2 — groundwork laid, migration 136; the model change is still open.** The `era` vocabulary is
US-periodized and cannot hold the Hawaiian Kingdom overthrow, the Porfiriato, or the Mandate period. M136
creates **`extraction_regimes`** (the four predicates as evidenced booleans → `provenance_evidence` M084;
mandatory `valuation_methodology_id` → M060; `origination_entry_available`; `status
candidate|admitted|rejected`) and adds nullable `regime_key` / `jurisdiction` / `legality_instrument` to
`reparations_harm_categories`. **Deliberately no FK yet and no seeds** — `extraction_regimes` is empty by
design because regimes are nominated through the contribute pipeline (DEFECT 3), and an FK to an empty
table would block. Add the FK once the pipe lands. `era` is now commented as a US display label; do not add
further era strings.

**DEFECT 3 (process, already correct — preserve it).** Per the Session-60 rule and
[[feedback_no_hardcoded_perpetrator_seeds]]: rows for all of these tables enter via the contribute
pipeline, **never** a hardcoded seed script. Schema migrations are fine; INSERTs are not. A new regime is
nominated and evidenced, not declared in code. Extending `/promote/:leadId` with a `target_table`
discriminator is the unbuilt pipe — it has been the named next step since May.

---

## 2 · Non-negotiables

### 2.1 The vector rule (inherited, non-negotiable, verified in code 2026-07-02)

An obligation is a **directed edge between two parties**, originating in a specific documented act.

- **CREDIT** (owed TO, as enslaved) and **DEBIT** (owed BY, as enslaver) are different obligations with
  different counterparties and different origin-acts. A person may hold both (William Ellison).
- **They are NEVER summed into a per-person net.** Reparations is not a scalar, not karma, not a credit
  score. A person enslaved in 1790 and enslaving in 1830 has two accounts, in two directions, to two
  different sets of people.
- The 2026-07-02 audit verified the current code honors this by table separation (`reparations_line_items`
  = credit side; `enslaver_lineage_ledger` = debit side; nothing joins them; repo-wide grep for
  credit−debit subtraction = 0). **The ledger must not break it.** No `balance` column may ever be
  computed across both directions for one party.

### 2.2 Append-only

Entries are **never updated and never deleted.** A wrong entry is corrected by a `correction` entry that
references it and posts the offsetting amount. This mirrors `enslaver_evidence_compendium` (M053: "No row
may be retracted; corrections are new rows") and it is what makes the account auditable in the sense
CLAUDE.md's audit rules require. An UPDATE on a posted entry is a defect, enforced by trigger.

### 2.3 Every entry carries a row, a document, and a methodology

Per CLAUDE.md audit rule 1 (the model orchestrates, deterministic code computes) and rule 2 (every external
claim has provenance): an entry requires `source_document_id` **or** an explicit
`research_findings` reference recording why no document exists. **RAG and LLM inference may never post an
entry** — they may surface a candidate for a human, exactly as they may not feed a DAA number
([[reckoning-retrieval-epistemology-and-workaround-debt]] "BOUNDARY").

### 2.4 Claims are NON-TRANSFERABLE (new rule, adopt before any register exists)

**A recorded claim may be inherited. It may never be assigned, sold, pledged, factored, or used as
collateral.**

The mechanism that made slavery financeable was that a claim on a person was a *transferable, pledgeable
instrument* — a deed, a mortgage, a policy, a bond. That is how the value entered capital markets and how
it survived the death of every individual enslaver. A fungible reparations claim reconstructs that
structure at one remove: someone offers descendants ten cents on the dollar and a secondary market in Black
claims exists again.

This is the same category of decision as the land non-claim
([[finding-land-nonclaim-and-dutchess-audit-jul17]]), and it must be handled the same way: **a guardrail in
code, written before the temptation is wired in, not a footnote after.** The land guardrail was adopted
with only a `disgorgement: {usd:0}` stub standing between the calculator and a live claim on Muscogee and
Wampanoag land. Adopt this one while the register is still a design.

Consequence for any future public register (see §7): entries are addressed to a **party identity**, not to
a bearer. No token, no assignment field, no transfer entry type.

### 2.4b `principal_basis` — an account structure does not launder an estimate

**The trap this standard would otherwise walk into:** you can build a perfect append-only ledger and post
one `origination` entry per lineage whose amount is the same coarsely-quantized model output the project
has today. The result is a structure that is honest about being append-only and dishonest about being
evidenced — an estimate wearing the authority of a ledger. That is worse than the estimate, because the
estimate does not claim to be an account.

**Measured, live 2026-08-09 — the problem being solved:**

| | rows | distinct dollar values |
|---|---|---|
| `reparations_line_items` (the modeled layer) | **1,970,245** | **86** |
| — `wage_theft_craemer_2015` | 1,880,839 | 85 ($3.71M–$55.71M) |
| — `freedmans_bank_direct_loss` | 89,406 | **1** ($47,501.29 for every one of 89,406 people) |
| `chattel_transfer_events` (documented transactions) | 48,985 | **1,486** |

Forty times fewer rows, seventeen times more distinct values — because they are real dated prices on real
people rather than a formula applied to a category. That contrast is the whole argument.

**The rule:** every `origination` entry carries

```
principal_basis   'transaction_documented' | 'modeled'
```

- **`transaction_documented`** — the amount comes from a dated, priced instrument about *this* person or
  estate: a `chattel_transfer_events` row, a probate appraisal, an LBS £ award, a civilwardc claimed/awarded
  figure, an insurance policy face value, an estate inventory line.
- **`modeled`** — the amount comes from a category-level methodology (Craemer, SCF wealth-gap, a line-item
  formula). Legitimate, cited, and **never silently equivalent to the above.**

**`obligation_balances` must never merge them into one number.** It reports
`principal_documented_usd` and `principal_modeled_usd` as separate columns, always. This is the
[[plan-apr29-will-source-registry-dual-ledger-daa]] §4 dual-ledger discipline — documented and estimated,
surfaced separately, never collapsed — applied at the *entry* level, where it has never been applied. A DAA
already refuses to collapse them; the obligation figure never learned the same lesson.

**Coverage today (measured):** all **48,985** `chattel_transfer_events` are both priced and linked to a
`to_enslaver_id`, across **18,180 distinct enslavers**. So ~18,180 accounts could open on
`transaction_documented` principal *today*, against 34,431 assertable enslaver canonicals and 248,926 rows
of purely modeled `enslaver_lineage_ledger`. That is the migration path: **open documented where the corpus
supports it, open modeled where it does not, and never let the balance blur the two.**

### 2.5 Land satisfies nothing until the doctrine says how

`land_transfer_events` VALUES the debt; it never creates a descendant land claim, and land value is split
into `native_land_restitution_usd` (owed separately to the Native successor nation) before
`descendant_claimable_usd` is computed. That is settled for the **accrual** side.

It is **not** settled for the **satisfaction** side, and §8.2 is the case that forces it. Until §8.2 is
worked and the user rules: **a conveyance of land may be POSTED as a satisfaction entry with
`asset_kind='land'` and a stated appraised value, but the entry is flagged
`doctrine_open='land_as_satisfaction'` and does not reduce the balance.** Fail toward non-reduction.

---

## 3 · Entry types (the controlled vocabulary)

| `entry_type` | Direction | What it records | Evidence required |
|---|---|---|---|
| `origination` | opens the account | the documented act — a holding, a priced transfer, a compensation award received | proposition-specific document (RULE 0.6 grade) |
| `accrual` | increases | interest/compounding for a stated period at a stated rate | cited rate series (`RateResolver` anchor family, never a bare constant) |
| `succession` | transfers liability | account moves predecessor → successor (heir, merged firm, institution) | will/probate/deed/merger instrument + `entity_successions` or `inheritance_edges` row |
| `satisfaction` | decreases | value that actually reached the documented claimant class | the conveyance instrument + a `reached_class` determination (§4) |
| `offset_claimed` | **records, does not decrease** | a payer's assertion that something counts as repair | the payer's own disclosure |
| `offset_adjudicated` | may decrease | a claimed offset accepted, in whole or part, after §4 test | the adjudication + its reasoning |
| `correction` | either | fixes a prior entry; references it by id | whatever the correction rests on |

`offset_claimed` and `offset_adjudicated` are deliberately two entries. **A payer's claim that they have
repaired something is itself a fact worth recording, and it is not the same fact as repair.** Collapsing
them is how "we gave $100M" becomes "we paid."

---

## 4 · The reached-class test (the column that does the work)

Every `satisfaction` and `offset_*` entry carries:

```
recipient_kind    documented_claimant | descendant_organization | proxy_population | general_public | payer_controlled_fund
reached_class     yes | partial | no | undetermined
documented_claimants_identified   int | null     -- were they found?
documented_claimants_receiving    int | null     -- did they receive?
```

**Default is `no`.** An entry only earns `yes` when value reached parties this project can name as members
of the documented claimant class. A fund the payer controls has not paid; it has budgeted.

This is what the three-column artifact reduces to — **obligation / pledged / reached**. It is BUILT:
`scripts/report-obligation-reached-class.mjs` (read-only; run it, don't re-derive it).

**MEASURED against the live DB, 2026-08-09 — all 17 `corporate_slavery_disclosures`:**

| | count |
|---|---|
| disclosures | **17** |
| …with a PRICED origination value | **2** (Georgetown $115,000 · Amherst $800) |
| …with an enslaved COUNT | 7 |
| …able to open an account at all (§1.5.2) | **7 — ten cannot** |
| …with ANY remediation recorded | **2** |
| …`reached_class = 'no'` (nothing moved) | **15** |
| …awaiting human adjudication | 2 |
| …unmatched to `corporate_entities` | 13 (no FK exists; the tables join on a denormalized name) |

The two that moved anything:

| Payer | Documented origin | Pledged / moved | Recipient | reached_class |
|---|---|---|---|---|
| **Georgetown / MD Jesuits** | 1838 sale of **272** people for **$115,000**, all 272 named on the articles | $100M pledged (2021) toward $1B; +$27M (2023) | **DTRF — descendant-governed** | `undetermined` → adjudicate. The only descendant-*governed* recipient in the corpus. |
| **JPMorgan Chase** | **13,000** enslaved as loan collateral, **1,250 directly owned** (Citizens Bank of LA, Canal Bank of LA, 1831–65) | **$5M** Smart Start Louisiana scholarship (2005) | Black Louisiana students — **a proxy population, not the documented 1,250** | `undetermined` → adjudicate; expect `no` |

**JPMorgan is now the sharpest row in the set, and it displaced the Brown example.** 13,000 people
pledged as collateral, 1,250 directly owned, names list present — answered with a $5M scholarship for a
population defined by race and state rather than by descent from the documented 1,250. That is an
accounting fact, not an accusation, and it is the most legible thing this project can produce for a reader
who has never accepted the premise.

The other thirteen — BNY Mellon, Santander, Bank of America, Citizens, Fulton, PNC, TD, U.S. Bancorp,
United Bank of Philadelphia, Wells Fargo (all Philadelphia Ordinance 2024 filings), plus CVS/Aetna (28),
Chubb/ACE (1), Corebridge/AIG (173), New York Life (485) — recorded **nothing**. Ten of them cannot even
open an account: the disclosure is a filing with no priced origin and no count.

**Philanthropy is `offset_claimed` by default.** It becomes `offset_adjudicated` only by passing this test.

**The script never decides the test.** Per audit rule 1, `report-obligation-reached-class.mjs` computes
only what is structurally derivable — *nothing recorded moved* → `no`. Anything a payer describes in prose
routes to a human as `undetermined` + `adjudication_required`. Deterministic code computes; a person
adjudicates; the model does neither.

---

## 5 · Parties

- **Historical persons** are `canonical_persons`, subject to RULE 0.6 and the identity gate. An account may
  not name a person as debtor on a `name_only_match` (the 2026-08-07 gate; `climb_match_type` is judged,
  not the re-stamp).
- **Institutions** are `corporate_entities`, linked by `entity_successions`.
- **Living people are parties to entries, never person rows.** A living donor or recipient is recorded as a
  party reference plus the instrument that names them; they are not minted, and PII stays in the
  `scripts/pii/` lane ([[feedback_protect_participant_pii_from_model]] — standing directive). A public,
  self-published reparative act (a recorded deed, a press account) is a public fact about a transaction; it
  is not license to build a person record.
- **A claimant class may be open.** `payee_class='documented_pending'` is a legitimate, honest account
  state: the debit is documented, the counterparty is not yet identified. This is the normal state for most
  Southern lineages and must not be treated as an error.

---

## 6 · Schema — ✅ APPLIED, migration 137, Neon, 2026-08-09

_Verified by a 21-assertion suite run inside a transaction that rolled back: **21 passed, 0 failed, 0 rows
persisted to production.** Proven live — the append-only trigger rejects both UPDATE and DELETE; an
`origination` without `principal_basis` is rejected; an `accrual` without `rate_basis` is rejected; a
`satisfaction` without `reached_class` is rejected; `reached_class='yes'` without a receiving count is
rejected; **there is no `assignment` entry type and inserting one is rejected** (§2.4); `offset_claimed`
and `doctrine_open` land satisfaction both post without reducing `balance_usd`; and
`principal_documented_usd` / `principal_modeled_usd` come out of the view as separate columns._



Reuse before adding. `enslaver_lineage_ledger`, `reparations_line_items`, `inheritance_edges`,
`entity_successions`, `corporate_slavery_disclosures`, `research_findings` all carry payload. What is
missing is the **account** and its **entries**.

```
obligation_accounts
  id, direction ('credit'|'debit')            -- NEVER both for one party in one account
  origin_act_kind, origin_year, origin_document_id
  debtor_party_table, debtor_party_id         -- canonical_persons | corporate_entities
  payee_party_table, payee_party_id           -- nullable
  payee_class ('documented_claimant'|'documented_pending'|'native_nation'|'unresolved')
  methodology_id                              -- FK estimation_methodology_registry (M060)
  status ('open'|'succeeded'|'satisfied'|'suspended')
  opened_at, closed_at, notes

obligation_entries                            -- APPEND-ONLY (trigger blocks UPDATE/DELETE)
  id, account_id, entry_type, entry_seq
  effective_date, amount_usd, currency_year
  principal_basis                             -- origination only: 'transaction_documented'|'modeled' (§2.4b)
  rate_basis, rate_anchor_id                  -- accrual only; cited series, never a bare constant
  counterparty_table, counterparty_id         -- succession only
  asset_kind ('cash'|'land'|'securities'|'in_kind'|'programmatic')
  recipient_kind, reached_class,
  documented_claimants_identified, documented_claimants_receiving
  source_document_id, research_finding_id, methodology_id
  doctrine_open                               -- e.g. 'land_as_satisfaction'
  corrects_entry_id, produced_by, created_at

obligation_balances                           -- VIEW, never a table
  account_id, as_of,
  principal_documented_usd, principal_modeled_usd,   -- §2.4b: NEVER summed into one column
  accrued_usd, satisfied_usd, balance_usd,
  entry_count, last_entry_id, unadjudicated_offsets_usd, doctrine_open_flags
```

**`obligation_balances` is a view.** A materialized balance is a number someone can edit; a derived balance
is a number someone must re-derive from entries. That is the entire point.

### Invariants for `project-health-monitor.mjs` (RULE 0.7 — free, deterministic)

1. `obligation_entries` UPDATE/DELETE count > 0 → **CRITICAL** (append-only violated).
2. Any entry lacking both `source_document_id` and `research_finding_id` → **CRITICAL**.
3. Any account with `direction='credit'` and `direction='debit'` entries → **CRITICAL** (vector violated).
4. Any `accrual` with a `rate_basis` not resolving to a cited anchor → **CRITICAL** (audit rule 4).
5. Any `satisfaction` with `reached_class='yes'` and `documented_claimants_receiving IS NULL` → **CRITICAL**.
6. `doctrine_open` entries reducing a balance → **CRITICAL**.
7. `offset_claimed` older than 180 days with no adjudication → WARNING (the backlog is a finding).
8. Any `origination` with a NULL `principal_basis`, or any view/report/DAA surface that sums
   `principal_documented_usd` and `principal_modeled_usd` into a single figure → **CRITICAL** (§2.4b).
   This is the invariant that stops the ledger from laundering an estimate.
9. Corpus-drift watch (WARNING, not a gate): ratio of `origination` entries with
   `principal_basis='transaction_documented'` to total. If it falls while account count rises, the ledger
   is growing by modelling rather than by documenting — the exact failure this standard exists to prevent.

---

## 7 · The register (design posture, nothing built)

If the account history is ever published, the requirement is **append-only, publicly verifiable, no single
deleter** — not payments, not tokens.

Order of construction: (1) content-address each entry and maintain a signed, append-only log with published
inclusion proofs (Certificate-Transparency / Sigstore shape); (2) publish verification independently of this
project's servers; (3) **optionally, later**, anchor the log's periodic Merkle root on-chain. Step 3 buys
"no single party can rewrite history" against a hostile operator; steps 1–2 buy nearly all of it at a
fraction of the complexity, and — decisively, given that the project's binding problem is epistemic
illegibility — without requiring a reader to hold a wallet to see a citation.

**§2.4 binds the register absolutely.** No bearer instruments, no assignment, no transfer entry type, no
token. The dormant Base `ReparationsEscrow` is a settlement rail for an already-adjudicated payment; it is
not the register and must not become it.

---

## 8 · The two case studies (build both; neither alone is end-to-end)

The instrument has an accrual half and a satisfaction half. The corpus contains one strong candidate for
each, and they are complementary rather than redundant.

### 8.1 ACCRUAL — Bard College / the Massena parcel (in hand)

The only complete forward chain the project holds. Samuel Bard → canonical #907115 (1800 census, 7 enslaved,
Dutchess/Clinton) and William Bard → #907116 (1810, 4), both image-backed, RAG-embedded, assertable, kinship
edge #8114 verified at tier 2. Land = the Massena chain, migration 129: **15 links, 1688 → 2024**, all
`implicates_enslaver=FALSE`, with a real consideration series — **$50,000 (1853) → $20,000 foreclosure
(1858) → $1,150,000 (1974) → ~$14,000,000 (2024)** — terminating at Bard College.

Exercises: `origination`, `accrual`, `succession` (person → heir → institution), land-as-valuation,
Link 0 (Muhheaconneok/Munsee; the 1688 Schuyler Patent recites *"Purchased of and from the Indyans,
Naturall Owners & Possessors"*), and `payee_class='documented_pending'` — Bard has no named enslaved roster
and no wills ingested yet (Samuel's 1821 and William's 1858 are the flagged NEXT).

It posts a balance and satisfies nothing. That is the point of pairing it.

### 8.2 SATISFACTION — Amelia County, VA / Walker → Central Virginia Agrarian Commons (candidate, 2022)

**Recommended, and for reasons that are not the obvious ones.**

The facts, as reported (Next City, Barry Greene Jr., 2024-11-01 — a **secondary** source; the deed is the
primary and is recordable in Amelia County): Callie and Dan Walker signed a **deed of gift** in September
2022, drafted by Agrarian Trust, conveying **80 acres** in Amelia County, Virginia to the Central Virginia
Agrarian Commons, retaining 20 acres including their home. They named it reparations explicitly. The parcel
**carried a plantation house until the 1960s**, when Callie's father bought the property and dismantled it.
Amelia County, 1790: **11,790 enslaved people, 62% of the county population** (ICPSR). The Walkers are
working with the local NAACP to find descendants of the people enslaved on that plantation — *"We've found
plenty of descendants, but so far, no farmers."*

**Why it is the right satisfaction case:**

1. **It is the only completed conveyance available.** Every institutional endpoint in the corpus offers a
   *pledge to a payer-controlled fund* or nothing at all. Amelia offers a recorded deed transferring a real
   asset. If the ledger cannot post this, it cannot post a satisfaction entry at all.
2. **It is the honest test of §4, and it will return an uncomfortable, correct answer.** The recipient is a
   regional nonprofit serving Black farmers — `recipient_kind='descendant_organization'`,
   `reached_class='partial'` at best, with `documented_claimants_identified > 0` and
   `documented_claimants_receiving = 0`. The donors *did* the descendant search and the gap persisted
   anyway. That is a far sharper finding than Brown's proxy grant, because it cannot be read as
   indifference. It is structural, and structure is what this project is for.
3. **It forces §2.5.** A reparative act rendered *in land*, in Nottoway/Appamattuck territory, collides
   head-on with the land non-claim principle. The doctrine currently says land values the debt and never
   claims it — and says nothing about land as remedy. This case makes the project answer a question it has
   so far been able to defer.
4. **The valuation is honest-sized.** 80 acres, ~50 years beef cattle, a 30-year pine crop harvested 2016,
   ~30 acres hardwood. A real, appraisable, county-scale number. Set against Lloyd's **$1.8 quadrillion**
   (Phase 17, gated behind Issue #7), it is the demonstration that **persuasive power runs inversely to the
   size of the number.**
5. **It exercises the identity gate honestly.** Callie *suspects* enslaver ancestry and has not researched
   it. That is a live, unproven proposition — precisely the `pending` / `lineageUnproven` path built on
   2026-08-07 — and its resolution is either a documented descent line or a first-class null in
   `research_findings`.
6. **It introduces a document class the corpus lacks: an instrument evidencing REPAIR.** Every document in
   `person_documents` today evidences harm. A deed of gift is the first of its kind and needs a slot.

**Where it is weak — state this before building:**

- **No enslaved-side roster.** 11,790 is a count, not names. Amelia County probate, deeds, and the parcel's
  own chain of title must be pulled before the credit side has a counterparty. Virginia Untold (40,925
  freed-person leads, LVA, already ingested) covers manumissions and free registers — not this plantation's
  roster. This is an **acquisition** gap, not a code gap, and it is the same 1870-corridor gap
  [[plan-descent-first-lineage]] §5 names as the highest-leverage acquisition in the project.
- **Living, named parties.** Both donors and the recipient organization's chair are living and publicly
  identified. §5 governs: parties to entries, never person rows, no PII into model context. The public
  reporting is not consent to be catalogued.
- **It runs the chain backward.** Continuity-of-holding says wealth persisted into present hands; here the
  present holder divested. So it exercises little successor machinery. That is exactly why it must be
  *paired* with 8.1 rather than substituted for it.

**Prerequisite before any entry is posted:** obtain the recorded deed from the Amelia County Circuit Court
land records (the reported article is secondary; `max_evidence_tier='secondary'` until the instrument is in
hand), dual-archive per rule 8, and log the descendant-search status to `research_findings` — including,
explicitly, the null: *descendants identified, none receiving.*

---

## 8.3 · Candidate regime register (nominations, not admissions)

Every row below is a **candidate**, tested against §1.5.1's four predicates and §1.5.2's origination-entry
requirement. A candidate becomes an account only through the contribute pipeline with evidence
(§1.5.6 DEFECT 3). **Nothing here is asserted; this is a research agenda with verdicts.**

| Candidate regime | Predicates 1–4 | Origination entry available? | Verdict |
|---|---|---|---|
| **US chattel slavery** | all four, maximally | ✅ priced transfers, probate appraisals, compensation awards, LBS £ awards | **ADMITTED** — the built path |
| **Sharecropping / tenancy, US South** | all four; **continuous with the above** | ✅ annual settlement books, Freedmen's Bureau labor contracts, the Phillips/Glunt Reconstruction memorandum book (1864–69) already in corpus | **HIGHEST PRIORITY.** Not an analogy — the *same account continuing under a new instrument*. This is Head B, scoped and unbuilt. Build first. |
| **Convict leasing → carceral labor** | all four; the enabling law is the **13th Amendment §1 exception**, i.e. the legality predicate is explicit in constitutional text | ✅ state auditor reports price leased convict labor by head and year (AL, GA, MS/Parchman); modern: UNICOR + state industry schedules | **ADMIT after sharecropping.** The strongest bridge to the present that is *not* a metaphor: a lease entry from 1890 and a hire-out entry from 1850 are the same ledger object. Angola is a former plantation still farmed by prisoners. §5 binds hard — living workers are parties, never rows. |
| **Hawai'i / Dole & the Kingdom overthrow** | all four; **cleanest persistence in the set** — Crown & Government Lands never compensated, still held by the State of Hawai'i as "ceded lands"; Dole Food Co. is a living successor line to Hawaiian Pineapple Co. | ✅ Kingdom land records (Māhele awards, Land Commission), 1893/1898 instruments, corporate filings | **ADMIT.** Two non-substitutable claimant classes on the same acres: Kanaka Maoli (nation-level, primary) and plantation contract-labor descendants (Japanese, Filipino, Portuguese, Chinese, Puerto Rican). Same structure as Stockbridge-Munsee but **both classes are organized and living**, so ordering is not academic. |
| **Mexican silver mining / debt peonage** | all four; *tienda de raya*, *enganche*, 1884 Mining Code subsoil transfer, Porfiriato foreign concessions | ✅ concession titles (Registro Público de Minería / AGN), company reports, **raya payrolls** — §1.5.5 in its purest form | **ADMIT.** Also the project's first case where the operator is on the **debit** side, which is the honest test of §2.1's non-netting under multi-regime. Do not sequence it last for that reason; sequence it early for exactly that reason. |
| **Haiti double debt** (1825 France indemnity + 1922–47 National City Bank customs receivership) | all four | ✅ the 1825 ordinance, French Treasury records, NYT "The Ransom" (2022) reporting the primary trail | Already scoped in M087's comment; **blocked by DEFECT 1**. Modern obligation: French Republic + Citigroup. |
| **CFA franc reserve seigniorage · IMF SAPs · tariff escalation · vulture litigation** | 1–3 yes; **predicate 2 (inability to refuse) is contested and must be argued per case, not assumed** | partial — IMF Article IV papers, UNCTAD TDR, court records | Scoped in M087; **blocked by DEFECT 1**. Treat predicate 2 as the research question, not a given. |
| **US aid to Israel — the fiscal flow** | ❌ **predicate 2 fails on the flow itself** | n/a | **NOT an origination entry.** A state-to-state transfer is not an extraction from an identified coerced class; it is third-party support for a regime. There is no entry type for it and **inventing one is precisely the move that produced $1.8 quadrillion.** The appropriations are well documented (CRS RL33222; the 2016 MOU, $38B FY2019–28) — but well-documented ≠ ledger-shaped. If it belongs anywhere it is as *provenance on a successor's capacity to satisfy*, never as principal. |
| **Palestinian property dispossession, 1948→** | all four, on the same shape as every other land regime here | ✅ **unusually strong** — the UNCCP Technical Office ran a contemporaneous parcel-by-parcel identification and valuation program (early 1950s) over Mandate Land Registry (*Tabu*) and tax records, producing named-owner/parcel schedules; the taking instruments are named statutes (Absentees' Property Law 1950; Development Authority Law 1950); the present holder is identifiable (Custodian → Development Authority → Israel Lands Authority) | **CANDIDATE — origination-shaped, and the documentary spine is better than most US counties.** Requires the same discipline as everything else: primary instruments in hand, dual-archived (rule 8), `max_evidence_tier='secondary'` until then. **Every fact in this row is from memory and is UNVERIFIED in-session — verify before it is cited anywhere.** |

**Sequencing note (operator's call, stated once).** The predicate test is the instrument's entire
credibility. Proving it first on regimes where no reader disputes the predicates — sharecropping, convict
leasing, Hawai'i, the Mexican mine — makes it very hard to argue with when applied to a contested one.
Posting a contested account before the test is proven inverts that, and costs exactly the legibility this
project is trying to buy. This is a sequencing judgment, not an exclusion: the register above admits the
candidate on the evidence, and the four predicates apply identically to every row or they are worth
nothing.

**What is genuinely new here.** Reparations work is overwhelmingly either aggregate-macro (Darity,
Brattle) or narrative-historical. Building it as a **double-entry account** — append-only, cited
origination, per-regime registered valuation, directed non-netting counterparties, and a `reached_class`
test on every claimed satisfaction — is not a scale-up of existing practice. The `reached_class` column in
particular has no maintained equivalent anywhere: nobody systematically records whether repair reached the
class it was owed to. That is the contribution, and it is what makes the instrument portable across
regimes without becoming a slogan.

---

## 9 · What this standard does NOT do

- It does not change any dollar figure. `ObligationReconciler`, Craemer, the disgorgement floor, and the
  land split are unchanged; they become the cited methodology of the opening entry.
- It does not authorize publishing anything. The register (§7) is a design posture with nothing built.
- It does not make an obligation legally enforceable. It makes it **auditable**, which is the precondition.
- It does not resolve land-as-satisfaction. §2.5 fails toward non-reduction until the user rules on §8.2.
- It does not make the pre-1870 enslaved-side counterparty problem go away. `documented_pending` is an
  honest account state, not a solved one.
- It does not admit a single regime. §8.3 is a register of candidates with verdicts; admission runs through
  the contribute pipeline with evidence, one regime at a time, each with its own M060 methodology.
- It does not supply arithmetic for any non-US regime. §1.5.3 forbids transferring Craemer or any other
  constant across regimes. Every new regime arrives with its own cited valuation or it does not arrive.

## See also
[[plan-96-person-status-model]] (the vector rule's origin) · [[wealth-tracing-framework]] ·
[[finding-land-nonclaim-and-dutchess-audit-jul17]] · [[plan-descent-first-lineage]] ·
[[plan-modern-endpoints-program]] · [[report-jun17-obligation-calibration-reconciliation]] ·
[[standard-canonical-person-and-document-gate]] · [[standard-external-source-ingest]] ·
[[standard-project-monitoring-and-free-agents]] · [[prompt-economics-llm-system]]
