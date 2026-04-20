import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const junkPatterns = [
  '%Memories%Get Involved%',
  '%Family Tree Search Memories%',
  '%Get Involved Activities%',
  '%Genealogies Catalog%',
  '%Full Text Images%',
  '%Save Record%',
];
for (const p of junkPatterns) {
  const c = await pool.query("SELECT COUNT(*)::int AS n FROM canonical_persons WHERE canonical_name ILIKE $1", [p]);
  console.log(`  pattern ${JSON.stringify(p).padEnd(45)} matches ${c.rows[0].n}`);
}

const s = await pool.query(`
  SELECT id, canonical_name, person_type
  FROM canonical_persons
  WHERE canonical_name ILIKE ANY(ARRAY['%Memories%Get Involved%','%Family Tree Search Memories%','%Genealogies Catalog%','%Full Text Images%','%Save Record%'])
  LIMIT 10
`);
console.log('\nSample junk rows:');
s.rows.forEach(r => console.log(`  id=${r.id} type=${r.person_type}  "${(r.canonical_name||'').slice(0, 80)}"`));
await pool.end();
