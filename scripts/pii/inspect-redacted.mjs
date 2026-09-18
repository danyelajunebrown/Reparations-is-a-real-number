#!/usr/bin/env node
/**
 * inspect-redacted.mjs — look at the SHAPE of a PII file without seeing its values.
 *
 * The model is blocked from reading participant intake data directly
 * (.claude/hooks/block-pii-access.mjs). But debugging a failed load still needs
 * to answer "what is actually in column 47 on row 14?" This answers that
 * structurally — type, length, pattern class, emptiness — and never emits a
 * value, so its output is safe to put in context.
 *
 * Usage:
 *   node scripts/pii/inspect-redacted.mjs <file.csv>
 *   node scripts/pii/inspect-redacted.mjs <file.csv> --row 14
 *   node scripts/pii/inspect-redacted.mjs <file.csv> --col 47
 */

import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const rowFilter = args.includes('--row') ? Number(args[args.indexOf('--row') + 1]) : null;
const colFilter = args.includes('--col') ? Number(args[args.indexOf('--col') + 1]) : null;

if (!file) {
  console.error('usage: inspect-redacted.mjs <file.csv> [--row N] [--col N]');
  process.exit(1);
}

/**
 * Classify a cell without revealing it.
 * Returns a shape descriptor: what KIND of thing this is and how big.
 */
function classify(v) {
  const s = String(v ?? '');
  if (s === '') return 'empty';
  const t = s.trim();
  if (t === '') return `whitespace(${s.length})`;

  // Pattern classes — deliberately coarse. "fs_id" tells us the column parsed;
  // it does not tell us WHOSE.
  if (/^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/i.test(t)) {
    // Placeholders are the echoed instruction text ("XXXX-XXX"), which uses almost
    // no distinct characters. Do NOT require a digit — LTVZ-WSF is a real FS ID.
    const body = t.toUpperCase().replace('-', '');
    return new Set(body).size < 3 ? 'fs_id:PLACEHOLDER' : 'fs_id:valid';
  }
  if (/^-?[\d,.$]+$/.test(t)) {
    const digits = t.replace(/\D/g, '');
    if (/^(18|19|20)\d{2}$/.test(t)) return 'year';
    return `number(${digits.length}d)`;
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(t)) return 'date';
  if (/@/.test(t)) return 'email';
  if (/^(yes|no|unsure)/i.test(t)) return `choice:${t.slice(0, 14).toLowerCase().replace(/\s+/g, '_')}`;
  if (/^(n\/?a|unknown|none)$/i.test(t)) return 'NOT_PROVIDED';

  const words = t.split(/\s+/).length;
  const caps = /^[A-ZÁÉÍÓÚÑ]/.test(t);
  if (words <= 5 && caps) return `name-like(${words}w,${t.length}c)`;
  return `text(${words}w,${t.length}c)`;
}

const rows = parse(readFileSync(file, 'utf8'), { relax_column_count: true, skip_empty_lines: false });
const header = rows[0] || [];

console.log(`file: ${file.split('/').pop()}`);
console.log(`rows: ${rows.length} (incl. header) · columns: ${header.length}`);
console.log('— values are NEVER printed; only structural class —\n');

if (colFilter !== null) {
  console.log(`column ${colFilter}: "${String(header[colFilter] ?? '').slice(0, 70)}"`);
  rows.slice(1).forEach((r, i) => {
    if (!r[0]) return;                       // skip untimestamped filler rows
    console.log(`  row ${i + 2}: ${classify(r[colFilter])}`);
  });
  process.exit(0);
}

const targets = rowFilter !== null
  ? [[rows[rowFilter - 1], rowFilter]]
  : rows.slice(1).map((r, i) => [r, i + 2]).filter(([r]) => r && r[0]);

for (const [r, n] of targets) {
  if (!r) continue;
  const filled = r.filter(c => String(c ?? '').trim() !== '').length;
  console.log(`row ${n}: ${filled}/${r.length} filled`);
  r.forEach((c, i) => {
    const k = classify(c);
    if (k === 'empty') return;               // suppress the noise
    console.log(`   c${String(i).padStart(2)} ${k}`);
  });
  console.log('');
}
