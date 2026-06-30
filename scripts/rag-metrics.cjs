#!/usr/bin/env node
// Phase-2c RAG-Ops metrics: groundedness + corpus gaps from retrieval_log. node scripts/rag-metrics.cjs
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const m = (await pool.query(`SELECT count(*) n, round(avg(top_similarity),3) avg_topsim,
     round(100.0*avg((grounded)::int),1) pct_grounded, round(avg(latency_ms)) avg_ms,
     count(*) FILTER (WHERE top_similarity < 0.5) weak FROM retrieval_log`)).rows[0];
  console.log('RAG-Ops metrics (all-time):', JSON.stringify(m));
  const w = (await pool.query(`SELECT query_text, top_similarity FROM retrieval_log
     WHERE top_similarity IS NOT NULL ORDER BY top_similarity ASC LIMIT 10`)).rows;
  console.log('\nweakest retrievals (corpus gaps — thin coverage / what to ingest next):');
  w.forEach(r => console.log('  ' + (+r.top_similarity).toFixed(3) + '  ' + (r.query_text || '').slice(0, 70)));
  await pool.end();
})();
