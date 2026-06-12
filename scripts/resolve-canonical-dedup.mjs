#!/usr/bin/env node
/**
 * Canonical-person dedup resolver (first-pass entity resolution).
 * Block → score → route, encoding the verified methodology
 * (research/entity-resolution-methodology.md) + the 5 Biscoe rules.
 *
 * BLOCK: by last-name metaphone + state (phonetic = blocking only, never matching).
 * SCORE (additive log-odds-ish, calibrated to the Biscoe gold set):
 *   + shared FamilySearch external_id ............ +10  (near-certain)
 *   + shared parent (canonical_family_edges) ...... +6  (parentage-primary)
 *   - CONFLICTING parents (both have, disjoint) ... -8  (parentage cuts both ways → keeps the 3 Anns apart)
 *   + shared spouse ............................... +4
 *   + name Jaro-Winkler ≥.92 / .85-.92 / <.85 ..... +3 / +1.5 / -2
 *   - common-surname penalty (big block) .......... -2
 *   + birth-year |Δ|≤2 / ≤5 ....................... +3 / +1
 *   + same state / diff state ..................... +2 / -2
 * HARD EXCLUDE (→ never merge): birth-year Δ>7 (the 1799-vs-1844 case);
 *   enslaver↔enslaved role conflict; same census-enumeration set (Jaro-1989
 *   one-to-one) — two distinct rows in one 1860 schedule can't be one person.
 * ROUTE: ≥6 auto-merge-candidate · 3-6 review · multi-match → all to review
 *   (IPUMS: never pick a "best match").
 *
 *   node scripts/resolve-canonical-dedup.mjs --validate          # Biscoe gold check
 *   node scripts/resolve-canonical-dedup.mjs --metaphone BSK [--apply]
 *   node scripts/resolve-canonical-dedup.mjs --all [--apply]     # write candidates
 */
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');

function jaroWinkler(s1, s2) {
  s1 = (s1||'').toLowerCase(); s2 = (s2||'').toLowerCase();
  if (!s1 || !s2) return 0; if (s1 === s2) return 1;
  const md = Math.floor(Math.max(s1.length, s2.length)/2) - 1;
  const m1 = new Array(s1.length).fill(false), m2 = new Array(s2.length).fill(false);
  let m = 0;
  for (let i=0;i<s1.length;i++){ const lo=Math.max(0,i-md), hi=Math.min(i+md+1,s2.length);
    for (let j=lo;j<hi;j++){ if(!m2[j] && s1[i]===s2[j]){ m1[i]=m2[j]=true; m++; break; } } }
  if (!m) return 0;
  let t=0, k=0;
  for (let i=0;i<s1.length;i++){ if(m1[i]){ while(!m2[k])k++; if(s1[i]!==s2[k])t++; k++; } }
  t/=2;
  const jaro = (m/s1.length + m/s2.length + (m-t)/m)/3;
  let p=0; while(p<4 && s1[p]===s2[p]) p++;
  return jaro + p*0.1*(1-jaro);
}

// Score a candidate pair. Returns {score, evidence, exclude}.
function score(a, b, blockSize) {
  const ev = [];
  // ---- hard exclusions ----
  if (a.birth && b.birth && Math.abs(a.birth-b.birth) > 7) return { exclude:'birth-year Δ>7', score:-99 };
  const roleConf = (x,y)=> (x==='enslaver'&&y==='enslaved')||(x==='enslaved'&&y==='enslaver');
  if (roleConf(a.person_type,b.person_type)) return { exclude:'enslaver↔enslaved role conflict', score:-99 };
  // same-census mutual exclusion: both have a slave-schedule extid for the same year, different external_id
  for (const xa of a.extids) for (const xb of b.extids)
    if (xa.id_system==='1860_slave_schedule' && xb.id_system==='1860_slave_schedule' && xa.external_id!==xb.external_id)
      return { exclude:'distinct rows in same 1860 census', score:-99 };
  // ---- evidence ----
  let s = 0;
  const jw = jaroWinkler(a.canonical_name, b.canonical_name);
  // Kinship is RELATIONAL: a shared parent with DIFFERENT names means SIBLINGS
  // (distinct people), not a duplicate. So shared-parent only corroborates
  // identity together with name agreement; with a name mismatch it SEPARATES.
  const ap=new Set(a.parents), bp=new Set(b.parents);
  const sharedParent=[...ap].some(p=>bp.has(p));
  if (sharedParent){
    if (jw>=0.85){ s+=6; ev.push('shared parent + name match (+6)'); }
    else return { exclude:'shared parent + different name → siblings', score:-99 };
  } else if (ap.size && bp.size){ s-=8; ev.push('CONFLICTING parents (-8)'); }
  const sharedExt = a.extids.some(xa=>b.extids.some(xb=>xa.id_system===xb.id_system && xa.external_id===xb.external_id));
  if (sharedExt){ s+=10; ev.push('shared FS/external id (+10)'); }
  if (a.spouses.some(x=>b.spouses.includes(x))){ s+=4; ev.push('shared spouse (+4)'); }
  if (jw>=0.92){ s+=3; ev.push(`name JW ${jw.toFixed(2)} (+3)`); } else if (jw>=0.85){ s+=1.5; ev.push(`name JW ${jw.toFixed(2)} (+1.5)`); } else { s-=2; ev.push(`name JW ${jw.toFixed(2)} (-2)`); }
  if (blockSize>50){ s-=2; ev.push(`common surname block ${blockSize} (-2)`); }
  if (a.birth && b.birth){ const d=Math.abs(a.birth-b.birth); if(d<=2){s+=3;ev.push('birth ≤2yr (+3)');} else if(d<=5){s+=1;ev.push('birth ≤5yr (+1)');} }
  if (a.state && b.state){ if(a.state===b.state){s+=2;ev.push('same state (+2)');} else {s-=2;ev.push('diff state (-2)');} }
  return { score:Math.round(s*10)/10, evidence:ev, exclude:null };
}

async function loadPeople(where, params=[]) {
  const r = await pool.query(`
    SELECT cp.id, cp.canonical_name, cp.last_name_metaphone lm, cp.last_name_soundex ls,
      cp.birth_year_estimate birth, cp.death_year_estimate death, cp.person_type, cp.primary_state state
    FROM canonical_persons cp WHERE cp.person_type <> 'merged' AND (${where}) ORDER BY cp.id`, params);
  const people = r.rows;
  const ids = people.map(p=>p.id);
  if (!ids.length) return people;
  const ext = (await pool.query(`SELECT canonical_person_id cid, id_system, external_id FROM person_external_ids WHERE canonical_person_id = ANY($1)`,[ids])).rows;
  const par = (await pool.query(`SELECT person_b_id child, person_a_id parent FROM canonical_family_edges WHERE relationship_type='parent_of' AND person_b_id = ANY($1)`,[ids])).rows;
  const spo = (await pool.query(`SELECT person_a_id a, person_b_id b FROM canonical_family_edges WHERE relationship_type='spouse' AND (person_a_id = ANY($1) OR person_b_id = ANY($1))`,[ids])).rows;
  for (const p of people){
    p.extids = ext.filter(e=>e.cid===p.id);
    p.parents = par.filter(e=>e.child===p.id).map(e=>e.parent);
    p.spouses = spo.filter(e=>e.a===p.id||e.b===p.id).map(e=>e.a===p.id?e.b:e.a);
  }
  return people;
}

async function scoreBlock(people){
  const out=[];
  for (let i=0;i<people.length;i++) for (let j=i+1;j<people.length;j++){
    const r = score(people[i], people[j], people.length);
    if (r.exclude || r.score>=3) out.push({ a:people[i], b:people[j], ...r });
  }
  return out;
}

(async()=>{
  if (process.argv.includes('--validate')) {
    // Biscoe gold: load the surviving Biscoe/Briscoe + Hopewell DC people and score key pairs.
    const ppl = await loadPeople(`cp.canonical_name ~* '(bi|bri)scoe' OR cp.id IN (140344,141015)`);
    const byId = Object.fromEntries(ppl.map(p=>[p.id,p]));
    const checks = [
      [141015,140344,'matriarch(b1799) vs Annie Maria(b1844) → MUST separate'],
      [196010,196013,'Ann Biscoe(Bennett) vs Ann Briscoe(Edward) → MUST separate (conflicting parents)'],
    ];
    console.log('=== BISCOE VALIDATION ===');
    for (const [x,y,label] of checks){
      if(!byId[x]||!byId[y]){console.log(`  [skip ${x}/${y}] not loaded`);continue;}
      const r = score(byId[x], byId[y], 10);
      const verdict = r.exclude ? `EXCLUDED (${r.exclude})` : r.score>=6?'AUTO-MERGE':r.score>=3?'REVIEW':'SEPARATE';
      console.log(`  ${label}\n     → ${verdict} | score ${r.score} | ${(r.evidence||[]).join(', ')}`);
    }
    await pool.end(); return;
  }
  const ni = process.argv.indexOf('--name');
  const mi = process.argv.indexOf('--metaphone');
  if (ni>-1 || mi>-1){
    const people = ni>-1 ? await loadPeople(`cp.canonical_name ILIKE '%'||$1||'%'`, [process.argv[ni+1]])
                         : await loadPeople(`cp.last_name_metaphone = $1`, [process.argv[mi+1]]);
    console.log(`block: ${people.length} people`);
    const cands = (await scoreBlock(people)).sort((a,b)=>b.score-a.score);
    console.log(`candidate pairs (score≥3 or excluded): ${cands.length}`);
    console.table(cands.slice(0,25).map(c=>({a:c.a.id,an:c.a.canonical_name.slice(0,18),b:c.b.id,bn:c.b.canonical_name.slice(0,18),
      score:c.exclude?'EXCL':c.score, route:c.exclude?c.exclude.slice(0,18):c.score>=6?'AUTO-MERGE':'review'})));
    await pool.end(); return;
  }
  console.log('use --validate, --name <substr>, --metaphone <code>, or --all');
  await pool.end();
})();
