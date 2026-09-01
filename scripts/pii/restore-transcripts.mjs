#!/usr/bin/env node
/**
 * restore-transcripts.mjs — put the pre-scrub transcripts back from backup.
 *
 * scrub-transcripts.mjs copies each file to
 * ~/Documents/reparations-pii/transcript-backups/<session>.jsonl.bak before
 * rewriting it. This restores them, so a scrub that over-redacted can be
 * corrected and re-run rather than lived with.
 *
 * Lives in scripts/pii/ because the backups contain unredacted PII.
 * Prints filenames and byte counts only.
 */

import { readdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BACKUP_DIR = join(homedir(), 'Documents/reparations-pii/transcript-backups');
const PROJECT_DIR = join(homedir(), '.claude/projects',
  '-Users-danyelabrown-Desktop-danyelajunebrown-GITHUB-Reparations-is-a-real-number-main');

if (!existsSync(BACKUP_DIR)) { console.error('no backup dir'); process.exit(1); }

let n = 0, bytes = 0;
for (const b of readdirSync(BACKUP_DIR).filter(f => f.endsWith('.jsonl.bak'))) {
  const target = join(PROJECT_DIR, b.replace(/\.bak$/, ''));
  copyFileSync(join(BACKUP_DIR, b), target);
  n++; bytes += statSync(target).size;
  console.log(JSON.stringify({ restored: b.slice(0, 8), bytes: statSync(target).size }));
}
console.log(JSON.stringify({ files_restored: n, total_bytes: bytes }));
