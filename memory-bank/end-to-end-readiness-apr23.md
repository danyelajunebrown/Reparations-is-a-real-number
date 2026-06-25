# End-to-End System Readiness Gap Analysis

**Date:** April 23, 2026
**Context:** Intake form goes live today. Premiere May 4. What must work for a participant to go from form submission → verified claim → DAA → blockchain escrow.

---

## The seven stages

```
1. INTAKE       → 2. GENEALOGICAL    → 3. IDENTITY       → 4. EVIDENCE       → 5. CALCULATION
                   DISCOVERY            RESOLUTION         ACQUISITION         & DAA
                                                                                 ↓
                                                        7. PAYMENT        ← 6. REVIEW &
                                                           INTO ESCROW       SIGN-OFF
```

Each stage has working pieces, known gaps, and tooling debt. Tagged **[OK]** / **[PARTIAL]** / **[GAP]** / **[BLOCKER]**.

---

## 1. INTAKE  **[OK — shipped today]**

- Google Form → Apps Script → Render webhook → Neon `participants` + `participant_family`
- Positional column mapping (FORM_COLUMNS in `src/api/routes/intake.js`)
- Wealth fingerprint captured (trust, corporate, land, pre-1865)
- Idempotency by name+email+5min window
- End-to-end test confirmed Apr 23 at 01:10:22 UTC (participant 065f0978)

**Remaining polish:**
- [ ] `/review` UI needs an "Intake queue" tab showing new webhook submissions sorted by date
- [ ] Auto-kick climbs once all 4 grandparent FS IDs present + accuracy_certification=true
- [ ] Email the participant on receipt (SendGrid/Postmark) with "we're reviewing your submission"

---

## 2. GENEALOGICAL DISCOVERY  **[PARTIAL — climber strong, probate lookup missing]**

### What works
- FamilySearch ancestor climber (`scripts/scrapers/familysearch-ancestor-climber.js`, ~2,800 lines)
- Name-only climbing (added Mar 24, Ryan Mills demo)
- BFS traversal up to user-specified generations
- Match verification pipeline classifies matches (issue #35, verification_status column)

### Known gaps
- **GAP [issue #37, filed today]:** Climber never queries probate records. Tobias Pollard (cp=193870) was visited Mar 21 as `descendant`, sat for 33 days, user found him via 60-second Google search. George W. Biscoe was in DB 4x as `descendant` before manual merge to `enslaver`. **Fix: AncestorProbateEnricher service queries `(full_name, death_year, county)` against MD Archives, VA LVA, NC/SC archives, FS probate collections, freeafricanamericans.com.**
- **GAP:** Climber doesn't extract/resolve enslaved-person ownership from FS person pages (only enslaver metadata)
- **GAP:** No non-FS sources queried during climb — WikiTree, Geni.com, IPUMS, MyHeritage all listed in memory but not wired
- **GAP:** Pi kiosk triggers climb → Mac Mini runs it — but participant never sees progress; needs real-time status pushed back to kiosk/form

---

## 3. IDENTITY RESOLUTION  **[BLOCKER — systemic bug, issue #36 open]**

### Symptom
Same real person → 2-5 `canonical_persons` rows with conflicting `person_type`. Biscoe was 4 rows. Many more exist.

### Why it's a blocker
- DAA probate gate counts evidence **per canonical_person_id** — duplicates fragment the evidence
- Climber Tier 2 matching assumes one row per person
- Cross-source promotion (Tier A probate, Tier B census) can't find its target

### Needed
- [ ] **IdentityResolver service** — on every insert to `canonical_persons`, query existing rows by (normalized_name, birth_year ±3, location), merge or block
- [ ] Migration: `UNIQUE(identity_fingerprint)` constraint on canonical_persons (currently NULL for most)
- [ ] Backfill: generate `identity_fingerprint` for all existing rows, merge dedupes with `person_merge_log` audit
- [ ] **Issue #36 estimated: 1-2 weeks focused work**

---

## 4. EVIDENCE ACQUISITION  **[PARTIAL — structured data flowing, PDFs blocked on scale]**

### What flows automatically
- FamilySearch 1860 slave schedules: 1.68M persons indexed in `unconfirmed_persons`
- CivilWarDC TEI: 1,041 petitions, 1,698 enslaved persons, 4,174 S3 images
- Freedmen's Bank: 363,431 depositors indexed across 28 branches
- Louisiana Slave DB: 180,419 rows
- Hopewell will OCR (Google Vision + pdftoppm)
- Freedmens Bank ledger Document AI (processor 30049eebf8debcf4, fine-tune pending)

### Primary-source PDF upload to DAA  **[USER-FLAGGED HIGHEST PRIORITY]**
Per user Apr 23: *"uploading the man's primary source document is a highest priority to the DAA."*

**Current state:**
- `person_documents` table exists with S3 refs for civilwardc images (4,174)
- DAA Orchestrator pulls structured evidence but **does not embed PDF links in generated DAA**
- No pipeline to auto-fetch probate PDFs once an enslaver is identified

**Needed:**
- [ ] `PrimarySourceAcquirer` service: for each canonical_enslaver in a DAA, fetch all linked `person_documents`, attach S3 URLs to the DAA payload
- [ ] Extend to probate-enrichment pipeline (issue #37): when probate lookup hits, download and archive the PDF
- [ ] DAA template: embed a gallery of primary sources (will pages, deed pages, petition scans) with page-specific highlights
- [ ] Bucket structure: `s3://.../daa-evidence/{participant_id}/{enslaver_id}/{document_type}/`

**Specific open sources to pull:**
- Tobias Pollard will (Dorchester Co MD 1749) — not in MSA Prerogative Liber 26/27 abstracts; needs direct Dorchester County will book pull from FamilySearch MD Register of Wills Records 1629-1999
- George W. Biscoe 1858 DC will (already OCR'd, but not yet S3-archived + DAA-linked)
- 11 Philly bank OCR PDFs (corporate slavery, migration 043)

---

## 5. CALCULATION & DAA GENERATION  **[PARTIAL — 24 methodology issues still open]**

### What works
- `DAAOrchestrator.js` produces per-participant DAAs
- Probate gate (Tier A: direct probate evidence; Tier B: corroborated inference)
- 5 new calculators added Session 27 (Apr 4-6)
- Wealth fingerprint flag wired to calculators

### What's contested / broken
From methodology audit (Apr 4, 2026, 24 GitHub issues #2-#25):
- **7 critical:** unsourced constants, contradictory formulas, wrong interest rates
- **6 high:** misattributed data (e.g. Darity/Mullen cited for unrelated figures)
- **4 medium:** sloppy math that's fixable
- **7 research-needed:** require Brattle Group data, ICHEIC adaptation, legal framework

### Blockers for premiere
- [ ] Every constant in calculator code must have a citation (`CITATION:` comment pointing to `reference_primary_sources.md` entry)
- [ ] Resolve the contradictory formulas — pick one, document why, delete the rest
- [ ] Wealth-tracing framework (`memory-bank/wealth-tracing-framework.md`) needs to be implemented, not just drafted
- [ ] DAA should clearly separate: (a) what we can quantify with citations, (b) what's conservative-estimate, (c) what's research-ongoing

---

## 6. REVIEW & HUMAN SIGN-OFF  **[OK — /review UI live, 6 queues]**

- Intake queue, climb match queue, probate candidate queue, identity-conflict queue, parse-failure queue, DAA sign-off queue
- Human operator reviews each DAA before finalization
- Migration 044 parse_failure_queue for Document AI training feedback

**Remaining:**
- [ ] Multi-reviewer mode — if premiere scales, one person can't review every DAA
- [ ] Reviewer-disagreement resolution protocol (two reviewers flag differently)
- [ ] Audit trail: `daa_review_log` table with reviewer_id, decision, rationale, timestamp

---

## 7. PAYMENT INTO ESCROW  **[GAP — contract deployed, not wired to DAA]**

### What exists
- **ReparationsEscrow** contract deployed to Base mainnet (Apr 5, 2026, Session 27)
- Contract address + ABI in `memory-bank/project_blockchain_deployment.md`
- `ethers` dependency just added to package.json (was transitive, crashed Render)

### What's missing to close the loop

**A. DAA → on-chain claim registration**
- [ ] Service: `BlockchainNotary.registerClaim(participantId, daaId, enslaverIds[], amountWei)`
- [ ] Writes claim hash to ReparationsEscrow contract, returns tx hash
- [ ] Store `blockchain_tx_hash` on `daas` table
- [ ] Frontend shows Etherscan link on the participant's DAA page

**B. Funding mechanism — who pays into escrow**
This is the biggest open question. Three models currently implicit in the system:
1. **Corporate debts**: Banks/insurers named in corporate_slavery_disclosures owe descendants. *Who compels them to deposit?* — legal/advocacy question, not a code question.
2. **Descendants of named enslavers**: Inherited obligation. Same question.
3. **Participant self-funding** (the demo/premiere model): Participant pays into escrow against their own claim, receives back upon on-chain verification. **This is actually usable on May 4.**

**For premiere May 4:**
- [ ] Coinbase Commerce or wallet-connect integration on DAA page: "Fund this claim"
- [ ] `participant_contributions` table linking wallet address → participant → amount
- [ ] Premiere script pre-funds a demo escrow pool and walks audience through claim lookup + payout simulation

**C. Payout protocol**
- [ ] Who triggers payout — operator multisig? Automated on verification threshold? DAO vote?
- [ ] KYC for on-chain transfers? (Legal consult needed)
- [ ] Off-ramp integration (Coinbase/Stripe) for non-crypto participants

**D. Dispute / rollback**
- [ ] Contract has pause function? Verify in ABI.
- [ ] Off-chain dispute resolution → on-chain reversal protocol

---

## Infrastructure / ops

- **[OK]** Render.com hosts Express (intake, API, /review)
- **[OK]** Mac Mini hosts climber (PM2, Chrome CDP)
- **[OK]** Pi kiosk for in-person intake
- **[PARTIAL]** Neon DB — DATABASE_URL leaked, rotation still pending (task #17)
- **[GAP]** No staging env — every deploy is to prod
- **[GAP]** No monitoring/alerting — errors live in Render logs only
- **[GAP]** No backup strategy documented — Neon has PITR but we haven't tested restore

---

## Priority ordering for next 11 days (to May 4 premiere)

**Week 1 (Apr 24-30):**
1. IdentityResolver backfill + UNIQUE constraint (blocks everything else) — **issue #36**
2. PrimarySourceAcquirer service + DAA PDF embedding — user-flagged priority
3. Blockchain notarization wire: DAA → ReparationsEscrow.registerClaim → tx hash on DAA page
4. Close top 3 critical methodology issues from audit
5. Rotate Neon DB password (task #17)

**Week 2 (May 1-4):**
6. Demo escrow funding flow (wallet-connect + pre-funded pool)
7. Premiere rehearsal: full participant flow from form → DAA → on-chain claim
8. Fallback: hand-curated DAA for at least 3 participants (Adrian, Piper, Eli) as premiere demos
9. Document AI fine-tune if enough labels; otherwise keep bounding-box parser

**Post-premiere (May 5+):**
10. AncestorProbateEnricher (issue #37)
11. Multi-source climber (WikiTree, Geni, IPUMS)
12. Remaining 21 methodology issues
13. Corporate-debt compulsion legal strategy
