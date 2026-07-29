require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await pool.query(
      "SELECT count(*)::int n FROM probate_scrape_progress WHERE collection_id=$1 AND status='written'",
      ['1920234']
    );
    console.log('written=' + r.rows[0].n);
  } catch (e) { console.log('dberr ' + (e.message||e)); }
  await pool.end().catch(()=>{});
})();
