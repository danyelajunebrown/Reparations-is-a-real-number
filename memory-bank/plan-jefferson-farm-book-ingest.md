# PLAN — Jefferson Farm Book: full cross-codebase reconstruction

_2026-08-09. The Farm Book (MHS Coolidge Collection, 174 pp, 1774-1824) is simultaneously (a) the CHATTEL-side
gold for Phase B2, and (b) a primary-source estate ledger that upgrades Thomas Jefferson's DAA. This is one of
the largest single ingests in the codebase — it touches ~10 subsystems. Source: authoritative TRANSCRIPTIONS
(`masshist.org/thomasjeffersonpapers/doc?id=farm_N`, from Baron's *Garden & Farm Books of Jefferson*, 1987) +
full-res images (`.../farm/image/lg/farm_N_lg.jpg`). Jefferson's OWN accounting ⇒ tier 0.95+ primary._

**Jefferson canonical = #828182.** The Hemings appear throughout (Betty Hemings + children), and the Hemings
line runs to LIVING descendants (Getting Word; e.g. Dr. Mary Lee Brady-Atkins) via the B1/Toulmin chain — so
this ingest anchors a COMPLETE lineage from 1774 chattel to the present, which is the DAA's entire purpose.

## Stages (each a real build; do in order, gold-validated)
1. **ACQUIRE** — `ingest-jefferson-farm-book.mjs` (RUNNING): 174 transcriptions + images → `source_artifacts`
   (S3+Wayback) + `person_documents` (document_type='plantation_roll', linked to #828182). → **appears on
   Jefferson's modal.** Resume keys on the person_documents row.
2. **EMBED** (RULE 0.5) — each page transcription → `embeddings` (doc_ocr). → **in RAG.** (reuse embed-documents.)
3. **ENSLAVED PERSONS** — parse the rolls (Wayles 1774, 1774/1783/1794 rolls, birth registers, location lists,
   the `*`/`+`/`-` labour-status marks) → each named person → lead, `enslaved_owner_relationships` → Jefferson,
   with location/birth-year/occupation. Embed each (person_profile).
4. **PARENTAGE EDGES** — birth registers ("Martin (Abram & Doll)") + family brackets (Betty Hemings {Nancy,
   Thenia, Critta, Peter, Sally, Daniel}) → `canonical_family_edges` (mother/father→child). The Biscoe-rule key
   at scale, and the B2 gold structure.
5. **B2 RESOLUTION** — the SAME person across the 1774/1783/1794 rolls resolves to ONE canonical (owner+location
   +age+parentage), validated against Getting Word's known resolution. *This ingest IS the Phase B2 build,
   grounded in the best-documented enslaved community in existence.*
6. **INHERITANCE PROVENANCE** — the Wayles estate division (Jan 1774) + the mother's-conveyance page →
   `chattel_transfer_events`/`inheritance_edges` (e.g. Betty Hemings: John Wayles → Jefferson).
7. **FINANCIAL → DAA** — Jefferson's OWN figures: labour valuation (£18-8/yr per labourer, ÷300 days = 1/3 a
   day), rations (corn/whiskey/molasses per person), per-person provisioning (clothing/blankets), land roll
   (10,647 acres), losses/deaths → `estate_valuations`/`reparations_line_items` feeding the DAA financial layer
   + the reparations math. Upgrades the Jefferson DAA from name-counts to itemized estate accounting.
8. **DESCENDANT CHAIN** — Betty Hemings (Farm Book) → … → Melinda Colbert/Freeman → the Shorters (Toulmin/B1) →
   Getting Word living descendants. Opt-in participants. Closes chattel→present.

## Subsystems touched
source_artifacts · person_documents · canonical_persons/unconfirmed_persons · enslaved_owner_relationships ·
canonical_family_edges · chattel_transfer_events/inheritance_edges · estate_valuations/reparations_line_items ·
embeddings · DAAOrchestrator + person modal · the Phase B resolver · Getting Word intake. **Massive — tracked.**

## Status (2026-08-09, verify/debug per stage)
- **Stage 1 ACQUIRE** — running; 71/174 pages on the modal, all linked to Jefferson #828182, images archived.
- **Stage 2 EMBED** — running (embed-documents, local nomic); 62 pages embedded, keeping pace. → in RAG.
- **Stage 3 ROSTER** — running (`extract-farm-book-roster.mjs` → `farm_book_persons`, mig 135). 123 mentions,
  91 distinct names, 68 with birth years; status marks (*/+/-) read correctly. Quality good.
- **Stage 4 PARENTAGE — TRIAGED ISSUE:** Baron's transcription **linearizes the roll family-brackets**, so
  mother→child from the ROLLS is NOT recoverable from text (0/123 so far). Fix: (a) birth-register pages
  (21,22,28,31,87-94, e.g. "Martin (Abram & Doll)") give parentage INLINE → recoverable as the drip reaches
  them; (b) roll-bracket parentage needs a VISION pass over those roll IMAGES (bracket structure) — a Stage 4
  refinement, not the transcription. The Getting Word family tree can also supply/validate Hemings parentage.
- **Stages 5-8** — queued: 5 resolve mentions→distinct people (Phase B2, validate vs Getting Word); 6
  inheritance (Wayles/mother); 7 financial→DAA (labour £18-8, provisioning, land, losses → reparations_line_items);
  8 descendant chain (Betty Hemings→Shorter→living, e.g. Dr. Mary Lee Brady-Atkins).
Stage 5 doubles as Phase B2. Generalizes to other plantation ledgers.
