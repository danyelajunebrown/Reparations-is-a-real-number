#!/usr/bin/env node
/**
 * PreToolUse guard — keeps participant PII out of the model's context.
 *
 * WHY THIS EXISTS
 *   On 2026-08-03 a participant intake CSV was dropped into the repo and read
 *   directly into the model's context: 7 real people's names, dates of birth,
 *   birthplaces, income, net worth, an email address, and 24 relatives' names
 *   and FamilySearch IDs. Nothing in the harness stopped it. `permissions.deny`
 *   on Read does not help, because Bash (`cat`, `node -e`, `psql`, …) reaches
 *   the same bytes. This hook closes that path.
 *
 * THE RULE
 *   Deterministic code may touch participant PII. The model may not.
 *   Scripts under scripts/pii/ read the raw data and emit only IDs, counts and
 *   error codes; the model reads the emissions, never the source.
 *   (This is CLAUDE.md audit rule 1 — "the model orchestrates, deterministic
 *   code computes" — applied to PII rather than to arithmetic.)
 *
 * CONTRACT
 *   stdin  : PreToolUse JSON — { tool_name, tool_input: { command | file_path } }
 *   exit 0 : allow
 *   exit 2 : block; stderr is shown to the model as the reason
 *
 * Fails OPEN on internal error (a crashing guard must not brick the session),
 * but fails CLOSED on anything it positively matches.
 */

import { readFileSync } from 'node:fs';

// ── Protected surfaces ──────────────────────────────────────────────────────

// Filesystem locations holding participant PII.
const PII_PATHS = [
  /(^|[^\w])~?\/?[\w./-]*Documents\/reparations-pii/i,
  /(^|[^\w])worksheets\//i,
  /intake-csv/i,
  /intake-inbox/i,
  /Form Responses/i,
];

// PII-bearing columns on participants / participant_family. Reading these into
// context is the thing we are preventing, regardless of which client does it.
const PII_COLUMNS = [
  'full_name', 'email', 'date_of_birth', 'birthplace',
  'address_line1', 'address_city', 'address_zip',
  'annual_income', 'estimated_net_worth', 'real_estate_equity',
  'inheritance_received', 'inheritance_expected', 'trust_corpus',
  'self_fs_id', 'other_names_used',
];

const PII_TABLES = /\b(participants|participant_family|participant_climb_anchors|participant_living_relatives|intake_research_leads)\b/i;

// Scripts explicitly built to handle PII safely — they emit IDs and codes only.
const SANCTIONED = /scripts\/pii\//;

// ── Decision ────────────────────────────────────────────────────────────────

function verdict(toolName, input) {
  const cmd = String(input?.command ?? '');
  const file = String(input?.file_path ?? input?.path ?? '');
  const subject = `${cmd}\n${file}`;

  // Sanctioned loaders may touch anything — that is their whole job.
  if (SANCTIONED.test(subject)) return null;

  for (const re of PII_PATHS) {
    if (re.test(subject)) {
      return `Blocked: this touches participant PII (matched ${re}).\n` +
             `Raw intake data must not enter model context. Route it through a script under ` +
             `scripts/pii/ that prints only participant UUIDs, counts and error codes, then read that output.\n` +
             `To inspect structure without values: node scripts/pii/inspect-redacted.mjs <file>`;
    }
  }

  // SQL reaching PII columns, or a bare SELECT * against a PII table.
  //
  // Require actual QUERY context, not a bare mention. Naming a column in prose
  // — a commit message, a comment, a plan doc — is schema discussion, not a
  // disclosure, and blocking it produced false positives that taught nothing.
  // A real query always pairs SELECT with FROM (or is a COPY/\copy).
  const looksLikeQuery = /\bselect\b[\s\S]{0,400}?\bfrom\b/i.test(subject) || /\bcopy\b/i.test(cmd);
  if (PII_TABLES.test(subject) && looksLikeQuery) {
    const hit = PII_COLUMNS.find(c => new RegExp(`\\b${c}\\b`, 'i').test(subject));
    if (hit) {
      return `Blocked: query selects PII column "${hit}" from a participant table.\n` +
             `Use the participants_safe view (UUID, state, birth decade, income band) instead.`;
    }
    if (/select\s+\*/i.test(subject)) {
      return `Blocked: "SELECT *" against a participant table returns PII columns.\n` +
             `Name the non-PII columns you need, or use participants_safe.`;
    }
  }

  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);  // unreadable payload → fail open
}

let reason = null;
try {
  reason = verdict(payload.tool_name, payload.tool_input);
} catch {
  process.exit(0);  // guard bug → fail open, never brick the session
}

if (reason) {
  process.stderr.write(reason + '\n');
  process.exit(2);
}
process.exit(0);
