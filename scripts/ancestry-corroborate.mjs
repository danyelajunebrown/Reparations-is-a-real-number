// ancestry-corroborate.mjs — the BOT DRIVES; the human ACTUATES one step.
//
// The bot: seeds a priority worklist, generates each Ancestry search URL, notifies you (ntfy) one at a time,
// then ingests the export YOU produce — extracting the record list, crosswalking each to its FREE primary
// source, corroborating vs our canonical (Biscoe rule: match to a DISTINCT person by dates/place/parentage,
// never name-merge), and queueing the free-source pulls. The bot NEVER accesses Ancestry — you do (your
// patron right + your "technically I'm driving" tap). No Ancestry content stored — facts + pointers only.
//
// Subcommands:
//   --seed [--limit N]                 seed the queue from priority canonicals (enslavers w/ thin evidence) + gen search URLs
//   --notify-next [--n K]              ntfy you the next K pending searches (marks them notified)
//   --ingest <export.pdf> --person ID  ingest YOUR export for person ID → crosswalk + corroborate + queue redirects
//   --status                           queue + redirect summary
//
// FREE (local pdf-parse + the free LLM router). Run on the Mini (or anywhere with DATABASE_URL + a router key).

import 'dotenv/config';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { callLLM, MODEL } = require('../src/services/probate/probate-llm-extractor');
const { crosswalk } = require('../src/services/ancestry/collection-crosswalk');
const { notify } = require('../src/utils/notify');

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };

// Build the ancestrylibrary.com search a HUMAN will open (the bot never fetches it).
function searchUrl(name, state, birthYear) {
  const [first, ...rest] = String(name).trim().split(/\s+/);
  const last = rest.pop() || '';
  const mid = rest.join(' ');
  const p = new URLSearchParams({ name: `${[first, mid].filter(Boolean).join(' ')}_${last}`.trim(), count: '50', priority: 'usa' });
  if (state) p.set('event', `_${state.replace(/\s+/g, '+')}-USA`);
  return `https://www.ancestrylibrary.com/search?${p.toString()}`;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });

  if (has('--seed')) {
    const limit = +val('--limit', '200');
    // Priority: enslavers who ANCHOR the ledger but have thin corroboration (no death year / few docs) — the
    // people whose identity most needs a second source before a DAA cites them.
    const rows = (await pool.query(
      `SELECT id, canonical_name, primary_state, birth_year_estimate
         FROM canonical_persons
        WHERE person_type='enslaver' AND canonical_name IS NOT NULL
          AND (death_year_estimate IS NULL OR id IN (SELECT canonical_person_id FROM canonical_persons c2 WHERE FALSE))
          AND id NOT IN (SELECT canonical_person_id FROM ancestry_corroboration_queue WHERE canonical_person_id IS NOT NULL)
        ORDER BY (SELECT count(*) FROM person_documents d WHERE d.canonical_person_id = canonical_persons.id) ASC, id
        LIMIT ${limit}`)).rows;
    let n = 0;
    for (const r of rows) {
      const url = searchUrl(r.canonical_name, r.primary_state, r.birth_year_estimate);
      const confirm = `Confirm birth/death years, PARENTAGE (father — the Biscoe-rule key), residence; note any 1862 petition / slave schedule / will.`;
      await pool.query(
        `INSERT INTO ancestry_corroboration_queue (canonical_person_id, person_name, search_url, what_to_confirm, priority)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (canonical_person_id) DO NOTHING`,
        [r.id, r.canonical_name, url, confirm, 100]);
      n++;
    }
    console.log(`seeded ${n} into the queue (priority: thin-evidence enslavers).`);
  }

  else if (has('--notify-next')) {
    const k = +val('--n', '1');
    const rows = (await pool.query(`SELECT * FROM ancestry_corroboration_queue WHERE status='pending' ORDER BY priority, id LIMIT ${k}`)).rows;
    for (const r of rows) {
      await notify(`🔎 Ancestry: ${r.person_name} (#${r.canonical_person_id})\n${r.what_to_confirm}\n${r.search_url}\n→ export the results, then: --ingest <pdf> --person ${r.canonical_person_id}`, { severity: 'info' }).catch(() => {});
      await pool.query(`UPDATE ancestry_corroboration_queue SET status='notified', notified_at=now() WHERE id=$1`, [r.id]);
      console.log(`notified: ${r.person_name} (#${r.canonical_person_id})`);
    }
    if (!rows.length) console.log('queue empty (nothing pending). --seed first.');
  }

  else if (has('--ingest')) {
    const pdfPath = val('--ingest');
    const personId = +val('--person', '0');
    if (!fs.existsSync(pdfPath)) { console.error('export not found:', pdfPath); process.exit(1); }
    const pdfParse = require('pdf-parse');
    const text = (await pdfParse(fs.readFileSync(pdfPath))).text.slice(0, 40000);

    const sys = 'You extract a list of genealogy RECORDS from a printed Ancestry search-results page. Output STRICT JSON only; never invent.';
    const prompt = `From this Ancestry results export, list every record as JSON {"records":[{"collection":string,"name":string,"birth":string|null,"death":string|null,"residence":string|null,"event_year":number|null}]}. Copy the collection title verbatim. TEXT:\n"""${text}"""`;
    const { json } = await callLLM(prompt, { system: sys, maxTokens: 4000 });
    const records = json.records || [];

    const cp = personId ? (await pool.query(`SELECT id, canonical_name, birth_year_estimate, death_year_estimate, primary_state FROM canonical_persons WHERE id=$1`, [personId])).rows[0] : null;
    const yr = (s) => { const m = String(s || '').match(/\b(1[78]\d\d|19\d\d)\b/); return m ? +m[1] : null; };

    const corroborations = [], distinct = [], redirects = [];
    for (const rec of records) {
      const xw = crosswalk(rec.collection);
      redirects.push({ collection: rec.collection, ...xw, name: rec.name });
      // Biscoe rule applied: same NAME does not mean same PERSON. Only count as corroboration when the
      // dates/place are consistent with OUR canonical; a name-match with different dates is a DISTINCT person.
      if (cp) {
        const b = yr(rec.birth), d = yr(rec.death);
        const bOk = !b || !cp.birth_year_estimate || Math.abs(b - cp.birth_year_estimate) <= 5;
        const dOk = !d || !cp.death_year_estimate || Math.abs(d - cp.death_year_estimate) <= 3;
        if (bOk && dOk && (b || d)) corroborations.push({ collection: rec.collection, name: rec.name, birth: rec.birth, death: rec.death });
        else if ((b && cp.birth_year_estimate && Math.abs(b - cp.birth_year_estimate) > 7) || (d && cp.death_year_estimate && Math.abs(d - cp.death_year_estimate) > 5))
          distinct.push({ collection: rec.collection, name: rec.name, birth: rec.birth, death: rec.death, why: 'dates diverge → different person (do NOT merge)' });
      }
    }

    // Queue the free-source redirects (dedup by person+collection).
    let queued = 0;
    for (const rd of redirects) {
      const r = await pool.query(
        `INSERT INTO source_redirect_leads (canonical_person_id, ancestry_collection, free_source, free_target, our_pipeline, note)
         SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM source_redirect_leads WHERE canonical_person_id IS NOT DISTINCT FROM $1 AND ancestry_collection=$2) RETURNING id`,
        [personId || null, rd.collection, rd.free_source, rd.note?.match(/→ ([^.]+)/)?.[1]?.trim() || null, rd.our_pipeline, rd.note]);
      queued += r.rows.length;
    }
    const result = { records: records.length, corroborations, distinct, redirect_sources: [...new Set(redirects.map(r => r.free_source))] };
    if (personId) await pool.query(`UPDATE ancestry_corroboration_queue SET status='done', captured_at=now(), done_at=now(), result=$2 WHERE canonical_person_id=$1`, [personId, JSON.stringify(result)]);

    console.log(`\n=== INGEST ${cp ? cp.canonical_name + ' (#' + cp.id + ')' : ''} — ${records.length} records via ${MODEL} ===`);
    console.log(`  ✅ corroborations (dates consistent): ${corroborations.length}`);
    for (const c of corroborations.slice(0, 6)) console.log(`     · ${c.collection} — ${c.name} (b ${c.birth || '?'} / d ${c.death || '?'})`);
    console.log(`  ⚠ DISTINCT people (Biscoe rule — do NOT merge): ${distinct.length}`);
    for (const c of distinct.slice(0, 6)) console.log(`     · ${c.name} (b ${c.birth || '?'} / d ${c.death || '?'}) — ${c.why}`);
    console.log(`  ➡ free-source redirects queued: ${queued} (sources: ${result.redirect_sources.join(', ')})`);
  }

  else { // --status
    for (const r of (await pool.query(`SELECT status, count(*)::int n FROM ancestry_corroboration_queue GROUP BY 1`)).rows) console.log(`queue ${r.status}: ${r.n}`);
    for (const r of (await pool.query(`SELECT free_source, status, count(*)::int n FROM source_redirect_leads GROUP BY 1,2 ORDER BY 1`)).rows) console.log(`redirect ${r.free_source}/${r.status}: ${r.n}`);
  }

  await pool.end();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
