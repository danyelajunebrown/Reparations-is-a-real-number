// seed-ucl-lbs-frontier.mjs
//
// Seed the UCL LBS crawl frontier (M118) with the DENSE small-integer ID spaces we can enumerate
// directly — claim/estate/firm — so the graph crawl has a starting surface. Person pages are NOT
// seeded by ID: LBS person ids are mixed small-int AND large/negative hashes, so persons are reached
// by FOLLOWING links out of claim/estate/firm pages during the crawl (see plan-ucl-lbs-scraper.md).
//
// This is a pure queue seed — NO network, NO scraping. It just inserts 'queued' frontier rows.
// Idempotent: ON CONFLICT (url_type, ext_id) DO NOTHING (the visited-set), so re-running only fills
// gaps and never resets progress. Safe on the MacBook.
//
// Ranges are conservative UPPER BOUNDS from the research pass (finding-ucl-lbs-source-and-scraper-
// research.md): ~40k claims, estates archived up to ~24,289, firms unknown-but-small. A 404/empty page
// during the crawl just marks that row 'skipped' — over-seeding is cheap and correct; the crawl will
// also discover any ids ABOVE these bounds via links and enqueue them.
//
// Usage:
//   node scripts/seed-ucl-lbs-frontier.mjs                 # dry-run (prints what it WOULD seed)
//   node scripts/seed-ucl-lbs-frontier.mjs --apply         # write the frontier rows
//   node scripts/seed-ucl-lbs-frontier.mjs --apply \
//        --claims 46000 --estates 25000 --firms 2000       # override upper bounds

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const argN = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? parseInt(process.argv[i + 1], 10) : def;
};

// Conservative upper bounds (see research finding). Over-seeding is cheap; 404s → 'skipped'.
const RANGES = {
  claim:  argN('--claims',  46000),
  estate: argN('--estates', 25000),
  firm:   argN('--firms',    2000),
};

const BATCH = 5000;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL not set (fail-loud). Aborting.');
    process.exit(1);
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Guard: the frontier table must exist (migration 118 applied).
    const { rows: t } = await pool.query(
      `SELECT to_regclass('public.lbs_crawl_frontier') AS tbl`
    );
    if (!t[0].tbl) {
      console.error('FATAL: lbs_crawl_frontier missing. Run: node scripts/apply-migrations.js');
      process.exit(1);
    }

    const before = await counts(pool);
    console.log('Frontier before:', fmt(before));
    console.log('Seed plan (id 1..N per type):',
      Object.entries(RANGES).map(([k, v]) => `${k}=${v}`).join('  '),
      APPLY ? '' : '  [DRY-RUN — pass --apply to write]');

    if (!APPLY) {
      const wouldAdd = Object.values(RANGES).reduce((a, b) => a + b, 0);
      console.log(`Would enqueue up to ${wouldAdd.toLocaleString()} rows (existing rows skipped by ON CONFLICT).`);
      return;   // pool closed by finally
    }

    let inserted = 0;
    for (const [type, max] of Object.entries(RANGES)) {
      for (let start = 1; start <= max; start += BATCH) {
        const end = Math.min(start + BATCH - 1, max);
        const ids = [];
        for (let i = start; i <= end; i++) ids.push(String(i));
        // Bulk insert via UNNEST; ON CONFLICT = the visited-set (never resets an already-seen row).
        const res = await pool.query(
          `INSERT INTO lbs_crawl_frontier (url_type, ext_id, status, discovered_from, depth)
           SELECT $1, x, 'queued', 'seed', 0 FROM unnest($2::text[]) AS x
           ON CONFLICT (url_type, ext_id) DO NOTHING
           RETURNING 1`,
          [type, ids]
        );
        inserted += res.rows.length;
        process.stdout.write(`\r  ${type}: seeded through ${end}/${max}  (+${inserted} new total)   `);
      }
      process.stdout.write('\n');
    }

    const after = await counts(pool);
    console.log(`Done. Inserted ${inserted.toLocaleString()} new frontier rows.`);
    console.log('Frontier after: ', fmt(after));
  } finally {
    await pool.end();
  }
}

async function counts(pool) {
  const { rows } = await pool.query(
    `SELECT url_type, status, count(*)::int n FROM lbs_crawl_frontier GROUP BY 1,2 ORDER BY 1,2`
  );
  return rows;
}
function fmt(rows) {
  if (!rows.length) return '(empty)';
  return rows.map(r => `${r.url_type}/${r.status}=${r.n}`).join('  ');
}

main().catch(e => { console.error('\nFATAL:', e); process.exit(1); });
