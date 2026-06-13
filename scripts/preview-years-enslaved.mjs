import path from 'node:path'; import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv'; import pg from 'pg';
import { yearsEnslaved, emancipationFor } from '../src/services/reparations/emancipation-dates.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
// pull enslaved with age + state + observation year
const rows = (await pool.query(`
  SELECT (relationships->>'age')::int age, (relationships->>'year')::int yr, relationships->>'state' state
  FROM unconfirmed_persons
  WHERE person_type='enslaved' AND relationships->>'age' ~ '^[0-9]{1,3}$' AND relationships->>'year' ~ '^[0-9]{4}$'`)).rows;
let withYears=0; const byState={}; const dist={};
for (const r of rows){
  const birth = r.yr - r.age;
  const ye = yearsEnslaved(birth, r.state);
  if (ye==null) continue; withYears++;
  const code = emancipationFor(r.state).year+''; // group label by emancipation year
  const sk = (r.state||'?')+` (emanc ${emancipationFor(r.state).year})`;
  (byState[sk] ||= {n:0,sum:0}); byState[sk].n++; byState[sk].sum+=ye;
  const b = ye<=5?'0-5':ye<=15?'6-15':ye<=30?'16-30':ye<=50?'31-50':'50+'; dist[b]=(dist[b]||0)+1;
}
console.log(`enslaved persons with computable years-enslaved: ${withYears.toLocaleString()} of ${rows.length.toLocaleString()}`);
console.log('\nyears-enslaved distribution (this is the per-person VARIATION Model A lacked):');
for (const b of ['0-5','6-15','16-30','31-50','50+']) console.log(`  ${b.padEnd(6)} ${(dist[b]||0).toLocaleString()}`);
console.log('\nmean years-enslaved by state (note the LOCAL emancipation differences):');
Object.entries(byState).sort((a,b)=>b[1].n-a[1].n).slice(0,12).forEach(([k,v])=>console.log(`  ${k.padEnd(34)} n=${String(v.n).padStart(7)}  mean=${(v.sum/v.n).toFixed(1)} yrs`));
await pool.end();
