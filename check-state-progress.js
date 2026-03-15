const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);

async function checkStates() {
  const states = await sql`
    SELECT 
      state,
      COUNT(*) as total_locations,
      COUNT(CASE WHEN scraped_at IS NOT NULL THEN 1 END) as scraped,
      COUNT(CASE WHEN scraped_at IS NULL THEN 1 END) as remaining
    FROM familysearch_locations
    WHERE collection_id = '3161105'
    AND waypoint_id IS NOT NULL
    AND waypoint_id NOT LIKE '%collection%'
    AND district != state AND district != county
    GROUP BY state
    ORDER BY state
  `;
  
  console.log('\n1860 Slave Schedule Status by State:');
  console.log('=====================================\n');
  
  let totalLocations = 0;
  let totalScraped = 0;
  let totalRemaining = 0;
  
  states.forEach(s => {
    const pct = ((s.scraped / s.total_locations) * 100).toFixed(1);
    const status = s.remaining === 0 ? '✅ COMPLETE' : `⏳ ${s.remaining} left`;
    console.log(`${s.state.padEnd(20)} ${s.scraped.toString().padStart(4)}/${s.total_locations.toString().padStart(4)} (${pct.padStart(5)}%) - ${status}`);
    totalLocations += parseInt(s.total_locations);
    totalScraped += parseInt(s.scraped);
    totalRemaining += parseInt(s.remaining);
  });
  
  console.log('\n=====================================');
  const overallPct = ((totalScraped / totalLocations) * 100).toFixed(1);
  console.log(`TOTAL                ${totalScraped.toString().padStart(4)}/${totalLocations.toString().padStart(4)} (${overallPct.padStart(5)}%) - ${totalRemaining} remaining\n`);
}

checkStates().catch(console.error);
