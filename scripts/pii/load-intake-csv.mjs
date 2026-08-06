#!/usr/bin/env node
/**
 * load-intake-csv.mjs — ingest Google Forms intake exports into `participants`
 * + `participant_family`, emitting ONLY UUIDs, counts and error codes.
 *
 * This script exists so the model never has to read the raw data. It is the
 * deterministic half of the split described in .claude/hooks/block-pii-access.mjs:
 * code touches PII, the model reads the emissions. Everything printed here is
 * safe to put in an LLM context — no names, no dates, no dollar figures.
 *
 * DELIBERATE CHOICE — NEUTRAL RELATIONSHIP LABELS.
 * The form asks for "Parent 1/2" and "Grandparent 1-4" and never states a
 * relative's sex or which parent's line they belong to. The webhook nonetheless
 * wrote positional labels (father, mother, pat_grandfather, …). Checked against
 * the 2026-08-03 export, that mislabels a majority of rows — 4 of 6 submissions
 * put a woman in the 'father' slot. So we write `parent_1`, `grandparent_3`,
 * preserve the participant's own "whom is their child" answer verbatim in
 * `lineage_hint`, and leave the real relationship to be resolved from records.
 * No fabricated data (CLAUDE.md audit rule 5).
 *
 * Usage:
 *   node scripts/pii/load-intake-csv.mjs --dir ~/Documents/reparations-pii/intake-csv --dry-run
 *   node scripts/pii/load-intake-csv.mjs --dir ~/Documents/reparations-pii/intake-csv --apply
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'csv-parse/sync';
import pg from 'pg';
import 'dotenv/config';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const APPLY = argv.includes('--apply');
const DIR = (arg('--dir', join(homedir(), 'Documents/reparations-pii/intake-csv'))).replace(/^~/, homedir());

// ── Column map ──────────────────────────────────────────────────────────────
// Verified against the 2026-08-03 export (71 columns). Google Forms appends
// LATER-ADDED questions at the END of the sheet rather than inline, which is
// why the "whom is their child" questions sit at 69/70 and not beside their
// grandparents — and why the six 5-column person blocks are NOT shifted.
const C = {
  timestamp: 0,
  consent_research: 1, consent_income: 2, consent_negative: 3, consent_blockchain: 4,
  full_name: 6, date_of_birth: 7, birthplace: 8,
  email: 9, address_line1: 10, address_city: 11, address_state: 12, address_zip: 13,
  self_fs_id: 14, self_is_living: 15,
  annual_income: 16, estimated_net_worth: 17, real_estate_equity: 18,
  inheritance_received: 19, inheritance_expected: 20, tax_filing_status: 21, num_dependents: 22,
  trust_beneficiary: 23, trust_corpus: 24,
  family_business_ownership: 25, family_business_details: 26,
  inherited_land_acres: 27, inherited_land_detail: 28,
  corporate_connections: 29, executive_board_history: 30, pre_1865_business: 31,
  tree_verified: 62, chain_complete: 63, chain_gaps: 64, additional_info: 65,
  certify: 66, email_backup: 67,
  // Appended later, out of visual order:
  block2_is_living: 68, lineage_hint_a: 69, lineage_hint_b: 70,
};

// Six person blocks of 5: [name, birth_year, birthplace, fs_id, is_living].
// Labels stay NEUTRAL — see the header note.
const BLOCKS = [
  { start: 32, label: 'parent_1' },
  { start: 37, label: 'parent_2' },
  { start: 42, label: 'grandparent_1', livingAt: C.block2_is_living, hintAt: C.lineage_hint_a },
  { start: 47, label: 'grandparent_2', hintAt: C.lineage_hint_b },
  { start: 52, label: 'grandparent_3' },
  { start: 57, label: 'grandparent_4' },
];

// ── Coercion ────────────────────────────────────────────────────────────────
const NOT_PROVIDED = /^(n\/?a|unknown|none|-|\?)$/i;

const txt = v => { const s = String(v ?? '').trim(); return (!s || NOT_PROVIDED.test(s)) ? null : s; };
const num = v => { const s = String(v ?? '').replace(/[^\d.-]/g, ''); const n = parseFloat(s); return isNaN(n) ? null : n; };
const year = v => { const m = String(v ?? '').match(/\b(1[89]\d{2}|20\d{2})\b/); return m ? +m[1] : null; };
const date = v => { const d = new Date(String(v ?? '')); return isNaN(d) ? null : d.toISOString().slice(0, 10); };

const bool = v => {
  const s = String(v ?? '').toLowerCase().trim();
  if (!s) return null;
  if (s.startsWith('yes')) return true;
  if (s.startsWith('no')) return false;
  return null;                                     // "unsure" is not a boolean
};

/**
 * Reject placeholder FS IDs.
 *
 * NOT by "must contain a digit AND a letter, no 3+ repeats" — that is what
 * src/api/routes/intake.js:fsIdClean() does, and it is WRONG. Verified against
 * the 2026-08-03 export: it rejects LTVZ-WSF and PXGL-LLW, which are real
 * FamilySearch IDs. FS IDs may be all letters, and may repeat a character three
 * times. That rule silently discards valid climb seeds.
 *
 * The real placeholders on this form are the instruction text echoed back
 * ("XXXX-XXX", "Xxxx-xxx", "XXXX-CXX"), which are characterised by using almost
 * no distinct characters. Test on variety instead.
 */
const fsId = v => {
  const s = String(v ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/.test(s)) return null;
  const body = s.replace('-', '');
  if (new Set(body).size < 3) return null;          // XXXXXXX (1), XXXXCXX (2)
  if (/^X+-X+$/.test(s)) return null;               // belt and braces
  return s;
};

const enumTrust = v => { const s = String(v ?? '').toLowerCase(); return s.includes('irrevocable') ? 'irrevocable' : s.includes('revocable') ? 'revocable' : s.includes('unsure') ? 'unsure' : 'no'; };
const enumBiz   = v => { const s = String(v ?? '').toLowerCase(); return s.includes('inherited') ? 'inherited_multigenerational' : s.includes('founded') ? 'founded_in_lifetime' : s.includes('unsure') ? 'unsure' : 'no'; };
const enumAcres = v => { const s = String(v ?? '').toLowerCase(); return s.includes('over 5') ? 'over_5000' : s.includes('500') && s.includes('5,0') ? '500_to_5000' : s.includes('under 500') ? 'under_500' : s.includes('unsure') ? 'unsure' : 'none'; };
const enumYNU   = v => { const s = String(v ?? '').toLowerCase(); return s.startsWith('yes') ? 'yes' : s.includes('unsure') ? 'unsure' : 'no'; };
const corpArr   = v => String(v ?? '').split(/[,;]/).map(t => t.trim().toLowerCase())
  .filter(t => t.length > 2 && !/^(none of the above|no|none)$/.test(t));

/**
 * QA/placeholder detection. A test submission must never become a participant.
 * Signals: placeholder-shaped FS IDs, keyboard-mash names, self-name repeated
 * as a relative.
 */
function isTestRow(r) {
  const reasons = [];
  const raw = String(r[C.self_fs_id] ?? '').trim();
  if (raw && !fsId(raw)) reasons.push('placeholder_self_fs_id');
  const names = BLOCKS.map(b => String(r[b.start] ?? '').trim()).filter(Boolean);
  const self = String(r[C.full_name] ?? '').trim().toLowerCase();
  if (self && names.filter(n => n.toLowerCase().includes(self)).length >= 2) reasons.push('self_name_repeated_as_relative');
  if (names.some(n => /^[bcdfghjklmnpqrstvwxyz]{3,}\s/i.test(n))) reasons.push('keyboard_mash_name');
  const placeholders = BLOCKS.filter(b => { const v = String(r[b.start + 3] ?? '').trim(); return v && !fsId(v); }).length;
  if (placeholders >= 3) reasons.push('placeholder_family_fs_ids');
  return reasons;
}

// ── Main ────────────────────────────────────────────────────────────────────
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const files = readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.csv'));
if (!files.length) { console.error(`no CSV in ${DIR}`); process.exit(1); }

let stats = { files: 0, rows: 0, blank: 0, test: 0, loaded: 0, dup: 0, failed: 0 };
const report = [];

for (const f of files) {
  stats.files++;
  const rows = parse(readFileSync(join(DIR, f), 'utf8'), { relax_column_count: true, skip_empty_lines: false });

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sheetRow = i + 1;
    if (!r || !String(r[C.timestamp] ?? '').trim()) { stats.blank++; continue; }
    stats.rows++;

    const testReasons = isTestRow(r);
    if (testReasons.length) {
      stats.test++;
      report.push({ row: sheetRow, status: 'SKIPPED_TEST_ROW', codes: testReasons });
      continue;
    }

    const name = txt(r[C.full_name]);
    if (!name) { stats.failed++; report.push({ row: sheetRow, status: 'FAILED', codes: ['no_full_name'] }); continue; }

    // Per-row data-quality codes. These describe SHAPE, never content — safe to print.
    const codes = [];
    if (!txt(r[C.email]) && !txt(r[C.email_backup])) codes.push('no_email');
    if (!fsId(r[C.self_fs_id])) codes.push('no_valid_self_fs_id');
    if (bool(r[C.self_is_living]) === true) codes.push('self_living_unclimbable');

    const people = [];
    const seenFs = new Map();
    for (const [bi, b] of BLOCKS.entries()) {
      const pname = txt(r[b.start]);
      const pfs = fsId(r[b.start + 3]);
      if (!pname && !pfs) { codes.push(`block${bi}_empty`); continue; }
      const living = bool(b.livingAt != null ? r[b.livingAt] : r[b.start + 4]);
      if (living === null) codes.push(`block${bi}_living_unknown`);
      if (!year(r[b.start + 1])) codes.push(`block${bi}_no_birth_year`);
      if (pfs) {
        if (seenFs.has(pfs)) codes.push(`block${bi}_fs_id_duplicate_of_block${seenFs.get(pfs)}`);
        else seenFs.set(pfs, bi);
      } else codes.push(`block${bi}_no_valid_fs_id`);

      people.push({
        relationship: b.label, block: bi,
        name: pname, birth_year: year(r[b.start + 1]), birthplace: txt(r[b.start + 2]),
        fs_id: pfs, is_living: living,
        lineage_hint: b.hintAt != null ? txt(r[b.hintAt]) : null,
      });
    }

    // Climbable seeds = deceased relatives with a valid FS ID. This is the number
    // that actually predicts whether a climb will return anything.
    const seeds = people.filter(p => p.fs_id && p.is_living === false);
    if (!seeds.length) codes.push('NO_CLIMBABLE_SEED');

    if (!APPLY) {
      stats.loaded++;
      report.push({ row: sheetRow, status: 'DRY_RUN_OK', family_rows: people.length, climb_seeds: seeds.length, codes });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Idempotency, two ways:
      //   (a) same CSV row already loaded — safe re-run of this script;
      //   (b) a participant with this self_fs_id already exists from ANY source.
      // (b) matters because early participants were hand-entered (intake_source
      // 'google_form'/'kiosk'/'manual') and also appear in this export. Loading
      // them again would fork one person into two participant rows and split
      // their climb sessions.
      const dup = await client.query(
        `SELECT id, intake_source FROM participants
          WHERE notes LIKE $1
             OR ($2::text IS NOT NULL AND self_fs_id = $2)
          LIMIT 1`,
        [`%[csvrow:${f}:${sheetRow}]%`, fsId(r[C.self_fs_id])]);
      if (dup.rowCount) {
        await client.query('ROLLBACK');
        stats.dup++;
        report.push({ row: sheetRow, status: 'DUPLICATE', participant_id: dup.rows[0].id, existing_source: dup.rows[0].intake_source });
        continue;
      }

      const ins = await client.query(`
        INSERT INTO participants (
          full_name, email, date_of_birth, birthplace,
          address_line1, address_city, address_state, address_zip,
          annual_income, estimated_net_worth, real_estate_equity,
          inheritance_received, inheritance_expected, tax_filing_status, num_dependents,
          self_fs_id, self_is_living, roles, intake_source, intake_date,
          consent_research, consent_income, consent_negative, consent_blockchain,
          trust_beneficiary, trust_corpus, family_business_ownership, family_business_details,
          inherited_land_acres, corporate_connections, executive_board_history,
          pre_1865_business_continuity, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::text[],$19,$20,
                  $21,$22,$23,$24,$25,$26,$27,$28,$29,$30::text[],$31,$32,$33)
        RETURNING id`,
        [
          name, txt(r[C.email]) ?? txt(r[C.email_backup]), date(r[C.date_of_birth]), txt(r[C.birthplace]),
          txt(r[C.address_line1]), txt(r[C.address_city]), txt(r[C.address_state]), txt(r[C.address_zip]),
          num(r[C.annual_income]), num(r[C.estimated_net_worth]), num(r[C.real_estate_equity]),
          num(r[C.inheritance_received]), num(r[C.inheritance_expected]), txt(r[C.tax_filing_status]), num(r[C.num_dependents]),
          fsId(r[C.self_fs_id]), bool(r[C.self_is_living]),
          ['intake_pending_review'], 'google_form_csv', new Date(r[C.timestamp]),
          bool(r[C.consent_research]), bool(r[C.consent_income]), bool(r[C.consent_negative]), bool(r[C.consent_blockchain]),
          enumTrust(r[C.trust_beneficiary]), num(r[C.trust_corpus]),
          enumBiz(r[C.family_business_ownership]), txt(r[C.family_business_details]),
          enumAcres(r[C.inherited_land_acres]), corpArr(r[C.corporate_connections]),
          txt(r[C.executive_board_history]), enumYNU(r[C.pre_1865_business]),
          `[csvrow:${f}:${sheetRow}] loaded by load-intake-csv.mjs`,
        ]);
      const pid = ins.rows[0].id;

      for (const p of people) {
        await client.query(`
          INSERT INTO participant_family
            (participant_id, relationship, full_name, birth_year, birthplace, fs_id, is_living, lineage_hint, source_block_index)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [pid, p.relationship, p.name ?? '(unnamed)', p.birth_year, p.birthplace, p.fs_id, p.is_living, p.lineage_hint, p.block]);
      }

      await client.query('COMMIT');
      stats.loaded++;
      report.push({ row: sheetRow, status: 'LOADED', participant_id: pid, family_rows: people.length, climb_seeds: seeds.length, codes });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      stats.failed++;
      report.push({ row: sheetRow, status: 'FAILED', codes: [e.code || 'db_error'], detail: e.message.slice(0, 120) });
    } finally {
      client.release();
    }
  }
}

await pool.end();

console.log(APPLY ? '=== APPLIED ===' : '=== DRY RUN (no writes) ===');
console.log(JSON.stringify(stats));
for (const x of report) console.log(JSON.stringify(x));
process.exit(stats.failed ? 1 : 0);
