#!/usr/bin/env node
/**
 * Source-loading diagnostic harness.
 *
 * Picks 10 known enslavers + 10 known enslaved spanning every source type
 * (1860 slave schedule, Freedman's Bank, DC compensated emancipation /
 * civilwardc, SlaveVoyages, FamilySearch, Georgia probate) and exercises the
 * exact endpoint the canonical-persons front end calls
 * (GET /api/contribute/person/:id?table=...) to determine why sources are or
 * are not loading. For any returned document that has an s3_key it also probes
 * the presigned-URL endpoint the DocCollectionOverlay uses
 * (GET /api/documents/person-doc/:pdId/access).
 *
 *   node scripts/test-source-loading.mjs            # against local server :3000
 *   API_BASE=https://... node scripts/test-source-loading.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Pick N canonical_persons of a given person_type that have a person_documents
// row of the requested source_type (or, for probate, a non-null collection_key).
async function pickBySourceType({ personType, sourceType, collectionKeyLike, limit }) {
  const conds = [`cp.person_type = $1`];
  const params = [personType];
  if (sourceType === '__PROBATE__') {
    conds.push(`pd.collection_key IS NOT NULL`);
  } else {
    params.push(sourceType);
    conds.push(`pd.source_type = $${params.length}`);
  }
  params.push(limit);
  const sql = `
    SELECT DISTINCT cp.id, cp.canonical_name, cp.person_type
    FROM canonical_persons cp
    JOIN person_documents pd ON pd.canonical_person_id = cp.id
    WHERE ${conds.join(' AND ')}
    ORDER BY cp.id
    LIMIT $${params.length}`;
  const r = await pool.query(sql, params);
  return r.rows.map(row => ({ ...row, expected_source: collectionKeyLike || sourceType, table: 'canonical_persons' }));
}

// Pick unconfirmed_persons that carry a person_documents row of a source type —
// these are viewed on the front end with table=unconfirmed_persons (1860 slave
// schedule persons, Freedman's Bank depositors).
async function pickUnconfirmedBySourceType({ sourceType, label, limit }) {
  const r = await pool.query(`
    SELECT DISTINCT up.lead_id AS id, up.full_name AS canonical_name, up.person_type
    FROM unconfirmed_persons up
    JOIN person_documents pd ON pd.unconfirmed_person_id = up.lead_id
    WHERE pd.source_type = $1
    ORDER BY up.lead_id
    LIMIT $2`, [sourceType, limit]);
  return r.rows.map(row => ({ ...row, expected_source: label || sourceType, table: 'unconfirmed_persons' }));
}

async function http(path) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${API_BASE}${path}`);
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json().catch(() => null) : null;
    return { status: res.status, ok: res.ok, ms, body };
  } catch (e) {
    return { status: 0, ok: false, ms: Date.now() - t0, error: e.message };
  }
}

async function testPerson(p) {
  const table = p.table || 'canonical_persons';
  const r = await http(`/api/contribute/person/${p.id}?table=${table}`);
  const out = {
    id: p.id,
    name: (p.canonical_name || '').slice(0, 24),
    type: p.person_type,
    expected: p.expected_source,
    http: r.status,
    docs: 0,
    colls: 0,
    coll_pages: 0,
    hasDocs: null,
    s3_probe: '-',
  };
  if (!r.ok || !r.body) {
    out.s3_probe = r.error ? `ERR ${r.error.slice(0, 30)}` : `HTTP ${r.status}`;
    return out;
  }
  const docs = r.body.documents || [];
  const colls = r.body.documentCollections || [];
  out.docs = docs.length;
  out.colls = colls.length;
  out.coll_pages = colls.reduce((s, c) => s + ((c.pages || []).length), 0);
  out.hasDocs = r.body.coverage?.hasDocuments ?? null;

  // Probe S3 presign for the first doc/page that carries a person_documents id.
  const candidate =
    docs.find(d => d.id || d.document_id) ||
    colls.flatMap(c => c.pages || []).find(pg => pg.id || pg.pd_id);
  if (candidate) {
    const pdId = candidate.id || candidate.document_id || candidate.pd_id;
    const a = await http(`/api/documents/person-doc/${pdId}/access`);
    out.s3_probe = a.ok ? `OK ${a.ms}ms` : `FAIL ${a.status}`;
  } else if (out.docs + out.colls > 0) {
    out.s3_probe = 'no-id';
  } else {
    out.s3_probe = 'no-docs';
  }
  return out;
}

(async () => {
  console.log(`Testing source loading against ${API_BASE}\n`);

  const enslaverPlan = [
    { sourceType: 'civilwardc_org',    label: 'DC compensated emancipation', limit: 3 },
    { sourceType: 'slavevoyages',      label: 'SlaveVoyages',                limit: 3 },
    { sourceType: '1860_slave_schedule', label: '1860 slave schedule',       limit: 2 },
    { sourceType: '__PROBATE__',       label: 'Georgia probate',             limit: 1 },
    { sourceType: 'familysearch',      label: 'FamilySearch',                limit: 1 },
  ];
  const enslavedPlan = [
    { sourceType: '1860_slave_schedule', label: '1860 slave schedule',       limit: 4 },
    { sourceType: 'familysearch',      label: 'FamilySearch',                limit: 3 },
    { sourceType: 'civilwardc_org',    label: 'DC compensated emancipation', limit: 3 },
  ];

  const enslavers = [];
  for (const plan of enslaverPlan) {
    const rows = await pickBySourceType({ personType: 'enslaver', sourceType: plan.sourceType, collectionKeyLike: plan.label, limit: plan.limit });
    enslavers.push(...rows);
  }
  const enslaved = [];
  for (const plan of enslavedPlan) {
    const rows = await pickBySourceType({ personType: 'enslaved', sourceType: plan.sourceType, collectionKeyLike: plan.label, limit: plan.limit });
    enslaved.push(...rows);
  }
  // Freedperson / enslaved records that live in unconfirmed_persons (viewed with
  // table=unconfirmed_persons on the front end).
  const unconfirmedPlan = [
    { sourceType: '1860_slave_schedule', label: '1860 slave schedule (unconfirmed)', limit: 4 },
  ];
  for (const plan of unconfirmedPlan) {
    enslaved.push(...await pickUnconfirmedBySourceType(plan));
  }

  console.log(`Selected ${enslavers.length} enslavers, ${enslaved.length} enslaved/freedperson.\n`);

  const enslaverResults = [];
  for (const p of enslavers) enslaverResults.push(await testPerson(p));
  console.log('=== ENSLAVERS (table=canonical_persons) ===');
  console.table(enslaverResults);

  const enslavedResults = [];
  for (const p of enslaved) enslavedResults.push(await testPerson(p));
  console.log('=== ENSLAVED / FREEDPERSON ===');
  console.table(enslavedResults);

  const all = [...enslaverResults, ...enslavedResults];

  // Per-source-type efficacy roll-up.
  const bySource = {};
  for (const r of all) {
    const k = r.expected;
    bySource[k] ||= { source: k, tested: 0, loaded: 0, zero: 0, s3_ok: 0, s3_fail: 0 };
    bySource[k].tested++;
    if ((r.docs + r.colls) > 0) bySource[k].loaded++; else bySource[k].zero++;
    if (/OK/.test(r.s3_probe)) bySource[k].s3_ok++;
    if (/FAIL|ERR/.test(r.s3_probe)) bySource[k].s3_fail++;
  }
  for (const v of Object.values(bySource)) v.efficacy = `${v.loaded}/${v.tested}`;
  console.log('=== EFFICACY PER SOURCE TYPE ===');
  console.table(Object.values(bySource));

  const noDocs = all.filter(r => (r.docs + r.colls) === 0);
  const s3Fail = all.filter(r => /FAIL|ERR/.test(r.s3_probe));
  console.log(`\nSUMMARY: ${all.length} tested · ${noDocs.length} returned ZERO docs · ${s3Fail.length} S3 presign failures`);
  if (noDocs.length) console.log('  zero-doc persons:', noDocs.map(r => `${r.id}(${r.expected})`).join(', '));

  await pool.end();
})();
