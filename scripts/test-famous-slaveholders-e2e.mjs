// scripts/test-famous-slaveholders-e2e.mjs
//
// End-to-end coverage test for the person-profile pipeline, driven by the
// 100 most-search-likely slaveholders in tests/fixtures/famous-slaveholders.json.
//
// For each name it exercises the REAL HTTP stack the frontend uses:
//   1. SEARCH      GET /api/contribute/search/:query        — does the person surface?
//   2. PROFILE     GET /api/contribute/person/:id?table=... — does the profile load (200)?
//   3. DOCUMENTS   GET /api/documents/person-doc/:pdId/access + ranged GET of the
//                  presigned URL — does every attached document actually resolve?
//   4. CONNECTIONS recursively load spouse / parents / children / enslaved (depth 1)
//
// Report-only: it NEVER writes to the DB. Output is a JSON blob + a markdown matrix.
//
// Usage:
//   BASE_URL=http://localhost:3001 node scripts/test-famous-slaveholders-e2e.mjs
//   node scripts/test-famous-slaveholders-e2e.mjs --base https://reparations-platform.onrender.com --doc-sample 5
//
// Re-run this after every gap-remediation step — it is the recursive regression check.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
function arg(flag, def) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; }

const BASE_URL = arg('--base', process.env.BASE_URL || 'http://localhost:3001');
const DOC_SAMPLE = parseInt(arg('--doc-sample', '6'), 10);   // docs validated per person
const CONN_SAMPLE = parseInt(arg('--conn-sample', '3'), 10); // connected records loaded per bucket
const FIXTURE = path.join(ROOT, 'tests/fixtures/famous-slaveholders.json');
const OUT_DIR = path.join(ROOT, 'test-results');
const TIMEOUT_MS = 25000;

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const PEOPLE = fixture.slaveholders;

async function http(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally { clearTimeout(t); }
}

async function getJson(url) {
  try {
    const res = await http(url);
    const status = res.status;
    let body = null;
    try { body = await res.json(); } catch { /* non-json */ }
    return { ok: res.ok, status, body };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

// Validate a presigned URL the way a browser would: ranged GET (presigned URLs are
// signed for GET, so HEAD would fail the signature). 200/206 = the object is fetchable.
async function probePresignedUrl(viewUrl) {
  try {
    const res = await http(viewUrl, { method: 'GET', headers: { Range: 'bytes=0-0' }, timeout: 20000 });
    return { status: res.status, ok: res.status === 200 || res.status === 206 };
  } catch (e) {
    return { status: 0, ok: false, error: e.message };
  }
}

function docCandidatesFrom(profile) {
  const out = [];
  const push = (d, origin) => {
    if (!d) return;
    const pdId = d.id ?? d.document_id ?? d.pd_id ?? d.person_document_id ?? null;
    out.push({
      pdId: pdId != null ? String(pdId) : null,
      hasS3: !!(d.s3_key || d.s3_url),
      source_url: d.source_url || null,
      document_type: d.document_type || d.doc_type || null,
      filename: d.filename || null,
      origin,
    });
  };
  for (const d of (profile.documents || [])) push(d, 'documents');
  for (const d of (profile.ownerDocuments || [])) push(d, 'ownerDocuments');
  for (const col of (profile.documentCollections || [])) {
    for (const p of (col.pages || [])) push(p, `collection:${col.collection_key || col.collection_name || '?'}`);
  }
  return out;
}

function connCandidatesFrom(profile) {
  const fam = profile.familyMembers || {};
  const conns = [];
  const addList = (list, rel) => {
    for (const x of (list || [])) {
      const id = x.id ?? x.enslaved_id ?? x.canonical_id ?? null;
      const table = x.table_source || (x.enslaved_id ? 'enslaved_individuals' : null);
      if (id != null) conns.push({ rel, id: String(id), table, name: x.full_name || x.canonical_name || x.name || null, linked: x.linked !== false });
    }
  };
  if (fam.spouse) addList([fam.spouse], 'spouse');
  addList(fam.parents, 'parent');
  addList(fam.children, 'child');
  addList((profile.enslavedPersons || []).slice(0, CONN_SAMPLE), 'enslaved');
  return conns;
}

async function loadProfile(id, table) {
  const url = `${BASE_URL}/api/contribute/person/${encodeURIComponent(id)}${table ? `?table=${encodeURIComponent(table)}` : ''}`;
  return getJson(url);
}

const STATE = {
  AL: 'alabama', AR: 'arkansas', FL: 'florida', GA: 'georgia', KY: 'kentucky',
  LA: 'louisiana', MD: 'maryland', MS: 'mississippi', NC: 'north carolina',
  SC: 'south carolina', TN: 'tennessee', TX: 'texas', VA: 'virginia',
  DC: 'district of columbia', NY: 'new york', PA: 'pennsylvania',
  RI: 'rhode island', MA: 'massachusetts', MO: 'missouri',
};

function parseEra(era) {
  if (!era) return {};
  const range = era.match(/(\d{4})?\s*-\s*(\d{4})?/);
  if (range && (range[1] || range[2])) return { birth: range[1] ? +range[1] : null, death: range[2] ? +range[2] : null };
  const single = era.match(/(\d{4})/);
  return single ? { birth: +single[1] } : {};
}

const ownerTypeRe = /enslav(er|ing)|owner|slaveholder|canonical/i;
const enslavedTypeRe = /enslaved\b|freedperson/i;

// Rank a search result for an owner-intent query: prefer owner types + exact name,
// penalise enslaved/freedperson namesakes.
function scoreCandidate(name, queryWords, type, full) {
  const n = (name || '').toLowerCase();
  let s = 0;
  const t = (type || '').toLowerCase();
  if (ownerTypeRe.test(t)) s += 3;
  if (enslavedTypeRe.test(t)) s -= 4;
  if (n === full) s += 4;                          // exact full-name match
  else if (queryWords.every(w => n.includes(w))) s += 1; // all words present
  // reward word-order/adjacency (penalise "Jefferson Thomas" for "thomas jefferson")
  if (n.includes(full)) s += 2;
  return s;
}

// Compare the loaded profile against fixture ground truth → identity verdict.
function assessIdentity(person, profile) {
  if (person.known_id != null) return { verdict: 'CONTROL', why: 'verified id from fixture' };
  if (!profile) return { verdict: 'NO_LOAD', why: '' };
  const exp = parseEra(person.era);
  const gotBirth = profile.birth_year || profile.birth_year_estimate || null;
  const gotDeath = profile.death_year || profile.death_year_estimate || null;
  const gotState = (profile.primary_state || '').toLowerCase();
  const gotName = (profile.full_name || profile.canonical_name || '').toLowerCase();
  const gotType = (profile.person_type || profile.tableSource || '').toLowerCase();
  const searched = person.name.toLowerCase();
  const TOL = 8;

  // wrong record type for an owner query
  if (enslavedTypeRe.test(gotType) || /enslaved_individuals/.test(gotType)) {
    return { verdict: 'NAMESAKE_WRONG_TYPE', why: `matched ${gotType} "${gotName}"` };
  }
  // date check
  let dateMatch = null;
  if (exp.birth && gotBirth) dateMatch = Math.abs(exp.birth - gotBirth) <= TOL;
  else if (exp.death && gotDeath) dateMatch = Math.abs(exp.death - gotDeath) <= TOL;
  if (dateMatch === false) return { verdict: 'WRONG_PERSON_DATES', why: `era ${person.era} vs record ${gotBirth || '?'}-${gotDeath || '?'}` };

  // state check
  let stateMatch = null;
  const expState = person.region ? person.region.split('/')[0].trim().toUpperCase() : null;
  if (expState && gotState) {
    const full = STATE[expState] || expState.toLowerCase();
    stateMatch = gotState.includes(full) || gotState.includes(expState.toLowerCase());
  }
  const nameExact = gotName === searched;

  if (dateMatch === true) return { verdict: 'IDENTITY_PLAUSIBLE', why: `dates align (${gotBirth || ''}-${gotDeath || ''})` };
  if (stateMatch === true && nameExact) return { verdict: 'IDENTITY_PLAUSIBLE', why: `exact name + state ${gotState}` };
  if (stateMatch === false && !nameExact) return { verdict: 'LIKELY_NAMESAKE', why: `state ${gotState || '?'} ≠ ${expState}, name "${gotName}"` };
  // no dates on record, can't confirm or deny
  return { verdict: 'UNVERIFIABLE', why: `no dates on record; name "${gotName}" state "${gotState || '?'}"` };
}

async function runOne(person) {
  const r = {
    name: person.name, category: person.category, region: person.region,
    expect: person.expect, known_id: person.known_id ?? null,
    search: {}, profile: {}, documents: {}, connections: {}, verdict: null, notes: [],
  };

  // 1. SEARCH
  const sUrl = `${BASE_URL}/api/contribute/search/${encodeURIComponent(person.name)}`;
  const s = await getJson(sUrl);
  const results = (s.body && (s.body.results || s.body.data || s.body.persons)) || (Array.isArray(s.body) ? s.body : []);
  const words = person.name.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  const nameMatches = (n) => { const ln = (n || '').toLowerCase(); return words.every(w => ln.includes(w)); };
  const strongHits = results.filter(x => nameMatches(x.name || x.full_name || x.canonical_name) &&
    /enslav|owner|slaveholder|canonical/i.test((x.type || x.person_type || x.table_source || '')));
  const knownIdInSearch = person.known_id != null && results.some(x => String(x.id) === String(person.known_id));
  r.search = {
    status: s.status, total: results.length, strongHits: strongHits.length,
    knownIdInSearch,
    top: results.slice(0, 3).map(x => ({ id: String(x.id), name: x.name || x.full_name, type: x.type || x.person_type, table: x.table_source })),
  };

  // resolve which id to load — score candidates rather than blindly taking [0]
  let id = person.known_id ?? null;
  let table = person.known_id ? 'canonical_persons' : null;
  if (id == null && results.length) {
    const ranked = results
      .map(x => ({ x, score: scoreCandidate(x.name || x.full_name || x.canonical_name, words, x.type || x.person_type, person.name.toLowerCase()) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0].x;
    id = best.id;
    table = best.table_source || null;
    r.search.pickedScore = ranked[0].score;
    r.search.picked = { id: String(best.id), name: best.name || best.full_name, type: best.type || best.person_type };
  }

  if (id == null) { r.verdict = 'NOT_FOUND'; r.identity = { verdict: 'NO_LOAD', why: 'no search results' }; return r; }

  // 2. PROFILE
  const p = await loadProfile(id, table);
  if (!p.ok || !p.body) {
    r.profile = { id: String(id), table, status: p.status, loaded: false, error: p.error || (p.body && p.body.error) };
    r.verdict = 'PROFILE_FAIL';
    r.identity = { verdict: 'NO_LOAD', why: `profile ${p.status}` };
    return r;
  }
  const b = p.body;
  const person_obj = b.person || b;
  r.identity = assessIdentity(person, person_obj);
  const fam = b.familyMembers || {};
  r.profile = {
    id: String(id), table, status: p.status, loaded: true,
    has_dates: !!(person_obj.birth_year || person_obj.death_year || person_obj.birth_year_estimate),
    state: person_obj.primary_state || null,
    counts: {
      documents: (b.documents || []).length,
      documentCollections: (b.documentCollections || []).length,
      collectionPages: (b.documentCollections || []).reduce((a, c) => a + ((c.pages || []).length), 0),
      enslavedPersons: (b.enslavedPersons || []).length,
      spouse: fam.spouse ? 1 : 0,
      parents: (fam.parents || []).length,
      children: (fam.children || []).length,
    },
    hasPetition: !!((b.owner && b.owner.petition) || person_obj.petition),
    inheritanceChain: ((b.owner && b.owner.inheritance_chain) || person_obj.inheritance_chain || []).length,
  };

  // 3. DOCUMENTS
  const cands = docCandidatesFrom(b);
  const sample = cands.filter(c => c.hasS3 && c.pdId).slice(0, DOC_SAMPLE);
  const urlOnly = cands.filter(c => !c.hasS3).length;
  const docResults = [];
  for (const c of sample) {
    const acc = await getJson(`${BASE_URL}/api/documents/person-doc/${encodeURIComponent(c.pdId)}/access`);
    if (!acc.ok || !acc.body || !acc.body.viewUrl) {
      docResults.push({ pdId: c.pdId, filename: c.filename, stage: 'access', status: acc.status, ok: false, err: acc.body?.error || acc.error });
      continue;
    }
    const probe = await probePresignedUrl(acc.body.viewUrl);
    docResults.push({ pdId: c.pdId, filename: c.filename, stage: 'fetch', presigned: acc.body.presigned, status: probe.status, ok: probe.ok, err: probe.error });
  }
  r.documents = {
    totalCandidates: cands.length, s3Candidates: cands.filter(c => c.hasS3).length, urlOnly,
    sampled: sample.length, ok: docResults.filter(d => d.ok).length, failed: docResults.filter(d => !d.ok).length,
    failures: docResults.filter(d => !d.ok),
  };

  // 4. CONNECTIONS (recursive depth 1)
  const conns = connCandidatesFrom(b);
  const connResults = [];
  for (const cn of conns) {
    if (!cn.linked || cn.id == null) { connResults.push({ ...cn, loaded: null, reason: 'unlinked' }); continue; }
    const cp = await loadProfile(cn.id, cn.table);
    connResults.push({ rel: cn.rel, id: cn.id, name: cn.name, loaded: cp.ok, status: cp.status });
  }
  r.connections = {
    total: conns.length,
    loaded: connResults.filter(c => c.loaded === true).length,
    failed: connResults.filter(c => c.loaded === false).length,
    unlinked: connResults.filter(c => c.loaded === null).length,
    failures: connResults.filter(c => c.loaded === false),
  };

  // verdict
  const docFail = r.documents.failed > 0;
  const connFail = r.connections.failed > 0;
  if (docFail && connFail) r.verdict = 'LOADS_BUT_DOCS+CONNS_BROKEN';
  else if (docFail) r.verdict = 'LOADS_BUT_DOCS_BROKEN';
  else if (connFail) r.verdict = 'LOADS_BUT_CONNS_BROKEN';
  else r.verdict = 'OK';
  return r;
}

function pct(n, d) { return d ? `${Math.round((100 * n) / d)}%` : '—'; }

async function main() {
  console.log(`E2E famous-slaveholder coverage test`);
  console.log(`  base       : ${BASE_URL}`);
  console.log(`  fixture    : ${PEOPLE.length} people`);
  console.log(`  doc sample : ${DOC_SAMPLE} per person\n`);

  // health
  const h = await getJson(`${BASE_URL}/api/health`);
  if (!h.ok) { console.error(`✗ base unreachable at ${BASE_URL}/api/health (status ${h.status}). Start the server first.`); process.exit(1); }

  const results = [];
  for (let i = 0; i < PEOPLE.length; i++) {
    const person = PEOPLE[i];
    process.stdout.write(`[${i + 1}/${PEOPLE.length}] ${person.name} … `);
    const r = await runOne(person);
    results.push(r);
    const d = r.documents || {};
    console.log(`${r.verdict}  (docs ${d.ok || 0}/${d.sampled || 0} ok, conns ${r.connections?.loaded || 0}/${r.connections?.total || 0})`);
  }

  // aggregate
  const verdicts = {};
  for (const r of results) verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;
  const identityTally = {};
  for (const r of results) { const v = r.identity?.verdict || 'NO_LOAD'; identityTally[v] = (identityTally[v] || 0) + 1; }
  const found = results.filter(r => r.verdict !== 'NOT_FOUND' && r.verdict !== 'PROFILE_FAIL').length;
  // "true" coverage = loaded AND identity is the intended person (control or plausible)
  const trueHits = results.filter(r => ['CONTROL', 'IDENTITY_PLAUSIBLE'].includes(r.identity?.verdict)).length;
  const namesakes = results.filter(r => ['NAMESAKE_WRONG_TYPE', 'WRONG_PERSON_DATES', 'LIKELY_NAMESAKE'].includes(r.identity?.verdict)).length;
  const docFailRecords = results.filter(r => (r.documents?.failed || 0) > 0);
  const connFailRecords = results.filter(r => (r.connections?.failed || 0) > 0);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `famous-slaveholders-e2e-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ base: BASE_URL, when: new Date().toISOString(), verdicts, results }, null, 2));

  // markdown matrix
  let md = `# Famous-slaveholder E2E coverage — ${new Date().toISOString()}\n\n`;
  md += `Base: \`${BASE_URL}\` · ${PEOPLE.length} people · doc sample ${DOC_SAMPLE}\n\n`;
  md += `## Verdict tally\n\n| Verdict | Count |\n|---|---|\n`;
  for (const [k, v] of Object.entries(verdicts).sort((a, b) => b[1] - a[1])) md += `| ${k} | ${v} |\n`;
  md += `\nFound (loaded *something*): **${found}/${PEOPLE.length}** (${pct(found, PEOPLE.length)})\n`;
  md += `**True coverage (correct person — control or identity-plausible): ${trueHits}/${PEOPLE.length} (${pct(trueHits, PEOPLE.length)})**\n`;
  md += `Namesake / wrong-person matches: **${namesakes}**\n`;
  md += `Records with broken documents: **${docFailRecords.length}** · with broken connections: **${connFailRecords.length}**\n\n`;
  md += `## Identity tally\n\n| Identity verdict | Count |\n|---|---|\n`;
  for (const [k, v] of Object.entries(identityTally).sort((a, b) => b[1] - a[1])) md += `| ${k} | ${v} |\n`;
  md += `\n## Per-person\n\n| # | Name | Cat | Expect | Load | Identity | Picked record | Docs ok/s3 | Conns | Ensl | Fam(s/p/c) |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  results.forEach((r, i) => {
    const c = r.profile?.counts || {};
    const picked = r.profile?.id ? `#${r.profile.id}` : '—';
    md += `| ${i + 1} | ${r.name} | ${r.category} | ${r.expect} | ${r.verdict} | ${r.identity?.verdict || '—'} | ${picked} | ${r.documents?.ok ?? '-'}/${r.documents?.s3Candidates ?? '-'} | ${r.connections?.loaded ?? '-'}/${r.connections?.total ?? '-'} | ${c.enslavedPersons ?? '-'} | ${c.spouse ?? 0}/${c.parents ?? 0}/${c.children ?? 0} |\n`;
  });
  // namesake detail
  const namesakeRecords = results.filter(r => ['NAMESAKE_WRONG_TYPE', 'WRONG_PERSON_DATES', 'LIKELY_NAMESAKE'].includes(r.identity?.verdict));
  if (namesakeRecords.length) {
    md += `\n## Wrong-person / namesake matches (search precision gap)\n\n`;
    for (const r of namesakeRecords) md += `- **${r.name}** → picked #${r.profile?.id} — ${r.identity.verdict}: ${r.identity.why}\n`;
  }
  if (docFailRecords.length) {
    md += `\n## Document failures (the "docs don't load" bug)\n\n`;
    for (const r of docFailRecords) {
      md += `- **${r.name}** (#${r.profile?.id}): ${r.documents.failed} failed of ${r.documents.sampled} sampled\n`;
      for (const f of r.documents.failures) md += `  - pd#${f.pdId} ${f.filename || ''} — stage=${f.stage} status=${f.status} ${f.err || ''}\n`;
    }
  }
  if (connFailRecords.length) {
    md += `\n## Connection failures\n\n`;
    for (const r of connFailRecords) {
      md += `- **${r.name}** (#${r.profile?.id}): ${r.connections.failed} failed\n`;
      for (const f of r.connections.failures) md += `  - ${f.rel} #${f.id} ${f.name || ''} — status=${f.status}\n`;
    }
  }
  const mdPath = path.join(OUT_DIR, `famous-slaveholders-e2e-${stamp}.md`);
  fs.writeFileSync(mdPath, md);

  console.log(`\n=== SUMMARY ===`);
  console.log('Load verdicts:', verdicts);
  console.log('Identity verdicts:', identityTally);
  console.log(`Found/loaded something: ${found}/${PEOPLE.length} (${pct(found, PEOPLE.length)})`);
  console.log(`TRUE coverage (correct person): ${trueHits}/${PEOPLE.length} (${pct(trueHits, PEOPLE.length)})`);
  console.log(`Namesake/wrong-person: ${namesakes}`);
  console.log(`Doc-broken records: ${docFailRecords.length} · Conn-broken records: ${connFailRecords.length}`);
  console.log(`\nReport: ${mdPath}`);
  console.log(`JSON  : ${jsonPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
