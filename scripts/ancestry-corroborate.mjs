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
    const limit = +val('--limit', '600');
    const county = val('--county', null);   // county-saturation mode: seed ALL enslavers in the county + record-sets
    const clean = (county || '').replace(/[^a-zA-Z ]/g, '');
    const where = county
      ? `person_type='enslaver' AND canonical_name IS NOT NULL AND primary_county ILIKE '%${clean}%'
         AND id NOT IN (SELECT canonical_person_id FROM ancestry_corroboration_queue WHERE canonical_person_id IS NOT NULL)`
      : `person_type='enslaver' AND canonical_name IS NOT NULL AND death_year_estimate IS NULL
         AND id NOT IN (SELECT canonical_person_id FROM ancestry_corroboration_queue WHERE canonical_person_id IS NOT NULL)`;
    const rows = (await pool.query(
      `SELECT id, canonical_name, primary_state, birth_year_estimate FROM canonical_persons WHERE ${where}
        ORDER BY (SELECT count(*) FROM person_documents d WHERE d.canonical_person_id = canonical_persons.id) ASC, id
        LIMIT ${limit}`)).rows;
    let n = 0;
    for (const r of rows) {
      const url = searchUrl(r.canonical_name, r.primary_state, r.birth_year_estimate);
      const confirm = `Confirm birth/death, PARENTAGE (father), residence; note any slave schedule / will / estate inventory naming the ENSLAVED this owner held.`;
      await pool.query(
        `INSERT INTO ancestry_corroboration_queue (canonical_person_id, person_name, search_url, what_to_confirm, priority)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (canonical_person_id) DO NOTHING`,
        [r.id, r.canonical_name, url, confirm, 100]);
      n++;
    }
    // County-saturation: seed the high-value county record-SETS (the bridge documents that name the enslaved), priority 10.
    let recs = 0;
    if (county) {
      const ev = `_${clean.replace(/ /g, '+')}-Virginia-USA`;
      const SETS = [
        [`${clean} Co VA — 1866 Cohabitation Register`, `keyword=cohabitation`, `THE BRIDGE: formerly-enslaved couples + their former ENSLAVER. FREE at Library of Virginia (Virginia Untold) + FamilySearch. Pull → auto-match enslaver names vs our ${clean} owners.`],
        [`${clean} Co VA — 1860 Slave Schedule`, `keyword=slave+schedule`, `Enslaved (age/sex) under each owner. FREE: FamilySearch / NARA M653.`],
        [`${clean} Co VA — 1850 Slave Schedule`, `keyword=slave+schedule+1850`, `FREE: FamilySearch / NARA M432.`],
        [`${clean} Co VA — Wills / Estate Inventories`, `keyword=will+estate+slaves`, `Named enslaved in estate divisions (like the Farm Book). FREE: Library of Virginia will books / Chancery Records Index.`],
        [`${clean} Co VA — Freedmen's Bureau`, `keyword=freedmen`, `Labor contracts naming enslaved↔enslaver. FREE: FamilySearch / NARA M1913.`],
        [`${clean} Co VA — 1870 Census (freedpeople)`, `keyword=1870+census`, `First census naming freedpeople → descendant chains. FREE: FamilySearch.`],
      ];
      for (const [name, kw, free] of SETS) {
        if ((await pool.query(`SELECT 1 FROM ancestry_corroboration_queue WHERE canonical_person_id IS NULL AND person_name=$1`, [name])).rows.length) continue;
        await pool.query(`INSERT INTO ancestry_corroboration_queue (canonical_person_id, person_name, search_url, what_to_confirm, priority)
          VALUES (NULL,$1,$2,$3,10)`, [name, `https://www.ancestrylibrary.com/search/?event=${ev}&${kw}`, free]);
        recs++;
      }
    }
    console.log(`seeded ${n} enslavers${county ? ' in ' + clean : ''} + ${recs} county record-sets into the queue.`);
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
