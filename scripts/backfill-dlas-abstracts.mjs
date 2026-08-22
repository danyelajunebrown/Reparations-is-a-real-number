// backfill-dlas-abstracts.mjs — put the DLAS abstract onto petition documents ingested before the ingest
// learned to store it, so they become embeddable.
//
// WHY: ingest-dlas-petitions.mjs wrote 13,198 documents with no ocr_text, because it never stored the
// abstract. A document with no text cannot be embedded, so those petitions were in the database and
// invisible to RAG — the same silo the RULE 0.5 enforcement fix closed for PEOPLE, still open for their
// EVIDENCE. The abstract is the richest thing DLAS publishes:
//   "Col. John Taylor ... 16,074 acres in three counties ... at least 240 slaves ... 200 shares of bridge
//    stock, 600 bales of cotton ... total value of about two hundred forty thousand dollars."
// That is a priced, dated estate description attached to a named enslaver, and it was being discarded.
//
// One JSON fetch per PETITION (not per document): many people share a petition, so this groups first.
// Politeness: ~1.1s between fetches, stop on 429/500.
//
// Usage: node scripts/backfill-dlas-abstracts.mjs --limit 200 [--apply]
import 'dotenv/config';
import pg from 'pg';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const LIMIT = +val('--limit', 200);
const GAP_MS = +val('--gap-ms', 1100);
const UA = 'reparations-research/1.0 (db7613@bard.edu; academic reparations research; contact welcome)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
  statement_timeout: 300000, query_timeout: 300000 });
pool.on('error', (e) => console.error(`[pool] ${e.message}`));

const rows = (await pool.query(`
  SELECT DISTINCT source_url FROM person_documents
   WHERE document_type='court_petition' AND created_by='ingest-dlas-petitions'
     AND (ocr_text IS NULL OR length(ocr_text) < 40)
   LIMIT $1`, [LIMIT])).rows;
console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} ${rows.length} petitions needing an abstract`);

let ok = 0, none = 0, err = 0, docs = 0;
for (const r of rows) {
  const pid = (String(r.source_url).match(/petition\/(\d+)/) || [])[1];
  if (!pid) { err++; continue; }
  try {
    const res = await fetch(`https://dlas.uncg.edu/petitions/petition/${pid}/json`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const meta = JSON.parse(await res.text()).petition[0];
    const subjects = (meta.subjects || []).map((s) => s.subject).filter(Boolean);
    const text = [meta.abstract || '', subjects.length ? `Subjects: ${subjects.join('; ')}` : '',
      `Result: ${meta.result || 'unrecorded'}`].filter(Boolean).join('\n\n');
    if (!text || text.length < 40) { none++; }
    else if (APPLY) {
      const u = await pool.query(
        `UPDATE person_documents SET ocr_text=$1
          WHERE source_url=$2 AND document_type='court_petition'
            AND (ocr_text IS NULL OR length(ocr_text) < 40) RETURNING id`, [text, r.source_url]);
      docs += u.rows.length; ok++;
    } else ok++;
  } catch (e) {
    err++;
    if (/429|500|503/.test(e.message)) { console.log('  ⛔ server pushing back — stopping this tick.'); break; }
  }
  await sleep(GAP_MS);
}
console.log(`=== petitions ok ${ok} · no abstract ${none} · errors ${err} · documents updated ${docs} ===`);
if (APPLY) console.log('RULE 0.5 — embed: node scripts/embed-documents.mjs');
await pool.end();
