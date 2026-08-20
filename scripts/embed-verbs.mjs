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

  // ── INSTRUMENTS AND ASSETS ────────────────────────────────────────────────────────────────────────
  // Operator, 2026-08-20: "RAG should be just as concerned with the instruments and assets as the
  // genealogy." Correct, and the first pass under-built it: kin edges, transfers and findings were
  // embedded while the voyages, holdings, inheritances, insurance policies and estate transfers -- the
  // reparations-relevant half -- were left unretrievable. A ledger you cannot query is a filing cabinet.

  ownership: {
    table: 'enslaved_owner_relationships', idCol: 'id', contentKind: 'ownership_claim',
    sql: `SELECT r.id, r.enslaved_name, r.owner_name, r.relationship_type, r.start_year, r.end_year,
                 r.relationship_source, r.source_context, r.confidence_score, r.verification_status
            FROM enslaved_owner_relationships r
           WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='enslaved_owner_relationships'
                              AND e.subject_id=r.id::text AND e.content_kind='ownership_claim')`,
    text: (r) => {
      if (!r.enslaved_name) return null;
      const yrs = [r.start_year, r.end_year].filter(Boolean).join('-');
      return `${r.enslaved_name} was held as enslaved${r.owner_name ? ' by ' + r.owner_name : ' (holder not identified)'}` +
        `${yrs ? ' (' + yrs + ')' : ''}. Relationship: ${r.relationship_type || 'enslaved_by'}, ` +
        `source: ${r.relationship_source || 'unstated'}, confidence ${r.confidence_score}, ${r.verification_status || 'unverified'}.` +
        `${r.source_context ? ' ' + String(r.source_context).slice(0, 300) : ''}`;
    },
  },

  voyages: {
    table: 'slavevoyages_voyages', idCol: 'voyageid', contentKind: 'slaving_voyage',
    sql: `SELECT v.voyageid AS id, v.shipname, v.nationality, v.captain_a, v.owners,
                 v.port_departure, v.port_arrival, v.year_departure, v.year_arrival,
                 v.enslaved_embarked, v.enslaved_disembarked, v.enslaved_died_crossing, v.tonnage
            FROM slavevoyages_voyages v
           WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='slavevoyages_voyages'
                              AND e.subject_id=v.voyageid::text AND e.content_kind='slaving_voyage')`,
    text: (r) => {
      const died = r.enslaved_died_crossing;
      return `The slaving voyage of the ship ${r.shipname || '(unnamed)'}` +
        `${r.nationality ? ' (' + r.nationality + ')' : ''}${r.tonnage ? ', ' + r.tonnage + ' tons' : ''}` +
        `${r.captain_a ? ', captain ' + r.captain_a : ''}${r.owners ? ', owners ' + String(r.owners).slice(0, 120) : ''}. ` +
        `Departed ${r.port_departure || 'unknown port'}${r.year_departure ? ' in ' + r.year_departure : ''}, ` +
        `arrived ${r.port_arrival || 'unknown port'}${r.year_arrival ? ' in ' + r.year_arrival : ''}. ` +
        `${r.enslaved_embarked || 0} people embarked, ${r.enslaved_disembarked || 0} disembarked` +
        `${died ? `, ${died} DIED DURING THE CROSSING` : ''}.`;
    },
  },

  inheritance: {
    table: 'inheritance_edges', idCol: 'id', contentKind: 'inheritance',
    sql: `SELECT i.id, i.relationship_to_testator, i.asset_type, i.asset_description, i.asset_value_usd_est,
                 i.enslaved_persons_count, i.document_year, i.document_jurisdiction, i.document_reference,
                 i.evidence_tier, i.confidence, i.verified,
                 COALESCE(ct.canonical_name, ut.full_name) AS testator,
                 COALESCE(ch.canonical_name, uh.full_name) AS heir
            FROM inheritance_edges i
            LEFT JOIN canonical_persons ct ON ct.id = i.testator_id
            LEFT JOIN canonical_persons ch ON ch.id = i.heir_id
            LEFT JOIN unconfirmed_persons ut ON ut.lead_id = i.testator_id
            LEFT JOIN unconfirmed_persons uh ON uh.lead_id = i.heir_id
           WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='inheritance_edges'
                              AND e.subject_id=i.id::text AND e.content_kind='inheritance')`,
    text: (r) => {
      const who = [r.testator, r.heir].filter(Boolean).length;
      if (!who) return null;
      return `${r.testator || 'An unidentified testator'} bequeathed to ${r.heir || 'an unidentified heir'}` +
        `${r.relationship_to_testator ? ' (' + r.relationship_to_testator + ')' : ''}: ` +
        `${r.asset_type || 'unspecified assets'}${r.asset_description ? ' — ' + String(r.asset_description).slice(0, 200) : ''}. ` +
        `${r.enslaved_persons_count ? `THIS BEQUEST INCLUDED ${r.enslaved_persons_count} ENSLAVED PEOPLE. ` : ''}` +
        `${r.asset_value_usd_est ? 'Estimated value $' + r.asset_value_usd_est + '. ' : ''}` +
        `${r.document_year ? r.document_year + ' ' : ''}${r.document_jurisdiction || ''} ${r.document_reference || ''}`.trim() +
        `. Evidence tier ${r.evidence_tier}, confidence ${r.confidence}${r.verified ? ', verified' : ', unverified'}.`;
    },
  },

  insurance: {
    table: 'slave_era_insurance_policies', idCol: 'policy_id', contentKind: 'insurance_policy',
    sql: `SELECT p.policy_id AS id, p.policy_number, p.underwriter_name, p.modern_successor, p.policy_year,
                 p.slaveholder_name, p.slaveholder_state, p.enslaved_name, p.enslaved_age,
                 p.enslaved_occupation, p.face_value_usd, p.premium_usd, p.registry_source
            FROM slave_era_insurance_policies p
           WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='slave_era_insurance_policies'
                              AND e.subject_id=p.policy_id::text AND e.content_kind='insurance_policy')`,
    text: (r) => `Life insurance policy${r.policy_number ? ' no. ' + r.policy_number : ''} underwritten by ` +
      `${r.underwriter_name || 'an unnamed insurer'}${r.modern_successor ? ' (modern successor: ' + r.modern_successor + ')' : ''}` +
      `${r.policy_year ? ' in ' + r.policy_year : ''}, insuring the life of the enslaved person ` +
      `${r.enslaved_name || '(unnamed)'}${r.enslaved_age ? ', age ' + r.enslaved_age : ''}` +
      `${r.enslaved_occupation ? ', ' + r.enslaved_occupation : ''}, for the benefit of the slaveholder ` +
      `${r.slaveholder_name || '(unnamed)'}${r.slaveholder_state ? ' of ' + r.slaveholder_state : ''}. ` +
      `${r.face_value_usd ? 'Face value $' + r.face_value_usd + '. ' : ''}${r.premium_usd ? 'Premium $' + r.premium_usd + '. ' : ''}` +
      `The insurer profited from premiums on a human being. Source: ${r.registry_source || 'unstated'}.`,
  },

  estates: {
    table: 'wealth_transfer_events', idCol: 'id', contentKind: 'wealth_transfer',
    sql: `SELECT w.id, w.display_name, w.event_type, w.event_year, w.debtor_name_denormalized,
                 w.state_or_province, w.county, w.court_or_authority, w.total_estate_value_usd,
                 w.enslaved_persons_count, w.enslaved_persons_appraised_value_usd, w.primary_citation
            FROM wealth_transfer_events w
           WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='wealth_transfer_events'
                              AND e.subject_id=w.id::text AND e.content_kind='wealth_transfer')`,
    text: (r) => `${r.display_name || r.event_type || 'A wealth transfer event'}` +
      `${r.debtor_name_denormalized ? ' — estate of ' + r.debtor_name_denormalized : ''}` +
      `${r.event_year ? ', ' + r.event_year : ''}${r.county ? ', ' + r.county + ' County' : ''}` +
      `${r.state_or_province ? ', ' + r.state_or_province : ''}` +
      `${r.court_or_authority ? ' (' + r.court_or_authority + ')' : ''}. ` +
      `${r.enslaved_persons_count ? `${r.enslaved_persons_count} enslaved people were part of this estate. ` : ''}` +
      `${r.enslaved_persons_appraised_value_usd ? `They were appraised at $${r.enslaved_persons_appraised_value_usd}. ` : ''}` +
      `${r.total_estate_value_usd ? `Total estate value $${r.total_estate_value_usd}. ` : ''}` +
      `${r.primary_citation ? 'Source: ' + String(r.primary_citation).slice(0, 200) : ''}`,
  },

  // ── THE ASSERTION STORE ───────────────────────────────────────────────────────────────────────────
  // person_facts is the answer to "is a table even the right storage at scale?" (operator, 2026-08-20).
  // It is a typed, provenanced, CONTESTABLE assertion store: open fact_type vocabulary, dates with
  // precision, place to locality, related person, full source chain, confidence, and -- crucially --
  // `contested` + `contested_reason`. So DLAS's 127 subject terms become fact_type VALUES, not 86 new
  // tables. And freedom is modelled correctly: a free_status fact can be CONTESTED and revoked, which is
  // what actually happened (kidnapping of free people, re-enslavement, apprenticeship, vagrancy law).
  // 497,851 rows and NONE embedded -- the largest unretrievable store in the system, and the layer the
  // whole three-layer design (ledger tables / assertions / vectors) rests on.
  facts: {
    table: 'person_facts', idCol: 'id', contentKind: 'person_fact',
    sql: `SELECT f.id, f.fact_type, f.date_text, f.date_year, f.place_text, f.place_state, f.place_county,
                 f.value_text, f.related_name_text, f.source_citation, f.confidence,
                 f.verification_status, f.contested, f.contested_reason,
                 COALESCE(cp.canonical_name, up.full_name) AS person
            FROM person_facts f
            LEFT JOIN canonical_persons cp ON cp.id = f.person_id
            LEFT JOIN unconfirmed_persons up ON up.lead_id = f.person_id
           WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='person_facts'
                              AND e.subject_id = f.id::text AND e.content_kind='person_fact')`,
    text: (r) => {
      if (!r.person && !r.related_name_text) return null;
      const who = r.person || 'An unidentified person';
      const when = r.date_text || (r.date_year ? String(r.date_year) : '');
      const where = [r.place_locality, r.place_county && r.place_county + ' County', r.place_state]
        .filter(Boolean).join(', ') || r.place_text || '';
      return `${who} — ${String(r.fact_type).replace(/_/g, ' ')}` +
        `${r.value_text ? ': ' + String(r.value_text).slice(0, 200) : ''}` +
        `${r.related_name_text ? ' (relating to ' + r.related_name_text + ')' : ''}` +
        `${when ? ', ' + when : ''}${where ? ', ' + where : ''}. ` +
        `${r.contested ? `THIS FACT IS CONTESTED: ${r.contested_reason || 'reason unstated'}. ` : ''}` +
        `Confidence ${r.confidence ?? 'unstated'}, ${r.verification_status || 'unverified'}.` +
        `${r.source_citation ? ' Source: ' + String(r.source_citation).slice(0, 250) : ''}`;
    },
  },

  // ── CANONICAL PERSONS, EMBEDDED DIRECTLY ─────────────────────────────────────────────────────────
  // Canonicals were retrievable only INDIRECTLY, through the lead they were promoted from -- so ~46% had
  // no embedding path at all, and the rest were indexed by stale PRE-promotion text (#151). Worse, some
  // promoters mint the canonical without writing confirmed_individual_id back on the lead OR copying the
  // external id across, leaving the canonical orphaned from both directions: 4,540 named enslaved people
  // promoted 2026-08-19 were fully embedded as leads and unreachable as canonicals. A status written
  // without its pointer -- the same defect as 68,320 enslaved leads marked 'promoted' with a null link.
  // Embedding the canonical from its CURRENT profile removes the dependency on a traversal that may not
  // exist, and indexes what the person actually is now rather than what the lead said before merges.
  canonicals: {
    table: 'canonical_persons', idCol: 'id', contentKind: 'canonical_profile',
    sql: `SELECT cp.id, cp.canonical_name, cp.person_type, cp.birth_year_estimate, cp.death_year_estimate,
                 cp.sex, cp.primary_state, cp.primary_county, cp.primary_plantation,
                 cp.assertable_slaveowner, cp.assertable_enslaved, cp.created_by,
                 (SELECT count(*) FROM person_documents d WHERE d.canonical_person_id=cp.id AND d.s3_key IS NOT NULL)::int AS scans
            FROM canonical_persons cp
           WHERE cp.person_type <> 'merged'
             AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.subject_table='canonical_persons'
                              AND e.subject_id = cp.id::text AND e.content_kind='canonical_profile')`,
    text: (r) => {
      if (!r.canonical_name) return null;
      const life = [r.birth_year_estimate ? 'b. ' + r.birth_year_estimate : '',
                    r.death_year_estimate ? 'd. ' + r.death_year_estimate : ''].filter(Boolean).join(', ');
      const place = [r.primary_plantation, r.primary_county && r.primary_county + ' County', r.primary_state]
        .filter(Boolean).join(', ');
      const role = { enslaved: 'an enslaved person', enslaver: 'an enslaver', freedperson: 'a freedperson',
                     descendant: 'a descendant', unknown: 'a person of undetermined role' }[r.person_type] || r.person_type;
      return `${r.canonical_name} — ${role}${r.sex ? ', ' + r.sex : ''}${life ? ', ' + life : ''}` +
        `${place ? ', of ' + place : ''}. ` +
        `${r.scans ? `${r.scans} archived source document(s).` : 'No archived source document.'} ` +
        `${r.assertable_enslaved ? 'Documented as enslaved. ' : ''}${r.assertable_slaveowner ? 'Documented as a slaveholder. ' : ''}` +
        `Record established by ${r.created_by || 'an unrecorded process'}.`;
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
  const kinds = KIND === 'all' ? ['findings', 'edges', 'transfers', 'ownership', 'inheritance', 'insurance', 'estates', 'voyages', 'facts'] : [KIND];
  for (const k of kinds) await runKind(pool, k);
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
