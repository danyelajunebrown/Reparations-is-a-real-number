import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
// SQL from arg or from a file via --file=PATH
let sql = process.argv[2];
if (sql && sql.startsWith('--file=')) sql = readFileSync(sql.slice(7), 'utf8');
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
try {
  const r = await p.query(sql);
  console.log(JSON.stringify(r.rows, null, 1));
} catch (e) { console.error('ERR', e.message); process.exit(1); }
await p.end();
