// promote-slavevoyages-past-to-leads.mjs  (#117 de-siloing)
//
// Promote orphaned slavevoyages_past_people (169,065 named enslaved Africans, all
// canonical_person_id NULL) onto the person spine via PersonService.findOrCreateLead:
// resolve-first (Biscoe-safe, links to an existing canonical or creates a GATED secondary
// lead), writes blocking keys, and back-links the side-table row (M115). Idempotent — skips
// rows already linked. Recovers disembark_port geography (e.g. Havana/Cuba/Matanzas) onto the
// spine so the SlaveVoyages numerator attaches to the Cuba benchmark denominator (#116).
//
//   node scripts/promote-slavevoyages-past-to-leads.mjs --cuba              # dry-run sample
//   node scripts/promote-slavevoyages-past-to-leads.mjs --cuba --apply      # write the Cuba pilot
//   node scripts/promote-slavevoyages-past-to-leads.mjs --dataset african_origins --apply
//   flags: --cuba (disembark Havana/Cuba/Matanzas) | --dataset X | --limit N (default 300 dry / all apply)
//
// Discipline: gated secondary leads (non-assertable until documented); NO auto-merge (Biscoe);
// owner_name kept in context only, never auto-linked as an enslaver.

import 'dotenv/config';
import pg from 'pg';
import PersonService from '../src/services/PersonService.js';

const APPLY = process.argv.includes('--apply');
const CUBA = process.argv.includes('--cuba');
const di = process.argv.indexOf('--dataset');
const DATASET = di > -1 ? process.argv[di + 1] : null;
const li = process.argv.indexOf('--limit');
const LIMIT = li > -1 ? +process.argv[li + 1] : (APPLY ? null : 300);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const svc = new PersonService(pool);

const where = ['linked_subject_id IS NULL', "name IS NOT NULL AND name <> ''"];
if (CUBA) where.push(`(disembark_port ILIKE '%havana%' OR disembark_port ILIKE '%cuba%' OR disembark_port ILIKE '%matanzas%')`);
if (DATASET) where.push(`dataset = '${DATASET.replace(/'/g, "''")}'`);
const sql = `SELECT id, name, name_modern, sex, age, origin, language_group, voyage_id, ship_name, year,
  embark_port, disembark_port, owner_name, dataset, sv_id
  FROM slavevoyages_past_people WHERE ${where.join(' AND ')} ORDER BY id ${LIMIT ? `LIMIT ${LIMIT}` : ''}`;

const norm = s => { if (!s) return null; const c = String(s).trim().toUpperCase(); return c.startsWith('M') ? 'M' : c.startsWith('F') ? 'F' : null; };
const birthYear = (year, age) => {
  const y = +year, a = +age;
  if (Number.isFinite(y) && Number.isFinite(a) && a >= 0 && a <= 100 && y >= 1400 && y <= 1870) return y - a;
  return null;
};

console.log(`Scope: ${CUBA ? 'CUBA disembark ' : ''}${DATASET ? 'dataset=' + DATASET + ' ' : ''}${LIMIT ? '(limit ' + LIMIT + ') ' : '(all) '}| mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
const rows = (await pool.query(sql)).rows;
console.log(`${rows.length} unlinked rows to process\n`);

const tally = { created: 0, linked: 0, rejected_no_name: 0, would_create: 0, error: 0 };
const linkedSamples = [];
let n = 0;
for (const r of rows) {
  const context = `SlaveVoyages PAST [${r.dataset}] sv_id=${r.sv_id ?? ''} voyage_id=${r.voyage_id ?? ''} `
    + `ship=${r.ship_name ?? ''} origin=${r.origin ?? ''} lang=${r.language_group ?? ''} `
    + `embark=${r.embark_port ?? ''} disembark=${r.disembark_port ?? ''} year=${r.year ?? ''} `
    + `age=${r.age ?? ''} owner=${r.owner_name ?? ''}`;
  const record = {
    name: r.name || r.name_modern,
    personType: 'enslaved',
    sex: norm(r.sex),
    birthYear: birthYear(r.year, r.age),
    location: r.disembark_port || r.origin || null,
    locations: [r.disembark_port, r.origin].filter(Boolean),
    sourceUrl: `slavevoyages_past/${r.dataset}/${r.sv_id ?? r.id}`,
    sourceType: 'academic_database',
    confidence: 0.85,
    context,
    extractionMethod: 'slavevoyages_past_promotion',
    dataQualityFlags: { slavevoyages_past: true, dataset: r.dataset },
    externalId: r.sv_id ? String(r.sv_id) : null,
    idSystem: r.sv_id ? 'slavevoyages' : null,
  };
  try {
    // NB: do NOT pass externalId/idSystem here. slavevoyages_past_people.sv_id (African-Origins
    // PERSON ids) collides numerically with the canonical `slavevoyages` external-ids (voyage-level
    // ENSLAVER/trader ids) — a different namespace. resolve()'s tier-1 external match ignores the
    // name, so passing it bolted enslaved Africans onto unrelated enslaver canonicals (5,275 false
    // links, all enslaved→enslaver). Match on NAME + location only (Biscoe-safe); sv_id stays in context.
    const res = await svc.resolve({ name: record.name, birthYear: record.birthYear, location: record.location,
      sex: record.sex, personType: 'enslaved' });
    const m = res.match;
    // ONLY accept a match that lands on the real spine. A match to another orphaned
    // slavevoyages_past_people row (siblings share common African names) is NOT a promotion —
    // reject it and create a fresh gated lead instead.
    const spineMatch = m && (m.subject_table === 'canonical_persons' || m.subject_table === 'unconfirmed_persons');
    if (spineMatch) {
      tally.linked++;
      if (linkedSamples.length < 5) linkedSamples.push({ name: record.name, to: m.subject_table, id: m.subject_id });
      if (APPLY) {
        if (m.subject_table === 'canonical_persons' && record.externalId) {
          await pool.query(`INSERT INTO person_external_ids (canonical_person_id,id_system,external_id,external_url,confidence)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id_system,external_id) DO NOTHING`,
            [m.subject_id, record.idSystem, record.externalId, record.sourceUrl, 0.9]).catch(() => {});
        }
        await pool.query(`UPDATE slavevoyages_past_people SET linked_subject_table=$1, linked_subject_id=$2, linked_at=NOW() WHERE id=$3`,
          [m.subject_table, m.subject_id, r.id]);
      }
    } else {
      tally[APPLY ? 'created' : 'would_create']++;
      if (APPLY) {
        const ins = await pool.query(
          `INSERT INTO unconfirmed_persons (full_name, person_type, birth_year, death_year, gender, locations, source_url, source_type, extraction_method, confidence_score, context_text, data_quality_flags, relationships, status)
           VALUES ($1,'enslaved',$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,'[]','pending') RETURNING lead_id`,
          [record.name, record.birthYear, record.sex, record.locations.length ? record.locations : null,
           record.sourceUrl, record.sourceType, record.extractionMethod, record.confidence, record.context,
           JSON.stringify(record.dataQualityFlags)]);
        const leadId = ins.rows[0].lead_id;
        await svc._writeBlockingKeys('unconfirmed_persons', leadId, record);
        await pool.query(`UPDATE slavevoyages_past_people SET linked_subject_table='unconfirmed_persons', linked_subject_id=$1, linked_at=NOW() WHERE id=$2`, [leadId, r.id]);
      }
    }
  } catch (e) { tally.error++; if (tally.error <= 3) console.log(`  err id=${r.id} ${record.name}: ${e.message}`); }
  if (++n % 200 === 0) process.stdout.write(`  ${n}/${rows.length}\r`);
}

console.log(`\n=== RESULT (${APPLY ? 'APPLIED' : 'DRY-RUN'}) ===`);
console.table(tally);
if (linkedSamples.length) { console.log('sample LINKS to existing spine:'); console.table(linkedSamples); }
const createKey = APPLY ? 'created' : 'would_create';
console.log(`${APPLY ? 'Created' : 'Would create'} ${tally[createKey] || 0} leads, linked ${tally.linked} to existing, rejected ${tally.rejected_no_name}.`);
if (!APPLY) console.log(`\n[DRY RUN] re-run with --apply to write${CUBA ? ' the Cuba pilot' : ''}.`);
await pool.end();
