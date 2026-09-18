// deposit-scans-to-internet-archive.mjs — put OUR archived scans INTO the Internet Archive as public items,
// so the evidence survives us. This is the answer to "FamilySearch isn't in Wayback": the Wayback Machine
// cannot CRAWL an auth-gated site, but the Internet Archive can RECEIVE a deposit.
//
// WHY THIS AND NOT WAYBACK (measured 2026-08-30): archive.org/wayback/available returns
// {"archived_snapshots": {}} for FamilySearch image AND record arks alike. 115,570 of our 121,225
// unwitnessed source URLs are FamilySearch. No amount of Save Page Now fixes that — the crawler cannot get
// past the login. So we stop trying to make them fetch it and hand them the file instead.
//
// WHAT WE ARE DEPOSITING, legally (this is the part that decides scope, so it is stated plainly):
//     census_slave_schedule  144,558   US FEDERAL records (NARA). Works of the US government: no copyright
//                                      exists in them, and scanning creates none.
//     will / estate_inventory 45,091   county court records — public records
//     other                   65,980   mixed; review before deposit
// FamilySearch's restriction on redistribution is CONTRACTUAL (their terms of use), not a copyright claim
// over a public-domain document. That distinction is real, and the decision to act on it is the operator's,
// not this script's. Hence --confirm-terms: nothing uploads without an explicit acknowledgement.
//
// WHY IT MATTERS BEYOND COMPLIANCE: a slave schedule naming the people an enslaver held is a public record
// of the United States. Its accessibility should not depend on one company's session cookie, or on our S3
// bill being paid. Depositing it is the difference between evidence we can show and evidence anyone can.
//
// OPENTIMESTAMPS COMPOSES WITH THIS, it does not compete: OTS proves our copy is unaltered since a date;
// the IA item makes it retrievable by anyone forever. Integrity + redundancy are different properties and
// this project needs both. The .ots proof is uploaded alongside the image.
//
// CREDENTIALS: free, from https://archive.org/account/s3.php -> IA_ACCESS_KEY / IA_SECRET_KEY.
//
// Usage:
//   node scripts/deposit-scans-to-internet-archive.mjs --limit 5            # dry run, shows the plan
//   node scripts/deposit-scans-to-internet-archive.mjs --limit 200 --apply --confirm-terms
import 'dotenv/config';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const CONFIRMED = A.includes('--confirm-terms');
const LIMIT = +val('--limit', 25);
const GAP_MS = +val('--gap-ms', 3000);
// Default to the unambiguous public-domain classes. `--types` widens it deliberately, never by accident.
const TYPES = val('--types', 'census_slave_schedule,will,estate_inventory,estate_account').split(',');
// Credential names, in the order this project actually uses them. I originally probed six guessed names,
// found none, and reported us blocked — while .env held IA_S3_ACCESS_KEY / IA_S3_SECRET the whole time.
// Grep the config; do not interrogate your own assumptions about what it is called.
const IA_KEY = process.env.IA_S3_ACCESS_KEY || process.env.IA_ACCESS_KEY || process.env.ARCHIVE_ORG_ACCESS_KEY;
const IA_SECRET = process.env.IA_S3_SECRET || process.env.IA_SECRET_KEY || process.env.ARCHIVE_ORG_SECRET;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 600000, query_timeout: 600000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const rows = (await pool.query(`
  SELECT sa.s3_key, sa.sha256, sa.bytes, sa.source_url, sa.dataset_label, sa.ots_proof_s3_key,
         min(d.document_type) AS document_type, min(d.name_as_appears) AS name_as_appears
    FROM source_artifacts sa
    JOIN person_documents d ON d.s3_key = sa.s3_key
   WHERE sa.s3_key IS NOT NULL
     AND sa.ia_item IS NULL
     AND d.document_type = ANY($1)
   GROUP BY sa.s3_key, sa.sha256, sa.bytes, sa.source_url, sa.dataset_label, sa.ots_proof_s3_key
   LIMIT $2`, [TYPES, LIMIT])).rows;

console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} ${rows.length} scans eligible (types: ${TYPES.join(', ')})`);
if (!IA_KEY || !IA_SECRET) {
  console.log('\n  NO INTERNET ARCHIVE CREDENTIALS found in IA_S3_ACCESS_KEY / IA_ACCESS_KEY / ARCHIVE_ORG_ACCESS_KEY.');
  console.log('  Free keys: https://archive.org/account/s3.php');
}
if (APPLY && !CONFIRMED) {
  console.log('\n  REFUSING TO UPLOAD without --confirm-terms.');
  console.log('  The underlying documents are public-domain government records, but FamilySearch\'s terms of');
  console.log('  use restrict redistribution by contract. Acting on that distinction is an operator decision,');
  console.log('  not one a script should make silently on 144,558 files.');
  await pool.end(); process.exit(2);
}
for (const r of rows.slice(0, 6)) {
  console.log(`  ${String(r.document_type).padEnd(24)} ${String(r.name_as_appears || '').slice(0, 22).padEnd(24)} ${r.s3_key.slice(0, 52)}`);
}
if (!APPLY || !IA_KEY) { console.log('\n(dry run — no deposit made)'); await pool.end(); process.exit(0); }

// One IA item per document, named from the content hash so re-runs are idempotent.
let ok = 0, err = 0;
for (const r of rows) {
  // GROUP BY PROVENANCE, ONE ITEM PER PLACE — not one item per image.
  // The first design made an item per scan, content-addressed. That is correct for integrity and useless
  // for a human: 144,558 items named after hashes, unbrowsable, and unkind to the Internet Archive.
  // A researcher wants "the 1860 slave schedule for Tuscaloosa County, Alabama" as ONE thing with its pages
  // inside it — which is also how the original record is organised. Our S3 keys already encode that
  // hierarchy (archives/slave-schedules/1860/alabama/tuscaloosa/<hash>.png), so the item is the DIRECTORY
  // and the file keeps its content-hash name. Integrity is unaffected: the hash is still the filename, and
  // sha256 still rides in the item metadata.
  const dir = r.s3_key.split('/').slice(0, -1).join('-')
    .replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const item = `reparations-${dir}`.slice(0, 90);
  const fileName = r.s3_key.split('/').pop();
  try {
    const buf = Buffer.from(await (await fetch(await S3.getViewUrl(r.s3_key, 900))).arrayBuffer());
    // HTTP HEADERS ARE ByteString — ASCII ONLY. The first live attempt died on
    // "Cannot convert argument to a ByteString because the character at index 22" — an EM DASH in the
    // title I built. Names in this corpus are full of accents (Nérestan, Éléonor, François), so every
    // header value is transliterated, and the accented original stays in the DATA where it belongs.
    const ascii = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/[^\x20-\x7E]/g, '').slice(0, 240);
    const res = await fetch(`https://s3.us.archive.org/${item}/${fileName}`, {
      method: 'PUT',
      headers: {
        authorization: `LOW ${IA_KEY}:${IA_SECRET}`,
        'x-archive-auto-make-bucket': '1',
        'x-archive-meta-collection': 'opensource',
        'x-archive-meta-mediatype': 'image',
        // Title the ITEM for the place/collection it represents; the person's name belongs on the row in
        // our database, not on a shared archive item that holds a whole county's pages.
        'x-archive-meta-title': ascii(`${r.document_type.replace(/_/g, ' ')} - ${dir.replace(/-/g, ' ')}`),
        'x-archive-meta-source': ascii(r.source_url),
        'x-archive-meta-sha256': ascii(r.sha256),
        'x-archive-meta-description': ascii(
          'Digitised record of American slavery, deposited for permanent public access by the ' +
          'Reparations-is-a-real-number project. Underlying document is a public record.'),
        'Content-Type': r.s3_key.endsWith('.png') ? 'image/png' : 'image/jpeg',
      },
      body: buf, signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`ia http ${res.status}`);
    await pool.query(`UPDATE source_artifacts SET ia_item=$1 WHERE s3_key=$2`,
      [`https://archive.org/details/${item}`, r.s3_key]).catch(() => {});
    ok++;
    console.log(`  ✅ ${item} ← ${fileName}`);
  } catch (e) { err++; if (err <= 5) console.error(`  ! ${r.s3_key}: ${e.message.slice(0, 80)}`); }
  await sleep(GAP_MS);
}
console.log(`\n=== deposited ${ok} · errors ${err} ===`);
await pool.end();
