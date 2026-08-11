// embed-verbs.mjs — make the RELATIONSHIPS, TRANSACTIONS and NULL FINDINGS retrievable.
//
// THE GAP THIS CLOSES (measured 2026-08-10)
//   RULE 0.5 has been applied to the NOUNS and not the VERBS. Persons and documents are embedded; nothing
//   else is:
//       chattel_transfer_events  48,987 rows -> 0 embedded
//       canonical_family_edges    7,905      -> 0
//       research_findings         1,173      -> 0
//   So RAG can answer "who is this person" and "what does this page say", but NOT "who was sold to whom",
//   "who is related to whom", or -- the expensive one -- "what have we already searched for and failed to
//   find". `research_findings` exists precisely so a stalled line is distinguishable from an unworked one
//   (plan-descent-first-lineage §5.6). Unretrievable, that distinction is invisible to anything reaching
//   through RAG, and the system re-does work it already knows failed. A null result you cannot find is
//   indistinguishable from never having looked.
//
// WHY SENTENCES AND NOT COLUMN DUMPS
//   These are embedded as natural-language assertions ("X was sold to Y in 1834 in Orange County,
//   Virginia") because that is the shape a question arrives in. A concatenated row of ids retrieves nothing.
//
// Carries the two lessons from today's failures: a --timeout well above ollama's queue depth (it QUEUES
// embeds; it does not serve them concurrently), and a pool 'error' handler so a dropped idle connection
// cannot kill a long resumable run.
//
// Usage:
//   node scripts/embed-verbs.mjs --kind findings [--limit N] [--apply]
//   node scripts/embed-verbs.mjs --kind edges --apply
//   node scripts/embed-verbs.mjs --kind transfers --limit 5000 --apply
//   node scripts/embed-verbs.mjs --kind all --apply

import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';

const A = process.argv.slice(2);
const APPLY = A.includes('--apply');
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const KIND = val('--kind', 'findings');
const LIMIT = +val('--limit', 100000);
const CONC = +val('--conc', 3);
const TIMEOUT = +val('--timeout', 180000);
const MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/embeddings';

async function embed(text, retries = 2) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(OLLAMA, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, prompt: String(text).slice(0, 6000) }), signal: AbortSignal.timeout(TIMEOUT) });
      if (!r.ok) throw new Error('ollama ' + r.status);
      const v = (await r.json()).embedding;
      if (!Array.isArray(v) || !v.length) throw new Error('empty embedding');
      return v;
    } catch (e) { last = e; if (i < retries) await new Promise((s) => setTimeout(s, 2000 * (i + 1))); }
  }
  throw last;
}

// Each kind supplies: the rows still needing an embedding, and a sentence for each.
const KINDS = {
  // The most valuable of the three. A search that found nothing is a fact about the archive.
  findings: {
    table: 'research_findings', idCol: 'finding_id', contentKind: 'research_finding',
    sql: `SELECT f.finding_id AS id, f.question, f.repository, f.index_searched, f.result, f.hit_count,
                 f.scope_note, f.evidence_note
            FROM research_findings f
           WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='research_findings'
                              AND e.subject_id = f.finding_id::text AND e.content_kind='research_finding')`,
    text: (r) => [
      `Research question: ${r.question}`,
      `Searched: ${r.repository || 'unspecified repository'}${r.index_searched ? ' — ' + r.index_searched : ''}`,
      `Result: ${r.result}${r.hit_count != null ? ` (${r.hit_count} hits)` : ''}`,
      r.scope_note ? `Scope: ${r.scope_note}` : '',
      r.evidence_note ? `Notes: ${r.evidence_note}` : '',
      r.result === 'none' ? 'This was SEARCHED AND NOT FOUND — an absence of record, not an absence of research.' : '',
    ].filter(Boolean).join('\n'),
  },

  edges: {
    table: 'canonical_family_edges', idCol: 'id', contentKind: 'kin_edge',
    sql: `SELECT e.id,
                 COALESCE(ua.full_name, ca.canonical_name) AS a_name,
                 COALESCE(ub.full_name, cb.canonical_name) AS b_name,
                 e.relationship_type, e.information_type, e.informant_role, e.confidence,
                 e.verified, e.source_document_id, e.notes
            FROM canonical_family_edges e
            LEFT JOIN unconfirmed_persons ua ON e.a_subject_table='unconfirmed_persons' AND ua.lead_id=e.a_subject_id
            LEFT JOIN unconfirmed_persons ub ON e.b_subject_table='unconfirmed_persons' AND ub.lead_id=e.b_subject_id
            LEFT JOIN canonical_persons  ca ON ca.id = COALESCE(e.person_a_id, CASE WHEN e.a_subject_table='canonical_persons' THEN e.a_subject_id END)
            LEFT JOIN canonical_persons  cb ON cb.id = COALESCE(e.person_b_id, CASE WHEN e.b_subject_table='canonical_persons' THEN e.b_subject_id END)
           WHERE NOT EXISTS (SELECT 1 FROM embeddings em WHERE em.subject_table='canonical_family_edges'
                              AND em.subject_id = e.id::text AND em.content_kind='kin_edge')`,
    text: (r) => {
      const rel = { parent_of: 'is the parent of', child_of: 'is the child of', spouse: 'is the spouse of', sibling_of: 'is the sibling of' }[r.relationship_type] || r.relationship_type;
      if (!r.a_name || !r.b_name) return null;   // an edge whose endpoints have no names retrieves nothing
      return [
        `${r.a_name} ${rel} ${r.b_name}.`,
        `Relationship type: ${r.relationship_type}. Confidence ${r.confidence}${r.verified ? ', VERIFIED' : ', unverified (candidate for human review)'}.`,
        r.information_type ? `Evidence: ${r.information_type} information from a ${r.informant_role || 'unstated informant'}.` : '',
        r.source_document_id ? `Documented by source document #${r.source_document_id}.` : 'No source document attached.',
        r.notes || '',
      ].filter(Boolean).join(' ');
    },
  },

  transfers: {
    table: 'chattel_transfer_events', idCol: 'id', contentKind: 'chattel_transfer',
    sql: `SELECT t.id, t.enslaved_name_text, t.from_enslaver_name, t.to_enslaver_name, t.transfer_type,
                 t.transfer_year, t.value_amount, t.value_currency, t.place_state, t.place_locality,
                 t.source_citation, t.confidence
            FROM chattel_transfer_events t
           WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='chattel_transfer_events'
                              AND e.subject_id = t.id::text AND e.content_kind='chattel_transfer')`,
    text: (r) => {
      const who = r.enslaved_name_text || 'An unnamed enslaved person';
      const from = r.from_enslaver_name ? ` from ${r.from_enslaver_name}` : '';
      const to = r.to_enslaver_name ? ` to ${r.to_enslaver_name}` : '';
      const where = [r.place_locality, r.place_state].filter(Boolean).join(', ');
      const price = r.value_amount ? ` Price: ${r.value_amount} ${r.value_currency || ''}.`.trimEnd() : ' No price recorded in the source.';
      return `${who} was transferred${from}${to}` +
        `${r.transfer_year ? ' in ' + r.transfer_year : ''}${where ? ' at ' + where : ''}` +
        ` (${r.transfer_type || 'transfer'}).${price}` +
        `${r.source_citation ? ' Source: ' + String(r.source_citation).slice(0, 400) : ''}`;
    },
  },
};

async function runKind(pool, key) {
  const K = KINDS[key];
  if (!K) { console.error(`unknown --kind ${key}`); return; }
  const rows = (await pool.query(K.sql + ` LIMIT ${LIMIT}`)).rows;
  console.log(`\n[${key}] ${rows.length} row(s) need an embedding · model=${MODEL}${APPLY ? '' : ' [DRY RUN]'}`);
  if (!APPLY) { const s = rows.slice(0, 2).map(K.text).filter(Boolean); s.forEach((t) => console.log('  ─ ' + t.replace(/\n/g, ' | ').slice(0, 200))); return; }

  let ok = 0, skipped = 0, err = 0;
  for (let i = 0; i < rows.length; i += CONC) {
    await Promise.all(rows.slice(i, i + CONC).map(async (r) => {
      const text = K.text(r);
      if (!text) { skipped++; return; }
      try {
        const vec = await embed(text);
        await pool.query(
          `INSERT INTO embeddings (subject_table, subject_id, content_kind, model, embedding, content_hash)
           VALUES ($1,$2,$3,$4,$5::vector,$6) ON CONFLICT DO NOTHING`,
          [K.table, String(r.id), K.contentKind, MODEL, '[' + vec.join(',') + ']',
           crypto.createHash('sha256').update(text).digest('hex')]);
        ok++;
      } catch (e) { err++; if (err % 25 === 1) console.log(`  err ${K.table}#${r.id}: ${e.message.slice(0, 60)}`); }
    }));
    if ((i / CONC) % 20 === 0) process.stdout.write(`\r  ${ok} embedded, ${skipped} skipped, ${err} err   `);
  }
  console.log(`\n[${key}] done: ${ok} embedded · ${skipped} skipped (unnameable) · ${err} errors`);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  const kinds = KIND === 'all' ? ['findings', 'edges', 'transfers'] : [KIND];
  for (const k of kinds) await runKind(pool, k);
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
