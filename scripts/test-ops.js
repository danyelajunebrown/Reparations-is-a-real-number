require("dotenv").config();
const db = require("./src/database/connection");
const os = require("os");
(async () => {
  const ins = await db.query("INSERT INTO scrape_runs (runner, branch, host, status, pages_ocrd) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    ["ops-smoketest", "test-branch", os.hostname(), "running", 1]);
  console.log("inserted run id:", ins.rows[0].id);
  await db.query("UPDATE scrape_runs SET status=$1, exit_code=$2, finished_at=NOW() WHERE id=$3", ["done", 0, ins.rows[0].id]);
  console.log("marked done");
  const r = await db.query("SELECT count(*) FROM scrape_runs");
  console.log("total rows:", r.rows[0].count);
  process.exit(0);
})();
