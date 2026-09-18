#!/usr/bin/env node
/**
 * scrub-transcripts.mjs — redact participant PII from local Claude Code transcripts.
 *
 * Claude Code writes every session to ~/.claude/projects/<project>/<session>.jsonl.
 * Before the PII guard existed, intake data was read into context, so those
 * transcripts hold real participants' names, emails, dates of birth and
 * addresses in plain text on disk. This replaces each occurrence with a stable
 * token ([NAME-1], [EMAIL-2], …) so the files stay valid JSONL and remain useful
 * for debugging, minus the identifiers.
 *
 * WHAT THIS CANNOT DO: the transcripts were already sent to the model API to
 * produce those turns. Local redaction does not retract that. It reduces
 * at-rest exposure on this machine — nothing more. Say so plainly to anyone
 * who asks whether the data was "deleted".
 *
 * The redaction list is built from the live DB and the intake CSVs, so this
 * script necessarily touches PII — hence scripts/pii/. It prints counts only.
 *
 * Usage:
 *   node scripts/pii/scrub-transcripts.mjs --dry-run
 *   node scripts/pii/scrub-transcripts.mjs --apply
 *   node scripts/pii/scrub-transcripts.mjs --apply --include-active   (see below)
 *
 * ACTIVE SESSION: by default the session currently running is SKIPPED. Claude
 * Code holds that file open for append; rewriting it underneath the process
 * means later turns are written to the old inode and the scrubbed copy stops
 * receiving history. Scrub it after the session ends.
 */

import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'csv-parse/sync';
import pg from 'pg';
import 'dotenv/config';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const INCLUDE_ACTIVE = argv.includes('--include-active');
const ACTIVE_SESSION = process.env.CLAUDE_SESSION_ID || 'bc1d6cd7-c9d7-408e-b594-df4f88ed3792';

const PROJECT_DIR = join(homedir(), '.claude/projects',
  '-Users-danyelabrown-Desktop-danyelajunebrown-GITHUB-Reparations-is-a-real-number-main');
const CSV_DIR = join(homedir(), 'Documents/reparations-pii/intake-csv');
const BACKUP_DIR = join(homedir(), 'Documents/reparations-pii/transcript-backups');

// ── Build the redaction vocabulary ──────────────────────────────────────────
const names = new Set(), emails = new Set(), dobs = new Set(), selfIds = new Set();

const addName = v => {
  const s = String(v ?? '').trim();
  // >=2 chars and containing a letter; skip obvious non-names.
  if (s.length < 3 || !/[A-Za-zÀ-ÿ]/.test(s)) return;
  if (/^(n\/?a|unknown|none|yes|no|unsure)$/i.test(s)) return;
  names.add(s);
  // Also redact the individual name tokens — transcripts often mention a person
  // by surname alone. Only tokens long enough to be distinctive, to avoid
  // shredding common words.
  for (const tok of s.split(/[\s,]+/)) if (tok.length >= 5 && /^[A-ZÀ-Ý][a-zà-ÿ]+$/.test(tok)) names.add(tok);
};

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
for (const r of (await pool.query('SELECT full_name, email, date_of_birth, self_fs_id FROM participants')).rows) {
  addName(r.full_name);
  if (r.email) emails.add(r.email);
  if (r.self_fs_id) selfIds.add(r.self_fs_id);
  if (r.date_of_birth) dobs.add(new Date(r.date_of_birth).toISOString().slice(0, 10));
}
for (const r of (await pool.query('SELECT full_name FROM participant_family')).rows) addName(r.full_name);
await pool.end();

if (existsSync(CSV_DIR)) {
  for (const f of readdirSync(CSV_DIR).filter(f => f.toLowerCase().endsWith('.csv'))) {
    const rows = parse(readFileSync(join(CSV_DIR, f), 'utf8'), { relax_column_count: true, skip_empty_lines: true });
    for (const r of rows.slice(1)) {
      for (const cell of r) {
        const s = String(cell ?? '').trim();
        if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) emails.add(s);
        else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) dobs.add(s);
      }
      // Name columns: self + the six 5-wide person blocks.
      [6, 32, 37, 42, 47, 52, 57].forEach(i => addName(r[i]));
    }
  }
}

// Longest first, so "Danyela June Brown" is replaced before "Danyela".
const build = (set, tag) => [...set].sort((a, b) => b.length - a.length)
  .map((v, i) => ({ v, token: `[${tag}-${i + 1}]` }));
const RULES = [...build(emails, 'EMAIL'), ...build(names, 'NAME'),
               ...build(dobs, 'DOB'), ...build(selfIds, 'SELF-FSID')];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A participant surname can collide with an institution this project actually
 * researches — "Brown" is both a participant surname and the first word of
 * Brown University and Brown Brothers Harriman, both of which are corporate
 * entities in the wealth-tracing work. Redacting those damages project
 * knowledge without protecting anyone: the institution is public.
 *
 * So: never redact a name token that is immediately followed by an
 * institutional word. Checked after the first pass found 12 such hits.
 */
const INSTITUTION_NEXT = String.raw`(?!\s+(?:University|College|Brothers|Bank|Banking|Hall|County|Institute|Foundation|Trust\b|Chase|Harriman|School|Library|Museum|Association|Company|Corporation|Plantation))`;

/** Multi-word names are unambiguous; only single tokens need the guard. */
const isSingleToken = v => !/\s/.test(v.trim());

// ── Apply ───────────────────────────────────────────────────────────────────
const files = readdirSync(PROJECT_DIR).filter(f => f.endsWith('.jsonl'));
let totals = { files: 0, skipped_active: 0, replacements: 0, bytes_before: 0 };
const per = [];

for (const f of files) {
  const path = join(PROJECT_DIR, f);
  if (f.startsWith(ACTIVE_SESSION) && !INCLUDE_ACTIVE) {
    totals.skipped_active++;
    per.push({ file: f.slice(0, 8), status: 'SKIPPED_ACTIVE_SESSION' });
    continue;
  }
  let text = readFileSync(path, 'utf8');
  const before = text.length;
  let hits = 0;
  for (const { v, token } of RULES) {
    // JSON-escape-aware: the raw value appears inside JSON strings verbatim.
    const re = new RegExp(esc(v) + (isSingleToken(v) ? INSTITUTION_NEXT : ''), 'g');
    const m = text.match(re);
    if (m) { hits += m.length; text = text.replace(re, token); }
  }
  totals.files++; totals.replacements += hits; totals.bytes_before += before;
  per.push({ file: f.slice(0, 8), size_mb: +(before / 1048576).toFixed(1), replacements: hits });

  if (APPLY && hits) {
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
    copyFileSync(path, join(BACKUP_DIR, f + '.bak'));
    // Validate every line still parses before overwriting — a corrupted
    // transcript loses session history.
    let bad = 0;
    for (const line of text.split('\n')) { if (!line.trim()) continue; try { JSON.parse(line); } catch { bad++; } }
    if (bad) { per[per.length - 1].status = `ABORTED_${bad}_UNPARSEABLE_LINES`; continue; }
    writeFileSync(path, text);
    per[per.length - 1].status = 'SCRUBBED';
  }
}

console.log(APPLY ? '=== APPLIED ===' : '=== DRY RUN ===');
console.log(JSON.stringify({ ...totals, vocab: { emails: emails.size, names: names.size, dobs: dobs.size, self_fs_ids: selfIds.size } }));
for (const x of per) console.log(JSON.stringify(x));
