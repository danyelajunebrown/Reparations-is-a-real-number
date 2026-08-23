// ingest-marronnage-named.mjs — ingest the NAMED self-liberating people of Le marronnage dans le monde
// atlantique (CNRS/EHESS), off the site's own curated name index.
//
// THE DESIGN DECISION THAT MATTERS (and the DLAS lesson that forced it)
//   DLAS taught us this the expensive way on 2026-08-21: its CSV `enslavedCount` looked like a count of
//   nameable enslaved people and was in fact an AGGREGATE of people MENTIONED — 8 petitions claiming 1,951
//   enslaved named ZERO. Ordering by that field selected precisely the records with nobody in them.
//   So here we do NOT parse names out of ad text, and we do NOT infer people from counts. We use the
//   curators' own index: the search page ships `var names = [...]` with 3,705 entries — "Aamon", "Aaron",
//   "Abby (Babby)", "Abela ou Abeillard" — aliases and spelling variants preserved by scholars who read the
//   ads. Every person we mint is a person a historian already identified. That is the difference between a
//   record and a guess, and it is why the tally-mark fabrication cannot recur here.
//
// WHAT AN AD GIVES US THAT AN INVENTORY NEVER DOES
//   A probate inventory records a person as property at a moment of transfer. A runaway ad records a person
//   REFUSING that — and because the enslaver wanted them caught, it describes them in detail:
//       "Un Negre nouveau, nation Congo, étampé Ch, est maron depuis trois semaines."
//   African origin (Congo), recency of arrival, duration of flight, and a BRAND reading the enslaver's own
//   initials. The mark of ownership IS the mark of harm, in the same three letters. Corpus-wide, counted
//   from the source's own index (NOT sampled — see finding-marronnage-corpus-aug20):
//       étampé/BRANDED 9,915 (44%) · marqué au fer 1,988 · cicatrice 778 · geôle 721 · fouet 113
//       nation/AFRICAN ETHNONYM 2,975 · récompense 4,367
//   Branding and scarring become harm_events; nation becomes a person_fact of ORIGIN, a field almost
//   nothing else we hold carries.
//
// CLASS-AGNOSTIC (operator, 2026-08-21). person_type comes from the record, not from the pipeline: a person
// indexed by this corpus is one the ads describe as enslaved and self-liberating. We record BOTH — the
// status AND the act — because "enslaved" alone erases what the document is actually about.
//
// STANDARDS
//   · leads via PersonService.findOrCreateLead — never a direct canonical INSERT.
//   · deterministic external id `marronnage:<normalised name>:<doc id>` so re-runs resolve, not duplicate.
//   · rule 8: the newspaper scan (67% of ads carry one, under /documents/ — NOT the robots-disallowed
//     /images/) → S3 + sha256 + Wayback on the permalink.
//   · RULE 0.5: embed phase printed and, with --embed, run.
//   · Same-name collisions are SEVERE here (many Jean-Pierres). findOrCreateLead's ambiguity guard routes
//     them to review rather than merging — Biscoe. We never auto-merge on a mononym.
//
// ENDPOINT CONTRACT: POST /fr/resultats.php (relative to /fr/ — site root 404s), body is exactly
//   $('#frminterroger').serializeArray(); minyear/maxyear are readonly slider fields and sending them EMPTY
//   500s the server; bounds 1765-1833.
//
// Usage:
//   node scripts/ingest-marronnage-named.mjs --limit 5
//   node scripts/ingest-marronnage-named.mjs --limit 300 --apply
import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { ensureSnapshot } from './lib/wayback.mjs';

const require = createRequire(import.meta.url);
const PersonService = require('../src/services/PersonService');
const S3 = require('../src/services/storage/S3Service');

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i > -1 ? A[i + 1] : d; };
const APPLY = A.includes('--apply');
const LIMIT = +val('--limit', 25);
const OFFSET = +val('--offset', 0);
const GAP_MS = +val('--gap-ms', 1200);
const NO_SCAN = A.includes('--no-scan');
const UA = 'reparations-research/1.0 (db7613@bard.edu; academic reparations research; contact welcome)';
const BASE = 'http://www.marronnage.info/fr';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const strip = (h) => h.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/\s+/g, ' ').trim();
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function post(body) {
  const r = await fetch(`${BASE}/resultats.php`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `${BASE}/corpus.php`,
               'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body, signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.text();
}
async function get(url, asBuffer = false) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return asBuffer ? Buffer.from(await r.arrayBuffer()) : r.text();
}
const q = (o) => new URLSearchParams({ motscles: '', noms: '', location: '-1', newspaper: '-1',
  minyear: '1765', maxyear: '1833', page: '1', ...o }).toString();

// Harm + origin probes. Bilingual: francophone colonies AND Jamaica/Carolina/Quebec.
// ACCENTS BREAK \b. JavaScript's \b is defined against [A-Za-z0-9_], so "é" is NOT a word character and
// `\b[ée]tamp` can never match after a space — the boundary requires a word char on one side. That single
// character cost us the largest harm class in the corpus: 1,697 of 4,126 stored ads contain "étampé"
// (41%, matching the source's corpus-wide 9,915 = 44%), and we recorded THIRTY-SEVEN branding events.
// I twice explained the shortfall as "the sweep hasn't reached Saint-Domingue yet" rather than testing the
// pattern against the text we already held. Anchor on ASCII-safe stems, allow plurals/feminines, and never
// put \b immediately before an accented letter.
// The stored text also carries HTML entities (d&#039;environ), so patterns must not assume clean apostrophes.
const HARMS = [
  ['branding',        /[ée]tamp[ée]?[es]?\b|\bmarqu[ée]e?s?\s+(au\s+fer|d[e'’]un)|\bbranded\b|\bbrand(ed)?\s+(on|with)\b/i],
  ['scarring',        /cicatrice|balafr|\bscars?\b|\bmarks? of the whip\b|marqu[ée]e?s?\s+de\s+coups/i],
  ['whipping',        /fouett|coups?\s+de\s+fouet|\bwhipp?(ed|ing)\b|\blash(ed|es)\b/i],
  ['restraint_irons', /\bfers?\b|cha[îi]ne|carcan|collier\s+de\s+fer|\birons?\b|\bshackle|\bmanacle/i],
  ['imprisonment',    /g[eé][ôo]le|cachot|\bprison\b|\bjail\b|\bgaol\b|workhouse|d[ée]p[ôo]t\s+des?\s+n[èe]gres/i],
  ['injury',          /boiteu|estropi|manchot|borgne|mutil|ulc[èe]r|\blame\b|\bcripple|walks?\s+(heavily|lame)|one\s+eye/i],
];

const NATION_RE = /\bnation\s+([A-ZÉÈ][\wéèêç-]{2,})|\b(Congo|Ibo|Igbo|Arada|Nago|Bambara|Mandingue|Mandingo|Coromantee|Mina|Foulah|Angola|Mozambique|Caplaou|Bibi|Hausa|Moco|Chamba|S[ée]n[ée]gal)\b/i;

// Parse "Saint-Domingue, Affiches américaines - 1766-01-01".
// ANCHORED, because a greedy leading [A-Za-zÀ-ÿ- ]+ walks BACKWARDS through the site navigation and
// swallows it: a 4-name test wrote "sources et trajectoires de vie Présentation Corpus Méthodologie
// Ressources À propos Document Caroline du Sud" into a person's `locations`. I had seen this same regex
// eat the nav in the sampler's frame report and called it cosmetic. It is not cosmetic when it lands in a
// person record. The colony is one of seven KNOWN values, so match those rather than "any words".
const COLONIES = ['Saint-Domingue', 'Louisiane', 'Caroline du Sud', 'Jamaïque', 'Guadeloupe',
                  'Guyane française', 'Bas-Canada'];
function parseHeader(text) {
  const colony = COLONIES.find((c) => text.includes(c)) || null;
  if (!colony) return {};
  const tail = text.slice(text.indexOf(colony) + colony.length, text.indexOf(colony) + colony.length + 90);
  const m = tail.match(/,\s*([^-]{2,60}?)\s*-\s*(1[78]\d{2})-(\d{2})-(\d{2})/);
  if (!m) return { colony };
  return { colony, newspaper: m[1].trim(), year: +m[2], date: `${m[2]}-${m[3]}-${m[4]}` };
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, query_timeout: 300000 });
  pool.on('error', (e) => console.error(`[pool] idle client error (continuing): ${e.message}`));
  const svc = new PersonService(pool);

  // 1 · the curators' own name index, straight off the search page
  const page = await get(`${BASE}/corpus.php`);
  const arr = (page.match(/\[(?:\s*"[^"]{1,60}"\s*,){20,}\s*"[^"]{1,60}"\s*\]/) || [])[0];
  if (!arr) { console.error('FATAL: could not find the curated names array — page structure changed.'); process.exit(1); }
  const names = JSON.parse(arr);
  console.log(`curated name index: ${names.length} names`);
  // RESUME. At ~2.5 names/min a full pass is ~24 hours, so it WILL be interrupted — every long job today
  // was. Rather than track an offset (bookkeeping that goes stale the moment the name list changes), ask
  // the DATABASE which names are already done and skip them. Idempotent, order-independent, and it makes
  // "how do I know it finished?" answerable from the data instead of from a log tail.
  const doneRows = (await pool.query(
    `SELECT DISTINCT split_part(external_id, ':', 3) AS n FROM person_external_ids
      WHERE id_system = 'marronnage_named'`)).rows;
  const done = new Set(doneRows.map((r) => r.n).filter(Boolean));
  // A name searched and found empty is ATTEMPTED. Without this the empty ones loop forever.
  const emptyRows = (await pool.query(
    `SELECT DISTINCT replace(index_searched, 'noms=', '') AS n FROM research_findings
      WHERE searched_by = 'ingest-marronnage-named' AND result = 'none'`)).rows;
  emptyRows.forEach((r) => { if (r.n) done.add(norm(r.n)); });
  const remaining = names.filter((n) => !done.has(norm(n)));
  console.log(`already ingested: ${done.size} · remaining: ${remaining.length}`);
  const slice = remaining.slice(OFFSET, OFFSET + LIMIT);
  if (!slice.length) { console.log('MARRONNAGE COMPLETE — every curated name has been attempted.'); await pool.end(); return; }
  console.log(`${APPLY ? '=== APPLY ===' : '=== DRY RUN ==='} names ${OFFSET}..${OFFSET + slice.length}`);

  const st = { names: 0, docs: 0, created: 0, linked: 0, rejected: 0, harms: 0, facts: 0, scans: 0, err: 0 };

  for (const name of slice) {
    try {
      const html = await post(q({ noms: name }));
      const ids = [...new Set([...html.matchAll(/document\.php\?id=(\d+)/g)].map((m) => m[1]))];
      if (!ids.length) {
        // RECORD THE ABSENCE. A name in the curated index whose search returns no ads was previously just
        // skipped — nothing written — so the resume logic (which asks the DB which names are done) never
        // saw it and re-attempted it on EVERY run. 110 names spun like this indefinitely while the bar sat
        // at 96.4% looking merely slow. §4 of standard-assertion-store is explicit: "Absence is recorded
        // (research_findings), because a searched-and-not-found is a fact about the archive." Doing that
        // both satisfies the standard and terminates the loop.
        st.names++; st.empty = (st.empty || 0) + 1;
        if (APPLY) {
          await pool.query(
            `INSERT INTO research_findings (question, repository, index_searched, result, hit_count,
               evidence_note, searched_by)
             SELECT $1,$2,$3,'none',0,$4,'ingest-marronnage-named'
              WHERE NOT EXISTS (SELECT 1 FROM research_findings f
                 WHERE f.searched_by='ingest-marronnage-named' AND f.index_searched=$3)`,
            [`Which surviving advertisements name the enslaved person "${name}"?`,
             'Le marronnage dans le monde atlantique, 1760-1848 (CNRS/EHESS)',
             `noms=${name}`,
             `The curated name index lists "${name}", but a noms search returns no documents in the ` +
             `1765-1833 window. The curators indexed the name from a record that is not served by this ` +
             `search, or it is filtered out by the year bounds. Recorded so the name is not re-attempted ` +
             `forever and so the gap is visible rather than silent.`])
            .catch((e) => console.error(`   ! absence ${name}: ${e.message.slice(0, 70)}`));
        }
        continue;
      }
      st.names++;
      await sleep(GAP_MS);

      for (const id of ids.slice(0, 12)) {          // a name recurring in >12 ads is a repeat-flight cluster; cap per tick
        const permalink = `${BASE}/document.php?id=${id}`;
        const raw = await get(permalink);
        const text = strip(raw);
        const hdr = parseHeader(text);
        const scanRel = (raw.match(/\.\.\/(documents\/[^"']+\.(?:jpg|jpeg|png|tif))/i) || [])[1];
        // THE AD ITSELF, bounded on both sides. `text.split('Permalien')[0].slice(-1400)` returned the WHOLE
        // page whenever the pre-permalink text was under 1400 chars, so ocr_text stored the site navigation
        // ("Document | Le marronnage dans le monde atlantique... English...") instead of the advertisement —
        // and the harm regexes then ran against furniture. The ad begins after the dated header and ends at
        // the permalink, so cut there.
        const afterHdr = hdr.date ? text.slice(text.indexOf(hdr.date) + hdr.date.length) : text;
        const body = (afterHdr.split(/Permalien|Permalink/)[0] || '').trim();
        st.docs++;

        if (!APPLY) { await sleep(GAP_MS); continue; }

        // PER-PERSON, not per-document. Keying on the doc id minted a fresh lead for every ad, so
        // 'Aaron' and 'Aaron Brown' each appeared twice in a 4-name test. A person recurs across ads
        // (repeat flight is ~5% of the corpus); the DOCUMENTS accumulate on one lead. Colony is part of
        // the key because the same mononym in Louisiana and Saint-Domingue is not evidence of one person.
        const externalId = `marronnage:${norm(hdr.colony || 'x')}:${norm(name)}`;
        const out = await svc.findOrCreateLead({
          name, personType: 'enslaved',
          location: [hdr.colony].filter(Boolean).join(', '),
          externalId, idSystem: 'marronnage_named',
          sourceUrl: permalink, sourceType: 'secondary', createdBy: 'ingest-marronnage-named',
        }, { dryRun: false });
        if (out.action === 'created') st.created++;
        else if (out.action === 'linked') st.linked++;
        // WRITE THE EXTERNAL ID ON *LINK*, NOT ONLY ON CREATE.
        // PersonService.findOrCreateLead records the external id only when the match is a CANONICAL
        // (`res.match.subject_table === 'canonical_persons'`). When it links to an existing LEAD it writes
        // nothing — and this script's resume logic decides a name is "done" by looking for exactly that
        // external id. So every name that resolved to an existing lead was re-attempted on EVERY run,
        // forever: 110 names spinning, 73 ads re-fetched per pass, 0 rows created, and a progress bar
        // frozen at 96.4% that looked like slowness rather than a loop. Same family as the rest of this
        // week: work that reports success while nothing advances.
        if (out.ref && out.ref.subject_table === 'unconfirmed_persons') {
          await pool.query(
            `INSERT INTO person_external_ids (subject_table, subject_id, id_system, external_id, external_url, confidence)
             VALUES ('unconfirmed_persons', $1, 'marronnage_named', $2, $3, 0.85)
             ON CONFLICT (id_system, external_id) DO NOTHING`,
            [out.ref.subject_id, externalId, permalink])
            .catch((e) => console.error(`   ! extid ${name}: ${e.message.slice(0, 70)}`));
        }
        else { st.rejected++; await sleep(GAP_MS); continue; }
        const ref = out.ref; if (!ref) { st.rejected++; await sleep(GAP_MS); continue; }
        const isLead = ref.subject_table === 'unconfirmed_persons';
        const citation = `${hdr.colony || '?'} · ${hdr.newspaper || '?'} · ${hdr.date || hdr.year || '?'} · ` +
          `Le marronnage dans le monde atlantique (CNRS/EHESS) doc ${id}`;

        // rule 8 — archive the newspaper scan itself where one exists
        let s3Key = null;
        if (scanRel && !NO_SCAN) {
          try {
            const buf = await get(`http://www.marronnage.info/${scanRel}`, true);
            const sha = crypto.createHash('sha256').update(buf).digest('hex');
            s3Key = `sources/marronnage/${norm(hdr.colony || 'unknown')}/${sha.slice(0, 16)}.jpg`;
            await S3.upload(s3Key, buf, 'image/jpeg', { 'source-url': permalink });
            let wb = null;
            try { wb = await ensureSnapshot(permalink); } catch { /* witness is best-effort */ }
            await pool.query(
              `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, s3_bucket,
                 s3_key, wayback_url, sha256, bytes, content_type, rehostable, retrieved_at, notes)
               VALUES ($1,'marronnage_scan','Le marronnage dans le monde atlantique',$2,$3,$4,$5,$6,$7,'image/jpeg',FALSE,now(),$8)
               ON CONFLICT (artifact_key) DO NOTHING`,
              [`marronnage:${id}`, permalink, process.env.S3_BUCKET || null, s3Key, wb, sha, buf.length,
               `newspaper page scan; rehostable=FALSE pending explicit licence from CNRS/EHESS`]).catch(() => {});
            st.scans++;
          } catch (e) { /* a missing scan is normal: 33% of ads have none */ }
        }

        // Columns verified against the live schema (information_schema), after `source_citation` -- which
        // does not exist here -- silently failed 10 inserts behind a .catch(()=>{}) and reported docs:0 as
        // success. person_documents carries `collection_name`/`page_reference`, not a citation string.
        await pool.query(
          `INSERT INTO person_documents (${isLead ? 'unconfirmed_person_id' : 'canonical_person_id'},
             name_as_appears, document_type, source_url, source_type, collection_name, page_reference,
             person_type, evidence_strength, document_date, document_year, s3_key, ocr_text, created_by)
           SELECT $1,$2,'runaway_advertisement',$3,'secondary',$4,$5,'enslaved','primary',$6,$7,$8,$9,'ingest-marronnage-named'
            WHERE NOT EXISTS (SELECT 1 FROM person_documents d
               WHERE d.${isLead ? 'unconfirmed_person_id' : 'canonical_person_id'}=$1 AND d.source_url=$3)`,
          // page_reference is varchar(100) — it holds a PAGE REFERENCE, not a citation string. Putting the
          // full citation there threw "value too long for character varying(100)". The citation lives on the
          // harm_events rows and in collection_name; the permalink is the resolvable pointer.
          [ref.subject_id, name, permalink,
           'Le marronnage dans le monde atlantique, 1760-1848 (CNRS/EHESS)',
           `${(hdr.newspaper || 'newspaper').slice(0, 60)} ${hdr.date || ''} (doc ${id})`.slice(0, 100),
           hdr.date || null, hdr.year || null, s3Key, body])
          .then(() => { st.docs_written = (st.docs_written || 0) + 1; })
          .catch((e) => { st.err++; if (st.err <= 6) console.error(`   ! document: ${e.message.slice(0, 90)}`); });

        // FACTS — person_facts.person_id is NOT NULL and canonical-only in this schema (there is no
        // subject_table column; I wrote this from the memory-bank summary instead of the live schema and
        // every insert failed silently behind a .catch(()=>{}) — 0 facts written, reported as success).
        // So origin/status facts are DEFERRED to promotion. Nothing is lost: the full ad transcription is
        // stored on the document as ocr_text and is embedded, so RAG can already answer "nation Congo".
        if (!isLead) {
          const facts = [['self_liberation', `advertised as maroon; ${hdr.newspaper || 'newspaper'} ${hdr.date || ''}`.trim()]];
          const nat = body.match(NATION_RE);
          if (nat) facts.push(['african_origin_as_recorded', (nat[1] || nat[2])]);
          if (/\bnouveau\b|\bbossale?\b|\bnew\s+negro\b/i.test(body)) facts.push(['arrival_status', 'bossale (recently arrived)']);
          else if (/\bcr[ée]ole\b|\bcountry.born\b/i.test(body)) facts.push(['arrival_status', 'creole (colony-born)']);
          for (const [ft, vt] of facts) {
            try {
              await pool.query(
                `INSERT INTO person_facts (person_id, fact_type, value_text, date_year, date_text, place_text,
                   source_table, source_external_system, source_external_id, source_url, source_citation,
                   confidence, verification_status)
                 SELECT $1,$2,$3,$4,$5,$6,'person_documents','marronnage',$7,$8,$9,0.85,'unverified'
                  WHERE NOT EXISTS (SELECT 1 FROM person_facts f
                     WHERE f.person_id=$1 AND f.fact_type=$2 AND f.value_text=$3)`,
                [ref.subject_id, ft, vt, hdr.year || null, hdr.date || null, hdr.colony || null,
                 String(id), permalink, citation]);
              st.facts++;
            } catch (e) { st.err++; if (st.err <= 6) console.error(`   ! fact ${ft}: ${e.message.slice(0, 70)}`); }
          }
        }

        // harms — the enslaver describing, in his own advertisement, what he did to the body he is hunting
        for (const [kind, re] of HARMS) {
          if (!re.test(body)) continue;
          // The advertiser is the PERPETRATOR, named in his own notice ("M. Chabanon, à qui ce Negre
          // appartient"). harm_events carries perpetrator fields, so the brand and the owner are recorded
          // together — the mark of ownership and the mark of harm are the same three letters.
          // NAMING A PERPETRATOR IS AN ACCUSATION. A loose pattern produced "North- Carolina" as the
          // perpetrator of scarring against Aamon on the first live run — it matched a PLACE after "à".
          // A wrong perpetrator is worse than none, so this requires an honorific AND rejects anything
          // that looks like a place or a colony. Everything else stays NULL for a human/LLM pass.
          const PLACEISH = /(Carolina|Caroline|Domingue|Louisian|Jama|Guadeloupe|Guyane|Canada|Orleans|Charleston|Kingston|Quebec|Montreal|Cap|Port|Saint|County|Parish|Paroisse)/i;
          let own = body.match(/\bappartient\s+à\s+(?:M\.|Mme|Mr\.?|Mrs\.?)\s*([A-ZÉÈ][\wéèêàç'’-]+(?:\s+[A-ZÉÈ][\wéèêàç'’-]+)?)/)
                 || body.match(/\b(?:à|chez)\s+(?:M\.|Mme)\s*([A-ZÉÈ][\wéèêàç'’-]+(?:\s+[A-ZÉÈ][\wéèêàç'’-]+)?)/);
          if (own && PLACEISH.test(own[1])) own = null;
          try {
            await pool.query(
              `INSERT INTO harm_events (harm_type, harm_category, victim_subject_table, victim_subject_id,
                 victim_name, perpetrator_name, narrative, event_date, location, source_citation,
                 confidence_score, reparations_relevant, requires_human_review)
               SELECT $1,'bodily_harm',$2,$3,$4,$5,$6,$7,$8,$9,0.85,TRUE,TRUE
                -- KEY ON THE ADVERTISEMENT, NOT THE CITATION STRING. This guard used source_citation,
                -- and rescan-marronnage-harms.mjs formats that string differently — so the two writers
                -- could not see each other's rows and created 1,988 exact duplicates, which then had to
                -- be deleted. The stable identity is victim + harm type + THE AD TEXT: the same ad
                -- re-read is one event; a DIFFERENT ad is a real second event, because repeat flight is
                -- ~5% of this corpus and collapsing it would erase people who fled more than once.
                WHERE NOT EXISTS (SELECT 1 FROM harm_events h
                   WHERE h.victim_subject_table=$2 AND h.victim_subject_id=$3 AND h.harm_type=$1
                     AND left(h.narrative,300)=left($6::text,300))`,
              [kind, ref.subject_table, ref.subject_id, name, own ? own[1] : null,
               body.slice(0, 1200), hdr.date || null, hdr.colony || null, citation]);
            st.harms++;
          } catch (e) { st.err++; if (st.err <= 6) console.error(`   ! harm ${kind}: ${e.message.slice(0, 70)}`); }
        }
        await sleep(GAP_MS);
      }
    } catch (e) {
      st.err++;
      if (st.err <= 6) console.error(`  ! ${name}: ${e.message.slice(0, 80)}`);
      if (/429|403/.test(e.message)) { console.log('  ⛔ rate-limited — stopping this tick.'); break; }
    }
    if (st.names % 10 === 0) process.stdout.write(`\r  ${st.names} names · ${st.docs} ads · ${st.created} created · ${st.harms} harms · ${st.scans} scans   `);
  }

  console.log(`\n=== ${JSON.stringify(st)} ===`);
  // RULE 0.5 IS ENFORCED HERE, NOT ADVISED. This used to print the embed command and trust someone to
  // run it. Nobody did: after 3,570 marronnage names and 1,058 DLAS petitions, embedded leads = 0 — the
  // people were in the database and invisible to RAG, which is the definition of a retrieval silo. The
  // memory bank already records this exact failure from 2026-08-09 ("the producer shipped with NO EMBED
  // PHASE ... caught by the user, not by the monitor") and I rebuilt it anyway. A printed instruction is
  // not a pipeline stage.
  if (APPLY) {
    console.log('RULE 0.5 — embedding new leads…');
    const { spawn } = await import('node:child_process');
    await new Promise((res) => {
      const c = spawn(process.execPath, ['scripts/embed-leads.mjs', '--id-system', 'marronnage_named'],
        { stdio: 'inherit', env: { ...process.env, EMBED_SOURCE: process.env.EMBED_SOURCE || 'ollama' } });
      c.on('exit', res); c.on('error', res);
    });
  }
  else console.log('(dry run — pass --apply)');
  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
