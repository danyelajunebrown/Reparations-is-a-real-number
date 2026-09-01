#!/usr/bin/env node
/**
 * ⛔ HARD-DEPRECATED — DO NOT USE. This script refuses to run.
 *
 * `generate-daa-pdf.js` was a PARALLEL DAA generator that produced a signed
 * legal instrument (Debt Acknowledgment Agreement) directly from an ancestor-
 * climb session with NO PROBATE GATE and NO KINSHIP GATE. That made it possible
 * to emit a DAA that NAMES A SLAVEHOLDER for whom the project holds no
 * documentary evidence, and whose descent from the obligor is unproven —
 * exactly the ungated assertion the canonical pipeline exists to prevent.
 *
 * WHY IT IS UNSAFE (each independently disqualifying):
 *   1. No `_enforceProbateGate`. The canonical path names ONLY slaveholder
 *      ancestors with Tier A/B/C documentary evidence (land_transfer_events,
 *      probate-type person_documents, or slave-schedule family_relationships)
 *      and refuses to generate when ZERO documented ancestors exist. This
 *      script named every climb match unconditionally.
 *   2. No `_enforceKinshipGate`. It asserted descent ("this slaveholder is YOUR
 *      ancestor") with no chain-of-custody check on the parent→child edges.
 *   3. Fabricated financial constants that violate the audit-grade rules in
 *      CLAUDE.md: a $120/day wage, a "3.2× delayed justice penalty", and a
 *      recital citing the Ager/Boustan/Eriksson "wealth recovered in one
 *      generation" claim — the exact 2.5×/AER-2021 framing CLAUDE.md rule 4
 *      forbids. No number on a DAA may originate here.
 *
 * THE SINGLE GATED PATH — use this instead:
 *
 *   node scripts/generate-comprehensive-daa.js \
 *     --fs-id <FamilySearch_ID>   OR   --session-id <UUID> \
 *     --name "<Full Name>" \
 *     --email <email@example.com> \
 *     --income <annual_income>
 *
 * That CLI wires `DAAOrchestrator.generateComprehensiveDAA`, which runs the
 * probate gate (fails closed on undocumented slaveholders) and the kinship gate
 * (surfaces / can enforce unproven lineage edges) before any document is
 * produced. Standards:
 *   - memory-bank/standard-canonical-person-and-document-gate.md
 *   - memory-bank/standard-genealogical-edge-evidence.md §7
 *
 * This file is intentionally inert. It emits the redirect above and exits
 * non-zero. It does NOT connect to the database, render HTML, or write a PDF.
 * Do not "revive" it by reinstating the generator — reproduce output through
 * the orchestrator so the gates cannot be bypassed.
 */

'use strict';

const REDIRECT = `
⛔ generate-daa-pdf.js is HARD-DEPRECATED and will not run.

   It produced an UNGATED Debt Acknowledgment Agreement — no probate gate,
   no kinship (chain-of-custody) gate — so it could name an undocumented
   slaveholder and assert an unproven line of descent. That is not a legal
   instrument this project will emit.

   Use the single gated path instead:

     node scripts/generate-comprehensive-daa.js \\
       --fs-id <FamilySearch_ID>   OR   --session-id <UUID> \\
       --name "<Full Name>" \\
       --email <email@example.com> \\
       --income <annual_income>

   That path runs DAAOrchestrator.generateComprehensiveDAA, which enforces
   _enforceProbateGate (fails closed on undocumented slaveholders) and
   _enforceKinshipGate before any DAA is generated.

   Standards:
     memory-bank/standard-canonical-person-and-document-gate.md
     memory-bank/standard-genealogical-edge-evidence.md §7
`;

console.error(REDIRECT);
process.exit(2);
