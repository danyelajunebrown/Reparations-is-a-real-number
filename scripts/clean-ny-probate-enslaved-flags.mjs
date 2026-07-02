#!/usr/bin/env node
/**
 * NY-probate enslaved-flag cleanup — issues #68 + #69.
 *
 * The NY probate scrape set probate_scrape_progress.enslaved_count>0 on docs that are not slavery
 * evidence. Two disjoint passes (original count preserved in error_text for reversibility/audit):
 *
 *   #68 CLEAR (definitively false): the doc's OCR has NO slavery token (negro|slave|servant|bondw|
 *       wench|mulatto|colo(u)red) OR matches a 20th-c surrogate-index-page pattern (LETTERS ISSUED /
 *       FILE NUMBER / TAXABLE TRANSFER / RECORDED … VOL). Zero slavery content → enslaved_count:=0.
 *   #69 QUARANTINE (suspect): document_year > 1827 (NY abolished slavery Jul 4 1827) AND the doc DOES
 *       have a slavery token AND wasn't cleared by #68. Most are index false-positives / free paid
 *       servants / pre-abolition references — not fact. enslaved_count:=0 + a "needs human review"
 *       note so a curator can restore a genuine pre-abolition holding.
 *
 * After running, re-run scripts/recompute-assertion-gates.mjs --apply so any owner that was only
 * assertable via a now-cleared count is de-asserted.
 *
 *   node scripts/clean-ny-probate-enslaved-flags.mjs            # dry-run
 *   node scripts/clean-ny-probate-enslaved-flags.mjs --apply
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const TOKEN = `(negro|slave|servant|bondw|wench|mulatto|colou?red)`;
const INDEX = `(LETTERS ISSUED|FILE NUMBER|TAXABLE TRANSFER|RECORDED.{0,4}VOL)`;

(async () => {
  const client = await pool.connect();
  try {
    console.log(`=== NY-probate enslaved-flag cleanup ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
    // #68 false-positive set
    const falseSet = `p.enslaved_count > 0 AND (pd.ocr_text IS NULL
        OR pd.ocr_text !~* '${TOKEN}' OR pd.ocr_text ~* '${INDEX}')`;
    const c68 = (await client.query(
      `SELECT count(*) c, coalesce(sum(p.enslaved_count),0) n FROM probate_scrape_progress p
         JOIN person_documents pd ON pd.id = p.person_document_id WHERE ${falseSet}`)).rows[0];
    // #69 post-1827 suspect set (has token, not in #68 set, year>1827)
    const suspectSet = `p.enslaved_count > 0 AND pd.ocr_text ~* '${TOKEN}' AND pd.ocr_text !~* '${INDEX}'
        AND pd.document_year IS NOT NULL AND pd.document_year > 1827`;
    const c69 = (await client.query(
      `SELECT count(*) c, coalesce(sum(p.enslaved_count),0) n FROM probate_scrape_progress p
         JOIN person_documents pd ON pd.id = p.person_document_id WHERE ${suspectSet}`)).rows[0];
    console.log(`#68 clear (no-token/index-page):    ${(+c68.c).toLocaleString()} docs / ${(+c68.n).toLocaleString()} phantom enslaved`);
    console.log(`#69 quarantine (post-1827 suspect): ${(+c69.c).toLocaleString()} docs / ${(+c69.n).toLocaleString()} enslaved`);

    if (!APPLY) { console.log('\n(dry-run) re-run with --apply, then recompute-assertion-gates.mjs --apply.'); return; }

    await client.query('BEGIN');
    const u68 = (await client.query(
      `UPDATE probate_scrape_progress p SET enslaved_count = 0,
         error_text = COALESCE(p.error_text,'') || ' | #68 cleared: index-page/no-slavery-token false positive (was ' || p.enslaved_count || ')'
       FROM person_documents pd WHERE pd.id = p.person_document_id AND ${falseSet} RETURNING p.id`)).rowCount;
    const u69 = (await client.query(
      `UPDATE probate_scrape_progress p SET enslaved_count = 0,
         error_text = COALESCE(p.error_text,'') || ' | #69 quarantined: post-1827 (NY abolition) suspect, needs human review (was ' || p.enslaved_count || ')'
       FROM person_documents pd WHERE pd.id = p.person_document_id AND ${suspectSet} RETURNING p.id`)).rowCount;
    await client.query('COMMIT');
    console.log(`\ncleared ${u68} (#68) + quarantined ${u69} (#69). Now run: node scripts/recompute-assertion-gates.mjs --apply`);
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
