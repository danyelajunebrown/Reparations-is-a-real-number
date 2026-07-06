// ingest-suriname-slaveregisters.mjs — Suriname Slave Registers 1830-1863 (#137, Dutch) onto the spine
// as GATED SECONDARY leads via the bulk path. IISG Dataverse hdl:10622/CSPBHO, CC BY-SA 4.0 (re-hostable).
//
// The CSV is one row per register ENTRY (mutation); Id_person groups a person's entries. We aggregate
// per person: name + sex + BIRTH YEAR + mother + the OWNER SEQUENCE across entries (the ownership/
// transfer chain = dual-ledger + continuity) + plantation + occupation + Family_name (the 1863
// emancipation surname = the enslaved→freedom identity bridge). Strong corroborators (birth year, mother,
// owner) → unlike enslaved.org, this supports REAL cross-source dedup later.
//
// DUAL-ARCHIVE (standard-external-source-ingest rule 8): S3 the CSV + ensureSnapshot the Dataverse page +
// source_artifacts row (s3_key + wayback_url + license). id_system='hdsc_suriname_slaveregister'.
// Owner leads + ownership/kinship edges = a follow-on producer (owners captured in relationships JSONB).
//
// Usage: node scripts/ingest-suriname-slaveregisters.mjs <csv> --stats | --apply [--no-archive]

import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { parse } from 'csv-parse';
import pg from 'pg';
import { bulkIngestLeads } from './lib/bulk-lead-ingest.mjs';
import { ensureSnapshot } from './lib/wayback.mjs';

const require = createRequire(import.meta.url);
const S3 = require('../src/services/storage/S3Service');

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
const NO_ARCHIVE = process.argv.includes('--no-archive');
if (!FILE || !fs.existsSync(FILE)) { console.error('usage: node scripts/ingest-suriname-slaveregisters.mjs <csv> [--stats|--apply]'); process.exit(1); }

const ID_SYSTEM = 'hdsc_suriname_slaveregister';
const DATAVERSE = 'https://datasets.iisg.amsterdam/dataset.xhtml?persistentId=hdl:10622/CSPBHO';
const PERSON_URL = (id) => `https://datasets.iisg.amsterdam/dataset.xhtml?persistentId=hdl:10622/CSPBHO#person/${id}`;
const clean = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const yr = (s) => { const m = clean(s).match(/\b(1[78]\d\d)\b/); return m ? +m[1] : null; };

async function archiveCsv(pool) {
  const buf = fs.readFileSync(FILE);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  let s3Key = null, s3Bucket = null, waybackUrl = null;
  if (!NO_ARCHIVE && S3.isEnabled && S3.isEnabled()) {
    s3Key = 'sources/hdsc-suriname/suriname-slaveregisters-1830-1863.csv';
    try { await S3.upload(s3Key, buf, 'text/csv; charset=utf-8', { sha256 }); s3Bucket = S3.bucket || null; console.log(`  S3 ✓ ${s3Key}`); }
    catch (e) { console.log(`  S3 fail (continuing): ${e.message}`); s3Key = null; }
  }
  if (!NO_ARCHIVE) { console.log('  Wayback: snapshotting Dataverse page…'); waybackUrl = await ensureSnapshot(DATAVERSE); console.log(waybackUrl ? `  Wayback ✓ ${waybackUrl}` : '  Wayback: soft-fail'); }
  await pool.query(
    `INSERT INTO source_artifacts (artifact_key, dataset_label, source_name, source_url, download_url, s3_bucket, s3_key, wayback_url, sha256, bytes, content_type, license, rehostable)
     VALUES ('hdsc-suriname','Suriname Slave Registers 1830-1863','Historische Database Suriname en Curaçao / IISG', $1,
             'https://datasets.iisg.amsterdam/api/access/datafile/14105?format=original', $2,$3,$4,$5,$6,'text/csv','CC BY-SA 4.0', TRUE)
     ON CONFLICT (artifact_key) DO UPDATE SET s3_key=EXCLUDED.s3_key, wayback_url=EXCLUDED.wayback_url, sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes`,
    [DATAVERSE, s3Bucket, s3Key, waybackUrl, sha256, buf.length]);
  console.log(`  source_artifacts ✓ (s3=${s3Key ? 'yes' : 'no'}, wayback=${waybackUrl ? 'yes' : 'no'}) — rule 8`);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  if (APPLY) { console.log('Archiving source (rule 8: S3 + Wayback)…'); await archiveCsv(pool); }

  console.log('Aggregating entry-rows by Id_person…');
  const persons = new Map();   // Id_person -> aggregate
  let rows = 0;
  await new Promise((resolve, reject) => {
    fs.createReadStream(FILE).pipe(parse({ columns: true, skip_empty_lines: true, relax_quotes: true }))
      .on('data', (r) => {
        rows++;
        const id = clean(r.Id_person); if (!id) return;
        let p = persons.get(id);
        if (!p) { p = { name: '', sex: null, birthYear: null, mother: '', plantations: new Set(), owners: [], occupation: '', emancSurname: '', deathYear: null, entries: 0 }; persons.set(id, p); }
        p.entries++;
        if (!p.name) p.name = clean(r.Name_enslaved) || [clean(r.First_name), clean(r.Family_name)].filter(Boolean).join(' ');
        if (!p.sex && r.Sex) p.sex = /^m/i.test(r.Sex) ? 'm' : /^f/i.test(r.Sex) ? 'f' : null;
        if (!p.birthYear) p.birthYear = yr(r.Year_birth) || yr(r.Year_birth2_ER);
        if (!p.deathYear) p.deathYear = yr(r.Year_death);
        if (!p.mother && clean(r.Name_mother)) p.mother = clean(r.Name_mother);
        if (clean(r.Plantation)) p.plantations.add(clean(r.Plantation));
        const ow = clean(r.Name_owner);
        if (ow && !p.owners.some(o => o.name === ow)) p.owners.push({ name: ow, from: yr(r.StartEntryYear), to: yr(r.EndEntryYear) });
        if (!p.occupation && clean(r.Occupation)) p.occupation = clean(r.Occupation);
        if (!p.emancSurname && clean(r.Family_name)) p.emancSurname = clean(r.Family_name);
      })
      .on('end', resolve).on('error', reject);
  });
  console.log(`  ${rows} entry-rows → ${persons.size} distinct persons.`);

  const stats = { persons: persons.size, no_name: 0, with_birth: 0, with_mother: 0, with_owner: 0, with_emanc_surname: 0, created: 0, linked: 0 };
  let batch = [];
  const flush = async () => { if (batch.length && APPLY) { const r = await bulkIngestLeads(pool, batch, { batchSize: 2000 }); stats.created += r.created; stats.linked += r.linked; } batch = []; };

  for (const [id, p] of persons) {
    if (!p.name) { stats.no_name++; continue; }
    if (p.birthYear) stats.with_birth++;
    if (p.mother) stats.with_mother++;
    if (p.owners.length) stats.with_owner++;
    if (p.emancSurname) stats.with_emanc_surname++;
    const plantations = [...p.plantations];
    const ctx = [p.emancSurname && `emancipation surname: ${p.emancSurname}`, p.mother && `mother: ${p.mother}`,
      p.owners.length && `owners: ${p.owners.map(o => o.name).join(' → ')}`, p.occupation && `occupation: ${p.occupation}`,
      plantations.length && `plantation: ${plantations.join('; ')}`, `Suriname slave register (HDSC) person ${id}`].filter(Boolean).join('; ');
    const rel = [];
    if (p.mother) rel.push({ type: 'mother', name: p.mother });
    for (const o of p.owners) rel.push({ type: 'owner', name: o.name, from: o.from, to: o.to });
    batch.push({
      name: p.name, sourceUrl: PERSON_URL(id), externalId: id, idSystem: ID_SYSTEM,
      personType: 'enslaved', sex: p.sex, birthYear: p.birthYear, deathYear: p.deathYear,
      locations: plantations.length ? [...plantations.slice(0, 1), 'Suriname'] : ['Suriname'],
      sourceType: 'scholarly', extractionMethod: 'bulk', confidence: 0.9,
      context: ctx.slice(0, 900), relationships: rel,
      dataQualityFlags: { hdsc_person_id: id, emancipation_surname: p.emancSurname || null, license: 'CC BY-SA 4.0' },
    });
    if (batch.length >= 5000) await flush();
  }
  await flush();
  await pool.end();
  console.log('\n=== stats ===', JSON.stringify(stats));
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
