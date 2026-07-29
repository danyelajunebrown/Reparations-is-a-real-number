require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const fs = require('fs'), path = require('path');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    // DB: written images per roll, distinct rolls, total
    const w = await pool.query(
      "SELECT roll_group_id, count(*)::int n FROM probate_scrape_progress WHERE collection_id=$1 AND status='written' GROUP BY roll_group_id",
      ['1920234']
    );
    const writtenByRoll = new Map(w.rows.map(r => [r.roll_group_id, r.n]));
    const totalWritten = w.rows.reduce((a, r) => a + r.n, 0);

    // Sitemap: expected counts per county/roll
    const smPath = path.join(process.env.HOME, 'Desktop/Reparations-is-a-real-number/tmp/new-york-probate-sitemap.json');
    const sm = JSON.parse(fs.readFileSync(smPath, 'utf8'));
    let counties = 0, rollsTotal = 0, rollsComplete = 0, rollsTouched = 0, rollsUntouched = 0, expectedKnown = 0;
    let partial = [];
    for (const c of sm.counties) {
      counties++;
      for (const r of (c.rolls || [])) {
        if (!/^[0-9A-Z]{4}-[0-9A-Z]{2,5}$/i.test(r.groupId || '')) continue; // skip junk
        rollsTotal++;
        if (r.status === 'complete') rollsComplete++;
        const got = writtenByRoll.get(r.groupId) || 0;
        if (got > 0) rollsTouched++; else rollsUntouched++;
        if (r.imageCount) { expectedKnown += r.imageCount;
          if (got > 0 && got < r.imageCount && r.status !== 'complete') partial.push(`${c.county}/${r.groupId} ${got}/${r.imageCount}`);
        }
      }
    }
    console.log(`counties=${counties} rolls=${rollsTotal} complete=${rollsComplete} touched=${rollsTouched} untouched=${rollsUntouched}`);
    console.log(`images_written=${totalWritten}  expected(where imageCount known)=${expectedKnown}`);
    console.log(`in-progress partial rolls (sample): ${partial.slice(0,8).join(' | ') || 'none'}`);
  } catch (e) { console.log('err ' + (e.message||e)); }
  await pool.end().catch(()=>{});
})();
