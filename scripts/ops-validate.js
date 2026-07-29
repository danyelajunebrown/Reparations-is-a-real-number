require("dotenv").config();
const db = require("../src/database/connection");
(async () => {
  const tables = [
    "participants", "participant_family", "scrape_runs",
    "canonical_persons", "enslaved_individuals", "family_relationships",
    "historical_reparations_petitions", "person_merge_log",
    "parse_failure_queue", "ancestor_climb_sessions", "ancestor_climb_matches",
    "person_documents", "slave_era_insurance_policies",
    "corporate_slavery_disclosures", "corporate_debt_acknowledgments",
    "top_landholder_flags", "land_transfer_events"
  ];
  console.log("Table counts:");
  for (const t of tables) {
    try {
      const r = await db.query(`SELECT count(*)::int AS n FROM ${t}`);
      console.log("  " + t.padEnd(40) + r.rows[0].n);
    } catch (e) { console.log("  " + t.padEnd(40) + "MISSING: " + e.message.slice(0,50)); }
  }
  const latest = await db.query(`
    SELECT full_name, intake_source, intake_date FROM participants
    WHERE intake_date > NOW() - INTERVAL '3 days' ORDER BY intake_date DESC LIMIT 5
  `);
  console.log("\nRecent participants:");
  latest.rows.forEach(r => console.log("  " + r.intake_date?.toISOString?.() + " " + (r.full_name || "null") + " (" + r.intake_source + ")"));
  process.exit(0);
})();
